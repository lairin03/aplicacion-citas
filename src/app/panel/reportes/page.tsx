import { getProfessionalContext } from "@/lib/professional-access";
import { firstRelation, localDateAtOffset, localDateToUtc } from "@/lib/dates";
import { formatInTimeZone } from "date-fns-tz";

type SearchParams = Promise<{ from?: string; to?: string; staff?: string; service?: string; status?: string }>;
const statuses = ["pendiente", "confirmada", "completada", "cancelada", "no_asistió"] as const;
const statusLabels: Record<string, string> = {
  all: "Todos los estados", pendiente: "Pendientes", confirmada: "Confirmadas",
  completada: "Completadas", cancelada: "Canceladas", "no_asistió": "No asistió",
};
const money = (amount: number) => new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
}).format(amount);

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, business } = await getProfessionalContext("reports");
  const params = await searchParams;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: business.timezone }).format(new Date());
  const from = validDate(params.from) ? params.from! : localDateAtOffset(today, -29);
  const to = validDate(params.to) ? params.to! : today;
  const staffFilter = params.staff ?? "";
  const serviceFilter = params.service ?? "";
  const statusFilter = statuses.includes(params.status as typeof statuses[number]) ? params.status! : "all";
  if (from > to) throw new Error("La fecha inicial del reporte debe ser anterior a la fecha final.");
  if (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime() > 366 * 86_400_000) {
    throw new Error("El período máximo para los reportes es de 12 meses.");
  }

  const start = localDateToUtc(from, business.timezone).toISOString();
  const end = localDateToUtc(localDateAtOffset(to, 1), business.timezone).toISOString();
  const [
    { data: staffOptions, error: staffError },
    { data: serviceOptions, error: serviceError },
    { data: matchingServiceAppointments, error: serviceAppointmentsError },
  ] = await Promise.all([
    supabase.from("staff").select("id, name").eq("business_id", business.id).order("name"),
    supabase.from("services").select("id, name").eq("business_id", business.id).order("name"),
    serviceFilter
      ? supabase.from("appointment_services").select("appointment_id")
        .eq("business_id", business.id).eq("service_id", serviceFilter)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (staffError || serviceError || serviceAppointmentsError) {
    throw new Error("No se pudieron cargar los filtros de reportes.");
  }

  let appointmentsQuery = supabase.from("appointments")
    .select("id, status, starts_at, staff_id, services(name, price_cop), appointment_services(services(name, price_cop)), staff(name)")
    .eq("business_id", business.id)
    .gte("starts_at", start).lt("starts_at", end)
    .order("starts_at");
  if (staffFilter) appointmentsQuery = appointmentsQuery.eq("staff_id", staffFilter);
  if (statusFilter !== "all") appointmentsQuery = appointmentsQuery.eq("status", statusFilter);
  if (serviceFilter) {
    const matchingIds = [...new Set((matchingServiceAppointments ?? []).map((entry) => entry.appointment_id))];
    if (!matchingIds.length) appointmentsQuery = appointmentsQuery.eq("id", "00000000-0000-0000-0000-000000000000");
    else appointmentsQuery = appointmentsQuery.in("id", matchingIds);
  }
  const { data: appointments, error: appointmentsError } = await appointmentsQuery;
  if (appointmentsError) {
    throw new Error("No se pudieron cargar los datos de reportes.");
  }
  const appointmentIds = (appointments ?? []).map((appointment) => appointment.id);
  const { data: payments, error: paymentsError } = appointmentIds.length
    ? await supabase.from("appointment_payments").select("appointment_id, amount_cop, status, payment_date")
      .eq("business_id", business.id).gte("payment_date", from).lte("payment_date", to)
      .in("appointment_id", appointmentIds)
    : { data: [], error: null };
  if (paymentsError) {
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
  const weekly = new Map<string, { appointments: number; revenue: number }>();
  const weekStartFor = (date: string) => {
    const parsedDate = new Date(`${date}T00:00:00Z`);
    const day = parsedDate.getUTCDay();
    parsedDate.setUTCDate(parsedDate.getUTCDate() - ((day + 6) % 7));
    return parsedDate.toISOString().slice(0, 10);
  };
  for (const appointment of completed) {
    const week = weekStartFor(formatInTimeZone(new Date(appointment.starts_at), business.timezone, "yyyy-MM-dd"));
    const current = weekly.get(week) ?? { appointments: 0, revenue: 0 };
    current.appointments += 1;
    weekly.set(week, current);
  }
  for (const payment of payments ?? []) {
    if (payment.status !== "paid") continue;
    const week = weekStartFor(payment.payment_date);
    const current = weekly.get(week) ?? { appointments: 0, revenue: 0 };
    current.revenue += payment.amount_cop;
    weekly.set(week, current);
  }
  const weeklyRecords = [...weekly].sort(([a], [b]) => a.localeCompare(b))
    .map(([week, data]) => ({ label: new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${week}T00:00:00Z`)), ...data }));

  return <div>
    <h1 className="text-2xl font-bold tracking-tight">Reportes</h1>
    <p className="mt-1 text-sm text-slate-600">Resumen de citas, servicios y pagos de {business.name}.</p>
    <form className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-5">
      <label className="text-xs font-medium text-slate-500">Desde<input name="from" type="date" defaultValue={from} className="form-input mt-1" /></label>
      <label className="text-xs font-medium text-slate-500">Hasta<input name="to" type="date" defaultValue={to} className="form-input mt-1" /></label>
      <label className="text-xs font-medium text-slate-500">Profesional
        <select name="staff" defaultValue={staffFilter} className="form-input mt-1"><option value="">Todos</option>{(staffOptions ?? []).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
      </label>
      <label className="text-xs font-medium text-slate-500">Servicio
        <select name="service" defaultValue={serviceFilter} className="form-input mt-1"><option value="">Todos</option>{(serviceOptions ?? []).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select>
      </label>
      <label className="text-xs font-medium text-slate-500">Estado
        <select name="status" defaultValue={statusFilter} className="form-input mt-1">{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      </label>
      <button className="min-h-12 self-end rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">Actualizar reporte</button>
    </form>

    <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric title="Citas completadas" value={String(completed.length)} />
      <Metric title="Ingresos pagados" value={money(paidRevenue)} />
      <Metric title="Reembolsos" value={money(refunds)} />
      <Metric title="Pagos pendientes" value={money(pending)} />
    </section>

    <section className="mt-6 grid gap-5 lg:grid-cols-2">
      <ChartCard title="Citas completadas por semana" data={weeklyRecords.map((record) => ({ label: record.label, value: record.appointments }))} color="#0284c7" formatValue={(value) => String(value)} />
      <ChartCard title="Ingresos pagados por semana" data={weeklyRecords.map((record) => ({ label: record.label, value: record.revenue }))} color="#d97706" formatValue={money} />
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

function ChartCard({
  title,
  data,
  color,
  formatValue,
}: {
  title: string;
  data: { label: string; value: number }[];
  color: string;
  formatValue: (value: number) => string;
}) {
  const maxValue = Math.max(1, ...data.map((entry) => entry.value));
  const barWidth = data.length ? 720 / data.length : 0;
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <h2 className="font-bold">{title}</h2>
    {!data.length && <p className="mt-4 text-sm text-slate-500">No hay datos para mostrar en este período.</p>}
    {!!data.length && <>
      <div className="mt-4 overflow-x-auto">
        <svg role="img" aria-label={title} viewBox="0 0 760 220" className="min-w-[540px] w-full">
          <line x1="24" y1="190" x2="748" y2="190" stroke="#cbd5e1" />
          {data.map((entry, index) => {
            const height = entry.value ? Math.max(2, (entry.value / maxValue) * 150) : 0;
            const x = 30 + index * barWidth + Math.max(2, barWidth * 0.18);
            return <g key={`${entry.label}-${index}`}>
              <title>{entry.label}: {formatValue(entry.value)}</title>
              <rect x={x} y={190 - height} width={Math.max(4, barWidth * 0.64)} height={height} rx="4" fill={color} />
              {data.length <= 16 && <text x={x + barWidth * 0.32} y="210" textAnchor="middle" fontSize="10" fill="#64748b">{entry.label}</text>}
            </g>;
          })}
        </svg>
      </div>
      <div className="mt-2 max-h-28 overflow-y-auto text-xs text-slate-600">
        {data.map((entry) => <p key={entry.label} className="flex justify-between gap-3 border-b border-slate-100 py-1"><span>{entry.label}</span><strong>{formatValue(entry.value)}</strong></p>)}
      </div>
    </>}
  </section>;
}

function Metric({ title, value }: { title: string; value: string }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-4">
    <p className="text-sm text-slate-500">{title}</p><p className="mt-2 text-2xl font-black tracking-tight">{value}</p>
  </article>;
}

function validDate(value?: string) {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}
