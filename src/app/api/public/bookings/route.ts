import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { formatInTimeZone } from "date-fns-tz";
import { sendAppointmentApprovalEmail } from "@/lib/appointment-notifications";
import { findPublicBusiness, getAvailableSlots, isBusinessPlanActive } from "@/lib/public-booking";
import { createAdminClient } from "@/lib/supabase/admin";

const bookingSchema = z.object({
  slug: z.string().min(1).max(120).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  serviceIds: z.array(z.uuid()).min(1),
  staffId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^\+?[\d\s().-]{7,25}$/, "Ingresa un número de celular válido."),
  whatsappConsent: z.literal(true, "Acepta recibir la confirmación de la cita por WhatsApp."),
  notes: z.string().trim().max(500).optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "El contenido de la solicitud no es válido." }, { status: 400 });
  }

  const parsed = bookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Revisa los datos de la reserva." }, { status: 400 });
  }

  try {
    const business = await findPublicBusiness(parsed.data.slug);
    if (!business) return NextResponse.json({ error: "No encontramos este negocio." }, { status: 404 });
    if (!(await isBusinessPlanActive(business.owner_id))) {
      return NextResponse.json({ error: "Este negocio debe activar un plan para recibir nuevas reservas." }, { status: 402 });
    }

    const requestHeaders = await headers();
    const ipAddress = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim()
      || requestHeaders.get("x-real-ip") || "unknown";
    const hashSecret = process.env.APP_RATE_LIMIT_HASH_SECRET;
    if (!hashSecret) {
      console.error("Falta APP_RATE_LIMIT_HASH_SECRET en las variables de entorno del servidor.");
      return NextResponse.json({
        error: "El sistema de reservas no está configurado: falta APP_RATE_LIMIT_HASH_SECRET en el servidor.",
      }, { status: 503 });
    }
    const ipHash = createHmac("sha256", hashSecret).update(ipAddress).digest("hex");
    const windowStart = new Date(Math.floor(Date.now() / 900_000) * 900_000).toISOString();
    const admin = createAdminClient();
    const { data: withinLimit, error: limitError } = await admin.rpc("consume_public_booking_rate_limit", {
      p_business_id: business.id,
      p_ip_hash: ipHash,
      p_window_start: windowStart,
      p_max_requests: 5,
    });
    if (limitError) {
      console.error("Error aplicando el límite de reservas:", limitError);
      return NextResponse.json({ error: "No se pudo validar la solicitud. Intenta más tarde." }, { status: 503 });
    }
    if (!withinLimit) {
      return NextResponse.json({ error: "Has enviado varias solicitudes. Espera unos minutos e inténtalo de nuevo." }, { status: 429 });
    }

    const startsAt = new Date(parsed.data.startsAt);
    const localDate = formatInTimeZone(startsAt, business.timezone, "yyyy-MM-dd");
    const slots = await getAvailableSlots({
      business,
      serviceIds: parsed.data.serviceIds,
      date: localDate,
      staffId: parsed.data.staffId,
    });
    if (!slots.some((slot) => slot.startsAt === startsAt.toISOString() && slot.staffId === parsed.data.staffId)) {
      return NextResponse.json({ error: "Ese horario acaba de ocuparse. Elige otro." }, { status: 409 });
    }

    const normalizedPhone = parsed.data.phone.replace(/[^\d+]/g, "");
    const { data: appointmentId, error: bookingError } = await admin.rpc("create_public_appointment", {
      p_business_id: business.id,
      p_service_ids: parsed.data.serviceIds,
      p_staff_id: parsed.data.staffId,
      p_starts_at: startsAt.toISOString(),
      p_customer_name: parsed.data.name,
      p_customer_phone: normalizedPhone,
      p_notes: parsed.data.notes ?? null,
    });
    if (bookingError) {
      if (bookingError.code === "23P01" || bookingError.message.includes("no disponible")) {
        return NextResponse.json({ error: "Ese horario acaba de ocuparse. Elige otro." }, { status: 409 });
      }
      console.error("Error creando la cita pública:", bookingError);
      return NextResponse.json({ error: "No se pudo confirmar la cita. Intenta de nuevo." }, { status: 500 });
    }

    let approvalEmailSent = false;
    try {
      const { error: consentError } = await admin.from("appointments")
        .update({ customer_whatsapp_consent: parsed.data.whatsappConsent })
        .eq("id", appointmentId);
      if (consentError) throw new Error("No se pudo guardar el consentimiento de WhatsApp.");

      const [{ data: selectedServices, error: servicesError }, { data: selectedStaff, error: selectedStaffError }] = await Promise.all([
        admin.from("services").select("name").eq("business_id", business.id).in("id", parsed.data.serviceIds),
        admin.from("staff").select("name, email")
          .eq("id", parsed.data.staffId).eq("business_id", business.id).maybeSingle(),
      ]);
      if (servicesError || selectedStaffError || !selectedStaff?.email || !selectedServices?.length) {
        throw new Error("No se pudieron consultar los detalles para notificar al profesional.");
      }

      await sendAppointmentApprovalEmail({
        recipientEmail: selectedStaff.email,
        appointmentId,
        businessName: business.name,
        customerName: parsed.data.name,
        customerPhone: normalizedPhone,
        staffName: selectedStaff.name,
        serviceNames: selectedServices.map((service) => service.name),
        startsAt: startsAt.toISOString(),
        timezone: business.timezone,
      });
      approvalEmailSent = true;
    } catch (notificationError) {
      console.error("La cita quedó pendiente, pero no se pudo enviar el correo de aprobación.", {
        appointmentId,
        error: notificationError,
      });
    }

    return NextResponse.json({
      appointmentId,
      startsAt: startsAt.toISOString(),
      approvalEmailSent,
    }, { status: 201 });
  } catch (error) {
    console.error("Error procesando una reserva pública:", error);
    return NextResponse.json({ error: "No se pudo confirmar la cita. Intenta más tarde." }, { status: 500 });
  }
}
