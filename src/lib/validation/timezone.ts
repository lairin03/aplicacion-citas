export function isValidTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat("es-CO", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
