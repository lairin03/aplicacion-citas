import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";

const requiredVariables = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TENANT_TEST_A_EMAIL",
  "TENANT_TEST_A_PASSWORD",
  "TENANT_TEST_B_EMAIL",
  "TENANT_TEST_B_PASSWORD",
];

test("un negocio no puede leer ni escribir los datos de otro", async () => {
  const missing = requiredVariables.filter((key) => !process.env[key]);
  assert.equal(
    missing.length,
    0,
    `Configura estas variables para ejecutar la prueba: ${missing.join(", ")}`,
  );

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const client = (key) => createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const ownerA = client(anonKey);
  const ownerB = client(anonKey);
  const admin = client(process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { error: authAError } = await ownerA.auth.signInWithPassword({
    email: process.env.TENANT_TEST_A_EMAIL,
    password: process.env.TENANT_TEST_A_PASSWORD,
  });
  const { error: authBError } = await ownerB.auth.signInWithPassword({
    email: process.env.TENANT_TEST_B_EMAIL,
    password: process.env.TENANT_TEST_B_PASSWORD,
  });
  assert.ifError(authAError);
  assert.ifError(authBError);

  const { data: businessA, error: businessAError } = await ownerA.from("businesses")
    .select("id").single();
  const { data: businessB, error: businessBError } = await ownerB.from("businesses")
    .select("id").single();
  assert.ifError(businessAError);
  assert.ifError(businessBError);
  assert.notEqual(businessA.id, businessB.id, "Las cuentas de prueba deben pertenecer a negocios distintos.");

  const created = {
    serviceId: null,
    staffId: null,
    customerId: null,
    appointmentId: null,
    blockedTimeId: null,
    rateWindow: null,
    rateHash: null,
  };
  try {
    const unique = `${Date.now()}`;
    const { data: service, error: serviceError } = await ownerB.from("services").insert({
      business_id: businessB.id,
      name: `Prueba aislamiento ${unique}`,
      duration_minutes: 30,
      price_cop: 0,
    }).select("id").single();
    assert.ifError(serviceError);
    created.serviceId = service.id;

    const { data: staff, error: staffError } = await ownerB.from("staff").insert({
      business_id: businessB.id,
      name: `Profesional prueba ${unique}`,
    }).select("id").single();
    assert.ifError(staffError);
    created.staffId = staff.id;

    const { error: relationError } = await ownerB.from("staff_services").insert({
      business_id: businessB.id,
      staff_id: staff.id,
      service_id: service.id,
    });
    assert.ifError(relationError);

    const { data: customer, error: customerError } = await ownerB.from("customers").insert({
      business_id: businessB.id,
      name: `Cliente prueba ${unique}`,
      phone: `+1555${unique}`,
    }).select("id").single();
    assert.ifError(customerError);
    created.customerId = customer.id;

    const startsAt = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);
    startsAt.setSeconds(0, 0);
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
    const { data: appointment, error: appointmentError } = await ownerB.from("appointments").insert({
      business_id: businessB.id,
      customer_id: customer.id,
      service_id: service.id,
      staff_id: staff.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: "pendiente",
    }).select("id").single();
    assert.ifError(appointmentError);
    created.appointmentId = appointment.id;

    const { data: blockedTime, error: blockedError } = await ownerB.from("blocked_times").insert({
      business_id: businessB.id,
      staff_id: staff.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      reason: `Prueba ${unique}`,
    }).select("id").single();
    assert.ifError(blockedError);
    created.blockedTimeId = blockedTime.id;

    const { data: ownHours, error: hoursError } = await ownerB.from("business_hours")
      .select("weekday").eq("business_id", businessB.id).limit(1);
    assert.ifError(hoursError);
    assert.ok(ownHours.length > 0, "El negocio B debe tener al menos un horario de atención.");

    const rateWindow = new Date(Math.floor(Date.now() / 900_000) * 900_000).toISOString();
    const rateHash = `tenant-test-${unique}`;
    created.rateWindow = rateWindow;
    created.rateHash = rateHash;
    const { error: rateLimitError } = await admin.from("public_booking_rate_limits").insert({
      business_id: businessB.id,
      ip_hash: rateHash,
      window_start: rateWindow,
      request_count: 1,
    });
    assert.ifError(rateLimitError);

    const isolatedTables = [
      "business_hours",
      "services",
      "staff",
      "staff_services",
      "customers",
      "appointments",
      "blocked_times",
      "public_booking_rate_limits",
    ];
    for (const table of isolatedTables) {
      const { data, error } = await ownerA.from(table).select("business_id")
        .eq("business_id", businessB.id);
      assert.ifError(error);
      assert.deepEqual(data, [], `El negocio A pudo leer filas de ${table} del negocio B.`);
    }

    const { data: foreignBusiness, error: foreignBusinessError } = await ownerA.from("businesses")
      .select("id").eq("id", businessB.id);
    assert.ifError(foreignBusinessError);
    assert.deepEqual(foreignBusiness, [], "El negocio A pudo leer el negocio B.");

    const { data: ownService, error: ownServiceError } = await ownerB.from("services")
      .select("id").eq("id", service.id).single();
    assert.ifError(ownServiceError);
    assert.equal(ownService.id, service.id, "El negocio B debe poder leer sus propios datos.");

    const { error: foreignWriteError } = await ownerA.from("services").insert({
      business_id: businessB.id,
      name: `Escritura cruzada ${unique}`,
      duration_minutes: 30,
      price_cop: 0,
    });
    assert.ok(foreignWriteError, "RLS debió rechazar la escritura del negocio A en el negocio B.");

    const { error: overlapError } = await ownerB.from("appointments").insert({
      business_id: businessB.id,
      customer_id: customer.id,
      service_id: service.id,
      staff_id: staff.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: "confirmada",
    });
    assert.equal(overlapError?.code, "23P01", "La base debe rechazar citas superpuestas del mismo profesional.");
  } finally {
    if (created.appointmentId) await ownerB.from("appointments").delete().eq("id", created.appointmentId);
    if (created.blockedTimeId) await ownerB.from("blocked_times").delete().eq("id", created.blockedTimeId);
    if (created.customerId) await ownerB.from("customers").delete().eq("id", created.customerId);
    if (created.staffId) {
      await ownerB.from("staff_services").delete().eq("staff_id", created.staffId);
      await ownerB.from("staff").delete().eq("id", created.staffId);
    }
    if (created.serviceId) await ownerB.from("services").delete().eq("id", created.serviceId);
    if (created.rateWindow) {
      await admin.from("public_booking_rate_limits").delete()
        .eq("business_id", businessB.id)
        .eq("window_start", created.rateWindow)
        .eq("ip_hash", created.rateHash);
    }
    await ownerA.auth.signOut();
    await ownerB.auth.signOut();
  }
});
