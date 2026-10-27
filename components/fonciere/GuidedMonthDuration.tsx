"use client";

import { useState } from "react";
import { MAX_CALENDAR_MONTHS } from "@/lib/fonciere/calendar";
import styles from "./ProjectsWorkspace.module.css";

const USUAL_MONTHS = [0, 1, 2, 3, 6, 9, 12, 18, 24];

/** Keep custom drafts local until valid; the existing save guard blocks invalid drafts. */
export default function GuidedMonthDuration({ id, value, onChange, onInvalidDraft, label, lang, disabled, works = false }: {
  id: string; value: number | null; onChange: (value: number | null) => void; onInvalidDraft: () => void;
  label: string; lang: "fr" | "en"; disabled?: boolean; works?: boolean;
}) {
  const [custom, setCustom] = useState(false);
  const [raw, setRaw] = useState("");
  const [invalid, setInvalid] = useState(false);
  const customValue = value !== null && !USUAL_MONTHS.includes(value);
  const showCustom = custom || customValue;
  const t = (fr: string, en: string) => lang === "fr" ? fr : en;
  const choose = (next: string) => {
    if (next === "other") {
      setCustom(true); setRaw(value === null ? "" : String(value)); setInvalid(false);
      return;
    }
    setCustom(false); setInvalid(false); setRaw(""); onChange(next === "" ? null : Number(next));
  };
  const edit = (next: string) => {
    setRaw(next);
    const empty = next.trim() === "";
    const valid = empty || /^\d+$/.test(next) && Number.isSafeInteger(Number(next)) && Number(next) <= MAX_CALENDAR_MONTHS;
    setInvalid(!valid);
    if (valid) onChange(empty ? null : Number(next));
    else onInvalidDraft();
  };
  return <div className={styles.monthDuration}>
    <select id={id} value={showCustom ? "other" : value === null ? "" : String(value)} disabled={disabled} onChange={event => choose(event.target.value)} aria-label={label}>
      <option value="">{t("Non renseigné", "Not provided")}</option>
      {USUAL_MONTHS.map(months => <option key={months} value={months}>{months === 0 && works ? t("0 mois — Sans travaux", "0 months — No works") : `${months} ${t("mois", months === 1 ? "month" : "months")}`}</option>)}
      <option value="other">{t("Autre durée", "Other duration")}</option>
    </select>
    {showCustom && <label htmlFor={`${id}-custom`} className={styles.customDuration}>
      <span>{t("Durée personnalisée — mois entiers", "Custom duration — whole months")}</span>
      <input id={`${id}-custom`} type="text" inputMode="numeric" autoComplete="off" value={custom ? raw : value === null ? "" : String(value)} disabled={disabled} maxLength={8} aria-label={`${label} — ${t("autre durée", "other duration")}`} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : `${id}-hint`} onChange={event => { setCustom(true); edit(event.target.value); }} placeholder={t("Non renseigné", "Not provided")} />
      {invalid ? <span id={`${id}-error`} className={styles.fieldError} role="alert">{t(`Saisissez un nombre entier de 0 à ${MAX_CALENDAR_MONTHS}, ou laissez vide.`, `Enter a whole number from 0 to ${MAX_CALENDAR_MONTHS}, or leave empty.`)}</span> : <span id={`${id}-hint`} className={styles.fieldDescription}>{t("Zéro doit être saisi explicitement. Une valeur vide reste non renseignée.", "Zero must be entered explicitly. An empty value remains unspecified.")}</span>}
    </label>}
  </div>;
}
