import Link from "next/link";
import { notFound } from "next/navigation";
import { FeedbackForm } from "@/components/panel/feedback";
import { updateCustomerNotesAction } from "@/app/actions/panel";
import { firstRelation, formatBusinessDateTime } from "@/lib/dates";
import { getBusinessFeatureContext } from "@/lib/professional-access";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const { supabase, business } = await getBusinessFeatureContext("customer_history");

  const [{ data: customer, error: customerError }, { data: appointments, error: appointmentsError }] = await Promise.all([
    supabase.from("customers").select("id, name, phone, notes, created_at")
      .eq("id", id).eq("business_id", business.id).maybeSingle(),
    supabase.from("appointments").select("id, starts_at, status, services(name, price_cop), appointment_services(services(name)), staff(name)")
      .eq("customer_id", id).eq("business_id", business.id).order("starts_at", { ascending: false }).limit(100),
  ]);
  if (customerError || appointmentsError) throw new Error("No se pudo cargar la ficha del cliente.");
  if (!customer) notFound();

  return <div>
    <Link href="/panel/clientes" className="text-sm font-semibold text-amber-800">← Volver a clientes</Link>
    <h1 className="mt-4 text-2xl font-bold">{customer.name}</h1>
    <p className="mt-1 text-slate-600">{customer.phone}</p>
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold">Notas del cliente</h2>
      <FeedbackForm action={updateCustomerNotesAction} className="mt-3">
        <input type="hidden" name="customerId" value={customer.id} />
        <textarea name="notes" defaultValue={customer.notes ?? ""} maxLength={2000} rows={4} className="form-input resize-y" placeholder="Preferencias, observaciones..." />
      </FeedbackForm>
    </section>
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold">Historial de visitas</h2>
      {!appointments?.length && <p className="mt-4 text-sm text-slate-500">Este cliente aún no tiene citas.</p>}
      <div className="mt-3 divide-y divide-slate-100">
        {appointments?.map((appointment) => {
          const serviceNames = (appointment.appointment_services ?? [])
            .map((entry) => firstRelation(entry.services)?.name)
            .filter((name) => name !== undefined)
            .join(" + ");
          return <article key={appointment.id} className="py-3">
            <p className="font-medium">{serviceNames} · {firstRelation(appointment.staff)?.name}</p>
            <p className="mt-1 text-sm text-slate-500">{formatBusinessDateTime(appointment.starts_at, business.timezone)} · {appointment.status}</p>
          </article>;
        })}
      </div>
    </section>
  </div>;
}
