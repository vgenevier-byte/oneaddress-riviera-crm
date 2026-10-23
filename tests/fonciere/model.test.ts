import assert from "node:assert/strict";
import { test } from "node:test";
import { createFonciereData, fromPresentationData, toPresentationData, validateFonciereData } from "../../lib/fonciere/model";
import { createProjectData } from "../../lib/izord/model";

test("incomplete named property is valid; unnamed property cannot be saved", () => {
  const data = createFonciereData(); assert.throws(() => validateFonciereData(data), /nom/);
  data.name = "  Projet fictif  "; assert.equal(validateFonciereData(data).name, "Projet fictif");
  assert.equal(validateFonciereData(data).askingPrice, "");
});

test("presentation snapshot is independent, retains full long text and excludes canonical contact identity", () => {
  const data = createFonciereData(); data.name = "Villa fictive"; data.description = "Caractéristique confirmée. ".repeat(160); data.agentContactId = "private-contact-id";
  const snapshot = toPresentationData(data, { id: "12345678-1234-4234-8234-123456789012", revision: 3 });
  assert.ok(String(snapshot.state.features).length <= 1000);
  assert.equal((snapshot.importMeta?.fonciereSnapshot as { fields: Record<string, string> }).fields.description, data.description);
  assert.ok(!JSON.stringify(snapshot.importMeta?.fonciereSnapshot).includes("private-contact-id"));
  data.description = "Après modification"; data.presentationData.state.project = "Autre nom";
  assert.equal(snapshot.state.project, "Villa fictive");
  assert.equal(fromPresentationData(snapshot).description, "Caractéristique confirmée. ".repeat(160));
});

test("cleared property hypotheses erase old generator assumptions and uncertain view does not reuse sea claim", () => {
  const data = createFonciereData(); data.name = "Fictif"; data.presentationData.state.works = "100000"; data.presentationData.state.resale = "2000000"; data.presentationData.state.monthly = "3000"; data.presentationData.state.sea = "Oui";
  const presentation = toPresentationData(data); assert.equal(presentation.state.works, ""); assert.equal(presentation.state.resale, ""); assert.equal(presentation.state.monthly, ""); assert.equal(presentation.state.sea, "À confirmer");
});

test("round trip keeps property street and locality separate without duplication", () => {
  const data = createFonciereData(); Object.assign(data, { name: "Fictif", propertyAddress: "12 avenue fictive", city: "Nice", postalCode: "06000", agencyAddress: "9 rue de l’agence" });
  const presentation = toPresentationData(data), restored = fromPresentationData(presentation);
  assert.equal(presentation.state.address, "12 avenue fictive, 06000 Nice"); assert.equal(restored.propertyAddress, data.propertyAddress); assert.equal(restored.city, "Nice"); assert.equal(restored.agencyAddress, data.agencyAddress);
  presentation.state.address = ""; assert.equal(fromPresentationData(presentation).propertyAddress, ""); assert.equal(fromPresentationData(presentation).city, "");
});

test("direct-generator personal program is never relabeled as an agency claim", () => {
  const presentation = createProjectData(); presentation.state.program = "Hypothèse personnelle de division";
  const result = fromPresentationData(presentation); assert.equal(result.agencyPotential, ""); assert.equal(result.renovation, presentation.state.program);
});

test("rich extracted agency information survives direct presentation to property conversion", () => {
  const presentation = createProjectData(); presentation.state.project = "Nom corrigé"; presentation.state.asking = "";
  presentation.importMeta = { agencyFields: { project: "Nom importé", asking: "1200000", agencyAddress: "8 rue de l’agence", agencyName: "Agence fictive", rooms: "5", diagnostics: "DPE C", agencyPotential: "Potentiel annoncé" } };
  const result = fromPresentationData(presentation); assert.equal(result.name, "Nom corrigé"); assert.equal(result.askingPrice, ""); assert.equal(result.agencyAddress, "8 rue de l’agence"); assert.equal(result.rooms, "5"); assert.equal(result.agencyPotential, "Potentiel annoncé");
});

test("untrusted provenance and oversized property fields are refused before storage", () => {
  const data = createFonciereData(); data.name = "Fictif"; data.description = "x".repeat(12001); assert.throws(() => validateFonciereData(data), /long/);
  data.description = ""; data.provenance = [{ id: "import", importedAt: "2026-10-23", filename: "fictif.pdf", method: "text", warnings: [], fields: { role: { page: 1, extract: "admin" } } }];
  assert.throws(() => validateFonciereData(data), /Source/);
});

test("narrative hypotheses remain personal notes without corrupting numeric finance fields", () => {
  const data = createFonciereData(); data.name = "Fictif"; data.worksHypothesis = "Rénover la toiture après diagnostic"; data.resaleHypothesis = "1 900 000 €"; data.rentalHypothesis = "Location à étudier après travaux";
  const snapshot = toPresentationData(data); assert.equal(snapshot.state.works, ""); assert.equal(snapshot.state.resale, "1900000"); assert.equal(snapshot.state.monthly, ""); assert.match(String(snapshot.state.decisionNotes), /Hypothèse personnelle \(travaux\)/);
  assert.equal(fromPresentationData(snapshot).worksHypothesis, data.worksHypothesis); assert.equal(fromPresentationData(snapshot).rentalHypothesis, data.rentalHypothesis);
  snapshot.state.resale = ""; assert.equal(fromPresentationData(snapshot).resaleHypothesis, "");
});

test("direct import records editable field provenance and OCR limitations", () => {
  const data = createProjectData(); data.importMeta = { filename: "scan-fictif.png", validatedAt: "2026-10-23T12:00:00Z", extractionMethod: "ocr", warnings: ["OCR à vérifier"], agencyFields: { agencyName: "Agence fictive" }, evidence: { agencyName: { page: 1, extract: "AGENCE FICTIVE" } } };
  const result = fromPresentationData(data); assert.equal(result.provenance[0].filename, "scan-fictif.png"); assert.equal(result.provenance[0].method, "ocr"); assert.equal(result.provenance[0].fields.agencyName.extract, "AGENCE FICTIVE"); assert.equal(result.provenance[0].warnings[0], "OCR à vérifier");
});

test("direct-import locality stays separate from the property street and agency address", () => {
  const data = createProjectData(); data.state.address = "12 avenue fictive — 06000 Nice";
  data.importMeta = { agencyFields: { address: data.state.address, city: "Nice", postalCode: "06000", agencyAddress: "8 rue de l’agence" } };
  const result = fromPresentationData(data); assert.equal(result.propertyAddress, "12 avenue fictive"); assert.equal(result.city, "Nice"); assert.equal(result.postalCode, "06000"); assert.equal(result.agencyAddress, "8 rue de l’agence");
  data.state.address = "06000 Nice — adresse exacte à confirmer"; data.importMeta.agencyFields = { address: data.state.address, city: "Nice", postalCode: "06000" };
  assert.equal(fromPresentationData(data).propertyAddress, ""); assert.equal(fromPresentationData(data).city, "Nice");
});
