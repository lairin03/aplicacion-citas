"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { businessOnboardingSchema } from "@/lib/validation/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isConfirmedSuperAdmin } from "@/lib/super-admin";
import type { ActionState } from "@/app/actions/auth";

const subscriptionFormSchema = z.object({
  ownerId: z.uuid(),
  plan: z.enum(["basic", "professional", "enterprise"]),
  status: z.enum(["trial", "pending_payment", "active", "past_due", "canceled", "expired"]),
  currentPeriodEnd: z.union([z.literal(""), z.iso.date()]),
  trialEnd: z.union([z.literal(""), z.iso.date()]),
  staffLimit: z.union([z.literal(""), z.coerce.number().int().min(0).max(100_000)]),
  locationLimit: z.union([z.literal(""), z.coerce.number().int().min(0).max(100_000)]),
});

const planFeatureFormSchema = z.object({
  plan: z.enum(["basic", "professional", "enterprise"]),
  cashEnabled: z.boolean(),
  reportsEnabled: z.boolean(),
  customerHistoryEnabled: z.boolean(),
  benefits: z.string().max(3000),
});

async function requireSuperAdmin() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");
  if (!isConfirmedSuperAdmin(user)) redirect("/panel");
  return user;
}

export async function createLocationAsSuperAdminAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireSuperAdmin();
  const ownerId = z.uuid().safeParse(formData.get("adminOwnerId"));
  if (!ownerId.success) return { error: "No se encontró la cuenta a la que pertenece la sede." };

  const weekdays = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const parsed = businessOnboardingSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    type: formData.get("type"),
    phone: formData.get("phone") || undefined,
    whatsapp: formData.get("whatsapp") || undefined,
    address: formData.get("address") || undefined,
    timezone: formData.get("timezone"),
    staffName: formData.get("staffName"),
    staffEmail: formData.get("staffEmail"),
    serviceName: formData.get("serviceName"),
    serviceDuration: formData.get("serviceDuration"),
    servicePrice: formData.get("servicePrice"),
    hours: weekdays.map((_, weekday) => ({
      weekday,
      open_time: String(formData.get(`open-${weekday}`) ?? ""),
      close_time: String(formData.get(`close-${weekday}`) ?? ""),
      is_closed: formData.get(`closed-${weekday}`) === "on",
    })),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisa los datos de la sede." };
  }

  const admin = createAdminClient();
  const { data: slugAvailable, error: slugError } = await admin.rpc(
    "is_business_slug_available",
    { candidate: parsed.data.slug },
  );
  if (slugError) return { error: "No se pudo validar el enlace. Intenta nuevamente." };
  if (!slugAvailable) return { error: "Ese enlace ya está en uso. Elige otro." };

  const { error } = await admin.rpc("create_business_for_owner_as_super_admin", {
    p_admin_id: actor.id,
    p_owner_id: ownerId.data,
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_type: parsed.data.type,
    p_phone: parsed.data.phone ?? null,
    p_whatsapp: parsed.data.whatsapp ?? null,
    p_address: parsed.data.address ?? null,
    p_timezone: parsed.data.timezone,
    p_staff_name: parsed.data.staffName,
    p_staff_email: parsed.data.staffEmail,
    p_service_name: parsed.data.serviceName,
    p_service_duration: parsed.data.serviceDuration,
    p_service_price: parsed.data.servicePrice,
    p_hours: parsed.data.hours,
  });
  if (error) {
    console.error("No se pudo crear una sede desde superadministración.", {
      code: error.code,
      message: error.message,
      ownerId: ownerId.data,
    });
    return {
      error: error.message.includes("PLAN_LIMIT_LOCATIONS")
        ? "La cuenta alcanzó el máximo de sedes de su plan. Ajusta su límite antes de agregar otra."
        : error.message.includes("PLAN_LIMIT_STAFF")
          ? "El plan alcanzó el máximo de profesionales activos. Ajusta ese límite antes de crear la sede."
        : error.message.includes("PLAN_EXPIRED")
          ? "La suscripción de esta cuenta no está vigente. Activa o renueva su plan antes de agregar sedes."
          : error.code === "23505"
            ? "Ese enlace ya está asociado a otro negocio."
            : "No se pudo crear la sede. Revisa los datos y el plan de la cuenta.",
    };
  }

  revalidatePath("/admin/suscripciones");
  redirect("/admin/suscripciones?saved=location");
}

