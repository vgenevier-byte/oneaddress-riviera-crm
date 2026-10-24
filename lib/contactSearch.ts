import type { Contact } from "./types";
import { matchesSearchFields } from "./search";

/** Historical comparison contract also used by identity guards: keep punctuation literal.
 * Flexible presentation search uses normalizeSearch inside the shared search engine. */
export function normalizeContactSearch(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}+/gu, "").toLocaleLowerCase("fr").trim().replace(/\s+/gu, " ");
}

export function matchesContactSearchFields(query: string, fields: readonly (string | null | undefined)[]): boolean {
  return matchesSearchFields(query, fields);
}

function ownContactSearchFields(contact: Partial<Contact>): (string | undefined)[] {
  return [contact.name, contact.firstName, contact.companyName, contact.kind, contact.email, contact.phone,
    contact.city, contact.postalAddress, contact.organizationFunction, contact.supplierContactName,
    contact.supplierCategory, contact.supplierZone, contact.supplierReliability];
}

/** Resolve persistent company IDs from only the caller's authorized projection, once per index. */
export function createContactFieldResolver(authorizedContacts: readonly Partial<Contact>[] = []) {
  const companies = new Map(authorizedContacts.filter(contact => contact.entityType === "company" && contact.id)
    .map(contact => [contact.id!, contact]));
  const resolved = new Map<string, Partial<Contact> | undefined>();
  function canonicalCompany(id: string): Partial<Contact> | undefined {
    if (resolved.has(id)) return resolved.get(id);
    const seen = new Set<string>();
    let company = companies.get(id);
    while (company?.mergedIntoCompanyId) {
      if (seen.has(company.id!)) { company = undefined; break; }
      seen.add(company.id!);
      company = companies.get(company.mergedIntoCompanyId);
    }
    resolved.set(id, company);
    return company;
  }
  const peopleByCompany = new Map<string, Partial<Contact>[]>();
  for (const person of authorizedContacts) {
    if (!person.companyId || person.entityType === "company") continue;
    const company = canonicalCompany(person.companyId);
    if (!company?.id) continue;
    const people = peopleByCompany.get(company.id) ?? [];
    people.push(person);
    peopleByCompany.set(company.id, people);
  }
  return (contact: Partial<Contact>): (string | undefined)[] => {
    const fields = ownContactSearchFields(contact);
    const company = canonicalCompany(contact.entityType === "company" ? contact.mergedIntoCompanyId || contact.id || "" : contact.companyId || "");
    if (company && company !== contact) fields.push(...ownContactSearchFields(company));
    if (contact.entityType === "company") {
      for (const person of peopleByCompany.get(company?.id || contact.id || "") ?? []) fields.push(...ownContactSearchFields(person));
    }
    return fields;
  };
}

/** Authorized comparison text only. Notes, banking details and documents are deliberately excluded. */
export function contactSearchText(contact: Partial<Contact>, authorizedContacts: readonly Partial<Contact>[] = []): string {
  return normalizeContactSearch(createContactFieldResolver(authorizedContacts)(contact).filter(Boolean).join(" "));
}

/** Suggestions only: this never assigns a link, changes a value, or fetches additional records. */
export function matchesContactSearch(contact: Partial<Contact>, query: string, authorizedContacts: readonly Partial<Contact>[] = []): boolean {
  return matchesSearchFields(query, createContactFieldResolver(authorizedContacts)(contact));
}
