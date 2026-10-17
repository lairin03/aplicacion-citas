create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  type text not null check (type in ('barbería', 'peluquería', 'manicura', 'otro')),
  phone text,
  whatsapp text,
  address text,
  timezone text not null default 'America/Bogota',
  logo_url text check (logo_url is null or logo_url like 'https://%'),
  created_at timestamptz not null default now()
);
create unique index businesses_slug_unique on public.businesses (lower(slug));

create table public.business_hours (
  business_id uuid not null references public.businesses(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  open_time time,
  close_time time,
  is_closed boolean not null default false,
  primary key (business_id, weekday),
  check (
    is_closed
    or (open_time is not null and close_time is not null and open_time < close_time)
  )
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  duration_minutes integer not null check (duration_minutes between 5 and 1440),
  price_cop integer not null check (price_cop >= 0),
  is_active boolean not null default true,
  unique (business_id, id)
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  is_active boolean not null default true,
  unique (business_id, id)
);

create table public.staff_services (
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id uuid not null,
  service_id uuid not null,
  primary key (business_id, staff_id, service_id),
  foreign key (business_id, staff_id)
    references public.staff(business_id, id) on delete cascade,
  foreign key (business_id, service_id)
    references public.services(business_id, id) on delete cascade
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  phone text not null,
  notes text,
  created_at timestamptz not null default now(),
  unique (business_id, id)
);
create unique index customers_business_phone_unique on public.customers (business_id, phone);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null,
  service_id uuid not null,
  staff_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'confirmada', 'completada', 'cancelada', 'no_asistió')),
  notes text,
  created_at timestamptz not null default now(),
  check (starts_at < ends_at),
  foreign key (business_id, customer_id)
    references public.customers(business_id, id),
  foreign key (business_id, staff_id)
    references public.staff(business_id, id),
  foreign key (business_id, service_id)
    references public.services(business_id, id),
  foreign key (business_id, staff_id, service_id)
    references public.staff_services(business_id, staff_id, service_id),
  exclude using gist (
    business_id with =,
    staff_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status <> 'cancelada')
);
create index appointments_business_start_idx on public.appointments (business_id, starts_at);
create index appointments_business_customer_idx on public.appointments (business_id, customer_id);
create index appointments_business_staff_start_idx
  on public.appointments (business_id, staff_id, starts_at);

create table public.blocked_times (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  check (starts_at < ends_at),
  unique (business_id, id),
  foreign key (business_id, staff_id)
    references public.staff(business_id, id)
);
create index blocked_times_business_start_idx on public.blocked_times (business_id, starts_at);

create table public.public_booking_rate_limits (
  business_id uuid not null references public.businesses(id) on delete cascade,
  ip_hash text not null,
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (business_id, ip_hash, window_start)
);

