import type { AgencyReport } from "../izord/agency";
import { isPublicAgencyHeading, ownerContextHeading } from "../izord/agency-privacy";
import { isCivilDate } from "./calendarDates";
import { validateOwnerContext, type OwnerContext, type OwnerImportEvidence } from "./owners";

export type OwnerImportField = "organization" | "rights" | "declaredCount" | "unlinkedOwners" | "sale.agreement" | "sale.reasons" | "sale.listedOn" | "sale.sellerDeadline" | "sale.priceReductions" | "sale.pricePosition" | "sale.openQuestions";
export type OwnerImportProposal = { id: string; field: OwnerImportField; label: [string, string]; value: string | number | string[]; display: string; current: string; evidence: OwnerImportEvidence };
const labels: Record<OwnerImportField, [string, string]> = {
  organization: ["Organisation de la propriété", "Ownership organisation"], rights: ["Droits détenus", "Ownership rights"], declaredCount: ["Nombre de propriétaires déclarés", "Declared owner count"], unlinkedOwners: ["Propriétaires annoncés — à identifier", "Reported owners — identification required"],
  "sale.agreement": ["Accord sur la vente", "Agreement to sell"], "sale.reasons": ["Motif communiqué", "Disclosed sale reason"], "sale.listedOn": ["Date de mise en vente", "Listing date"], "sale.sellerDeadline": ["Échéance souhaitée par le vendeur", "Seller’s desired deadline"], "sale.priceReductions": ["Baisses de prix annoncées", "Reported price reductions"], "sale.pricePosition": ["Position communiquée sur le prix", "Disclosed price position"], "sale.openQuestions": ["Points restant à éclaircir", "Outstanding questions"],
};
export function ownerImportLabel(field: string, lang: "fr" | "en" = "fr"): string { const pair = labels[field.replace(/^ownerContext\./, "") as OwnerImportField]; return pair ? pair[lang === "fr" ? 0 : 1] : field; }
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’']/g, " ").replace(/\s+/g, " ").trim();
function date(text: string): string | undefined { const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/), value = match ? `${match[3]}-${match[2]}-${match[1]}` : text; return isCivilDate(value) ? value : undefined; }
function currentValue(context: OwnerContext, field: OwnerImportField): unknown { return field.startsWith("sale.") ? context.sale[field.slice(5) as keyof OwnerContext["sale"]] : context[field as "organization" | "rights" | "declaredCount" | "unlinkedOwners"]; }
function empty(value: unknown): boolean { return value === null || value === "" || value === "unspecified" || value === "not_discussed" || Array.isArray(value) && !value.length; }
/** Exact labelled statements only. Names, photographs and surrounding narrative
 * are never used to infer personal traits or resolve a CRM identity. */
