"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import styles from "./ProjectsWorkspace.module.css";

/** Accept localized amounts while keeping an empty value distinct from zero. */
export function normalizedNumberInput(input: string): string | null {
  let value = input.trim().replace(/[\s\u00a0\u202f]/g, "").replace(/(?:EUR|€|m²|m2|%)/gi, "");
  if (!value) return "";
  if (value.includes(",")) value = value.replace(/\./g, "").replace(",", ".");
  else if (/^[+-]?\d{1,3}(?:\.\d{3}){2,}$/.test(value)) value = value.replace(/\./g, "");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(Number(value))) return null;
  return String(Number(value));
}

function draftNumber(input:string,lang:"fr"|"en") {
  const grouped=lang==='en'&&/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?$/.test(input.trim());
  return normalizedNumberInput(grouped?input.replaceAll(',',''):input);
}

export default function GuidedNumberInput({ id, value, onChange, onInvalidDraft, lang, unit, integer = false, min = 0, max, disabled, placeholder, label }: {
  id: string; value: string | number; onChange: (value: string) => void; lang: "fr" | "en";
  unit?: string; integer?: boolean; min?: number; max?: number; disabled?: boolean; placeholder?: string; label: string; onInvalidDraft?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [raw, setRaw] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [committed,setCommitted]=useState<string|null>(null);
  const [observed, setObserved] = useState(value);
  if (observed !== value) { setObserved(value); if (!invalid && String(value)!==committed) setRaw(String(value));setCommitted(null); }
  const canonical = normalizedNumberInput(String(value));
  const formatted = canonical !== null && canonical !== "" ? new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: 8 }).format(Number(canonical)) : String(value);
  const commit = (next: string) => {
    const number = draftNumber(next,lang);
    const rejected = number === null || number !== "" && (Number(number) < min || max !== undefined && Number(number) > max || integer && !Number.isInteger(Number(number)));
    setInvalid(rejected);
    if (rejected) onInvalidDraft?.();
    else if(number!==canonical){ setCommitted(number);onChange(number); }
  };
  const step = (direction: number) => {
    const current = draftNumber(focused ? raw : String(value),lang);
    const next = Math.max(min, (current === null || current === "" ? 0 : Number(current)) + direction);
    setRaw(String(next)); setCommitted(String(next));setInvalid(false); onChange(String(next));
  };
  return <div className={styles.numberGroup}>
    <div className={styles.numberControl}>
      {integer && <button type="button" className={styles.stepButton} disabled={disabled || canonical !== null && canonical !== "" && Number(canonical) <= min} aria-label={`${lang === "fr" ? "Diminuer" : "Decrease"} ${label}`} onClick={() => step(-1)}><Minus size={14} /></button>}
      <input id={id} type="text" inputMode={integer ? "numeric" : "decimal"} value={focused || invalid ? raw : formatted} disabled={disabled} autoComplete="off" aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined} placeholder={placeholder || (lang === "fr" ? "Non renseigné" : "Not provided")} onFocus={() => { setFocused(true); if (!invalid) setRaw(formatted); }} onChange={event => { setRaw(event.target.value); commit(event.target.value); }} onBlur={() => { commit(raw); setFocused(false); }} />
      {unit && <span className={styles.unit} aria-hidden="true">{unit}</span>}
      {integer && <button type="button" className={styles.stepButton} disabled={disabled} aria-label={`${lang === "fr" ? "Augmenter" : "Increase"} ${label}`} onClick={() => step(1)}><Plus size={14} /></button>}
    </div>
    {invalid && <p className={styles.fieldError} id={`${id}-error`} role="alert">{lang === "fr" ? integer ? min >= 0 ? "Saisissez un nombre entier positif ou nul, ou laissez vide." : "Saisissez un nombre entier, ou laissez vide." : "Saisissez un nombre valide, ou laissez vide." : integer ? min >= 0 ? "Enter a non-negative whole number, or leave empty." : "Enter a whole number, or leave empty." : "Enter a valid number, or leave empty."}</p>}
  </div>;
}
