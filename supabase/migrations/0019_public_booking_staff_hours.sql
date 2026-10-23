create or replace function public.create_public_appointment(
  p_business_id uuid,
  p_service_ids uuid[],
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
  service_count integer;
  appointment_end timestamptz;
  local_start timestamp;
  local_end timestamp;
  working_hours record;
  customer_id uuid;
  appointment_id uuid;
begin
  if p_service_ids is null
    or cardinality(p_service_ids) < 1 then
    raise exception 'Selecciona uno o más servicios';
  end if;

  select b.timezone into business_timezone
  from public.businesses b where b.id = p_business_id;
  if business_timezone is null then
    raise exception 'Negocio no encontrado';
  end if;

  select count(distinct s.id), coalesce(sum(s.duration_minutes), 0)
  into service_count, service_duration
  from public.services s
  where s.id = any(p_service_ids)
    and s.business_id = p_business_id
    and s.is_active;
  if service_count <> cardinality(p_service_ids) then
    raise exception 'Uno o más servicios no están disponibles';
  end if;

  if not exists (
    select 1
    from public.staff st
    where st.business_id = p_business_id
      and st.id = p_staff_id
      and st.is_active
      and not exists (
        select 1
        from unnest(p_service_ids) selected(service_id)
        where not exists (
          select 1
          from public.staff_services ss
          where ss.business_id = p_business_id
            and ss.staff_id = st.id
            and ss.service_id = selected.service_id
            and ss.is_active
        )
      )
  ) then
    raise exception 'Profesional no disponible para todos los servicios';
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
  from public.staff_business_hours h
  where h.business_id = p_business_id
    and h.staff_id = p_staff_id
    and h.weekday = extract(dow from local_start)::smallint;
  if not found or working_hours.is_closed
    or local_start::time < working_hours.open_time
    or local_end::time > working_hours.close_time then
    raise exception 'El horario está fuera del horario del profesional';
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
    p_business_id, customer_id, p_service_ids[1], p_staff_id,
    p_starts_at, appointment_end, nullif(trim(p_notes), '')
  )
  returning id into appointment_id;

  insert into public.appointment_services (business_id, appointment_id, service_id)
  select p_business_id, appointment_id, selected.service_id
  from unnest(p_service_ids) selected(service_id);

  return appointment_id;
end;
$$;

revoke all on function public.create_public_appointment(
  uuid, uuid[], uuid, timestamptz, text, text, text
) from public;
grant execute on function public.create_public_appointment(
  uuid, uuid[], uuid, timestamptz, text, text, text
) to service_role;

notify pgrst, 'reload schema';
