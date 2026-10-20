"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Clock3 } from "lucide-react";
import type { AvailableSlot, PublicBusiness } from "@/lib/public-booking";

type Service = { id: string; name: string; duration_minutes: number; price_cop: number };
type Staff = { id: string; name: string; serviceIds: string[] };
type Props = { business: PublicBusiness; services: Service[]; staff: Staff[]; today: string };
type Booking = { appointmentId: string; startsAt: string; services: Service[]; staffName: string; customerName: string; approvalEmailSent: boolean };
const money = (value: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);

function brandTextColor(hexColor: string) {
  const red = Number.parseInt(hexColor.slice(1, 3), 16);
  const green = Number.parseInt(hexColor.slice(3, 5), 16);
  const blue = Number.parseInt(hexColor.slice(5, 7), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 > 150 ? "#111827" : "#ffffff";
}

export function BookingFlow({ business, services, staff, today }: Props) {
  const [step, setStep] = useState(0);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const selectedServices = services.filter((service) => serviceIds.includes(service.id));
  const totalDuration = selectedServices.reduce((total, service) => total + service.duration_minutes, 0);
  const totalPrice = selectedServices.reduce((total, service) => total + service.price_cop, 0);
  const buttonTextColor = brandTextColor(business.brand_color);
  const eligibleStaff = useMemo(
    () => staff.filter((person) => serviceIds.every((serviceId) => person.serviceIds.includes(serviceId))),
    [staff, serviceIds],
  );

  async function loadAvailability() {
    setError("");
    setLoading(true);
    setSelectedSlot(null);
    try {
      const params = new URLSearchParams({ slug: business.slug, serviceIds: serviceIds.join(","), date });
      if (staffId) params.set("staffId", staffId);
      const response = await fetch(`/api/public/availability?${params.toString()}`);
      const result = await response.json() as { slots?: AvailableSlot[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "No se pudo consultar la agenda.");
      setSlots(result.slots ?? []);
      setStep(3);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo consultar la agenda.");
    } finally {
      setLoading(false);
    }
  }

  async function submitBooking(formData: FormData) {
    setError("");
    setLoading(true);
    const newDetails = {
      name: String(formData.get("name") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim(),
      whatsappConsent: formData.get("whatsappConsent") === "on",
      notes: String(formData.get("notes") ?? "").trim(),
    };
    try {
      const response = await fetch("/api/public/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: business.slug,
          serviceIds,
          staffId: selectedSlot?.staffId,
          startsAt: selectedSlot?.startsAt,
          ...newDetails,
        }),
      });
      const result = await response.json() as { appointmentId?: string; startsAt?: string; approvalEmailSent?: boolean; error?: string };
      if (!response.ok || !result.appointmentId || !result.startsAt) {
        throw new Error(result.error ?? "No se pudo completar la reserva.");
      }
      setBooking({
        appointmentId: result.appointmentId,
        startsAt: result.startsAt,
        services: selectedServices,
        staffName: selectedSlot?.staffName ?? "Profesional",
        customerName: newDetails.name,
        approvalEmailSent: result.approvalEmailSent ?? false,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo completar la reserva.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
      {booking ? (
        <div className="py-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check size={28} /></div>
          <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-amber-700">Pendiente de confirmación</p>
          <h2 className="mt-2 text-2xl font-bold">Recibimos tu solicitud</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
            {booking.approvalEmailSent
              ? "El profesional debe aceptar la cita. Te enviaremos la confirmación por WhatsApp cuando la apruebe."
              : "Tu solicitud quedó registrada, pero no se pudo notificar al profesional. Contacta al negocio para confirmar el estado."}
          </p>
          <div className="mx-auto mt-6 max-w-sm rounded-2xl bg-slate-50 p-5 text-left">
            <p className="font-semibold">{booking.services.map((service) => service.name).join(" + ")}</p>
            <p className="mt-2 text-sm text-slate-600">{new Intl.DateTimeFormat("es-CO", { dateStyle: "full", timeStyle: "short", timeZone: business.timezone }).format(new Date(booking.startsAt))}</p>
            <p className="mt-1 text-sm text-slate-600">{booking.staffName} · {money(booking.services.reduce((total, service) => total + service.price_cop, 0))}</p>
            <p className="mt-1 text-xs text-slate-400">Código: {booking.appointmentId.slice(0, 8).toUpperCase()}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div><p className="text-xs font-semibold uppercase tracking-widest" style={{ color: business.brand_color }}>Reserva en línea</p><h2 className="mt-1 text-xl font-bold">Agenda tu cita</h2></div>
            <span className="text-sm font-medium text-slate-500">{step + 1} de 5</span>
          </div>
          <div className="mt-4 flex gap-1">
            {Array.from({ length: 5 }, (_, index) => <span key={index} className={`h-1.5 flex-1 rounded-full ${index > step ? "bg-slate-100" : ""}`} style={index <= step ? { backgroundColor: business.brand_color } : undefined} />)}
          </div>

          {step === 0 && <div className="mt-6 space-y-3">
            <h3 className="font-semibold">1. Elige uno o varios servicios</h3>
            {services.map((service) => {
              const isSelected = serviceIds.includes(service.id);
              return <button key={service.id} type="button" aria-pressed={isSelected} onClick={() => {
                setServiceIds((current) => isSelected
                  ? current.filter((id) => id !== service.id)
                  : [...current, service.id]);
                setStaffId("");
                setError("");
              }} className="flex min-h-16 w-full items-center justify-between rounded-2xl border p-4 text-left" style={isSelected ? { borderColor: business.brand_color, backgroundColor: `${business.brand_color}14` } : undefined}>
              <span><span className="block font-semibold">{service.name}</span><span className="mt-1 block text-sm text-slate-500">{service.duration_minutes} minutos</span></span><span className="font-semibold">{money(service.price_cop)}{isSelected && <span className="ml-2" style={{ color: business.brand_color }}>✓</span>}</span>
            </button>;
            })}
            {selectedServices.length > 0 && <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Total: {totalDuration} min · {money(totalPrice)}</div>}
            {!services.length && <p className="text-sm text-slate-500">Este negocio aún no tiene servicios disponibles.</p>}
            <button type="button" disabled={!serviceIds.length} onClick={() => setStep(1)} className="min-h-12 w-full rounded-xl px-4 font-semibold disabled:opacity-50" style={{ backgroundColor: business.brand_color, color: buttonTextColor }}>Continuar</button>
          </div>}

          {step === 1 && <div className="mt-6 space-y-3">
            <h3 className="font-semibold">2. Elige profesional</h3>
            {eligibleStaff.length > 0
              ? <button onClick={() => { setStaffId(""); setStep(2); }} className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-slate-200 p-4 text-left"><span className="font-medium">Cualquiera disponible</span><ArrowRight size={18} /></button>
              : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Ningún profesional ofrece todos los servicios seleccionados. Vuelve y cambia tu selección.</p>}
            {eligibleStaff.map((person) => <button key={person.id} onClick={() => { setStaffId(person.id); setStep(2); }} className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-slate-200 p-4 text-left"><span className="font-medium">{person.name}</span><ArrowRight size={18} style={{ color: business.brand_color }} /></button>)}
          </div>}

          {step === 2 && <div className="mt-6 space-y-4">
            <h3 className="font-semibold">3. Elige una fecha</h3>
            <label className="block text-sm font-medium text-slate-600">Fecha de la cita
              <input type="date" min={today} value={date} onChange={(event) => setDate(event.target.value)} className="form-input mt-2" />
            </label>
            <button disabled={loading || !date} onClick={loadAvailability} className="min-h-12 w-full rounded-xl bg-slate-950 px-4 font-semibold text-white disabled:opacity-60">{loading ? "Buscando horarios…" : "Ver horarios disponibles"}</button>
          </div>}

          {step === 3 && <div className="mt-6 space-y-4">
            <h3 className="font-semibold">4. Elige una hora disponible</h3>
            <p className="text-sm text-slate-500">{new Intl.DateTimeFormat("es-CO", { dateStyle: "full", timeZone: business.timezone }).format(new Date(`${date}T12:00:00Z`))}</p>
            {slots.length ? <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {slots.map((slot) => <button key={`${slot.startsAt}-${slot.staffId}`} onClick={() => setSelectedSlot(slot)} className="min-h-11 rounded-xl border px-2 text-sm font-semibold" style={selectedSlot?.startsAt === slot.startsAt ? { borderColor: business.brand_color, backgroundColor: `${business.brand_color}14`, color: business.brand_color } : undefined}>
                {new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit", timeZone: business.timezone }).format(new Date(slot.startsAt))}
              </button>)}
            </div> : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No hay horas disponibles para este día. Prueba con otra fecha.</p>}
            {selectedSlot && <p className="text-xs text-slate-500">Profesional asignado: {selectedSlot.staffName}</p>}
            <button disabled={!selectedSlot} onClick={() => setStep(4)} className="min-h-12 w-full rounded-xl bg-slate-950 px-4 font-semibold text-white disabled:opacity-50">Continuar</button>
          </div>}

          {step === 4 && <form action={submitBooking} className="mt-6 space-y-4">
            <h3 className="font-semibold">5. Tus datos para confirmar</h3>
            <label className="block text-sm font-medium">Nombre completo<input name="name" autoComplete="name" required minLength={2} maxLength={120} className="form-input" /></label>
            <label className="block text-sm font-medium">Celular<input name="phone" type="tel" autoComplete="tel" required minLength={7} maxLength={25} placeholder="+57 300 123 4567" className="form-input" /></label>
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm leading-5 text-slate-600">
              <input name="whatsappConsent" type="checkbox" required className="mt-1 size-4 shrink-0 accent-sky-700" />
              <span>Acepto recibir por WhatsApp, desde Agenda Clara, mensajes sobre esta solicitud, incluido si la cita es aceptada o rechazada.</span>
            </label>
            <label className="block text-sm font-medium">Nota para el negocio (opcional)<textarea name="notes" maxLength={500} rows={3} className="form-input resize-y" /></label>
            <div className="rounded-xl bg-slate-50 p-4 text-sm">
              <p className="font-semibold">{selectedServices.map((service) => service.name).join(" + ")} · {money(totalPrice)}</p>
              <p className="mt-1 text-slate-600">{totalDuration} minutos · se dejan 5 minutos entre citas</p>
              <p className="mt-1 text-slate-600">{selectedSlot && new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: business.timezone }).format(new Date(selectedSlot.startsAt))} · {selectedSlot?.staffName}</p>
            </div>
              <button disabled={loading} className="min-h-12 w-full rounded-xl px-4 font-semibold disabled:opacity-60" style={{ backgroundColor: business.brand_color, color: buttonTextColor }}>{loading ? "Confirmando…" : "Confirmar cita"}</button>
          </form>}

          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {step > 0 && <button type="button" onClick={() => { setStep(step - 1); setError(""); }} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-600"><ArrowLeft size={16} /> Volver</button>}
          {step === 0 && <p className="mt-5 flex items-center gap-2 text-xs text-slate-500"><Clock3 size={14} /> La reserva no necesita crear una cuenta.</p>}
        </>
      )}
    </section>
  );
}
