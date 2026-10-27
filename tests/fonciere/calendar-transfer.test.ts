import assert from "node:assert/strict";
import { test } from "node:test";
import { createFonciereData, toPresentationData, fromPresentationData } from "../../lib/fonciere/model";
import { applyAgencyImport } from "../../lib/fonciere/import";
import { calculateProjectCalendar } from "../../lib/fonciere/calendar";
import { bankPresentationData } from "../../lib/fonciere/bankPresentation";
import { presentationCalendar, calendarTextBoxes } from "../../lib/izord/presentation-calendar";
import { createProjectData, validateProjectData } from "../../lib/izord/model";
import { calculate } from "../../lib/izord/finance";
import { notesText } from "../../lib/izord/presentation-notes";

function fictionalProject() {
  const data = createFonciereData(); data.name = "Villa fictive calendrier";
  data.worksHypothesis = "Budget et commentaire historiques";
  data.resaleHypothesis = "Échéance historique à conserver";
  data.guided.values.personalStrategy = "rental_then_resale";
  data.guided.values.worksHypothesis = { amount: 50000, level: "refresh", comment: "Conserver", startDate: "2028-01-31", durationMonths: 1 };
  data.guided.values.resaleHypothesis = { amount: 750000, timing: "Après accord du notaire", receiptDelayMonths: 6 };
  data.guided.values.rentalHypothesis = { amount: 2500, period: "month", occupiedUnits: 8, mode: "long_term", receiptDelayMonths: 1 };
  data.presentationData.state.holding = "17"; data.presentationData.state.rentalPeriod = "24"; data.presentationData.state.finance = "22000";
  return data;
}

test("structured calendar round-trips through presentation JSON, including edited presentations", () => {
  const data = fictionalProject(), presentation = toPresentationData(data), json = validateProjectData(JSON.parse(JSON.stringify(presentation)));
  assert.deepEqual(fromPresentationData(json).guided, data.guided);
  assert.equal(fromPresentationData(json).resaleHypothesis, data.resaleHypothesis);
  json.state.project = "Titre retravaillé"; json.state.works = "60000";
  const back = fromPresentationData(json);
  assert.equal(back.name, "Titre retravaillé");
  assert.equal((back.guided.values.worksHypothesis as Record<string, unknown>).amount, 60000);
  assert.equal(calculateProjectCalendar(back).firstRentDate, "2028-03-29");
  assert.equal((back.guided.values.resaleHypothesis as Record<string, unknown>).timing, "Après accord du notaire");
});

test("agency reimport cannot overwrite personal strategy, durations or historical text", () => {
  const data = fictionalProject(), agency = createFonciereData(); agency.name = "Nouveau nom agence"; agency.description = "Faits agence";
  agency.guided.values.personalStrategy = "resale";
  agency.guided.values.worksHypothesis = { startDate: "2030-01-01", durationMonths: 0 };
  const next = applyAgencyImport(data, agency, ["description", "worksHypothesis", "resaleHypothesis", "rentalHypothesis"]);
  assert.deepEqual(next.guided, data.guided); assert.equal(next.worksHypothesis, data.worksHypothesis); assert.equal(next.resaleHypothesis, data.resaleHypothesis);
});

test("calendar assumptions do not change financial holding, rental periods or finance costs", () => {
  const data = fictionalProject(), baseline = toPresentationData(data), expected = calculate(baseline.state);
  (data.guided.values.worksHypothesis as Record<string, unknown>).durationMonths = 24;
  (data.guided.values.rentalHypothesis as Record<string, unknown>).receiptDelayMonths = 12;
  const next = toPresentationData(data);
  assert.deepEqual(calculate(next.state), expected);
  for (const key of ["holding", "rentalPeriod", "finance", "rentedMonths"]) assert.equal(next.state[key], baseline.state[key], key);
});

test("inactive assumptions remain in snapshot but are excluded from new active presentation scenario", () => {
  const data = fictionalProject(); data.guided.values.personalStrategy = "resale";
  let next = toPresentationData(data); assert.equal(next.state.monthly, ""); assert.equal(next.state.resale, "750000");
  assert.deepEqual(fromPresentationData(next).guided, data.guided);
  data.guided.values.personalStrategy = "rental"; next = toPresentationData(data);
  assert.equal(next.state.resale, ""); assert.equal(next.state.monthly, "2500");
  assert.deepEqual(fromPresentationData(next).guided, data.guided);
  data.guided.values.personalStrategy = null; next = toPresentationData(data);
  assert.equal(next.state.resale, ""); assert.equal(next.state.monthly, "");
  assert.deepEqual(fromPresentationData(next).guided, data.guided);
});

test("bank presentation calendar is derived solely from approved immutable snapshot", () => {
  const data = fictionalProject(), bank = bankPresentationData(data, { id: "12345678-1234-4234-8234-123456789012", revision: 4, reference: "PRJ-000001", fingerprint: "fictional-approved" });
  (data.guided.values.worksHypothesis as Record<string, unknown>).startDate = "2030-01-01";
  const calendar = presentationCalendar(bank.importMeta)!;
  assert(calendar); assert.match(calendar.text, /29\/03\/2028/); assert(!calendar.text.includes("2030"));
  assert(calendarTextBoxes(calendar).every(box => box.y + box.h <= 540));
  assert.match(notesText(bank.state, calculate(bank.state), bank.importMeta), /Calendrier prévisionnel du projet/);
  assert.equal(presentationCalendar(createProjectData().importMeta), null);
});
