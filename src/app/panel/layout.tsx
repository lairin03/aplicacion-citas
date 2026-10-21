import { redirect } from "next/navigation";
import { PanelNav } from "@/components/panel/panel-nav";
import { selectCurrentBusiness } from "@/lib/business-selection";
import { isConfirmedSuperAdmin } from "@/lib/super-admin";
import { createClient } from "@/lib/supabase/server";
import { getBusinessFeatures } from "@/lib/business-features";

export default async function PanelLayout({ children }: LayoutProps<"/panel">) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect("/login");
  const isAdmin = isConfirmedSuperAdmin(user);

  const { data: businesses, error } = await supabase.from("businesses")
    .select("id, name, logo_url").eq("owner_id", user.id).order("name");
  if (error) {
    console.error("No se pudo cargar el negocio del usuario autenticado.", {
      code: error.code,
      message: error.message,
    });

    if (error.code === "42P01" || error.code === "PGRST205") {
      throw new Error("No existe la tabla businesses en Supabase. Aplica la migración supabase/migrations/0001_initial_schema.sql en el SQL Editor del proyecto.");
    }

    if (error.code === "42703" || error.code === "PGRST204") {
      throw new Error("La tabla businesses no tiene el esquema esperado. Aplica la migración supabase/migrations/0001_initial_schema.sql en el SQL Editor del proyecto.");
    }

    if (error.code === "42501") {
      throw new Error("Supabase denegó el acceso a businesses. Revisa que la migración haya creado los permisos y la política RLS businesses_owner_all.");
    }

    throw new Error(`No se pudo cargar el negocio desde Supabase (${error.code}). Revisa los registros del servidor para más detalles.`);
  }
  const business = await selectCurrentBusiness(businesses ?? []);
  if (isAdmin) {
    return (
      <div className="min-h-screen bg-[#f3f9fd] md:flex">
        <PanelNav
          businessName={business?.name ?? "Super Admin"}
          logoUrl={business?.logo_url ?? null}
          businesses={businesses ?? []}
          activeBusinessId={business?.id ?? ""}
          canAddLocation={!!business}
          hasCashFeature
          hasReportsFeature
          hasCustomerHistory
          isSuperAdmin
        />
        <main className="min-w-0 flex-1 px-4 pb-10 pt-6 sm:px-6 md:px-8 md:pt-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    );
  }
  if (!business) redirect("/onboarding");

  const { data: subscription, error: subscriptionError } = await supabase
    .from("business_subscriptions")
    .select("plan, status, trial_ends_at, current_period_ends_at, enterprise_location_limit, location_limit_override")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (subscriptionError) {
    if (subscriptionError.code === "42P01" || subscriptionError.code === "PGRST205") {
      throw new Error("Falta aplicar supabase/migrations/0006_plans_trials_and_limits.sql para habilitar planes y el período de prueba.");
    }
    throw new Error("No se pudo consultar el estado del plan.");
  }
  const hasAccess = (subscription?.status === "active" && subscription.current_period_ends_at
      && new Date(subscription.current_period_ends_at) > new Date())
    || (subscription?.status === "trial" && subscription.trial_ends_at
      && new Date(subscription.trial_ends_at) > new Date());
  if (!hasAccess) redirect("/planes?trial=expired");

  const locationLimit = subscription?.location_limit_override
    ?? (subscription?.plan === "enterprise"
      ? subscription.enterprise_location_limit ?? 0
      : subscription?.plan === "professional" ? 2 : 1);
  const canAddLocation = hasAccess
    && (subscription?.plan === "professional" || subscription?.plan === "enterprise")
    && (locationLimit === 0 || (businesses?.length ?? 0) < locationLimit);
  const features = await getBusinessFeatures(supabase, business.id, subscription?.plan ?? "");

  return (
    <div className="min-h-screen bg-[#faf9f6] md:flex">
      <PanelNav
        businessName={business.name}
        logoUrl={business.logo_url}
        businesses={businesses ?? []}
        activeBusinessId={business.id}
        canAddLocation={canAddLocation}
        hasCashFeature={hasAccess && features.cash}
        hasReportsFeature={hasAccess && features.reports}
        hasCustomerHistory={hasAccess && features.customer_history}
        isSuperAdmin={false}
      />
      <main className="min-w-0 flex-1 px-4 pb-10 pt-6 sm:px-6 md:px-8 md:pt-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
