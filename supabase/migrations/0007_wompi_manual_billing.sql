create table public.billing_payment_intents (
  reference text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('basic', 'professional')),
  amount_in_cents bigint not null check (amount_in_cents > 0),
  currency text not null default 'COP' check (currency = 'COP'),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'failed')),
  transaction_id text unique,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.billing_payment_intents enable row level security;
revoke all on public.billing_payment_intents from anon, authenticated;
grant all privileges on public.billing_payment_intents to service_role;

create or replace function public.assert_business_subscription_access(
  p_owner_id uuid,
  p_allow_initial_business boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  subscription public.business_subscriptions%rowtype;
begin
  select * into subscription
  from public.business_subscriptions
  where owner_id = p_owner_id;

  if not found then
    if p_allow_initial_business and not exists (
      select 1 from public.businesses where owner_id = p_owner_id
    ) then
      return;
    end if;
    raise exception 'PLAN_EXPIRED: elige un plan para continuar'
      using errcode = '42501';
  end if;

  if subscription.status = 'trial'
    and subscription.trial_ends_at is not null
    and subscription.trial_ends_at > now() then
    return;
  end if;

  if subscription.status = 'active'
    and subscription.current_period_ends_at is not null
    and subscription.current_period_ends_at > now() then
    return;
  end if;

  raise exception 'PLAN_EXPIRED: elige un plan para continuar'
    using errcode = '42501';
end;
$$;

create or replace function public.guard_business_subscription_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_business_subscription_access(new.owner_id, true);
  return new;
end;
$$;

drop trigger if exists businesses_subscription_access_guard on public.businesses;
create trigger businesses_subscription_access_guard
before insert on public.businesses
for each row execute function public.guard_business_subscription_access();

create or replace function public.guard_staff_subscription_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  business_owner uuid;
begin
  if not new.is_active then
    return new;
  end if;

  select owner_id into business_owner
  from public.businesses
  where id = new.business_id;
  if business_owner is null then
    raise exception 'Negocio no encontrado' using errcode = '23503';
  end if;

  perform public.assert_business_subscription_access(business_owner);
  return new;
end;
$$;

drop trigger if exists staff_subscription_access_guard on public.staff;
create trigger staff_subscription_access_guard
before insert or update of is_active on public.staff
for each row execute function public.guard_staff_subscription_access();

create or replace function public.guard_appointment_subscription_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  business_owner uuid;
begin
  if new.status = 'cancelada' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'cancelada' then
    return new;
  end if;

  select owner_id into business_owner
  from public.businesses
  where id = new.business_id;
  if business_owner is null then
    raise exception 'Negocio no encontrado' using errcode = '23503';
  end if;

  perform public.assert_business_subscription_access(business_owner);
  return new;
end;
$$;

drop trigger if exists appointments_subscription_access_guard on public.appointments;
create trigger appointments_subscription_access_guard
before insert or update of status on public.appointments
for each row execute function public.guard_appointment_subscription_access();

create or replace function public.activate_wompi_manual_payment(
  p_reference text,
  p_transaction_id text,
  p_amount_in_cents bigint,
  p_currency text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_intent public.billing_payment_intents%rowtype;
begin
  select * into payment_intent
  from public.billing_payment_intents
  where reference = p_reference
  for update;

  if not found then
    return false;
  end if;

  if payment_intent.amount_in_cents <> p_amount_in_cents
    or payment_intent.currency <> p_currency then
    raise exception 'WOMPI_PAYMENT_AMOUNT_MISMATCH';
  end if;

  if payment_intent.status = 'approved' then
    return payment_intent.transaction_id = p_transaction_id;
  end if;

  if payment_intent.status <> 'pending' then
    return false;
  end if;

  update public.billing_payment_intents
  set status = 'approved',
      transaction_id = p_transaction_id,
      processed_at = now()
  where reference = p_reference;

  update public.business_subscriptions
  set plan = payment_intent.plan,
      status = 'active',
      trial_ends_at = null,
      current_period_ends_at = greatest(
        now(),
        coalesce(current_period_ends_at, now())
      ) + interval '1 month',
      updated_at = now()
  where owner_id = payment_intent.owner_id;

  if not found then
    raise exception 'WOMPI_SUBSCRIPTION_NOT_FOUND';
  end if;

  return true;
end;
$$;

revoke all on function public.activate_wompi_manual_payment(text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.activate_wompi_manual_payment(text, text, bigint, text)
  to service_role;
revoke all on function public.assert_business_subscription_access(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.assert_business_subscription_access(uuid, boolean)
  to service_role;

create index billing_payment_intents_owner_created_idx
  on public.billing_payment_intents(owner_id, created_at desc);

notify pgrst, 'reload schema';
