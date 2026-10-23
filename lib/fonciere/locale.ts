"use client";
import { useI18n } from "@/lib/i18n/I18nProvider";
export type FonciereLocale = "fr" | "en";
/** Use the CRM account language preference; project content is never translated. */
export function useFonciereLocale(): readonly [FonciereLocale, (locale: FonciereLocale) => void] {
  const { language, setLanguage } = useI18n();
  return [language, setLanguage] as const;
}
