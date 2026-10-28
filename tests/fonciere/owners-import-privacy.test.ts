import assert from "node:assert/strict";
import test from "node:test";
import { createFonciereData, fromPresentationData, toPresentationData, validateFonciereData } from "../../lib/fonciere/model";
import { createOwnerPerson } from "../../lib/fonciere/owners";
import { applyOwnerImport, proposeOwnerImport } from "../../lib/fonciere/ownerImport";
import { bankPresentationData } from "../../lib/fonciere/bankPresentation";
import { applyAgencyImport, agencyReportToFonciere } from "../../lib/fonciere/import";
import { exportProjectJson, importProjectJson, validateProjectData } from "../../lib/izord/model";
import { notesText } from "../../lib/izord/presentation-notes";
import { calculate } from "../../lib/izord/finance";
import { enrichAgencyFacts } from "../../lib/izord/agency-details";
import { parseAgency, type AgencyReport } from "../../lib/izord/agency";
const MARKER = "PRIVATE_OWNER_CANARY_7651";
function property() { const data = createFonciereData(); data.name = "Projet fictif public"; data.ownerContext.organization = "indivision"; data.ownerContext.declaredCount = 4; data.ownerContext.rights = "full"; data.ownerContext.owners = [{ contactId: "person-private", entityType: "person", note: MARKER, person: { ...createOwnerPerson(), age: 73, ageAsOf: "2026-10-28", residenceCountry: "IT", nationalities: ["FR", "IT"], note: MARKER } },{ contactId: "company-private", entityType: "company", note: MARKER }]; data.ownerContext.representatives = [{ contactId: "representative-private", ownerContactId: "company-private", role: MARKER }]; data.ownerContext.negotiation.justification = MARKER; data.ownerContext.negotiation.potential = "high"; data.ownerContext.sale.priceReductions = MARKER; data.ownerContext.provenance = [{ field: "ownerContext.unlinkedOwners", filename: "fiche-fictive.pdf", page: 2, extract: MARKER, importedAt: "2026-10-28T12:00:00Z" }]; return data; }
test("project-only owner context is excluded from manual/bank persisted DTO, JSON and hidden notes without financial effects", () => {
  const data = property(), blank = createFonciereData(); blank.name = data.name;
  const before = JSON.stringify(data), source = { id: "12345678-1234-4234-8234-123456789012", revision: 1, reference: "PRJ-000001", fingerprint: "fixture-approved" };
  for (const mapped of [toPresentationData(data), bankPresentationData(data, source)]) {
    const serialized = exportProjectJson(mapped); assert(!serialized.includes(MARKER)); assert(!serialized.includes("ownerContext")); assert(!JSON.stringify(mapped).includes("person-private"));
    assert(!notesText(mapped.state, calculate(mapped.state), mapped.importMeta).includes(MARKER));
    assert(!JSON.stringify(importProjectJson(serialized)).includes(MARKER));
  }
  assert.deepEqual(toPresentationData(data).state, toPresentationData(blank).state);
  assert.equal(JSON.stringify(data), before);
  assert.equal(validateFonciereData(JSON.parse(before)).ownerContext.declaredCount, 4);
});
test("nested ownerContext hidden in presentation metadata is removed on admission, export and direct speaker notes", () => {
  const presentation = toPresentationData(property()); presentation.importMeta = { ...presentation.importMeta, ownerContext: { note: MARKER }, nested: [{ ownerContext: { secret: MARKER }, public: "retain" }], fonciereSnapshot: { fields: { name: "Public" }, ownerContext: { note: MARKER } } };
  const cleaned = validateProjectData(presentation);
  assert(!JSON.stringify(cleaned).includes(MARKER)); assert(!exportProjectJson(presentation).includes(MARKER)); assert(!notesText(presentation.state, calculate(presentation.state), presentation.importMeta).includes(MARKER));
  assert.deepEqual(cleaned.importMeta?.nested, [{ public: "retain" }]);
  const restored = fromPresentationData(presentation); assert.deepEqual(restored.ownerContext, createFonciereData().ownerContext);
  const existing = property(), merged = fromPresentationData(presentation, existing); assert.deepEqual(merged.ownerContext, existing.ownerContext); assert.notEqual(merged.ownerContext, existing.ownerContext);
});
test("explicit agency owner statements are reviewable with exact page/extract and never resolve CRM identities", () => {
  const data = property(), report = { filename: "fiche-fictive.pdf", rawText: `PAGE 2\nOrganisation de la propriété : Indivision\nDroits détenus : Démembrement\nNombre de propriétaires déclarés : 4\nPropriétaire : Mme Fictive, âge communiqué 73 ans\nPays de résidence du propriétaire : Italie\nNationalité du propriétaire : Française\nMotif communiqué : succession; arbitrage patrimonial\nDate de mise en vente : 31/01/2026\nÉchéance vendeur : 2027-06-30\nBaisses de prix annoncées : 50 000 € en octobre\nPosition communiquée sur le prix : ouvert à discussion` };
  const proposals = proposeOwnerImport(report, data.ownerContext, "2026-10-28T12:00:00Z"); assert(proposals.length >= 7); assert(proposals.every(item=>item.evidence.page === 2 && item.evidence.filename === report.filename));
  const before = structuredClone(data.ownerContext); assert.deepEqual(applyOwnerImport(before, proposals, []), before);
  const changed = applyOwnerImport(before, proposals, proposals.map(item=>item.id)); assert.equal(changed.rights, "split"); assert.equal(changed.declaredCount, 4); assert.equal(changed.sale.listedOn, "2026-01-31"); assert.deepEqual(changed.sale.reasons, ["inheritance", "asset_reallocation"]); assert.equal(changed.sale.pricePosition, "discussion"); assert.match(changed.unlinkedOwners, /Mme Fictive/); assert.match(changed.unlinkedOwners, /Nationalité/); assert.deepEqual(changed.owners, before.owners); assert.deepEqual(changed.negotiation, before.negotiation); assert.equal(changed.sale.information.source, "document"); assert.equal(changed.sale.information.confirmation, "confirm"); assert.equal(changed.provenance.length, before.provenance.length + proposals.length);
});
test("unlabelled narrative, ambiguous dates, names and photographs do not infer owner traits or motivation", () => {
  const context = createFonciereData().ownerContext;
  assert.deepEqual(proposeOwnerImport({ filename: "fictif.pdf", rawText: "PAGE 1\nMadame Fictive semble âgée, nom italien et photo de famille.\nUrgent ! Divorce ?\nDate de mise en vente : 31/02/2026\nMotif communiqué : peut-être une succession" }, context), []);
});
test("reimport keeps internal corrections, personal profiles and manual appraisal until explicit field choice", () => {
  const data = property(), incoming = createFonciereData(); incoming.name = "Nouveau nom public"; incoming.description = "Description du bien";
  const merged = applyAgencyImport(data, incoming, ["description"]); assert.deepEqual(merged.ownerContext, data.ownerContext);
  const proposals = proposeOwnerImport({ filename: "retour.pdf", rawText: "PAGE 1\nBaisses de prix annoncées : AUTRE PROPOSITION\nPropriétaire : AUTRE NOM" }, data.ownerContext);
  assert.equal(proposals.find(item=>item.field === "sale.priceReductions")?.current, MARKER);
  assert.deepEqual(applyOwnerImport(merged.ownerContext, proposals, []), data.ownerContext);
});
test("labelled private context cannot be swallowed by public multiline agency descriptions or metadata", async () => {
  const pages = [{ page: 3, text: `Nom du bien : Villa fictive\nDescription : Jolie villa fictive\nPropriétaire : ${MARKER}\nMotif communiqué : succession\nNationalité du propriétaire : ${MARKER}\nDroits détenus : Démembrement\nPrix : 900 000 €` }];
  const extraction = enrichAgencyFacts(parseAgency(pages, "fiche-fictive.pdf"), pages); assert.equal(extraction.fields.description, "Jolie villa fictive");
  const report: AgencyReport = { ...extraction, fields: { ...extraction.fields, ownerContext: MARKER }, evidence: { ...extraction.evidence, ownerContext: { page: 3, extract: MARKER } }, gallery: [], readerWarnings: [], roles: { main: -1, view: -1, inside: -1, operation: -1 }, sourceFile: new File(["fixture"], "fiche-fictive.pdf", { type: "application/pdf" }) };
  const imported = await agencyReportToFonciere(report); assert(!JSON.stringify(imported.presentationData).includes(MARKER)); assert(!JSON.stringify(imported.provenance).includes(MARKER));
  assert(proposeOwnerImport(report, imported.ownerContext).some(item=>item.display.includes(MARKER)));
});

