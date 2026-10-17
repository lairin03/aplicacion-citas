alter table public.businesses
  drop constraint if exists businesses_type_check;

alter table public.businesses
  add constraint businesses_type_check
  check (type in (
    'barbería',
    'peluquería',
    'manicura',
    'lashista',
    'consultorio',
    'profesional_independiente',
    'otro'
  ));

create or replace function public.create_business_for_owner_as_super_admin(
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

  perform public.assert_business_subscription_access(p_owner_id, true);

  insert into public.businesses (
    owner_id, name, slug, type, phone, whatsapp, address, timezone
  ) values (
    p_owner_id, p_name, p_slug, p_type, p_phone, p_whatsapp, p_address, p_timezone
  )
  returning id into new_business_id;

  insert into public.services (
    business_id, name, duration_minutes, price_cop
  ) values (
    new_business_id, p_service_name, p_service_duration, p_service_price
  )
  returning id into new_service_id;

  insert into public.staff (business_id, name)
  values (new_business_id, p_staff_name)
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
  uuid, uuid, text, text, text, text, text, text, text, text, text, integer, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.create_business_for_owner_as_super_admin(
  uuid, uuid, text, text, text, text, text, text, text, text, text, integer, integer, jsonb
) to service_role;

notify pgrst, 'reload schema';
