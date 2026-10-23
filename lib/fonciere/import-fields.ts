import type { FonciereField } from "./model";

/** No contact identity or financial personal hypothesis is assigned by an import. */
export const AGENCY_FIELD_MAP: Partial<Record<FonciereField, string>> = {
  name: "project", propertyType: "type", agencyReference: "ref", propertyAddress: "address", city: "city", postalCode: "postalCode", location: "location",
  agencyName: "agencyName", agencyAddress: "agencyAddress", agencyPhone: "agencyPhone", agencyEmail: "agencyEmail", agentName: "agentName", agentPhone: "agentPhone", agentEmail: "agentEmail",
  askingPrice: "asking", fees: "fees", area: "area", areaKind: "areaKind", land: "land", rooms: "rooms", bedrooms: "bedrooms", condition: "condition", equipment: "equipment", annexes: "annexes", exterior: "exterior", pool: "pool", view: "view",
  description: "description", agencyPotential: "agencyPotential", renovation: "renovation", division: "division", extension: "extension", resale: "resale", rental: "rental", pointsOfInterest: "pointsOfInterest", pointsToVerify: "pointsToVerify", diagnostics: "diagnostics", charges: "charges", constraints: "constraints",
};
