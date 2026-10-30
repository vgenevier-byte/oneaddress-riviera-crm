import { isCivilDate } from "./calendarDates";
import { createProjectData, validateProjectData, type ProjectData } from "../izord/model";
import { AGENCY_FIELD_MAP } from "./import-fields";
import { number as financeNumber, finite } from "../izord/finance";
import { normalizeAddressValue, type AddressValue } from "../address";
import { propertyAddressDetails, selectPropertyAddress } from "./address";
import { createOwnerContext, validateOwnerContext, type OwnerContext } from "./owners";
import { GUIDED_FIELD_DEFINITIONS, createGuidedProperty, validateGuidedProperty, guidedReadableFields, deriveGuidedProperty, currentGuidedValue, setGuidedField, type GuidedProperty, type GuidedComposite, type GuidedKey } from "./guided";

/** Property records are independent from the versioned presentation dossiers. */
export const FONCIERE_FIELDS = [
  "name", "propertyType", "agencyReference", "propertyAddress", "city", "postalCode", "location",
  "agencyName", "agencyAddress", "agencyPhone", "agencyEmail", "agentName", "agentPhone", "agentEmail", "agentContactId", "agencyContactId",
  "askingPrice", "fees", "area", "areaKind", "land", "rooms", "bedrooms", "condition", "equipment", "annexes", "exterior", "pool", "view",
  "description", "agencyPotential", "renovation", "division", "extension", "resale", "rental", "pointsOfInterest", "pointsToVerify",
  "diagnostics", "charges", "constraints", "worksHypothesis", "resaleHypothesis", "rentalHypothesis", "notes",
] as const;
export type FonciereField = typeof FONCIERE_FIELDS[number];
export type ImportProvenance = {
  id: string; importedAt: string; filename: string; method: "text" | "ocr" | "mixed";
  warnings: string[]; fields: Record<string, { page: number | null; extract: string }>;
};
export type ContactSources = { agent?: { baseline: Partial<Record<"agentName" | "agentEmail" | "agentPhone" | "agencyName", string>> }; agency?: { baseline: Partial<Record<"agencyName" | "agencyAddress" | "agencyPhone" | "agencyEmail", string>> } };
export type FonciereData = Record<FonciereField, string> & { presentationData: ProjectData; provenance: ImportProvenance[]; guided: GuidedProperty; contactSources: ContactSources; ownerContext: OwnerContext; visitDate: string; constraintNotes: Record<string, string>; diagnosticsReceived: "" | "yes" | "no"; propertyAddressDetails?: AddressValue; agencyAddressDetails?: AddressValue };
export const FONCIERE_SCHEMA = "FONCIERE_PROPERTY_V1";
export const FONCIERE_DOCUMENT_LIMIT = 30;
function numericHypothesis(value: string): string { const parsed = financeNumber(value); return finite(parsed) ? String(parsed) : ""; }

export function createFonciereData(): FonciereData {
  const fields = Object.fromEntries(FONCIERE_FIELDS.map(key => [key, ""])) as Record<FonciereField, string>;
  return { ...fields, presentationData: createProjectData(), provenance: [], guided: createGuidedProperty(), contactSources: {}, visitDate: "", constraintNotes: {}, diagnosticsReceived: "", ownerContext: createOwnerContext() };
}

