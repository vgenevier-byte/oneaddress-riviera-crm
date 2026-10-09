/** Display/validation only: these helpers never rewrite a stored identity. */
export type ContactIdentity = {
  entityType?: unknown;
  firstName?: unknown;
  name?: unknown;
  companyName?: unknown;
  email?: unknown;
  phone?: unknown;
};

export type ContactIdentityValidation = {
  field: "name" | "companyName" | "entityType";
  code: "contact_name_required" | "contact_company_name_required" | "contact_entity_type_invalid";
};

export function getContactIdentityValidationError(error: unknown): ContactIdentityValidation | null {
  const code = typeof error === "string" ? error
    : error && typeof error === "object" && "message" in error ? error.message : undefined;
  if (code === "contact_name_required") return { field: "name", code };
  if (code === "contact_company_name_required") return { field: "companyName", code };
  if (code === "contact_entity_type_invalid") return { field: "entityType", code };
  return null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getContactPersonName(contact: ContactIdentity): string {
  return [text(contact.firstName), text(contact.name)].filter(Boolean).join(" ");
}

export function getContactLabel(contact: ContactIdentity, fallback = "Contact sans nom"): string {
  const person = getContactPersonName(contact);
  const company = text(contact.companyName);
  return (contact.entityType === "company" ? company || person : person || company)
    || text(contact.email) || text(contact.phone) || fallback;
}

export function getContactSecondaryLabel(contact: ContactIdentity): string {
  const secondary = contact.entityType === "company" ? getContactPersonName(contact) : text(contact.companyName);
  return secondary === getContactLabel(contact) ? "" : secondary;
}

export function validateContactIdentity(
  contact: ContactIdentity,
  { allowUnqualifiedLegacy = false }: { allowUnqualifiedLegacy?: boolean } = {}
): ContactIdentityValidation | null {
  if (contact.entityType !== undefined && contact.entityType !== "person" && contact.entityType !== "company") {
    return { field: "entityType", code: "contact_entity_type_invalid" };
  }
  if (contact.entityType === "company") {
    return text(contact.companyName) ? null : { field: "companyName", code: "contact_company_name_required" };
  }
  if (contact.entityType === undefined && allowUnqualifiedLegacy) return null;
  return text(contact.name) ? null : { field: "name", code: "contact_name_required" };
}
