import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMonthlyCharges, evaluateMonthlyChargeEntries, exportAnnualChargesCsv,
  exportDetailedChargesCsv, findRecalculatedMonthlyCharges, isMonthlyChargeCivilDate,
  monthlyChargesCsvCell, parseMonthlyChargeCents, spreadMonthlyChargeCents
} from "../../lib/monthlyCharges/calculations";
import type { MonthlyChargesSnapshot, MonthlyInvoiceSource, MonthlyTimeSource } from "../../lib/monthlyCharges/types";

function invoice(id = "invoice-1", overrides: Partial<MonthlyInvoiceSource> = {}): MonthlyInvoiceSource {
  return { id, personId: "supplier-1", personLabel: "Fournisseur fictif", title: "Entretien fictif", invoiceDate: "2026-09-01", amount: 600, status: "Payé", ...overrides };
}
function hours(id = "hours-1", overrides: Partial<MonthlyTimeSource> = {}): MonthlyTimeSource {
  return { id, personId: "worker-1", personLabel: "Intervenant fictif", houseId: "house-1", houseName: "Maison fictive", date: "2026-09-05", startTime: "08:00", endTime: "18:00", breakMinutes: 0, hourlyRate: 30, ...overrides };
}
function snapshot(invoices = [invoice()], timeEntries = [hours()]): MonthlyChargesSnapshot {
  return {
    revision: "0", sourceRevision: "source-0",
    config: { personRules: [{ source: "invoice", personId: "supplier-1", included: true }, { source: "hours", personId: "worker-1", included: true }], exceptions: [], attachments: [] },
    sources: { invoices, timeEntries, suppliers: [{ id: "supplier-1", label: "Fournisseur fictif" }], workers: [{ id: "worker-1", label: "Intervenant fictif", status: "Actif" }], houses: [{ id: "house-1", name: "Maison fictive" }] },
    permissions: { canContribute: true, readableSources: ["invoice", "hours"], exportableSources: ["invoice", "hours"], contactsVisible: true }
  };
}
const filter = { now: "2026-10-05" };
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && char === ";") { row.push(cell); cell = ""; }
    else if (!quoted && char === "\r" && source[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
    else cell += char;
  }
  return rows;
}

test("600 € de factures et 10 h × 30 € restent 900 € en septembre indépendamment des paiements d’octobre", () => {
  const state = snapshot();
  const before = JSON.stringify(state);
  const result = buildMonthlyCharges(state, 2026, filter);
  assert.equal(result.months[8].totalCents, 90000);
  assert.equal(result.months[9].totalCents, 0);
  assert.equal(result.totalCents, 90000);
  assert.equal(result.months[9].current, true);
  assert.equal(result.months[10].future, true);
  assert.equal(JSON.stringify(state), before);
  for (const status of ["À payer", "Partiellement payé", "Payé", "En retard"]) {
    state.sources.invoices[0].status = status;
    assert.equal(buildMonthlyCharges(state, 2026, filter).totalCents, 90000);
  }
});

test("rattachement personnalisé remplace le mois unique et le retour au défaut préserve la date source", () => {
  const state = snapshot([invoice("invoice-1", { invoiceDate: "2026-10-01" })], []);
  state.config.attachments = [{ source: "invoice", sourceId: "invoice-1", mode: "month", month: "2026-09" }];
  const before = JSON.stringify(state.sources);
  let result = buildMonthlyCharges(state, 2026, filter);
  assert.equal(result.months[8].totalCents, 60000);
  assert.equal(result.months[9].totalCents, 0);
  assert.equal(result.entries[0].allocations[0].origin, "Rattachement personnalisé");
  state.config.attachments = [];
  result = buildMonthlyCharges(state, 2026, filter);
  assert.equal(result.months[9].totalCents, 60000);
  assert.equal(result.entries[0].allocations[0].origin, "Date de facture");
  assert.equal(JSON.stringify(state.sources), before);
});

