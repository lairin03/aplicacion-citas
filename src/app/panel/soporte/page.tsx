import { CreateSupportTicketForm, SupportTicketReplyForm } from "@/components/panel/support-ticket-forms";
import { createClient } from "@/lib/supabase/server";
import { selectCurrentBusiness } from "@/lib/business-selection";

const statusLabels: Record<string, string> = {
  open: "Abierto",
  in_progress: "En proceso",
  resolved: "Resuelto",
};
const categoryLabels: Record<string, string> = {
  reservas: "Reservas",
  pagos: "Pagos",
  cuenta: "Cuenta y plan",
  tecnico: "Problema técnico",
  otro: "Otro",
};

export default async function SupportPage() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Debes iniciar sesión para consultar soporte.");
  const { data: businesses, error: businessesError } = await supabase.from("businesses")
    .select("id, name").eq("owner_id", user.id).order("name");
  if (businessesError) throw new Error("No se pudo cargar el negocio de soporte.");
  const business = await selectCurrentBusiness(businesses ?? []);
  if (!business) throw new Error("Crea un negocio antes de abrir un ticket.");

  const { data: tickets, error: ticketsError } = await supabase.from("support_tickets")
    .select("id, subject, category, status, created_at, updated_at")
    .eq("business_id", business.id).order("updated_at", { ascending: false }).limit(100);
  if (ticketsError) throw new Error("No se pudieron cargar tus tickets.");
  const ticketIds = (tickets ?? []).map((ticket) => ticket.id);
  const { data: messages, error: messagesError } = ticketIds.length
    ? await supabase.from("support_ticket_messages")
      .select("id, ticket_id, author_role, body, created_at")
      .eq("business_id", business.id).in("ticket_id", ticketIds).order("created_at")
    : { data: [], error: null };
  if (messagesError) throw new Error("No se pudo cargar la conversación de soporte.");

  return <div>
    <p className="text-xs font-bold uppercase tracking-widest text-amber-800">Ayuda para {business.name}</p>
    <h1 className="mt-2 text-2xl font-bold tracking-tight">Soporte</h1>
    <p className="mt-1 text-sm text-slate-600">Crea una solicitud y sigue aquí su estado y las respuestas del equipo.</p>
    <div className="mt-6"><CreateSupportTicketForm /></div>
    <section className="mt-7 space-y-4">
      <h2 className="text-lg font-bold">Tus tickets</h2>
      {!tickets?.length && <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Todavía no has enviado solicitudes.</p>}
      {tickets?.map((ticket) => <article key={ticket.id} className="rounded-2xl border border-slate-200 bg-white p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div><h3 className="font-bold">{ticket.subject}</h3><p className="mt-1 text-xs text-slate-500">{categoryLabels[ticket.category]} · Creado {new Date(ticket.created_at).toLocaleString("es-CO")}</p></div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${ticket.status === "resolved" ? "bg-emerald-100 text-emerald-800" : ticket.status === "in_progress" ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-900"}`}>{statusLabels[ticket.status]}</span>
        </header>
        <div className="mt-4 space-y-3">
          {(messages ?? []).filter((message) => message.ticket_id === ticket.id).map((message) => <div key={message.id} className={`rounded-xl p-3 ${message.author_role === "admin" ? "bg-sky-50" : "bg-slate-50"}`}>
            <p className="text-xs font-bold text-slate-600">{message.author_role === "admin" ? "Soporte Agenda Clara" : "Tu negocio"} · {new Date(message.created_at).toLocaleString("es-CO")}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{message.body}</p>
          </div>)}
        </div>
        {ticket.status !== "resolved" && <SupportTicketReplyForm ticketId={ticket.id} />}
      </article>)}
    </section>
  </div>;
}
