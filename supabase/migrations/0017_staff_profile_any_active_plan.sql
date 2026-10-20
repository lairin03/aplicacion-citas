create or replace function public.update_staff_profile_for_business(
  p_business_id uuid,
  p_staff_id uuid,
  p_name text,
  p_email text,
  p_service_ids uuid[],
  p_hours jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_service_count integer;
  supplied_hour_count integer;
  invalid_hour_count integer;
begin
  if not exists (
    select 1 from public.businesses b
    where b.id = p_business_id and b.owner_id = auth.uid()
  ) then
    raise exception 'No tienes acceso a este negocio' using errcode = '42501';
  end if;

  if not public.is_super_admin(auth.uid()) and not exists (
    select 1
    from public.business_subscriptions subscription
    where subscription.owner_id = auth.uid()
      and (
        (subscription.status = 'trial' and subscription.trial_ends_at > now())
        or (subscription.status = 'active' and subscription.current_period_ends_at > now())
      )
  ) then
    raise exception 'ACTIVE_PLAN_REQUIRED' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.staff st
    where st.id = p_staff_id and st.business_id = p_business_id
  ) then
    raise exception 'STAFF_PROFILE_NOT_FOUND';
  end if;

  if p_name is null or length(trim(p_name)) not between 2 and 120
    or p_email is null or p_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
    or coalesce(cardinality(p_service_ids), 0) = 0 then
    raise exception 'STAFF_PROFILE_INVALID' using errcode = '22023';
  end if;
  if p_hours is null or jsonb_typeof(p_hours) <> 'array' then
    raise exception 'STAFF_HOURS_INVALID' using errcode = '22023';
  end if;
  if jsonb_array_length(p_hours) <> 7 then
    raise exception 'STAFF_HOURS_INVALID' using errcode = '22023';
  end if;

  select count(distinct s.id) into selected_service_count
  from public.services s
  where s.business_id = p_business_id
    and s.is_active
    and s.id = any(p_service_ids);
  if selected_service_count <> cardinality(p_service_ids) then
    raise exception 'STAFF_SERVICE_INVALID' using errcode = '22023';
  end if;

  select count(*), count(*) filter (
    where h.weekday not between 0 and 6
      or (not h.is_closed and (
        h.open_time is null or h.close_time is null or h.open_time >= h.close_time
      ))
  )
  into supplied_hour_count, invalid_hour_count
  from jsonb_to_recordset(p_hours) as h(
    weekday smallint, open_time time, close_time time, is_closed boolean
  );
  if supplied_hour_count <> 7 or invalid_hour_count > 0
    or (select count(distinct h.weekday)
        from jsonb_to_recordset(p_hours) as h(
          weekday smallint, open_time time, close_time time, is_closed boolean
        )) <> 7 then
    raise exception 'STAFF_HOURS_INVALID' using errcode = '22023';
  end if;

  update public.staff
  set name = trim(p_name), email = lower(trim(p_email))
  where id = p_staff_id and business_id = p_business_id;

  update public.staff_services
  set is_active = service_id = any(p_service_ids)
  where business_id = p_business_id and staff_id = p_staff_id;

  insert into public.staff_services (business_id, staff_id, service_id, is_active)
  select p_business_id, p_staff_id, selected.service_id, true
  from unnest(p_service_ids) as selected(service_id)
  on conflict (business_id, staff_id, service_id) do update
    set is_active = true;

  insert into public.staff_business_hours (
    business_id, staff_id, weekday, open_time, close_time, is_closed, is_custom
  )
  select p_business_id, p_staff_id, h.weekday, h.open_time, h.close_time, h.is_closed, true
  from jsonb_to_recordset(p_hours) as h(
    weekday smallint, open_time time, close_time time, is_closed boolean
  )
  on conflict (business_id, staff_id, weekday) do update
    set open_time = excluded.open_time,
        close_time = excluded.close_time,
        is_closed = excluded.is_closed,
        is_custom = true;
end;
$$;

revoke all on function public.update_staff_profile_for_business(
  uuid, uuid, text, text, uuid[], jsonb
) from public, anon;
grant execute on function public.update_staff_profile_for_business(
  uuid, uuid, text, text, uuid[], jsonb
) to authenticated;

notify pgrst, 'reload schema';
