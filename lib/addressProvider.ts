import { addressFingerprint, formatAddress, type AddressValue } from "./address";

export type AddressSuggestion = {
  key: string;
  label: string;
  street: string;
  city: string;
  postalCode: string;
  kind: string;
  latitude?: number;
  longitude?: number;
};
export type AddressSearchOptions = { signal?: AbortSignal; country?: string; city?: string };
export interface AddressProvider {
  id: string;
  attribution: string;
  coversCountry(country?: string): boolean;
  search(query: string, options?: AddressSearchOptions): Promise<AddressSuggestion[]>;
  resolve(suggestion: AddressSuggestion, options?: AddressSearchOptions): Promise<AddressValue>;
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const coordinate = (value: unknown, max: number) => { const result = number(value); return result !== undefined && Math.abs(result) <= max ? result : undefined; };
const countryKey = (country = "") => country.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const selectionLabel = (label: string) => label.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[,\s]+/g, " ").trim();

export function ignCoversCountry(country?: string) {
  return ["", "fr", "fra", "france", "france metropolitaine", "french republic", "republique francaise"].includes(countryKey(country));
}

export function parseIgnSuggestions(payload: unknown): AddressSuggestion[] {
  const results = object(payload).results;
  if (!Array.isArray(results)) return [];
  const seen = new Set<string>();
  return results.flatMap((raw) => {
    const item = object(raw), label = text(item.fulltext);
    if (!label || seen.has(label)) return [];
    seen.add(label);
    return [{ key: `${label}:${item.x}:${item.y}`, label: `${label}, France`, street: text(item.street), city: text(item.city),
      postalCode: text(item.zipcode), kind: text(item.kind), latitude: coordinate(item.y, 90), longitude: coordinate(item.x, 180) }];
  }).slice(0, 5);
}

/** Completion has no structured house number: resolve only the explicitly selected location. */
export function parseIgnSelection(payload: unknown, suggestion: AddressSuggestion): AddressValue {
  const features = object(payload).features;
  const matching = Array.isArray(features) ? features.map(raw => {
    const item = object(raw), properties = object(item.properties), geometry = object(item.geometry);
    const coords = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
    return { properties, latitude: coordinate(coords[1], 90), longitude: coordinate(coords[0], 180) };
  }).find(item => {
    const cityMatches = addressFingerprint(text(item.properties.city)) === addressFingerprint(suggestion.city);
    const kindMatches = item.properties.type === suggestion.kind || (suggestion.kind === "municipality" && item.properties.type === "municipality");
    // Completion includes postal locality twice for a municipality; use provider fields to compare it.
    const providerLabel = item.properties.type === "municipality"
      ? [text(item.properties.name) || text(item.properties.city), text(item.properties.postcode), text(item.properties.city)].filter(Boolean).join(" ")
      : text(item.properties.label) || [text(item.properties.name), text(item.properties.postcode), text(item.properties.city)].filter(Boolean).join(" ");
    const labelMatches = selectionLabel(providerLabel) === selectionLabel(suggestion.label.replace(/, France$/, ""));
    return cityMatches && kindMatches && labelMatches && suggestion.latitude !== undefined && suggestion.longitude !== undefined
      && item.latitude !== undefined && item.longitude !== undefined
      && Math.abs(item.latitude - suggestion.latitude) < 0.00015 && Math.abs(item.longitude - suggestion.longitude) < 0.00015;
  }) : undefined;
  if (!matching) throw new Error("The selected address could not be confirmed. Manual entry remains available.");
  const properties = matching.properties;
  const houseNumber = text(properties.housenumber), street = text(properties.street);
  const kind = text(properties.type);
  const value: AddressValue = {
    houseNumber, street, line1: kind === "municipality" ? "" : text(properties.name) || [houseNumber, street].filter(Boolean).join(" "),
    complement: "", postalCode: text(properties.postcode), city: text(properties.city), country: "France", countryCode: "FR",
    formattedAddress: "", latitude: matching.latitude, longitude: matching.longitude,
    source: "ign", sourceId: text(properties.banId) || text(properties.id) || undefined,
    precision: kind === "housenumber" ? "address" : kind === "municipality" ? "city" : "street", fingerprint: "",
  };
  value.formattedAddress = formatAddress(value);
  value.fingerprint = addressFingerprint(value.formattedAddress);
  return value;
}

async function fetchJson(url: URL, signal?: AbortSignal) {
  const response = await fetch(url, { signal, headers: { Accept: "application/json" }, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error(`Address provider unavailable (${response.status})`);
  return response.json() as Promise<unknown>;
}

export const ignAddressProvider: AddressProvider = {
  id: "ign", attribution: "Géoplateforme IGN · Base Adresse Nationale · Licence Ouverte 2.0",
  coversCountry: ignCoversCountry,
  async search(query, options = {}) {
    if (!ignCoversCountry(options.country) || query.trim().length < 3) return [];
    const url = new URL("https://data.geopf.fr/geocodage/completion/");
    url.search = new URLSearchParams({ text: query.trim(), type: "StreetAddress", maximumResponses: "5" }).toString();
    const results = parseIgnSuggestions(await fetchJson(url, options.signal));
    // Prefer the current city within the returned candidates, without restricting a new city typed by the user.
    const preferredCity = addressFingerprint(options.city || "");
    return preferredCity ? results.sort((a, b) => Number(addressFingerprint(b.city) === preferredCity) - Number(addressFingerprint(a.city) === preferredCity)) : results;
  },
  async resolve(suggestion, options = {}) {
    const url = new URL("https://data.geopf.fr/geocodage/search");
    url.search = new URLSearchParams({ q: suggestion.label.replace(/, France$/, ""), index: "address", limit: "5" }).toString();
    return parseIgnSelection(await fetchJson(url, options.signal), suggestion);
  },
};
