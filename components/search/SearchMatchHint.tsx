"use client";
import { useI18n } from "@/lib/i18n/I18nProvider";

export function SearchMatchHint({ approximate }: { approximate: boolean }) {
  const { language } = useI18n();
  return approximate ? <small style={{ display: "block", color: "#7b693d", fontSize: 11, fontStyle: "italic" }}>
    {language === "en" ? "Approximate match" : "Correspondance approchée"}
  </small> : null;
}