test("répartition 900 € / trois mois et centimes résiduels de 100 € stables sur les premiers mois", () => {
  assert.deepEqual(spreadMonthlyChargeCents(90000, "2026-10", "2026-12").map(part => part.amountCents), [30000, 30000, 30000]);
  const fractions = spreadMonthlyChargeCents(10000, "2026-10", "2026-12");
  assert.deepEqual(fractions.map(part => part.amountCents), [3334, 3333, 3333]);
  assert.equal(fractions.reduce((sum, part) => sum + part.amountCents, 0), 10000);
  assert.throws(() => spreadMonthlyChargeCents(10000, "2026-01", "2027-01"), /1 à 12/);
  assert.throws(() => spreadMonthlyChargeCents(10000, "2026-12", "2026-01"), /1 à 12/);
});

test("répartition décembre-janvier figure dans chaque année même si la facture date d’une autre année", () => {
  const state = snapshot([invoice("invoice-1", { amount: 100, invoiceDate: "2025-11-25" })], []);
  state.config.attachments = [{ source: "invoice", sourceId: "invoice-1", mode: "spread", startMonth: "2026-12", endMonth: "2027-01" }];
  assert.equal(buildMonthlyCharges(state, 2025, filter).totalCents, 0);
  assert.equal(buildMonthlyCharges(state, 2026, filter).months[11].totalCents, 5000);
  assert.equal(buildMonthlyCharges(state, 2027, filter).months[0].totalCents, 5000);
  const updated = structuredClone(state);
  updated.sources.invoices[0].amount = 120;
  assert.deepEqual(findRecalculatedMonthlyCharges(state, updated), ["invoice-1"]);
  assert.equal(buildMonthlyCharges(updated, 2026, filter).totalCents, 6000);
});

test("le taux enregistré sur chaque heure conserve l’historique et l’archivage ne l’enlève pas", () => {
  const state = snapshot([], [hours("hours-1", { hourlyRate: 20 })]);
  state.sources.workers[0].status = "Inactif";
  assert.equal(buildMonthlyCharges(state, 2026, filter).totalCents, 20000);
  state.sources.timeEntries.push(hours("hours-2", { date: "2026-10-01", hourlyRate: 25 }));
  assert.equal(buildMonthlyCharges(state, 2026, filter).months[8].totalCents, 20000);
  assert.equal(buildMonthlyCharges(state, 2026, filter).months[9].totalCents, 25000);
});

test("zéro explicite est valide ; montant/taux manquant, invalide ou négatif n’est jamais un zéro silencieux", () => {
  for (const value of [undefined, null, "", "abc", -1, NaN, Infinity, "1.2.3", "-0,10", "1e3"]) assert.equal(parseMonthlyChargeCents(value), null);
  assert.equal(parseMonthlyChargeCents(0), 0);
  assert.equal(parseMonthlyChargeCents("0,00"), 0);
  assert.equal(parseMonthlyChargeCents("100,01"), 10001);
  const state = snapshot([invoice("zero", { amount: 0 }), invoice("bad", { amount: undefined })], [hours("zero-hours", { hourlyRate: 0 }), hours("bad-hours", { hourlyRate: undefined })]);
  const result = buildMonthlyCharges(state, 2026, filter);
  assert.equal(result.totalCents, 0);
  assert.equal(result.entries.filter(entry => entry.status === "included").length, 2);
  assert.equal(result.entries.filter(entry => entry.status === "invalid").length, 2);
  assert.ok(result.issues.every(entry => entry.amountCents === null));
});

test("durée nette, minuit et horaires historiques non quart d’heure réutilisent les conventions existantes", () => {
  const state = snapshot([], [hours("midnight", { date: "2026-09-30", startTime: "22:00", endTime: "02:00", breakMinutes: 30, hourlyRate: 20 }), hours("legacy", { startTime: "08:07", endTime: "12:42", breakMinutes: 15, hourlyRate: 30 })]);
  const result = buildMonthlyCharges(state, 2026, filter);
  assert.equal(result.months[8].totalCents, 20000);
  assert.equal(result.months[9].totalCents, 0);
  assert.equal(result.entries.find(entry => entry.sourceId === "midnight")!.amountCents, 7000);
  assert.equal(result.entries.find(entry => entry.sourceId === "legacy")!.amountCents, 13000);
  assert.match(result.issues[0].issues.join(" "), /hors quarts/);
  for (const invalid of [{ startTime: "25:00" }, { breakMinutes: -1 }, { breakMinutes: 800 }, { breakMinutes: undefined }]) {
    assert.equal(buildMonthlyCharges(snapshot([], [hours("bad", invalid)]), 2026, filter).entries[0].status, "invalid");
  }
});

