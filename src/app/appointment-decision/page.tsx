import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import { processAppointmentDecisionAction } from "@/app/actions/appointment-approval";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatBusinessDateTime } from "@/lib/dates";

type SearchParams = Promise<{ token?: string; decision?: string; result?: string }>;

const resultMessages: Record<string, { title: string; detail: string }> = {
  confirmed: { title: "Cita aceptada", detail: "La cita quedó confirmada y se notificó a la clienta por WhatsApp." },
  "confirmed-not-sent": { title: "Cita aceptada, notificación pendiente", detail: "La cita quedó confirmada, pero no se pudo notificar a la clienta por WhatsApp. Revisa la configuración de Whapi." },
  rejected: { title: "Solicitud rechazada", detail: "La solicitud se rechazó y se notificó a la clienta por WhatsApp." },
  "rejected-not-sent": { title: "Solicitud rechazada, notificación pendiente", detail: "La solicitud se rechazó, pero no se pudo notificar a la clienta por WhatsApp. Revisa la configuración de Whapi." },
  expired: { title: "Enlace vencido", detail: "Este enlace de aprobación venció. La cita no fue modificada." },
  processed: { title: "Solicitud ya procesada", detail: "Esta cita ya fue aceptada, rechazada o modificada anteriormente." },
  invalid: { title: "Enlace no válido", detail: "No se pudo validar el enlace de aprobación." },
  error: { title: "No se pudo procesar", detail: "Ocurrió un error al procesar la decisión. Intenta nuevamente o abre la agenda." },
};

export default async function AppointmentDecisionPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  if (params.result) {
    const message = resultMessages[params.result];
    if (!message) notFound();
    return <DecisionMessage title={message.title} detail={message.detail} />;
  }

  const token = params.token;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) notFound();

  const admin = createAdminClient();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data: approval, error: approvalError } = await admin
    .from("appointment_decision_tokens")
    .select("appointment_id, expires_at, used_at, decision")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (approvalError) throw new Error("No se pudo validar el enlace de aprobación.");
  if (!approval) notFound();
  if (approval.used_at) {
    return <DecisionMessage
      title="Solicitud ya procesada"
      detail={approval.decision === "confirmada"
        ? "Esta cita ya había sido aceptada."
        : "Esta cita ya había sido rechazada."}
    />;
  }
  if (new Date(approval.expires_at) <= new Date()) {
    return <DecisionMessage title="Enlace vencido" detail="La cita no fue modificada. Solicita revisar la reserva desde la agenda." />;
  }

  const { data: appointment, error: appointmentError } = await admin.from("appointments")
    .select("id, starts_at, business_id, customer_id, staff_id")
    .eq("id", approval.appointment_id)
    .maybeSingle();
  if (appointmentError) throw new Error("No se pudo consultar la cita.");
  if (!appointment) notFound();

  const [{ data: business }, { data: customer }, { data: staff }, { data: appointmentServices, error: appointmentServicesError }] = await Promise.all([
    admin.from("businesses").select("name, timezone").eq("id", appointment.business_id).maybeSingle(),
    admin.from("customers").select("name, phone").eq("id", appointment.customer_id).maybeSingle(),
    admin.from("staff").select("name").eq("id", appointment.staff_id).maybeSingle(),
    admin.from("appointment_services").select("service_id").eq("appointment_id", appointment.id),
  ]);
  if (!business || !customer || !staff) throw new Error("Faltan datos asociados a la cita.");
  if (appointmentServicesError) throw new Error("No se pudieron consultar los servicios de la cita.");
  const serviceIds = appointmentServices?.map((entry) => entry.service_id) ?? [];
  const { data: services, error: servicesError } = serviceIds.length
    ? await admin.from("services").select("name").in("id", serviceIds)
    : { data: [], error: null };
  if (servicesError) throw new Error("No se pudieron consultar los servicios de la cita.");
  const serviceNames = services?.map((service) => service.name).join(", ") || "Servicio";
  const preferredDecision = params.decision === "cancelada" ? "cancelada" : "confirmada";

  return <main className="flex min-h-screen items-center justify-center bg-sky-50 px-4 py-8 text-slate-950">
    <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
      <p className="text-xs font-bold uppercase tracking-widest text-sky-700">Agenda Laii · Aprobación de cita</p>
      <h1 className="mt-3 text-2xl font-black">Solicitud para {business.name}</h1>
      <div className="mt-5 space-y-2 rounded-2xl bg-slate-50 p-4 text-sm">
        <p><strong>Cliente:</strong> {customer.name}</p>
        <p><strong>Celular:</strong> {customer.phone}</p>
        <p><strong>Servicio:</strong> {serviceNames}</p>
        <p><strong>Profesional:</strong> {staff.name}</p>
        <p><strong>Fecha:</strong> {formatBusinessDateTime(appointment.starts_at, business.timezone)}</p>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-600">
        Elige aceptar para confirmar la cita o rechazar la solicitud. La clienta recibirá por WhatsApp el resultado de la decisión.
      </p>
      <form action={processAppointmentDecisionAction} className="mt-6 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="token" value={token} />
        <button name="decision" value={preferredDecision} className={`min-h-12 rounded-xl px-4 font-bold text-white ${preferredDecision === "confirmada" ? "bg-sky-700 hover:bg-sky-800" : "bg-rose-700 hover:bg-rose-800"}`}>
          {preferredDecision === "confirmada" ? "Aceptar cita" : "Rechazar cita"}
        </button>
        <button name="decision" value={preferredDecision === "confirmada" ? "cancelada" : "confirmada"} className={`min-h-12 rounded-xl px-4 font-bold ${preferredDecision === "confirmada" ? "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50" : "bg-sky-700 text-white hover:bg-sky-800"}`}>
          {preferredDecision === "confirmada" ? "Rechazar cita" : "Aceptar cita"}
        </button>
      </form>
      <p className="mt-4 text-center text-xs text-slate-400">Enlace de un solo uso. Vence en 24 horas.</p>
    </section>
  </main>;
}

function DecisionMessage({ title, detail }: { title: string; detail: string }) {
  return <main className="flex min-h-screen items-center justify-center bg-sky-50 px-4 py-8 text-slate-950">
    <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl">
      <h1 className="text-2xl font-black">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">{detail}</p>
    </section>
  </main>;
}
