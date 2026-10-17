"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sendAppointmentConfirmationWhatsApp } from "@/lib/appointment-notifications";
import { createAdminClient } from "@/lib/supabase/admin";

export async function processAppointmentDecisionAction(formData: FormData) {
  const token = z.string().regex(/^[a-f0-9]{64}$/).safeParse(formData.get("token"));
  const decision = z.enum(["confirmada", "cancelada"]).safeParse(formData.get("decision"));
  if (!token.success || !decision.success) redirect("/appointment-decision?result=invalid");

  const admin = createAdminClient();
  const tokenHash = createHash("sha256").update(token.data).digest("hex");
  const { data, error } = await admin.rpc("process_appointment_decision", {
    p_token_hash: tokenHash,
    p_decision: decision.data,
  });
  if (error) {
    console.error("No se pudo procesar la decisión de la cita.", {
      code: error.code,
      message: error.message,
    });
    redirect("/appointment-decision?result=error");
  }

  const result = data?.[0];
  if (!result || result.result === "invalid") redirect("/appointment-decision?result=invalid");
  if (result.result === "expired") redirect("/appointment-decision?result=expired");
  if (result.result === "already_processed") redirect("/appointment-decision?result=processed");
  if (decision.data === "cancelada") redirect("/appointment-decision?result=rejected");

  const { data: appointment, error: appointmentError } = await admin.from("appointments")
    .select("id, starts_at, business_id, customer_id, staff_id, customer_whatsapp_consent")
    .eq("id", result.appointment_id)
    .maybeSingle();
  if (appointmentError || !appointment) {
    console.error("La cita fue confirmada pero no se pudo preparar el WhatsApp.", {
      appointmentId: result.appointment_id,
      error: appointmentError,
    });
    redirect("/appointment-decision?result=confirmed-not-sent");
  }
  if (!appointment.customer_whatsapp_consent) {
    const { error: consentDeliveryError } = await admin.from("appointment_whatsapp_deliveries")
      .update({
        status: "failed",
        last_error: "La cliente no autorizó la confirmación por WhatsApp.",
        updated_at: new Date().toISOString(),
      })
      .eq("appointment_id", appointment.id);
    if (consentDeliveryError) {
      console.error("No se pudo guardar la falta de consentimiento de WhatsApp.", consentDeliveryError);
    }
    redirect("/appointment-decision?result=confirmed-not-sent");
  }

  const [{ data: business }, { data: customer }, { data: staff }] = await Promise.all([
    admin.from("businesses").select("name, timezone").eq("id", appointment.business_id).maybeSingle(),
    admin.from("customers").select("name, phone").eq("id", appointment.customer_id).maybeSingle(),
    admin.from("staff").select("name, email").eq("id", appointment.staff_id).maybeSingle(),
  ]);
  if (!business || !customer || !staff) {
    console.error("La cita fue confirmada pero faltan datos para notificar a la cliente.", {
      appointmentId: appointment.id,
    });
    redirect("/appointment-decision?result=confirmed-not-sent");
  }

  let whatsappSent = false;
  try {
    const delivery = await sendAppointmentConfirmationWhatsApp({
      appointmentId: appointment.id,
      customerPhone: customer.phone,
      customerName: customer.name,
      businessName: business.name,
      staffName: staff.name,
      startsAt: appointment.starts_at,
      timezone: business.timezone,
    });
    whatsappSent = delivery.sent;
  } catch (error) {
    console.error("La cita fue confirmada pero el WhatsApp no pudo procesarse.", {
      appointmentId: appointment.id,
      error,
    });
  }
  redirect(whatsappSent
    ? "/appointment-decision?result=confirmed"
    : "/appointment-decision?result=confirmed-not-sent");
}
