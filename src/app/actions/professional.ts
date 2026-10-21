"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getProfessionalContext } from "@/lib/professional-access";

const paymentSchema = z.object({
  appointmentId: z.uuid(),
  amount: z.coerce.number().int().min(1).max(2_000_000_000),
  method: z.enum(["cash", "card", "transfer", "other"]),
  status: z.enum(["paid", "pending", "refunded"]),
  paymentDate: z.iso.date(),
  note: z.string().trim().max(300),
});

const paymentStatusSchema = z.object({
  paymentId: z.uuid(),
  status: z.enum(["paid", "pending", "refunded"]),
});

export async function createAppointmentPaymentAction(formData: FormData) {
  const parsed = paymentSchema.safeParse({
    appointmentId: formData.get("appointmentId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    status: formData.get("status"),
    paymentDate: formData.get("paymentDate"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Revisa los datos del pago.");

  const { supabase, user, business } = await getProfessionalContext("cash");
  const { error } = await supabase.from("appointment_payments").insert({
    business_id: business.id,
    appointment_id: parsed.data.appointmentId,
    created_by: user.id,
    amount_cop: parsed.data.amount,
    method: parsed.data.method,
    status: parsed.data.status,
    payment_date: parsed.data.paymentDate,
    note: parsed.data.note || null,
  });
  if (error) {
    console.error("No se pudo registrar el pago de la cita.", {
      code: error.code,
      message: error.message,
    });
    throw new Error(error.code === "42501"
      ? "La caja está disponible únicamente en el plan Profesional activo."
      : "No se pudo registrar el pago. Verifica la cita y vuelve a intentar.");
  }

  redirect(`/panel/caja?payment=saved&date=${parsed.data.paymentDate}`);
}

export async function updateAppointmentPaymentStatusAction(formData: FormData) {
  const parsed = paymentStatusSchema.safeParse({
    paymentId: formData.get("paymentId"),
    status: formData.get("status"),
  });
  if (!parsed.success) throw new Error("El pago o su estado no son válidos.");
  const { supabase, business } = await getProfessionalContext("cash");
  const { data, error } = await supabase.from("appointment_payments")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.paymentId)
    .eq("business_id", business.id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("No se pudo cambiar el estado del pago.", {
      code: error.code,
      message: error.message,
    });
    throw new Error("No se pudo actualizar el pago.");
  }
  if (!data) throw new Error("No se encontró el pago en esta sede.");
  redirect("/panel/caja?payment=updated");
}
