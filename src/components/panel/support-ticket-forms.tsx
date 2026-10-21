"use client";

import { useActionState } from "react";
import { createSupportTicketAction, replyToSupportTicketAction } from "@/app/actions/support";
import type { ActionState } from "@/app/actions/auth";

const initialState: ActionState = {};

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <p role="alert" className="mt-3 text-sm text-red-700">{state.error}</p>;
  if (state.success) return <p role="status" className="mt-3 text-sm text-emerald-700">{state.success}</p>;
  return null;
}

export function CreateSupportTicketForm() {
  const [state, action, pending] = useActionState(createSupportTicketAction, initialState);
  return <form action={action} className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
    <div className="sm:col-span-2">
      <h2 className="text-lg font-bold">Crear solicitud</h2>
      <p className="mt-1 text-sm text-slate-500">Cuéntanos qué ocurrió. La conversación y el estado se consultan aquí.</p>
    </div>
    <label className="text-sm font-semibold">Asunto
      <input name="subject" required minLength={4} maxLength={160} placeholder="Ej. No puedo guardar el horario" className="form-input mt-1" />
    </label>
    <label className="text-sm font-semibold">Tema
      <select name="category" className="form-input mt-1">
        <option value="reservas">Reservas</option><option value="pagos">Pagos</option>
        <option value="cuenta">Cuenta y plan</option><option value="tecnico">Problema técnico</option>
        <option value="otro">Otro</option>
      </select>
    </label>
    <label className="text-sm font-semibold sm:col-span-2">Describe la solicitud
      <textarea name="message" required maxLength={5000} rows={5} placeholder="Incluye los pasos para reproducir el problema. No escribas contraseñas ni datos sensibles." className="form-input mt-1 resize-y" />
    </label>
    <div className="sm:col-span-2">
      <button disabled={pending} className="min-h-11 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white disabled:opacity-60">
        {pending ? "Enviando…" : "Enviar ticket"}
      </button>
      <Feedback state={state} />
    </div>
  </form>;
}

export function SupportTicketReplyForm({ ticketId }: { ticketId: string }) {
  const [state, action, pending] = useActionState(replyToSupportTicketAction, initialState);
  return <form action={action} className="mt-4">
    <input type="hidden" name="ticketId" value={ticketId} />
    <label className="block text-sm font-semibold">Responder
      <textarea name="message" required maxLength={5000} rows={3} placeholder="Escribe una respuesta..." className="form-input mt-1 resize-y" />
    </label>
    <button disabled={pending} className="mt-2 min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-semibold disabled:opacity-60">
      {pending ? "Enviando…" : "Enviar respuesta"}
    </button>
    <Feedback state={state} />
  </form>;
}
