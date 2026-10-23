create or replace function public.enforce_subscription_booking_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  business_owner uuid;
  subscription public.business_subscriptions%rowtype;
begin
  if new.status = 'cancelada' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'cancelada' then
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

  select s.* into subscription
  from public.business_subscriptions s
  where s.owner_id = business_owner;

  if not found or subscription.status not in ('active', 'trial')
    or (subscription.status = 'trial' and (subscription.trial_ends_at is null or subscription.trial_ends_at <= now()))
    or (subscription.status = 'active' and (subscription.current_period_ends_at is null or subscription.current_period_ends_at <= now())) then
    raise exception 'PLAN_EXPIRED: el negocio debe activar un plan para recibir nuevas reservas'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
