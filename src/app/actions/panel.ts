"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { localDateTimeToUtc } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectCurrentBusiness } from "@/lib/business-selection";
import { isConfirmedSuperAdmin } from "@/lib/super-admin";
import { isValidTimeZone } from "@/lib/validation/timezone";
import { businessTypes } from "@/lib/validation/auth";
import type { ActionState } from "@/app/actions/auth";

const appointmentStatusSchema = z.enum([
  "pendiente", "confirmada", "completada", "cancelada", "no_asistió",
]);

async function getOwnerBusiness() {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Debes iniciar sesión.");

  const { data: businesses, error } = await supabase
    .from("businesses")
    .select("id, slug, timezone")
    .eq("owner_id", user.id)
    .order("name");
  if (error) throw new Error("No se pudieron consultar las sedes.");
  const business = await selectCurrentBusiness(businesses ?? []);
  if (!business) throw new Error("No se encontró un negocio para esta cuenta.");
  if (isConfirmedSuperAdmin(user)) return { supabase, business };
  const { data: subscription, error: subscriptionError } = await supabase
    .from("business_subscriptions").select("status, trial_ends_at, current_period_ends_at")
    .eq("owner_id", user.id).maybeSingle();
  if (subscriptionError) throw new Error("No se pudo validar el plan.");
  const hasAccess = (subscription?.status === "active" && !!subscription.current_period_ends_at
      && new Date(subscription.current_period_ends_at) > new Date())
    || (subscription?.status === "trial" && !!subscription.trial_ends_at
      && new Date(subscription.trial_ends_at) > new Date());
  if (!hasAccess) throw new Error("Tu prueba terminó. Elige un plan para continuar.");
  return { supabase, business };
}

export async function selectBusinessAction(formData: FormData) {
  const businessId = z.uuid().safeParse(formData.get("businessId"));
  if (!businessId.success) throw new Error("La sede seleccionada no es válida.");
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Debes iniciar sesión.");
  const { data: business, error } = await supabase.from("businesses")
    .select("id").eq("id", businessId.data).eq("owner_id", user.id).maybeSingle();
  if (error || !business) throw new Error("No tienes acceso a esa sede.");
  const cookieStore = await cookies();
  cookieStore.set("active_business_id", business.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/panel",
  });
  redirect("/panel");
}

export async function updateAppointmentStatusAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = z.uuid().safeParse(formData.get("appointmentId"));
  const status = appointmentStatusSchema.safeParse(formData.get("status"));
  if (!id.success || !status.success) return { error: "La cita o el estado no son válidos." };

  const { supabase, business } = await getOwnerBusiness();
  const { data, error } = await supabase.from("appointments")
    .update({ status: status.data })
    .eq("id", id.data)
    .eq("business_id", business.id)
    .select("id")
    .maybeSingle();
  if (error) return { error: "No se pudo actualizar el estado de la cita." };
  if (!data) return { error: "No se encontró la cita en este negocio." };
  revalidatePath("/panel");
  revalidatePath("/panel/historial");
  return { success: "Estado actualizado." };
}

export async function updateCustomerNotesAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = z.uuid().safeParse(formData.get("customerId"));
  const notes = z.string().trim().max(2000).safeParse(formData.get("notes"));
  if (!id.success || !notes.success) return { error: "Las notas no son válidas." };
  const { supabase, business } = await getOwnerBusiness();
  const { error } = await supabase.from("customers").update({ notes: notes.data || null })
    .eq("id", id.data).eq("business_id", business.id);
  if (error) return { error: "No se pudieron guardar las notas del cliente." };
  revalidatePath(`/panel/clientes/${id.data}`);
  return { success: "Notas guardadas." };
}

