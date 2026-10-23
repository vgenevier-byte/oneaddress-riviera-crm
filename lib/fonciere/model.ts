import { createProjectData, validateProjectData, type ProjectData } from "../izord/model";
import { AGENCY_FIELD_MAP } from "./import-fields";
import { number as financeNumber, finite } from "../izord/finance";

/** Property records are independent from the versioned presentation dossiers. */
export const FONCIERE_FIELDS = [
  "name", "propertyType", "agencyReference", "propertyAddress", "city", "postalCode", "location",
  "agencyName", "agencyAddress", "agencyPhone", "agencyEmail", "agentName", "agentPhone", "agentEmail", "agentContactId",
  "askingPrice", "fees", "area", "areaKind", "land", "rooms", "bedrooms", "condition", "equipment", "annexes", "exterior", "pool", "view",
  "description", "agencyPotential", "renovation", "division", "extension", "resale", "rental", "pointsOfInterest", "pointsToVerify",
  "diagnostics", "charges", "constraints", "worksHypothesis", "resaleHypothesis", "rentalHypothesis", "notes",
] as const;
export type FonciereField = typeof FONCIERE_FIELDS[number];
export type ImportProvenance = {
  id: string; importedAt: string; filename: string; method: "text" | "ocr" | "mixed";
  warnings: string[]; fields: Record<string, { page: number | null; extract: string }>;
};
export type FonciereData = Record<FonciereField, string> & { presentationData: ProjectData; provenance: ImportProvenance[] };
export const FONCIERE_SCHEMA = "FONCIERE_PROPERTY_V1";
export const FONCIERE_DOCUMENT_LIMIT = 30;
function numericHypothesis(value: string): string { const parsed = financeNumber(value); return finite(parsed) ? String(parsed) : ""; }

export function createFonciereData(): FonciereData {
  const fields = Object.fromEntries(FONCIERE_FIELDS.map(key => [key, ""])) as Record<FonciereField, string>;
  return { ...fields, presentationData: createProjectData(), provenance: [] };
}

export function validateFonciereData(input: unknown, requireName = true): FonciereData {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Fiche projet invalide.");
  const raw = input as Record<string, unknown>, result = createFonciereData();
  for (const key of FONCIERE_FIELDS) {
    const value = raw[key] ?? "";
    if (typeof value !== "string" || value.length > (key === "name" ? 200 : key === "agentContactId" ? 180 : 12000)) throw new Error(`Champ de projet invalide ou trop long : ${key}.`);
    result[key] = value;
  }
  result.name = result.name.trim();
  if (requireName && !result.name) throw new Error("Le nom du projet est obligatoire.");
  result.presentationData = validateProjectData(raw.presentationData ?? createProjectData());
  const provenance = raw.provenance ?? [];
  if (!Array.isArray(provenance) || provenance.length > 30) throw new Error("Historique d’import trop volumineux.");
  if (JSON.stringify(provenance).length > 250000) throw new Error("Provenance d’import trop volumineuse.");
  result.provenance = (provenance as unknown[]).map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Provenance d’import invalide.");
    const value = entry as ImportProvenance;
    if (typeof value.id !== "string" || value.id.length > 100 || typeof value.importedAt !== "string" || value.importedAt.length > 60 || typeof value.filename !== "string" || value.filename.length > 240 || !["text", "ocr", "mixed"].includes(value.method) || !Array.isArray(value.warnings) || value.warnings.length > 100 || value.warnings.some(warning => typeof warning !== "string" || warning.length > 2000) || !value.fields || typeof value.fields !== "object" || Array.isArray(value.fields)) throw new Error("Provenance d’import invalide.");
    const fields: ImportProvenance["fields"] = {};
    for (const [key, evidence] of Object.entries(value.fields)) {
      if (!FONCIERE_FIELDS.includes(key as FonciereField) || !evidence || typeof evidence.extract !== "string" || evidence.extract.length > 2000 || !(evidence.page === null || Number.isInteger(evidence.page) && evidence.page > 0 && evidence.page <= 10000)) throw new Error("Source d’un champ invalide.");
      fields[key] = { page: evidence.page, extract: evidence.extract };
    }
    return { id: value.id, importedAt: value.importedAt, filename: value.filename, method: value.method, warnings: [...value.warnings], fields };
  });
  return result;
}

/** Clone the saved source, then map current property corrections. The generator
 * owns this snapshot; subsequent property edits cannot mutate a presentation. */
