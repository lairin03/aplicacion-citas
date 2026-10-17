alter table public.businesses
  drop constraint if exists businesses_owner_id_key;
create index if not exists businesses_owner_id_idx on public.businesses(owner_id);

create table public.business_subscriptions (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'professional'
    check (plan in ('basic', 'professional', 'enterprise')),
  status text not null default 'trial'
    check (status in ('trial', 'pending_payment', 'active', 'past_due', 'canceled', 'expired')),
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  enterprise_location_limit integer,
  enterprise_staff_limit integer,
  wompi_plan_id text,
  wompi_subscription_id text unique,
  wompi_payment_source_id bigint,
  updated_at timestamptz not null default now(),
  check (
    plan <> 'enterprise'
    or (
      enterprise_location_limit is not null and enterprise_location_limit > 0
      and enterprise_staff_limit is not null and enterprise_staff_limit > 0
    )
  )
);

alter table public.business_subscriptions enable row level security;
create policy business_subscriptions_owner_read on public.business_subscriptions
  for select to authenticated using (owner_id = (select auth.uid()));
grant select on public.business_subscriptions to authenticated;
grant all privileges on public.business_subscriptions to service_role;

insert into public.business_subscriptions (owner_id, plan, status, trial_ends_at)
select distinct owner_id, 'professional', 'trial', now() + interval '5 days'
from public.businesses
on conflict (owner_id) do nothing;

create or replace function public.start_business_trial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.business_subscriptions (owner_id, plan, status, trial_ends_at)
  values (new.owner_id, 'professional', 'trial', now() + interval '5 days')
  on conflict (owner_id) do nothing;
  return new;
end;
$$;

create trigger businesses_start_trial
after insert on public.businesses
for each row execute function public.start_business_trial();

create or replace function public.enforce_business_location_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  subscription public.business_subscriptions%rowtype;
  location_count integer;
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

  if location_count = 0 and not has_subscription then
    return new;
  end if;

  if not has_subscription or subscription.status not in ('active', 'trial')
    or (subscription.status = 'trial' and (subscription.trial_ends_at is null or subscription.trial_ends_at <= now()))
    or (subscription.status = 'active' and (subscription.current_period_ends_at is null or subscription.current_period_ends_at <= now())) then
    raise exception 'PLAN_LIMIT_LOCATIONS: activa un plan para agregar sedes'
      using errcode = '42501';
  end if;

  if subscription.plan <> 'enterprise' then
    raise exception 'PLAN_LIMIT_LOCATIONS: tu plan permite una sede'
      using errcode = '42501';
  end if;

  if location_count >= subscription.enterprise_location_limit then
    raise exception 'PLAN_LIMIT_LOCATIONS: alcanzaste el máximo de sedes de tu contrato'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger businesses_enforce_location_limit
before insert on public.businesses
for each row execute function public.enforce_business_location_limit();

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

  if not found or subscription.status not in ('active', 'trial')
    or (subscription.status = 'trial' and (subscription.trial_ends_at is null or subscription.trial_ends_at <= now()))
    or (subscription.status = 'active' and (subscription.current_period_ends_at is null or subscription.current_period_ends_at <= now())) then
    raise exception 'PLAN_EXPIRED: el período de prueba terminó; elige un plan'
      using errcode = '42501';
  end if;

  staff_limit := case subscription.plan
    when 'basic' then 1
    when 'professional' then 5
    when 'enterprise' then subscription.enterprise_staff_limit
  end;

  if tg_op = 'UPDATE' then
    select count(*) into staff_count
    from public.staff s
    join public.businesses b on b.id = s.business_id
    where b.owner_id = business_owner
      and s.is_active
      and s.id <> old.id;
  else
    select count(*) into staff_count
    from public.staff s
    join public.businesses b on b.id = s.business_id
    where b.owner_id = business_owner
      and s.is_active;
  end if;

  if staff_count >= staff_limit then
    raise exception 'PLAN_LIMIT_STAFF: tu plan permite hasta % profesionales activos', staff_limit
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger staff_enforce_subscription_limit
before insert or update of is_active on public.staff
for each row execute function public.enforce_subscription_staff_limit();

create or replace function public.enforce_subscription_booking_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  subscription public.business_subscriptions%rowtype;
begin
  if new.status = 'cancelada' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'cancelada' then
    return new;
  end if;

  select s.* into subscription
  from public.business_subscriptions s
  join public.businesses b on b.owner_id = s.owner_id
  where b.id = new.business_id;

  if not found or subscription.status not in ('active', 'trial')
    or (subscription.status = 'trial' and (subscription.trial_ends_at is null or subscription.trial_ends_at <= now()))
    or (subscription.status = 'active' and (subscription.current_period_ends_at is null or subscription.current_period_ends_at <= now())) then
    raise exception 'PLAN_EXPIRED: el negocio debe activar un plan para recibir nuevas reservas'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger appointments_enforce_subscription
before insert or update of status on public.appointments
for each row execute function public.enforce_subscription_booking_access();

notify pgrst, 'reload schema';
