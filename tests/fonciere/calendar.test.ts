import assert from "node:assert/strict";
import { test } from "node:test";
import { addCalendarMonths, calculateProjectCalendar, isCivilDate, MAX_CALENDAR_MONTHS, projectCalendarRows, projectCalendarText } from "../../lib/fonciere/calendar";
import { createFonciereData, fromPresentationData, toPresentationData, validateFonciereData } from "../../lib/fonciere/model";
import { readGuidedField, setGuidedField, type GuidedComposite } from "../../lib/fonciere/guided";
import { applyAgencyImport } from "../../lib/fonciere/import";
import { calculate } from "../../lib/izord/finance";

const project = () => { const data = createFonciereData(); data.name = "Calendrier fictif"; return data; };
const planned = () => {
  let data = project();
  data = setGuidedField(data, "personalStrategy", "rental_then_resale");
  data = setGuidedField(data, "worksHypothesis", { amount: 120000, level: "heavy", comment: "Budget personnel conservé", startDate: "2028-01-31", durationMonths: 1 });
  data = setGuidedField(data, "rentalHypothesis", { mode: "long_term", amount: 2500, period: "month", occupiedUnits: 8, receiptDelayMonths: 1, comment: "Hypothèse personnelle" });
  return setGuidedField(data, "resaleHypothesis", { amount: 1500000, receiptDelayMonths: 4, timing: "Printemps, sous réserve", comment: "Texte historique" });
};

test("old projects have no calendar defaults, and an explicit zero does not invent a start", () => {
  const data = project(), initial = calculateProjectCalendar(data);
  assert.equal(initial.startDate, null); assert.equal(initial.durationMonths, null); assert.equal(initial.worksEndDate, null); assert.equal(initial.strategy, null); assert.equal(initial.firstReceiptDate, null); assert.equal(initial.firstReceiptMonths, null);
  const durationOnly = setGuidedField(setGuidedField(data, "personalStrategy", "resale"), "worksHypothesis", { durationMonths: 0 });
  const zero = calculateProjectCalendar(setGuidedField(durationOnly, "resaleHypothesis", { receiptDelayMonths: 0 }));
  assert.equal(zero.durationMonths, 0); assert.equal(zero.worksEndDate, null); assert.equal(zero.firstReceiptDate, null); assert.equal(zero.firstReceiptMonths, 0);
  assert.match(projectCalendarText(durationOnly), /Sans travaux/);
  assert.match(projectCalendarText(durationOnly), /date de début des travaux/);
  const dated = setGuidedField(durationOnly, "worksHypothesis", { startDate: "2026-10-27", durationMonths: 0 });
  assert.equal(calculateProjectCalendar(dated).worksEndDate, "2026-10-27");
});

test("month arithmetic clamps each stage over leap years, centuries and year changes", () => {
  for (const [start, months, end] of [
    ["2027-01-31", 1, "2027-02-28"], ["2028-01-31", 1, "2028-02-29"], ["2028-02-29", 12, "2029-02-28"],
    ["2026-10-31", 3, "2027-01-31"], ["2026-12-31", 2, "2027-02-28"], ["2026-03-31", 1, "2026-04-30"],
    ["1900-01-31", 1, "1900-02-28"], ["2000-01-31", 1, "2000-02-29"], ["0001-01-31", 1, "0001-02-28"],
    ["2026-10-27", 0, "2026-10-27"], ["9999-12-31", 1, null],
  ] as const) assert.equal(addCalendarMonths(start, months), end, `${start} + ${months}`);
  const c = calculateProjectCalendar(planned());
  assert.equal(c.worksEndDate, "2028-02-29"); assert.equal(c.firstRentDate, "2028-03-29");
  assert.notEqual(c.firstRentDate, addCalendarMonths("2028-01-31", 2));
});

