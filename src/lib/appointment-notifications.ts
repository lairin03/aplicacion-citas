import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { es } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export async function sendAppointmentApprovalEmail(input: {
  recipientEmail: string;
  appointmentId: string;
  businessName: string;
  customerName: string;
  customerPhone: string;
  staffName: string;
  serviceNames: string[];
  startsAt: string;
  timezone: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATION_FROM_EMAIL;
  const appUrl = process.env.APP_URL;
  if (!apiKey || !from || !appUrl) {
    throw new Error("Faltan RESEND_API_KEY, NOTIFICATION_FROM_EMAIL o APP_URL.");
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const admin = createAdminClient();
  const { error: tokenError } = await admin.from("appointment_decision_tokens").insert({
    appointment_id: input.appointmentId,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
  if (tokenError) {
    console.error("No se pudo guardar el token de aprobación de la cita.", {
      code: tokenError.code,
      message: tokenError.message,
      appointmentId: input.appointmentId,
    });
    throw new Error("No se pudo preparar la aprobación por correo.");
  }

  const decisionUrl = new URL("/appointment-decision", appUrl);
  decisionUrl.searchParams.set("token", token);
  const formattedDate = formatInTimeZone(
    new Date(input.startsAt),
    input.timezone,
    "EEEE d 'de' MMMM, HH:mm",
    { locale: es },
  );
  const safe = {
    businessName: escapeHtml(input.businessName),
    customerName: escapeHtml(input.customerName),
    customerPhone: escapeHtml(input.customerPhone),
    staffName: escapeHtml(input.staffName),
    services: escapeHtml(input.serviceNames.join(", ")),
    formattedDate: escapeHtml(formattedDate),
  };

  const { error: sendError } = await (async () => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.recipientEmail],
        subject: `Nueva solicitud de cita para ${input.businessName}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#0f172a">
          <h1>Nueva solicitud de cita</h1>
          <p><strong>${safe.customerName}</strong> solicita una cita en <strong>${safe.businessName}</strong>.</p>
          <ul>
            <li>Fecha y hora: ${safe.formattedDate}</li>
            <li>Servicio(s): ${safe.services}</li>
            <li>Profesional: ${safe.staffName}</li>
            <li>Celular de la cliente: ${safe.customerPhone}</li>
          </ul>
          <p>Este enlace vence en 24 horas y solo puede usarse una vez.</p>
          <p><a href="${escapeHtml(`${decisionUrl.toString()}&decision=confirmada`)}" style="display:inline-block;background:#0284c7;color:#fff;padding:14px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Aceptar cita</a></p>
          <p><a href="${escapeHtml(`${decisionUrl.toString()}&decision=cancelada`)}" style="color:#b91c1c">Rechazar cita</a></p>
        </div>`,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      return { error: new Error(`El proveedor de correo respondió ${response.status}: ${body.slice(0, 300)}`) };
    }
    return { error: null };
  })();

  if (sendError) {
    console.error("No se pudo enviar el correo de aprobación de la cita.", {
      appointmentId: input.appointmentId,
      message: sendError.message,
    });
    throw new Error("No se pudo enviar el correo de aprobación.");
  }
}

const whapiResponseSchema = z.object({
  sent: z.boolean().optional(),
  message: z.object({ id: z.string().optional() }).optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});

export async function sendAppointmentDecisionWhatsApp(input: {
  appointmentId: string;
  customerPhone: string;
  customerName: string;
  businessName: string;
  staffName: string;
  serviceNames: string[];
  startsAt: string;
  timezone: string;
  decision: "confirmada" | "cancelada";
}) {
  const admin = createAdminClient();
  const attempts = await admin.from("appointment_whatsapp_deliveries")
    .select("attempts").eq("appointment_id", input.appointmentId).maybeSingle();
  if (attempts.error) throw new Error("No se pudo consultar el estado del WhatsApp.");
  const nextAttempt = (attempts.data?.attempts ?? 0) + 1;
  const apiUrl = process.env.WHAPI_API_URL;
  const accessToken = process.env.WHAPI_TOKEN;
  let messageId: string | null = null;
  let deliveryError: string | null = null;

  if (!accessToken || !apiUrl) {
    deliveryError = "Faltan WHAPI_API_URL o WHAPI_TOKEN.";
  } else {
    const customerDigits = input.customerPhone.replace(/\D/g, "");
    const customerPhone = customerDigits.length === 10 ? `57${customerDigits}` : customerDigits;
    const localDateTime = formatInTimeZone(
      new Date(input.startsAt),
      input.timezone,
      "dd/MM/yyyy 'a las' HH:mm",
    );
    if (!/^\d{8,15}$/.test(customerPhone)) {
      deliveryError = "El celular de la cliente no tiene un formato internacional válido.";
    }
    try {
      if (deliveryError) throw new Error(deliveryError);
      const endpoint = new URL("/messages/text", apiUrl);
      if (endpoint.protocol !== "https:") throw new Error("WHAPI_API_URL debe usar HTTPS.");
      const messageBody = input.decision === "confirmada"
        ? `Hola ${input.customerName}. Tu cita en ${input.businessName} fue confirmada.\n\nServicio: ${input.serviceNames.join(", ")}\nFecha y hora: ${localDateTime}\nProfesional: ${input.staffName}\n\n¡Te esperamos!`
        : `Hola ${input.customerName}. No fue posible aceptar tu solicitud de cita en ${input.businessName}.\n\nServicio: ${input.serviceNames.join(", ")}\nFecha y hora solicitada: ${localDateTime}\nProfesional: ${input.staffName}\n\nPor favor, elige otro horario o comunícate con el negocio.`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ to: customerPhone, body: messageBody }),
        signal: AbortSignal.timeout(15_000),
      });
      const responseText = await response.text();
      let result: z.infer<typeof whapiResponseSchema> | null = null;
      try {
        result = whapiResponseSchema.parse(JSON.parse(responseText));
      } catch {
        if (response.ok) deliveryError = "Whapi devolvió una respuesta que no se pudo interpretar.";
      }
      if (!response.ok) deliveryError = result?.error?.message ?? `Whapi respondió ${response.status}.`;
      else if (result) {
        messageId = result.message?.id ?? null;
        if (result.sent !== true && !messageId) deliveryError = "Whapi no confirmó el envío del mensaje.";
      }
    } catch (error) {
      deliveryError = error instanceof Error ? error.message : "No se pudo conectar con Whapi.";
    }
  }

  const { error: saveError } = await admin.from("appointment_whatsapp_deliveries").upsert({
    appointment_id: input.appointmentId,
    decision: input.decision,
    status: deliveryError ? "failed" : "sent",
    attempts: nextAttempt,
    provider_message_id: messageId,
    last_error: deliveryError,
    updated_at: new Date().toISOString(),
  });
  if (saveError) {
    console.error("No se pudo guardar el resultado del envío WhatsApp.", {
      appointmentId: input.appointmentId,
      code: saveError.code,
      message: saveError.message,
    });
    throw new Error("No se pudo registrar el resultado del WhatsApp.");
  }

  return { sent: !deliveryError, error: deliveryError };
}
