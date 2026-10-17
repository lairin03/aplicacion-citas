"use client";

import { useActionState } from "react";
import { updateAppointmentStatusAction } from "@/app/actions/panel";
import type { ActionState } from "@/app/actions/auth";

const initialState: ActionState = {};

export function AppointmentStatusForm({ appointmentId, status }: { appointmentId: string; status: string }) {
  const [state, formAction, pending] = useActionState(updateAppointmentStatusAction, initialState);
  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-center gap-2">
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <select name="status" defaultValue={status} aria-label="Estado de la cita" className="min-h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm">
        <option value="pendiente">Pendiente</option><option value="confirmada">Confirmada</option>
        <option value="completada">Completada</option><option value="cancelada">Cancelada</option>
        <option value="no_asistió">No asistió</option>
      </select>
      <button disabled={pending} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">
        {pending ? "Guardando…" : "Guardar"}
      </button>
      {state.error && <span role="alert" className="w-full text-xs text-red-700">{state.error}</span>}
      {state.success && <span role="status" className="w-full text-xs text-emerald-700">{state.success}</span>}
    </form>
  );
}
