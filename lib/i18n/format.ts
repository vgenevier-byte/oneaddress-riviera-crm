import { normalizeEuroAmount } from "../currency";
import { localeFor, type Language } from "./types";
/** Date-only strings are civil dates: formatting cannot shift their calendar day. */
export function formatScreenDate(value: string | Date | number, language: Language, options: Intl.DateTimeFormatOptions = {}) {
  if (value === "" || value === null || value === undefined) return "—";
  const civil = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = civil ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(localeFor(language), { timeZone: "Europe/Paris", hourCycle: "h23", ...options, ...(civil ? {timeZone:"UTC"} : {}) }).format(date);
}
export function formatScreenMoney(value: number, language: Language) {
  return Number.isFinite(value) ? new Intl.NumberFormat(localeFor(language), { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(normalizeEuroAmount(value)) : "—";
}
