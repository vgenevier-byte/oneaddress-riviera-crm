import test from "node:test";
import assert from "node:assert/strict";
import { addressFingerprint, formatAddress, googleMapsUrl, manualAddress, type AddressValue } from "../../lib/address";
import { createFonciereData, fromPresentationData, toPresentationData, validateFonciereData } from "../../lib/fonciere/model";
import { applyPropertyAddressInput, editPropertyAddress, propertyAddressDetails, propertyAddressText, selectPropertyAddress } from "../../lib/fonciere/address";
import { applyAgencyImport } from "../../lib/fonciere/import";
import { applyProjectContact, type ProjectContact } from "../../lib/fonciere/contacts";
import { exportProjectJson, importProjectJson, validateProjectData } from "../../lib/izord/model";

function address(patch: Partial<AddressValue> = {}): AddressValue {
  const value: AddressValue = { houseNumber: "1 bis", street: "rue de la Paix", line1: "1 bis rue de la Paix", complement: "Bâtiment A, étage 2", postalCode: "06000", city: "Nice", country: "France", countryCode: "FR", formattedAddress: "", latitude: 43.7, longitude: 7.26, source: "ign", sourceId: "public-fixture", precision: "address", fingerprint: "", ...patch };
  value.formattedAddress = formatAddress(value); value.fingerprint = addressFingerprint(value.formattedAddress); return value;
}

test("property selection fills one structured block, retaining agency and unrelated source data", () => {
  const original = createFonciereData(); Object.assign(original, { name: "Fictif", agencyAddress: "8 rue de l’agence, Monaco", notes: "Instruction d’accès privée" });
  const selected = selectPropertyAddress(original, address());
  assert.equal(selected.propertyAddress, "1 bis rue de la Paix\nBâtiment A, étage 2"); assert.equal(selected.postalCode, "06000"); assert.equal(selected.city, "Nice");
  assert.equal(selected.agencyAddress, original.agencyAddress); assert.equal(selected.notes, original.notes); assert.equal(original.propertyAddress, "");
  assert.equal(propertyAddressText(selected), address().formattedAddress);
  assert.equal(selected.guided.values.coordinates, undefined);
  assert.deepEqual(validateFonciereData(selected).propertyAddressDetails, address());
  assert.match(googleMapsUrl(propertyAddressText(selected), propertyAddressDetails(selected)), /query=43.7%2C7.26/);
});

test("manual locality or street correction invalidates geocode and never attaches old locality to a replacement", () => {
  const first = selectPropertyAddress(createFonciereData(), address());
  const edited = editPropertyAddress(first, "city", "Monaco");
  assert.equal(edited.propertyAddressDetails?.source, "manual"); assert.equal(edited.propertyAddressDetails?.latitude, undefined); assert.equal(edited.propertyAddressDetails?.sourceId, undefined); assert.equal(edited.guided.values.coordinates, undefined);
  assert.equal(edited.propertyAddressDetails?.complement, first.propertyAddressDetails?.complement); assert.equal(edited.propertyAddressDetails?.country, "France");
  assert.ok(!googleMapsUrl(propertyAddressText(edited), edited.propertyAddressDetails).includes("43.7"));
  const next = selectPropertyAddress(first, address({ line1: "Rue sans numéro", houseNumber: "", street: "Rue sans numéro", postalCode: "", city: "", complement: "", precision: "street", latitude: undefined, longitude: undefined }));
  assert.equal(next.city, ""); assert.equal(next.postalCode, ""); assert.equal(next.guided.values.locationPrecision, "approximate"); assert.equal(next.guided.values.coordinates, undefined);
  first.city = "Luxembourg";
  assert.equal(validateFonciereData({ ...first, name: "Fictif" }).propertyAddressDetails, undefined);
});

test("free-text historical addresses and text postal codes stay intact without invented metadata", () => {
  const data = createFonciereData(); Object.assign(data, { name: "Fictif", propertyAddress: "Résidence libre / entrée arrière", city: "Luxembourg", postalCode: "L-0012", agencyAddress: "Adresse historique\nMonaco" });
  const normalized = validateFonciereData(data);
  assert.equal(normalized.propertyAddressDetails, undefined); assert.equal(normalized.agencyAddressDetails, undefined);
  assert.equal(normalized.postalCode, "L-0012"); assert.equal(normalized.propertyAddress, data.propertyAddress);
  assert.equal(fromPresentationData(toPresentationData(data)).agencyAddress, data.agencyAddress);
});

