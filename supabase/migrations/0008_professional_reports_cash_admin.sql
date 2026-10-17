alter table public.business_subscriptions
  add column if not exists staff_limit_override integer
    check (staff_limit_override is null or staff_limit_override >= 0),
  add column if not exists location_limit_override integer
    check (location_limit_override is null or location_limit_override >= 0);

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.business_subscriptions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%enterprise_location_limit%'
      and pg_get_constraintdef(oid) like '%enterprise_staff_limit%'
  loop
    execute format(
      'alter table public.business_subscriptions drop constraint %I',
      constraint_name
    );
  end loop;
end
$$;

alter table public.business_subscriptions
  add constraint business_subscriptions_enterprise_limits_check
  check (
    plan <> 'enterprise'
    or (
      enterprise_location_limit is not null and enterprise_location_limit >= 0
      and enterprise_staff_limit is not null and enterprise_staff_limit >= 0
    )
  );

create table public.appointment_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  appointment_id uuid not null,
  created_by uuid not null references auth.users(id),
  amount_cop integer not null check (amount_cop > 0),
  method text not null check (method in ('cash', 'card', 'transfer', 'other')),
  status text not null default 'paid'
    check (status in ('paid', 'pending', 'refunded')),
  payment_date date not null default current_date,
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(),
  foreign key (business_id, appointment_id)
    references public.appointments(business_id, id) on delete cascade
);

create index appointment_payments_business_date_idx
  on public.appointment_payments(business_id, payment_date desc);
create index appointment_payments_appointment_idx
  on public.appointment_payments(appointment_id, created_at desc);

alter table public.appointment_payments enable row level security;
create policy appointment_payments_professional_owner_all
  on public.appointment_payments for all to authenticated
  using (
    exists (
      select 1
      from public.businesses b
      join public.business_subscriptions s on s.owner_id = b.owner_id
      where b.id = appointment_payments.business_id
        and b.owner_id = (select auth.uid())
        and s.plan = 'professional'
        and (
          (s.status = 'trial' and s.trial_ends_at > now())
          or (s.status = 'active' and s.current_period_ends_at > now())
        )
    )
  )
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from public.businesses b
      join public.business_subscriptions s on s.owner_id = b.owner_id
      where b.id = appointment_payments.business_id
        and b.owner_id = (select auth.uid())
        and s.plan = 'professional'
        and (
          (s.status = 'trial' and s.trial_ends_at > now())
          or (s.status = 'active' and s.current_period_ends_at > now())
        )
    )
  );
grant select, insert, update, delete on public.appointment_payments to authenticated;
grant all privileges on public.appointment_payments to service_role;

create or replace function public.enforce_business_location_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  subscription public.business_subscriptions%rowtype;
  location_count integer;
  location_limit integer;
  has_subscription boolean;
begin
  perform pg_advisory_xact_lock(hashtext(new.owner_id::text));
  select * into subscription
  from public.business_subscriptions s
  where s.owner_id = new.owner_id
  for update;
  has_subscription := found;

  select count(*) into location_count
  from public.businesses b
  where b.owner_id = new.owner_id;

  if not has_subscription and location_count = 0 then
    return new;
  end if;

  if not has_subscription then
    raise exception 'PLAN_LIMIT_LOCATIONS: activa un plan para agregar sedes'
      using errcode = '42501';
  end if;

  if not (
    (subscription.status = 'trial' and coalesce(subscription.trial_ends_at > now(), false))
    or (subscription.status = 'active' and coalesce(subscription.current_period_ends_at > now(), false))
  ) then
    raise exception 'PLAN_LIMIT_LOCATIONS: activa un plan para agregar sedes'
      using errcode = '42501';
  end if;

  location_limit := case
    when subscription.location_limit_override is not null then subscription.location_limit_override
    when subscription.plan = 'enterprise' then subscription.enterprise_location_limit
    else 1
  end;

  if location_limit > 0 and location_count >= location_limit then
    raise exception 'PLAN_LIMIT_LOCATIONS: alcanzaste el máximo de sedes de tu plan'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_subscription_staff_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  business_owner uuid;
  subscription public.business_subscriptions%rowtype;
  staff_count integer;
  staff_limit integer;
begin
  if not new.is_active then
    return new;
  end if;
  select b.owner_id into business_owner
  from public.businesses b
  where b.id = new.business_id;
  if business_owner is null then
    raise exception 'Negocio no encontrado' using errcode = '23503';
  end if;
  perform pg_advisory_xact_lock(hashtext(business_owner::text));
  select * into subscription
  from public.business_subscriptions s
  where s.owner_id = business_owner
  for update;
  if not found or not (
    (subscription.status = 'active' and coalesce(subscription.current_period_ends_at > now(), false))
    or (subscription.status = 'trial' and coalesce(subscription.trial_ends_at > now(), false))
  ) then
    raise exception 'PLAN_EXPIRED: el período de prueba terminó; elige un plan'
      using errcode = '42501';
  end if;

  staff_limit := case
    when subscription.staff_limit_override is not null then subscription.staff_limit_override
    when subscription.plan = 'basic' then 1
    when subscription.plan = 'professional' then 5
    when subscription.plan = 'enterprise' then subscription.enterprise_staff_limit
  end;

  if tg_op = 'UPDATE' then
    select count(*) into staff_count
    from public.staff s
    join public.businesses b on b.id = s.business_id
    where b.owner_id = business_owner and s.is_active and s.id <> old.id;
  else
    select count(*) into staff_count
    from public.staff s
    join public.businesses b on b.id = s.business_id
    where b.owner_id = business_owner and s.is_active;
  end if;

  if staff_limit > 0 and staff_count >= staff_limit then
    raise exception 'PLAN_LIMIT_STAFF: tu plan permite hasta % profesionales activos', staff_limit
      using errcode = '42501';
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
