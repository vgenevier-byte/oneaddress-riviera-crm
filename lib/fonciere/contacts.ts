import { createContactFieldResolver, matchesContactSearchFields, normalizeContactSearch } from "../contactSearch";
import { createSearchIndex, searchIndex } from "../search";
import { getContactPersonName } from "../contactIdentity";
import type { FonciereData } from "./model";
import { normalizeAddressValue, type AddressValue } from "../address";

/** Only fields from the server-authorized Contacts projection. */
export type ProjectContact = { id: string; entityType?: "person" | "company"; companyId?: string; primaryContactId?: string; mergedIntoCompanyId?: string; name: string; firstName: string; companyName: string; email: string; phone: string; city: string; postalAddress: string; postalAddressDetails?: AddressValue; organizationFunction?: string; supplierCategory?: string; /** Search-only authorized context, never written to a contact. */ searchText?: string };
export type FirstProjectCompanyPerson = Pick<ProjectContact, "name"> & Partial<Omit<ProjectContact, "id" | "name" | "companyId" | "primaryContactId" | "mergedIntoCompanyId">>;
export type ContactCreateInput = Omit<ProjectContact, "id" | "primaryContactId" | "mergedIntoCompanyId"> & {
  firstPerson?: FirstProjectCompanyPerson;
  existingPersonId?: string;
};
export type ContactRole = "agent" | "agency";
export const AGENT_FIELDS = ["agentName", "agentPhone", "agentEmail"] as const;
export const AGENCY_FIELDS = ["agencyName", "agencyAddress", "agencyPhone", "agencyEmail"] as const;
type ContactField = typeof AGENT_FIELDS[number] | typeof AGENCY_FIELDS[number];

/** Comparison only; never used to identify, merge or link a CRM record. */
export function contactPhoneKeys(value: string): string[] {
  const digits = value.replace(/\(0\)/g, "").replace(/\D/g, "").replace(/^00/, "");
  return [...new Set([digits, /^33[1-9]\d{8}$/.test(digits) ? `0${digits.slice(2)}` : /^0[1-9]\d{8}$/.test(digits) ? `33${digits.slice(1)}` : digits])].filter(Boolean);
}

export function matchesProjectContact(contact: ProjectContact, query: string): boolean {
  const fields = [contact.companyName, contact.firstName, contact.name, contact.city, contact.postalAddress, contact.email, contact.phone, contact.organizationFunction, contact.supplierCategory, contact.searchText, ...contactPhoneKeys(contact.phone)];
  if (matchesContactSearchFields(query, fields)) return true;
  // Phone punctuation and spacing are interchangeable, also in a mixed query.
  const chunks = query.match(/[+\d][\d\s().-]{3,}\d/g) || [];
  if (!chunks.length) return false;
  let rest = query;
  for (const chunk of chunks) {
    const keys = contactPhoneKeys(chunk);
    if (!keys.some(key => contactPhoneKeys(contact.phone).some(phone => phone.includes(key)))) return false;
    rest = rest.replace(chunk, " ");
  }
  return matchesContactSearchFields(rest, fields);
}

/** Rank every authorized candidate before the picker applies its presentation cap. */
export function searchProjectContacts(rows: ProjectContact[], query: string): ProjectContact[] {
  const fields = createContactFieldResolver(rows);
  const people = new Map<string, ProjectContact[]>();
  for (const row of rows) if (row.companyId) people.set(row.companyId, [...(people.get(row.companyId) || []), row]);
  const searchableFields = (row: ProjectContact) => [
    ...fields(row), row.searchText, ...contactPhoneKeys(row.phone),
    ...(row.entityType === "company" ? (people.get(row.id) || []).flatMap(person => [...fields(person), ...contactPhoneKeys(person.phone)]) : [])
  ];
  const index = createSearchIndex(rows.filter(row => !row.mergedIntoCompanyId), searchableFields, { getId: row => row.id, getLabel: projectContactLabel });
  return searchIndex(index, query).map(hit => ({ ...hit.item, searchText: searchableFields(hit.item).filter(Boolean).join(" ") }));
}

