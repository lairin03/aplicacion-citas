import { createAppointmentPaymentAction, updateAppointmentPaymentStatusAction } from "@/app/actions/professional";
import { firstRelation, formatBusinessDateTime, localDateAtOffset, localDateToUtc } from "@/lib/dates";
import { getProfessionalContext } from "@/lib/professional-access";

type SearchParams = Promise<{ date?: string; payment?: string }>;
const paymentMethods: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
  other: "Otro",
};
const paymentStatuses: Record<string, string> = {
  paid: "Pagado",
  pending: "Pendiente",
  refunded: "Reembolsado",
};
const money = (amount: number) => new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
}).format(amount);

export default async function CashRegisterPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, business } = await getProfessionalContext("cash");
  const params = await searchParams;
  const date = isDate(params.date) ? params.date! : todayInZone(business.timezone);
  const appointmentCutoff = localDateToUtc(localDateAtOffset(date, 90), business.timezone).toISOString();
  const [{ data: payments, error: paymentsError }, { data: appointments, error: appointmentsError }] = await Promise.all([
    supabase.from("appointment_payments")
      .select("id, amount_cop, method, status, payment_date, note, appointments(id, starts_at, customers(name), services(name), appointment_services(services(name)), staff(name))")
      .eq("business_id", business.id)
      .eq("payment_date", date)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("appointments")
      .select("id, starts_at, status, customers(name), services(name), appointment_services(services(name)), staff(name)")
      .eq("business_id", business.id)
      .neq("status", "cancelada")
      .gte("starts_at", localDateToUtc(localDateAtOffset(date, -90), business.timezone).toISOString())
      .lte("starts_at", appointmentCutoff)
      .order("starts_at", { ascending: false })
      .limit(200),
  ]);
  if (paymentsError || appointmentsError) {
    throw new Error("No se pudieron cargar los movimientos de caja o las citas.");
  }

  const rows = payments ?? [];
  const paid = rows.filter((payment) => payment.status === "paid")
    .reduce((sum, payment) => sum + payment.amount_cop, 0);
  const pending = rows.filter((payment) => payment.status === "pending")
    .reduce((sum, payment) => sum + payment.amount_cop, 0);
  const refunded = rows.filter((payment) => payment.status === "refunded")
    .reduce((sum, payment) => sum + payment.amount_cop, 0);
  const net = paid - refunded;

  return <div>
    <h1 className="text-2xl font-bold tracking-tight">Caja</h1>
    <p className="mt-1 text-sm text-slate-600">Registra y consulta los pagos asociados a las citas de {business.name}.</p>
    {params.payment && <p role="status" className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm font-medium text-sky-900">
      {params.payment === "saved" ? "Pago registrado." : "Estado del pago actualizado."}
    </p>}

    <form className="mt-5 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <label className="text-xs font-medium text-slate-500">Día
        <input type="date" name="date" defaultValue={date} className="form-input mt-1" />
      </label>
      <button className="min-h-12 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">Consultar caja</button>
    </form>

    <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric title="Ingresos pagados" amount={money(paid)} />
      <Metric title="Pendiente de pago" amount={money(pending)} />
      <Metric title="Reembolsos" amount={money(refunded)} />
      <Metric title="Total neto" amount={money(net)} />
    </section>

    <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,.8fr)]">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-4">
          <h2 className="font-bold">Movimientos del {date}</h2>
          <p className="mt-1 text-xs text-slate-500">Los pagos pendientes no se suman a los ingresos recibidos.</p>
        </div>
        {!rows.length && <p className="p-8 text-center text-sm text-slate-500">No hay movimientos para este día.</p>}
        <div className="divide-y divide-slate-100">
          {rows.map((payment) => {
            const appointment = firstRelation(payment.appointments);
            const serviceNames = (appointment?.appointment_services ?? [])
              .map((entry) => firstRelation(entry.services)?.name)
              .filter((name): name is string => !!name)
              .join(" + ") || firstRelation(appointment?.services)?.name || "Servicio";
            return <article key={payment.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-semibold">{money(payment.amount_cop)} · {paymentStatuses[payment.status]}</p>
                <p className="mt-1 truncate text-sm text-slate-600">{firstRelation(appointment?.customers)?.name ?? "Cliente"} · {serviceNames}</p>
                <p className="mt-1 text-xs text-slate-500">{paymentMethods[payment.method]} · {appointment ? formatBusinessDateTime(appointment.starts_at, business.timezone) : ""}{payment.note ? ` · ${payment.note}` : ""}</p>
              </div>
              <form action={updateAppointmentPaymentStatusAction} className="flex items-center gap-2">
                <input type="hidden" name="paymentId" value={payment.id} />
                <select name="status" defaultValue={payment.status} aria-label="Estado del pago" className="min-h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm">
                  <option value="paid">Pagado</option><option value="pending">Pendiente</option><option value="refunded">Reembolsado</option>
                </select>
                <button className="min-h-10 rounded-lg bg-slate-950 px-3 text-xs font-semibold text-white">Actualizar</button>
              </form>
            </article>;
          })}
        </div>
      </div>

      <form action={createAppointmentPaymentAction} className="h-fit rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-bold">Registrar pago de una cita</h2>
        <label className="mt-4 block text-sm font-medium">Cita
          <select name="appointmentId" required defaultValue="" className="form-input">
            <option value="" disabled>Selecciona una cita</option>
            {(appointments ?? []).map((appointment) => {
              const customer = firstRelation(appointment.customers)?.name ?? "Cliente";
              const services = (appointment.appointment_services ?? [])
                .map((entry) => firstRelation(entry.services)?.name)
                .filter((name): name is string => !!name)
                .join(" + ") || firstRelation(appointment.services)?.name || "Servicio";
              return <option key={appointment.id} value={appointment.id}>
                {formatBusinessDateTime(appointment.starts_at, business.timezone)} · {customer} · {services}
              </option>;
            })}
          </select>
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">Monto (COP)
            <input name="amount" type="number" min="1" max="2000000000" step="1" required className="form-input" />
          </label>
          <label className="text-sm font-medium">Fecha
            <input name="paymentDate" type="date" required defaultValue={date} className="form-input" />
          </label>
          <label className="text-sm font-medium">Método
            <select name="method" defaultValue="cash" className="form-input">
              <option value="cash">Efectivo</option><option value="card">Tarjeta</option>
              <option value="transfer">Transferencia</option><option value="other">Otro</option>
            </select>
          </label>
          <label className="text-sm font-medium">Estado
            <select name="status" defaultValue="paid" className="form-input">
              <option value="paid">Pagado</option><option value="pending">Pendiente</option><option value="refunded">Reembolsado</option>
            </select>
          </label>
        </div>
        <label className="mt-3 block text-sm font-medium">Nota (opcional)
          <input name="note" maxLength={300} className="form-input" placeholder="Referencia o detalle del pago" />
        </label>
        <button className="mt-5 min-h-12 w-full rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">Guardar movimiento</button>
      </form>
    </section>
  </div>;
}

function Metric({ title, amount }: { title: string; amount: string }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-4">
    <p className="text-sm text-slate-500">{title}</p>
    <p className="mt-2 text-2xl font-black tracking-tight">{amount}</p>
  </article>;
}

function isDate(value?: string) {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function todayInZone(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}
