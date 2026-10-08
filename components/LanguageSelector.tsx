"use client";
import { useI18n } from "@/lib/i18n/I18nProvider";
import styles from "./LanguageSelector.module.css";
export default function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage, t } = useI18n();
  return <div className={`${styles.selector} ${compact ? styles.compact : ""}`} role="group" aria-label={t("common.language")} data-language-selector>
    <button type="button" lang="fr" aria-label="Français — FR" aria-pressed={language === "fr"} onClick={() => setLanguage("fr")}><span aria-hidden="true">FR</span><span className={styles.name}>Français</span></button>
    <button type="button" lang="en-GB" aria-label="English — EN" aria-pressed={language === "en"} onClick={() => setLanguage("en")}><span aria-hidden="true">EN</span><span className={styles.name}>English</span></button>
  </div>;
}
