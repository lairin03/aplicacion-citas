create table public.plan_feature_catalog (
  plan text primary key check (plan in ('basic', 'professional', 'enterprise')),
  cash_enabled boolean not null default false,
  reports_enabled boolean not null default false,
  customer_history_enabled boolean not null default true,
  benefits jsonb not null default '[]'::jsonb check (jsonb_typeof(benefits) = 'array'),
  updated_at timestamptz not null default now()
);

insert into public.plan_feature_catalog (
  plan, cash_enabled, reports_enabled, customer_history_enabled, benefits
) values
  ('basic', false, false, true, '["Agenda de citas", "Página pública de reservas", "Historial de clientes"]'),
  ('professional', true, true, true, '["Todo lo del plan Básico", "Caja y registro de pagos", "Reportes", "Equipo y horarios por profesional"]'),
  ('enterprise', true, true, true, '["Todo lo del plan Profesional", "Múltiples sedes", "Mayor capacidad de equipo"]')
on conflict (plan) do nothing;

alter table public.plan_feature_catalog enable row level security;
create policy plan_feature_catalog_authenticated_read
  on public.plan_feature_catalog for select to authenticated using (true);
grant select on public.plan_feature_catalog to authenticated;
grant all privileges on public.plan_feature_catalog to service_role;

create table public.business_feature_overrides (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  cash_enabled boolean,
  reports_enabled boolean,
  customer_history_enabled boolean,
  updated_at timestamptz not null default now()
);

alter table public.business_feature_overrides enable row level security;
create policy business_feature_overrides_owner_read
  on public.business_feature_overrides for select to authenticated
  using (
    business_id in (
      select id from public.businesses where owner_id = (select auth.uid())
    )
  );
grant select on public.business_feature_overrides to authenticated;
grant all privileges on public.business_feature_overrides to service_role;

create or replace function public.business_feature_allowed(
  p_business_id uuid,
  p_feature text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_super_admin(auth.uid()) or exists (
    select 1
    from public.businesses b
    join public.business_subscriptions subscription on subscription.owner_id = b.owner_id
    join public.plan_feature_catalog plan on plan.plan = subscription.plan
    left join public.business_feature_overrides override on override.business_id = b.id
    where b.id = p_business_id
      and b.owner_id = auth.uid()
      and (
        (subscription.status = 'trial' and subscription.trial_ends_at > now())
        or (subscription.status = 'active' and subscription.current_period_ends_at > now())
      )
      and case p_feature
        when 'cash' then coalesce(override.cash_enabled, plan.cash_enabled)
        when 'reports' then coalesce(override.reports_enabled, plan.reports_enabled)
        when 'customer_history' then coalesce(override.customer_history_enabled, plan.customer_history_enabled)
        else false
      end
  );
$$;

revoke all on function public.business_feature_allowed(uuid, text) from public, anon;
grant execute on function public.business_feature_allowed(uuid, text) to authenticated, service_role;

drop policy if exists appointment_payments_professional_owner_all on public.appointment_payments;
create policy appointment_payments_feature_owner_all
  on public.appointment_payments for all to authenticated
  using (public.business_feature_allowed(business_id, 'cash'))
  with check (
    created_by = (select auth.uid())
    and public.business_feature_allowed(business_id, 'cash')
  );

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  subject text not null check (length(trim(subject)) between 4 and 160),
  category text not null check (category in ('reservas', 'pagos', 'cuenta', 'tecnico', 'otro')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);

create index support_tickets_business_updated_idx
  on public.support_tickets (business_id, updated_at desc);
create index support_tickets_status_updated_idx
  on public.support_tickets (status, updated_at desc);

create table public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  ticket_id uuid not null,
  author_id uuid not null references auth.users(id),
  author_role text not null check (author_role in ('business', 'admin')),
  body text not null check (length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  foreign key (business_id, ticket_id)
    references public.support_tickets(business_id, id) on delete cascade
);

create index support_ticket_messages_ticket_created_idx
  on public.support_ticket_messages (ticket_id, created_at);

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;

create policy support_tickets_business_read
  on public.support_tickets for select to authenticated
  using (
    business_id in (select id from public.businesses where owner_id = (select auth.uid()))
    or public.is_super_admin((select auth.uid()))
  );

create policy support_ticket_messages_business_read
  on public.support_ticket_messages for select to authenticated
  using (
    business_id in (select id from public.businesses where owner_id = (select auth.uid()))
    or public.is_super_admin((select auth.uid()))
  );

create policy support_tickets_business_insert
  on public.support_tickets for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and business_id in (select id from public.businesses where owner_id = (select auth.uid()))
  );

create policy support_tickets_admin_update
  on public.support_tickets for update to authenticated
  using (public.is_super_admin((select auth.uid())))
  with check (public.is_super_admin((select auth.uid())));

