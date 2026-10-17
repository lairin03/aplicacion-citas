create or replace function public.is_super_admin(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = p_owner_id
      and lower(u.email) = 'delaranslairin9@gmail.com'
      and u.email_confirmed_at is not null
  );
$$;

revoke all on function public.is_super_admin(uuid) from public, anon;
grant execute on function public.is_super_admin(uuid) to authenticated, service_role;

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
  if public.is_super_admin(p_owner_id) then
    return;
  end if;

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

  if (subscription.status = 'trial' and coalesce(subscription.trial_ends_at > now(), false))
    or (subscription.status = 'active' and coalesce(subscription.current_period_ends_at > now(), false)) then
    return;
  end if;

  raise exception 'PLAN_EXPIRED: elige un plan para continuar'
    using errcode = '42501';
end;
$$;

revoke all on function public.assert_business_subscription_access(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.assert_business_subscription_access(uuid, boolean)
  to service_role;

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
  if public.is_super_admin(new.owner_id) then
    return new;
  end if;

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
  if public.is_super_admin(business_owner) then
    return new;
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

drop policy if exists appointment_payments_professional_owner_all
  on public.appointment_payments;
create policy appointment_payments_professional_owner_all
  on public.appointment_payments for all to authenticated
  using (
    exists (
      select 1
      from public.businesses b
      where b.id = appointment_payments.business_id
        and b.owner_id = (select auth.uid())
        and (
          public.is_super_admin(b.owner_id)
          or exists (
            select 1 from public.business_subscriptions s
            where s.owner_id = b.owner_id
              and s.plan = 'professional'
              and (
                (s.status = 'trial' and coalesce(s.trial_ends_at > now(), false))
                or (s.status = 'active' and coalesce(s.current_period_ends_at > now(), false))
              )
          )
        )
    )
  )
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from public.businesses b
      where b.id = appointment_payments.business_id
        and b.owner_id = (select auth.uid())
        and (
          public.is_super_admin(b.owner_id)
          or exists (
            select 1 from public.business_subscriptions s
            where s.owner_id = b.owner_id
              and s.plan = 'professional'
              and (
                (s.status = 'trial' and coalesce(s.trial_ends_at > now(), false))
                or (s.status = 'active' and coalesce(s.current_period_ends_at > now(), false))
              )
          )
        )
    )
  );

notify pgrst, 'reload schema';
