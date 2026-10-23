import assert from "node:assert/strict";
import test from "node:test";
import { addressFingerprint, formatAddress, type AddressValue } from "../../lib/address";
import { projectContactCreateIntent } from "../../lib/fonciere/contactCreation";
import { createFonciereData } from "../../lib/fonciere/model";
import type { ProjectContact } from "../../lib/fonciere/contacts";

function agencyAddress(): AddressValue {
  const value: AddressValue = { houseNumber: "8", street: "avenue de l’Agence", line1: "8 avenue de l’Agence", complement: "Bâtiment B", city: "Cannes", postalCode: "06400", country: "France", countryCode: "FR", source: "ign", sourceId: "fixture-agency", latitude: 43.55, longitude: 7.01, precision: "address", formattedAddress: "", fingerprint: "" };
  value.formattedAddress = formatAddress(value); value.fingerprint = addressFingerprint(value.formattedAddress); return value;
}

test("agency creation carries only agency coordinates and complete independent address metadata", () => {
  const data = createFonciereData();
  Object.assign(data, { agencyName: "Agence Saint-Pierre", agencyEmail: "agency@example.invalid", agencyPhone: "04 00 00 00 00", agencyAddressDetails: agencyAddress(), propertyAddress: "Autre adresse du bien", city: "Nice", agentEmail: "person@example.invalid", agentPhone: "06 00 00 00 00" });
  data.agencyAddress = data.agencyAddressDetails!.formattedAddress;
  const before = structuredClone(data), result = projectContactCreateIntent(data, "agency");
  assert.equal(result.origin, "fonciere"); assert.equal(result.role, "agency"); assert.equal(result.entityType, "company");
  assert.deepEqual(result.prefill, { companyName: data.agencyName, email: data.agencyEmail, phone: data.agencyPhone, postalAddress: data.agencyAddress, postalAddressDetails: data.agencyAddressDetails, city: "Cannes" });
  assert.equal(result.identityHint, undefined); assert.deepEqual(data, before);
  assert.equal("name" in result.prefill, false); assert.equal("firstName" in result.prefill, false);
});

test("ambiguous compound person label remains a verbatim hint without invented first or last name", () => {
  const data = createFonciereData();
  Object.assign(data, { agentName: "  Jean-Pierre de La Tour  ", agencyName: "Agence Saint-Pierre", agentEmail: "person@example.invalid", agentPhone: "+33 6 00 00 00 00", agencyEmail: "agency@example.invalid", agencyPhone: "04 00 00 00 00", agencyAddress: "Adresse agence", agencyAddressDetails: agencyAddress(), propertyAddress: "Adresse du bien" });
  const intent = projectContactCreateIntent(data, "agent");
  assert.equal(intent.entityType, "person"); assert.equal(intent.identityHint, data.agentName);
  assert.equal(intent.prefill.firstName, ""); assert.equal(intent.prefill.name, "");
  assert.equal(intent.prefill.companyName, data.agencyName); assert.equal(intent.prefill.email, data.agentEmail); assert.equal(intent.prefill.phone, data.agentPhone);
  assert.equal(intent.prefill.postalAddress, undefined); assert.equal(intent.prefill.postalAddressDetails, undefined); assert.equal(intent.prefill.city, undefined);
});

test("reliable linked compound identity is reused only while its complete display matches the project", () => {
  const known: ProjectContact = { id: "canonical-person", entityType: "person", firstName: "Jean-Pierre", name: "de La Tour", companyName: "Ancienne agence", email: "old@example.invalid", phone: "", city: "Ville personnelle", postalAddress: "Domicile personnel", postalAddressDetails: agencyAddress() };
  const data = createFonciereData(); Object.assign(data, { agentName: "Jean-Pierre de La Tour", agencyName: "Agence corrigée", agentEmail: "corrected@example.invalid", agentPhone: "06 11 22 33 44" });
  const matched = projectContactCreateIntent(data, "agent", known);
  assert.equal(matched.identityHint, undefined); assert.equal(matched.prefill.firstName, "Jean-Pierre"); assert.equal(matched.prefill.name, "de La Tour");
  assert.equal(matched.prefill.email, data.agentEmail); assert.equal(matched.prefill.companyName, data.agencyName); assert.equal(matched.prefill.postalAddress, undefined);
  data.agentName = "Jean-Pierre autre identité";
  const changed = projectContactCreateIntent(data, "agent", known);
  assert.equal(changed.identityHint, data.agentName); assert.equal(changed.prefill.name, ""); assert.equal(changed.prefill.firstName, "");
});

test("distinct explicit intents do not reuse a consumed request or invent a business classification", () => {
  const data = createFonciereData(); data.agencyName = "Agence";
  const first = projectContactCreateIntent(data, "agency"), second = projectContactCreateIntent(data, "agency");
  assert.notEqual(first.id, second.id); assert.match(first.id, /^[0-9a-f-]{36}$/);
  assert.equal("kind" in first.prefill, false); assert.equal("supplierCategory" in first.prefill, false);
});
