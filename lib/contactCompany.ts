import type { Contact } from "./types";
import { matchesContactSearch } from "./contactSearch";

type CompanyContact = Partial<Contact> & { id: string };

/** Resolve only explicit persisted IDs, never a name, email or phone match. */
export function getContactCompany<T extends CompanyContact>(contact: CompanyContact, contacts: readonly T[]): T | undefined {
  let id = contact.entityType === "company" ? contact.mergedIntoCompanyId || contact.id : contact.companyId;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const company = contacts.find(row => row.id === id && row.entityType === "company");
    if (!company) return undefined;
    if (!company.mergedIntoCompanyId) return company;
    id = company.mergedIntoCompanyId;
  }
  return undefined;
}

export function getCompanyPeople<T extends CompanyContact>(companyId: string, contacts: readonly T[]): T[] {
  return contacts.filter(row => row.entityType === "person" && row.companyId === companyId);
}

export function getCompanyContactStatus(company: CompanyContact, contacts: readonly CompanyContact[]): "complete" | "needs_contact" {
  const canonical = getContactCompany(company, contacts);
  return canonical && getCompanyPeople(canonical.id, contacts).length ? "complete" : "needs_contact";
}

/** The caller supplies its authorized projection; this never loads more data. */
export function matchesContactWithCompany(contact: CompanyContact, query: string, contacts: readonly CompanyContact[]): boolean {
  if (matchesContactSearch(contact, query, contacts)) return true;
  const company = getContactCompany(contact, contacts);
  if (contact.entityType === "company") {
    return getCompanyPeople(company?.id || contact.id, contacts).some(person =>
      matchesContactSearch(person, query, contacts));
  }
  return false;
}
