import Link from "next/link";
import { businessLocalDate, firstRelation, localDateToUtc, localDateAtOffset, formatBusinessDateTime } from "@/lib/dates";
import { getBusinessFeatureContext } from "@/lib/professional-access";

type SearchParams = Promise<{ q?: string; from?: string; to?: string }>;
const statusNames: Record<string, string> = {
  pendiente: "Pendiente", confirmada: "Confirmada", completada: "Completada",
  cancelada: "Cancelada", "no_asistió": "No asistió",
};

export default async function HistoryPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const query = (params.q ?? "").trim().slice(0, 80);
  const { supabase, business } = await getBusinessFeatureContext("customer_history");

  let customerIds: string[] | null = null;
  if (query) {
    const [{ data: byName, error: nameError }, { data: byPhone, error: phoneError }] = await Promise.all([
      supabase.from("customers").select("id").eq("business_id", business.id).ilike("name", `%${query}%`).limit(50),
      supabase.from("customers").select("id").eq("business_id", business.id).ilike("phone", `%${query}%`).limit(50),
    ]);
    if (nameError || phoneError) throw new Error("No se pudo buscar el cliente.");
    customerIds = [...new Set([...(byName ?? []), ...(byPhone ?? [])].map((customer) => customer.id))];
  }

  const today = businessLocalDate(new Date(), business.timezone);
  const from = validDate(params.from) ? params.from! : localDateAtOffset(today, -90);
  const to = validDate(params.to) ? params.to! : today;
  let appointmentsQuery = supabase.from("appointments")
    .select("id, customer_id, starts_at, ends_at, status, customers(name, phone), services(name, price_cop), appointment_services(services(name)), staff(name)")
    .eq("business_id", business.id)
    .gte("starts_at", localDateToUtc(from, business.timezone).toISOString())
    .lt("starts_at", localDateToUtc(localDateAtOffset(to, 1), business.timezone).toISOString())
    .order("starts_at", { ascending: false }).limit(300);
  if (customerIds) {
    if (!customerIds.length) appointmentsQuery = appointmentsQuery.eq("id", "00000000-0000-0000-0000-000000000000");
    else appointmentsQuery = appointmentsQuery.in("customer_id", customerIds);
  }
  const { data: appointments, error } = await appointmentsQuery;
  if (error) throw new Error("No se pudo cargar el historial.");

  return <div>
    <h1 className="text-2xl font-bold tracking-tight">Historial de citas</h1>
    <p className="mt-1 text-sm text-slate-600">Busca por nombre o celular y limita por fechas.</p>
    <form className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-4">
      <input name="q" defaultValue={query} placeholder="Nombre o celular" className="form-input mt-0" />
      <label className="text-xs font-medium text-slate-500">Desde<input name="from" type="date" defaultValue={from} className="form-input mt-1" /></label>
      <label className="text-xs font-medium text-slate-500">Hasta<input name="to" type="date" defaultValue={to} className="form-input mt-1" /></label>
      <button className="min-h-12 self-end rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">Buscar</button>
    </form>
    <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {!appointments?.length && <p className="p-8 text-center text-sm text-slate-500">No hay citas para los filtros seleccionados.</p>}
      {appointments?.map((appointment) => {
        const serviceNames = (appointment.appointment_services ?? [])
          .map((entry) => firstRelation(entry.services)?.name)
          .filter((name) => name !== undefined)
          .join(" + ");
        return <article key={appointment.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 last:border-0">
          <div><p className="font-semibold">{firstRelation(appointment.customers)?.name ?? "Cliente"}</p>
            <p className="mt-1 text-sm text-slate-600">{formatBusinessDateTime(appointment.starts_at, business.timezone)} · {serviceNames}</p>
            <p className="mt-1 text-xs text-slate-500">{firstRelation(appointment.customers)?.phone} · {firstRelation(appointment.staff)?.name} · {statusNames[appointment.status]}</p></div>
          {appointment.customer_id && <Link href={`/panel/clientes/${appointment.customer_id}`} className="text-sm font-semibold text-amber-800">Ver cliente</Link>}
        </article>;
      })}
    </div>
  </div>;
}

function validDate(value?: string) {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}
