"use client";

import { useState } from "react";
import { isCivilDate } from "@/lib/fonciere/calendar";
import styles from "./ProjectsWorkspace.module.css";

export default function GuidedCivilDate({ id, value, onChange, onInvalidDraft, lang, disabled, label }: {
  id: string; value: string; onChange: (value: string | null) => void; onInvalidDraft: () => void;
  lang: "fr" | "en"; disabled?: boolean; label: string;
}) {
  const [invalid, setInvalid] = useState(false);
  return <div>
    <input id={id} type="date" value={value} min="0001-01-01" max="9999-12-31" disabled={disabled} aria-label={label} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : `${id}-hint`} onChange={event => {
      const next = event.target.value;
      const rejected = event.target.validity.badInput || next !== "" && !isCivilDate(next);
      setInvalid(rejected);
      if (rejected) onInvalidDraft();
      else onChange(next || null);
    }} onBlur={event => {
      const rejected = !event.target.validity.valid;
      setInvalid(rejected);
      if (rejected) onInvalidDraft();
    }} />
    {invalid ? <p id={`${id}-error`} className={styles.fieldError} role="alert">{lang === "fr" ? "Choisissez une date civile valide, ou laissez vide." : "Choose a valid calendar date, or leave empty."}</p> : <p id={`${id}-hint`} className={styles.fieldDescription}>{lang === "fr" ? "Non renseigné tant qu’aucune date n’est choisie." : "Not provided until a date is chosen."}</p>}
  </div>;
}