test("civil dates and whole-month durations reject malformed or impossible values", () => {
  for (const value of ["2026-02-29", "1900-02-29", "2026-04-31", "2026-00-10", "2026-13-01", "0000-01-01", "10000-01-01", "2026-1-01", " 2026-01-01", "2026-01-01T00:00:00Z", "2026-01-01+01:00", "garbage", 0]) {
    assert.equal(isCivilDate(value), false, String(value));
    assert.throws(() => setGuidedField(project(), "worksHypothesis", { startDate: value } as GuidedComposite), /Date civile/);
  }
  assert.ok(isCivilDate("2000-02-29")); assert.ok(isCivilDate("0001-01-01")); assert.ok(isCivilDate("9999-12-31"));
  for (const value of [-1, 0.5, "1", Infinity, NaN, MAX_CALENDAR_MONTHS + 1]) for (const [key, field] of [["worksHypothesis", "durationMonths"], ["resaleHypothesis", "receiptDelayMonths"], ["rentalHypothesis", "receiptDelayMonths"]] as const) {
    assert.throws(() => setGuidedField(project(), key, { [field]: value }), /Nombre/);
  }
  assert.doesNotThrow(() => setGuidedField(project(), "worksHypothesis", { startDate: "", durationMonths: null }));
  assert.equal(addCalendarMonths("invalid", 1), null); assert.equal(addCalendarMonths("2026-01-01", -1), null);
});

test("selected strategies gate dates while changes preserve all saved scenario assumptions", () => {
  const data = planned(), retained = structuredClone(data.guided.values);
  const combined = calculateProjectCalendar(data);
  assert.equal(combined.firstRentDate, "2028-03-29"); assert.equal(combined.saleReceiptDate, "2028-06-29"); assert.equal(combined.firstReceiptDate, combined.firstRentDate); assert.equal(combined.firstReceiptMonths, 2);
  const sale = setGuidedField(data, "personalStrategy", "resale"), saleCalendar = calculateProjectCalendar(sale);
  assert.equal(saleCalendar.firstRentDate, null); assert.equal(saleCalendar.rentalDelayMonths, null); assert.equal(saleCalendar.firstReceiptDate, "2028-06-29"); assert.equal(saleCalendar.firstReceiptMonths, 5);
  assert.deepEqual(readGuidedField(sale, "rentalHypothesis"), retained.rentalHypothesis);
  const rental = setGuidedField(sale, "personalStrategy", "rental"), rentalCalendar = calculateProjectCalendar(rental);
  assert.equal(rentalCalendar.saleReceiptDate, null); assert.equal(rentalCalendar.saleDelayMonths, null); assert.equal(rentalCalendar.firstReceiptDate, "2028-03-29");
  assert.deepEqual(readGuidedField(rental, "resaleHypothesis"), retained.resaleHypothesis);
  const restored = setGuidedField(rental, "personalStrategy", "rental_then_resale");
  assert.deepEqual(restored.guided.values, retained); assert.deepEqual(restored.guided.inactive, data.guided.inactive);
  const unset = calculateProjectCalendar(setGuidedField(restored, "personalStrategy", null));
  assert.equal(unset.firstRentDate, null); assert.equal(unset.saleReceiptDate, null); assert.equal(unset.firstReceiptDate, null);
});

test("missing receipt delays remain unknown, while explicit zero means receipt on works completion", () => {
  let data = planned(); data = setGuidedField(data, "rentalHypothesis", { amount: 2500, period: "month" });
  const missing = calculateProjectCalendar(data);
  assert.equal(missing.worksEndDate, "2028-02-29"); assert.equal(missing.firstRentDate, null); assert.equal(missing.firstReceiptDate, null); assert.equal(missing.firstReceiptMonths, null);
  assert.equal(missing.saleReceiptDate, "2028-06-29");
  data = setGuidedField(data, "rentalHypothesis", { receiptDelayMonths: 0 });
  assert.equal(calculateProjectCalendar(data).firstRentDate, "2028-02-29");
  assert.equal(calculateProjectCalendar(data).firstReceiptMonths, 1);
});

test("rental then resale warns about earlier sale and keeps rents as the first receipts", () => {
  let data = planned(); data = setGuidedField(data, "resaleHypothesis", { receiptDelayMonths: 0 });
  const c = calculateProjectCalendar(data);
  assert.equal(c.inconsistentChronology, true); assert.equal(c.firstReceiptDate, "2028-03-29"); assert.equal(c.saleReceiptDate, "2028-02-29");
  assert.match(projectCalendarText(data), /vente est prévue avant le premier loyer/);
  data = setGuidedField(data, "worksHypothesis", { durationMonths: 1 });
  assert.equal(calculateProjectCalendar(data).inconsistentChronology, true);
  assert.equal(calculateProjectCalendar(data).firstReceiptDate, null);
});

