import { isCivilDate } from "./calendarDates";

/** Project-only information. Never include this structure in presentation data. */
export const OWNER_ORGANIZATIONS = ["unspecified", "sole", "indivision", "other", "confirm"] as const;
export const OWNER_RIGHTS = ["unspecified", "full", "split", "other", "confirm"] as const;
export const SALE_AGREEMENTS = ["unspecified", "all_agree", "disagreement", "confirm"] as const;
export const SALE_REASONS = ["inheritance", "separation", "relocation", "asset_reallocation", "investment_sale", "other", "undisclosed"] as const;
export const SALE_PRICE_POSITIONS = ["not_discussed", "firm", "discussion", "offer_expected", "confirm"] as const;
export const NEGOTIATION_POTENTIALS = ["unevaluated", "low", "moderate", "high"] as const;
export const OWNER_INFORMATION_SOURCES = ["unspecified", "owner", "contact", "document", "other"] as const;
export type OwnerInformation = { source: typeof OWNER_INFORMATION_SOURCES[number]; contactId: string; documentId: string; detail: string; date: string; confirmation: "confirm" | "confirmed" };
export type OwnerPerson = { age: number | null; ageApproximate: boolean; ageAsOf: string; residenceCountry: string; nationalities: string[]; note: string; information: OwnerInformation };
export type OwnerLink = { contactId: string; entityType: "person" | "company"; note: string; person?: OwnerPerson };
export type OwnerRepresentative = { contactId: string; ownerContactId: string; role: string };
export type OwnerImportEvidence = { field: string; filename: string; page: number | null; extract: string; importedAt: string };
export type OwnerContext = {
  schema: 1; unlinkedOwners: string; organization: typeof OWNER_ORGANIZATIONS[number]; rights: typeof OWNER_RIGHTS[number]; declaredCount: number | null;
  owners: OwnerLink[]; representatives: OwnerRepresentative[]; primaryContactId: string; primaryRole: string;
  sale: { agreement: typeof SALE_AGREEMENTS[number]; reasons: typeof SALE_REASONS[number][]; listedOn: string; sellerDeadline: string; priceReductions: string; pricePosition: typeof SALE_PRICE_POSITIONS[number]; openQuestions: string; information: OwnerInformation };
  negotiation: { potential: typeof NEGOTIATION_POTENTIALS[number]; justification: string; favorablePoints: string; blockingPoints: string; nextQuestion: string; updatedBy: string; updatedAt: string };
  provenance: OwnerImportEvidence[];
};
export function createOwnerInformation(): OwnerInformation { return { source: "unspecified", contactId: "", documentId: "", detail: "", date: "", confirmation: "confirm" }; }
export function createOwnerPerson(): OwnerPerson { return { age: null, ageApproximate: false, ageAsOf: "", residenceCountry: "", nationalities: [], note: "", information: createOwnerInformation() }; }
export function createOwnerContext(): OwnerContext { return { schema: 1, unlinkedOwners: "", organization: "unspecified", rights: "unspecified", declaredCount: null, owners: [], representatives: [], primaryContactId: "", primaryRole: "", sale: { agreement: "unspecified", reasons: [], listedOn: "", sellerDeadline: "", priceReductions: "", pricePosition: "not_discussed", openQuestions: "", information: createOwnerInformation() }, negotiation: { potential: "unevaluated", justification: "", favorablePoints: "", blockingPoints: "", nextQuestion: "", updatedBy: "", updatedAt: "" }, provenance: [] }; }
function fail(): never { throw new Error("Informations propriétaires et contexte de vente invalides."); }
function object(value: unknown, allowed: readonly string[]): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) return fail(); return value as Record<string, unknown>; }
function text(value: unknown, max = 2000): string { if (typeof value !== "string" || value.length > max) return fail(); return value; }
function date(value: unknown): string { const result = text(value, 10); if (result && !isCivilDate(result)) return fail(); return result; }
function enumeration<T extends string>(value: unknown, values: readonly T[]): T { if (typeof value !== "string" || !values.includes(value as T)) return fail(); return value as T; }
function list(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) return fail(); return value; }
function count(value: unknown, max: number): number | null { if (value === null) return null; if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) return fail(); return value; }
function country(value: unknown): string { const result = text(value, 2); if (result && !/^[A-Z]{2}$/.test(result)) return fail(); return result; }
function information(value: unknown): OwnerInformation { const raw = object(value, ["source", "contactId", "documentId", "detail", "date", "confirmation"]); return { source: enumeration(raw.source, OWNER_INFORMATION_SOURCES), contactId: text(raw.contactId, 180), documentId: text(raw.documentId, 180), detail: text(raw.detail), date: date(raw.date), confirmation: enumeration(raw.confirmation, ["confirm", "confirmed"]) }; }
function person(value: unknown): OwnerPerson { const raw = object(value, ["age", "ageApproximate", "ageAsOf", "residenceCountry", "nationalities", "note", "information"]); if (typeof raw.ageApproximate !== "boolean") return fail(); const nationalities = list(raw.nationalities, 12).map(country); if (nationalities.some(value => !value) || new Set(nationalities).size !== nationalities.length) return fail(); return { age: count(raw.age, 130), ageApproximate: raw.ageApproximate, ageAsOf: date(raw.ageAsOf), residenceCountry: country(raw.residenceCountry), nationalities, note: text(raw.note), information: information(raw.information) }; }
export function validateOwnerContext(input: unknown): OwnerContext {
  if (input === undefined) return createOwnerContext();
  const raw = object(input, ["schema", "unlinkedOwners", "organization", "rights", "declaredCount", "owners", "representatives", "primaryContactId", "primaryRole", "sale", "negotiation", "provenance"]);
  if (raw.schema !== 1 || JSON.stringify(raw).length > 200000) return fail();
  const owners = list(raw.owners, 100).map(value => { const owner = object(value, ["contactId", "entityType", "note", "person"]), contactId = text(owner.contactId, 180), entityType = enumeration(owner.entityType, ["person", "company"] as const); if (!contactId || entityType === "company" && owner.person !== undefined) return fail(); return { contactId, entityType, note: text(owner.note), ...(owner.person !== undefined ? { person: person(owner.person) } : {}) }; });
  const representatives = list(raw.representatives, 100).map(value => { const item = object(value, ["contactId", "ownerContactId", "role"]), contactId = text(item.contactId, 180); if (!contactId) return fail(); return { contactId, ownerContactId: text(item.ownerContactId, 180), role: text(item.role, 300) }; });
  if (new Set(owners.map(item => item.contactId)).size !== owners.length || new Set(representatives.map(item => item.contactId)).size !== representatives.length) return fail();
  const sale = object(raw.sale, ["agreement", "reasons", "listedOn", "sellerDeadline", "priceReductions", "pricePosition", "openQuestions", "information"]), reasons = list(sale.reasons, SALE_REASONS.length).map(value => enumeration(value, SALE_REASONS));
  if (new Set(reasons).size !== reasons.length) return fail();
  const negotiation = object(raw.negotiation, ["potential", "justification", "favorablePoints", "blockingPoints", "nextQuestion", "updatedBy", "updatedAt"]), updatedAt = text(negotiation.updatedAt, 60);
  if (updatedAt && (!/^\d{4}-\d{2}-\d{2}T/.test(updatedAt) || !Number.isFinite(Date.parse(updatedAt)))) return fail();
  const provenance = list(raw.provenance, 100).map(value => { const item = object(value, ["field", "filename", "page", "extract", "importedAt"]), field = text(item.field, 120), page = count(item.page, 10000), importedAt = text(item.importedAt, 60); if (page === 0 || !field || !Number.isFinite(Date.parse(importedAt))) return fail(); return { field, filename: text(item.filename, 240), page, extract: text(item.extract), importedAt }; });
  return { schema: 1, unlinkedOwners: text(raw.unlinkedOwners), organization: enumeration(raw.organization, OWNER_ORGANIZATIONS), rights: enumeration(raw.rights, OWNER_RIGHTS), declaredCount: count(raw.declaredCount, 10000), owners, representatives, primaryContactId: text(raw.primaryContactId, 180), primaryRole: text(raw.primaryRole, 300), sale: { agreement: enumeration(sale.agreement, SALE_AGREEMENTS), reasons, listedOn: date(sale.listedOn), sellerDeadline: date(sale.sellerDeadline), priceReductions: text(sale.priceReductions), pricePosition: enumeration(sale.pricePosition, SALE_PRICE_POSITIONS), openQuestions: text(sale.openQuestions), information: information(sale.information) }, negotiation: { potential: enumeration(negotiation.potential, NEGOTIATION_POTENTIALS), justification: text(negotiation.justification), favorablePoints: text(negotiation.favorablePoints), blockingPoints: text(negotiation.blockingPoints), nextQuestion: text(negotiation.nextQuestion), updatedBy: text(negotiation.updatedBy, 180), updatedAt }, provenance };
}
/** Advisory only: retain entered information so partial dossiers can be saved. */
export function ownerContextWarnings(context: OwnerContext, lang: "fr" | "en" = "fr", linkedPersonIds: string[] = []): string[] {
  const messages: string[] = [], t = (fr: string, en: string) => lang === "fr" ? fr : en;
  if (context.organization === "sole" && (context.declaredCount !== null && context.declaredCount !== 1 || context.owners.length > 1)) messages.push(t("Propriétaire unique : le nombre déclaré ou les contacts identifiés sont à vérifier.", "Sole ownership: check the declared count or identified contacts."));
  if (context.organization === "indivision" && context.declaredCount !== null && context.declaredCount < 2) messages.push(t("Indivision : le nombre déclaré est inférieur à deux.", "Joint ownership: the declared count is below two."));
  if (context.declaredCount !== null && context.declaredCount < context.owners.length) messages.push(t("Le nombre de propriétaires identifiés dépasse le nombre déclaré.", "The identified owner count exceeds the declared count."));
  if (context.representatives.some(item => item.ownerContactId && !context.owners.some(owner => owner.contactId === item.ownerContactId))) messages.push(t("Un représentant fait référence à un propriétaire qui n’est plus lié. Vérifiez son rôle.", "A representative refers to an owner who is no longer linked. Check their role."));
  if (context.primaryContactId && !linkedPersonIds.includes(context.primaryContactId) && !context.owners.some(item => item.contactId === context.primaryContactId && item.entityType === "person") && !context.representatives.some(item => item.contactId === context.primaryContactId)) messages.push(t("L’interlocuteur principal n’est pas une personne liée à ce bloc. Vérifiez le lien et le rôle.", "The main contact is not a person linked in this block. Check the link and role."));
  if (context.primaryContactId && !context.primaryRole.trim()) messages.push(t("Précisez le rôle de l’interlocuteur principal.", "Specify the main contact’s role."));
  if (context.sale.reasons.includes("undisclosed") && context.sale.reasons.length > 1) messages.push(t("Le motif est indiqué à la fois comme communiqué et non communiqué.", "The sale reason is marked as both disclosed and undisclosed."));
  return messages;
}