export function validateFonciereData(input: unknown, requireName = true): FonciereData {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Fiche projet invalide.");
  const raw = input as Record<string, unknown>, result = createFonciereData();
  for (const key of FONCIERE_FIELDS) {
    const value = raw[key] ?? "";
    if (typeof value !== "string" || value.length > (key === "name" ? 200 : ["agentContactId", "agencyContactId"].includes(key) ? 180 : 12000)) throw new Error(`Champ de projet invalide ou trop long : ${key}.`);
    result[key] = value;
  }
  if (raw.visitDate !== undefined && raw.visitDate !== "" && !isCivilDate(raw.visitDate)) throw new Error("Date de visite invalide.");
  if (raw.diagnosticsReceived !== undefined && !["", "yes", "no"].includes(raw.diagnosticsReceived as string)) throw new Error("Réponse diagnostics invalide.");
  result.visitDate = (raw.visitDate as string | undefined) ?? "";
  result.diagnosticsReceived = (raw.diagnosticsReceived as FonciereData["diagnosticsReceived"] | undefined) ?? "";
  if (raw.constraintNotes !== undefined) {
    const notes = raw.constraintNotes;
    if (!notes || typeof notes !== "object" || Array.isArray(notes) || Object.entries(notes).some(([key, value]) => !GUIDED_FIELD_DEFINITIONS.constraints.options?.some(option => option.value === key) || typeof value !== "string" || value.length > 12000)) throw new Error("Précision de contrainte invalide.");
    result.constraintNotes = { ...notes } as Record<string, string>;
  }
  result.guided = validateGuidedProperty(raw.guided);
  result.ownerContext = validateOwnerContext(raw.ownerContext);
  if (raw.propertyAddressDetails !== undefined) result.propertyAddressDetails = propertyAddressDetails({ ...result, propertyAddressDetails: normalizeAddressValue(raw.propertyAddressDetails) });
  if (raw.agencyAddressDetails !== undefined) result.agencyAddressDetails = normalizeAddressValue(raw.agencyAddressDetails, result.agencyAddress);
  if (raw.contactSources !== undefined) {
    if (!raw.contactSources || typeof raw.contactSources !== "object" || Array.isArray(raw.contactSources)) throw new Error("Origine des coordonnées invalide.");
    for (const [role, source] of Object.entries(raw.contactSources)) {
      const allowed = role === "agent" ? ["agentName", "agentEmail", "agentPhone", "agencyName"] : role === "agency" ? ["agencyName", "agencyAddress", "agencyPhone", "agencyEmail"] : null;
      if (!allowed || !source || typeof source !== "object" || Array.isArray(source) || Object.keys(source).some(key => key !== "baseline") || !("baseline" in source) || !source.baseline || typeof source.baseline !== "object" || Array.isArray(source.baseline)) throw new Error("Origine des coordonnées invalide.");
      for (const [key, value] of Object.entries(source.baseline)) if (!allowed.includes(key) || typeof value !== "string" || value.length > 12000) throw new Error("Coordonnée de référence invalide.");
    }
    result.contactSources = structuredClone(raw.contactSources) as ContactSources;
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
  const data = validateFonciereData(input), result = structuredClone(data.presentationData), readable = guidedReadableFields(data);
  const set = (key: string, value: string) => { result.state[key] = value.slice(0, 1000); };
  const text = (key: GuidedKey) => readable[key];
  const amount = (key: GuidedKey) => { const value = currentGuidedValue(data,key); return typeof value === "number" ? String(value) : key in deriveGuidedProperty(data).values ? "" : numericHypothesis(data[key as FonciereField] || ""); };
  const constraintDetails = () => { const selected = currentGuidedValue(data, "constraints"); return Array.isArray(selected) ? selected.flatMap(code => typeof code === "string" && data.constraintNotes[code] ? [`${GUIDED_FIELD_DEFINITIONS.constraints.options?.find(option => option.value === code)?.label.fr || code} : ${data.constraintNotes[code]}`] : []).join("\n") : ""; };
  const compositeAmount = (key: GuidedKey) => { const value = currentGuidedValue(data,key); return value && !Array.isArray(value) && typeof value === "object" && typeof value.amount === "number" ? String(value.amount) : key in deriveGuidedProperty(data).values ? "" : numericHypothesis(data[key as FonciereField] || ""); };
  const strategy = currentGuidedValue(data, "personalStrategy");
  const legacyStrategy = !Object.hasOwn(deriveGuidedProperty(data).values, "personalStrategy");
  const saleActive = legacyStrategy || strategy === "resale" || strategy === "rental_then_resale";
  const rentalActive = legacyStrategy || strategy === "rental" || strategy === "rental_then_resale";
  set("project", data.name); set("ref", data.agencyReference); set("address", [data.propertyAddress, [data.postalCode, data.city].filter(Boolean).join(" ")].filter(Boolean).join(", "));
  const address = propertyAddressDetails(data);
  if (address) { set("address", address.formattedAddress); result.addressDetails = normalizeAddressValue(address, result.state.address); }
  else delete result.addressDetails;
  set("type", text("propertyType")); set("asking", amount("askingPrice")); set("area", amount("area")); set("land", text("land") ? amount("land") : ""); set("measurement", text("areaKind"));
  const views = currentGuidedValue(data,"view"), seaExtent = currentGuidedValue(data,"seaExtent");
  // No substring inference from uncertain, negative or hypothetical source text.
  set("sea", Array.isArray(views) && (views as unknown[]).includes("sea") ? seaExtent === "partial" ? "Partielle" : "Oui" : Array.isArray(views) && (views as unknown[]).includes("none") ? "Non" : "À confirmer");
  // Fees are descriptive; the asking price is never increased or fees added to acquisition again.
  set("agencyFee", text("fees"));
  set("features", [text("rooms") && `${text("rooms")} pièces`, text("bedrooms") && `${text("bedrooms")} chambres`, ...(["condition","equipment","annexes","exterior","pool","view","floor","lots","uses","occupancy","servicing","buildability","parkingSpaces","parkingType","access"] as GuidedKey[]).filter(key => text(key)).map(key => `${key === "pool" ? "Piscine : " : ""}${text(key)}`), data.description].filter(Boolean).join(" · "));
  set("program", [text("agencyPotential") && `Potentiel annoncé par l’agence (à vérifier) : ${text("agencyPotential")}`, ...(["renovation","division","extension"] as GuidedKey[]).filter(key=>text(key)).map(key=>`${key === "renovation" ? "Rénovation" : key === "division" ? "Division" : "Agrandissement"} — étude, sans autorisation présumée : ${text(key)}`), text("resale") && `Objectifs personnels : ${text("resale")}`, text("rental") && `Objectifs locatifs : ${text("rental")}`].filter(Boolean).join("\n"));
  set("propertyWarnings", (["pointsToVerify","diagnostics","charges","constraints"] as GuidedKey[]).filter(key=>text(key)).map(key=>text(key)).concat(constraintDetails()).filter(Boolean).join("\n"));
  set("environment", [data.location, text("locationPrecision"), text("pointsOfInterest")].filter(Boolean).join(" · "));
  set("source", [data.agencyName, data.agencyReference, data.provenance.map(item => item.filename).join(", ")].filter(Boolean).join(" · "));
  set("works", compositeAmount("worksHypothesis")); set("resale", saleActive ? compositeAmount("resaleHypothesis") : "");
  set("monthly", ""); set("weekly", ""); set("rentedMonths", ""); set("weeks", "");
  const rent = currentGuidedValue(data,"rentalHypothesis") as GuidedComposite | undefined;
  if (rentalActive && rent && !Array.isArray(rent) && typeof rent === "object" && typeof rent.amount === "number") {
    if (rent.period === "month") { set("monthly", String(rent.amount)); set("rentalMode", "annual"); if (typeof rent.occupiedUnits === "number") set("rentedMonths", String(rent.occupiedUnits)); }
    if (rent.period === "week") { set("weekly", String(rent.amount)); set("rentalMode", "seasonal"); if (typeof rent.occupiedUnits === "number") set("weeks", String(rent.occupiedUnits)); }
  }
  set("decisionNotes", [data.notes, ...(["worksHypothesis","resaleHypothesis","rentalHypothesis"] as GuidedKey[]).filter(key=>text(key) && (key !== "resaleHypothesis" || saleActive) && (key !== "rentalHypothesis" || rentalActive)).map(key=>`Hypothèse personnelle (${key === "worksHypothesis" ? "travaux" : key === "resaleHypothesis" ? "revente" : "location"}) : ${text(key)}`)].filter(Boolean).join("\n"));
  // Deliberate public-field allowlist: ownerContext and its internal evidence never
  // enter the presentation snapshot, persisted metadata, JSON or PowerPoint notes.
  const fullText = Object.fromEntries(FONCIERE_FIELDS.filter(key => !["agentContactId","agencyContactId"].includes(key)).map(key => [key, data[key]]));
  result.importMeta = { ...(result.importMeta || {}), fonciereSnapshot: { fields: fullText, constraintNotes: structuredClone(data.constraintNotes), guided: structuredClone(data.guided), readableFields: readable, provenance: structuredClone(data.provenance), mappedState: structuredClone(result.state), ...(data.propertyAddressDetails ? { propertyAddressDetails: structuredClone(data.propertyAddressDetails) } : {}), ...(data.agencyAddressDetails ? { agencyAddressDetails: structuredClone(data.agencyAddressDetails) } : {}) } as unknown as import("../izord/model").JsonValue };
  if (source) result.importMeta.fonciereSource = { id: source.id, revision: source.revision, capturedAt: new Date().toISOString() };
  return validateProjectData(result);
}

export function fromPresentationData(input: ProjectData, existing?: FonciereData): FonciereData {
  const presentation = validateProjectData(input), result = createFonciereData(), state = presentation.state;
  // This dedicated internal block is never restored from presentation metadata.
  // A reviewed reconciliation can update public fields while retaining the project context.
  if (existing) { const internal = validateFonciereData(existing, false); result.ownerContext = structuredClone(internal.ownerContext); result.visitDate = internal.visitDate; result.diagnosticsReceived = internal.diagnosticsReceived; result.constraintNotes = structuredClone(internal.constraintNotes); }
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
    for (const key of FONCIERE_FIELDS) if (!["agentContactId","agencyContactId"].includes(key) && typeof fields.fields[key] === "string") result[key] = fields.fields[key] as string;
    if (fields.constraintNotes !== undefined) result.constraintNotes = validateFonciereData({ ...result, constraintNotes: fields.constraintNotes }, false).constraintNotes;
    if (fields.guided !== undefined) result.guided = validateGuidedProperty(fields.guided);
    if (Array.isArray(fields.provenance)) result.provenance = structuredClone(fields.provenance) as unknown as ImportProvenance[];
    if (fields.propertyAddressDetails) result.propertyAddressDetails = normalizeAddressValue(fields.propertyAddressDetails);
    if (fields.agencyAddressDetails) result.agencyAddressDetails = normalizeAddressValue(fields.agencyAddressDetails, result.agencyAddress);
  }
  if (existing) result.constraintNotes = structuredClone(validateFonciereData(existing, false).constraintNotes);
  if (hasSnapshot && fields && typeof fields === "object" && !Array.isArray(fields) && fields.mappedState && typeof fields.mappedState === "object" && !Array.isArray(fields.mappedState) && Object.entries(fields.mappedState).every(([key,value]) => state[key] === value)) {
    result.presentationData = structuredClone(presentation);
    return validateFonciereData(result, false);
  }
  // An edited generator state updates only the corresponding source fields.
  // Preserve legacy raw strings and structured values for every untouched field.
  if (hasSnapshot && fields && typeof fields === "object" && !Array.isArray(fields) && fields.guided && fields.mappedState && typeof fields.mappedState === "object" && !Array.isArray(fields.mappedState)) {
    const mapped = fields.mappedState;
    const changed = (key: string) => state[key] !== mapped[key];
    if (changed("project")) result.name = String(state.project || "");
    if (changed("ref")) result.agencyReference = String(state.ref || "");
    if (changed("address")) { Object.assign(result, presentation.addressDetails?.line1 ? selectPropertyAddress(result, presentation.addressDetails) : { propertyAddress: String(state.address || ""), postalCode: "", city: "", propertyAddressDetails: presentation.addressDetails }); }
    const adapted = (key: GuidedKey, value: import("./guided").GuidedValue | undefined) => { const next = setGuidedField(result,key,value); result.guided=next.guided; };
    if (changed("type")) { const probe=createFonciereData(); probe.propertyType=String(state.type || ""); const value=deriveGuidedProperty(probe).values.propertyType; adapted("propertyType",value || (state.type ? "other" : null)); if (state.type && !value) result.guided.details.propertyType=String(state.type); }
    for (const [target,key] of [["askingPrice","asking"],["area","area"],["land","land"]] as const) if (changed(key)) { const n=financeNumber(state[key]); adapted(target,finite(n)?n:null); if (state[key] && !finite(n)) result.guided.details[target]=String(state[key]); }
    for (const [target,key] of [["worksHypothesis","works"],["resaleHypothesis","resale"]] as const) if (changed(key)) { result[target]=String(state[key] || ""); const n=financeNumber(state[key]); const old=currentGuidedValue(result,target); const composite=old && typeof old === "object" && !Array.isArray(old)?old:{}; adapted(target,{...composite,amount:finite(n)?n:null}); }
    if (changed("monthly") || changed("weekly")) {
      const old=currentGuidedValue(result,"rentalHypothesis"); const composite=old && typeof old === "object" && !Array.isArray(old)?old:{};
      const monthly=financeNumber(state.monthly),weekly=financeNumber(state.weekly);
      if (changed("monthly") && finite(monthly) && !finite(weekly)) adapted("rentalHypothesis",{...composite,amount:monthly,period:"month"});
      else if (changed("weekly") && finite(weekly) && !finite(monthly)) adapted("rentalHypothesis",{...composite,amount:weekly,period:"week"});
      else if (!finite(monthly) && !finite(weekly)) adapted("rentalHypothesis",{...composite,amount:null});
      else { /* Combined generator scenarios stay in the generator; never collapse to one source rent. */ }
    }
    if (changed("decisionNotes")) result.notes=String(state.decisionNotes || "");
    result.presentationData=structuredClone(presentation);
    return validateFonciereData(result,false);
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
  if (presentation.addressDetails?.line1) Object.assign(result, selectPropertyAddress(result, presentation.addressDetails));
  return validateFonciereData(result, false);
}
