import { addressFingerprint, formatAddress, normalizeAddressValue, type AddressValue } from "../address";
import type { FonciereData } from "./model";
import { setGuidedField } from "./guided";

/** Physical property and agency addresses have separate identities and metadata. */
export function propertyAddressText(data: Pick<FonciereData, "propertyAddress" | "postalCode" | "city" | "propertyAddressDetails">): string {
  return [data.propertyAddress.trim(), [data.postalCode.trim(), data.city.trim()].filter(Boolean).join(" "), data.propertyAddressDetails?.country.trim()].filter(Boolean).join("\n");
}

export function propertyAddressDetails(data: Pick<FonciereData, "propertyAddress" | "postalCode" | "city" | "propertyAddressDetails">): AddressValue | undefined {
  if (!data.propertyAddressDetails) return undefined;
  const value = normalizeAddressValue(data.propertyAddressDetails);
  if (!value) return undefined;
  const main = [value.line1, value.complement].filter(Boolean).join("\n");
  if (addressFingerprint(main) !== addressFingerprint(data.propertyAddress) || value.postalCode !== data.postalCode || value.city !== data.city) return undefined;
  return normalizeAddressValue(value, propertyAddressText(data));
}

export function selectPropertyAddress(data: FonciereData, value: AddressValue): FonciereData {
  const result: FonciereData = { ...data, propertyAddress: [value.line1, value.complement].filter(Boolean).join("\n"), postalCode: value.postalCode, city: value.city, propertyAddressDetails: value };
  return setGuidedField(result, "locationPrecision", value.precision === "address" ? "exact" : "approximate");
}

/** Keep manual country/complement input without guessing components from free text. */
export function applyPropertyAddressInput(data: FonciereData, value: AddressValue): FonciereData {
  if (value.line1 || value.street || value.precision === "city") return selectPropertyAddress(data, value);
  const suffix = value.complement ? `\n${value.complement}` : "";
  const line1 = suffix && value.formattedAddress.endsWith(suffix) ? value.formattedAddress.slice(0, -suffix.length) : value.formattedAddress;
  const next = { ...value, line1, postalCode: data.postalCode, city: data.city };
  next.formattedAddress = formatAddress(next); next.fingerprint = addressFingerprint(next.formattedAddress);
  return selectPropertyAddress(data, next);
}

export function editPropertyAddress(data: FonciereData, key: "propertyAddress" | "postalCode" | "city", value: string): FonciereData {
  if (data[key] === value) return data;
  const result: FonciereData = { ...data, [key]: value, propertyAddressDetails: undefined };
  const previous = propertyAddressDetails(data);
  if (previous && key !== "propertyAddress") {
    const next: AddressValue = { ...previous, [key]: value, source: "manual", precision: "manual", latitude: undefined, longitude: undefined, sourceId: undefined };
    next.formattedAddress = formatAddress(next); next.fingerprint = addressFingerprint(next.formattedAddress);
    result.propertyAddressDetails = next;
  }
  return result;
}
