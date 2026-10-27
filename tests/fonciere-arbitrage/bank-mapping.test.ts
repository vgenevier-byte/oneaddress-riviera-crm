import assert from "node:assert/strict";
import { test } from "node:test";
import { createFonciereData, validateFonciereData } from "../../lib/fonciere/model";
import { bankPresentationData } from "../../lib/fonciere/bankPresentation";
import { exportProjectJson } from "../../lib/izord/model";
import { notesText } from "../../lib/izord/presentation-notes";
import { calculate } from "../../lib/izord/finance";

const source = { id: "12345678-1234-4234-8234-123456789012", revision: 3, reference: "PRJ-000001", fingerprint: "approved-fictitious-snapshot" };
test("bank draft leaves absent financial hypotheses and template assumptions blank", () => {
  const data = createFonciereData(); data.name = "Villa fictive";
  const mapped = bankPresentationData(data, source);
  assert.equal(mapped.state.project, "PRJ-000001 — Villa fictive — Dossier bancaire");
  for (const key of ["asking", "acq", "works", "resale", "finance", "monthly", "weekly", "notaryRate", "management", "holding", "weeks", "rentedMonths"]) assert.equal(mapped.state[key], "", key);
  assert.deepEqual(mapped.importMeta?.fonciereBankMissing, ["address", "asking", "area", "acquisition", "financing", "works", "photos"]);
});
test("bank draft retains the approved documented numbers, ordinary notes and immutable source", () => {
  const data = createFonciereData(); Object.assign(data, { name: "Villa fictive", askingPrice: "950000", area: "120", worksHypothesis: "150000" });
  data.presentationData.state.finance = "25000"; data.notes = "Information volontaire destinée au dossier";
  const mapped = bankPresentationData(data, source);
  assert.equal(mapped.state.asking, "950000"); assert.equal(mapped.state.works, "150000"); assert.equal(mapped.state.finance, "25000");
  assert.match(String(mapped.state.decisionNotes), /Information volontaire/);
  assert.deepEqual(mapped.importMeta?.fonciereBankApproval, { fingerprint: source.fingerprint });
  data.askingPrice = "1"; assert.equal(mapped.state.asking, "950000");
});
test("dedicated private opinion data cannot enter JSON or slide notes", () => {
  const data = createFonciereData(); data.name = "Villa export fictive";
  const untrusted = { ...data, arbitration: { remark: "PRIVATE_ARBITRATION_SENTINEL" }, opinions: { ann_charlotte: { remark: "PRIVATE_ARBITRATION_SENTINEL" } } };
  const mapped = bankPresentationData(validateFonciereData(untrusted), source);
  assert(!JSON.stringify(exportProjectJson(mapped)).includes("PRIVATE_ARBITRATION_SENTINEL"));
  assert(!JSON.stringify(notesText(mapped.state, calculate(mapped.state))).includes("PRIVATE_ARBITRATION_SENTINEL"));
});
