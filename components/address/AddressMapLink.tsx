"use client";

import { googleMapsUrl, type AddressValue } from "@/lib/address";
import { useI18n } from "@/lib/i18n/I18nProvider";

export function AddressMapLink({ address, metadata, lang, className = "secondary-button" }: {
  address?: string; metadata?: AddressValue; lang?: "fr" | "en"; className?: string;
}) {
  const { language } = useI18n();
  const href = googleMapsUrl(address || "", metadata);
  return href ? <a className={className} href={href} target="_blank" rel="noopener noreferrer">
    {(lang || language) === "en" ? "Open in Google Maps" : "Ouvrir dans Google Maps"}
  </a> : null;
}