export async function updateBusinessAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, business } = await getOwnerBusiness();
  const parsed = z.object({
    name: z.string().trim().min(2).max(120),
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    type: z.enum(businessTypes),
    phone: z.string().trim().max(30),
    whatsapp: z.string().trim().max(30),
    address: z.string().trim().max(200),
    logoUrl: z.union([
      z.literal(""),
      z.url().refine((value) => value.startsWith("https://"), "El logo debe usar una URL HTTPS."),
    ]),
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "El color debe ser un código hexadecimal válido."),
    fontFamily: z.enum(["sans", "serif", "mono"]),
    timezone: z.string().min(1).max(80).refine(isValidTimeZone, "Selecciona una zona horaria válida."),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa los datos." };

  const { data: current } = await supabase.from("businesses").select("slug")
    .eq("id", business.id).single();
  if (parsed.data.slug !== current?.slug) {
    const { data: available, error } = await supabase.rpc("is_business_slug_available", {
      candidate: parsed.data.slug,
    });
    if (error) return { error: "No se pudo validar el enlace público." };
    if (!available) return { error: "Ese enlace ya está en uso." };
  }

  const { error } = await supabase.from("businesses").update({
    name: parsed.data.name,
    slug: parsed.data.slug,
    type: parsed.data.type,
    phone: parsed.data.phone || null,
    whatsapp: parsed.data.whatsapp || null,
    address: parsed.data.address || null,
    logo_url: parsed.data.logoUrl || null,
    brand_color: parsed.data.brandColor,
    font_family: parsed.data.fontFamily,
    timezone: parsed.data.timezone,
  }).eq("id", business.id);
  if (error) return { error: error.code === "23505" ? "Ese enlace ya está en uso." : "No se pudieron guardar los datos." };
  revalidatePath("/panel");
  revalidatePath("/panel/configuracion");
  return { success: "Datos del negocio guardados." };
}

