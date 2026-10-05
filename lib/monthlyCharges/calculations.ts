import { euroAmountToCents } from "../currency";
import { getHouseTimeHours } from "../houseTracking";
import type {
  MonthlyChargeAttachment, MonthlyChargeSource, MonthlyChargesSnapshot,
  MonthlyInvoiceSource, MonthlyTimeSource
} from "./types";

export type MonthlyChargeAllocation = {
  month: string;
  amountCents: number;
  origin: "Date de facture" | "Rattachement personnalisé" | "Répartition personnalisée" | "Date d’intervention";
};
export type MonthlyChargeEntry = {
  key: string; source: MonthlyChargeSource; sourceId: string; personId: string; personLabel: string;
  title: string; sourceDate: string; amountCents: number | null; selected: boolean;
  selectionOrigin: "individual" | "person" | "none"; reason: string;
  status: "included" | "excluded" | "expected" | "unattached" | "invalid" | "missing";
  allocations: MonthlyChargeAllocation[]; issues: string[]; houseId?: string; houseName?: string;
  sourceStatus?: string;
};
export type MonthlyChargesFilter = {
  source?: MonthlyChargeSource | "all"; houseId?: string; now?: string;
};
export type MonthlyChargesResult = {
  year: number; filter: MonthlyChargesFilter; readableSources: MonthlyChargeSource[]; totalCents: number;
  months: { month: string; totalCents: number; invoiceCents: number; hoursCents: number; current: boolean; future: boolean }[];
  groups: { key: string; source: MonthlyChargeSource; personId: string; label: string; monthsCents: number[]; totalCents: number }[];
  entries: MonthlyChargeEntry[]; expected: MonthlyChargeEntry[]; unattached: MonthlyChargeEntry[];
  excluded: MonthlyChargeEntry[]; issues: MonthlyChargeEntry[]; houseUnknown: MonthlyChargeEntry[];
};
export type MonthlyChargesExportScope = { source?: MonthlyChargeSource | "all"; houseId?: string; houseLabel?: string; description?: string };

const invoiceStatuses = new Set(["En attente de facture", "À payer", "Partiellement payé", "Payé", "En retard", "Annulé"]);
const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** Strict validation wraps the existing rounding helper: missing/invalid never becomes zero. */
export function parseMonthlyChargeCents(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\+?\d+(?:[.,]\d+)?$/.test(value.trim())) return null;
  const numeric = typeof value === "number" ? value : Number(value.trim().replace(",", "."));
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const cents = euroAmountToCents(numeric);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Civil dates are validated arithmetically, without UTC/local month conversion. */
export function isMonthlyChargeCivilDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function isMonthlyChargeMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) > 0;
}

function monthNumber(month: string) { return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1; }
function monthFromNumber(value: number) { return `${Math.floor(value / 12).toString().padStart(4, "0")}-${(value % 12 + 1).toString().padStart(2, "0")}`; }
function addCents(left: number, right: number) {
  const total = left + right;
  if (!Number.isSafeInteger(total)) throw new Error("Total trop élevé pour un calcul monétaire précis ; vérifier les montants sources.");
  return total;
}

/** Residual cents go to the earliest months; one invoice is never counted on top of its fractions. */
export function spreadMonthlyChargeCents(amountCents: number, startMonth: string, endMonth: string): MonthlyChargeAllocation[] {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0 || !isMonthlyChargeMonth(startMonth) || !isMonthlyChargeMonth(endMonth)) {
    throw new Error("Montant ou période de répartition invalide.");
  }
  const first = monthNumber(startMonth);
  const count = monthNumber(endMonth) - first + 1;
  if (count < 1 || count > 12) throw new Error("La répartition doit couvrir 1 à 12 mois consécutifs.");
  const base = Math.floor(amountCents / count);
  const remainder = amountCents % count;
  return Array.from({ length: count }, (_, index) => ({
    month: monthFromNumber(first + index), amountCents: base + (index < remainder ? 1 : 0), origin: "Répartition personnalisée"
  }));
}

