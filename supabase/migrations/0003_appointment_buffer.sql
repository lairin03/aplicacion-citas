create or replace function public.enforce_appointment_buffer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'cancelada' then
    perform pg_advisory_xact_lock(
      hashtext(new.business_id::text),
      hashtext(new.staff_id::text)
    );

    if exists (
      select 1
      from public.appointments a
      where a.business_id = new.business_id
        and a.staff_id = new.staff_id
        and a.id is distinct from new.id
        and a.status <> 'cancelada'
        and a.starts_at < new.ends_at + interval '5 minutes'
        and a.ends_at + interval '5 minutes' > new.starts_at
    ) then
      raise exception 'El profesional debe tener al menos 5 minutos entre citas.'
        using errcode = '23P01';
    end if;
  end if;

  return new;
end;
$$;

create trigger appointments_enforce_buffer
before insert or update on public.appointments
for each row execute function public.enforce_appointment_buffer();
