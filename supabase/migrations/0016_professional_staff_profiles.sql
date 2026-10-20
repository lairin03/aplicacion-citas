alter table public.staff_services
  add column is_active boolean not null default true;

create table public.staff_business_hours (
  business_id uuid not null,
  staff_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  open_time time,
  close_time time,
  is_closed boolean not null default false,
  is_custom boolean not null default false,
  primary key (business_id, staff_id, weekday),
  foreign key (business_id, staff_id)
    references public.staff(business_id, id) on delete cascade,
  check (
    is_closed
    or (open_time is not null and close_time is not null and open_time < close_time)
  )
);

alter table public.staff_business_hours enable row level security;
create policy staff_business_hours_owner_all
  on public.staff_business_hours for all to authenticated
  using (
    business_id in (
      select id from public.businesses where owner_id = (select auth.uid())
    )
  )
  with check (
    business_id in (
      select id from public.businesses where owner_id = (select auth.uid())
    )
  );

insert into public.staff_business_hours (
  business_id, staff_id, weekday, open_time, close_time, is_closed
)
select st.business_id, st.id, h.weekday, h.open_time, h.close_time, h.is_closed
from public.staff st
join public.business_hours h on h.business_id = st.business_id
on conflict (business_id, staff_id, weekday) do nothing;

create or replace function public.initialize_staff_business_hours()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.staff_business_hours (
    business_id, staff_id, weekday, open_time, close_time, is_closed
  )
  select new.business_id, new.id, h.weekday, h.open_time, h.close_time, h.is_closed
  from public.business_hours h
  where h.business_id = new.business_id
  on conflict (business_id, staff_id, weekday) do nothing;
  return new;
end;
$$;

revoke all on function public.initialize_staff_business_hours()
  from public, anon, authenticated;

create trigger staff_initialize_business_hours
after insert on public.staff
for each row execute function public.initialize_staff_business_hours();

create or replace function public.sync_default_staff_business_hours()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.staff_business_hours (
    business_id, staff_id, weekday, open_time, close_time, is_closed
  )
  select new.business_id, st.id, new.weekday, new.open_time, new.close_time, new.is_closed
  from public.staff st
  where st.business_id = new.business_id
  on conflict (business_id, staff_id, weekday) do update
    set open_time = excluded.open_time,
        close_time = excluded.close_time,
        is_closed = excluded.is_closed
    where not public.staff_business_hours.is_custom;
  return new;
end;
$$;

revoke all on function public.sync_default_staff_business_hours()
  from public, anon, authenticated;

create trigger business_hours_sync_default_staff
after insert or update on public.business_hours
for each row execute function public.sync_default_staff_business_hours();

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