function amountPrecisionIssue(value: unknown) {
  const number = typeof value === "string" ? Number(value.trim().replace(",", ".")) : value;
  return typeof number === "number" && Math.abs(number * 100 - Math.round(number * 100)) > 0.000001;
}

function invoiceAllocations(invoice: MonthlyInvoiceSource, attachment: MonthlyChargeAttachment | undefined, amountCents: number | null, issues: string[]) {
  if (amountCents === null) return [];
  if (attachment) {
    if (attachment.mode === "month" && isMonthlyChargeMonth(attachment.month)) {
      return [{ month: attachment.month, amountCents, origin: "Rattachement personnalisé" as const }];
    }
    if (attachment.mode === "spread") {
      try { return spreadMonthlyChargeCents(amountCents, attachment.startMonth, attachment.endMonth); }
      catch { issues.push("Rattachement personnalisé invalide : choisir 1 à 12 mois consécutifs."); return []; }
    }
    issues.push("Mois de rattachement personnalisé invalide.");
    return [];
  }
  return isMonthlyChargeCivilDate(invoice.invoiceDate)
    ? [{ month: invoice.invoiceDate.slice(0, 7), amountCents, origin: "Date de facture" as const }]
    : [];
}

function hourAmount(entry: MonthlyTimeSource, issues: string[]): number | null {
  const rateCents = parseMonthlyChargeCents(entry.hourlyRate);
  if (rateCents === null) issues.push("Taux enregistré sur la ligne manquant ou invalide.");
  const validTimes = typeof entry.startTime === "string" && typeof entry.endTime === "string" &&
    clockPattern.test(entry.startTime) && clockPattern.test(entry.endTime);
  if (!validTimes) issues.push("Horaires manquants ou invalides.");
  const pause = entry.breakMinutes;
  const validPause = typeof pause === "number" && Number.isFinite(pause) && pause >= 0 && Number.isInteger(pause);
  if (!validPause) issues.push("Pause manquante ou invalide.");
  if (rateCents === null || !validTimes || !validPause) return null;
  const startTime = entry.startTime!;
  const endTime = entry.endTime!;
  const start = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3));
  let end = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3));
  if (end < start) end += 24 * 60;
  if (pause > end - start) { issues.push("La pause dépasse la durée de l’intervention."); return null; }
  if (amountPrecisionIssue(entry.hourlyRate)) issues.push("Taux avec précision atypique ; coût arrondi au centime.");
  const rate = typeof entry.hourlyRate === "number" ? entry.hourlyRate : Number(String(entry.hourlyRate).replace(",", "."));
  const hours = getHouseTimeHours({ startTime, endTime, breakMinutes: pause });
  const amount = parseMonthlyChargeCents(hours * rate);
  if (amount === null) issues.push("Coût invalide ou trop élevé pour un calcul monétaire précis.");
  return amount;
}

