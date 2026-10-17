do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_business_staff_fk'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_business_staff_fk
      foreign key (business_id, staff_id)
      references public.staff(business_id, id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_business_service_fk'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_business_service_fk
      foreign key (business_id, service_id)
      references public.services(business_id, id);
  end if;
end
$$;

notify pgrst, 'reload schema';
