"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import Image from "next/image";
import {
  createBlockedTimeAction,
  saveServiceAction,
  saveStaffAction,
  updateStaffProfileAction,
  toggleServiceAction,
  toggleStaffAction,
  updateStaffEmailAction,
  updateServiceAction,
  updateBusinessAction,
  updateHoursAction,
  deleteBlockedTimeAction,
  uploadBusinessLogoAction,
  removeBusinessLogoAction,
} from "@/app/actions/panel";
import type { ActionState } from "@/app/actions/auth";

type Business = {
  id: string; name: string; slug: string; type: string; phone: string | null;
  whatsapp: string | null; address: string | null; timezone: string; logo_url: string | null;
  brand_color: string; font_family: "sans" | "serif" | "mono";
};
type Hours = { weekday: number; open_time: string | null; close_time: string | null; is_closed: boolean };
type Service = { id: string; name: string; duration_minutes: number; price_cop: number; is_active: boolean };
type StaffHours = { weekday: number; open_time: string | null; close_time: string | null; is_closed: boolean };
type Staff = {
  id: string; name: string; email: string | null; is_active: boolean;
  serviceIds: string[]; hours: StaffHours[];
};
type BlockedTime = { id: string; staff_id: string | null; starts_at: string; ends_at: string; reason: string | null; staff: { name: string } | null };
type Props = {
  business: Business; hours: Hours[]; services: Service[]; staff: Staff[];
  blockedTimes: BlockedTime[]; canEditStaffProfiles: boolean;
};
const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const initialState: ActionState = {};

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <p role="alert" className="mt-3 text-sm text-red-700">{state.error}</p>;
  if (state.success) return <p role="status" className="mt-3 text-sm text-emerald-700">{state.success}</p>;
  return null;
}

