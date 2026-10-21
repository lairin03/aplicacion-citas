import { redirect } from "next/navigation";
import { SettingsForms } from "@/components/panel/settings-forms";
import { firstRelation } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { selectCurrentBusiness } from "@/lib/business-selection";
import { isConfirmedSuperAdmin } from "@/lib/super-admin";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: businesses, error: businessError } = await supabase.from("businesses")
    .select("id, name, slug, type, phone, whatsapp, address, timezone, logo_url, brand_color, font_family")
    .eq("owner_id", user.id).order("name");
  const business = await selectCurrentBusiness(businesses ?? []);
  if (businessError || !business) redirect("/onboarding");

  const [
    { data: services, error: servicesError },
    { data: staff, error: staffError },
    { data: staffServices, error: staffServicesError },
    { data: staffHours, error: staffHoursError },
    { data: blockedTimes, error: blockedTimesError },
    { data: subscription, error: subscriptionError },
  ] = await Promise.all([
    supabase.from("services").select("id, name, duration_minutes, price_cop, is_active")
      .eq("business_id", business.id).order("name"),
    supabase.from("staff").select("id, name, email, is_active").eq("business_id", business.id).order("name"),
    supabase.from("staff_services").select("staff_id, service_id, is_active").eq("business_id", business.id),
    supabase.from("staff_business_hours").select("staff_id, weekday, open_time, close_time, is_closed")
      .eq("business_id", business.id).order("weekday"),
    supabase.from("blocked_times").select("id, staff_id, starts_at, ends_at, reason, staff(name)")
      .eq("business_id", business.id).gte("ends_at", new Date().toISOString()).order("starts_at"),
    supabase.from("business_subscriptions")
      .select("plan, status, trial_ends_at, current_period_ends_at")
      .eq("owner_id", user.id).maybeSingle(),
  ]);
  if (servicesError || staffError || staffServicesError || staffHoursError
    || blockedTimesError || subscriptionError) {
    throw new Error("No se pudo cargar la configuración del negocio.");
  }

  const now = new Date();
  const canEditStaffProfiles = isConfirmedSuperAdmin(user)
    || ((subscription?.status === "trial" && !!subscription.trial_ends_at
        && new Date(subscription.trial_ends_at) > now)
        || (subscription?.status === "active" && !!subscription.current_period_ends_at
          && new Date(subscription.current_period_ends_at) > now));
  const staffProfiles = (staff ?? []).map((person) => ({
    ...person,
    serviceIds: (staffServices ?? [])
      .filter((entry) => entry.staff_id === person.id && entry.is_active)
      .map((entry) => entry.service_id),
    hours: (staffHours ?? []).filter((entry) => entry.staff_id === person.id),
  }));

  const normalizedBlockedTimes = (blockedTimes ?? []).map((block) => ({
    ...block,
    staff: firstRelation(block.staff),
  }));

  return <div>
    <h1 className="text-2xl font-bold tracking-tight">Configuración</h1>
    <p className="mt-1 text-sm text-slate-600">Administra el perfil, la disponibilidad y tu equipo.</p>
    <div className="mt-6"><SettingsForms business={business} services={services ?? []} staff={staffProfiles} blockedTimes={normalizedBlockedTimes} canEditStaffProfiles={canEditStaffProfiles} /></div>
  </div>;
}
