import type { FonciereData } from "./model";
import { currentGuidedValue, type GuidedComposite, type GuidedLocale } from "./guided";
import { addCalendarMonths, formatCivilDate, isCivilDate, MAX_CALENDAR_MONTHS } from "./calendarDates";
export { addCalendarMonths, formatCivilDate, isCivilDate, MAX_CALENDAR_MONTHS } from "./calendarDates";

export type PersonalProjectStrategy = "resale" | "rental" | "rental_then_resale";
export type ProjectCalendar = {
  strategy: PersonalProjectStrategy | null;
  startDate: string | null;
  durationMonths: number | null;
  worksEndDate: string | null;
  rentalDelayMonths: number | null;
  saleDelayMonths: number | null;
  firstRentDate: string | null;
  saleReceiptDate: string | null;
  firstReceiptDate: string | null;
  firstReceiptMonths: number | null;
  inconsistentChronology: boolean;
};
const composite = (value: unknown): GuidedComposite => value && typeof value === "object" && !Array.isArray(value) ? value as GuidedComposite : {};
const months = (value: unknown): number | null => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_CALENDAR_MONTHS ? value : null;
/** Only the chosen personal strategy contributes dates. Retained inactive values
 * stay in guided data and cannot silently select an alternative scenario. */
export function calculateProjectCalendar(data: FonciereData): ProjectCalendar {
  const rawStrategy = currentGuidedValue(data, "personalStrategy");
  const strategy = rawStrategy === "resale" || rawStrategy === "rental" || rawStrategy === "rental_then_resale" ? rawStrategy : null;
  const works = composite(currentGuidedValue(data, "worksHypothesis"));
  const resale = composite(currentGuidedValue(data, "resaleHypothesis"));
  const rental = composite(currentGuidedValue(data, "rentalHypothesis"));
  const startDate = isCivilDate(works.startDate) ? works.startDate : null;
  const durationMonths = months(works.durationMonths);
  const hasRent = strategy === "rental" || strategy === "rental_then_resale";
  const hasSale = strategy === "resale" || strategy === "rental_then_resale";
  const reference = data.rentalPlan?.scenarios.find(s => s.id === data.rentalPlan?.referenceId);
  const rentalDelayMonths = hasRent ? reference ? months(reference.receiptDelayMonths) : data.rentalPlan ? null : months(rental.receiptDelayMonths) : null;
  const saleDelayMonths = hasSale ? months(resale.receiptDelayMonths) : null;
  const worksEndDate = startDate !== null && durationMonths !== null ? addCalendarMonths(startDate, durationMonths) : null;
  const firstRentDate = worksEndDate !== null && rentalDelayMonths !== null ? addCalendarMonths(worksEndDate, rentalDelayMonths) : null;
  const saleReceiptDate = worksEndDate !== null && saleDelayMonths !== null ? addCalendarMonths(worksEndDate, saleDelayMonths) : null;
  // For rental then resale, first receipts always mean rent, even if a sale
  // assumption is earlier; that inconsistency is shown separately.
  const firstDelay = hasRent ? rentalDelayMonths : hasSale ? saleDelayMonths : null;
  return {
    strategy, startDate, durationMonths, worksEndDate, rentalDelayMonths, saleDelayMonths, firstRentDate, saleReceiptDate,
    firstReceiptDate: hasRent ? firstRentDate : hasSale ? saleReceiptDate : null,
    firstReceiptMonths: durationMonths !== null && firstDelay !== null ? durationMonths + firstDelay : null,
    inconsistentChronology: strategy === "rental_then_resale" && rentalDelayMonths !== null && saleDelayMonths !== null && saleDelayMonths < rentalDelayMonths,
  };
}
export const PROJECT_CALENDAR_RULES = {
  fr: "Calcul en mois calendaires, à chaque étape : si le jour n’existe pas dans le mois d’arrivée, le dernier jour de ce mois est retenu (31 janvier + 1 mois = 28 ou 29 février). Les dates sont civiles, sans effet de fuseau horaire. Les échéances restent des hypothèses, sans garantie de rentabilité ni de récupération de l’investissement.",
  en: "Calendar months are added at each stage: if the day does not exist in the target month, its last day is used (31 January + 1 month = 28 or 29 February). Civil dates have no time zone offset. These dates remain assumptions, without any guarantee of profitability or recovery of the investment.",
};
export const PROJECT_CALENDAR_CHRONOLOGY_WARNING = {
  fr: "Chronologie incohérente : la vente est prévue avant le premier loyer. Vérifiez les délais de location et de revente.",
  en: "Inconsistent chronology: the sale is planned before the first rent. Check the rental and resale delays.",
};
export function projectCalendarRule(locale: GuidedLocale = "fr"): string { return PROJECT_CALENDAR_RULES[locale]; }
export type ProjectCalendarRow = { key: string; label: string; value: string };
export function projectCalendarRows(data: FonciereData, locale: GuidedLocale = "fr"): ProjectCalendarRow[] {
  const c = calculateProjectCalendar(data), fr = locale === "fr";
  const t = (a: string, b: string) => fr ? a : b;
  const missing = t("À renseigner", "To complete");
  const monthText = (value: number | null) => value === null ? missing : `${value} ${t("mois", value === 1 ? "month" : "months")}`;
  const worksMissing = [c.startDate === null ? t("la date de début des travaux", "the works start date") : "", c.durationMonths === null ? t("la durée des travaux", "the works duration") : ""].filter(Boolean);
  const dateText = (value: string | null, extra: string[] = []) => value !== null ? formatCivilDate(value, locale) : [...worksMissing, ...extra].length ? `${t("Date non calculable — compléter", "Date cannot be calculated — complete")} : ${[...worksMissing, ...extra].join(t(" et ", " and "))}.` : t("Date non calculable — résultat hors des années 0001 à 9999.", "Date cannot be calculated — result outside years 0001 to 9999.");
  const rentMissing = c.rentalDelayMonths === null ? [t("le délai avant le premier loyer", "the delay before first rent")] : [];
  const saleMissing = c.saleDelayMonths === null ? [t("le délai avant l’encaissement de la vente", "the delay before sale proceeds")] : [];
  const strategies = { resale: t("Revente", "Resale"), rental: t("Location", "Rental"), rental_then_resale: t("Location puis revente", "Rental then resale") };
  const rows: ProjectCalendarRow[] = [
    { key: "strategy", label: t("Stratégie personnelle", "Personal strategy"), value: c.strategy ? strategies[c.strategy] : t("À définir", "To define") },
    { key: "startDate", label: t("Début prévisionnel des travaux", "Planned works start"), value: c.startDate ? formatCivilDate(c.startDate, locale) : missing },
    { key: "durationMonths", label: t("Durée prévisionnelle des travaux", "Planned works duration"), value: c.durationMonths === 0 ? t("0 mois — Sans travaux", "0 months — No works") : monthText(c.durationMonths) },
    { key: "worksEndDate", label: t("Fin prévisionnelle / disponibilité après travaux", "Planned completion / availability after works"), value: dateText(c.worksEndDate) },
  ];
  if (c.strategy === "rental" || c.strategy === "rental_then_resale") rows.push({ key: "firstRentDate", label: t("Premier loyer prévisionnel", "Planned first rent receipt"), value: dateText(c.firstRentDate, rentMissing) });
  if (c.strategy === "resale" || c.strategy === "rental_then_resale") rows.push({ key: "saleReceiptDate", label: t("Encaissement prévisionnel de la vente", "Planned receipt of sale proceeds"), value: dateText(c.saleReceiptDate, saleMissing) });
  rows.push({ key: "firstReceiptDate", label: t("Premiers encaissements prévisionnels", "Planned first receipts"), value: c.strategy ? dateText(c.firstReceiptDate, c.strategy === "resale" ? saleMissing : rentMissing) : t("Date non calculable — compléter la stratégie personnelle du projet.", "Date cannot be calculated — complete the personal project strategy.") });
  const delayMissing = [c.strategy === null ? t("la stratégie personnelle", "the personal strategy") : "", c.durationMonths === null ? t("la durée des travaux", "the works duration") : "", ...(c.strategy === "resale" ? saleMissing : c.strategy ? rentMissing : [])].filter(Boolean);
  rows.push({ key: "firstReceiptMonths", label: t("Délai cumulé depuis le début des travaux jusqu’aux premiers encaissements", "Total delay from works start until first receipts"), value: c.firstReceiptMonths !== null ? `${monthText(c.firstReceiptMonths)}${c.startDate === null ? t(" — délai calculé ; date non calculable sans début des travaux", " — delay calculated; date requires a works start date") : ""}` : `${missing}${delayMissing.length ? ` — ${t("compléter", "complete")} : ${delayMissing.join(t(" et ", " and "))}` : ""}` });
  return rows;
}
export function projectCalendarText(data: FonciereData, locale: GuidedLocale = "fr"): string {
  return [locale === "fr" ? "Calendrier prévisionnel du projet" : "Planned project calendar", ...projectCalendarRows(data, locale).map(row => `${row.label} : ${row.value}`), calculateProjectCalendar(data).inconsistentChronology ? PROJECT_CALENDAR_CHRONOLOGY_WARNING[locale] : "", projectCalendarRule(locale)].filter(Boolean).join("\n");
}