test("manual international property entry preserves country and complement without splitting free text", () => {
  const initial = createFonciereData(); initial.name = "Fictif"; initial.city = "Luxembourg"; initial.postalCode = "L-0012";
  const entered = { ...manualAddress("Résidence libre\nAppartement 4", "Appartement 4"), country: "Luxembourg" };
  const result = validateFonciereData(applyPropertyAddressInput(initial, entered));
  assert.equal(result.propertyAddress, "Résidence libre\nAppartement 4"); assert.equal(result.propertyAddressDetails?.country, "Luxembourg");
  assert.equal(result.propertyAddressDetails?.complement, "Appartement 4"); assert.equal(result.propertyAddressDetails?.latitude, undefined);
  assert.equal(result.postalCode, "L-0012"); assert.equal(fromPresentationData(toPresentationData(result)).propertyAddressDetails?.country, "Luxembourg");
});

test("presentation JSON round trip retains independent structured address snapshots and source revision", () => {
  const data = selectPropertyAddress(createFonciereData(), address()); data.name = "Fictif";
  data.agencyAddressDetails = address({ line1: "8 avenue de l’agence", complement: "", city: "Cannes", postalCode: "06400", latitude: 43.55 }); data.agencyAddress = data.agencyAddressDetails.formattedAddress;
  const presentation = toPresentationData(data, { id: "source-projet", revision: 4 });
  const restoredJson = importProjectJson(exportProjectJson(presentation));
  assert.deepEqual(restoredJson.addressDetails, data.propertyAddressDetails);
  assert.equal((restoredJson.importMeta?.fonciereSource as { revision: number }).revision, 4);
  const restored = fromPresentationData(restoredJson);
  assert.deepEqual(restored.propertyAddressDetails, data.propertyAddressDetails); assert.deepEqual(restored.agencyAddressDetails, data.agencyAddressDetails);
  data.propertyAddress = "Autre rue"; assert.equal(presentation.state.address, address().formattedAddress);
  restoredJson.state.address = "Adresse corrigée manuellement à Monaco";
  const edited = fromPresentationData(validateProjectData(restoredJson));
  assert.equal(edited.propertyAddressDetails, undefined); assert.equal(edited.city, ""); assert.equal(edited.agencyAddress, data.agencyAddress);
});

test("agency selection copies only authorized company address; imported changes invalidate prior property metadata", () => {
  const initial = selectPropertyAddress(createFonciereData(), address()); initial.name = "Fictif";
  const company: ProjectContact = { id: "authorized-company", entityType: "company", name: "", firstName: "", companyName: "Agence", email: "", phone: "", city: "Nice", postalAddress: address().formattedAddress, postalAddressDetails: address() };
  const linked = applyProjectContact(initial, "agency", company);
  assert.deepEqual(linked.agencyAddressDetails, address()); assert.deepEqual(linked.propertyAddressDetails, initial.propertyAddressDetails);
  assert.equal(company.postalAddress, address().formattedAddress);
  const imported = createFonciereData(); imported.propertyAddress = "Nouvelle adresse extraite";
  const applied = applyAgencyImport(linked, imported, ["propertyAddress"]);
  assert.equal(applied.propertyAddressDetails, undefined); assert.equal(applied.guided.values.coordinates, undefined);
  assert.equal(applied.agencyAddress, linked.agencyAddress); assert.deepEqual(applied.agencyAddressDetails, linked.agencyAddressDetails);
});

test("address selection, manual changes and reimport preserve historical business coordinates without projecting them", () => {
  const historical = createFonciereData(); historical.name = "Ancienne fiche"; historical.notes = "Note conservée";
  historical.guided.values.coordinates = { latitude: 41.9, longitude: 12.5 };
  historical.guided.details.coordinates = "Ancienne précision conservée";
  const legacy = structuredClone(historical.guided);
  const selected = selectPropertyAddress(historical, address());
  assert.deepEqual(selected.guided.values.coordinates, legacy.values.coordinates);
  assert.equal(selected.propertyAddressDetails?.latitude, 43.7);
  const manual = editPropertyAddress(selected, "city", "Monaco");
  assert.deepEqual(manual.guided.values.coordinates, legacy.values.coordinates);
  assert.equal(manual.propertyAddressDetails?.latitude, undefined);
  const incoming = createFonciereData(); incoming.propertyAddress = "Adresse importée";
  const imported = applyAgencyImport(manual, incoming, ["propertyAddress"]);
  const saved = validateFonciereData(JSON.parse(JSON.stringify(imported)));
  assert.deepEqual(saved.guided.values.coordinates, legacy.values.coordinates);
  assert.equal(saved.guided.details.coordinates, legacy.details.coordinates);
  assert.equal(saved.notes, historical.notes);
  assert.doesNotMatch(String(toPresentationData(saved).state.environment), /Latitude|Longitude|41[.,]9|12[.,]5|Ancienne précision/);
});
