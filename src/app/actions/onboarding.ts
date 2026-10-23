"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { businessOnboardingSchema } from "@/lib/validation/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/app/actions/auth";

const weekdays = [
  "Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado",
];

export async function createBusinessAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { error: "Inicia sesión para crear tu negocio." };

  const hours = weekdays.map((_, weekday) => ({
    weekday,
    open_time: String(formData.get(`open-${weekday}`) ?? ""),
    close_time: String(formData.get(`close-${weekday}`) ?? ""),
    is_closed: formData.get(`closed-${weekday}`) === "on",
  }));
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
    hours,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisa los datos del negocio." };
  }

  const { data: slugConflict, error: slugCheckError } = await supabase.rpc(
    "is_business_slug_available",
    { candidate: parsed.data.slug },
  );
  if (slugCheckError) return { error: "No se pudo validar el enlace. Intenta nuevamente." };
  if (!slugConflict) return { error: "Ese enlace ya está en uso. Elige otro." };

  const { data: newBusinessId, error: createError } = await supabase.rpc("create_business_onboarding", {
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
  if (createError) {
    return { error: createError.code === "23505"
      ? "Ese enlace ya está asociado a otro negocio."
      : createError.message.includes("PLAN_LIMIT_LOCATIONS")
        ? "Tu plan no incluye otra sede. Consulta los planes para ampliar el límite."
        : createError.message.includes("PLAN_EXPIRED")
          ? "Tu prueba terminó. Elige un plan para seguir usando Agenda Laii."
      : "No se pudo crear el negocio. Verifica los datos e inténtalo de nuevo." };
  }

  if (newBusinessId) {
    const cookieStore = await cookies();
    cookieStore.set("active_business_id", newBusinessId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/panel",
    });
  }
  redirect("/panel");
}
