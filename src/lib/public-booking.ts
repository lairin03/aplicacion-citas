import "server-only";

import { formatInTimeZone } from "date-fns-tz";
import { localDateAtOffset, localDateTimeToUtc, localDateToUtc } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";

export type PublicBusiness = {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  type: string;
  brand_color: string;
  font_family: "sans" | "serif" | "mono";
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  timezone: string;
  logo_url: string | null;
};

export async function findPublicBusiness(slug: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("businesses")
    .select("id, owner_id, name, slug, type, phone, whatsapp, address, timezone, logo_url, brand_color, font_family")
    .eq("slug", slug).maybeSingle();
  if (error) throw new Error("No se pudo consultar el negocio.");
  return data as PublicBusiness | null;
}

export type AvailableSlot = { startsAt: string; staffId: string; staffName: string };

const APPOINTMENT_BUFFER_MINUTES = 5;
const APPOINTMENT_BUFFER_MS = APPOINTMENT_BUFFER_MINUTES * 60_000;
const SLOT_INTERVAL_MINUTES = 5;

export async function isBusinessPlanActive(ownerId: string) {
  const admin = createAdminClient();
  const { data: isSuperAdmin, error: superAdminError } = await admin.rpc("is_super_admin", {
    p_owner_id: ownerId,
  });
  if (superAdminError) throw new Error("No se pudo validar el acceso superadministrador.");
  if (isSuperAdmin) return true;

  const { data: subscription, error } = await admin.from("business_subscriptions")
    .select("status, trial_ends_at, current_period_ends_at")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new Error("No se pudo validar el plan del negocio.");
  return (subscription?.status === "active" && !!subscription.current_period_ends_at
      && new Date(subscription.current_period_ends_at) > new Date())
    || (subscription?.status === "trial" && !!subscription.trial_ends_at
      && new Date(subscription.trial_ends_at) > new Date());
}

