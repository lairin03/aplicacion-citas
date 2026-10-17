"use client";

import { useActionState, useState } from "react";
import { createBusinessAction } from "@/app/actions/onboarding";
import type { ActionState } from "@/app/actions/auth";

const initialState: ActionState = {};

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function BusinessForm({ ownerId }: { ownerId?: string }) {
  const [state, formAction, pending] = useActionState(createBusinessAction, initialState);
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

  return (
    <form action={formAction} className="space-y-6 sm:space-y-8">
      {ownerId && <input type="hidden" name="adminOwnerId" value={ownerId} />}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Tu negocio</h2>
        <label className="block text-sm font-medium">Nombre
          <input name="name" required minLength={2} maxLength={120} onChange={(event) => {
            if (!slugEdited) setSlug(slugify(event.target.value));
          }} className="form-input" />
        </label>
        <label className="block text-sm font-medium">Enlace público
          <div className="mt-2 flex items-center overflow-hidden rounded-xl border border-slate-200 focus-within:border-amber-600">
            <span className="whitespace-nowrap bg-slate-50 px-3 py-3 text-sm text-slate-500">/b/</span>
            <input name="slug" value={slug} onChange={(event) => {
              setSlug(slugify(event.target.value));
              setSlugEdited(true);
            }} required pattern="[a-z0-9]+(-[a-z0-9]+)*" className="min-h-12 min-w-0 flex-1 px-3 outline-none" />
          </div>
        </label>
        <label className="block text-sm font-medium">Tipo de negocio
          <select name="type" className="form-input">
            <option value="barbería">Barbería</option><option value="peluquería">Peluquería</option>
            <option value="manicura">Manicura</option><option value="lashista">Lashista</option>
            <option value="consultorio">Consultorio</option>
            <option value="profesional_independiente">Profesional independiente</option>
            <option value="otro">Otro</option>
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">Teléfono
            <input name="phone" type="tel" className="form-input" />
          </label>
          <label className="block text-sm font-medium">WhatsApp del negocio
            <input name="whatsapp" type="tel" className="form-input" />
          </label>
        </div>
        <label className="block text-sm font-medium">Dirección
          <input name="address" className="form-input" />
        </label>
        <label className="block text-sm font-medium">Zona horaria
          <select name="timezone" defaultValue="America/Bogota" className="form-input">
            <option value="America/Bogota">Bogotá (UTC-5)</option>
            <option value="America/Mexico_City">Ciudad de México</option>
            <option value="America/Lima">Lima</option>
            <option value="America/Santiago">Santiago</option>
          </select>
        </label>
      </section>
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Primer servicio y profesional</h2>
        <label className="block text-sm font-medium">Nombre del profesional
          <input name="staffName" required minLength={2} className="form-input" />
        </label>
        <label className="block text-sm font-medium">Correo del profesional
          <input name="staffEmail" type="email" autoComplete="email" required className="form-input" />
          <span className="mt-1 block text-xs font-normal text-slate-500">Aquí enviaremos las solicitudes de cita para aceptar o rechazar.</span>
        </label>
        <label className="block text-sm font-medium">Servicio
          <input name="serviceName" required minLength={2} className="form-input" />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">Duración (minutos)
            <input name="serviceDuration" type="number" min={5} max={1440} defaultValue={30} required className="form-input" />
          </label>
          <label className="block text-sm font-medium">Precio (COP)
            <input name="servicePrice" type="number" min={0} step={1000} defaultValue={30000} required className="form-input" />
          </label>
        </div>
      </section>
      <section className="space-y-4">
        <div><h2 className="text-lg font-semibold">Horario de atención</h2>
          <p className="mt-1 text-sm text-slate-500">Puedes ajustar estos horarios después desde la configuración.</p></div>
        <div className="space-y-3">
          {days.map((day, weekday) => (
            <div key={day} className="grid grid-cols-2 gap-3 rounded-xl border border-slate-100 p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
              <span className="text-sm font-semibold">{day}</span>
              <label className="col-span-2 flex min-h-10 items-center gap-2 text-xs text-slate-600 sm:col-span-1 sm:col-start-4 sm:row-start-1">
                <input name={`closed-${weekday}`} type="checkbox" defaultChecked={weekday === 0} className="size-4 accent-sky-600" />
                Cerrado
              </label>
              <label className="text-xs font-medium text-slate-600">Abre
                <input aria-label={`Apertura ${day}`} name={`open-${weekday}`} type="time" defaultValue="09:00" className="mt-1 min-h-10 w-full min-w-0 rounded-lg border border-slate-200 px-2 text-sm" />
              </label>
              <label className="text-xs font-medium text-slate-600">Cierra
                <input aria-label={`Cierre ${day}`} name={`close-${weekday}`} type="time" defaultValue={weekday === 0 ? "17:00" : "18:00"} className="mt-1 min-h-10 w-full min-w-0 rounded-lg border border-slate-200 px-2 text-sm" />
              </label>
            </div>
          ))}
        </div>
      </section>
      {state.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
      <button disabled={pending} className="min-h-12 w-full rounded-xl bg-slate-950 px-5 font-semibold text-white disabled:opacity-60">
        {pending ? "Configurando..." : ownerId ? "Crear sede para esta cuenta" : "Crear negocio y abrir mi panel"}
      </button>
    </form>
  );
}
