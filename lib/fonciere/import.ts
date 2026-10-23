import { applyAgencyReport, type AgencyReport } from "../izord/agency";
import { assertProjectImageBudget } from "../izord/model";
import { createFonciereData, validateFonciereData, type FonciereData, type FonciereField, type ImportProvenance } from "./model";

import { AGENCY_FIELD_MAP } from "./import-fields";
export { AGENCY_FIELD_MAP } from "./import-fields";

export type AgencyImportProposal = { key: FonciereField; label: string; current: string; proposed: string };

export async function agencyReportToFonciere(report: AgencyReport, signal?: AbortSignal): Promise<FonciereData> {
  const data = createFonciereData();
  const fields: ImportProvenance["fields"] = {};
  for (const [target, source] of Object.entries(AGENCY_FIELD_MAP) as [FonciereField, string][]) {
    const value = report.fields[source];
    if (!value || value === "À confirmer" || target === "propertyAddress" && /adresse exacte [àa] confirmer/i.test(value)) continue;
    data[target] = value.slice(0, target === "name" ? 200 : 12_000);
    if (report.evidence[source]) fields[target] = { ...report.evidence[source] };
  }
  // In a combined street/locality line, persist one street and separate locality fields.
  if (data.propertyAddress) data.propertyAddress = data.propertyAddress.replace(/\s*[—,]\s*\d{5}\s+.+$/, "").trim();
  if (!data.pointsToVerify) data.pointsToVerify = report.fields.propertyWarnings || "";
  if (!data.areaKind) data.areaKind = report.fields.measurement || "";
  if (!data.equipment) data.equipment = report.fields.features || "";
  if (!data.view && report.fields.sea && report.fields.sea !== "À confirmer") data.view = `Vue mer : ${report.fields.sea}`;
  if (!data.fees && report.evidence.agencyFee) data.fees = report.fields.agencyFee || "";
  if (!data.agencyName && report.agency !== "Agence à confirmer") data.agencyName = report.agency;
  data.presentationData = await applyAgencyReport(report, signal);
  data.provenance = [{ id: crypto.randomUUID(), importedAt: new Date().toISOString(), filename: report.filename.slice(0,240), method: report.extractionMethod || "text", warnings: [...new Set([...report.warnings, ...report.readerWarnings])].slice(0,100).map(value=>value.slice(0,2000)), fields }];
  return validateFonciereData(data, false);
}

/** A fresh proposal; no mutation occurs until the caller chooses fields. */
export function proposeAgencyImport(current: FonciereData, imported: FonciereData): AgencyImportProposal[] {
  return (Object.keys(AGENCY_FIELD_MAP) as FonciereField[]).filter(key => imported[key].trim() && imported[key] !== current[key]).map(key => ({ key, label: key, current: current[key], proposed: imported[key] }));
}

/** Selected factual changes + append-only import provenance and photo gallery.
 * Existing manual assumptions, notes, contact identities and presentation crops survive. */
export function applyAgencyImport(current: FonciereData, imported: FonciereData, selectedKeys: readonly FonciereField[]): FonciereData {
  const result = structuredClone(validateFonciereData(current, false));
  const incoming = validateFonciereData(imported, false);
  const allowed = new Set(Object.keys(AGENCY_FIELD_MAP));
  for (const key of selectedKeys) if (allowed.has(key) && incoming[key].trim()) result[key] = incoming[key];
  const photos = new Set(result.presentationData.importGallery.map(photo => photo.data));
  for (const photo of incoming.presentationData.importGallery) if (!photos.has(photo.data)) { result.presentationData.importGallery.push({ ...photo }); photos.add(photo.data); }
  // Keep existing role assignments on reimport. Fresh records can use reviewed source photos.
  if (!current.presentationData.importGallery.length && !Object.keys(current.presentationData.photoGalleryRoles).length) {
    result.presentationData.photos = structuredClone(incoming.presentationData.photos);
    result.presentationData.photoGalleryRoles = { ...incoming.presentationData.photoGalleryRoles };
  }
  if (!result.presentationData.importMeta) result.presentationData.importMeta = structuredClone(incoming.presentationData.importMeta);
  assertProjectImageBudget(result.presentationData);
  result.provenance.push(...incoming.provenance.filter(item => !result.provenance.some(existing => existing.id === item.id)));
  return validateFonciereData(result, false);
}