/** Input must be the user-scoped server snapshot; payments and source documents are absent by design. */
export function evaluateMonthlyChargeEntries(snapshot: MonthlyChargesSnapshot): MonthlyChargeEntry[] {
  const allowed = new Set(snapshot.permissions.readableSources);
  const rules = new Set(snapshot.config.personRules.filter(rule => allowed.has(rule.source)).map(rule => `${rule.source}:${rule.personId}`));
  const exceptions = new Map(snapshot.config.exceptions.filter(exception => allowed.has(exception.source)).map(exception => [`${exception.source}:${exception.sourceId}`, exception]));
  const attachments = new Map(snapshot.config.attachments.filter(attachment => allowed.has(attachment.source)).map(attachment => [attachment.sourceId, attachment]));
  const seen = new Map<string, MonthlyChargeEntry>();
  const append = (source: MonthlyChargeSource, record: MonthlyInvoiceSource | MonthlyTimeSource) => {
    if (!allowed.has(source)) return;
    const key = `${source}:${record.id}`;
    if (seen.has(key)) { seen.get(key)!.issues.push("Identifiant source répété : une seule ligne comptée."); return; }
    const exception = exceptions.get(key);
    const followed = rules.has(`${source}:${record.personId}`);
    const selected = exception ? exception.included : followed;
    const issues: string[] = [];
    let amountCents: number | null;
    let allocations: MonthlyChargeAllocation[];
    let status: MonthlyChargeEntry["status"] = selected ? "included" : "excluded";
    let sourceDate: string;
    let title: string;
    if (source === "invoice") {
      const invoice = record as MonthlyInvoiceSource;
      amountCents = parseMonthlyChargeCents(invoice.amount);
      if (amountCents === null) issues.push("Montant enregistré manquant ou invalide.");
      else if (amountPrecisionIssue(invoice.amount)) issues.push("Montant avec précision atypique ; coût arrondi au centime.");
      sourceDate = invoice.invoiceDate || "";
      title = invoice.title;
      if (!isMonthlyChargeCivilDate(sourceDate)) issues.push("Date de facture manquante ou invalide ; le rattachement ne peut pas être déduit.");
      allocations = invoiceAllocations(invoice, attachments.get(record.id), amountCents, issues);
      if (!invoiceStatuses.has(invoice.status || "")) issues.push("Statut de facture manquant ou invalide.");
      if (selected) {
        if (invoice.status === "Annulé") status = "excluded";
        else if (invoice.status === "En attente de facture") status = "expected";
        else if (amountCents === null || !invoiceStatuses.has(invoice.status || "")) status = "invalid";
        else if (!allocations.length) status = "unattached";
      }
    } else {
      const hours = record as MonthlyTimeSource;
      amountCents = hourAmount(hours, issues);
      sourceDate = hours.date || "";
      title = `Intervention ${hours.startTime || "?"} – ${hours.endTime || "?"}`;
      if (!isMonthlyChargeCivilDate(sourceDate)) issues.push("Date d’intervention manquante ou invalide.");
      allocations = amountCents !== null && isMonthlyChargeCivilDate(sourceDate)
        ? [{ month: sourceDate.slice(0, 7), amountCents, origin: "Date d’intervention" }]
        : [];
      if (selected && (amountCents === null || !allocations.length)) status = "invalid";
    }
    seen.set(key, {
      key, source, sourceId: record.id, personId: record.personId, personLabel: record.personLabel,
      title, sourceDate, amountCents, selected, selectionOrigin: exception ? "individual" : followed ? "person" : "none",
      reason: exception?.reason || (source === "invoice" && (record as MonthlyInvoiceSource).status === "Annulé" ? "Facture annulée" : ""),
      status, allocations, issues,
      ...(source === "hours" ? { houseId: (record as MonthlyTimeSource).houseId, houseName: (record as MonthlyTimeSource).houseName } : {}),
      ...(source === "invoice" ? { sourceStatus: (record as MonthlyInvoiceSource).status } : {})
    });
  };
  snapshot.sources.invoices.forEach(record => append("invoice", record));
  snapshot.sources.timeEntries.forEach(record => append("hours", record));
  const missing = new Set<string>();
  for (const exception of exceptions.values()) missing.add(`${exception.source}:${exception.sourceId}`);
  for (const attachment of attachments.values()) missing.add(`${attachment.source}:${attachment.sourceId}`);
  for (const key of missing) {
    if (seen.has(key)) continue;
    const exception = exceptions.get(key);
    const colon = key.indexOf(":");
    seen.set(key, {
      key, source: key.slice(0, colon) as MonthlyChargeSource, sourceId: key.slice(colon + 1), personId: "", personLabel: "Source indisponible",
      title: "Source indisponible", sourceDate: "", amountCents: null, selected: exception?.included || false,
      selectionOrigin: exception ? "individual" : "none", reason: exception?.reason || "", status: "missing", allocations: [],
      issues: ["Une exception ou un rattachement n’a plus de cible disponible dans votre périmètre."]
    });
  }
  return [...seen.values()];
}

function parisCivilDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (name: string) => parts.find(item => item.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function buildMonthlyCharges(snapshot: MonthlyChargesSnapshot, year: number, filter: MonthlyChargesFilter = {}): MonthlyChargesResult {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new Error("Année invalide.");
  const today = isMonthlyChargeCivilDate(filter.now) ? filter.now : parisCivilDate();
  const currentMonth = today.slice(0, 7);
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = `${year.toString().padStart(4, "0")}-${(index + 1).toString().padStart(2, "0")}`;
    return { month, totalCents: 0, invoiceCents: 0, hoursCents: 0, current: month === currentMonth, future: month > currentMonth };
  });
  const candidates = evaluateMonthlyChargeEntries(snapshot).filter(entry =>
    (!filter.source || filter.source === "all" || entry.source === filter.source) &&
    (entry.allocations.some(allocation => allocation.month.slice(0, 4) === year.toString().padStart(4, "0")) ||
      (!entry.allocations.length && (!isMonthlyChargeCivilDate(entry.sourceDate) || Number(entry.sourceDate.slice(0, 4)) === year)))
  );
  const houseUnknown = filter.houseId ? candidates.filter(entry => entry.source === "invoice") : [];
  const entries = filter.houseId ? candidates.filter(entry => entry.source === "hours" && entry.houseId === filter.houseId) : candidates;
  const groups = new Map<string, MonthlyChargesResult["groups"][number]>();
  for (const entry of entries) {
    if (entry.status !== "included") continue;
    const key = `${entry.source}:${entry.personId || entry.sourceId}`;
    const group = groups.get(key) || { key, source: entry.source, personId: entry.personId, label: entry.personLabel, monthsCents: Array<number>(12).fill(0), totalCents: 0 };
    for (const allocation of entry.allocations) {
      if (Number(allocation.month.slice(0, 4)) !== year) continue;
      const index = Number(allocation.month.slice(5, 7)) - 1;
      months[index].totalCents = addCents(months[index].totalCents, allocation.amountCents);
      if (entry.source === "invoice") months[index].invoiceCents = addCents(months[index].invoiceCents, allocation.amountCents);
      else months[index].hoursCents = addCents(months[index].hoursCents, allocation.amountCents);
      group.monthsCents[index] = addCents(group.monthsCents[index], allocation.amountCents);
      group.totalCents = addCents(group.totalCents, allocation.amountCents);
    }
    groups.set(key, group);
  }
  return {
    year, filter, readableSources: snapshot.permissions.readableSources.filter(source => !filter.source || filter.source === "all" || source === filter.source),
    totalCents: months.reduce((sum, month) => addCents(sum, month.totalCents), 0), months,
    groups: [...groups.values()].sort((a, b) => a.source.localeCompare(b.source) || a.label.localeCompare(b.label, "fr") || a.key.localeCompare(b.key)),
    entries, houseUnknown, expected: entries.filter(entry => entry.status === "expected"),
    unattached: entries.filter(entry => entry.status === "unattached"), excluded: entries.filter(entry => entry.status === "excluded"),
    issues: entries.filter(entry => entry.issues.length > 0 || entry.status === "invalid" || entry.status === "missing")
  };
}

/** Only scoped custom attachments whose current source amount changed need this warning. */
export function findRecalculatedMonthlyCharges(previous: MonthlyChargesSnapshot, next: MonthlyChargesSnapshot): string[] {
  const oldAmounts = new Map(previous.sources.invoices.map(invoice => [invoice.id, parseMonthlyChargeCents(invoice.amount)]));
  const custom = new Set(next.config.attachments.map(attachment => attachment.sourceId));
  return next.sources.invoices.filter(invoice => custom.has(invoice.id) && oldAmounts.has(invoice.id) &&
    parseMonthlyChargeCents(invoice.amount) !== oldAmounts.get(invoice.id)).map(invoice => invoice.id);
}

