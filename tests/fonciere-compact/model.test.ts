import assert from "node:assert/strict";
import { test } from "node:test";
import { createFonciereData, validateFonciereData, toPresentationData, fromPresentationData } from "../../lib/fonciere/model";
import { setGuidedField } from "../../lib/fonciere/guided";
import { applyAgencyImport } from "../../lib/fonciere/import";

test("Civil visit dates validate without inference, and optional diagnostics never infer a response", () => {
  const data = createFonciereData(); data.name = "Fictional project";
  assert.equal(data.visitDate, ""); assert.equal(data.diagnosticsReceived, "");
  for (const visitDate of ["", "2024-02-29", "1999-12-31", "2099-01-01", "0001-01-01"]) assert.equal(validateFonciereData({ ...data, visitDate }).visitDate, visitDate);
  for (const visitDate of [null, false, 0, "2026-02-29", "2026-04-31", "0000-01-01", "2026-1-1", "2026-10-30T00:00:00Z"]) assert.throws(() => validateFonciereData({ ...data, visitDate }));
  for (const diagnosticsReceived of ["", "yes", "no"]) assert.equal(validateFonciereData({ ...data, diagnosticsReceived }).diagnosticsReceived, diagnosticsReceived);
  for (const diagnosticsReceived of [null, true, "pending", "available"]) assert.throws(() => validateFonciereData({ ...data, diagnosticsReceived }));
  const legacy = { ...data } as Partial<typeof data>; delete legacy.visitDate; delete legacy.diagnosticsReceived;
  assert.equal(validateFonciereData(legacy).visitDate, ""); assert.equal(validateFonciereData(legacy).diagnosticsReceived, "");
});
test("Internal answers survive edits/reimports and remain absent from presentation snapshots", () => {
  let data = createFonciereData(); data.name = "Fictional project"; data.visitDate = "2027-03-28"; data.diagnosticsReceived = "no";
  data = setGuidedField(data, "diagnostics", [{ code: "dpe", status: "in_progress", detail: "Retain historical assessment" }]);
  data = setGuidedField(data, "agencyPotential", ["other"]); data.guided.details.agencyPotential = "Historical detail";
  data.ownerContext.sale.openQuestions = "Private owner context";
  const before = structuredClone(data); const edited = validateFonciereData({ ...data, name: "Renamed fictional project" });
  assert.deepEqual(edited.guided, before.guided); assert.deepEqual(edited.ownerContext, before.ownerContext);
  const presentation = toPresentationData(edited); const serialized = JSON.stringify(presentation);
  assert(!serialized.includes('"visitDate"')); assert(!serialized.includes('"diagnosticsReceived"')); assert(!serialized.includes("Private owner context"));
  const restored = fromPresentationData(presentation, edited); assert.equal(restored.visitDate, data.visitDate); assert.equal(restored.diagnosticsReceived, "no");
  assert.equal(fromPresentationData(presentation).visitDate, "");
  const imported = createFonciereData(); imported.name = "Brochure";
  const next = applyAgencyImport(edited, imported, ["name"]); assert.equal(next.visitDate, data.visitDate); assert.equal(next.diagnosticsReceived, "no");
  assert.equal(validateFonciereData({ ...edited, visitDate: "" }).visitDate, "");
});

test("Constraint notes validate independently, retain historical global details and round-trip publicly", () => {
  let data = createFonciereData(); data.name = "Fictional constraints";
  data = setGuidedField(data, "constraints", ["easement", "planning"]);
  data.guided.details.constraints = "Historical global detail";
  data.constraintNotes = { easement: "Access for neighbours", planning: "Planning evidence pending" };
  assert.deepEqual(validateFonciereData(data).constraintNotes, data.constraintNotes);
  for (const constraintNotes of [null, [], { unknown: "bad" }, { easement: 1 }, { easement: "x".repeat(12001) }]) assert.throws(() => validateFonciereData({ ...data, constraintNotes }));
  const presentation = toPresentationData(data);
  assert(presentation.state.propertyWarnings.includes("Access for neighbours"));
  const restored = fromPresentationData(presentation);
  assert.deepEqual(restored.constraintNotes, data.constraintNotes);
  assert.equal(restored.guided.details.constraints, "Historical global detail");
});
