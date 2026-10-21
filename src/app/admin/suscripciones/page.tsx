import { redirect } from "next/navigation";
import Link from "next/link";
import { updatePlanFeatureCatalogAction, updateSubscriptionAsSuperAdminAction } from "@/app/actions/super-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isConfirmedSuperAdmin } from "@/lib/super-admin";

type SearchParams = Promise<{ saved?: string; edit?: string }>;

export default async function SuperAdminSubscriptionsPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");
  if (!isConfirmedSuperAdmin(user)) redirect("/panel");

  const admin = createAdminClient();
  const [
    { data: subscriptions, error: subscriptionsError },
    { data: businesses, error: businessesError },
    { data: planFeatures, error: planFeaturesError },
    { data: businessOverrides, error: overridesError },
  ] = await Promise.all([
    admin.from("business_subscriptions")
      .select("owner_id, plan, status, trial_ends_at, current_period_ends_at, enterprise_staff_limit, enterprise_location_limit, staff_limit_override, location_limit_override, updated_at")
      .order("updated_at", { ascending: false }),
    admin.from("businesses")
      .select("id, owner_id, name, slug")
      .order("name"),
    admin.from("plan_feature_catalog").select("plan, cash_enabled, reports_enabled, customer_history_enabled, benefits").order("plan"),
    admin.from("business_feature_overrides")
      .select("business_id, cash_enabled, reports_enabled, customer_history_enabled"),
  ]);
  if (subscriptionsError || businessesError || planFeaturesError || overridesError) {
    throw new Error("No se pudieron cargar las suscripciones o funciones de los planes. Verifica las migraciones y la clave de servicio.");
  }

  const usersById = new Map<string, string>();
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("No se pudieron consultar los correos de las cuentas suscritas.");
    for (const authUser of data.users) {
      usersById.set(authUser.id, authUser.email ?? "Sin correo");
    }
    if (data.users.length < 1000) break;
  }

  const businessesByOwner = new Map<string, NonNullable<typeof businesses>>();
  for (const business of businesses ?? []) {
    const owned = businessesByOwner.get(business.owner_id) ?? [];
    owned.push(business);
    businessesByOwner.set(business.owner_id, owned);
  }
  const overridesByBusiness = new Map((businessOverrides ?? []).map((override) => [override.business_id, override]));
  const params = await searchParams;
  const planLabels = { basic: "Básico", professional: "Profesional", enterprise: "Empresarial" } as const;

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-8">
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-sky-700">Acceso superadministrador</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">Suscripciones y límites</h1>
          <p className="mt-2 text-sm text-slate-600">Gestión exclusiva de {user.email}. Los cambios se aplican a todas las sedes de cada cuenta.</p>
        </div>
        <a href="/panel" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold">Ir al panel</a>
      </header>
      {params.saved === "1" && <p role="status" className="mt-5 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm font-semibold text-sky-900">Suscripción actualizada.</p>}
      {params.saved === "location" && <p role="status" className="mt-5 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm font-semibold text-sky-900">Sede creada correctamente.</p>}
      {params.saved === "features" && <p role="status" className="mt-5 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm font-semibold text-sky-900">Funciones y beneficios de los planes actualizados.</p>}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-black">Qué incluye cada plan</h2>
        <p className="mt-1 text-sm text-slate-600">Configura los accesos predeterminados y los beneficios descriptivos que se mostrarán para cada plan. Una excepción por sede puede reemplazar estos accesos.</p>
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          {(planFeatures ?? []).map((plan) => <form key={plan.plan} action={updatePlanFeatureCatalogAction} className="rounded-xl border border-slate-200 p-4">
            <input type="hidden" name="plan" value={plan.plan} />
            <h3 className="font-bold">{planLabels[plan.plan as keyof typeof planLabels]}</h3>
            <div className="mt-3 space-y-2">
              <FeatureCheckbox name="cashEnabled" checked={plan.cash_enabled} label="Caja" />
              <FeatureCheckbox name="reportsEnabled" checked={plan.reports_enabled} label="Reportes" />
              <FeatureCheckbox name="customerHistoryEnabled" checked={plan.customer_history_enabled} label="Historial y ficha de clientes" />
            </div>
            <label className="mt-4 block text-xs font-semibold text-slate-600">Beneficios (uno por línea)
              <textarea name="benefits" rows={5} defaultValue={Array.isArray(plan.benefits) ? plan.benefits.join("\n") : ""} className="form-input mt-1 resize-y" />
            </label>
            <button className="mt-3 min-h-10 rounded-lg bg-slate-950 px-4 text-sm font-bold text-white">Guardar plan</button>
          </form>)}
        </div>
      </section>
      <div className="mt-6 space-y-3">
        {(subscriptions ?? []).map((subscription) => {
          const isEditing = params.edit === subscription.owner_id;
          const staffDefault = subscription.plan === "basic" ? 1
            : subscription.plan === "professional" ? 3
              : subscription.enterprise_staff_limit ?? 0;
          const locationDefault = subscription.plan === "enterprise"
            ? subscription.enterprise_location_limit ?? 0
            : subscription.plan === "professional" ? 2 : 1;
          const ownerBusinesses = businessesByOwner.get(subscription.owner_id) ?? [];
          const accountEmail = usersById.get(subscription.owner_id)?.trim().toLowerCase();
          const effectiveLocationLimit = subscription.location_limit_override ?? locationDefault;
          const canAddLocation = accountEmail === "delaranslairin9@gmail.com"
            || (
              (subscription.plan === "enterprise" || subscription.plan === "professional")
              && (effectiveLocationLimit === 0 || ownerBusinesses.length < effectiveLocationLimit)
            );
          return <article key={subscription.owner_id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="break-all font-bold">
                  {usersById.get(subscription.owner_id) ?? "Cuenta sin correo encontrado"}
                  {usersById.get(subscription.owner_id)?.trim().toLowerCase() === "delaranslairin9@gmail.com"
                    && <span className="mt-2 inline-block rounded-full bg-sky-100 px-2 py-1 text-[10px] font-black uppercase text-sky-900 sm:ml-2">Super Admin · Profesional ilimitado</span>}
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  {ownerBusinesses.length ? `${ownerBusinesses.length} ${ownerBusinesses.length === 1 ? "sede" : "sedes"} · ${ownerBusinesses.slice(0, 2).map((site) => `${site.name} (${site.slug})`).join(" · ")}${ownerBusinesses.length > 2 ? " · …" : ""}` : "Sin sedes creadas"}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Plan <strong className="uppercase text-slate-800">{subscription.plan}</strong>
                  <span className="mx-2">·</span>
                  {subscription.status.replace("_", " ")}
                </p>
                <p className="mt-1 break-all text-[11px] text-slate-400">ID: {subscription.owner_id}</p>
              </div>
              <div className={`grid gap-2 sm:flex sm:shrink-0 ${canAddLocation ? "grid-cols-2" : "grid-cols-1"}`}>
                {canAddLocation
                  ? <Link href={`/admin/sedes/nueva?ownerId=${subscription.owner_id}`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-sky-200 bg-sky-50 px-3 text-center text-xs font-bold text-sky-900 hover:bg-sky-100">
                    Agregar sede
                  </Link>
                  : <span className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-100 px-3 text-center text-[11px] font-semibold text-slate-500">
                    {subscription.plan === "professional" || subscription.plan === "enterprise" ? "Límite de sedes alcanzado" : "Sedes disponibles en Profesional"}
                  </span>}
                <Link href={isEditing ? "/admin/suscripciones" : `/admin/suscripciones?edit=${subscription.owner_id}`} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800">
                  {isEditing ? "Cerrar" : "Editar"}
                </Link>
              </div>
            </div>
            {isEditing && <form action={updateSubscriptionAsSuperAdminAction} className="mt-5 grid grid-cols-1 gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2 xl:grid-cols-3">
              <input type="hidden" name="ownerId" value={subscription.owner_id} />
              <label className="text-xs font-semibold text-slate-600">Plan
                <select name="plan" defaultValue={subscription.plan} className="form-input mt-1">
                  <option value="basic">Básico</option><option value="professional">Profesional</option><option value="enterprise">Empresarial</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">Estado
                <select name="status" defaultValue={subscription.status} className="form-input mt-1">
                  <option value="trial">Prueba</option><option value="pending_payment">Pago pendiente</option>
                  <option value="active">Activo</option><option value="past_due">Vencido</option>
                  <option value="canceled">Cancelado</option><option value="expired">Expirado</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">Vence plan activo
                <input name="currentPeriodEnd" type="date" defaultValue={asDate(subscription.current_period_ends_at)} className="form-input mt-1" />
              </label>
              <label className="text-xs font-semibold text-slate-600">Vence prueba
                <input name="trialEnd" type="date" defaultValue={asDate(subscription.trial_ends_at)} className="form-input mt-1" />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                {subscription.plan === "professional" ? "Máximo profesionales por sede" : "Máximo profesionales"}
                <input name="staffLimit" type="number" min="0" max="100000" defaultValue={subscription.staff_limit_override ?? (subscription.plan === "enterprise" ? staffDefault : "")} className="form-input mt-1" />
              </label>
              <label className="text-xs font-semibold text-slate-600">Máximo sedes
                <input name="locationLimit" type="number" min="0" max="100000" defaultValue={subscription.location_limit_override ?? (subscription.plan === "enterprise" ? locationDefault : "")} className="form-input mt-1" />
              </label>
              <p className="text-xs leading-5 text-slate-500 sm:col-span-2 xl:col-span-3">Límite por defecto: Básico 1 sede y 1 profesional; Profesional 2 sedes con hasta 3 profesionales por sede; Empresarial conserva los cupos del contrato. En Profesional, el límite de profesionales es por sede; en Empresarial es total por cuenta. Para Básico/Profesional, vacío hereda el plan; en Empresarial vacío conserva su cupo actual. 0 significa sin límite.</p>
              {ownerBusinesses.length > 0 && <fieldset className="space-y-3 sm:col-span-2 xl:col-span-3">
                <legend className="font-bold">Excepciones de funciones por negocio</legend>
                <p className="text-xs text-slate-500">“Heredar del plan” sigue los permisos predeterminados configurados arriba.</p>
                {ownerBusinesses.map((site) => {
                  const overrides = overridesByBusiness.get(site.id);
                  return <div key={site.id} className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_repeat(3,minmax(0,1fr))]">
                    <div className="min-w-0"><p className="font-semibold">{site.name}</p><p className="truncate text-xs text-slate-500">Enlace /b/{site.slug}</p></div>
                    <FeatureOverrideSelect name={`feature_${site.id}_cash`} label="Caja" value={overrides?.cash_enabled} />
                    <FeatureOverrideSelect name={`feature_${site.id}_reports`} label="Reportes" value={overrides?.reports_enabled} />
                    <FeatureOverrideSelect name={`feature_${site.id}_history`} label="Historial de clientes" value={overrides?.customer_history_enabled} />
                  </div>;
                })}
              </fieldset>}
              <button className="min-h-12 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800 sm:col-span-2 xl:col-span-1">Guardar cambios</button>
            </form>}
          </article>;
        })}
        {!subscriptions?.length && <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">No hay suscripciones registradas.</p>}
      </div>
    </div>
  </main>;
}

function asDate(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function FeatureCheckbox({ name, checked, label }: { name: string; checked: boolean; label: string }) {
  return <label className="flex items-center gap-2 text-sm text-slate-700">
    <input type="checkbox" name={name} defaultChecked={checked} className="size-4 accent-sky-700" />
    {label}
  </label>;
}

function FeatureOverrideSelect({
  name,
  label,
  value,
}: {
  name: string;
  label: string;
  value: boolean | null | undefined;
}) {
  return <label className="text-xs font-semibold text-slate-600">{label}
    <select name={name} defaultValue={value === null || value === undefined ? "inherit" : String(value)} className="form-input mt-1">
      <option value="inherit">Heredar del plan</option>
      <option value="true">Habilitar</option>
      <option value="false">Deshabilitar</option>
    </select>
  </label>;
}
