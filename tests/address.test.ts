import assert from "node:assert/strict";
import { test } from "node:test";
import { addressCountryCode, addressDisplayText, addressFingerprint, formatAddress, googleMapsUrl, manualAddress, normalizeAddressForDisplay, normalizeAddressValue, readAddressForm, type AddressValue } from "../lib/address";
import { ignAddressProvider, ignCoversCountry, parseIgnSelection, parseIgnSuggestions } from "../lib/addressProvider";

const candidate = { x: 6.973127, y: 43.550842, country: "StreetAddress", city: "Cannes", kind: "housenumber", zipcode: "06150", street: "Rue de la Libération", fulltext: "12 Rue de la Libération, 06150 Cannes" };
const completion = { status: "OK", results: [candidate] };
const feature = { type: "Feature", geometry: { type: "Point", coordinates: [candidate.x, candidate.y] }, properties: {
  housenumber: "12", street: candidate.street, name: "12 Rue de la Libération", label: "12 Rue de la Libération 06150 Cannes", postcode: "06150", city: "Cannes", id: "06029_2045_00012", banId: "test-ban-id", type: "housenumber",
} };
const suggestion = parseIgnSuggestions(completion)[0];
const selected = () => parseIgnSelection({ features: [feature] }, suggestion);

test("IGN uses provider components, textual postal code and explicit precision", () => {
  assert.equal(suggestion.label, "12 Rue de la Libération, 06150 Cannes, France");
  const value = selected();
  assert.equal(value.houseNumber, "12"); assert.equal(value.postalCode, "06150"); assert.equal(value.countryCode, "FR");
  assert.equal(value.sourceId, "test-ban-id"); assert.equal(value.precision, "address");
  assert.equal(value.latitude, 43.550842); assert.equal(value.longitude, 6.973127);
  assert.equal(value.formattedAddress, "12 Rue de la Libération\n06150 Cannes\nFrance");
});

test("selection rejects geocode for another city, precision or location instead of guessing", () => {
  for (const replacement of [
    { ...feature, properties: { ...feature.properties, city: "Nice" } },
    { ...feature, properties: { ...feature.properties, type: "street", housenumber: undefined } },
    { ...feature, geometry: { type: "Point", coordinates: [7.2, 43.7] } },
    { ...feature, geometry: { type: "Point", coordinates: [candidate.x + 0.00001, candidate.y + 0.00001] }, properties: { ...feature.properties, housenumber: "12 bis", name: "12 bis Rue de la Libération", label: "12 bis Rue de la Libération 06150 Cannes" } },
  ]) assert.throws(() => parseIgnSelection({ features: [replacement] }, suggestion), /could not be confirmed/);
});

test("street and municipality results do not fabricate a house number", () => {
  const streetSuggestion = { ...suggestion, kind: "street" };
  const street = parseIgnSelection({ features: [{ ...feature, properties: { ...feature.properties, type: "street", housenumber: undefined, name: candidate.street, label: "Rue de la Libération 06150 Cannes" } }] }, { ...streetSuggestion, label: "Rue de la Libération, 06150 Cannes, France" });
  assert.equal(street.houseNumber, ""); assert.equal(street.precision, "street"); assert.equal(street.line1, candidate.street);
  const municipality = parseIgnSelection({ features: [{ ...feature, properties: { city: "Cannes", postcode: "06150", type: "municipality" } }] }, { ...suggestion, kind: "municipality", label: "Cannes, 06150 Cannes, France" });
  assert.equal(municipality.line1, ""); assert.equal(municipality.precision, "city");
  assert.equal(municipality.formattedAddress, "06150 Cannes\nFrance");
});

test("number suffixes and postcode letters/spaces are kept verbatim", () => {
  const value: AddressValue = { ...selected(), houseNumber: "12 bis–14 ter", postalCode: "L-0012 AB", complement: "Bâtiment B, appartement 03" };
  value.line1 = `${value.houseNumber} ${value.street}`; value.formattedAddress = formatAddress(value);
  assert.equal(normalizeAddressValue(value)?.houseNumber, "12 bis–14 ter");
  assert.equal(normalizeAddressValue(value)?.postalCode, "L-0012 AB");
  assert.ok(value.formattedAddress.includes("Bâtiment B, appartement 03"));
});

test("manual edits remove old geocode/source and old structured address while keeping complement", () => {
  const old = { ...selected(), complement: "Bâtiment B" };
  const next = normalizeAddressValue(old, "7 chemin Nouveau\nMC 98000 Monaco");
  assert.equal(next?.source, "manual"); assert.equal(next?.latitude, undefined); assert.equal(next?.sourceId, undefined);
  assert.equal(next?.postalCode, ""); assert.equal(next?.city, ""); assert.equal(next?.houseNumber, "");
  assert.equal(next?.complement, "Bâtiment B"); assert.equal(next?.formattedAddress, "7 chemin Nouveau\nMC 98000 Monaco");
  assert.equal(normalizeAddressValue(old, ""), undefined);
});

