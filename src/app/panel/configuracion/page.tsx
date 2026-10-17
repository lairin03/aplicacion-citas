import { redirect } from "next/navigation";
import { SettingsForms } from "@/components/panel/settings-forms";
import { firstRelation } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { selectCurrentBusiness } from "@/lib/business-selection";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: businesses, error: businessError } = await supabase.from("businesses")
    .select("id, name, slug, type, phone, whatsapp, address, timezone, logo_url, brand_color, font_family")
    .eq("owner_id", user.id).order("name");
  const business = await selectCurrentBusiness(businesses ?? []);
  if (businessError || !business) redirect("/onboarding");

  const [{ data: hours }, { data: services }, { data: staff }, { data: blockedTimes }] = await Promise.all([
    supabase.from("business_hours").select("weekday, open_time, close_time, is_closed")
      .eq("business_id", business.id).order("weekday"),
    supabase.from("services").select("id, name, duration_minutes, price_cop, is_active")
      .eq("business_id", business.id).order("name"),
    supabase.from("staff").select("id, name, email, is_active").eq("business_id", business.id).order("name"),
    supabase.from("blocked_times").select("id, staff_id, starts_at, ends_at, reason, staff(name)")
      .eq("business_id", business.id).gte("ends_at", new Date().toISOString()).order("starts_at"),
  ]);

  const normalizedBlockedTimes = (blockedTimes ?? []).map((block) => ({
    ...block,
    staff: firstRelation(block.staff),
  }));

  return <div>
    <h1 className="text-2xl font-bold tracking-tight">Configuración</h1>
    <p className="mt-1 text-sm text-slate-600">Administra el perfil, la disponibilidad y tu equipo.</p>
    <div className="mt-6"><SettingsForms business={business} hours={hours ?? []} services={services ?? []} staff={staff ?? []} blockedTimes={normalizedBlockedTimes} /></div>
  </div>;
}
