import assert from "node:assert/strict";
import { test } from "node:test";
import { neon } from "@neondatabase/serverless";

const verificationSql = `
do $verification$
declare
  owner_a uuid := current_setting('laii_test.owner_a')::uuid;
  owner_b uuid := current_setting('laii_test.owner_b')::uuid;
  business_a uuid;
  business_b uuid;
  professional uuid;
  offering uuid;
  appointment uuid;
  starts_at timestamptz;
  table_name text;
  leaked boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_b)::text, true);

  select id into strict business_b from public.businesses where owner_id = owner_b;
  select st.id, s.id, (
    (date_trunc('week', now() at time zone b.timezone)::date + 7 + ((h.weekday + 6) % 7))
    + h.open_time
  ) at time zone b.timezone
  into strict professional, offering, starts_at
  from public.businesses b
  join public.staff st on st.business_id = b.id and st.is_active and st.email is not null
  join public.staff_services ss on ss.staff_id = st.id and ss.business_id = b.id and ss.is_active
  join public.services s on s.id = ss.service_id and s.is_active
  join public.staff_business_hours h on h.staff_id = st.id and h.business_id = b.id and not h.is_closed
  where b.id = business_b and h.close_time - h.open_time >= make_interval(mins => s.duration_minutes)
  order by h.weekday, st.id, s.id
  limit 1;

  reset role;
  set local role service_role;
  perform set_config('request.jwt.claims', '{}', true);
  assert (select count(*) from public.plan_feature_catalog) = 3, 'El servidor debe leer los tres planes';
  assert exists (select 1 from public.staff_business_hours where staff_id = professional),
    'El servidor debe leer el horario del profesional';

  appointment := public.create_public_appointment(
    p_business_id => business_b,
    p_service_ids => array[offering],
    p_staff_id => professional,
    p_starts_at => starts_at,
    p_customer_name => 'Cliente prueba de aislamiento',
    p_customer_phone => '+570000000000',
    p_notes => null
  );
  assert appointment is not null, 'La reserva pública debe crear una cita';
  begin
    perform public.create_public_appointment(
      business_b, array[offering], professional, starts_at,
      'Cliente prueba de solapamiento', '+570000000001', null
    );
    raise exception 'La base permitió una cita solapada';
  exception when exclusion_violation then
    null;
  end;

  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_b)::text, true);
  assert exists (select 1 from public.appointments where id = appointment),
    'El propietario debe poder leer la reserva';

  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_a)::text, true);
  select id into strict business_a from public.businesses where owner_id = owner_a;
  assert business_a <> business_b, 'Las cuentas de prueba deben pertenecer a negocios distintos';
  assert not exists (select 1 from public.businesses where id = business_b),
    'El propietario A pudo leer el negocio B';

  foreach table_name in array array[
    'business_hours', 'services', 'staff', 'staff_services', 'customers', 'appointments',
    'blocked_times', 'staff_business_hours', 'appointment_services', 'business_logos'
  ] loop
    execute format('select exists (select 1 from public.%I where business_id = $1)', table_name)
      into leaked using business_b;
    assert not leaked, 'El propietario A pudo leer filas ajenas en ' || table_name;
  end loop;

  begin
    insert into public.services (business_id, name, duration_minutes, price_cop)
    values (business_b, 'Escritura fuera del negocio', 30, 0);
    raise exception 'La base permitió una escritura fuera del negocio';
  exception when insufficient_privilege then
    null;
  end;

  -- An exception rolls back every fixture within the Neon transaction.
  raise exception 'LAII_TENANT_TEST_PASSED';
end
$verification$;
`;

test("la reserva pública funciona y cada negocio conserva el aislamiento", async () => {
  const { DATABASE_URL, TENANT_TEST_A_ID, TENANT_TEST_B_ID } = process.env;
  assert.ok(DATABASE_URL && TENANT_TEST_A_ID && TENANT_TEST_B_ID,
    "Configura DATABASE_URL, TENANT_TEST_A_ID y TENANT_TEST_B_ID en una rama de pruebas.");
  assert.notEqual(TENANT_TEST_A_ID, TENANT_TEST_B_ID);
  const sql = neon(DATABASE_URL);
  await assert.rejects(
    sql.transaction([
      sql`select set_config('laii_test.owner_a', ${TENANT_TEST_A_ID}, true),
                 set_config('laii_test.owner_b', ${TENANT_TEST_B_ID}, true)`,
      sql.query(verificationSql),
    ]),
    { code: "P0001", message: "LAII_TENANT_TEST_PASSED" },
  );
});
