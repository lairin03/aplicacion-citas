import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/neon/server";
import { selectCurrentBusiness } from "@/lib/business-selection";
import { isConfirmedSuperAdmin } from "@/lib/super-admin";
import { getBusinessFeatures, type BusinessFeature } from "@/lib/business-features";

export async function getBusinessFeatureContext(feature: BusinessFeature) {
  const db = await createClient();
  const { data: { user }, error: userError } = await db.auth.getUser();
  if (userError || !user) redirect("/login");

  const isSuperAdmin = isConfirmedSuperAdmin(user);
  const { data: businesses, error: businessError } = await db.from("businesses")
    .select("id, name, timezone").eq("owner_id", user.id).order("name");
  if (businessError) throw new Error("No se pudieron consultar las sedes del negocio.");
  const business = await selectCurrentBusiness(businesses ?? []);
  if (!business) redirect(isSuperAdmin ? "/admin" : "/onboarding");
  if (isSuperAdmin) return { db, user, business };

  const { data: subscription, error: subscriptionError } = await db
    .from("business_subscriptions")
    .select("plan, status, trial_ends_at, current_period_ends_at")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (subscriptionError) throw new Error("No se pudo validar el plan Profesional.");

  const now = new Date();
  const active = (subscription?.status === "trial" && !!subscription.trial_ends_at
      && new Date(subscription.trial_ends_at) > now)
    || (subscription?.status === "active" && !!subscription.current_period_ends_at
      && new Date(subscription.current_period_ends_at) > now);
  if (!active) redirect("/planes?trial=expired");
  const features = await getBusinessFeatures(db, business.id, subscription?.plan ?? "");
  if (!features[feature]) redirect(`/panel?feature=${feature}`);

  return { db, user, business };
}

export async function getProfessionalContext(feature: "cash" | "reports") {
  return getBusinessFeatureContext(feature);
}