export function toPresentationData(input: FonciereData, source?: { id: string; revision: number }): ProjectData {
  const data = validateFonciereData(input), result = structuredClone(data.presentationData);
  const set = (key: string, value: string) => { result.state[key] = value.slice(0, 1000); };
  set("project", data.name); set("ref", data.agencyReference); set("address", [data.propertyAddress, [data.postalCode, data.city].filter(Boolean).join(" ")].filter(Boolean).join(", "));
  set("type", data.propertyType); set("asking", data.askingPrice); set("area", data.area); set("land", data.land); set("measurement", data.areaKind);
  set("sea", /(?:sans|aucune|no)\s+(?:vue\s+)?(?:mer|sea)|^non$/i.test(data.view) ? "Non" : /mer|sea/i.test(data.view) ? /partiel|partial/i.test(data.view) ? "Partielle" : "Oui" : "À confirmer");
  set("agencyFee", data.fees);
  set("features", [data.rooms && `${data.rooms} pièces`, data.bedrooms && `${data.bedrooms} chambres`, data.condition, data.equipment, data.annexes, data.exterior, data.pool, data.view, data.description].filter(Boolean).join(" · "));
  set("program", [data.agencyPotential && `Potentiel annoncé par l’agence : ${data.agencyPotential}`, data.renovation && `Rénovation envisagée : ${data.renovation}`, data.division && `Division à étudier : ${data.division}`, data.extension && `Agrandissement à étudier : ${data.extension}`, data.resale && `Revente envisagée : ${data.resale}`, data.rental && `Location envisagée : ${data.rental}`].filter(Boolean).join("\n"));
  set("propertyWarnings", [data.pointsToVerify, data.diagnostics, data.charges, data.constraints].filter(Boolean).join("\n"));
  set("environment", [data.location, data.pointsOfInterest].filter(Boolean).join(" · "));
  set("source", [data.agencyName, data.agencyReference, data.provenance.map(item => item.filename).join(", ")].filter(Boolean).join(" · "));
  set("works", numericHypothesis(data.worksHypothesis)); set("resale", numericHypothesis(data.resaleHypothesis)); set("monthly", numericHypothesis(data.rentalHypothesis));
  set("decisionNotes", [data.notes, ...([["travaux", data.worksHypothesis], ["revente", data.resaleHypothesis], ["location", data.rentalHypothesis]] as const).filter(([, value]) => value && !numericHypothesis(value)).map(([label, value]) => `Hypothèse personnelle (${label}) : ${value}`)].filter(Boolean).join("\n"));
  const fullText = Object.fromEntries(FONCIERE_FIELDS.filter(key => key !== "agentContactId").map(key => [key, data[key]]));
  result.importMeta = { ...(result.importMeta || {}), fonciereSnapshot: { fields: fullText, provenance: structuredClone(data.provenance) } as unknown as import("../izord/model").JsonValue };
  if (source) result.importMeta.fonciereSource = { id: source.id, revision: source.revision, capturedAt: new Date().toISOString() };
  return validateProjectData(result);
}

export function fromPresentationData(input: ProjectData): FonciereData {
  const presentation = validateProjectData(input), result = createFonciereData(), state = presentation.state;
  const agencyFields = presentation.importMeta?.agencyFields;
  let importedAddress = "";
  if (agencyFields && typeof agencyFields === "object" && !Array.isArray(agencyFields)) {
    for (const [target, source] of Object.entries(AGENCY_FIELD_MAP)) if (typeof agencyFields[source] === "string") result[target as FonciereField] = agencyFields[source] as string;
    importedAddress = result.propertyAddress;
    result.propertyAddress = /adresse exacte [àa] confirmer/i.test(importedAddress) ? "" : importedAddress.replace(/\s*[—,]\s*\d{5}\s+.+$/, "").trim();
  }
  const importMeta = presentation.importMeta;
  if (importMeta && typeof importMeta.filename === "string") {
    const evidence = importMeta.evidence, fields: ImportProvenance["fields"] = {};
    if (evidence && typeof evidence === "object" && !Array.isArray(evidence)) for (const [target, source] of Object.entries(AGENCY_FIELD_MAP)) {
      const item = evidence[source];
      if (item && typeof item === "object" && !Array.isArray(item) && typeof item.extract === "string") fields[target] = { page: typeof item.page === "number" && Number.isInteger(item.page) && item.page > 0 ? item.page : null, extract: item.extract.slice(0, 2000) };
    }
    result.provenance = [{ id: crypto.randomUUID(), importedAt: typeof importMeta.validatedAt === "string" ? importMeta.validatedAt.slice(0, 60) : new Date().toISOString(), filename: importMeta.filename.slice(0, 240), method: importMeta.extractionMethod === "ocr" || importMeta.extractionMethod === "mixed" ? importMeta.extractionMethod : "text", warnings: Array.isArray(importMeta.warnings) ? importMeta.warnings.filter((value): value is string => typeof value === "string").slice(0, 100).map(value => value.slice(0, 2000)) : [], fields }];
  }
  const fields = presentation.importMeta?.fonciereSnapshot;
  let hasSnapshot = false;
  if (fields && typeof fields === "object" && !Array.isArray(fields) && fields.fields && typeof fields.fields === "object" && !Array.isArray(fields.fields)) {
    hasSnapshot = true;
    for (const key of FONCIERE_FIELDS) if (key !== "agentContactId" && typeof fields.fields[key] === "string") result[key] = fields.fields[key] as string;
    if (Array.isArray(fields.provenance)) result.provenance = structuredClone(fields.provenance) as unknown as ImportProvenance[];
  }
  result.name = String(state.project ?? result.name); result.agencyReference = String(state.ref ?? result.agencyReference);
  const oldAddress = [result.propertyAddress, [result.postalCode, result.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (state.address !== undefined && state.address !== oldAddress && !(!hasSnapshot && importedAddress && state.address === importedAddress)) { result.propertyAddress = String(state.address); result.postalCode = ""; result.city = ""; }
  result.propertyType = String(state.type ?? result.propertyType); result.askingPrice = String(state.asking ?? result.askingPrice); result.area = String(state.area ?? result.area); result.land = String(state.land ?? result.land);
  result.areaKind ||= String(state.measurement || ""); result.fees ||= String(state.agencyFee || ""); result.description ||= String(state.features || "");
  if (!result.agencyPotential) result.renovation ||= String(state.program || "");
  result.pointsToVerify ||= String(state.propertyWarnings || "");
  for (const [target, source] of [["worksHypothesis", "works"], ["resaleHypothesis", "resale"], ["rentalHypothesis", "monthly"]] as const) {
    const current = String(state[source] ?? ""); if (current !== numericHypothesis(result[target])) result[target] = current;
  }
  result.notes ||= String(state.decisionNotes || "");
  result.presentationData = structuredClone(presentation);
  return validateFonciereData(result, false);
}