export function projectContactLabel(contact: ProjectContact): string {
  return [contact.companyName, getContactPersonName(contact), contact.city].filter((value, index, list) => value && list.indexOf(value) === index).join(" — ") || contact.email || contact.phone;
}

export function isAgencyOption(contact: ProjectContact): boolean {
  return !contact.mergedIntoCompanyId && (contact.entityType === "company" || !contact.companyId && Boolean(contact.companyName.trim()));
}

export function contactCompanyMatches(contact: ProjectContact, agencyName: string, agencyId?: string): boolean {
  if (agencyId && contact.companyId) return contact.companyId === agencyId;
  return Boolean(agencyName.trim()) && normalizeContactSearch(contact.companyName) === normalizeContactSearch(agencyName);
}

export function contactValues(role: ContactRole, contact: ProjectContact | null): Partial<Record<ContactField, string>> {
  if (role === "agency") return {
    agencyName: contact?.companyName || "", agencyAddress: contact?.entityType === "company" ? contact.postalAddress : "",
    agencyPhone: contact?.entityType === "company" ? contact.phone : "", agencyEmail: contact?.entityType === "company" ? contact.email : "",
  };
  return { agentName: contact ? getContactPersonName(contact) : "", agentPhone: contact?.phone || "", agentEmail: contact?.email || "" };
}

/** Manual/project/imported values need explicit consent before replacement. */
export function contactReplacementFields(data: FonciereData, role: ContactRole, contact: ProjectContact | null): ContactField[] {
  const values = contactValues(role, contact), baseline = data.contactSources?.[role]?.baseline || {};
  if (role === "agent" && !data.agencyContactId) {
    values.agencyName = contact?.companyName || "";
    if (data.agencyName !== values.agencyName) Object.assign(values, { agencyAddress: "", agencyPhone: "", agencyEmail: "" });
  }
  return (Object.keys(values) as ContactField[]).filter(key => data[key] !== values[key] && Boolean(data[key]) && data[key] !== baseline[key as keyof typeof baseline]);
}

/** Project-local snapshot; the CRM itself is never modified here. */
export function applyProjectContact(data: FonciereData, role: ContactRole, contact: ProjectContact | null): FonciereData {
  const result = structuredClone(data), values = contactValues(role, contact);
  if (role === "agent" && !data.agencyContactId) {
    values.agencyName = contact?.companyName || "";
    // Only the label belongs to a person record. Never copy their address/phone
    // into the company's fields, nor leave coordinates from an old agency.
    if (data.agencyName !== values.agencyName) Object.assign(result, { agencyAddress: "", agencyPhone: "", agencyEmail: "" });
  }
  Object.assign(result, values);
  if (role === "agency") result.agencyAddressDetails = contact?.entityType === "company" && contact.postalAddressDetails ? normalizeAddressValue(contact.postalAddressDetails, result.agencyAddress) : undefined;
  else if (result.agencyAddress !== data.agencyAddress) delete result.agencyAddressDetails;
  result[role === "agent" ? "agentContactId" : "agencyContactId"] = contact && (role === "agent" || contact.entityType === "company") ? contact.id : "";
  result.contactSources = { ...result.contactSources };
  if (contact) result.contactSources[role] = { baseline: values };
  else delete result.contactSources[role];
  return result;
}

export function duplicateProjectContacts(rows: ProjectContact[], input: ContactCreateInput): ProjectContact[] {
  const email = input.email.trim().toLowerCase(), phones = contactPhoneKeys(input.phone);
  return rows.filter(row => email && row.email.trim().toLowerCase() === email || phones.some(phone => phone.length >= 7 && contactPhoneKeys(row.phone).includes(phone)) ||
    input.entityType === "company" && row.entityType === "company" && Boolean(input.companyName.trim()) && normalizeContactSearch(row.companyName) === normalizeContactSearch(input.companyName) ||
    input.entityType !== "company" && row.entityType !== "company" && Boolean(input.name.trim()) && normalizeContactSearch(row.name) === normalizeContactSearch(input.name) && normalizeContactSearch(row.firstName) === normalizeContactSearch(input.firstName) && normalizeContactSearch(row.companyName) === normalizeContactSearch(input.companyName));
}
