import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type BusinessFeature = "cash" | "reports" | "customer_history";
export type BusinessFeatures = Record<BusinessFeature, boolean>;

type FeatureColumn = "cash_enabled" | "reports_enabled" | "customer_history_enabled";

const planFeatureColumns: Record<BusinessFeature, FeatureColumn> = {
  cash: "cash_enabled",
  reports: "reports_enabled",
  customer_history: "customer_history_enabled",
};
const overrideColumns: Record<BusinessFeature, FeatureColumn> = {
  cash: "cash_enabled",
  reports: "reports_enabled",
  customer_history: "customer_history_enabled",
};

export async function getBusinessFeatures(
  supabase: SupabaseClient,
  businessId: string,
  plan: string,
  isSuperAdmin = false,
): Promise<BusinessFeatures> {
  if (isSuperAdmin) return { cash: true, reports: true, customer_history: true };

  const [{ data: planFeatures, error: planError }, { data: overrides, error: overrideError }] = await Promise.all([
    supabase.from("plan_feature_catalog")
      .select("cash_enabled, reports_enabled, customer_history_enabled")
      .eq("plan", plan).maybeSingle(),
    supabase.from("business_feature_overrides")
      .select("cash_enabled, reports_enabled, customer_history_enabled")
      .eq("business_id", businessId).maybeSingle(),
  ]);
  if (planError || overrideError) throw new Error("No se pudieron validar las funciones habilitadas para el negocio.");

  return {
    cash: overrides?.[overrideColumns.cash] ?? planFeatures?.[planFeatureColumns.cash] ?? false,
    reports: overrides?.[overrideColumns.reports] ?? planFeatures?.[planFeatureColumns.reports] ?? false,
    customer_history: overrides?.[overrideColumns.customer_history]
      ?? planFeatures?.[planFeatureColumns.customer_history] ?? false,
  };
}