test("règle personne, exception prioritaire et nouvelles sources : aucun abonnement implicite ni duplication", () => {
  const state = snapshot([invoice("existing"), invoice("excluded"), invoice("new-selected"), invoice("new-person", { personId: "supplier-new" })], []);
  state.config.exceptions = [{ source: "invoice", sourceId: "existing", included: true }, { source: "invoice", sourceId: "excluded", included: false, reason: "Dépense client" }];
  let result = buildMonthlyCharges(state, 2026, filter);
  assert.equal(result.totalCents, 120000);
  assert.equal(result.entries.find(entry => entry.sourceId === "existing")!.selectionOrigin, "individual");
  assert.equal(result.entries.find(entry => entry.sourceId === "new-person")!.selected, false);
  state.config.exceptions = [];
  assert.equal(buildMonthlyCharges(state, 2026, filter).totalCents, 180000);
  state.config.personRules = [];
  state.config.exceptions = [{ source: "invoice", sourceId: "existing", included: true }];
  result = buildMonthlyCharges(state, 2026, filter);
  assert.equal(result.totalCents, 60000);
  assert.equal(result.entries.find(entry => entry.sourceId === "new-selected")!.selected, false);
});

test("deux factures légitimes identiques restent deux charges ; chevauchement facture/heures exclu explicitement", () => {
  const state = snapshot([invoice("same-id"), invoice("second", { invoiceDate: "2026-10-01" })], [hours("same-id")]);
  assert.equal(buildMonthlyCharges(state, 2026, filter).totalCents, 150000);
  state.config.exceptions = [{ source: "hours", sourceId: "same-id", included: false, reason: "Déjà compté via une autre source" }];
  assert.equal(buildMonthlyCharges(state, 2026, filter).totalCents, 120000);
  state.sources.invoices.push(state.sources.invoices[0]);
  assert.equal(buildMonthlyCharges(state, 2026, filter).totalCents, 120000);
  assert.match(buildMonthlyCharges(state, 2026, filter).issues[0].issues.join(" "), /une seule ligne/);
});

test("annulées, attendues, sans date, source supprimée et pièces non exigées", () => {
  const state = snapshot([invoice("valid-no-pdf"), invoice("cancelled", { status: "Annulé" }), invoice("expected", { status: "En attente de facture", invoiceDate: "" }), invoice("unattached", { invoiceDate: "2026-02-30" })], []);
  state.config.exceptions.push({ source: "invoice", sourceId: "deleted", included: true });
  const result = buildMonthlyCharges(state, 2026, filter);
  assert.equal(result.totalCents, 60000);
  assert.equal(result.expected[0].sourceId, "expected");
  assert.equal(result.unattached[0].sourceId, "unattached");
  assert.equal(result.excluded[0].sourceId, "cancelled");
  assert.equal(result.entries.find(entry => entry.sourceId === "deleted")!.status, "missing");
  assert.equal(result.entries.find(entry => entry.sourceId === "deleted")!.personLabel, "Source indisponible");
});

test("dates civiles strictes et date manquante explicitement rattachée sans repli createdAt", () => {
  assert.equal(isMonthlyChargeCivilDate("2024-02-29"), true);
  for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "0000-01-01", "2026-09-01T23:00:00Z", ""]) assert.equal(isMonthlyChargeCivilDate(date), false);
  const state = snapshot([invoice("no-date", { invoiceDate: "" })], []);
  assert.equal(buildMonthlyCharges(state, 2026, filter).totalCents, 0);
  state.config.attachments = [{ source: "invoice", sourceId: "no-date", mode: "month", month: "2026-09" }];
  assert.equal(buildMonthlyCharges(state, 2026, filter).totalCents, 60000);
});

