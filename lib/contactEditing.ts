import type { Contact } from "./types";

export function readPostalAddress(form: FormData, existing = ""): string {
  return form.has("postalAddress") ? String(form.get("postalAddress") ?? "") : existing;
}

// Merge into the current record so partial updates retain unrelated properties.
export function mergeContactUpdate(contact: Contact, update: Partial<Contact>): Contact {
  const merged = {
    ...contact,
    ...update,
    id: contact.id,
    postalAddress: update.postalAddress ?? contact.postalAddress
  };
  // Old clients/projections may omit the new field; omission is not deletion.
  if (update.entityType === undefined) {
    if (contact.entityType !== undefined) merged.entityType = contact.entityType;
    else delete merged.entityType;
  }
  return merged;
}

export function getContactFormUpdate(values: Contact, changedFields: Iterable<string>): Partial<Contact> {
  const fields = new Set(changedFields);
  if (fields.has("supplierCategoryCustom")) fields.add("supplierCategory");
  if (fields.has("kind") && values.kind !== "Membre de l’organisation") {
    fields.add("relationshipStatus");
    // A retained category would still classify a Client/Propriétaire as a supplier.
    if (values.kind !== "Prestataire") fields.add("supplierCategory");
  }
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => key !== "id" && fields.has(key))
  ) as Partial<Contact>;
}
