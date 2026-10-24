import type { Contact } from "./types";
import { getContactLabel, getContactPersonName } from "./contactIdentity";
import { createContactFieldResolver, normalizeContactSearch } from "./contactSearch";
import { createSearchIndex, searchIndex } from "./search";

type SearchableVendorContact = Contact & {
  activity?: string;
  activities?: string[] | string;
  profession?: string;
  prestations?: string[] | string;
  supplierService?: string;
  type?: string;
};

function toSearchableContact(contact: Contact) {
  return contact as SearchableVendorContact;
}

function toValues(value?: string[] | string) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

export function normalizeVendorContactSearch(value?: string | number | null) {
  return normalizeContactSearch(String(value ?? ""));
}

export function getVendorContactPersonName(contact: Contact) {
  const fullName = getContactPersonName(contact);
  return fullName || String(contact.supplierContactName || "").trim();
}

export function getVendorBusinessName(contact: Contact) {
  if (contact.entityType !== undefined) return getContactLabel(contact);
  return (
    String(contact.companyName || "").trim() ||
    getVendorContactPersonName(contact) ||
    String(contact.email || "").trim() ||
    String(contact.phone || "").trim() ||
    "Contact sans nom"
  );
}

export function getVendorContactProfession(contact: Contact) {
  const searchableContact = toSearchableContact(contact);
  return String(
    searchableContact.supplierCategory ||
    searchableContact.profession ||
    searchableContact.supplierService ||
    searchableContact.activity ||
    toValues(searchableContact.activities)[0] ||
    toValues(searchableContact.prestations)[0] ||
    ""
  ).trim();
}

export function isEligibleVendorContact(contact: Contact) {
  const searchableContact = toSearchableContact(contact);
  const kind = normalizeVendorContactSearch(searchableContact.kind || searchableContact.type);
  // The explicit member classification wins over preserved supplier history.
  if (kind === normalizeVendorContactSearch("Membre de l’organisation")) return false;
  const relationshipStatus = normalizeVendorContactSearch(searchableContact.relationshipStatus);
  const hasVendorDetails = Boolean(
    getVendorContactProfession(contact) ||
    searchableContact.supplierContactName ||
    relationshipStatus === "prestataire"
  );

  return (
    kind === "prestataire" ||
    kind === "partenaire" ||
    kind === "proprietaire" ||
    hasVendorDetails
  );
}

// Historical bank records remain manageable after a business reclassification.
export function isEligibleVendorBankContact(contact: Contact) {
  return isEligibleVendorContact(contact) || Boolean(contact.supplierBankAccounts?.length);
}

/** Build linked-company context once for the same authorized picker projection. */
export function createVendorContactFieldResolver(authorizedContacts: Contact[] = []) {
  const fields = createContactFieldResolver(authorizedContacts);
  return (contact: Contact) => {
    const extra = toSearchableContact(contact);
    return [...fields(contact), extra.profession, extra.supplierService, extra.activity,
      ...toValues(extra.activities), ...toValues(extra.prestations), (contact as Contact & { searchText?: string }).searchText];
  };
}

export function vendorContactSearchFields(contact: Contact, authorizedContacts: Contact[] = []) {
  return createVendorContactFieldResolver(authorizedContacts)(contact);
}

export function getVendorContactSearchRank(contact: Contact, rawQuery: string) {
  const index = createSearchIndex([contact], row => vendorContactSearchFields(row), { getId: row => row.id, getLabel: getVendorBusinessName });
  return searchIndex(index, rawQuery, { limit: 1 })[0]?.score ?? null;
}

export function searchVendorContacts(contacts: Contact[], rawQuery: string, limit = 10) {
  const index = createSearchIndex(contacts, createVendorContactFieldResolver(contacts), { getId: row => row.id, getLabel: getVendorBusinessName });
  return searchIndex(index, rawQuery, { limit }).map(hit => hit.item);
}
