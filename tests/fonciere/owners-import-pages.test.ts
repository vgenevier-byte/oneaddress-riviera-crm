import assert from "node:assert/strict";
import test from "node:test";
import { parseAgency, type AgencyReport, type PdfPage } from "../../lib/izord/agency";
import { enrichAgencyFacts } from "../../lib/izord/agency-details";
import { agencyReportToFonciere } from "../../lib/fonciere/import";
import { applyOwnerImport, proposeOwnerImport } from "../../lib/fonciere/ownerImport";
import { createOwnerContext } from "../../lib/fonciere/owners";
import { toPresentationData } from "../../lib/fonciere/model";
import { exportProjectJson } from "../../lib/izord/model";
import { notesText } from "../../lib/izord/presentation-notes";
import { calculate } from "../../lib/izord/finance";
const MARKER = "PRIVATE_PAGES_OWNER_2bb048";
function report(pages: PdfPage[]): AgencyReport { return { ...enrichAgencyFacts(parseAgency(pages, "fictitious-pages.pdf"), pages), gallery: [], readerWarnings: [], roles: { main: -1, view: -1, inside: -1, operation: -1 }, sourceFile: new File(["fixture"], "fictitious-pages.pdf", { type: "application/pdf" }) }; }
function assertPublicSafe(input: AgencyReport) { for (const object of [input.fields, input.evidence, input.extra]) assert(!JSON.stringify(object).includes(MARKER)); }

test("FR private price reduction continuing on the next page cannot become asking price", () => {
  for (const label of ["Baisses de prix annoncées", "Reported price reductions"]) {
  const pages = [{ page: 1, text: `${label} :` }, { page: 2, text: "80000 EUR\nSurface habitable : 120 m2" }];
  const parsed = parseAgency(pages, "fictitious-pages.pdf"); assert.equal(parsed.fields.asking, undefined); assert.equal(parsed.fields.area, "120");
  const enriched = report(pages); assert.equal(enriched.fields.asking, undefined); assert.equal(enriched.fields.area, "120"); assert(enriched.rawText.includes("PAGE 2\n80000 EUR"));
  }
});
test("EN private names, context and notes remain private across several pages until explicit public heading", async () => {
  const pages = [{ page: 1, text: "Description : Public villa\nReported owners :" }, { page: 2, text: `${MARKER} reported name\nReported price reductions :` }, { page: 3, text: `80000 EUR\n${MARKER} private continuation\nSurface habitable : 120 m2\nPrix demandé : 940000 EUR` }];
  const input = report(pages); assertPublicSafe(input); assert.equal(input.fields.asking, "940000"); assert.equal(input.fields.area, "120"); assert.equal(input.fields.description, "Public villa"); assert(input.rawText.includes(MARKER));
  const imported = await agencyReportToFonciere(input); imported.name = "Public fictitious villa";
  const presentation = toPresentationData(imported); for (const text of [JSON.stringify(imported.presentationData), JSON.stringify(imported.provenance), exportProjectJson(presentation), notesText(presentation.state, calculate(presentation.state), presentation.importMeta)]) assert(!text.includes(MARKER));
});
test("reviewed cross-page price reduction preserves heading page and exact PAGE-labelled source span", () => {
  const input = report([{ page: 1, text: "Baisses de prix annoncées :" }, { page: 2, text: "80000 EUR\nSurface habitable : 120 m2" }]);
  const proposals = proposeOwnerImport(input, createOwnerContext(), "2026-10-28T12:00:00Z"), price = proposals.find(item=>item.field === "sale.priceReductions"); assert(price); assert.equal(price.value, "80000 EUR"); assert.equal(price.evidence.page, 1); assert.equal(price.evidence.extract, "PAGE 1\nBaisses de prix annoncées :\nPAGE 2\n80000 EUR");
  const kept = applyOwnerImport(createOwnerContext(), proposals, []); assert.equal(kept.sale.priceReductions, ""); const accepted = applyOwnerImport(kept, proposals, [price.id]); assert.equal(accepted.sale.priceReductions, "80000 EUR"); assert.deepEqual(accepted.provenance, [price.evidence]);
});
test("FR and EN labelled field values continue across pages without swallowing public labels or PAGE markers", () => {
  for (const [heading, field, value, expected] of [["Motif communiqué", "sale.reasons", "succession", ["inheritance"]], ["Sale reason", "sale.reasons", "inheritance", ["inheritance"]], ["Nombre de propriétaires déclarés", "declaredCount", "4", 4], ["Ownership rights", "rights", "Full ownership", "full"], ["Listing date", "sale.listedOn", "2026-01-31", "2026-01-31"]] as const) {
    const input = report([{ page: 4, text: `${heading} :` }, { page: 5, text: `${value}\nSurface habitable : 120 m2` }]); const proposal = proposeOwnerImport(input, createOwnerContext()).find(item=>item.field === field); assert(proposal, heading); assert.deepEqual(proposal.value, expected, heading); assert.equal(proposal.evidence.page, 4); assert(proposal.evidence.extract.includes(`PAGE 5\n${value}`)); assert(!proposal.evidence.extract.includes("Surface habitable"));
  }
});
test("unlinked owner statement spans multiple pages with faithful source and remains distinct from CRM identities", () => {
  const input = report([{ page: 7, text: "Propriétaire :" }, { page: 8, text: `${MARKER} nom communiqué` }, { page: 9, text: `${MARKER} remarque\nPrix demandé : 900000 EUR` }]);
  const context = createOwnerContext(), proposal = proposeOwnerImport(input, context).find(item=>item.field === "unlinkedOwners"); assert(proposal); assert.equal(proposal.evidence.page, 7); assert(proposal.evidence.extract.includes(`PAGE 8\n${MARKER}`)); assert(proposal.evidence.extract.includes(`PAGE 9\n${MARKER}`)); assert(!/^PAGE\s+\d+$/m.test(String(proposal.value))); const accepted = applyOwnerImport(context, [proposal], [proposal.id]); assert.equal(accepted.owners.length, 0); assert.equal(accepted.representatives.length, 0); assertPublicSafe(input);
});

test("EN explicit asking price and living area resume public parsing after a cross-page private section", () => {
  const pages = [{ page: 1, text: "Reported price reductions :" }, { page: 2, text: `80000 EUR\n${MARKER} internal continuation\nAsking price : 1250000 EUR\nLiving area : 120 m2` }];
  const input = report(pages); assert.equal(input.fields.asking, "1250000"); assert.equal(input.fields.area, "120"); assertPublicSafe(input); const proposal = proposeOwnerImport(input, createOwnerContext()).find(item=>item.field === "sale.priceReductions"); assert(proposal); assert(!String(proposal.value).includes("1250000")); assert(!proposal.evidence.extract.includes("Asking price")); assert(proposal.evidence.extract.includes("PAGE 2\n80000 EUR"));
});