test("sources autorisées et filtre maison ne réattribuent jamais les factures à une maison", () => {
  const state = snapshot([invoice()], [hours(), hours("other-house", { houseId: "house-2" })]);
  const result = buildMonthlyCharges(state, 2026, { ...filter, houseId: "house-1" });
  assert.equal(result.totalCents, 30000);
  assert.equal(result.houseUnknown.length, 1);
  assert.ok(result.entries.every(entry => entry.source === "hours" && entry.houseId === "house-1"));
  state.permissions.readableSources = ["hours"];
  state.config.exceptions = [{ source: "invoice", sourceId: "hidden-missing", included: true }];
  assert.ok(evaluateMonthlyChargeEntries(state).every(entry => entry.source === "hours"));
  assert.equal(buildMonthlyCharges(state, 2026, filter).totalCents, 60000);
  state.permissions.readableSources = [];
  assert.deepEqual(evaluateMonthlyChargeEntries(state), []);
});

test("CSV annuel/détaillé conciliable, période/périmètre/origine/rattachement explicites et cellules anti-formule", () => {
  const state = snapshot([invoice("safe", { personLabel: "=HYPERLINK(1)", title: '  @SUM("A1")\nligne suivante' }), invoice("excluded")], [hours()]);
  state.config.exceptions = [{ source: "invoice", sourceId: "excluded", included: false, reason: "+danger" }];
  const result = buildMonthlyCharges(state, 2026, filter);
  const annual = csvRows(exportAnnualChargesCsv(result));
  assert.equal(annual.at(-1)!.at(-1), "900,00");
  const detail = csvRows(exportDetailedChargesCsv(result));
  assert.equal(detail.at(-1)![12], "900,00");
  const recorded = detail.slice(1, -1).reduce((sum, row) => sum + Number(row[12].replace(",", ".")), 0);
  assert.equal(recorded, 900);
  assert.equal(detail[1][4], "'=HYPERLINK(1)");
  assert.match(detail[1][5], /^'  @/);
  assert.equal(detail[1][8], "Date de facture");
  assert.match(detail[1][1], /sources autorisées/);
  assert.equal(csvRows(exportDetailedChargesCsv(result, {}, "2026-10")).at(-1)![12], "0,00");
  for (const value of ["=1", " +1", "-1", "@x", "\t=x", "\rx"]) assert.match(monthlyChargesCsvCell(value), /^"'/);
  assert.throws(() => exportDetailedChargesCsv(result, {}, "2027-01"), /Mois/);
});

test("CSV sous filtre maison indique les factures sans maison hors total et totalise seulement les heures", () => {
  const result = buildMonthlyCharges(snapshot(), 2026, { ...filter, houseId: "house-1" });
  const detail = csvRows(exportDetailedChargesCsv(result, { houseLabel: "Maison fictive" }));
  assert.equal(detail.at(-1)![12], "300,00");
  const unknown = detail.find(row => row[10].startsWith("Maison non renseignée"))!;
  assert.equal(unknown[12], "0,00");
  assert.match(unknown[1], /Maison fictive/);
});

test("périmètre CSV décrit seulement les sources lisibles ; un cumul monétaire hors précision est refusé", () => {
  const state = snapshot();
  state.permissions.readableSources = ["invoice"];
  const result = buildMonthlyCharges(state, 2026, filter);
  assert.deepEqual(result.readableSources, ["invoice"]);
  assert.doesNotMatch(csvRows(exportDetailedChargesCsv(result))[1][1], /Suivi maison/);
  const tooLarge = snapshot([invoice("large-1", { amount: 80000000000000 }), invoice("large-2", { amount: 80000000000000 })], []);
  assert.throws(() => buildMonthlyCharges(tooLarge, 2026, filter), /Total trop élevé/);
});