export function SettingsForms({ business, hours, services, staff, blockedTimes, canEditStaffProfiles }: Props) {
  const [businessState, businessAction, businessPending] = useActionState(updateBusinessAction, initialState);
  const [hoursState, hoursAction, hoursPending] = useActionState(updateHoursAction, initialState);
  const [serviceState, serviceAction, servicePending] = useActionState(saveServiceAction, initialState);
  const [staffState, staffAction, staffPending] = useActionState(saveStaffAction, initialState);
  const [blockedState, blockedAction, blockedPending] = useActionState(createBlockedTimeAction, initialState);
  const [slug, setSlug] = useState(business.slug);
  const [logoUrl, setLogoUrl] = useState(business.logo_url ?? "");
  const [logoPending, setLogoPending] = useState(false);
  const [logoFeedback, setLogoFeedback] = useState<ActionState>({});
  const publicUrl = `/b/${business.slug}`;
  const dayHours = [...hours].sort((a, b) => a.weekday - b.weekday);

  async function uploadLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);
    if (!allowedTypes.has(file.type)) {
      setLogoFeedback({ error: "Selecciona una imagen PNG, JPG, WEBP, GIF o un PDF." });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setLogoFeedback({ error: "El archivo no puede superar 5 MB." });
      return;
    }

    setLogoPending(true);
    setLogoFeedback({});
    try {
      const formData = new FormData();
      formData.set("logo", file);
      const result = await uploadBusinessLogoAction(formData);
      if (result.error || !result.logoUrl) throw new Error(result.error ?? "No se recibió la dirección del logo.");
      setLogoUrl(result.logoUrl);
      setLogoFeedback({ success: result.success });
    } catch (reason) {
      setLogoFeedback({ error: reason instanceof Error ? reason.message : "No se pudo guardar el logo." });
    } finally {
      setLogoPending(false);
    }
  }

  async function removeLogo() {
    setLogoPending(true);
    setLogoFeedback({});
    try {
      const result = await removeBusinessLogoAction();
      if (result.error) throw new Error(result.error);
      setLogoUrl("");
      setLogoFeedback({ success: result.success });
    } catch (reason) {
      setLogoFeedback({ error: reason instanceof Error ? reason.message : "No se pudo quitar el logo." });
    } finally {
      setLogoPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Datos del negocio</h2>
        <form action={businessAction} className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">Nombre<input name="name" required defaultValue={business.name} className="form-input" /></label>
          <label className="text-sm font-medium">Tipo
            <select name="type" defaultValue={business.type} className="form-input">
              <option value="barbería">Barbería</option><option value="peluquería">Peluquería</option>
              <option value="manicura">Manicura</option><option value="lashista">Lashista</option>
              <option value="consultorio">Consultorio</option><option value="profesional_independiente">Profesional independiente</option>
              <option value="otro">Otro</option>
            </select>
          </label>
          <label className="text-sm font-medium">Enlace público
            <div className="mt-2 flex items-center overflow-hidden rounded-xl border border-slate-200"><span className="bg-slate-50 px-3 py-3 text-slate-500">/b/</span>
              <input name="slug" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} className="min-h-12 min-w-0 flex-1 px-3 outline-none" /></div>
          </label>
          <label className="text-sm font-medium">Teléfono<input name="phone" defaultValue={business.phone ?? ""} className="form-input" /></label>
          <label className="text-sm font-medium">WhatsApp<input name="whatsapp" defaultValue={business.whatsapp ?? ""} className="form-input" /></label>
          <label className="text-sm font-medium">Dirección<input name="address" defaultValue={business.address ?? ""} className="form-input" /></label>
          <label className="text-sm font-medium">URL del logo (opcional)
            <input name="logoUrl" type="url" value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} placeholder="https://…" className="form-input" />
          </label>
          <label className="text-sm font-medium">Color principal
            <div className="mt-2 flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 px-3">
              <input name="brandColor" type="color" defaultValue={business.brand_color} className="h-8 w-10 cursor-pointer border-0 bg-transparent p-0" />
              <span className="text-sm text-slate-500">Se usa en la página de reservas</span>
            </div>
          </label>
          <label className="text-sm font-medium">Tipografía
            <select name="fontFamily" defaultValue={business.font_family} className="form-input">
              <option value="sans">Sans serif · Moderna</option><option value="serif">Serif · Clásica</option><option value="mono">Monoespaciada</option>
            </select>
          </label>
          <label className="text-sm font-medium">Zona horaria
            <select name="timezone" defaultValue={business.timezone} className="form-input">
              <option value="America/Bogota">Bogotá</option><option value="America/Mexico_City">Ciudad de México</option><option value="America/Lima">Lima</option><option value="America/Santiago">Santiago</option>
            </select>
          </label>
          <div className="sm:col-span-2">
            <button disabled={businessPending} className="min-h-11 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">{businessPending ? "Guardando…" : "Guardar negocio"}</button>
            <Feedback state={businessState} />
          </div>
        </form>
        <div className="mt-5 rounded-xl border border-slate-200 p-4">
          <p className="text-sm font-semibold">Subir logo</p>
          <p className="mt-1 text-xs text-slate-500">Imagen PNG, JPG, WEBP o GIF, o PDF. Máximo 5 MB. Se mostrará en el menú del panel y en tu página de reservas.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className={`inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-slate-300 px-3 text-sm font-semibold ${logoPending ? "pointer-events-none opacity-50" : ""}`}>
              {logoPending ? "Subiendo…" : "Elegir archivo"}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" disabled={logoPending} onChange={uploadLogo} className="sr-only" />
            </label>
            {logoUrl && <button type="button" disabled={logoPending} onClick={removeLogo} className="min-h-10 rounded-lg px-3 text-sm font-semibold text-red-700 disabled:opacity-50">Quitar logo</button>}
          </div>
          {logoUrl && <div className="mt-3">
            {isPdfLogo(logoUrl)
              ? <a href={logoUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-amber-800">Ver el PDF cargado</a>
              : <Image src={logoUrl} alt="Vista previa del logo" width={64} height={64} unoptimized className="h-16 w-16 rounded-xl border border-slate-200 object-contain p-1" />}
          </div>}
          <Feedback state={logoFeedback} />
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 p-4">
          <div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase text-amber-900">Enlace para tus clientes</p><p className="mt-1 truncate text-sm text-amber-950">{publicUrl}</p></div>
          <CopyLink value={publicUrl} />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Horarios</h2>
        <p className="mt-1 text-sm text-slate-600">Este es el horario base del negocio. En el plan Profesional, cada profesional puede tener un horario propio.</p>
        <form action={hoursAction} className="mt-5 space-y-2">
          {days.map((day, weekday) => {
            const value = dayHours[weekday];
            return <div key={day} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-xl border border-slate-100 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <span className="text-sm font-medium">{day}</span>
              <input name={`open-${weekday}`} type="time" defaultValue={value?.open_time?.slice(0, 5) ?? "09:00"} className="min-h-10 rounded-lg border border-slate-200 px-2 text-sm" />
              <input name={`close-${weekday}`} type="time" defaultValue={value?.close_time?.slice(0, 5) ?? "18:00"} className="min-h-10 rounded-lg border border-slate-200 px-2 text-sm" />
              <label className="col-span-full flex items-center gap-2 text-xs text-slate-600 sm:col-span-1"><input name={`closed-${weekday}`} type="checkbox" defaultChecked={value?.is_closed ?? false} className="accent-amber-600" />Cerrado</label>
            </div>;
          })}
          <button disabled={hoursPending} className="min-h-11 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">{hoursPending ? "Guardando…" : "Guardar horarios"}</button>
          <Feedback state={hoursState} />
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Servicios</h2>
        <div className="mt-4 divide-y divide-slate-100">
          {services.map((service) => <ServiceEditor key={service.id} service={service} />)}
        </div>
        <form action={serviceAction} className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-[1fr_150px_150px_auto]">
          <input name="name" required placeholder="Nombre del servicio" className="form-input mt-0" />
          <input name="duration" type="number" min="5" max="1440" required placeholder="Minutos" className="form-input mt-0" />
          <input name="price" type="number" min="0" required placeholder="Precio COP" className="form-input mt-0" />
          <button disabled={servicePending} className="min-h-12 rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white">{servicePending ? "…" : "Agregar"}</button>
        </form><Feedback state={serviceState} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Profesionales</h2>
        <div className="mt-4 divide-y divide-slate-100">
          {staff.map((person) => <div key={person.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{person.name}{!person.email && <span className="ml-2 rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">Falta correo</span>}</p>
              {canEditStaffProfiles
                ? <StaffProfileEditor person={person} services={services} />
                : <StaffEmailEditor person={person} />}
            </div>
            <form action={toggleStaffAction}><input type="hidden" name="staffId" value={person.id} /><input type="hidden" name="active" value={String(!person.is_active)} /><button className="min-h-10 text-sm font-medium text-amber-800">{person.is_active ? "Desactivar" : "Activar"}</button></form>
          </div>)}
        </div>
        <form action={staffAction} className="mt-5 space-y-3 border-t border-slate-100 pt-5">
          <input name="name" required placeholder="Nombre del profesional" className="form-input mt-0" />
          <input name="email" type="email" autoComplete="email" required placeholder="Correo del profesional" className="form-input mt-0" />
          <p className="text-sm font-medium">Servicios que ofrece</p>
          <div className="flex flex-wrap gap-3">{services.filter((service) => service.is_active).map((service) => <label key={service.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="serviceIds" value={service.id} className="accent-amber-600" />{service.name}</label>)}</div>
          <button disabled={staffPending} className="min-h-11 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">{staffPending ? "Guardando…" : "Agregar profesional"}</button>
        </form><Feedback state={staffState} />
        {!canEditStaffProfiles && <p className="mt-4 text-sm text-slate-500">La edición completa requiere una suscripción vigente.</p>}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Bloqueos de agenda</h2>
        <p className="mt-2 text-sm text-slate-600">Úsalos para vacaciones, pausas o eventos. «Todo el negocio» quita ese intervalo para todos los profesionales; si eliges a alguien, solo se bloquea su agenda. Los bloqueos no cancelan citas ya existentes.</p>
        <form action={blockedAction} className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">Profesional
            <select name="staffId" className="form-input"><option value="">Todo el negocio</option>{staff.filter((person) => person.is_active).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
          </label>
          <label className="text-sm font-medium">Motivo<input name="reason" maxLength={200} className="form-input" /></label>
          <label className="text-sm font-medium">Desde<input name="startsAt" type="datetime-local" required className="form-input" /></label>
          <label className="text-sm font-medium">Hasta<input name="endsAt" type="datetime-local" required className="form-input" /></label>
          <div><button disabled={blockedPending} className="min-h-11 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">{blockedPending ? "Guardando…" : "Crear bloqueo"}</button><Feedback state={blockedState} /></div>
        </form>
        <div className="mt-5 divide-y divide-slate-100">
          {blockedTimes.map((block) => <div key={block.id} className="flex items-center justify-between gap-4 py-3">
            <div><p className="text-sm font-medium">{block.staff?.name ?? "Todo el negocio"}</p><p className="text-xs text-slate-500">{new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short", timeZone: business.timezone }).format(new Date(block.starts_at))} – {new Intl.DateTimeFormat("es-CO", { timeStyle: "short", timeZone: business.timezone }).format(new Date(block.ends_at))} · {block.reason ?? "Sin motivo"}</p></div>
            <form action={deleteBlockedTimeAction}><input type="hidden" name="blockedTimeId" value={block.id} /><button className="text-sm font-medium text-red-700">Quitar</button></form>
          </div>)}
          {!blockedTimes.length && <p className="py-4 text-sm text-slate-500">No hay bloqueos futuros.</p>}
        </div>
      </section>
    </div>
  );
}

function StaffProfileEditor({ person, services }: { person: Staff; services: Service[] }) {
  const [state, action, pending] = useActionState(updateStaffProfileAction, initialState);
  const hoursByDay = new Map(person.hours.map((hour) => [hour.weekday, hour]));

  return <details className="mt-3 rounded-xl border border-slate-200">
    <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-700">Editar perfil, servicios y horarios</summary>
    <form action={action} className="space-y-4 border-t border-slate-100 p-3">
      <input type="hidden" name="staffId" value={person.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">Nombre
          <input name="name" required minLength={2} maxLength={120} defaultValue={person.name} className="form-input mt-1" />
        </label>
        <label className="text-sm font-medium">Correo
          <input name="email" type="email" required defaultValue={person.email ?? ""} className="form-input mt-1" />
        </label>
      </div>
      <fieldset>
        <legend className="text-sm font-semibold">Servicios que ofrece</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {services.filter((service) => service.is_active).map((service) => <label key={service.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="serviceIds" value={service.id} defaultChecked={person.serviceIds.includes(service.id)} className="accent-amber-600" />
            {service.name}
          </label>)}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-semibold">Disponibilidad semanal</legend>
        <div className="mt-2 space-y-2">
          {days.map((day, weekday) => {
            const hour = hoursByDay.get(weekday);
            return <div key={day} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <span className="text-sm">{day}</span>
              <input name={`open-${weekday}`} type="time" defaultValue={hour?.open_time?.slice(0, 5) ?? "09:00"} aria-label={`Apertura ${day}`} className="min-h-10 rounded-lg border border-slate-200 px-2 text-sm" />
              <input name={`close-${weekday}`} type="time" defaultValue={hour?.close_time?.slice(0, 5) ?? "18:00"} aria-label={`Cierre ${day}`} className="min-h-10 rounded-lg border border-slate-200 px-2 text-sm" />
              <label className="col-span-full flex items-center gap-2 text-xs text-slate-600 sm:col-span-1">
                <input name={`closed-${weekday}`} type="checkbox" defaultChecked={hour?.is_closed ?? false} className="accent-amber-600" />
                Cerrado
              </label>
            </div>;
          })}
        </div>
      </fieldset>
      <button disabled={pending} className="min-h-10 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60">
        {pending ? "Guardando…" : "Guardar cambios"}
      </button>
      <Feedback state={state} />
    </form>
  </details>;
}

function StaffEmailEditor({ person }: { person: Staff }) {
  const [state, action, pending] = useActionState(updateStaffEmailAction, initialState);
  return <form action={action} className="mt-2 flex flex-col gap-2 sm:flex-row">
    <input type="hidden" name="staffId" value={person.id} />
    <input
      name="email"
      type="email"
      autoComplete="email"
      required
      defaultValue={person.email ?? ""}
      aria-label={`Correo de ${person.name}`}
      placeholder="correo@ejemplo.com"
      className="form-input mt-0 min-h-10 min-w-0 flex-1 text-sm"
    />
    <button disabled={pending} className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 disabled:opacity-60">
      {pending ? "Guardando…" : "Guardar correo"}
    </button>
    <Feedback state={state} />
  </form>;
}

function isPdfLogo(url: string) {
  return /\.pdf(?:$|[?#])/i.test(url);
}

function CopyLink({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  async function copy() {
    try {
      const fullUrl = value.startsWith("http") ? value : `${window.location.origin}${value}`;
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setError("");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("No se pudo copiar. Selecciona el enlace manualmente.");
    }
  }
  return <div className="shrink-0">
    <button type="button" onClick={copy} className="rounded-lg bg-amber-700 px-3 py-2 text-sm font-semibold text-white">{copied ? "Copiado" : "Copiar link"}</button>
    {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
  </div>;
}

function ServiceEditor({ service }: { service: Service }) {
  const [state, action, pending] = useActionState(updateServiceAction, initialState);
  return <div className="border-b border-slate-100 py-3 last:border-0">
    <div className="mb-2 flex items-center justify-between gap-3">
      <p className="text-sm text-slate-500">{service.duration_minutes} min · {new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(service.price_cop)}</p>
      <form action={toggleServiceAction}><input type="hidden" name="serviceId" value={service.id} /><input type="hidden" name="active" value={String(!service.is_active)} /><button className={`rounded-full px-3 py-1.5 text-xs font-semibold ${service.is_active ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{service.is_active ? "Activo · Desactivar" : "Inactivo · Activar"}</button></form>
    </div>
    <form action={action} className="grid gap-2 sm:grid-cols-[1fr_120px_140px_auto]">
      <input type="hidden" name="serviceId" value={service.id} />
      <input name="name" required defaultValue={service.name} className="form-input mt-0" />
      <input name="duration" type="number" min="5" max="1440" required defaultValue={service.duration_minutes} className="form-input mt-0" />
      <input name="price" type="number" min="0" required defaultValue={service.price_cop} className="form-input mt-0" />
      <button disabled={pending} className="min-h-12 rounded-xl border border-slate-200 px-3 text-sm font-semibold disabled:opacity-60">{pending ? "…" : "Actualizar"}</button>
      {state.error && <p role="alert" className="text-sm text-red-700 sm:col-span-4">{state.error}</p>}
      {state.success && <p role="status" className="text-sm text-emerald-700 sm:col-span-4">{state.success}</p>}
    </form>
  </div>;
}
