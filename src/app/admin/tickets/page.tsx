import { redirect } from "next/navigation";
import { updateSupportTicketStatusAction } from "@/app/actions/support";
import { SupportTicketReplyForm } from "@/components/panel/support-ticket-forms";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isConfirmedSuperAdmin } from "@/lib/super-admin";

type SearchParams = Promise<{ status?: string; saved?: string }>;
const statusLabels: Record<string, string> = { open: "Abierto", in_progress: "En proceso", resolved: "Resuelto" };
const categoryLabels: Record<string, string> = {
  reservas: "Reservas", pagos: "Pagos", cuenta: "Cuenta y plan", tecnico: "Problema técnico", otro: "Otro",
};

export default async function AdminTicketsPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");
  if (!isConfirmedSuperAdmin(user)) redirect("/panel");

  const params = await searchParams;
  const selectedStatus = ["open", "in_progress", "resolved"].includes(params.status ?? "")
    ? params.status!
    : "";
  const admin = createAdminClient();
  let ticketsQuery = admin.from("support_tickets")
    .select("id, business_id, subject, category, status, created_at, updated_at")
    .order("updated_at", { ascending: false }).limit(300);
  if (selectedStatus) ticketsQuery = ticketsQuery.eq("status", selectedStatus);
  const { data: tickets, error: ticketsError } = await ticketsQuery;
  if (ticketsError) throw new Error("No se pudieron cargar los tickets de soporte.");

  const businessIds = [...new Set((tickets ?? []).map((ticket) => ticket.business_id))];
  const ticketIds = (tickets ?? []).map((ticket) => ticket.id);
  const [{ data: businesses, error: businessesError }, { data: messages, error: messagesError }] = await Promise.all([
    businessIds.length
      ? admin.from("businesses").select("id, name, slug").in("id", businessIds)
      : Promise.resolve({ data: [], error: null }),
    ticketIds.length
      ? admin.from("support_ticket_messages").select("id, ticket_id, author_role, body, created_at")
        .in("ticket_id", ticketIds).order("created_at")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (businessesError || messagesError) throw new Error("No se pudieron cargar los detalles de los tickets.");
  const businessById = new Map((businesses ?? []).map((business) => [business.id, business]));

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-8">
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-sm font-bold uppercase tracking-widest text-sky-700">Superadministración</p><h1 className="mt-2 text-3xl font-black">Tickets de soporte</h1><p className="mt-2 text-sm text-slate-600">Solicitudes enviadas por los negocios y conversación con cada uno.</p></div>
        <a href="/admin/suscripciones" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold">Suscripciones</a>
      </header>
      {params.saved && <p role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">El ticket se actualizó.</p>}
      <form className="mt-5 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <label className="text-xs font-semibold text-slate-600">Filtrar estado
          <select name="status" defaultValue={selectedStatus} className="form-input mt-1">
            <option value="">Todos</option><option value="open">Abiertos</option><option value="in_progress">En proceso</option><option value="resolved">Resueltos</option>
          </select>
        </label>
        <button className="min-h-11 rounded-lg bg-slate-950 px-4 text-sm font-bold text-white">Filtrar</button>
      </form>
      <section className="mt-5 space-y-4">
        {!tickets?.length && <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No hay tickets para este filtro.</p>}
        {tickets?.map((ticket) => {
          const business = businessById.get(ticket.business_id);
          return <article key={ticket.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-xs font-bold uppercase tracking-wide text-sky-800">{business?.name ?? "Negocio eliminado"}{business ? ` · /b/${business.slug}` : ""}</p>
                <h2 className="mt-1 text-lg font-bold">{ticket.subject}</h2><p className="mt-1 text-xs text-slate-500">{categoryLabels[ticket.category]} · {new Date(ticket.created_at).toLocaleString("es-CO")}</p></div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{statusLabels[ticket.status]}</span>
            </header>
            <div className="mt-4 space-y-3">
              {(messages ?? []).filter((message) => message.ticket_id === ticket.id).map((message) => <div key={message.id} className={`rounded-xl p-3 ${message.author_role === "admin" ? "bg-sky-50" : "bg-slate-50"}`}>
                <p className="text-xs font-bold text-slate-600">{message.author_role === "admin" ? "Soporte Agenda Laii" : "Negocio"} · {new Date(message.created_at).toLocaleString("es-CO")}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{message.body}</p>
              </div>)}
            </div>
            <SupportTicketReplyForm ticketId={ticket.id} />
            <form action={updateSupportTicketStatusAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
              <input type="hidden" name="ticketId" value={ticket.id} />
              <label className="text-xs font-semibold text-slate-600">Estado
                <select name="status" defaultValue={ticket.status} className="form-input mt-1">
                  <option value="open">Abierto</option><option value="in_progress">En proceso</option><option value="resolved">Resuelto</option>
                </select>
              </label>
              <button className="min-h-10 rounded-lg bg-slate-950 px-4 text-sm font-bold text-white">Actualizar estado</button>
            </form>
          </article>;
        })}
      </section>
    </div>
  </main>;
}