/** Quote every cell and neutralize formula prefixes, including prefixes concealed by whitespace. */
export function monthlyChargesCsvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function csv(rows: unknown[][]) { return `\uFEFF${rows.map(row => row.map(monthlyChargesCsvCell).join(";")).join("\r\n")}\r\n`; }
function decimal(cents: number | null) {
  return cents === null ? "" : `${Math.floor(cents / 100)},${(cents % 100).toString().padStart(2, "0")}`;
}
function sourceLabel(source: MonthlyChargeSource) { return source === "invoice" ? "Factures prestataires" : "Suivi maison"; }
const statusLabels: Record<MonthlyChargeEntry["status"], string> = {
  included: "Charges", excluded: "Exclues", expected: "Factures attendues",
  unattached: "À rattacher", invalid: "Données à vérifier", missing: "Source indisponible"
};
function scopeLabel(result: MonthlyChargesResult, scope: MonthlyChargesExportScope) {
  return ["Vue limitée aux sources autorisées", result.readableSources.map(sourceLabel).join(" et ") || "Aucune source autorisée",
    result.filter.houseId ? `Maison : ${scope.houseLabel || result.filter.houseId} ; factures sans maison hors total` : "Toutes maisons",
    scope.description || ""].filter(Boolean).join(" · ");
}

export function exportAnnualChargesCsv(result: MonthlyChargesResult, scope: MonthlyChargesExportScope = {}): string {
  const perimeter = scopeLabel(result, scope);
  const header = ["Année", "Périmètre", "Origine", "Fournisseur / intervenant", "Rattachement", ...result.months.map(month => month.month), "Total année (€)"];
  const rows: unknown[][] = [header];
  for (const group of result.groups) rows.push([result.year, perimeter, sourceLabel(group.source), group.label, "Selon détail autorisé", ...group.monthsCents.map(decimal), decimal(group.totalCents)]);
  for (const [label, field] of [["Sous-total Factures", "invoiceCents"], ["Sous-total Suivi maison", "hoursCents"], ["Total des charges sélectionnées", "totalCents"]] as const) {
    const values = result.months.map(month => month[field]);
    rows.push([result.year, perimeter, label, "", "Montants enregistrés dans le CRM", ...values.map(decimal), decimal(values.reduce(addCents, 0))]);
  }
  return csv(rows);
}

export function exportDetailedChargesCsv(result: MonthlyChargesResult, scope: MonthlyChargesExportScope = {}, month?: string): string {
  if (month && (!isMonthlyChargeMonth(month) || Number(month.slice(0, 4)) !== result.year)) throw new Error("Mois d’export invalide.");
  const perimeter = scopeLabel(result, scope);
  const rows: unknown[][] = [["Période", "Périmètre", "Origine", "Identifiant source", "Fournisseur / intervenant", "Intitulé", "Date source", "Mois retenu", "Rattachement", "Sélection", "Rubrique", "Montant source (€)", "Montant retenu (€)", "Motif / qualité"]];
  const append = (entry: MonthlyChargeEntry, unknownHouse = false) => {
    const allocations = entry.allocations.filter(allocation => Number(allocation.month.slice(0, 4)) === result.year && (!month || allocation.month === month));
    if (month && entry.allocations.length && !allocations.length) return;
    const parts: (MonthlyChargeAllocation | undefined)[] = allocations.length ? allocations : [undefined];
    for (const allocation of parts) {
      const counted = entry.status === "included" && !unknownHouse && Boolean(allocation);
      rows.push([month || String(result.year), perimeter, sourceLabel(entry.source), entry.sourceId, entry.personLabel, entry.title,
        entry.sourceDate, allocation?.month || "", allocation?.origin || "À vérifier", entry.selected ? "Retenue" : "Non retenue",
        unknownHouse ? "Maison non renseignée · hors total" : entry.status === "included" ? "Charges" : `${statusLabels[entry.status]} · hors total`,
        decimal(entry.amountCents), decimal(counted ? allocation!.amountCents : 0), [entry.reason, ...entry.issues].filter(Boolean).join(" · ")]);
    }
  };
  result.entries.forEach(entry => append(entry));
  result.houseUnknown.forEach(entry => append(entry, true));
  const total = month ? result.months.find(item => item.month === month)!.totalCents : result.totalCents;
  rows.push([month || String(result.year), perimeter, "Total des charges sélectionnées", "", "", "", "", "", "Montants enregistrés dans le CRM", "", "Total", "", decimal(total), ""]);
  return csv(rows);
}