create policy support_tickets_business_update
  on public.support_tickets for update to authenticated
  using (
    business_id in (select id from public.businesses where owner_id = (select auth.uid()))
  )
  with check (
    business_id in (select id from public.businesses where owner_id = (select auth.uid()))
  );

create policy support_ticket_messages_author_insert
  on public.support_ticket_messages for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      (author_role = 'business' and business_id in (
        select id from public.businesses where owner_id = (select auth.uid())
      ) and exists (
        select 1 from public.support_tickets t
        where t.id = support_ticket_messages.ticket_id
          and t.business_id = support_ticket_messages.business_id
          and t.status <> 'resolved'
      ))
      or (author_role = 'admin' and public.is_super_admin((select auth.uid())))
    )
  );

grant select, insert on public.support_tickets, public.support_ticket_messages to authenticated;
grant update (updated_at) on public.support_tickets to authenticated;
grant all privileges on public.support_tickets, public.support_ticket_messages to service_role;

create or replace function public.create_support_ticket(
  p_business_id uuid,
  p_subject text,
  p_category text,
  p_message text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_ticket_id uuid;
begin
  if not exists (
    select 1 from public.businesses b
    where b.id = p_business_id and b.owner_id = auth.uid()
  ) then
    raise exception 'No tienes acceso a este negocio' using errcode = '42501';
  end if;
  if p_subject is null or length(trim(p_subject)) not between 4 and 160
    or p_category not in ('reservas', 'pagos', 'cuenta', 'tecnico', 'otro')
    or p_message is null or length(trim(p_message)) not between 1 and 5000 then
    raise exception 'SUPPORT_TICKET_INVALID' using errcode = '22023';
  end if;

  insert into public.support_tickets (business_id, created_by, subject, category)
  values (p_business_id, auth.uid(), trim(p_subject), p_category)
  returning id into new_ticket_id;

  insert into public.support_ticket_messages (
    business_id, ticket_id, author_id, author_role, body
  ) values (
    p_business_id, new_ticket_id, auth.uid(), 'business', trim(p_message)
  );
  return new_ticket_id;
end;
$$;

revoke all on function public.create_support_ticket(uuid, text, text, text)
  from public, anon;
grant execute on function public.create_support_ticket(uuid, text, text, text)
  to authenticated;

create or replace function public.add_support_ticket_reply(
  p_ticket_id uuid,
  p_body text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ticket_row public.support_tickets%rowtype;
  reply_role text;
begin
  select * into ticket_row
  from public.support_tickets t
  where t.id = p_ticket_id
  for update;
  if not found then
    raise exception 'SUPPORT_TICKET_NOT_FOUND';
  end if;
  if p_body is null or length(trim(p_body)) not between 1 and 5000 then
    raise exception 'SUPPORT_REPLY_INVALID' using errcode = '22023';
  end if;

  if public.is_super_admin(auth.uid()) then
    reply_role := 'admin';
  elsif exists (
    select 1 from public.businesses b
    where b.id = ticket_row.business_id and b.owner_id = auth.uid()
  ) then
    reply_role := 'business';
    if ticket_row.status = 'resolved' then
      raise exception 'SUPPORT_TICKET_RESOLVED';
    end if;
  else
    raise exception 'No tienes acceso a este ticket' using errcode = '42501';
  end if;

  insert into public.support_ticket_messages (
    business_id, ticket_id, author_id, author_role, body
  ) values (
    ticket_row.business_id, ticket_row.id, auth.uid(), reply_role, trim(p_body)
  );

  update public.support_tickets
  set updated_at = now()
  where id = ticket_row.id;
end;
$$;

revoke all on function public.add_support_ticket_reply(uuid, text)
  from public, anon;
grant execute on function public.add_support_ticket_reply(uuid, text)
  to authenticated;

create or replace function public.update_support_ticket_status(
  p_ticket_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if p_status not in ('open', 'in_progress', 'resolved') then
    raise exception 'SUPPORT_TICKET_STATUS_INVALID' using errcode = '22023';
  end if;
  update public.support_tickets
  set status = p_status, updated_at = now()
  where id = p_ticket_id;
  if not found then
    raise exception 'SUPPORT_TICKET_NOT_FOUND';
  end if;
end;
$$;

revoke all on function public.update_support_ticket_status(uuid, text)
  from public, anon;
grant execute on function public.update_support_ticket_status(uuid, text)
  to authenticated;

create or replace function public.prevent_business_slug_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is distinct from old.slug then
    raise exception 'BUSINESS_SLUG_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger businesses_slug_immutable
before update of slug on public.businesses
for each row execute function public.prevent_business_slug_change();

notify pgrst, 'reload schema';