test("sale-context reductions cannot become public asking price or financial assumptions", () => {
  const report = parseAgency([{ page: 1, text: "Nom du bien : Villa fictive\nPropriétaire : Mme Fictive\nBaisses de prix annoncées : 80 000 € en octobre\nPosition communiquée sur le prix : Offre attendue" }], "fiche-fictive.pdf");
  assert.equal(report.fields.asking, undefined); assert(report.rawText.includes("80 000"));
  assert.equal(report.fields.resale, undefined); assert.equal(report.fields.acq, undefined);
});

test("multiline internal sections cannot leak names, context or monetary continuations into public parsing", async () => {
  const pages = [{ page: 1, text: `Nom du bien : Villa fictive\nDescription : Villa publique\nPropriétaire :\n${MARKER} nom annoncé\nMotif de vente :\nsuccession ${MARKER}\nBaisses de prix annoncées :\n80000 EUR\nJustification interne :\n${MARKER} note de négociation\nSurface habitable : 120 m2\nDescription du bien : Piscine publique\nDroits détenus :\nDémembrement ${MARKER}\n` }];
  const report = enrichAgencyFacts(parseAgency(pages, "multiligne.pdf"), pages);
  assert.equal(report.fields.asking, undefined); assert.equal(report.fields.area, "120");
  assert(!JSON.stringify(report.fields).includes(MARKER)); assert(!JSON.stringify(report.evidence).includes(MARKER)); assert(!JSON.stringify(report.extra).includes(MARKER)); assert(report.rawText.includes(MARKER));
  const reviewed = proposeOwnerImport(report, createFonciereData().ownerContext); assert(reviewed.some(item=>item.field === "unlinkedOwners" && item.evidence.page === 1 && item.evidence.extract.includes(MARKER))); assert(reviewed.some(item=>item.field === "sale.priceReductions" && item.value === "80000 EUR"));
  const imported = await agencyReportToFonciere({ ...report, gallery: [], readerWarnings: [], roles: { main: -1, view: -1, inside: -1, operation: -1 }, sourceFile: new File(["fixture"], "multiligne.pdf", { type: "application/pdf" }) });
  assert(!JSON.stringify(imported.presentationData).includes(MARKER)); assert(!JSON.stringify(toPresentationData({ ...imported, name: "Villa fictive" })).includes(MARKER));
});

test("every English owner proposal heading terminates public descriptions and keeps context out of metadata", () => {
  const labels = ["Ownership organisation", "Ownership rights", "Declared owner count", "Reported owners", "Owner age", "Owner nationality", "Owner residence country", "Agreement to sell", "Sale reason", "Disclosed sale reason", "Listing date", "Seller deadline", "Reported price reductions", "Disclosed price position", "Outstanding questions"];
  for (const label of labels) {
    const pages = [{ page: 1, text: `Description : Public villa\n${label} : ${MARKER}\nContinuation ${MARKER}\nPrix : 900000 EUR` }];
    const report = enrichAgencyFacts(parseAgency(pages, "english-fictitious.pdf"), pages); assert.equal(report.fields.description, "Public villa", label); assert(!JSON.stringify(report.fields).includes(MARKER), label); assert(!JSON.stringify(report.evidence).includes(MARKER), label); assert.equal(report.fields.asking, "900000", label); assert(report.rawText.includes(MARKER));
  }
});
