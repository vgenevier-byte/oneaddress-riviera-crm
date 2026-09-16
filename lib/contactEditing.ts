import type { Contact } from "./types";

export function readPostalAddress(form: FormData, existing = ""): string {
  return form.has("postalAddress") ? String(form.get("postalAddress") ?? "") : existing;
}

// Merge into the current record so partial updates retain unrelated properties.
export function mergeContactUpdate(contact: Contact, update: Partial<Contact>): Contact {
  return {
    ...contact,
    ...update,
    id: contact.id,
    postalAddress: update.postalAddress ?? contact.postalAddress
  };
}

export function getContactFormUpdate(values: Contact, changedFields: Iterable<string>): Partial<Contact> {
  const fields = new Set(changedFields);
  if (fields.has("supplierCategoryCustom")) fields.add("supplierCategory");
  if (fields.has("kind")) {
    fields.add("relationshipStatus");
    // A retained category would still classify a Client/Propriétaire as a supplier.
    if (values.kind !== "Prestataire") fields.add("supplierCategory");
  }
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => key !== "id" && fields.has(key))
  ) as Partial<Contact>;
}
