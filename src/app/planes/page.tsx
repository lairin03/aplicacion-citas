import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Check, CreditCard, ShieldCheck } from "lucide-react";
import { startWompiCheckoutAction } from "@/app/actions/billing";
import { createClient } from "@/lib/supabase/server";
import { isConfirmedSuperAdmin } from "@/lib/super-admin";

const plans = [
  {
    id: "basic",
    name: "Básico",
    previous: "$49.900",
    price: "$29.900",
    discount: "-40%",
    features: [
      "1 sede y 1 profesional",
      "Reservas online ilimitadas",
      "Recordatorios por email",
      "Recordatorios por WhatsApp ilimitados",
    ],
  },
  {
    id: "professional",
    name: "Profesional",
    previous: "$119.900",
    price: "$89.900",
    discount: "-25%",
    features: [
      "Hasta 2 sedes y 3 profesionales por sede (6 en total)",
      "Base de clientes y segmentación",
      "Recordatorios por WhatsApp ilimitados",
      "Reportes e histórico de servicios",
      "Sistema de caja",
      "Soporte prioritario",
    ],
  },
] as const;

type SearchParams = Promise<{ trial?: string; payment?: string }>;

export default async function PlansPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect("/login");
  if (isConfirmedSuperAdmin(user)) redirect("/admin");

  const [{ data: subscription, error: subscriptionError }, { count: businessCount, error: businessError }] = await Promise.all([
    supabase.from("business_subscriptions")
      .select("plan, status, trial_ends_at, current_period_ends_at")
      .eq("owner_id", user.id)
      .maybeSingle(),
    supabase.from("businesses")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id),
  ]);
  if (subscriptionError || businessError) {
    throw new Error("No se pudo cargar el estado de los planes.");
  }
  if (!businessCount) redirect("/onboarding");

  const params = await searchParams;
  const now = new Date();
  const trialActive = subscription?.status === "trial" && !!subscription.trial_ends_at
    && new Date(subscription.trial_ends_at) > now;
  const paidActive = subscription?.status === "active" && !!subscription.current_period_ends_at
    && new Date(subscription.current_period_ends_at) > now;
  const wompiConfigured = !!process.env.WOMPI_PUBLIC_KEY
    && !!process.env.WOMPI_INTEGRITY_SECRET
    && !!process.env.WOMPI_EVENTS_SECRET
    && !!process.env.APP_URL;

  return (
    <main className="min-h-screen bg-[#f3f9fd] px-5 py-8 text-slate-950 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <Link href={paidActive || trialActive ? "/panel" : "/"} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950">
          <ArrowLeft size={16} /> {paidActive || trialActive ? "Volver al panel" : "Volver al inicio"}
        </Link>

        <header className="mx-auto mt-10 max-w-3xl text-center">
          <p className="text-sm font-black uppercase tracking-[.2em] text-sky-700">Agenda Clara</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">
            {trialActive ? "Elige tu plan" : paidActive ? "Tu plan y facturación" : "Activa tu agenda"}
          </h1>
          <p className="mt-4 text-lg leading-7 text-slate-600">
            Elige Básico o Profesional. Pagas cada mes manualmente mediante el checkout seguro de Wompi; no guardamos tarjetas ni hacemos cobros automáticos.
          </p>
          {trialActive && (
            <p className="mt-5 inline-flex rounded-full border border-sky-300 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950">
              Tu prueba gratuita sigue activa hasta {new Date(subscription.trial_ends_at!).toLocaleDateString("es-CO")}.
            </p>
          )}
          {paidActive && (
            <p className="mt-5 inline-flex rounded-full border border-sky-300 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950">
              Plan {subscription.plan === "basic" ? "Básico" : subscription.plan === "professional" ? "Profesional" : "Empresarial"} activo hasta {new Date(subscription.current_period_ends_at!).toLocaleDateString("es-CO")}.
            </p>
          )}
          {params.trial === "expired" && !paidActive && (
            <p className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-950">
              Tu acceso terminó. Elige un plan para reactivar la agenda y las nuevas reservas.
            </p>
          )}
          {params.payment === "returned" && (
            <p className="mt-5 rounded-2xl border border-sky-300 bg-sky-50 p-4 text-sm font-semibold text-sky-950">
              Regresaste de Wompi. La activación se confirma únicamente cuando recibimos y verificamos el evento de pago; recarga esta página en un momento para consultar el estado actualizado.
            </p>
          )}
        </header>

        <section className="mt-10 grid items-stretch gap-5 lg:grid-cols-3">
          {plans.map((plan) => (
            <article key={plan.id} className={`relative flex flex-col rounded-3xl p-6 sm:p-8 ${plan.id === "professional" ? "border-2 border-sky-300 bg-slate-950 text-white shadow-2xl shadow-sky-950/15 lg:-my-3 lg:py-11" : "border border-slate-200 bg-white"}`}>
              {plan.id === "professional" && <span className="absolute -top-3 left-6 rounded-full bg-sky-300 px-4 py-1.5 text-xs font-black uppercase tracking-wider text-slate-950">Más elegido</span>}
              <h2 className="text-2xl font-black">{plan.name}</h2>
              <div className="mt-5 flex items-center gap-2 text-sm text-slate-500">
                <span className="line-through">{plan.previous}</span>
                <span className="rounded-full bg-sky-100 px-2 py-0.5 font-bold text-sky-950">{plan.discount}</span>
              </div>
              <p className="mt-1"><span className="text-4xl font-black">{plan.price}</span><span className={plan.id === "professional" ? "text-slate-300" : "text-slate-500"}>/mes COP</span></p>
              <ul className="mt-7 flex-1 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className={`flex gap-3 text-sm leading-5 ${plan.id === "professional" ? "text-slate-200" : "text-slate-700"}`}>
                    <Check size={17} className="mt-0.5 shrink-0 text-sky-400" />{feature}
                  </li>
                ))}
              </ul>
              {wompiConfigured ? (
                <form action={startWompiCheckoutAction} className="mt-8">
                  <input type="hidden" name="plan" value={plan.id} />
                  <button type="submit" className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 font-bold transition ${plan.id === "professional" ? "bg-sky-300 text-slate-950 hover:bg-sky-200" : "bg-slate-950 text-white hover:bg-slate-800"}`}>
                    <CreditCard size={17} /> Pagar con Wompi
                  </button>
                </form>
              ) : (
                <p className="mt-8 rounded-xl border border-amber-300 bg-amber-50 p-3 text-center text-sm font-semibold text-amber-950">
                  Wompi aún no está configurado en el servidor.
                </p>
              )}
            </article>
          ))}
          <article className="flex flex-col rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-2xl font-black">Empresarial</h2>
            <p className="mt-3 text-3xl font-black">Tarifa personalizada</p>
            <ul className="mt-7 flex-1 space-y-3 text-sm leading-5 text-slate-700">
              {["Múltiples sedes y equipos avanzados", "Reportes ejecutivos y soporte prioritario", "Implementación y acompañamiento comercial"].map((feature) => (
                <li key={feature} className="flex gap-3"><Check size={17} className="shrink-0 text-sky-600" />{feature}</li>
              ))}
            </ul>
            <a href="https://wa.me/573042357606?text=Hola%2C%20quiero%20conocer%20el%20plan%20Empresarial%20de%20Agenda%20Clara" target="_blank" rel="noreferrer" className="mt-8 inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-slate-950 px-4 font-bold transition hover:bg-sky-100">
              Hablar con ventas
            </a>
          </article>
        </section>

        <aside className="mx-auto mt-8 flex max-w-3xl items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-600">
          <ShieldCheck size={20} className="mt-0.5 shrink-0 text-sky-700" />
          <p>El precio corresponde a un mes de servicio desde la aprobación del pago. La renovación es manual desde esta página; el acceso y las reservas se bloquean al terminar el período pagado. No pedimos tarjeta para iniciar los 5 días de prueba.</p>
        </aside>
      </div>
    </main>
  );
}