export async function getAvailableSlots(input: {
  business: PublicBusiness;
  serviceIds: string[];
  date: string;
  staffId?: string;
}): Promise<AvailableSlot[]> {
  const admin = createAdminClient();
  if (!(await isBusinessPlanActive(input.business.owner_id))) return [];

  const { data: services, error: serviceError } = await admin.from("services")
    .select("id, duration_minutes")
    .eq("business_id", input.business.id)
    .eq("is_active", true)
    .in("id", input.serviceIds);
  if (serviceError) throw new Error("No se pudo consultar el servicio.");
  if (!services?.length || services.length !== input.serviceIds.length) return [];
  const totalDuration = services.reduce((total, service) => total + service.duration_minutes, 0);
  const serviceIdSet = new Set(input.serviceIds);

  const { data: offered, error: offeredError } = await admin.from("staff_services")
    .select("staff_id")
    .eq("business_id", input.business.id)
    .eq("is_active", true)
    .in("service_id", input.serviceIds);
  if (offeredError) throw new Error("No se pudo consultar los profesionales.");

  const staffServiceCounts = new Map<string, number>();
  for (const entry of offered ?? []) {
    staffServiceCounts.set(entry.staff_id, (staffServiceCounts.get(entry.staff_id) ?? 0) + 1);
  }
  const offeredIds = [...staffServiceCounts]
    .filter(([, count]) => count === serviceIdSet.size)
    .map(([staffId]) => staffId);
  if (!offeredIds.length) return [];
  const { data: activeStaff, error: staffError } = await admin.from("staff")
    .select("id, name, email")
    .eq("business_id", input.business.id)
    .eq("is_active", true)
    .not("email", "is", null)
    .in("id", offeredIds)
    .order("name");
  if (staffError) throw new Error("No se pudo consultar los profesionales.");

  const availableStaff = (activeStaff ?? []).filter((person) =>
    !input.staffId || person.id === input.staffId,
  );
  if (!availableStaff.length) return [];

  const weekday = new Date(`${input.date}T12:00:00Z`).getUTCDay();
  const { data: hours, error: hoursError } = await admin.from("staff_business_hours")
    .select("staff_id, open_time, close_time, is_closed")
    .eq("business_id", input.business.id)
    .eq("weekday", weekday)
    .in("staff_id", availableStaff.map((person) => person.id));
  if (hoursError) throw new Error("No se pudo consultar los horarios.");
  const hoursByStaff = new Map((hours ?? []).map((hour) => [hour.staff_id, hour]));
  const workingHours = [...hoursByStaff.values()].filter((hour) =>
    !hour.is_closed && hour.open_time && hour.close_time,
  );
  if (!workingHours.length) return [];

  const dayStart = localDateToUtc(input.date, input.business.timezone);
  const dayEnd = localDateToUtc(localDateAtOffset(input.date, 1), input.business.timezone);
  const staleRequestCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [{ data: appointments, error: appointmentsError }, { data: blockedTimes, error: blockedError }] = await Promise.all([
    admin.from("appointments")
      .select("staff_id, starts_at, ends_at, status, created_at")
      .eq("business_id", input.business.id)
      .neq("status", "cancelada")
      .lt("starts_at", dayEnd.toISOString())
      .gt("ends_at", dayStart.toISOString()),
    admin.from("blocked_times")
      .select("staff_id, starts_at, ends_at")
      .eq("business_id", input.business.id)
      .lt("starts_at", dayEnd.toISOString())
      .gt("ends_at", dayStart.toISOString()),
  ]);
  if (appointmentsError || blockedError) throw new Error("No se pudo consultar la disponibilidad.");

  const toMinutes = (value: string) => {
    const [hour, minute] = value.slice(0, 5).split(":").map(Number);
    return hour * 60 + minute;
  };
  const openMinute = Math.min(...workingHours.map((hour) => toMinutes(hour.open_time!)));
  const closeMinute = Math.max(...workingHours.map((hour) => toMinutes(hour.close_time!)));
  const slots: AvailableSlot[] = [];
  const firstStartMinute = Math.ceil(openMinute / SLOT_INTERVAL_MINUTES) * SLOT_INTERVAL_MINUTES;
  for (
    let startMinute = firstStartMinute;
    startMinute + totalDuration <= closeMinute;
    startMinute += SLOT_INTERVAL_MINUTES
  ) {
    const time = `${String(Math.floor(startMinute / 60)).padStart(2, "0")}:${String(startMinute % 60).padStart(2, "0")}`;
    const startsAt = localDateTimeToUtc(`${input.date}T${time}`, input.business.timezone);
    if (startsAt <= new Date()) continue;
    if (formatInTimeZone(startsAt, input.business.timezone, "yyyy-MM-dd'T'HH:mm") !== `${input.date}T${time}`) continue;
    const endsAt = new Date(startsAt.getTime() + totalDuration * 60_000);
    const bufferedEndsAt = new Date(endsAt.getTime() + APPOINTMENT_BUFFER_MS);

    const firstFreeStaff = availableStaff.find((person) => {
      const staffHours = hoursByStaff.get(person.id);
      if (!staffHours || staffHours.is_closed || !staffHours.open_time || !staffHours.close_time
        || startMinute < toMinutes(staffHours.open_time)
        || startMinute + totalDuration > toMinutes(staffHours.close_time)) return false;
      const hasAppointment = appointments?.some((appointment) =>
        appointment.staff_id === person.id
        && !(appointment.status === "pendiente" && new Date(appointment.created_at) <= staleRequestCutoff)
        && new Date(appointment.starts_at) < bufferedEndsAt
        && new Date(appointment.ends_at).getTime() + APPOINTMENT_BUFFER_MS > startsAt.getTime(),
      );
      const hasBlock = blockedTimes?.some((block) =>
        (block.staff_id === null || block.staff_id === person.id)
        && new Date(block.starts_at) < endsAt
        && new Date(block.ends_at) > startsAt,
      );
      return !hasAppointment && !hasBlock;
    });

    if (firstFreeStaff) {
      slots.push({ startsAt: startsAt.toISOString(), staffId: firstFreeStaff.id, staffName: firstFreeStaff.name });
    }
  }
  return slots;
}
