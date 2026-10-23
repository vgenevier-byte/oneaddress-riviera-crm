import test from "node:test";
import assert from "node:assert/strict";
import { parseAgency } from "../../lib/izord/agency";
import { enrichAgencyFacts } from "../../lib/izord/agency-details";

test("Explicit property type and surface nature retain exact source categories", () => {
  for (const type of ["Villa", "Local commercial", "Ensemble immobilier / Mixte", "Catégorie spéciale à confirmer"]) {
    const pages = [{ page: 1, text: `Nom du bien : Fiche fictive\nType de bien : ${type}\nSurface habitable : 123 m2\nPièces : 123\nChambres : 101` }];
    const report = enrichAgencyFacts(parseAgency(pages, "fictif.pdf"), pages);
    assert.equal(report.fields.type, type);
    assert.equal(report.fields.areaKind, "habitable");
    assert.equal(report.fields.rooms, "123");
    assert.equal(report.fields.bedrooms, "101");
    assert.equal(report.evidence.type.page, 1);
  }
});

test("Unknown surface categories and uncertain characteristics are retained verbatim", () => {
  const pages = [{ page: 2, text: "Type de bien : Terrain\nNature de surface : Surface cadastrale non mesurée\nPiscine : Peut-être possible sous réserve\nVue : Pas de vue mer\nPotentiel annoncé : Aucune division autorisée à ce stade" }];
  const report = enrichAgencyFacts(parseAgency(pages, "fictif.pdf"), pages);
  assert.equal(report.fields.areaKind, "Surface cadastrale non mesurée");
  assert.equal(report.fields.pool, "Peut-être possible sous réserve");
  assert.equal(report.fields.view, "Pas de vue mer");
  assert.match(report.fields.agencyPotential, /Aucune division autorisée/);
});
