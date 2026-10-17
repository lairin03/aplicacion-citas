import { addDays, endOfMonth, format, startOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export function businessLocalDate(date: Date, timezone: string) {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

export function localDateToUtc(date: string, timezone: string) {
  return fromZonedTime(`${date}T00:00:00`, timezone);
}

export function localDateTimeToUtc(dateTime: string, timezone: string) {
  return fromZonedTime(dateTime, timezone);
}

export function formatBusinessDateTime(date: string, timezone: string) {
  return formatInTimeZone(new Date(date), timezone, "EEE d MMM, HH:mm", { locale: es });
}

export function currentWeekRange(date: string, timezone: string) {
  const start = localDateToUtc(date, timezone);
  const dayOfWeek = Number(formatInTimeZone(start, timezone, "i")) % 7;
  const weekStartDate = formatInTimeZone(
    localDateToUtc(date, timezone),
    timezone,
    "yyyy-MM-dd",
  );
  const weekStartLocal = addDays(new Date(`${weekStartDate}T12:00:00`), -dayOfWeek);
  const weekEndLocal = addDays(weekStartLocal, 7);
  const dateOnly = (value: Date) => format(value, "yyyy-MM-dd");
  return {
    start: localDateToUtc(dateOnly(weekStartLocal), timezone),
    end: localDateToUtc(dateOnly(weekEndLocal), timezone),
  };
}

export function currentMonthRange(date: string, timezone: string) {
  const monthDate = localDateToUtc(date, timezone);
  const localMonth = new Date(`${formatInTimeZone(monthDate, timezone, "yyyy-MM")}-01T12:00:00`);
  const start = startOfMonth(localMonth);
  const afterEnd = addDays(endOfMonth(localMonth), 1);
  return {
    start: localDateToUtc(format(start, "yyyy-MM-dd"), timezone),
    end: localDateToUtc(format(afterEnd, "yyyy-MM-dd"), timezone),
  };
}

export function localDateAtOffset(date: string, offset: number) {
  return format(addDays(new Date(`${date}T12:00:00`), offset), "yyyy-MM-dd");
}

export function monthDays(date: string) {
  const monthDate = new Date(`${date.slice(0, 7)}-01T12:00:00`);
  const first = startOfMonth(monthDate);
  const offset = first.getDay();
  const gridStart = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

export function localCalendarDate(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}
