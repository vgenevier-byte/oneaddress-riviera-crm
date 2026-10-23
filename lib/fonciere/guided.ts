/** Versioned, language-neutral guided values. Legacy text stays in FonciereData.
 * Null is an explicit empty answer, distinct from zero, none and not applicable. */
import type { FonciereData } from "./model";
import { number as parseFinanceNumber } from "../izord/finance";
import { sortSelectOptions } from "../selectOptions";

export type GuidedLocale = "fr" | "en";
export type GuidedLabel = { fr: string; en: string };
export type GuidedOption = { value: string; label: GuidedLabel; selectPosition?: "last" };
export type GuidedOptionOrder = "alphabetical" | "business" | "chronological";
export type GuidedSubfield = { key: string; label: GuidedLabel; kind: "choice" | "number" | "text" | "multi"; options?: readonly GuidedOption[]; optionOrder?: GuidedOptionOrder; unit?: string; integer?: boolean; min?: number; max?: number };
export type GuidedFieldDefinition = { label: GuidedLabel; kind: "choice" | "multi" | "number" | "composite" | "checklist" | "diagnostics"; options?: readonly GuidedOption[]; optionOrder?: GuidedOptionOrder; unit?: string; integer?: boolean; min?: number; max?: number; types?: readonly string[]; subfields?: readonly GuidedSubfield[]; legacyOnly?: boolean };
export type GuidedComposite = { [key: string]: string | number | string[] | null | undefined };
export type GuidedRow = { code: string; status: string; detail?: string; documentId?: string; grade?: string };
export type GuidedValue = string | number | null | string[] | GuidedComposite | GuidedRow[];
export type GuidedProperty = { version: 1; values: Partial<Record<GuidedKey, GuidedValue>>; inactive: GuidedKey[]; details: Partial<Record<GuidedKey, string>> };
const label = (fr: string, en: string): GuidedLabel => ({ fr, en });
const options = (rows: readonly (readonly [string, string, string])[], trailing: readonly string[] = []): GuidedOption[] => rows.map(([value, fr, en]) => ({ value, label: label(fr, en), ...(trailing.includes(value) ? { selectPosition: "last" as const } : {}) }));
const uncertain = options([["to_confirm", "À confirmer", "To confirm"], ["not_applicable", "Sans objet", "Not applicable"]], ["to_confirm", "not_applicable"]);
const other = options([["other", "Autre — préciser", "Other — specify"]], ["other"]);
// Category choices sort only when rendered as a dropdown. The original arrays
// remain the validation/round-trip source; scales and periods opt out below.
const choice = (fr: string, en: string, rows: readonly (readonly [string, string, string])[], extra: Partial<GuidedFieldDefinition> = {}): GuidedFieldDefinition => ({ label: label(fr, en), kind: "choice", optionOrder: "alphabetical", options: [...options(rows), ...uncertain, ...other], ...extra });
const multi = (fr: string, en: string, rows: readonly (readonly [string, string, string])[], extra: Partial<GuidedFieldDefinition> = {}): GuidedFieldDefinition => ({ ...choice(fr, en, [["none", "Aucun", "None"], ...rows], extra), kind: "multi" });
const num = (fr: string, en: string, unit: string, extra: Partial<GuidedFieldDefinition> = {}): GuidedFieldDefinition => ({ label: label(fr, en), kind: "number", unit, min: 0, ...extra });
const sub = (key: string, fr: string, en: string, kind: GuidedSubfield["kind"], extra: Partial<GuidedSubfield> = {}): GuidedSubfield => ({ key, label: label(fr, en), kind, ...(kind === "choice" ? { optionOrder: "alphabetical" as const } : {}), ...extra });
const composite = (fr: string, en: string, subfields: GuidedSubfield[], extra: Partial<GuidedFieldDefinition> = {}): GuidedFieldDefinition => ({ label: label(fr, en), kind: "composite", subfields, ...extra });
const dwelling = ["house", "villa", "apartment", "building", "mixed"];
const landTypes = ["house", "villa", "land", "building", "mixed"];
const commercial = ["commercial", "offices", "industrial", "building", "mixed"];
const stage = options([["to_study", "À étudier", "To study"], ["agency_claim", "Mentionné par l’agence", "Agency claim"], ["documented", "Étayé par une pièce", "Supported by a document"], ["not_planned", "Non envisagé", "Not planned"], ["not_applicable", "Sans objet", "Not applicable"]]);
const assessment = (fr: string, en: string): GuidedFieldDefinition => composite(fr, en, [sub("stage", "État de l’étude", "Assessment", "choice", { options: stage, optionOrder: "business" }), sub("detail", "Précision / source annoncée", "Detail / claimed source", "text"), sub("documentId", "Document associé", "Linked document", "text")]);
const periodOptions = options([["month", "Mois", "Month"], ["quarter", "Trimestre", "Quarter"], ["year", "Année", "Year"], ["once", "Ponctuel", "One-off"], ["to_confirm", "À confirmer", "To confirm"], ["not_applicable", "Sans objet", "Not applicable"]]);
const CHECK_OPTIONS = options([["title", "Titre / propriété", "Title / ownership"], ["planning", "Urbanisme / autorisations", "Planning / authorisations"], ["division", "Division", "Subdivision"], ["structure", "Structure / travaux", "Structure / works"], ["area", "Surfaces", "Areas"], ["boundaries", "Limites / servitudes", "Boundaries / easements"], ["risks", "Risques", "Risks"], ["drainage", "Assainissement", "Drainage"], ["occupancy", "Occupation / bail", "Occupancy / lease"], ["charges", "Charges / copropriété", "Charges / condominium"], ["diagnostics", "Diagnostics", "Surveys"], ["other", "Autre", "Other"]]);
export const GUIDED_FIELD_DEFINITIONS = {
  propertyType: choice("Type de bien", "Property type", [["house", "Maison", "House"], ["villa", "Villa", "Villa"], ["apartment", "Appartement", "Apartment"], ["building", "Immeuble", "Building"], ["land", "Terrain", "Land"], ["commercial", "Local commercial", "Commercial premises"], ["offices", "Bureaux", "Offices"], ["industrial", "Local d’activité / Entrepôt", "Industrial / warehouse"], ["parking", "Garage / Parking", "Garage / parking"], ["mixed", "Ensemble immobilier / Mixte", "Mixed property"]]),
  askingPrice: num("Prix demandé", "Asking price", "€"),
  fees: composite("Honoraires", "Agency fees", [sub("inclusion", "Traitement dans le prix", "Price treatment", "choice", { options: options([["included", "Inclus dans le prix", "Included in price"], ["extra", "En supplément", "In addition"], ["to_confirm", "À confirmer", "To confirm"], ["not_applicable", "Sans objet", "Not applicable"]], ["to_confirm", "not_applicable"]) }), sub("payer", "À la charge de", "Paid by", "choice", { options: options([["seller", "Vendeur", "Seller"], ["buyer", "Acquéreur", "Buyer"], ["shared", "Partagée", "Shared"], ["to_confirm", "À confirmer", "To confirm"]], ["to_confirm"]) }), sub("amount", "Montant", "Amount", "number", { unit: "€", min: 0 }), sub("percent", "Pourcentage", "Percentage", "number", { unit: "%", min: 0, max: 100 }), sub("note", "Précision", "Detail", "text")]),
  area: num("Surface du bien", "Property area", "m²"),
  areaKind: choice("Nature de surface", "Area measurement", [["habitable", "Habitable", "Living"], ["carrez", "Carrez", "Carrez"], ["usable", "Utile", "Usable"], ["floor", "Plancher", "Floor"], ["advertised", "Annoncée sans précision", "Advertised, unspecified"]]),
  land: num("Surface du terrain", "Land area", "m²", { types: landTypes }),
  rooms: num("Pièces", "Rooms", "", { integer: true, types: dwelling }),
  bedrooms: num("Chambres", "Bedrooms", "", { integer: true, types: dwelling }),
  condition: choice("État du bien", "Condition", [["new", "Neuf", "New"], ["excellent", "Très bon état", "Excellent condition"], ["good", "Bon état", "Good condition"], ["refresh", "À rafraîchir", "Needs refreshing"], ["renovate", "À rénover", "Needs renovation"], ["heavy", "Rénovation lourde", "Major renovation"]], { optionOrder: "business" }),
  equipment: multi("Équipements", "Equipment", [["air_conditioning", "Climatisation", "Air conditioning"], ["heating", "Chauffage", "Heating"], ["lift", "Ascenseur", "Lift"], ["fireplace", "Cheminée", "Fireplace"], ["smart_home", "Domotique", "Smart home"], ["alarm", "Alarme", "Alarm"], ["accessibility", "Accessibilité", "Accessibility"]]),
  annexes: multi("Annexes / dépendances", "Annexes / outbuildings", [["garage", "Garage", "Garage"], ["parking", "Parking", "Parking"], ["cellar", "Cave", "Cellar"], ["outbuilding", "Dépendance", "Outbuilding"], ["guest_house", "Maison d’amis", "Guest house"], ["caretaker", "Logement de gardien", "Caretaker accommodation"], ["plant_room", "Local technique", "Plant room"]]),
  exterior: multi("Extérieurs", "Outdoor spaces", [["garden", "Jardin", "Garden"], ["terrace", "Terrasse", "Terrace"], ["balcony", "Balcon", "Balcony"], ["patio", "Patio", "Patio"], ["courtyard", "Cour", "Courtyard"], ["rooftop", "Rooftop", "Rooftop"], ["water_access", "Accès à l’eau / amarrage", "Water access / mooring"]]),
  pool: choice("Piscine", "Pool", [["absent", "Absente", "Absent"], ["private", "Privée", "Private"], ["shared", "Collective", "Shared"], ["planned", "Envisagée dans le projet", "Planned in the project"]], { types: ["house", "villa", "apartment", "building", "mixed"] }),
  view: multi("Vue", "View", [["sea", "Mer", "Sea"], ["canal", "Canal", "Canal"], ["mountain", "Montagne", "Mountain"], ["countryside", "Campagne", "Countryside"], ["garden", "Jardin", "Garden"], ["city", "Ville", "City"], ["open", "Dégagée", "Open"], ["overlooked", "Vis-à-vis", "Overlooked"]]),
  annexCount: num("Nombre d’annexes", "Annexe count", "", { integer: true }),
  annexArea: num("Surface des annexes", "Annexe area", "m²"),
  exteriorArea: num("Surface extérieure", "Outdoor area", "m²"),
  poolDetails: composite("Précisions sur la piscine", "Pool details", [sub("heating", "Chauffée", "Heated", "choice", {options: options([["yes","Oui","Yes"],["no","Non","No"],["to_confirm","À confirmer","To confirm"]]), optionOrder: "business"}), sub("position", "Emplacement", "Position", "choice", {options: options([["outdoor","Extérieure","Outdoor"],["indoor","Intérieure","Indoor"],["to_confirm","À confirmer","To confirm"]], ["to_confirm"])}), sub("condition", "État / précision", "Condition / detail", "text")], {types: ["house", "villa", "apartment", "building", "mixed"]}),
  seaExtent: choice("Vue mer", "Sea view extent", [["partial", "Partielle", "Partial"], ["panoramic", "Dégagée / panoramique", "Open / panoramic"]], { optionOrder: "business" }),
  agencyPotential: multi("Potentiel annoncé par l’agence", "Potential claimed by agency", [["renovation", "Rénovation", "Renovation"], ["redistribution", "Redistribution", "Reconfiguration"], ["division", "Division", "Subdivision"], ["extension", "Agrandissement", "Extension"], ["change_use", "Changement d’usage", "Change of use"], ["resale", "Revente", "Resale"], ["rental", "Location", "Rental"]]),
  renovation: assessment("Rénovation", "Renovation"), division: assessment("Division", "Subdivision"), extension: assessment("Agrandissement", "Extension"),
  resale: multi("Objectifs du projet", "Project objectives", [["resale", "Revente", "Resale"], ["long_term", "Location longue durée", "Long-term rental"], ["seasonal", "Location saisonnière", "Seasonal rental"], ["rent_then_resell", "Location puis revente", "Rent then resell"]]),
  rental: multi("Objectifs locatifs", "Rental objectives", [["long_term", "Longue durée", "Long-term"], ["seasonal", "Saisonnier", "Seasonal"], ["rent_then_resell", "Location puis revente", "Rent then resell"]]),
  pointsOfInterest: multi("Points d’intérêt", "Points of interest", [["sea_beach", "Mer / plage", "Sea / beach"], ["centre", "Centre-ville", "Town centre"], ["shops", "Commerces", "Shops"], ["schools", "Écoles", "Schools"], ["transport", "Transports", "Transport"], ["port", "Port", "Port"], ["quiet", "Calme", "Quiet"], ["view", "Vue", "View"], ["upside", "Potentiel de valorisation", "Value potential"]]),
  pointsToVerify: { label: label("Points à vérifier", "Checks"), kind: "checklist", options: CHECK_OPTIONS },
  diagnostics: { label: label("Diagnostics", "Surveys"), kind: "diagnostics", options: options([["dpe", "DPE", "Energy rating (DPE)"], ["ges", "GES", "Emissions rating (GES)"], ["asbestos", "Amiante", "Asbestos"], ["lead", "Plomb", "Lead"], ["electricity", "Électricité", "Electricity"], ["gas", "Gaz", "Gas"], ["termites", "Termites", "Termites"], ["risks", "État des risques", "Risk report"], ["drainage", "Assainissement", "Drainage"], ["other", "Autre", "Other"]]) },
  charges: composite("Charges", "Charges", [sub("amount", "Montant", "Amount", "number", { unit: "€", min: 0 }), sub("period", "Périodicité", "Period", "choice", { options: periodOptions, optionOrder: "chronological" }), sub("nature", "Nature", "Nature", "text"), sub("note", "Précision", "Detail", "text")]),
  constraints: multi("Contraintes", "Constraints", [["condominium", "Copropriété", "Condominium"], ["easement", "Servitude", "Easement"], ["planning", "Urbanisme", "Planning"], ["risks", "Risques", "Risks"], ["access", "Accès", "Access"], ["drainage", "Assainissement", "Drainage"], ["occupancy", "Occupation du bien", "Occupancy"]]),
  worksHypothesis: composite("Hypothèse personnelle de travaux", "Personal works assumption", [sub("amount", "Budget estimé", "Estimated budget", "number", { unit: "€", min: 0 }), sub("level", "Niveau / type", "Level / type", "choice", { options: [...options([["refresh", "Rafraîchissement", "Refreshing"], ["renovation", "Rénovation", "Renovation"], ["heavy", "Rénovation lourde", "Major renovation"], ["extension", "Agrandissement", "Extension"]]), ...uncertain, ...other], optionOrder: "business" }), sub("comment", "Hypothèse / commentaire", "Assumption / comment", "text")]),
  resaleHypothesis: composite("Hypothèse personnelle de revente", "Personal resale assumption", [sub("amount", "Prix estimé", "Estimated price", "number", { unit: "€", min: 0 }), sub("timing", "Échéance", "Timing", "text"), sub("comment", "Hypothèse / commentaire", "Assumption / comment", "text")]),
  rentalHypothesis: composite("Hypothèse personnelle de location", "Personal rental assumption", [sub("mode", "Mode", "Mode", "choice", { options: [...options([["long_term", "Longue durée", "Long-term"], ["seasonal", "Saisonnier", "Seasonal"], ["mixed", "Mixte", "Mixed"]]), ...uncertain, ...other] }), sub("amount", "Loyer estimé", "Estimated rent", "number", { unit: "€", min: 0 }), sub("period", "Unité du loyer", "Rent period", "choice", { options: [...options([["night", "Nuit", "Night"], ["week", "Semaine", "Week"], ["month", "Mois", "Month"], ["year", "Année", "Year"]]), ...uncertain], optionOrder: "chronological" }), sub("occupiedUnits", "Unités louées sur la période étudiée", "Occupied units over study period", "number", { min: 0 }), sub("occupancyPercent", "Taux d’occupation estimé", "Estimated occupancy", "number", { unit: "%", min: 0, max: 100 }), sub("comment", "Période étudiée / hypothèses", "Study period / assumptions", "text")]),
  locationPrecision: choice("Précision de la localisation", "Location precision", [["exact", "Adresse exacte", "Exact address"], ["approximate", "Localisation approximative", "Approximate location"]]),
  // Retain the historical schema for validation and round trips only.
  coordinates: composite("Coordonnées géographiques", "Geographic coordinates", [sub("latitude", "Latitude", "Latitude", "number", { min: -90, max: 90 }), sub("longitude", "Longitude", "Longitude", "number", { min: -180, max: 180 })], { legacyOnly: true }),
  floor: num("Étage", "Floor", "", { min: -1000000, integer: true, types: ["apartment", ...commercial] }),
  lots: num("Nombre de lots / logements", "Lots / dwellings", "", { integer: true, types: ["building", "mixed"] }),
  uses: multi("Usages", "Uses", [["residential", "Habitation", "Residential"], ["commercial", "Commerce", "Retail"], ["offices", "Bureaux", "Offices"], ["industrial", "Activité / stockage", "Industrial / storage"]], { types: commercial }),
  occupancy: choice("Occupation", "Occupancy", [["vacant", "Libre", "Vacant"], ["occupied", "Occupé", "Occupied"], ["tenanted", "Loué", "Tenanted"], ["partial", "Partiellement occupé", "Partly occupied"]], { optionOrder: "business", types: [...commercial, "apartment", "house", "villa"] }),
  servicing: choice("Viabilisation", "Utilities", [["serviced", "Viabilisé", "Serviced"], ["partial", "Partiellement viabilisé", "Partly serviced"], ["not_serviced", "Non viabilisé", "Not serviced"]], { optionOrder: "business", types: ["land"] }),
  buildability: { ...assessment("Constructibilité — à documenter", "Buildability — evidence required"), types: ["land"] },
  parkingSpaces: num("Nombre de places", "Parking spaces", "", { integer: true, types: ["parking", ...commercial] }),
  parkingType: choice("Type de stationnement", "Parking type", [["garage", "Garage fermé", "Enclosed garage"], ["covered", "Couvert", "Covered"], ["outdoor", "Extérieur", "Outdoor"], ["underground", "Sous-sol", "Underground"]], { types: ["parking", ...commercial] }),
  access: choice("Accès", "Access", [["direct", "Accès direct", "Direct access"], ["shared", "Accès partagé", "Shared access"], ["restricted", "Accès restreint", "Restricted access"], ["step_free", "De plain-pied / accessible", "Step-free / accessible"]], { types: ["parking", ...commercial] }),
} satisfies Record<string, GuidedFieldDefinition>;
export type GuidedKey = keyof typeof GUIDED_FIELD_DEFINITIONS;
export const GUIDED_KEYS = Object.keys(GUIDED_FIELD_DEFINITIONS) as GuidedKey[];
export const GUIDED_CHECK_STATUSES = options([["to_verify", "À vérifier", "To verify"], ["in_progress", "En cours", "In progress"], ["verified", "Vérifié", "Verified"]]);
export const GUIDED_DIAGNOSTIC_STATUSES = options([["available", "Disponible", "Available"], ["not_provided", "Non communiqué", "Not provided"], ["in_progress", "En cours", "In progress"], ["not_applicable", "Non applicable", "Not applicable"]]);
export function guidedSelectOptions(options: readonly GuidedOption[], locale: GuidedLocale, order: GuidedOptionOrder): GuidedOption[] {
  return order === "alphabetical" ? sortSelectOptions(options, option => option.label[locale], locale, { last: option => option.selectPosition === "last" }) : [...options];
}
export function createGuidedProperty(): GuidedProperty { return { version: 1, values: {}, inactive: [], details: {} }; }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const allowedOption = (value: unknown, opts?: readonly GuidedOption[]) => typeof value === "string" && !!opts?.some(item => item.value === value);
function validateScalar(value: unknown, def: GuidedSubfield | GuidedFieldDefinition): void {
  if (value === null) return;
  if (def.kind === "number") { if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e15 || def.min !== undefined && value < def.min || def.max !== undefined && value > def.max || def.integer && !Number.isInteger(value)) throw new Error("Nombre guidé invalide."); }
  else if (def.kind === "text") { if (typeof value !== "string" || value.length > 12000) throw new Error("Précision guidée invalide."); }
  else if (def.kind === "choice") { if (!allowedOption(value, def.options)) throw new Error("Choix guidé invalide."); }
  else if (def.kind === "multi") { if (!Array.isArray(value) || value.length > 40 || value.some(v => !allowedOption(v, def.options)) || new Set(value).size !== value.length || value.some(v => ["none", "to_confirm", "not_applicable"].includes(v)) && value.length > 1) throw new Error("Sélection multiple invalide : Aucun / À confirmer / Sans objet est exclusif."); }
}
export function validateGuidedProperty(input: unknown): GuidedProperty {
  if (input === undefined) return createGuidedProperty();
  if (!record(input) || input.version !== 1 || !record(input.values) || Object.keys(input).some(k => !["version", "values", "inactive", "details"].includes(k))) throw new Error("Données guidées invalides.");
  const result = createGuidedProperty();
  for (const [key, value] of Object.entries(input.values)) {
    if (!GUIDED_KEYS.includes(key as GuidedKey)) throw new Error(`Champ guidé inconnu : ${key}.`);
    const def: GuidedFieldDefinition = GUIDED_FIELD_DEFINITIONS[key as GuidedKey];
    if (value !== null && def.kind === "composite") { if (!record(value)) throw new Error("Groupe guidé invalide."); for (const [k, v] of Object.entries(value)) { const subfield = def.subfields?.find(item => item.key === k); if (!subfield) throw new Error(`Précision guidée inconnue : ${k}.`); if (v !== undefined) validateScalar(v, subfield); } }
    else if (value !== null && ["checklist", "diagnostics"].includes(def.kind)) {
      if (!Array.isArray(value) || value.length > 50) throw new Error("Liste de vérifications invalide.");
      const codes = new Set<string>();
      for (const row of value) {
        if (!record(row) || Object.keys(row).some(k => !["code", "status", "detail", "documentId", "grade"].includes(k)) || !allowedOption(row.code, def.options) || codes.has(row.code as string) || !allowedOption(row.status, def.kind === "checklist" ? GUIDED_CHECK_STATUSES : GUIDED_DIAGNOSTIC_STATUSES)) throw new Error("État de vérification invalide.");
        codes.add(row.code as string);
        if (row.grade !== undefined && (!['dpe','ges'].includes(row.code as string) || row.status !== "available" || !/^[A-G]$/.test(String(row.grade)))) throw new Error("Classe DPE/GES invalide.");
        for (const k of ["detail", "documentId"]) if (row[k] !== undefined && (typeof row[k] !== "string" || (row[k] as string).length > (k === "documentId" ? 180 : 12000))) throw new Error("Source de vérification invalide.");
      }
    } else validateScalar(value, def);
    result.values[key as GuidedKey] = structuredClone(value) as GuidedValue;
  }
  if (input.inactive !== undefined && (!Array.isArray(input.inactive) || input.inactive.some(k => !GUIDED_KEYS.includes(k as GuidedKey)) || new Set(input.inactive).size !== input.inactive.length)) throw new Error("Applicabilité guidée invalide.");
  result.inactive = (input.inactive || []) as GuidedKey[];
  if (input.details !== undefined && !record(input.details)) throw new Error("Précisions guidées invalides.");
  for (const [key, value] of Object.entries(input.details || {})) { if (!GUIDED_KEYS.includes(key as GuidedKey) || typeof value !== "string" || value.length > 12000) throw new Error("Précision guidée invalide."); result.details[key as GuidedKey] = value; }
  return result;
}
/** Strict numeric input accepts French formatting; an absent answer stays null. */
export function parseGuidedNumber(value: string): number | null { if (!value.trim()) return null; const n = parseFinanceNumber(value); if (typeof n !== "number" || !Number.isFinite(n)) throw new Error("Nombre invalide ; utilisez par exemple 1 250 000,50."); return n; }
const normalized = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/[’]/g, "'");
function parseLegacy(value: string, def: GuidedFieldDefinition, key?: GuidedKey, evidence = ""): GuidedValue | undefined {
  if (!value.trim()) return undefined;
  if (def.kind === "number") { try { const n = parseGuidedNumber(value.replace(/\s*(?:m²|m2|pièces?|pieces?|chambres?)\s*$/i, "")); validateScalar(n, def); return n; } catch { return undefined; } }
  if (key === "pool" && /^(?:non|no|absente?|sans piscine|aucune piscine)$/i.test(value.trim())) return "absent";
  if (key === "pool" && /^(?:piscine )?priv[ée]e$/i.test(value.trim())) return "private";
  if (key === "pool" && /^(?:piscine )?(?:collective|commune|partag[ée]e)$/i.test(value.trim())) return "shared";
  if (key === "pool" && /^(?:piscine )?(?:envisag[ée]e|projet[ée]e)(?: dans le projet)?$/i.test(value.trim())) return "planned";
  if (key === "view" && /^(?:vue )?mer\s*[:—-]?\s*(?:oui|partielle|panoramique|d[ée]gag[ée]e|d[ée]gag[ée]e\s*\/\s*panoramique)$/i.test(value.trim())) return ["sea"];
  if (key === "fees" && !/confirmer|incertain|possible|envisag|non inclus|non compris|hors honoraires/i.test(value)) {
    const inclusion = /(?:honoraires|frais)(?: d.agence)? (?:inclus|compris)|^FAI$/i.test(value) ? "included" : /en suppl[ée]ment/i.test(value) ? "extra" : undefined;
    const payer = /charge (?:du )?vendeur/i.test(value) ? "seller" : /charge (?:de l.)?acqu[ée]reur/i.test(value) ? "buyer" : /partag[ée]/i.test(value) ? "shared" : undefined;
    if (inclusion || payer) { const result: GuidedComposite = {note:value}; if (inclusion) result.inclusion=inclusion; if (payer) result.payer=payer; const percent=value.match(/([\d.,]+)\s*%/); if (percent) { const n=parseGuidedNumber(percent[1]); if (n!==null && n>=0 && n<=100) result.percent=n; } return result; }
  }
  if (key === "charges") {
    const m=value.trim().match(/^([+\d\s.,€]+)\s*(?:€\s*)?(?:\/|par\s+|per\s+)(mois|month|trimestre|quarter|an|année|year)\s*$/i);
    if (m) { try { const amount=parseGuidedNumber(m[1]); if (amount!==null && amount>=0) return {amount,period:/mois|month/i.test(m[2])?"month":/trimestre|quarter/i.test(m[2])?"quarter":"year"}; } catch {} }
    // Explicit source labels can carry a period which the extractor kept out of the amount.
    if (/^charges(?: de copropri[ée]t[ée])?\s+(?:annuelles|mensuelles|trimestrielles|ponctuelles)\s*:/i.test(evidence.trim())) {
      try { const amount=parseGuidedNumber(value); if (amount!==null && amount>=0) return {amount,period:/annuelles/i.test(evidence)?"year":/mensuelles/i.test(evidence)?"month":/trimestrielles/i.test(evidence)?"quarter":"once"}; } catch { /* preserve an uncertain narrative */ }
    }
  }
  if (key === "diagnostics") {
    const rows: GuidedRow[]=[]; const matches=[...value.matchAll(/\b(DPE|GES)\s*[:=]?\s*(non communiqu[ée]|en cours|non applicable|[A-G])\b/gi)];
    const remaining=value.replace(/\b(DPE|GES)\s*[:=]?\s*(non communiqu[ée]|en cours|non applicable|[A-G])\b/gi,"").replace(/[\s,;./—–-]/g,"");
    if (matches.length && !remaining) { for (const m of matches) { const code=m[1].toLowerCase(), rating=m[2].toUpperCase(); if (rows.some(r=>r.code===code)) return undefined; rows.push(/^[A-G]$/.test(rating)?{code,status:"available",grade:rating}:{code,status:/cours/i.test(m[2])?"in_progress":/applicable/i.test(m[2])?"not_applicable":"not_provided"}); } return rows; }
  }
  if (def.kind === "choice") { const match = def.options?.find(o => [o.label.fr,o.label.en,o.value].some(v => normalized(v) === normalized(value))); return match?.value; }
  if (def.kind === "multi") { const parts = value.split(/\s*[,;\n]\s*/); const selected: string[] = []; for (const part of parts) { const exact = def.options?.find(o => [o.label.fr,o.label.en,o.value].some(v => normalized(v) === normalized(part))); if (!exact) return undefined; selected.push(exact.value); } try { validateScalar(selected, def); return selected; } catch { return undefined; } }
  if (def.kind === "composite" && ["worksHypothesis","resaleHypothesis"].includes(key || "")) { try { const amount = parseGuidedNumber(value); if (amount !== null && amount >= 0) return {amount}; } catch { /* Narrative is retained verbatim. */ } }
  if (key === "rentalHypothesis") {
    const match = value.trim().match(/^([+\d\s.,€]+)\s*(?:€\s*)?(?:\/|par\s+|per\s+)(nuit|night|semaine|week|mois|month|an|année|year)\s*$/i);
    if (match) { try { const amount = parseGuidedNumber(match[1]); if (amount !== null && amount >= 0) return {amount, period: /nuit|night/i.test(match[2]) ? "night" : /semaine|week/i.test(match[2]) ? "week" : /mois|month/i.test(match[2]) ? "month" : "year"}; } catch { /* uncertain amounts stay legacy */ } }
  }
  return undefined;
}
export function deriveGuidedProperty(data: Pick<FonciereData, "guided"> & Partial<Record<string, unknown>>): GuidedProperty {
  const result = structuredClone(validateGuidedProperty(data.guided));
  for (const key of GUIDED_KEYS) if (!(key in result.values) && typeof data[key] === "string") {
    const provenance = Array.isArray(data.provenance) ? data.provenance : [];
    const evidence = [...provenance].reverse().find(item => record(item) && record(item.fields) && record(item.fields[key]));
    const extract = evidence && record(evidence.fields) && record(evidence.fields[key]) && typeof evidence.fields[key].extract === "string" ? evidence.fields[key].extract : "";
    const value = parseLegacy(data[key] as string, GUIDED_FIELD_DEFINITIONS[key], key, extract); if (value !== undefined) result.values[key] = value;
  }
  if (!("seaExtent" in result.values) && typeof data.view === "string" && Array.isArray(result.values.view) && (result.values.view as unknown[]).includes("sea")) {
    if (/^(?:vue )?mer\s*[:—-]?\s*partielle$/i.test(data.view.trim())) result.values.seaExtent="partial";
    if (/^(?:vue )?mer\s*[:—-]?\s*(?:panoramique|d[ée]gag[ée]e|d[ée]gag[ée]e\s*\/\s*panoramique)$/i.test(data.view.trim())) result.values.seaExtent="panoramic";
  }
  return result;
}
export function readGuidedField(data: FonciereData, key: GuidedKey): GuidedValue | undefined { return deriveGuidedProperty(data).values[key]; }
export function setGuidedField(data: FonciereData, key: GuidedKey, value: GuidedValue | undefined): FonciereData {
  if (key === "propertyType") return changeGuidedPropertyType(data, typeof value === "string" ? value : null);
  const guided = structuredClone(data.guided); guided.values[key] = value === undefined || value === "" ? null : value;
  guided.inactive = guided.inactive.filter(k => k !== key);
  return { ...data, guided: validateGuidedProperty(guided) };
}
export function setGuidedFieldDetail(data: FonciereData, key: GuidedKey, value: string): FonciereData { const guided = structuredClone(data.guided); guided.details[key] = value; return { ...data, guided: validateGuidedProperty(guided) }; }
export function isGuidedFieldApplicable(key: GuidedKey, type: unknown): boolean { const def: GuidedFieldDefinition = GUIDED_FIELD_DEFINITIONS[key]; return !def.legacyOnly && (!def.types || typeof type !== "string" || ["other","to_confirm","not_applicable"].includes(type) || def.types.includes(type)); }
export function changeGuidedPropertyType(data: FonciereData, type: string | null): FonciereData {
  const guided = deriveGuidedProperty(data); const previous = guided.values.propertyType;
  if (previous !== type) for (const key of GUIDED_KEYS) if (!(GUIDED_FIELD_DEFINITIONS[key] as GuidedFieldDefinition).legacyOnly && !isGuidedFieldApplicable(key, type) && (guided.values[key] !== undefined || typeof data[key as keyof FonciereData] === "string" && !!data[key as keyof FonciereData])) guided.inactive.push(key);
  guided.values.propertyType = type; guided.inactive = [...new Set(guided.inactive)];
  return { ...data, guided: validateGuidedProperty(guided) };
}
export function reconfirmGuidedField(data: FonciereData, key: GuidedKey): FonciereData { return { ...data, guided: { ...data.guided, inactive: data.guided.inactive.filter(k => k !== key) } }; }
export function toggleGuidedMulti(current: readonly string[], value: string): string[] { if (current.includes(value)) return current.filter(v => v !== value); if (["none", "not_applicable", "to_confirm"].includes(value)) return [value]; return [...current.filter(v => !["none", "not_applicable", "to_confirm"].includes(v)), value]; }
function dependencyApplies(guided: GuidedProperty, key: GuidedKey): boolean {
  const selected = (parent: GuidedKey) => !guided.inactive.includes(parent) && isGuidedFieldApplicable(parent,guided.values.propertyType) ? guided.values[parent] : undefined;
  if (["annexCount","annexArea"].includes(key)) { const v=selected("annexes"); return Array.isArray(v) && v.some(x=>typeof x === "string" && !["none","to_confirm","not_applicable"].includes(x)); }
  if (key === "exteriorArea") { const v=selected("exterior"); return Array.isArray(v) && v.some(x=>typeof x === "string" && !["none","to_confirm","not_applicable"].includes(x)); }
  if (key === "poolDetails") return ["private","shared","planned"].includes(String(selected("pool")));
  if (key === "seaExtent") { const v=selected("view"); return Array.isArray(v) && (v as unknown[]).includes("sea"); }
  return true;
}
export function currentGuidedValue(data: FonciereData, key: GuidedKey): GuidedValue | undefined { const guided = deriveGuidedProperty(data); return guided.inactive.includes(key) || !isGuidedFieldApplicable(key, guided.values.propertyType) || !dependencyApplies(guided,key) ? undefined : guided.values[key]; }
export function formatGuidedValue(key: GuidedKey, value: GuidedValue | undefined, locale: GuidedLocale = "fr"): string {
  if (value === undefined || value === null) return "";
  const def: GuidedFieldDefinition = GUIDED_FIELD_DEFINITIONS[key];
  if (def.legacyOnly) return "";
  const one = (value: string, opts = def.options) => opts?.find(o => o.value === value)?.label[locale] || value;
  const number = (v: number, unit = def.unit) => `${new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: 10 }).format(v)}${unit ? ` ${unit}` : ""}`;
  if (typeof value === "number") return number(value);
  if (typeof value === "string") return one(value);
  if (def.kind === "multi") return (value as string[]).map(v => one(v)).join(", ");
  if (def.kind === "checklist" || def.kind === "diagnostics") return (value as GuidedRow[]).map(row => [one(row.code), one(row.status, def.kind === "checklist" ? GUIDED_CHECK_STATUSES : GUIDED_DIAGNOSTIC_STATUSES), row.grade, row.detail, row.documentId ? `${locale === "fr" ? "Document" : "Document"} : ${row.documentId}` : ""].filter(Boolean).join(" — ")).join("\n");
  return (def.subfields || []).map(field => { const v = (value as GuidedComposite)[field.key]; return v === undefined || v === null || v === "" ? "" : `${field.label[locale]} : ${typeof v === "number" ? number(v, field.unit || "") : Array.isArray(v) ? v.map(s => one(s, field.options)).join(", ") : one(v, field.options)}`; }).filter(Boolean).join(" · ");
}
/** Factual display values. Inactive and incompatible legacy values are never current. */
export function guidedReadableFields(data: FonciereData, locale: GuidedLocale = "fr"): Record<GuidedKey, string> {
  const guided = deriveGuidedProperty(data); const result = {} as Record<GuidedKey, string>;
  for (const key of GUIDED_KEYS) { if (guided.inactive.includes(key) || !isGuidedFieldApplicable(key, guided.values.propertyType) || !dependencyApplies(guided,key)) { result[key] = ""; continue; } const raw = data[key as keyof FonciereData]; const text = key in guided.values ? formatGuidedValue(key, guided.values[key], locale) : typeof raw === "string" ? raw : ""; result[key] = [text,guided.details[key]].filter(Boolean).join(" — "); }
  return result;
}
export function suggestedFonciereName(data: FonciereData, locale: GuidedLocale = "fr"): string { const type = formatGuidedValue("propertyType", readGuidedField(data,"propertyType"), locale); return [type, data.city, data.agencyReference].filter(Boolean).join(" — ").slice(0,200); }