alter table public.businesses enable row level security;
create policy businesses_owner_all on public.businesses for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'business_hours',
    'services',
    'staff',
    'staff_services',
    'customers',
    'appointments',
    'blocked_times'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (business_id in (select id from public.businesses '
      || 'where owner_id = (select auth.uid()))) '
      || 'with check (business_id in (select id from public.businesses '
      || 'where owner_id = (select auth.uid())))',
      table_name || '_owner_all',
      table_name
    );
  end loop;
end
$$;

alter table public.public_booking_rate_limits enable row level security;
-- Sin políticas intencionalmente: esta tabla solo la administra el servidor.

create or replace function public.is_business_slug_available(candidate text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select candidate is not null
    and candidate ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and not exists (
      select 1 from public.businesses b where lower(b.slug) = lower(candidate)
    );
$$;
revoke all on function public.is_business_slug_available(text) from public;
grant execute on function public.is_business_slug_available(text) to anon, authenticated;

create or replace function public.create_business_onboarding(
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

  insert into public.businesses (
    owner_id, name, slug, type, phone, whatsapp, address, timezone
  ) values (
    auth.uid(), p_name, p_slug, p_type, p_phone, p_whatsapp, p_address, p_timezone
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
revoke all on function public.create_business_onboarding(
  text, text, text, text, text, text, text, text, text, integer, integer, jsonb
) from public;
grant execute on function public.create_business_onboarding(
  text, text, text, text, text, text, text, text, text, integer, integer, jsonb
) to authenticated;

create or replace function public.create_service_for_business(
  p_business_id uuid,
  p_name text,
  p_duration_minutes integer,
  p_price_cop integer
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_service_id uuid;
begin
  if not exists (
    select 1 from public.businesses b
    where b.id = p_business_id and b.owner_id = auth.uid()
  ) then
    raise exception 'No tienes acceso a este negocio' using errcode = '42501';
  end if;

  insert into public.services (business_id, name, duration_minutes, price_cop)
  values (p_business_id, p_name, p_duration_minutes, p_price_cop)
  returning id into new_service_id;

  insert into public.staff_services (business_id, staff_id, service_id)
  select p_business_id, st.id, new_service_id
  from public.staff st
  where st.business_id = p_business_id and st.is_active;

  return new_service_id;
end;
$$;
revoke all on function public.create_service_for_business(uuid, text, integer, integer) from public;
grant execute on function public.create_service_for_business(uuid, text, integer, integer) to authenticated;

create or replace function public.create_staff_for_business(
  p_business_id uuid,
  p_name text,
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

  insert into public.staff (business_id, name)
  values (p_business_id, p_name)
  returning id into new_staff_id;

  insert into public.staff_services (business_id, staff_id, service_id)
  select p_business_id, new_staff_id, service_id
  from unnest(p_service_ids) as selected(service_id);

  return new_staff_id;
end;
$$;
revoke all on function public.create_staff_for_business(uuid, text, uuid[]) from public;
grant execute on function public.create_staff_for_business(uuid, text, uuid[]) to authenticated;

create or replace function public.consume_public_booking_rate_limit(
  p_business_id uuid,
  p_ip_hash text,
  p_window_start timestamptz,
  p_max_requests integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
begin
  insert into public.public_booking_rate_limits (
    business_id, ip_hash, window_start, request_count
  ) values (
    p_business_id, p_ip_hash, p_window_start, 1
  )
  on conflict (business_id, ip_hash, window_start)
  do update set request_count = public.public_booking_rate_limits.request_count + 1
  returning request_count into current_count;

  return current_count <= p_max_requests;
end;
$$;
revoke all on function public.consume_public_booking_rate_limit(uuid, text, timestamptz, integer) from public;
grant execute on function public.consume_public_booking_rate_limit(uuid, text, timestamptz, integer) to service_role;

create or replace function public.create_public_appointment(
  p_business_id uuid,
  p_service_id uuid,
  p_staff_id uuid,
  p_starts_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  business_timezone text;
  service_duration integer;
  appointment_end timestamptz;
  local_start timestamp;
  local_end timestamp;
  working_hours record;
  customer_id uuid;
  appointment_id uuid;
begin
  select b.timezone into business_timezone
  from public.businesses b where b.id = p_business_id;
  if business_timezone is null then
    raise exception 'Negocio no encontrado';
  end if;

  select s.duration_minutes into service_duration
  from public.services s
  where s.id = p_service_id and s.business_id = p_business_id and s.is_active;
  if service_duration is null then
    raise exception 'Servicio no disponible';
  end if;

  if not exists (
    select 1
    from public.staff_services ss
    join public.staff st on st.id = ss.staff_id and st.business_id = ss.business_id
    where ss.business_id = p_business_id
      and ss.staff_id = p_staff_id
      and ss.service_id = p_service_id
      and st.is_active
  ) then
    raise exception 'Profesional no disponible para este servicio';
  end if;

  appointment_end := p_starts_at + make_interval(mins => service_duration);
  if p_starts_at <= now() then
    raise exception 'El horario debe estar en el futuro';
  end if;
  local_start := p_starts_at at time zone business_timezone;
  local_end := appointment_end at time zone business_timezone;
  if local_start::date <> local_end::date then
    raise exception 'El servicio debe terminar el mismo día';
  end if;

  select h.open_time, h.close_time, h.is_closed into working_hours
  from public.business_hours h
  where h.business_id = p_business_id
    and h.weekday = extract(dow from local_start)::smallint;
  if not found or working_hours.is_closed
    or local_start::time < working_hours.open_time
    or local_end::time > working_hours.close_time then
    raise exception 'El horario está fuera del horario de atención';
  end if;

  if exists (
    select 1 from public.blocked_times bt
    where bt.business_id = p_business_id
      and (bt.staff_id is null or bt.staff_id = p_staff_id)
      and tstzrange(bt.starts_at, bt.ends_at, '[)')
        && tstzrange(p_starts_at, appointment_end, '[)')
  ) then
    raise exception 'El horario ya no está disponible';
  end if;

  insert into public.customers (business_id, name, phone)
  values (p_business_id, trim(p_customer_name), p_customer_phone)
  on conflict (business_id, phone) do update set name = excluded.name
  returning id into customer_id;

  insert into public.appointments (
    business_id, customer_id, service_id, staff_id, starts_at, ends_at, notes
  ) values (
    p_business_id, customer_id, p_service_id, p_staff_id,
    p_starts_at, appointment_end, nullif(trim(p_notes), '')
  )
  returning id into appointment_id;

  return appointment_id;
end;
$$;
revoke all on function public.create_public_appointment(
  uuid, uuid, uuid, timestamptz, text, text, text
) from public;
grant execute on function public.create_public_appointment(
  uuid, uuid, uuid, timestamptz, text, text, text
) to service_role;

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on
  public.businesses,
  public.business_hours,
  public.services,
  public.staff,
  public.staff_services,
  public.customers,
  public.appointments,
  public.blocked_times,
  public.public_booking_rate_limits
to anon, authenticated;
grant all privileges on
  public.businesses,
  public.business_hours,
  public.services,
  public.staff,
  public.staff_services,
  public.customers,
  public.appointments,
  public.blocked_times,
  public.public_booking_rate_limits
to service_role;
