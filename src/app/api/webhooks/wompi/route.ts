import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPathValue(value: unknown, path: string): string | number | undefined {
  let current: unknown = value;
  for (const part of path.split(".")) {
    if (!isRecord(current) || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return typeof current === "string" || typeof current === "number" ? current : undefined;
}

function isValidChecksum(candidate: string, expected: string) {
  if (!/^[a-f\d]{64}$/i.test(candidate) || !/^[a-f\d]{64}$/i.test(expected)) return false;
  return timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(expected, "hex"));
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  if (!isRecord(body) || body.event !== "transaction.updated") {
    return NextResponse.json({ received: true });
  }

  const data = body.data;
  const signature = body.signature;
  if (!isRecord(data) || !isRecord(signature)
    || !Array.isArray(signature.properties)
    || !signature.properties.every((property) => typeof property === "string")
    || (typeof body.timestamp !== "number" && typeof body.timestamp !== "string")) {
    return NextResponse.json({ error: "Evento Wompi incompleto." }, { status: 400 });
  }

  const eventSecret = process.env.WOMPI_EVENTS_SECRET;
  if (!eventSecret) {
    console.error("Falta WOMPI_EVENTS_SECRET para validar los eventos de pago.");
    return NextResponse.json({ error: "Webhook no configurado." }, { status: 503 });
  }

  const suppliedChecksum = request.headers.get("x-event-checksum") ?? signature.checksum;
  if (typeof suppliedChecksum !== "string") {
    return NextResponse.json({ error: "Firma Wompi ausente." }, { status: 401 });
  }

  const propertyValues: string[] = [];
  for (const property of signature.properties) {
    const value = getPathValue(data, property);
    if (value === undefined) {
      return NextResponse.json({ error: "Propiedad de firma Wompi inválida." }, { status: 400 });
    }
    propertyValues.push(String(value));
  }
  const expectedChecksum = createHash("sha256")
    .update(`${propertyValues.join("")}${body.timestamp}${eventSecret}`)
    .digest("hex");
  if (!isValidChecksum(suppliedChecksum, expectedChecksum)) {
    return NextResponse.json({ error: "Firma Wompi inválida." }, { status: 401 });
  }

  const transaction = data.transaction;
  if (!isRecord(transaction)
    || typeof transaction.reference !== "string"
    || typeof transaction.id !== "string"
    || typeof transaction.status !== "string"
    || typeof transaction.amount_in_cents !== "number"
    || typeof transaction.currency !== "string") {
    return NextResponse.json({ error: "Transacción Wompi incompleta." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: payment, error: paymentError } = await admin
    .from("billing_payment_intents")
    .select("reference, amount_in_cents, currency, status")
    .eq("reference", transaction.reference)
    .maybeSingle();
  if (paymentError) {
    console.error("No se pudo consultar el pago recibido de Wompi.", paymentError);
    return NextResponse.json({ error: "No se pudo consultar el pago." }, { status: 500 });
  }
  if (!payment) return NextResponse.json({ received: true });

  if (payment.amount_in_cents !== transaction.amount_in_cents
    || payment.currency !== transaction.currency) {
    console.error("Monto o moneda de pago Wompi no coinciden con la intención.", {
      reference: transaction.reference,
      transactionId: transaction.id,
    });
    return NextResponse.json({ error: "Monto o moneda no coinciden." }, { status: 400 });
  }

  if (transaction.status === "APPROVED") {
    const { data: activated, error: activationError } = await admin.rpc(
      "activate_wompi_manual_payment",
      {
        p_reference: transaction.reference,
        p_transaction_id: transaction.id,
        p_amount_in_cents: transaction.amount_in_cents,
        p_currency: transaction.currency,
      },
    );
    if (activationError || !activated) {
      console.error("No se pudo activar el plan tras el pago aprobado de Wompi.", {
        reference: transaction.reference,
        transactionId: transaction.id,
        error: activationError,
      });
      return NextResponse.json({ error: "No se pudo activar el plan." }, { status: 500 });
    }
  } else if (["DECLINED", "ERROR", "VOIDED"].includes(transaction.status)
    && payment.status === "pending") {
    const { error: failedPaymentError } = await admin.from("billing_payment_intents")
      .update({ status: "failed", transaction_id: transaction.id, processed_at: new Date().toISOString() })
      .eq("reference", transaction.reference)
      .eq("status", "pending");
    if (failedPaymentError) {
      console.error("No se pudo guardar el resultado fallido de Wompi.", failedPaymentError);
      return NextResponse.json({ error: "No se pudo guardar el resultado del pago." }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}