export async function updateSubscriptionAsSuperAdminAction(formData: FormData) {
  await requireSuperAdmin();
  const parsed = subscriptionFormSchema.safeParse({
    ownerId: formData.get("ownerId"),
    plan: formData.get("plan"),
    status: formData.get("status"),
    currentPeriodEnd: formData.get("currentPeriodEnd") ?? "",
    trialEnd: formData.get("trialEnd") ?? "",
    staffLimit: formData.get("staffLimit") ?? "",
    locationLimit: formData.get("locationLimit") ?? "",
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Revisa los límites y el estado seleccionados.");

  if (parsed.data.status === "active" && !parsed.data.currentPeriodEnd) {
    throw new Error("Un plan activo debe tener fecha de vencimiento.");
  }
  if (parsed.data.status === "trial" && !parsed.data.trialEnd) {
    throw new Error("Una prueba debe tener fecha de vencimiento.");
  }

  const staffLimitOverride = parsed.data.staffLimit === "" ? null : parsed.data.staffLimit;
  const locationLimitOverride = parsed.data.locationLimit === "" ? null : parsed.data.locationLimit;
  const currentPeriodEnd = parsed.data.currentPeriodEnd
    ? new Date(`${parsed.data.currentPeriodEnd}T23:59:59.999Z`).toISOString()
    : null;
  const trialEnd = parsed.data.trialEnd
    ? new Date(`${parsed.data.trialEnd}T23:59:59.999Z`).toISOString()
    : null;
  const admin = createAdminClient();
  const { data: businesses, error: businessesError } = await admin.from("businesses")
    .select("id").eq("owner_id", parsed.data.ownerId);
  if (businessesError) throw new Error("No se pudieron consultar las sedes de la cuenta.");
  const { data: existing, error: readError } = await admin.from("business_subscriptions")
    .select("owner_id, enterprise_staff_limit, enterprise_location_limit")
    .eq("owner_id", parsed.data.ownerId).maybeSingle();
  if (readError) throw new Error("No se pudo consultar la suscripción seleccionada.");
  if (!existing) throw new Error("No se encontró la suscripción seleccionada.");

  const update: Record<string, string | number | null> = {
    plan: parsed.data.plan,
    status: parsed.data.status,
    current_period_ends_at: currentPeriodEnd,
    trial_ends_at: trialEnd,
    staff_limit_override: staffLimitOverride,
    location_limit_override: locationLimitOverride,
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.plan === "enterprise") {
    update.enterprise_staff_limit = staffLimitOverride ?? existing.enterprise_staff_limit ?? 0;
    update.enterprise_location_limit = locationLimitOverride ?? existing.enterprise_location_limit ?? 0;
  }

  const { error: updateError } = await admin.from("business_subscriptions")
    .update(update).eq("owner_id", parsed.data.ownerId);
  if (updateError) {
    console.error("No se pudo actualizar la suscripción desde el panel de superadministración.", {
      code: updateError.code,
      message: updateError.message,
    });
    throw new Error("No se pudo guardar la suscripción. Revisa la migración 0008 y los límites del plan.");
  }

  const overrides = (businesses ?? []).map((business) => ({
    business_id: business.id,
    cash_enabled: parseFeatureOverride(formData.get(`feature_${business.id}_cash`)),
    reports_enabled: parseFeatureOverride(formData.get(`feature_${business.id}_reports`)),
    customer_history_enabled: parseFeatureOverride(formData.get(`feature_${business.id}_history`)),
    updated_at: new Date().toISOString(),
  }));
  if (overrides.length) {
    const { error: overridesError } = await admin.from("business_feature_overrides")
      .upsert(overrides, { onConflict: "business_id" });
    if (overridesError) {
      console.error("No se pudieron actualizar las funciones especiales de las sedes.", {
        code: overridesError.code,
        message: overridesError.message,
        ownerId: parsed.data.ownerId,
      });
      throw new Error("Se actualizó el plan, pero no se pudieron guardar los accesos especiales de las sedes.");
    }
  }

  revalidatePath("/admin/suscripciones");
  revalidatePath("/panel", "layout");
  redirect("/admin/suscripciones?saved=1");
}

export async function updatePlanFeatureCatalogAction(formData: FormData) {
  await requireSuperAdmin();
  const parsed = planFeatureFormSchema.safeParse({
    plan: formData.get("plan"),
    cashEnabled: formData.get("cashEnabled") === "on",
    reportsEnabled: formData.get("reportsEnabled") === "on",
    customerHistoryEnabled: formData.get("customerHistoryEnabled") === "on",
    benefits: formData.get("benefits") ?? "",
  });
  if (!parsed.success) throw new Error("Revisa los beneficios y funciones del plan.");

  const benefits = parsed.data.benefits.split(/\r?\n/)
    .map((benefit) => benefit.trim())
    .filter(Boolean);
  const admin = createAdminClient();
  const { error } = await admin.from("plan_feature_catalog").upsert({
    plan: parsed.data.plan,
    cash_enabled: parsed.data.cashEnabled,
    reports_enabled: parsed.data.reportsEnabled,
    customer_history_enabled: parsed.data.customerHistoryEnabled,
    benefits,
    updated_at: new Date().toISOString(),
  }, { onConflict: "plan" });
  if (error) {
    console.error("No se pudo actualizar la definición del plan.", {
      code: error.code,
      message: error.message,
    });
    throw new Error("No se pudo guardar la definición del plan.");
  }
  revalidatePath("/admin/suscripciones");
  revalidatePath("/planes");
  revalidatePath("/panel", "layout");
  redirect("/admin/suscripciones?saved=features");
}

function parseFeatureOverride(value: FormDataEntryValue | null): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}
