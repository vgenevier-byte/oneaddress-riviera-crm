import test from "node:test";
import assert from "node:assert/strict";
import { parseAgency } from "../../lib/izord/agency";
import { enrichAgencyFacts } from "../../lib/izord/agency-details";
import { applyAgencyImport, proposeAgencyImport } from "../../lib/fonciere/import";
import { createFonciereData } from "../../lib/fonciere/model";

test("Agency factual extraction separates property, agency and personal financial assumptions", () => {
  const pages = [{ page: 2, text: `Nom du bien : Nuage fictif\nAdresse du bien : 12 rue des Nuages\nVille : Ville Fictive\nCode postal : 00000\nAgence : Agence Fictive\nAdresse agence : 99 avenue des Tests\nTelephone agence : 01 23 45 67 89\nEmail agence : agence@example.test\nAgent : Camille Fictive\nTelephone agent : 06 12 34 56 78\nEmail agent : camille@example.test\nPrix demande : 545 000 EUR\nSurface habitable : 123 m2\nPotentiel annonce : Division sous reserve des autorisations.\nPiscine : Non\nDPE : D` }];
  const report = enrichAgencyFacts(parseAgency(pages, "fictif.pdf"), pages);
  assert.equal(report.fields.address, "12 rue des Nuages");
  assert.equal(report.fields.agencyAddress, "99 avenue des Tests");
  assert.equal(report.fields.agentName, "Camille Fictive");
  assert.equal(report.fields.agentEmail, "camille@example.test");
  assert.equal(report.fields.asking, "545000");
  assert.equal(report.fields.area, "123");
  assert.equal(report.evidence.agentEmail.page, 2);
  assert.equal(report.fields.pool, "Non");
  assert.match(report.fields.agencyPotential, /sous reserve/);
  for (const key of ["acq", "works", "resale", "weekly", "monthly"]) assert.equal(report.fields[key], undefined);
});

test("Agency-only address never becomes the property address or locality", () => {
  const pages = [{ page: 1, text: "Agence : Agence fictive\nAdresse agence : 99 avenue du Test\nEmail agence : agence@example.test\nDescription : Villa sans adresse communiquee." }];
  const report = enrichAgencyFacts(parseAgency(pages, "fictif.pdf"), pages);
  assert.equal(report.fields.address, "");
  assert.equal(report.fields.city, undefined);
  assert.equal(report.fields.agencyAddress, "99 avenue du Test");
});

test("Reimport proposes changed facts and preserves unselected corrections, notes and hypotheses", () => {
  const current = createFonciereData(); Object.assign(current, { name: "Nuage corrigé", askingPrice: "500000", notes: "Note privée", worksHypothesis: "60000", agentContactId: "existing-crm-contact" });
  const incoming = createFonciereData(); Object.assign(incoming, { name: "Titre agence", askingPrice: "545000", notes: "ne pas importer", worksHypothesis: "999999", agentContactId: "forged" });
  const proposals = proposeAgencyImport(current, incoming);
  assert.deepEqual(proposals.map(value => value.key).sort(), ["askingPrice", "name"]);
  const next = applyAgencyImport(current, incoming, ["askingPrice"]);
  assert.equal(next.askingPrice, "545000"); assert.equal(next.name, "Nuage corrigé"); assert.equal(next.notes, "Note privée"); assert.equal(next.worksHypothesis, "60000"); assert.equal(next.agentContactId, "existing-crm-contact");
  assert.equal(current.askingPrice, "500000");
});