test("missing field messages are precise in both languages and inactive rows are absent", () => {
  const data = setGuidedField(project(), "personalStrategy", "resale");
  for (const locale of ["fr", "en"] as const) {
    const rows = projectCalendarRows(data, locale), all = rows.map(row => row.value).join("\n");
    assert.equal(rows.some(row => row.key === "firstRentDate"), false);
    assert.match(all, locale === "fr" ? /date de début des travaux/ : /works start date/);
    assert.match(all, locale === "fr" ? /durée des travaux/ : /works duration/);
    assert.match(all, locale === "fr" ? /délai avant l’encaissement de la vente/ : /delay before sale proceeds/);
    assert.match(rows.find(row => row.key === "firstReceiptDate")!.label, locale === "fr" ? /Premiers encaissements prévisionnels/ : /Planned first receipts/);
    assert.match(projectCalendarText(data, locale), locale === "fr" ? /dernier jour/ : /last day/);
  }
});

test("calendar save/clone and presentation round trips retain structured values and legacy timing", () => {
  const data = planned(); data.worksHypothesis = "Ancien budget brut — à confirmer"; data.resaleHypothesis = "Ancienne échéance libre";
  const saved = validateFonciereData(JSON.parse(JSON.stringify(data))), presentation = toPresentationData(saved), back = fromPresentationData(presentation);
  assert.deepEqual(back.guided, data.guided); assert.equal(back.worksHypothesis, data.worksHypothesis); assert.equal(back.resaleHypothesis, data.resaleHypothesis);
  assert.equal((readGuidedField(back, "resaleHypothesis") as GuidedComposite).timing, "Printemps, sous réserve");
  presentation.state.works = "150000"; presentation.state.resale = "1750000";
  const edited = fromPresentationData(presentation);
  assert.equal((readGuidedField(edited, "worksHypothesis") as GuidedComposite).durationMonths, 1);
  assert.equal((readGuidedField(edited, "resaleHypothesis") as GuidedComposite).receiptDelayMonths, 4);
  assert.equal((readGuidedField(edited, "rentalHypothesis") as GuidedComposite).receiptDelayMonths, 1);
});

test("agency reimport cannot overwrite personal strategy, delays, dates, budgets or legacy timing", () => {
  const data = planned(), incoming = project(); incoming.askingPrice = "1 000 000 €"; incoming.description = "Nouvelle brochure";
  incoming.guided.values = { personalStrategy: "resale", worksHypothesis: { durationMonths: 99 }, resaleHypothesis: { receiptDelayMonths: 99 }, rentalHypothesis: { receiptDelayMonths: 99 } };
  const reimported = applyAgencyImport(data, incoming, ["askingPrice", "description"]);
  assert.equal(reimported.description, "Nouvelle brochure"); assert.equal(reimported.askingPrice, "1 000 000 €");
  for (const key of ["personalStrategy", "worksHypothesis", "resaleHypothesis", "rentalHypothesis"] as const) assert.deepEqual(reimported.guided.values[key], data.guided.values[key]);
});

test("calendar evaluation is pure and durations never alter financial study inputs or results", () => {
  const data = planned(), before = JSON.stringify(data), state = toPresentationData(data).state;
  const financialState = { ...state, acq: "1000000", holdingMonths: "18", holdMonths: "18", rentedMonths: "8", rentalYears: "4", loanMonths: "20", otherCosts: "1000" };
  const finance = calculate(financialState);
  for (let i = 0; i < 5; i++) { calculateProjectCalendar(data); projectCalendarRows(data, "en"); }
  assert.equal(JSON.stringify(data), before);
  const changed = setGuidedField(data, "worksHypothesis", { ...(readGuidedField(data, "worksHypothesis") as GuidedComposite), startDate: "2035-12-31", durationMonths: 36 });
  const changedState = toPresentationData(changed).state;
  for (const key of ["works", "resale", "monthly", "weekly", "rentedMonths", "weeks", "holdMonths", "rentalYears", "loanMonths"]) assert.equal(changedState[key], state[key], key);
  assert.deepEqual(calculate({ ...financialState, ...Object.fromEntries(["works", "resale", "monthly", "weekly"].map(key => [key, changedState[key]])) }), finance);
});
