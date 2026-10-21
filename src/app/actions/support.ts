"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { selectCurrentBusiness } from "@/lib/business-selection";
import { isConfirmedSuperAdmin } from "@/lib/super-admin";
import type { ActionState } from "@/app/actions/auth";

export async function createSupportTicketAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z.object({
    subject: z.string().trim().min(4).max(160),
    category: z.enum(["reservas", "pagos", "cuenta", "tecnico", "otro"]),
    message: z.string().trim().min(1).max(5000),
  }).safeParse({
    subject: formData.get("subject"),
    category: formData.get("category"),
    message: formData.get("message"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa los datos del ticket." };

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");
  const { data: businesses, error: businessesError } = await supabase.from("businesses")
    .select("id").eq("owner_id", user.id).order("name");
  if (businessesError) return { error: "No se pudo identificar el negocio actual." };
  const business = await selectCurrentBusiness(businesses ?? []);
  if (!business) return { error: "No se encontró un negocio para esta cuenta." };

  const { error } = await supabase.rpc("create_support_ticket", {
    p_business_id: business.id,
    p_subject: parsed.data.subject,
    p_category: parsed.data.category,
    p_message: parsed.data.message,
  });
  if (error) {
    console.error("No se pudo crear el ticket de soporte.", { code: error.code, message: error.message });
    return { error: "No se pudo enviar el ticket. Intenta nuevamente." };
  }
  revalidatePath("/panel/soporte");
  return { success: "Ticket enviado. El equipo de soporte responderá en este mismo módulo." };
}

export async function replyToSupportTicketAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z.object({
    ticketId: z.uuid(),
    message: z.string().trim().min(1).max(5000),
  }).safeParse({
    ticketId: formData.get("ticketId"),
    message: formData.get("message"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Escribe una respuesta." };

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");
  const { error } = await supabase.rpc("add_support_ticket_reply", {
    p_ticket_id: parsed.data.ticketId,
    p_body: parsed.data.message,
  });
  if (error) {
    console.error("No se pudo responder al ticket.", { code: error.code, message: error.message });
    return { error: "No se pudo enviar la respuesta. Verifica que el ticket siga abierto." };
  }
  revalidatePath("/panel/soporte");
  revalidatePath("/admin/tickets");
  return { success: "Respuesta enviada." };
}

export async function updateSupportTicketStatusAction(formData: FormData) {
  const status = z.enum(["open", "in_progress", "resolved"]).safeParse(formData.get("status"));
  const ticketId = z.uuid().safeParse(formData.get("ticketId"));
  if (!status.success || !ticketId.success) throw new Error("El ticket o el estado seleccionado no son válidos.");

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");
  if (!isConfirmedSuperAdmin(user)) redirect("/panel");
  const { error } = await supabase.rpc("update_support_ticket_status", {
    p_ticket_id: ticketId.data,
    p_status: status.data,
  });
  if (error) {
    console.error("No se pudo actualizar el estado del ticket.", { code: error.code, message: error.message });
    throw new Error("No se pudo actualizar el ticket.");
  }
  revalidatePath("/admin/tickets");
  revalidatePath("/panel/soporte");
  redirect("/admin/tickets?saved=1");
}
