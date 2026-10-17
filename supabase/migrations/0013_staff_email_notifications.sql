alter table public.staff
  add column email text
    check (email is null or email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$');

drop function if exists public.create_business_onboarding(
  text, text, text, text, text, text, text, text, text, integer, integer, jsonb
);

create function public.create_business_onboarding(
  p_name text,
  p_slug text,
  p_type text,
  p_phone text,
  p_whatsapp text,
  p_address text,
  p_timezone text,
  p_staff_name text,
  p_staff_email text,
  p_service_name text,
  p_service_duration integer,
  p_service_price integer,
  p_hours jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_business_id uuid;
  new_service_id uuid;
  new_staff_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesión autenticada' using errcode = '42501';
  end if;
  if p_staff_email is null or p_staff_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'El correo del profesional no es válido';
  end if;

  insert into public.businesses (
    owner_id, name, slug, type, phone, whatsapp, address, timezone
  ) values (
    auth.uid(), p_name, p_slug, p_type, p_phone, p_whatsapp, p_address, p_timezone
  )
  returning id into new_business_id;

  insert into public.services (business_id, name, duration_minutes, price_cop)
  values (new_business_id, p_service_name, p_service_duration, p_service_price)
  returning id into new_service_id;

  insert into public.staff (business_id, name, email)
  values (new_business_id, p_staff_name, lower(trim(p_staff_email)))
  returning id into new_staff_id;

  insert into public.staff_services (business_id, staff_id, service_id)
  values (new_business_id, new_staff_id, new_service_id);

  insert into public.business_hours (business_id, weekday, open_time, close_time, is_closed)
  select new_business_id, h.weekday, h.open_time, h.close_time, h.is_closed
  from jsonb_to_recordset(p_hours) as h(
    weekday smallint, open_time time, close_time time, is_closed boolean
  );

  if (select count(*) from public.business_hours where business_id = new_business_id) <> 7 then
    raise exception 'Se deben configurar los siete días de la semana';
  end if;
  return new_business_id;
end;
$$;

revoke all on function public.create_business_onboarding(
  text, text, text, text, text, text, text, text, text, text, integer, integer, jsonb
) from public, anon;
grant execute on function public.create_business_onboarding(
  text, text, text, text, text, text, text, text, text, text, integer, integer, jsonb
) to authenticated;

drop function if exists public.create_staff_for_business(uuid, text, uuid[]);

create function public.create_staff_for_business(
  p_business_id uuid,
  p_name text,
  p_email text,
  p_service_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_staff_id uuid;
  valid_service_count integer;
begin
  if not exists (
    select 1 from public.businesses b
    where b.id = p_business_id and b.owner_id = auth.uid()
  ) then
    raise exception 'No tienes acceso a este negocio' using errcode = '42501';
  end if;
  if p_email is null or p_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'El correo del profesional no es válido';
  end if;
  if coalesce(cardinality(p_service_ids), 0) = 0 then
    raise exception 'Selecciona al menos un servicio';
  end if;

  select count(distinct s.id) into valid_service_count
  from public.services s
  where s.business_id = p_business_id
    and s.is_active
    and s.id = any(p_service_ids);
  if valid_service_count <> cardinality(p_service_ids) then
    raise exception 'Uno o más servicios no pertenecen a este negocio';
  end if;

  insert into public.staff (business_id, name, email)
  values (p_business_id, p_name, lower(trim(p_email)))
  returning id into new_staff_id;

  insert into public.staff_services (business_id, staff_id, service_id)
  select p_business_id, new_staff_id, service_id
  from unnest(p_service_ids) as selected(service_id);
  return new_staff_id;
end;
$$;

revoke all on function public.create_staff_for_business(uuid, text, text, uuid[])
  from public, anon;
grant execute on function public.create_staff_for_business(uuid, text, text, uuid[])
  to authenticated;

drop function if exists public.create_business_for_owner_as_super_admin(
  uuid, uuid, text, text, text, text, text, text, text, text, text, integer, integer, jsonb
);

create function public.create_business_for_owner_as_super_admin(
  p_admin_id uuid,
  p_owner_id uuid,
  p_name text,
  p_slug text,
  p_type text,
  p_phone text,
  p_whatsapp text,
  p_address text,
  p_timezone text,
  p_staff_name text,
  p_staff_email text,
  p_service_name text,
  p_service_duration integer,
  p_service_price integer,
  p_hours jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_business_id uuid;
  new_service_id uuid;
  new_staff_id uuid;
begin
  if not public.is_super_admin(p_admin_id) then
    raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_owner_id) then
    raise exception 'BUSINESS_OWNER_NOT_FOUND' using errcode = '23503';
  end if;
  if p_staff_email is null or p_staff_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'El correo del profesional no es válido';
  end if;

  perform public.assert_business_subscription_access(p_owner_id, true);
  insert into public.businesses (
    owner_id, name, slug, type, phone, whatsapp, address, timezone
  ) values (
    p_owner_id, p_name, p_slug, p_type, p_phone, p_whatsapp, p_address, p_timezone
  )
  returning id into new_business_id;

  insert into public.services (business_id, name, duration_minutes, price_cop)
  values (new_business_id, p_service_name, p_service_duration, p_service_price)
  returning id into new_service_id;

  insert into public.staff (business_id, name, email)
  values (new_business_id, p_staff_name, lower(trim(p_staff_email)))
  returning id into new_staff_id;

  insert into public.staff_services (business_id, staff_id, service_id)
  values (new_business_id, new_staff_id, new_service_id);

  insert into public.business_hours (business_id, weekday, open_time, close_time, is_closed)
  select new_business_id, h.weekday, h.open_time, h.close_time, h.is_closed
  from jsonb_to_recordset(p_hours) as h(
    weekday smallint, open_time time, close_time time, is_closed boolean
  );
  if (select count(*) from public.business_hours where business_id = new_business_id) <> 7 then
    raise exception 'Se deben configurar los siete días de la semana';
  end if;
  return new_business_id;
end;
$$;

revoke all on function public.create_business_for_owner_as_super_admin(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, integer, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.create_business_for_owner_as_super_admin(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, integer, integer, jsonb
) to service_role;

notify pgrst, 'reload schema';