export async function uploadBusinessLogoAction(formData: FormData): Promise<ActionState & { logoUrl?: string }> {
  const file = formData.get("logo");
  if (!(file instanceof File)) return { error: "Selecciona un archivo de logo." };
  const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);
  if (!allowedTypes.has(file.type)) {
    return { error: "El archivo debe ser PNG, JPG, WEBP, GIF o PDF." };
  }
  if (file.size <= 0 || file.size > 5 * 1024 * 1024) {
    return { error: "El archivo debe pesar más de 0 y máximo 5 MB." };
  }

  const { supabase, business } = await getOwnerBusiness();
  const { data: current, error: readError } = await supabase.from("businesses")
    .select("logo_url").eq("id", business.id).single();
  if (readError) return { error: "No se pudo consultar el logo actual." };

  const admin = createAdminClient();
  const extension = file.type === "application/pdf" ? "pdf"
    : file.type === "image/jpeg" ? "jpg"
      : file.type.slice("image/".length);
  const path = `${business.id}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await admin.storage.from("business-logos")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    console.error("Error subiendo logo a Supabase Storage:", uploadError);
    if (uploadError.message.toLowerCase().includes("bucket not found")) {
      return { error: "Supabase no encuentra el bucket business-logos. Ejecuta la migración 0005_business_logo_storage.sql." };
    }
    return { error: `No se pudo subir el logo a Supabase Storage: ${uploadError.message}` };
  }

  const { data: { publicUrl } } = admin.storage.from("business-logos").getPublicUrl(path);
  const { error } = await supabase.from("businesses")
    .update({ logo_url: publicUrl })
    .eq("id", business.id);
  if (error) {
    const { error: cleanupError } = await admin.storage.from("business-logos").remove([path]);
    if (cleanupError) console.error("No se pudo limpiar el logo que no se guardó.", cleanupError);
    console.error("Error guardando URL del logo:", error);
    return { error: "El archivo se subió, pero no se pudo asociar al negocio." };
  }

  await removeStoredBusinessLogo(admin, business.id, current.logo_url, publicUrl);
  revalidatePath("/panel", "layout");
  revalidatePath("/panel/configuracion");
  revalidatePath(`/b/${business.slug}`);
  return { success: "Logo guardado.", logoUrl: publicUrl };
}

export async function removeBusinessLogoAction(): Promise<ActionState> {
  const { supabase, business } = await getOwnerBusiness();
  const { data: current, error: readError } = await supabase.from("businesses")
    .select("logo_url").eq("id", business.id).single();
  if (readError) return { error: "No se pudo consultar el logo actual." };
  const { error } = await supabase.from("businesses")
    .update({ logo_url: null }).eq("id", business.id);
  if (error) return { error: "No se pudo quitar el logo del negocio." };

  await removeStoredBusinessLogo(createAdminClient(), business.id, current.logo_url, null);
  revalidatePath("/panel", "layout");
  revalidatePath("/panel/configuracion");
  revalidatePath(`/b/${business.slug}`);
  return { success: "Logo eliminado." };
}

async function removeStoredBusinessLogo(
  admin: ReturnType<typeof createAdminClient>,
  businessId: string,
  oldUrl: string | null,
  newUrl: string | null,
) {
  if (!oldUrl || oldUrl === newUrl) return;
  const storagePath = oldUrl.split("/storage/v1/object/public/business-logos/")[1]?.split(/[?#]/)[0];
  if (!storagePath) return;
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(storagePath);
  } catch {
    console.error("No se pudo interpretar la ruta del logo anterior.");
    return;
  }
  if (!decodedPath.startsWith(`${businessId}/`)) return;
  const { error } = await admin.storage.from("business-logos").remove([decodedPath]);
  if (error) console.error("No se pudo eliminar el logo anterior.", error);
}

export async function updateHoursAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, business } = await getOwnerBusiness();
  const hours = Array.from({ length: 7 }, (_, weekday) => ({
    business_id: business.id,
    weekday,
    open_time: String(formData.get(`open-${weekday}`) ?? ""),
    close_time: String(formData.get(`close-${weekday}`) ?? ""),
    is_closed: formData.get(`closed-${weekday}`) === "on",
  }));
  const schema = z.array(z.object({
    business_id: z.uuid(),
    weekday: z.number().int().min(0).max(6),
    open_time: z.string().regex(/^\d{2}:\d{2}$/),
    close_time: z.string().regex(/^\d{2}:\d{2}$/),
    is_closed: z.boolean(),
  })).length(7);
  const parsed = schema.safeParse(hours);
  if (!parsed.success) return { error: "Revisa los horarios ingresados." };
  const invalidRange = hours.some((hour) => !hour.is_closed && hour.open_time >= hour.close_time);
  if (invalidRange) return { error: "La hora de apertura debe ser anterior a la de cierre." };

  const { error } = await supabase.from("business_hours").upsert(parsed.data);
  if (error) return { error: "No se pudieron guardar los horarios." };
  revalidatePath("/panel/configuracion");
  return { success: "Horarios guardados." };
}

export async function saveServiceAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, business } = await getOwnerBusiness();
  const parsed = z.object({
    name: z.string().trim().min(2).max(120),
    duration: z.coerce.number().int().min(5).max(1440),
    price: z.coerce.number().int().min(0),
  }).safeParse({
    name: formData.get("name"),
    duration: formData.get("duration"),
    price: formData.get("price"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos de servicio inválidos." };
  const { error } = await supabase.rpc("create_service_for_business", {
    p_business_id: business.id,
    p_name: parsed.data.name,
    p_duration_minutes: parsed.data.duration,
    p_price_cop: parsed.data.price,
  });
  if (error) return { error: "No se pudo crear el servicio para el equipo." };
  revalidatePath("/panel/configuracion");
  return { success: "Servicio agregado." };
}

export async function updateServiceAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, business } = await getOwnerBusiness();
  const parsed = z.object({
    id: z.uuid(),
    name: z.string().trim().min(2).max(120),
    duration: z.coerce.number().int().min(5).max(1440),
    price: z.coerce.number().int().min(0),
  }).safeParse({
    id: formData.get("serviceId"),
    name: formData.get("name"),
    duration: formData.get("duration"),
    price: formData.get("price"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos de servicio inválidos." };

  const { data, error } = await supabase.from("services").update({
    name: parsed.data.name,
    duration_minutes: parsed.data.duration,
    price_cop: parsed.data.price,
  }).eq("id", parsed.data.id).eq("business_id", business.id).select("id").maybeSingle();
  if (error || !data) return { error: "No se pudo actualizar el servicio." };
  revalidatePath("/panel");
  revalidatePath("/panel/configuracion");
  return { success: "Servicio actualizado." };
}

export async function toggleServiceAction(formData: FormData) {
  const id = z.uuid().parse(formData.get("serviceId"));
  const active = formData.get("active") === "true";
  const { supabase, business } = await getOwnerBusiness();
  const { error } = await supabase.from("services").update({ is_active: active })
    .eq("id", id).eq("business_id", business.id);
  if (error) throw new Error("No se pudo cambiar el servicio.");
  revalidatePath("/panel/configuracion");
}

export async function saveStaffAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, business } = await getOwnerBusiness();
  const parsed = z.object({
    name: z.string().trim().min(2).max(120),
    email: z.email("Ingresa el correo electrónico del profesional."),
    serviceIds: z.array(z.uuid()).min(1, "Selecciona al menos un servicio."),
  }).safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    serviceIds: formData.getAll("serviceIds"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos del profesional inválidos." };
  const { error } = await supabase.rpc("create_staff_for_business", {
    p_business_id: business.id,
    p_name: parsed.data.name,
    p_email: parsed.data.email,
    p_service_ids: parsed.data.serviceIds,
  });
  if (error?.message.includes("PLAN_LIMIT_STAFF")) return { error: error.message.split("PLAN_LIMIT_STAFF:")[1]?.trim() ?? "Alcanzaste el límite de profesionales de tu plan." };
  if (error?.message.includes("PLAN_EXPIRED")) return { error: "Tu prueba terminó. Elige un plan para agregar profesionales." };
  if (error) return { error: "No se pudo crear el profesional con los servicios seleccionados." };
  revalidatePath("/panel/configuracion");
  return { success: "Profesional agregado." };
}

export async function updateStaffEmailAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z.object({
    staffId: z.uuid(),
    email: z.email("Ingresa un correo electrónico válido."),
  }).safeParse({
    staffId: formData.get("staffId"),
    email: formData.get("email"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa el correo del profesional." };

  const { supabase, business } = await getOwnerBusiness();
  const { data, error } = await supabase.from("staff")
    .update({ email: parsed.data.email.trim().toLowerCase() })
    .eq("id", parsed.data.staffId)
    .eq("business_id", business.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: "No se pudo guardar el correo del profesional." };
  revalidatePath("/panel/configuracion");
  return { success: "Correo del profesional actualizado." };
}

export async function toggleStaffAction(formData: FormData) {
  const id = z.uuid().parse(formData.get("staffId"));
  const active = formData.get("active") === "true";
  const { supabase, business } = await getOwnerBusiness();
  const { error } = await supabase.from("staff").update({ is_active: active })
    .eq("id", id).eq("business_id", business.id);
  if (error) throw new Error("No se pudo cambiar el estado del profesional.");
  revalidatePath("/panel/configuracion");
}

export async function createBlockedTimeAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, business } = await getOwnerBusiness();
  const parsed = z.object({
    staffId: z.string(),
    startsAt: z.string().min(1),
    endsAt: z.string().min(1),
    reason: z.string().trim().max(200),
  }).safeParse({
    staffId: formData.get("staffId") ?? "",
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) return { error: "Revisa el intervalo del bloqueo." };
  let startsAt: Date;
  let endsAt: Date;
  try {
    startsAt = localDateTimeToUtc(parsed.data.startsAt, business.timezone);
    endsAt = localDateTimeToUtc(parsed.data.endsAt, business.timezone);
  } catch {
    return { error: "La fecha no es válida para la zona horaria configurada." };
  }
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return { error: "La fecha no es válida para la zona horaria configurada." };
  }
  if (startsAt >= endsAt || startsAt <= new Date()) return { error: "El bloqueo debe ser futuro y tener un intervalo válido." };
  const { error } = await supabase.from("blocked_times").insert({
    business_id: business.id,
    staff_id: parsed.data.staffId || null,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    reason: parsed.data.reason || null,
  });
  if (error) return { error: "No se pudo guardar el bloqueo." };
  revalidatePath("/panel/configuracion");
  return { success: "Bloqueo guardado." };
}

export async function deleteBlockedTimeAction(formData: FormData) {
  const id = z.uuid().parse(formData.get("blockedTimeId"));
  const { supabase, business } = await getOwnerBusiness();
  const { error } = await supabase.from("blocked_times").delete()
    .eq("id", id).eq("business_id", business.id);
  if (error) throw new Error("No se pudo eliminar el bloqueo.");
  revalidatePath("/panel/configuracion");
}
