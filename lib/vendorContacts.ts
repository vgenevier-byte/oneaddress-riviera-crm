import type { Contact } from "./types";

type SearchableVendorContact = Contact & {
  activity?: string;
  activities?: string[] | string;
  profession?: string;
  prestations?: string[] | string;
  supplierService?: string;
  type?: string;
};

type RankedContact = {
  contact: Contact;
  rank: number;
};

function toSearchableContact(contact: Contact) {
  return contact as SearchableVendorContact;
}

function toValues(value?: string[] | string) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

export function normalizeVendorContactSearch(value?: string | number | null) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getVendorContactPersonName(contact: Contact) {
  const fullName = [contact.firstName, contact.name].filter(Boolean).join(" ").trim();
  return fullName || String(contact.supplierContactName || "").trim();
}

export function getVendorBusinessName(contact: Contact) {
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

function includesQuery(value: string | undefined, query: string) {
  return normalizeVendorContactSearch(value).includes(query);
}

function phoneIncludesQuery(phone: string | undefined, query: string) {
  if (includesQuery(phone, query)) return true;

  const queryDigits = query.replace(/\D/g, "");
  const phoneDigits = String(phone || "").replace(/\D/g, "");
  return queryDigits.length >= 2 && phoneDigits.includes(queryDigits);
}

export function getVendorContactSearchRank(contact: Contact, rawQuery: string) {
  const query = normalizeVendorContactSearch(rawQuery);
  if (query.length < 2) return null;

  const searchableContact = toSearchableContact(contact);
  const companyName = normalizeVendorContactSearch(searchableContact.companyName);

  if (companyName.startsWith(query)) return 0;
  if (companyName.includes(query)) return 1;

  const personFields = [
    searchableContact.firstName,
    searchableContact.name,
    [searchableContact.firstName, searchableContact.name].filter(Boolean).join(" ")
  ];

  if (personFields.some((value) => includesQuery(value, query))) return 2;

  const additionalFields = [
    searchableContact.supplierCategory,
    searchableContact.profession,
    searchableContact.supplierService,
    searchableContact.activity,
    ...toValues(searchableContact.activities),
    ...toValues(searchableContact.prestations),
    searchableContact.email,
    searchableContact.city
  ];

  if (
    additionalFields.some((value) => includesQuery(value, query)) ||
    phoneIncludesQuery(searchableContact.phone, query)
  ) {
    return 3;
  }

  return null;
}

export function searchVendorContacts(contacts: Contact[], rawQuery: string, limit = 10) {
  const query = normalizeVendorContactSearch(rawQuery);
  if (query.length < 2) return [];

  return contacts
    .reduce<RankedContact[]>((matches, contact) => {
      const rank = getVendorContactSearchRank(contact, query);
      if (rank !== null) matches.push({ contact, rank });
      return matches;
    }, [])
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        getVendorBusinessName(left.contact).localeCompare(
          getVendorBusinessName(right.contact),
          "fr",
          { sensitivity: "base" }
        )
    )
    .slice(0, limit)
    .map(({ contact }) => contact);
}
