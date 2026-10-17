alter table public.appointments
  add column customer_whatsapp_consent boolean not null default false;

create table public.appointment_decision_tokens (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  decision text check (decision in ('confirmada', 'cancelada')),
  created_at timestamptz not null default now(),
  check ((used_at is null and decision is null) or (used_at is not null and decision is not null))
);

create index appointment_decision_tokens_appointment_idx
  on public.appointment_decision_tokens(appointment_id);

alter table public.appointment_decision_tokens enable row level security;
revoke all on public.appointment_decision_tokens from public, anon, authenticated;
grant all privileges on public.appointment_decision_tokens to service_role;

create table public.appointment_whatsapp_deliveries (
  appointment_id uuid primary key references public.appointments(id) on delete cascade,
  status text not null check (status in ('queued', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  provider_message_id text,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.appointment_whatsapp_deliveries enable row level security;
revoke all on public.appointment_whatsapp_deliveries from public, anon, authenticated;
grant all privileges on public.appointment_whatsapp_deliveries to service_role;

create or replace function public.expire_stale_appointment_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.appointments
  set status = 'cancelada'
  where business_id = new.business_id
    and status = 'pendiente'
    and created_at <= now() - interval '24 hours';
  return new;
end;
$$;

revoke all on function public.expire_stale_appointment_requests()
  from public, anon, authenticated;

create trigger appointments_expire_stale_requests
before insert on public.appointments
for each row execute function public.expire_stale_appointment_requests();

create or replace function public.process_appointment_decision(
  p_token_hash text,
  p_decision text
)
returns table (appointment_id uuid, result text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  token_row public.appointment_decision_tokens%rowtype;
  updated_appointment_id uuid;
begin
  if p_decision not in ('confirmada', 'cancelada') then
    raise exception 'INVALID_APPOINTMENT_DECISION' using errcode = '22023';
  end if;

  select * into token_row
  from public.appointment_decision_tokens t
  where t.token_hash = p_token_hash
  for update;

  if not found then
    return query select null::uuid, 'invalid'::text;
    return;
  end if;
  if token_row.used_at is not null then
    return query select token_row.appointment_id, 'already_processed'::text;
    return;
  end if;
  if token_row.expires_at <= now() then
    return query select token_row.appointment_id, 'expired'::text;
    return;
  end if;

  update public.appointments a
  set status = p_decision
  where a.id = token_row.appointment_id
    and a.status = 'pendiente'
  returning a.id into updated_appointment_id;

  if updated_appointment_id is null then
    return query select token_row.appointment_id, 'already_processed'::text;
    return;
  end if;

  update public.appointment_decision_tokens
  set used_at = now(), decision = p_decision
  where id = token_row.id;

  if p_decision = 'confirmada' then
    insert into public.appointment_whatsapp_deliveries (appointment_id, status)
    values (token_row.appointment_id, 'queued')
    on conflict (appointment_id) do update
      set status = 'queued', last_error = null, updated_at = now();
  end if;

  return query select token_row.appointment_id, p_decision;
end;
$$;

revoke all on function public.process_appointment_decision(text, text)
  from public, anon, authenticated;
grant execute on function public.process_appointment_decision(text, text)
  to service_role;

notify pgrst, 'reload schema';
