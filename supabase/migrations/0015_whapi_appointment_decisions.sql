alter table public.appointment_whatsapp_deliveries
  add column decision text check (decision in ('confirmada', 'cancelada'));

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

  insert into public.appointment_whatsapp_deliveries (
    appointment_id, decision, status
  ) values (
    token_row.appointment_id, p_decision, 'queued'
  )
  on conflict on constraint appointment_whatsapp_deliveries_pkey do update
    set decision = excluded.decision,
        status = 'queued',
        provider_message_id = null,
        last_error = null,
        updated_at = now();

  return query select token_row.appointment_id, p_decision;
end;
$$;

revoke all on function public.process_appointment_decision(text, text)
  from public, anon, authenticated;
grant execute on function public.process_appointment_decision(text, text)
  to service_role;

notify pgrst, 'reload schema';