test("full and line1 fields keep independent visible values and complete metadata", () => {
  const value = selected(); value.complement = "Entrée B"; value.formattedAddress = formatAddress(value);
  const line = addressDisplayText(value, "line1");
  assert.equal(line, "12 Rue de la Libération\nEntrée B");
  assert.equal(normalizeAddressForDisplay(value, line, "line1")?.sourceId, "test-ban-id");
  assert.equal(normalizeAddressForDisplay(value, "Autre rue", "line1")?.source, "manual");
  assert.equal(normalizeAddressValue(value, value.formattedAddress)?.complement, "Entrée B");
});

test("FormData saves/reloads metadata, tolerates malformed metadata and preserves historical free text", () => {
  const value = selected(), form = new FormData();
  form.set("postalAddress", value.formattedAddress); form.set("postalAddressDetails", JSON.stringify(value));
  assert.deepEqual(readAddressForm(form, "postalAddress"), value);
  form.set("postalAddress", "Adresse historique, sans structure\nRésidence privée");
  assert.equal(readAddressForm(form, "postalAddress")?.source, "manual");
  form.set("postalAddressDetails", "{invalid");
  assert.equal(readAddressForm(form, "postalAddress")?.formattedAddress, "Adresse historique, sans structure\nRésidence privée");
  form.set("postalAddress", ""); assert.equal(readAddressForm(form, "postalAddress"), undefined);
});

test("Maps uses current coherent coordinates, then the current edited text", () => {
  const value = selected();
  assert.equal(new URL(googleMapsUrl(value.formattedAddress, value)).searchParams.get("query"), "43.550842,6.973127");
  const edited = "1 Rue Exemple\nL-0100 Luxembourg";
  const link = new URL(googleMapsUrl(edited, value));
  assert.equal(link.origin, "https://www.google.com"); assert.equal(link.searchParams.get("api"), "1"); assert.equal(link.searchParams.get("query"), edited);
  assert.equal(googleMapsUrl(" ", value), "");
});

test("only France is claimed as covered, international manual text remains intact", async () => {
  assert.equal(ignCoversCountry("FR"), true); assert.equal(ignCoversCountry("France"), true);
  for (const country of ["Monaco", "MC", "Luxembourg", "LU", "United Kingdom"]) {
    assert.equal(ignCoversCountry(country), false);
    assert.deepEqual(await ignAddressProvider.search("12 rue", { country }), []);
  }
  const address = "12 Straße, appartement 東京\nL-0012 Luxembourg";
  assert.equal(manualAddress(address).formattedAddress, address);
});

test("explicit manual country and code persist through text edits, FormData and reload", () => {
  for (const [country, code] of [["France", "FR"], ["Monaco", "MC"], ["Luxembourg", "LU"], ["de", "DE"], ["Unknown country", ""]]) {
    const address = `Adresse manuelle\n${country}`, metadata = manualAddress(address, "Entrée B", country);
    assert.equal(addressCountryCode(country), code); assert.equal(metadata.countryCode, code);
    const form = new FormData(); form.set("address", address); form.set("addressDetails", JSON.stringify(metadata));
    const reloaded = normalizeAddressValue(readAddressForm(form, "address"), address);
    assert.equal(reloaded?.country, country); assert.equal(reloaded?.countryCode, code);
    assert.equal(reloaded?.latitude, undefined); assert.equal(reloaded?.sourceId, undefined);
  }
});

test("provider sends a raw query, ranks city matches and forwards cancellation without cookies", async () => {
  const originalFetch = globalThis.fetch, requests: { url: URL; init?: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    return Response.json({ results: [
      { ...candidate, city: "Paris", fulltext: "12 rue de Paris 75001 Paris" },
      candidate,
    ] });
  };
  try {
    const controller = new AbortController();
    const found = await ignAddressProvider.search("12 rue de Paris", { city: "Cannes", signal: controller.signal });
    assert.equal(requests[0].url.origin, "https://data.geopf.fr");
    assert.equal(requests[0].url.pathname, "/geocodage/completion/");
    assert.equal(requests[0].url.searchParams.get("text"), "12 rue de Paris");
    assert.equal(requests[0].init?.signal, controller.signal); assert.equal(requests[0].init?.credentials, "omit");
    assert.equal(found[0].city, "Cannes"); assert.equal(found[1].city, "Paris");
  } finally { globalThis.fetch = originalFetch; }
});

test("provider failures are surfaced for manual fallback, without returning a guessed address", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("Too many requests", { status: 429 });
  try { await assert.rejects(ignAddressProvider.search("12 rue"), /429/); }
  finally { globalThis.fetch = originalFetch; }
});

test("fingerprint ignores harmless whitespace and casing only", () => {
  assert.equal(addressFingerprint(" 12 RUE Exemple\n06150 Cannes "), addressFingerprint("12 rue Exemple 06150 Cannes"));
  assert.notEqual(addressFingerprint("12 rue Exemple"), addressFingerprint("14 rue Exemple"));
});
