import { getContactPersonName } from "../contactIdentity";
import type { ContactCreateIntent } from "../contacts/createIntent";
import type { Contact } from "../types";
import type { ContactRole, ProjectContact } from "./contacts";
import type { FonciereData } from "./model";

/** A transient return value. Files and the project editor stay in their mounted host. */
export type ProjectContactReturn = { intentId: string; role: ContactRole; contact?: Contact };

export function projectContactCreateIntent(data: FonciereData, role: ContactRole, knownAgent?: ProjectContact): ContactCreateIntent {
  const knownIdentity = role === "agent" && knownAgent && getContactPersonName(knownAgent) === data.agentName.trim() ? knownAgent : undefined;
  return {
    id: crypto.randomUUID(), origin: "fonciere", role, entityType: role === "agency" ? "company" : "person",
    ...(role === "agent" && data.agentName.trim() && !knownIdentity ? { identityHint: data.agentName } : {}),
    prefill: role === "agency" ? {
      companyName: data.agencyName, email: data.agencyEmail, phone: data.agencyPhone,
      postalAddress: data.agencyAddress, postalAddressDetails: data.agencyAddressDetails,
      city: data.agencyAddressDetails?.city || "",
    } : {
      name: knownIdentity?.name || "", firstName: knownIdentity?.firstName || "",
      companyName: data.agencyName, email: data.agentEmail, phone: data.agentPhone,
      ...(data.agencyContactId ? { companyId: data.agencyContactId } : {}),
      // A person's address cannot be inferred from the property or agency address.
    },
  };
}
