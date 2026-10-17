import { getProfessionalContext } from "@/lib/professional-access";
import { firstRelation, localDateAtOffset, localDateToUtc } from "@/lib/dates";

type SearchParams = Promise<{ from?: string; to?: string }>;
const money = (amount: number) => new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
}).format(amount);

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, business } = await getProfessionalContext();
  const params = await searchParams;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: business.timezone }).format(new Date());
  const from = validDate(params.from) ? params.from! : localDateAtOffset(today, -29);
  const to = validDate(params.to) ? params.to! : today;
  if (from > to) throw new Error("La fecha inicial del reporte debe ser anterior a la fecha final.");
  if (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime() > 366 * 86_400_000) {
    throw new Error("El período máximo para los reportes es de 12 meses.");
  }

  const start = localDateToUtc(from, business.timezone).toISOString();
  const end = localDateToUtc(localDateAtOffset(to, 1), business.timezone).toISOString();
  const [{ data: appointments, error: appointmentsError }, { data: payments, error: paymentsError }] = await Promise.all([
    supabase.from("appointments")
      .select("id, status, starts_at, services(name, price_cop), appointment_services(services(name, price_cop)), staff(name)")
      .eq("business_id", business.id)
      .gte("starts_at", start).lt("starts_at", end)
      .neq("status", "cancelada")
      .order("starts_at"),
    supabase.from("appointment_payments")
      .select("amount_cop, status")
      .eq("business_id", business.id)
      .gte("payment_date", from).lte("payment_date", to),
  ]);
  if (appointmentsError || paymentsError) {
    throw new Error("No se pudieron cargar los datos de reportes.");
  }

  const records = appointments ?? [];
  const completed = records.filter((appointment) => appointment.status === "completada");
  const paidRevenue = (payments ?? [])
    .filter((payment) => payment.status === "paid")
    .reduce((sum, payment) => sum + payment.amount_cop, 0);
  const refunds = (payments ?? [])
    .filter((payment) => payment.status === "refunded")
    .reduce((sum, payment) => sum + payment.amount_cop, 0);
  const pending = (payments ?? [])
    .filter((payment) => payment.status === "pending")
    .reduce((sum, payment) => sum + payment.amount_cop, 0);

  const services = new Map<string, { count: number; amount: number }>();
  const professionals = new Map<string, number>();
  for (const appointment of completed) {
    const staffName = firstRelation(appointment.staff)?.name ?? "Sin profesional";
    professionals.set(staffName, (professionals.get(staffName) ?? 0) + 1);
    const linkedServices = (appointment.appointment_services ?? [])
      .map((entry) => firstRelation(entry.services))
      .filter((service): service is { name: string; price_cop: number } => !!service);
    const appointmentServices = linkedServices.length
      ? linkedServices
      : [firstRelation(appointment.services)].filter((service): service is { name: string; price_cop: number } => !!service);
    for (const service of appointmentServices) {
      const current = services.get(service.name) ?? { count: 0, amount: 0 };
      services.set(service.name, {
        count: current.count + 1,
        amount: current.amount + service.price_cop,
      });
    }
  }
  const topServices = [...services].sort((a, b) => b[1].count - a[1].count);
  const topStaff = [...professionals].sort((a, b) => b[1] - a[1]);

  return <div>
    <h1 className="text-2xl font-bold tracking-tight">Reportes</h1>
    <p className="mt-1 text-sm text-slate-600">Resumen de citas completadas, servicios y pagos reales de {business.name}.</p>
    <form className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_1fr_auto]">
      <label className="text-xs font-medium text-slate-500">Desde<input name="from" type="date" defaultValue={from} className="form-input mt-1" /></label>
      <label className="text-xs font-medium text-slate-500">Hasta<input name="to" type="date" defaultValue={to} className="form-input mt-1" /></label>
      <button className="min-h-12 self-end rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">Actualizar reporte</button>
    </form>

    <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric title="Citas completadas" value={String(completed.length)} />
      <Metric title="Ingresos pagados" value={money(paidRevenue)} />
      <Metric title="Reembolsos" value={money(refunds)} />
      <Metric title="Pagos pendientes" value={money(pending)} />
    </section>

    <section className="mt-6 grid gap-5 lg:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-4"><h2 className="font-bold">Servicios más realizados</h2><p className="mt-1 text-xs text-slate-500">Conteo e importe de tarifa de servicios completados.</p></div>
        {!topServices.length && <p className="p-6 text-sm text-slate-500">Aún no hay citas completadas en este período.</p>}
        {topServices.map(([name, data]) => <div key={name} className="flex items-center justify-between gap-4 border-b border-slate-100 p-4 last:border-0">
          <div><p className="font-semibold">{name}</p><p className="mt-1 text-xs text-slate-500">{data.count} {data.count === 1 ? "servicio" : "servicios"}</p></div>
          <p className="font-semibold">{money(data.amount)}</p>
        </div>)}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-4"><h2 className="font-bold">Citas por profesional</h2><p className="mt-1 text-xs text-slate-500">Servicios completados entre las fechas seleccionadas.</p></div>
        {!topStaff.length && <p className="p-6 text-sm text-slate-500">No hay datos de profesionales para este período.</p>}
        {topStaff.map(([name, count]) => <div key={name} className="flex items-center justify-between gap-4 border-b border-slate-100 p-4 last:border-0">
          <p className="font-semibold">{name}</p><p className="text-sm text-slate-600">{count} {count === 1 ? "cita" : "citas"}</p>
        </div>)}
      </div>
    </section>
  </div>;
}

function Metric({ title, value }: { title: string; value: string }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-4">
    <p className="text-sm text-slate-500">{title}</p><p className="mt-2 text-2xl font-black tracking-tight">{value}</p>
  </article>;
}

function validDate(value?: string) {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}
