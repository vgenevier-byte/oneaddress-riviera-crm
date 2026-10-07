import type { Contact } from "./types";

/** Comparison only: never use this search key to assign or merge identities. */
export function normalizeContactSearch(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}+/gu, "").toLocaleLowerCase("fr").trim().replace(/\s+/gu, " ");
}

export function matchesContactSearchFields(query: string, fields: readonly (string | null | undefined)[]): boolean {
  const searchable = normalizeContactSearch(fields.filter(value => value?.trim()).join(" "));
  return normalizeContactSearch(query).split(" ").filter(Boolean).every(token => searchable.includes(token));
}

/** Search only the existing Contacts fields in the caller's authorized projection. */
export function matchesContactSearch(contact: Partial<Contact>, query: string): boolean {
  return matchesContactSearchFields(query, [
    contact.name, contact.firstName, contact.companyName, contact.kind,
    contact.email, contact.phone, contact.city, contact.postalAddress,
    contact.organizationFunction, contact.supplierCategory,
    contact.supplierZone, contact.supplierReliability
  ]);
}
