import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck, CircleDollarSign, ExternalLink, Scissors, UsersRound } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { AppointmentStatusForm } from "@/components/panel/appointment-status-form";
import { currentMonthRange, currentWeekRange, businessLocalDate, firstRelation, formatBusinessDateTime, localCalendarDate, localDateAtOffset, localDateToUtc, monthDays } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { selectCurrentBusiness } from "@/lib/business-selection";
import { isConfirmedSuperAdmin } from "@/lib/super-admin";

type Search = Promise<{ view?: string; staff?: string; date?: string; feature?: string }>;
const statusLabel: Record<string, string> = {
  pendiente: "Pendiente", confirmada: "Confirmada", completada: "Completada",
  cancelada: "Cancelada", "no_asistió": "No asistió",
};

function currency(value: number) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
}

export default async function PanelPage({ searchParams }: { searchParams: Search }) {
  const supabase = await createClient();
  const now = new Date();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const isAdmin = isConfirmedSuperAdmin(user);
  const { data: businesses, error: businessError } = await supabase.from("businesses")
    .select("id, name, slug, timezone").eq("owner_id", user.id).order("name");
  const business = await selectCurrentBusiness(businesses ?? []);
  if (businessError) throw new Error("No se pudieron consultar las sedes del negocio.");
  if (!business) redirect(isAdmin ? "/admin" : "/onboarding");
  const { data: subscription, error: subscriptionError } = await supabase.from("business_subscriptions")
    .select("plan, status, trial_ends_at").eq("owner_id", user.id).maybeSingle();
  if (subscriptionError) throw new Error("No se pudo consultar el estado del plan.");
  const trialDaysLeft = subscription?.status === "trial" && subscription.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(subscription.trial_ends_at).getTime() - now.getTime()) / 86_400_000))
    : null;

  const params = await searchParams;
  const today = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
    ? params.date : businessLocalDate(now, business.timezone);
  const view = ["hoy", "semana", "calendario"].includes(params.view ?? "") ? params.view! : "semana";
  const range = view === "hoy"
    ? { start: localDateToUtc(today, business.timezone), end: localDateToUtc(localDateAtOffset(today, 1), business.timezone) }
    : view === "semana"
      ? currentWeekRange(today, business.timezone)
      : currentMonthRange(today, business.timezone);

  let appointmentsQuery = supabase.from("appointments")
    .select("id, starts_at, ends_at, status, notes, customer_id, customers(name, phone), services(name, price_cop, duration_minutes), appointment_services(services(name, price_cop)), staff(id, name)")
    .eq("business_id", business.id)
    .gte("starts_at", range.start.toISOString()).lt("starts_at", range.end.toISOString())
    .order("starts_at");
  const [{ data: staff, error: staffError }, { data: businessHours, error: hoursError }] = await Promise.all([
    supabase.from("staff").select("id, name").eq("business_id", business.id).eq("is_active", true).order("name"),
    supabase.from("business_hours").select("weekday, open_time, close_time, is_closed").eq("business_id", business.id),
  ]);
  if (staffError || hoursError) throw new Error("No se pudieron cargar los profesionales y horarios de la agenda.");
  const selectedStaffId = staff?.some((person) => person.id === params.staff) ? params.staff : "";
  if (selectedStaffId) appointmentsQuery = appointmentsQuery.eq("staff_id", selectedStaffId);
  const { data: appointments, error: appointmentsError } = await appointmentsQuery;
  if (appointmentsError) {
    console.error("No se pudo cargar la agenda de citas.", {
      code: appointmentsError.code,
      message: appointmentsError.message,
    });
    if (appointmentsError.code === "PGRST200" || appointmentsError.code === "PGRST201") {
      throw new Error("Supabase no encuentra las relaciones de citas. Ejecuta las migraciones de supabase/migrations en orden, incluida 0004_multi_service_branding.sql, y vuelve a cargar.");
    }
    throw new Error(`No fue posible cargar la agenda desde Supabase (${appointmentsError.code}). Revisa los registros del servidor para más detalles.`);
  }
  const weekRange = currentWeekRange(businessLocalDate(now, business.timezone), business.timezone);
  const monthRange = currentMonthRange(businessLocalDate(now, business.timezone), business.timezone);
  const selectedWeekStart = businessLocalDate(currentWeekRange(today, business.timezone).start, business.timezone);
  const weekDates = Array.from({ length: 7 }, (_, index) => localDateAtOffset(selectedWeekStart, index));
  const weekdayFormatter = new Intl.DateTimeFormat("es-CO", {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
  });
  const weekCalendarDays = weekDates.map((date) => ({
    date,
    label: weekdayFormatter.format(new Date(`${date}T12:00:00Z`)),
    isClosed: !(businessHours ?? []).some((hours) =>
      hours.weekday === new Date(`${date}T12:00:00Z`).getUTCDay()
      && !hours.is_closed
      && hours.open_time
      && hours.close_time,
    ),
    appointments: (appointments ?? []).filter((appointment) =>
      businessLocalDate(new Date(appointment.starts_at), business.timezone) === date,
    ),
  }));
  const weekHours = (businessHours ?? []).filter((hours) => !hours.is_closed && hours.open_time && hours.close_time);
  const clockMinutes = (value: string) => {
    const [hour, minute] = value.slice(0, 5).split(":").map(Number);
    return hour * 60 + minute;
  };
  const weekStartMinute = weekHours.length
    ? Math.floor(Math.min(...weekHours.map((hours) => clockMinutes(hours.open_time!))) / 30) * 30
    : 8 * 60;
  const weekEndMinute = weekHours.length
    ? Math.ceil(Math.max(...weekHours.map((hours) => clockMinutes(hours.close_time!))) / 30) * 30
    : 20 * 60;
  const slotMinutes = Array.from(
    { length: Math.max(1, (weekEndMinute - weekStartMinute) / 30) },
    (_, index) => weekStartMinute + index * 30,
  );
  const minutesLabel = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const businessMinute = (dateTime: string) => {
    const [hour, minute] = formatInTimeZone(new Date(dateTime), business.timezone, "HH:mm")
      .split(":").map(Number);
    return hour * 60 + minute;
  };
  const previousDate = view === "calendario"
    ? `${localDateAtOffset(`${today.slice(0, 7)}-01`, -1).slice(0, 7)}-01`
    : localDateAtOffset(today, view === "hoy" ? -1 : -7);
  const nextDate = view === "calendario"
    ? `${localDateAtOffset(`${today.slice(0, 7)}-01`, 32).slice(0, 7)}-01`
    : localDateAtOffset(today, view === "hoy" ? 1 : 7);
  const dateRangeLabel = view === "calendario"
    ? new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(`${today.slice(0, 7)}-15T12:00:00Z`))
    : view === "hoy"
      ? new Intl.DateTimeFormat("es-CO", { dateStyle: "full", timeZone: "UTC" })
        .format(new Date(`${today}T12:00:00Z`))
      : `${weekdayFormatter.format(new Date(`${weekDates[0]}T12:00:00Z`))} — ${weekdayFormatter.format(new Date(`${weekDates[6]}T12:00:00Z`))}`;
  const [{ count: todayCount }, { count: weekCount }, { data: monthAppointments }] = await Promise.all([
    supabase.from("appointments").select("id", { count: "exact", head: true })
      .eq("business_id", business.id).gte("starts_at", localDateToUtc(businessLocalDate(now, business.timezone), business.timezone).toISOString())
      .lt("starts_at", localDateToUtc(localDateAtOffset(businessLocalDate(now, business.timezone), 1), business.timezone).toISOString())
      .neq("status", "cancelada"),
    supabase.from("appointments").select("id", { count: "exact", head: true })
      .eq("business_id", business.id).gte("starts_at", weekRange.start.toISOString())
      .lt("starts_at", weekRange.end.toISOString()).neq("status", "cancelada"),
    supabase.from("appointments").select("appointment_services(services(name, price_cop))")
      .eq("business_id", business.id).gte("starts_at", monthRange.start.toISOString())
      .lt("starts_at", monthRange.end.toISOString()).neq("status", "cancelada"),
  ]);

  const monthRevenue = (monthAppointments ?? []).reduce((sum, appointment) =>
    sum + (appointment.appointment_services ?? []).reduce((serviceSum, entry) =>
      serviceSum + (firstRelation(entry.services)?.price_cop ?? 0), 0),
  0);
  const serviceFrequency = new Map<string, number>();
  for (const appointment of monthAppointments ?? []) {
    for (const entry of appointment.appointment_services ?? []) {
      const service = firstRelation(entry.services);
      if (service?.name) serviceFrequency.set(service.name, (serviceFrequency.get(service.name) ?? 0) + 1);
    }
  }
  const topService = [...serviceFrequency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  const metrics = [
    { title: "Citas de hoy", value: String(todayCount ?? 0), icon: CalendarCheck, accent: "text-blue-700 bg-blue-50" },
    { title: "Citas esta semana", value: String(weekCount ?? 0), icon: UsersRound, accent: "text-violet-700 bg-violet-50" },
    { title: "Ingresos estimados", value: currency(monthRevenue), icon: CircleDollarSign, accent: "text-emerald-700 bg-emerald-50" },
    { title: "Servicio más pedido", value: topService, icon: Scissors, accent: "text-amber-700 bg-amber-50" },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-sm font-medium text-slate-500">Hola, {business.name}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Tu agenda</h1></div>
        <div className="flex flex-wrap gap-2">
          <Link href="/planes" className="rounded-xl border border-lime-300 bg-lime-50 px-4 py-2.5 text-sm font-semibold text-lime-950">Plan y facturación</Link>
          <Link href={`/b/${business.slug}`} target="_blank" className="inline-flex items-center gap-2 rounded-xl bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white">Link de reservas <ExternalLink size={16} /></Link>
          <Link href="/panel/configuracion" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Configurar negocio</Link>
        </div>
      </div>
      {!isAdmin && trialDaysLeft !== null && <section className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-lime-200 bg-lime-50 p-4">
        <p className="text-sm text-lime-950">Estás probando el plan Profesional. {trialDaysLeft === 0 ? "Tu prueba termina hoy." : `Te quedan ${trialDaysLeft} ${trialDaysLeft === 1 ? "día" : "días"} gratis.`} No se requiere tarjeta.</p>
        <Link href="/planes" className="text-sm font-bold text-lime-900 underline underline-offset-4">Ver planes</Link>
      </section>}
      {!isAdmin && params.feature === "professional" && <section className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
        Caja y reportes están disponibles en el plan Profesional. <Link href="/planes" className="font-bold underline underline-offset-2">Ver planes</Link>
      </section>}

      <section className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {metrics.map(({ title, value, icon: Icon, accent }) => (
          <article key={title} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${accent}`}><Icon size={18} /></div>
            <p className="mt-4 text-xs text-slate-500 sm:text-sm">{title}</p>
            <p className="mt-1 truncate text-xl font-bold">{value}</p>
          </article>
        ))}
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-4 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
            {([
              { id: "hoy", label: "Día" },
              { id: "semana", label: "Semana" },
              { id: "calendario", label: "Mes" },
            ] as const).map(({ id, label }) => (
              <Link key={id} href={`/panel?view=${id}&date=${today}${selectedStaffId ? `&staff=${selectedStaffId}` : ""}`} className={`rounded-lg px-3 py-2 text-sm ${view === id ? "bg-white font-semibold shadow-sm" : "text-slate-500"}`}>{label}</Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Link aria-label="Período anterior" href={`/panel?view=${view}&date=${previousDate}${selectedStaffId ? `&staff=${selectedStaffId}` : ""}`} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-lg hover:bg-sky-50">‹</Link>
              <Link href={`/panel?view=${view}&date=${businessLocalDate(now, business.timezone)}${selectedStaffId ? `&staff=${selectedStaffId}` : ""}`} className="min-h-10 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-sky-50">Hoy</Link>
              <Link aria-label="Período siguiente" href={`/panel?view=${view}&date=${nextDate}${selectedStaffId ? `&staff=${selectedStaffId}` : ""}`} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-lg hover:bg-sky-50">›</Link>
              <span className="ml-1 text-sm font-semibold capitalize text-slate-700">{dateRangeLabel}</span>
            </div>
            {(staff ?? []).length > 1 && <form className="flex items-center gap-2">
              <input type="hidden" name="view" value={view} />
              <input type="hidden" name="date" value={today} />
              <label htmlFor="staff" className="text-sm text-slate-600">Profesional</label>
              <select id="staff" name="staff" defaultValue={selectedStaffId} className="min-h-10 max-w-44 rounded-lg border border-slate-200 bg-white px-2 text-sm">
                <option value="">Todos</option>{(staff ?? []).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
              <button className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm">Filtrar</button>
            </form>}
          </div>
        </div>

        {view === "calendario" ? (
          <div className="grid grid-cols-7 gap-px bg-slate-100">
            {["D", "L", "M", "M", "J", "V", "S"].map((day, index) => <div key={`${day}-${index}`} className="bg-slate-50 p-2 text-center text-xs font-semibold text-slate-500">{day}</div>)}
            {monthDays(today).map((day) => {
              const date = localCalendarDate(day);
              const dayAppointments = (appointments ?? []).filter((appointment) =>
                businessLocalDate(new Date(appointment.starts_at), business.timezone) === date,
              );
              const inMonth = date.startsWith(today.slice(0, 7));
              return <Link key={date} href={`/panel?view=calendario&date=${date}${selectedStaffId ? `&staff=${selectedStaffId}` : ""}`} className={`min-h-20 bg-white p-1.5 text-xs sm:min-h-24 sm:p-2 ${inMonth ? "" : "text-slate-300"}`}>
                <span className="font-medium">{day.getDate()}</span>
                {dayAppointments.slice(0, 2).map((appointment) => <span key={appointment.id} className="mt-1 block truncate rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-900">{formatBusinessDateTime(appointment.starts_at, business.timezone).slice(-5)} · {firstRelation(appointment.customers)?.name}</span>)}
                {dayAppointments.length > 2 && <span className="mt-1 block text-[10px] text-slate-500">+{dayAppointments.length - 2}</span>}
                {dayAppointments.length === 0 && <span className="mt-1 hidden text-[10px] text-slate-400 sm:block">Sin citas</span>}
              </Link>;
            })}
          </div>
        ) : view === "semana" ? (
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              <div className="grid grid-cols-[4rem_repeat(7,minmax(0,1fr))] border-b border-slate-200 bg-white">
                <div className="border-r border-slate-100" />
                {weekCalendarDays.map((day) => {
                  const isToday = day.date === businessLocalDate(now, business.timezone);
                  return <Link key={day.date} href={`/panel?view=hoy&date=${day.date}${selectedStaffId ? `&staff=${selectedStaffId}` : ""}`} className={`border-r border-slate-100 px-2 py-3 text-center last:border-r-0 hover:bg-sky-50 ${isToday ? "bg-sky-50" : ""}`}>
                    <span className="block text-xs font-semibold uppercase text-slate-500">{day.label.split(" ")[0]}</span>
                    <span className={`mt-1 inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-sm font-bold ${isToday ? "bg-sky-500 text-white" : "text-slate-800"}`}>{Number(day.date.slice(-2))}</span>
                    <span className="mt-1 block text-[10px] text-slate-500">{day.appointments.length} {day.appointments.length === 1 ? "cita" : "citas"}</span>
                  </Link>;
                })}
              </div>
              <div className="grid grid-cols-[4rem_repeat(7,minmax(0,1fr))]">
                <div className="relative border-r border-slate-200 bg-slate-50" style={{ height: `${slotMinutes.length * 48}px` }}>
                  {slotMinutes.map((minute) => <span key={minute} className="absolute right-2 -translate-y-1/2 text-[10px] font-medium text-slate-500" style={{ top: `${(minute - weekStartMinute) * 1.6}px` }}>{minute % 60 === 0 ? minutesLabel(minute) : ""}</span>)}
                </div>
                {weekCalendarDays.map((day) => {
                  const dayWeekday = new Date(`${day.date}T12:00:00Z`).getUTCDay();
                  const isOpen = (businessHours ?? []).some((hours) => hours.weekday === dayWeekday && !hours.is_closed);
                  return <div key={day.date} className={`relative border-r border-slate-100 last:border-r-0 ${isOpen ? "bg-white" : "bg-slate-50"}`} style={{
                    height: `${slotMinutes.length * 48}px`,
                    backgroundImage: "linear-gradient(to bottom, #e2e8f0 1px, transparent 1px)",
                    backgroundSize: "100% 48px",
                  }}>
                    {!isOpen && <span className="absolute inset-x-1 top-3 text-center text-[10px] font-medium text-slate-400">Cerrado</span>}
                    {day.appointments.map((appointment) => {
                      const start = businessMinute(appointment.starts_at);
                      const end = businessMinute(appointment.ends_at);
                      const top = Math.max(0, (start - weekStartMinute) * 1.6);
                      const height = Math.max(32, (end - start) * 1.6 - 2);
                      const serviceNames = (appointment.appointment_services ?? [])
                        .map((entry) => firstRelation(entry.services)?.name)
                        .filter((name): name is string => !!name)
                        .join(" + ");
                      const focusHref = `/panel?view=hoy&date=${day.date}${selectedStaffId ? `&staff=${selectedStaffId}` : ""}#${appointment.id}`;
                      return <Link key={appointment.id} href={focusHref} title={`${formatBusinessDateTime(appointment.starts_at, business.timezone)} · ${firstRelation(appointment.customers)?.name ?? "Cliente"} · ${serviceNames}`} className="absolute z-[1] overflow-hidden rounded-md border-l-[3px] border-sky-600 bg-sky-100 px-1.5 py-1 text-[10px] leading-tight text-sky-950 shadow-sm hover:z-10 hover:bg-sky-200 sm:px-2 sm:text-xs" style={{ top: `${top}px`, height: `${height}px`, left: "3px", right: "3px" }}>
                        <span className="block truncate font-bold">{formatBusinessDateTime(appointment.starts_at, business.timezone).split(", ")[1]} · {firstRelation(appointment.customers)?.name ?? "Cliente"}</span>
                        <span className="mt-0.5 block truncate">{serviceNames}</span>
                        {!selectedStaffId && (staff ?? []).length > 1 && <span className="block truncate opacity-75">{firstRelation(appointment.staff)?.name}</span>}
                      </Link>;
                    })}
                  </div>;
                })}
              </div>
              {!appointments?.length && <p className="border-t border-slate-100 p-4 text-center text-sm text-slate-500">No hay citas para este período.</p>}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {!appointments?.length && <p className="p-8 text-center text-sm text-slate-500">No hay citas para este periodo.</p>}
            {appointments?.map((appointment) => {
              const serviceDetails = (appointment.appointment_services ?? []).map((entry) => firstRelation(entry.services)).filter((service) => service !== null);
              const serviceNames = serviceDetails.map((service) => service.name).join(" + ");
              const servicePrice = serviceDetails.reduce((total, service) => total + service.price_cop, 0);
              return (
              <article id={appointment.id} key={appointment.id} className="scroll-mt-8 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex gap-3">
                    <div className="min-w-[4.5rem] pt-0.5 text-sm font-semibold text-amber-800">{formatBusinessDateTime(appointment.starts_at, business.timezone).split(", ")[1]}</div>
                    <div><p className="font-semibold">{firstRelation(appointment.customers)?.name ?? "Cliente"}</p>
                      <p className="mt-1 text-sm text-slate-600">{serviceNames} · {firstRelation(appointment.staff)?.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{firstRelation(appointment.customers)?.phone} · {currency(servicePrice)}</p>
                      {appointment.notes && <p className="mt-2 text-xs text-slate-600">Nota: {appointment.notes}</p>}
                      <p className="mt-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{statusLabel[appointment.status] ?? appointment.status}</p>
                    </div>
                  </div>
                  {appointment.customer_id && <Link href={`/panel/clientes/${appointment.customer_id}`} className="text-xs font-semibold text-amber-800">Ficha cliente</Link>}
                </div>
                <AppointmentStatusForm appointmentId={appointment.id} status={appointment.status} />
              </article>
              );
            })}
          </div>
        )}
      </section>
      <p className="mt-3 text-xs text-slate-500">El calendario muestra las citas por día y hora según los horarios de atención. En negocios con varios profesionales puedes filtrar por persona o ver el equipo completo.</p>
    </div>
  );
}
