import type { Contact } from "./types";
import { addressFingerprint, manualAddress, normalizeAddressValue } from "./address";

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
  for (const field of ["companyId", "primaryContactId", "mergedIntoCompanyId"] as const) {
    if (update[field] === undefined) {
      if (contact[field] !== undefined) merged[field] = contact[field];
      else delete merged[field];
    }
  }
  if (contact.postalAddressDetails !== undefined || update.postalAddressDetails !== undefined) {
    const details = normalizeAddressValue(update.postalAddressDetails ?? contact.postalAddressDetails, merged.postalAddress);
    const cityChanged = update.city !== undefined && update.city !== contact.city;
    merged.postalAddressDetails = details && cityChanged && details.city && addressFingerprint(details.city) !== addressFingerprint(merged.city)
      ? manualAddress(merged.postalAddress, details.complement) : details;
    if (!merged.postalAddressDetails) delete merged.postalAddressDetails;
  }
  return merged;
}

export function getContactFormUpdate(values: Contact, changedFields: Iterable<string>): Partial<Contact> {
  const fields = new Set(changedFields);
  if ((fields.has("postalAddress") || fields.has("city")) && values.postalAddressDetails) fields.add("postalAddressDetails");
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
