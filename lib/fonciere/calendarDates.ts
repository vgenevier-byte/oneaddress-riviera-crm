/** Civil Gregorian dates: no local time, UTC conversion or implicit current date. */
export const MAX_CALENDAR_MONTHS = 1200;
export function daysInCivilMonth(year: number, month: number): number {
  return month === 2 ? year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28 : [4, 6, 9, 11].includes(month) ? 30 : 31;
}
export function isCivilDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInCivilMonth(year, month);
}
/** Clamp a missing target day to the last day of the target month, at each stage.
 * Thus 31 Jan + 1 month = 28/29 Feb; that result + 1 month = 28/29 Mar. */
export function addCalendarMonths(value: string, months: number): string | null {
  if (!isCivilDate(value) || !Number.isInteger(months) || months < 0 || months > MAX_CALENDAR_MONTHS) return null;
  const [year, month, day] = value.split("-").map(Number), absolute = year * 12 + month - 1 + months;
  const targetYear = Math.floor(absolute / 12), targetMonth = absolute % 12 + 1;
  if (targetYear > 9999) return null;
  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(Math.min(day, daysInCivilMonth(targetYear, targetMonth))).padStart(2, "0")}`;
}
export function formatCivilDate(value: string, locale: "fr" | "en" = "fr"): string {
  if (!isCivilDate(value)) return "";
  const [year, month, day] = value.split("-");
  return locale === "fr" ? `${day}/${month}/${year}` : `${day}/${month}/${year}`;
}
