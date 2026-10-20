"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sendAppointmentDecisionWhatsApp } from "@/lib/appointment-notifications";
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

  const { data: appointment, error: appointmentError } = await admin.from("appointments")
    .select("id, starts_at, business_id, customer_id, staff_id, customer_whatsapp_consent")
    .eq("id", result.appointment_id)
    .maybeSingle();
  if (appointmentError || !appointment) {
    console.error("La decisión fue procesada, pero no se pudieron preparar los datos del WhatsApp.", {
      appointmentId: result.appointment_id,
      error: appointmentError,
    });
    redirect(decision.data === "confirmada"
      ? "/appointment-decision?result=confirmed-not-sent"
      : "/appointment-decision?result=rejected-not-sent");
  }

  if (!appointment.customer_whatsapp_consent) {
    const { error: deliveryError } = await admin.from("appointment_whatsapp_deliveries")
      .update({
        decision: decision.data,
        status: "failed",
        last_error: "La clienta no autorizó notificaciones por WhatsApp.",
        updated_at: new Date().toISOString(),
      })
      .eq("appointment_id", appointment.id);
    if (deliveryError) {
      console.error("No se pudo guardar la falta de consentimiento de WhatsApp.", {
        appointmentId: appointment.id,
        error: deliveryError,
      });
    }
    redirect(decision.data === "confirmada"
      ? "/appointment-decision?result=confirmed-not-sent"
      : "/appointment-decision?result=rejected-not-sent");
  }

  const [
    { data: business, error: businessError },
    { data: customer, error: customerError },
    { data: staff, error: staffError },
    { data: appointmentServices, error: appointmentServicesError },
  ] = await Promise.all([
    admin.from("businesses").select("name, timezone").eq("id", appointment.business_id).maybeSingle(),
    admin.from("customers").select("name, phone").eq("id", appointment.customer_id).maybeSingle(),
    admin.from("staff").select("name").eq("id", appointment.staff_id).maybeSingle(),
    admin.from("appointment_services").select("service_id").eq("appointment_id", appointment.id),
  ]);
  const serviceIds = appointmentServices?.map((entry) => entry.service_id) ?? [];
  const { data: services, error: servicesError } = serviceIds.length
    ? await admin.from("services").select("name").in("id", serviceIds)
    : { data: [], error: null };

  if (businessError || customerError || staffError || appointmentServicesError || servicesError
    || !business || !customer || !staff || !services?.length) {
    console.error("La decisión fue procesada, pero faltan datos para notificar a la clienta.", {
      appointmentId: appointment.id,
      errors: [businessError, customerError, staffError, appointmentServicesError, servicesError].filter(Boolean),
    });
    redirect(decision.data === "confirmada"
      ? "/appointment-decision?result=confirmed-not-sent"
      : "/appointment-decision?result=rejected-not-sent");
  }

  let whatsappSent = false;
  try {
    const delivery = await sendAppointmentDecisionWhatsApp({
      appointmentId: appointment.id,
      customerPhone: customer.phone,
      customerName: customer.name,
      businessName: business.name,
      staffName: staff.name,
      serviceNames: services.map((service) => service.name),
      startsAt: appointment.starts_at,
      timezone: business.timezone,
      decision: decision.data,
    });
    whatsappSent = delivery.sent;
  } catch (error) {
    console.error("La decisión fue procesada, pero el WhatsApp no pudo enviarse.", {
      appointmentId: appointment.id,
      error,
    });
  }

  redirect(decision.data === "confirmada"
    ? whatsappSent
      ? "/appointment-decision?result=confirmed"
      : "/appointment-decision?result=confirmed-not-sent"
    : whatsappSent
      ? "/appointment-decision?result=rejected"
      : "/appointment-decision?result=rejected-not-sent");
}
