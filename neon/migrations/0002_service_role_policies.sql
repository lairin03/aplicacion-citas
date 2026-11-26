-- The Neon service role has grants, but it does not bypass RLS.
-- Give only the server-side booking and administrative queries their required access.
begin;

grant select on public.staff_business_hours to authenticated, service_role;
grant execute on function public.is_business_slug_available(text) to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'appointment_decision_tokens', 'appointment_services',
    'appointment_whatsapp_deliveries', 'appointments', 'billing_payment_intents',
    'blocked_times', 'business_feature_overrides', 'business_logos', 'business_subscriptions',
    'businesses', 'customers', 'plan_feature_catalog', 'services', 'staff',
    'staff_business_hours', 'staff_services', 'support_ticket_messages', 'support_tickets'
  ] loop
    execute format('create policy service_read on public.%I for select to service_role using (true)', table_name);
  end loop;

  foreach table_name in array array[
    'appointment_decision_tokens', 'appointment_whatsapp_deliveries',
    'billing_payment_intents', 'business_feature_overrides', 'plan_feature_catalog'
  ] loop
    execute format('create policy service_insert on public.%I for insert to service_role with check (true)', table_name);
  end loop;

  foreach table_name in array array[
    'appointment_whatsapp_deliveries', 'appointments', 'billing_payment_intents',
    'business_feature_overrides', 'business_subscriptions', 'plan_feature_catalog'
  ] loop
    execute format('create policy service_update on public.%I for update to service_role using (true) with check (true)', table_name);
  end loop;
end;
$$;

commit;
