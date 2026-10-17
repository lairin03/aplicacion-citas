import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isConfirmedSuperAdmin } from "@/lib/super-admin";

export default async function SuperAdminDashboardPage() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");
  if (!isConfirmedSuperAdmin(user)) redirect("/panel");

  const admin = createAdminClient();
  const { data: subscriptions, error } = await admin.from("business_subscriptions")
    .select("owner_id, plan, status, trial_ends_at, current_period_ends_at, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw new Error("No se pudieron cargar las suscripciones del panel superadministrador.");

  const rows = subscriptions ?? [];
  const active = rows.filter((row) => row.status === "active"
    && row.current_period_ends_at && new Date(row.current_period_ends_at) > new Date()).length;
  const trials = rows.filter((row) => row.status === "trial"
    && row.trial_ends_at && new Date(row.trial_ends_at) > new Date()).length;
  const expired = rows.length - active - trials;
  const plans = {
    basic: rows.filter((row) => row.plan === "basic").length,
    professional: rows.filter((row) => row.plan === "professional").length,
    enterprise: rows.filter((row) => row.plan === "enterprise").length,
  };

  return <main className="min-h-screen bg-[#f3f9fd] px-4 py-8 text-slate-950 sm:px-8">
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-sky-100 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-sky-900">
            <ShieldCheck size={15} /> Super administrador
          </p>
          <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Panel de control</h1>
          <p className="mt-2 text-slate-600">Vista global de suscripciones, planes y estado de las cuentas.</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">{user.email}</p>
        </div>
        <Link href="/admin/suscripciones" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white hover:bg-slate-800">
          Administrar suscripciones <ArrowRight size={17} />
        </Link>
      </header>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric title="Suscripciones registradas" value={rows.length} />
        <Metric title="Planes activos" value={active} />
        <Metric title="Pruebas vigentes" value={trials} />
        <Metric title="Sin acceso vigente" value={expired} />
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-bold">Cuentas por plan</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metric title="Básico" value={plans.basic} />
          <Metric title="Profesional" value={plans.professional} />
          <Metric title="Empresarial" value={plans.enterprise} />
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
          <div><h2 className="font-bold">Últimas suscripciones</h2><p className="mt-1 text-sm text-slate-500">Los cambios de plan y límites se administran desde el detalle.</p></div>
          <Link href="/admin/suscripciones" className="text-sm font-bold text-sky-800 underline underline-offset-4">Ver todas</Link>
        </header>
        {!rows.length && <p className="p-8 text-center text-sm text-slate-500">Todavía no hay suscripciones.</p>}
        {rows.slice(0, 10).map((row) => (
          <div key={row.owner_id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 last:border-0">
            <div><p className="font-semibold">{row.owner_id}</p><p className="mt-1 text-xs text-slate-500">Actualizada {new Date(row.updated_at).toLocaleString("es-CO")}</p></div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold capitalize">{row.plan}</span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{row.status}</span>
            </div>
          </div>
        ))}
      </section>
    </div>
  </main>;
}

function Metric({ title, value }: { title: string; value: number }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-5">
    <p className="text-sm text-slate-500">{title}</p>
    <p className="mt-2 text-3xl font-black">{value}</p>
  </article>;
}