export function proposeOwnerImport(report: Pick<AgencyReport, "rawText" | "filename">, input: OwnerContext, importedAt = new Date().toISOString()): OwnerImportProposal[] {
  const context = validateOwnerContext(input), proposals: OwnerImportProposal[] = [];
  let page: number | null = null;
  const sourceLines = report.rawText.split(/\r?\n/);
  for (let at = 0; at < sourceLines.length; at++) {
    const rawLine = sourceLines[at], pageMatch = rawLine.match(/^PAGE\s+(\d+)\s*$/i); if (pageMatch) { page = Number(pageMatch[1]); continue; }
    const heading = rawLine.trim();
    if (!ownerContextHeading.test(heading)) continue;
    const labelled = heading.match(/^([^:]{3,90})\s*:\s*([\s\S]*)$/);
    if (!labelled) continue;
    const chunks = labelled[2].trim() ? [labelled[2].trim()] : [];
    const span = [heading], pendingPageMarkers: string[] = [];
    let spansPages = false;
    for (let next = at + 1; next < sourceLines.length; next++) {
      const continuation = sourceLines[next].trim();
      if (/^PAGE\s+\d+\s*$/i.test(continuation)) { pendingPageMarkers.push(continuation); continue; }
      if (/^[^:]{3,90}\s*:/.test(continuation) || isPublicAgencyHeading(continuation) || ownerContextHeading.test(continuation)) break;
      if (!continuation) continue;
      if (pendingPageMarkers.length) { spansPages = true; span.push(...pendingPageMarkers); pendingPageMarkers.length = 0; }
      chunks.push(continuation); span.push(continuation);
    }
    if (!chunks.length) continue;
    const line = `${labelled[1]} : ${chunks.join("\n")}`;
    const extract = (spansPages && page !== null ? [`PAGE ${page}`, ...span] : span).join("\n");
    // Never accept a truncated cross-page claim or lose its source pages.
    // Oversized claims stay in the attached original for manual review.
    if (line.length > 2000 || extract.length > 2000) continue;
    const match = line.match(/^([^:]{3,90})\s*:\s*([\s\S]{1,2000})$/); if (!match) continue;
    const key = normalize(match[1]), text = match[2].trim(), valueText = normalize(text);
    let field: OwnerImportField | undefined, value: string | number | string[] | undefined;
    if (["organisation de la propriete", "ownership organisation"].includes(key)) { field = "organization"; value = ({ "proprietaire unique": "sole", "sole owner": "sole", indivision: "indivision", "joint ownership": "indivision", autre: "other", other: "other", "a confirmer": "confirm", "to confirm": "confirm" } as Record<string,string>)[valueText]; }
    else if (["droits detenus", "ownership rights"].includes(key)) { field = "rights"; value = ({ "pleine propriete": "full", "full ownership": "full", demembrement: "split", "split ownership": "split", autre: "other", other: "other", "a confirmer": "confirm", "to confirm": "confirm" } as Record<string,string>)[valueText]; }
    else if (["nombre de proprietaires", "nombre de proprietaires declares", "declared owner count"].includes(key) && /^\d{1,5}$/.test(text) && Number(text) <= 10000) { field = "declaredCount"; value = Number(text); }
    else if (["proprietaire", "proprietaires", "proprietaire(s)", "proprietaires annonces", "owner", "owners", "reported owners", "age du proprietaire", "nationalite du proprietaire", "pays de residence du proprietaire", "owner age", "owner nationality", "owner residence country"].includes(key)) { field = "unlinkedOwners"; value = line.slice(0,2000); }
    else if (["accord sur la vente", "agreement to sell"].includes(key)) { field = "sale.agreement"; value = ({ "accord annonce de tous": "all_agree", "all owners agree": "all_agree", "desaccord signale": "disagreement", "disagreement reported": "disagreement", "accord a confirmer": "confirm", "to confirm": "confirm", "non renseigne": "unspecified", unspecified: "unspecified" } as Record<string,string>)[valueText]; }
    else if (["motif de vente", "motif communique", "sale reason", "disclosed sale reason"].includes(key)) {
      field = "sale.reasons";
      const options: Record<string,string> = { succession: "inheritance", inheritance: "inheritance", "separation/divorce": "separation", "separation / divorce": "separation", separation: "separation", divorce: "separation", "demenagement/mutation": "relocation", "demenagement / mutation": "relocation", demenagement: "relocation", mutation: "relocation", relocation: "relocation", "arbitrage patrimonial": "asset_reallocation", "asset reallocation": "asset_reallocation", "vente d un investissement": "investment_sale", "investment sale": "investment_sale", autre: "other", other: "other", "non communique": "undisclosed", undisclosed: "undisclosed" };
      const parts = valueText.split(/\s*[;,]\s*/).map(item=>options[item]); if (parts.every(Boolean)) value = [...new Set(parts)];
    }
    else if (["date de mise en vente", "listing date"].includes(key)) { field = "sale.listedOn"; value = date(text); }
    else if (["echeance souhaitee par le vendeur", "echeance vendeur", "seller deadline"].includes(key)) { field = "sale.sellerDeadline"; value = date(text); }
    else if (["baisses de prix annoncees", "baisses de prix deja annoncees", "reported price reductions"].includes(key)) { field = "sale.priceReductions"; value = text; }
    else if (["position communiquee sur le prix", "position sur le prix", "disclosed price position"].includes(key)) { field = "sale.pricePosition"; value = ({ "non evoquee": "not_discussed", "not discussed": "not_discussed", "prix ferme annonce": "firm", "firm price": "firm", "ouvert a discussion": "discussion", "open to discussion": "discussion", "offre attendue": "offer_expected", "offer expected": "offer_expected", "a confirmer": "confirm", "to confirm": "confirm" } as Record<string,string>)[valueText]; }
    else if (["points restant a eclaircir", "outstanding questions"].includes(key)) { field = "sale.openQuestions"; value = text; }
    if (!field || value === undefined) continue;
    const existing = currentValue(context, field);
    if (JSON.stringify(existing) === JSON.stringify(value)) continue;
    // Separate owner statements retain their own page and extract. Their
    // reviewed text is appended; it never replaces an existing identification note.
    if (field === "unlinkedOwners" && typeof existing === "string" && existing.split("\n").includes(String(value))) continue;
    if (field !== "unlinkedOwners" && proposals.some(item=>item.field===field)) continue;
    proposals.push({ id: `${field}:${proposals.length}`, field, label: labels[field], value, display: typeof value === "number" ? String(value) : text, current: empty(existing) ? "" : typeof existing === "string" ? existing : JSON.stringify(existing), evidence: { field: `ownerContext.${field}`, filename: report.filename.slice(0,240), page, extract, importedAt } });
  }
  return proposals;
}
/** Only explicit reviewed choices are applied. Internal judgement, contact IDs,
 * personal profiles and already recorded provenance are never replaced. */
export function applyOwnerImport(input: OwnerContext, proposals: readonly OwnerImportProposal[], selectedIds: readonly string[]): OwnerContext {
  const result = structuredClone(validateOwnerContext(input)), selected = new Set(selectedIds);
  for (const proposal of proposals) {
    if (!selected.has(proposal.id)) continue;
    const value = structuredClone(proposal.value);
    if (proposal.field.startsWith("sale.")) Object.assign(result.sale, { [proposal.field.slice(5)]: value });
    else if (proposal.field === "unlinkedOwners") { if (!result.unlinkedOwners.split("\n").includes(String(value))) { const appended = [result.unlinkedOwners, String(value)].filter(Boolean).join("\n"); if (appended.length > 2000) throw new Error("La note des propriétaires annoncés dépasse 2 000 caractères. Réduisez la sélection ; le brouillon est conservé. / The reported-owner note exceeds 2,000 characters. Reduce the selection; the draft is retained."); result.unlinkedOwners = appended; } }
    else Object.assign(result, { [proposal.field]: value });
    if (!result.provenance.some(item=>JSON.stringify(item)===JSON.stringify(proposal.evidence))) result.provenance.push(structuredClone(proposal.evidence));
    if (proposal.field.startsWith("sale.") && result.sale.information.source === "unspecified") result.sale.information = { ...result.sale.information, source: "document", detail: proposal.evidence.filename, date: proposal.evidence.importedAt.slice(0,10), confirmation: "confirm" };
  }
  return validateOwnerContext(result);
}
