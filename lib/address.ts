/** Additive address metadata. Historical free text remains the displayed source of truth. */
export type AddressValue = {
  houseNumber: string;
  street: string;
  line1: string;
  complement: string;
  postalCode: string;
  city: string;
  country: string;
  countryCode: string;
  formattedAddress: string;
  latitude?: number;
  longitude?: number;
  source: "ign" | "manual";
  sourceId?: string;
  precision: "address" | "street" | "city" | "manual";
  fingerprint: string;
};

const stringValue = (value: unknown, maximum = 2000) => typeof value === "string" ? value.slice(0, maximum) : "";

export function addressFingerprint(address: string) {
  return address.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function formatAddress(value: Pick<AddressValue, "line1" | "complement" | "postalCode" | "city" | "country">) {
  return [value.line1.trim(), value.complement.trim(), [value.postalCode.trim(), value.city.trim()].filter(Boolean).join(" "), value.country.trim()].filter(Boolean).join("\n");
}

export function addressDisplayText(value: AddressValue, mode: "full" | "line1" = "full") {
  return mode === "line1" ? [value.line1, value.complement].filter(Boolean).join("\n") || value.formattedAddress : value.formattedAddress;
}

export function normalizeAddressForDisplay(raw: unknown, currentText: string, mode: "full" | "line1" = "full") {
  if (mode === "full") return normalizeAddressValue(raw, currentText);
  const normalized = normalizeAddressValue(raw);
  return normalized && addressFingerprint(addressDisplayText(normalized, mode)) === addressFingerprint(currentText)
    ? normalized : currentText.trim() ? manualAddress(currentText, normalized?.complement) : undefined;
}

export function addressCountryCode(country: string) {
  const value = country.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (["fr", "fra", "france", "france metropolitaine", "french republic", "republique francaise"].includes(value)) return "FR";
  if (["mc", "mco", "monaco", "principaute de monaco"].includes(value)) return "MC";
  if (["lu", "lux", "luxembourg", "grand-duche de luxembourg"].includes(value)) return "LU";
  return /^[a-z]{2}$/.test(value) ? value.toUpperCase() : "";
}

export function manualAddress(address: string, complement = "", country = "", countryCode = addressCountryCode(country)): AddressValue {
  return {
    houseNumber: "", street: "", line1: "", complement, postalCode: "", city: "", country, countryCode,
    formattedAddress: address, source: "manual", precision: "manual", fingerprint: addressFingerprint(address),
  };
}

/** Never reuse a geocode after an address was edited outside the shared field. */
export function normalizeAddressValue(raw: unknown, currentText?: string): AddressValue | undefined {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const formattedAddress = currentText === undefined ? stringValue(value.formattedAddress) : currentText;
  if (!formattedAddress.trim()) return undefined;
  if (!value.formattedAddress || addressFingerprint(stringValue(value.formattedAddress)) !== addressFingerprint(formattedAddress)) {
    return manualAddress(formattedAddress, stringValue(value.complement, 500));
  }
  const source = value.source === "ign" ? "ign" : "manual";
  const latitude = typeof value.latitude === "number" && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 ? value.latitude : undefined;
  const longitude = typeof value.longitude === "number" && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180 ? value.longitude : undefined;
  return {
    houseNumber: stringValue(value.houseNumber, 100), street: stringValue(value.street, 500), line1: stringValue(value.line1, 1000),
    complement: stringValue(value.complement, 500), postalCode: stringValue(value.postalCode, 40), city: stringValue(value.city, 300),
    country: stringValue(value.country, 200), countryCode: stringValue(value.countryCode, 2).toUpperCase(), formattedAddress,
    ...(source === "ign" && latitude !== undefined && longitude !== undefined ? { latitude, longitude } : {}),
    source, ...(source === "ign" && typeof value.sourceId === "string" && value.sourceId ? { sourceId: value.sourceId.slice(0, 300) } : {}),
    precision: source === "ign" && ["address", "street", "city"].includes(String(value.precision)) ? value.precision as AddressValue["precision"] : "manual",
    fingerprint: addressFingerprint(formattedAddress),
  };
}

export function readAddressForm(form: FormData, name: string, existing?: AddressValue, metadataName = `${name}Details`): AddressValue | undefined {
  const text = form.get(name);
  if (typeof text !== "string") return existing;
  const encoded = form.get(metadataName);
  if (typeof encoded === "string") {
    try { return normalizeAddressValue(JSON.parse(encoded), text); } catch { /* Treat malformed metadata as manual input. */ }
  }
  return normalizeAddressValue(existing, text);
}

export function googleMapsUrl(address: string, metadata?: AddressValue) {
  if (!address.trim()) return "";
  const coherent = normalizeAddressValue(metadata, address);
  const query = coherent?.latitude !== undefined && coherent.longitude !== undefined
    ? `${coherent.latitude},${coherent.longitude}` : address.trim();
  const params = new URLSearchParams({ api: "1", query: query.slice(0, 1400) });
  return `https://www.google.com/maps/search/?${params}`;
}
