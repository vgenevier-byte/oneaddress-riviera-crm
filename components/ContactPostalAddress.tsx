"use client";

import { useId, useState } from "react";
import styles from "./ContactPostalAddress.module.css";

export function ContactPostalAddressField({ value = "" }: { value?: string }) {
  const helpId = useId();
  return (
    <label className={`full ${styles.field}`}>Adresse postale complète
      <textarea name="postalAddress" rows={3} defaultValue={value} aria-describedby={helpId}
        placeholder={"12 avenue Exemple\nBâtiment B\n06400 Cannes\nFrance"} />
      <small id={helpId}>Numéro et rue, complément éventuel, code postal, ville et pays.</small>
    </label>
  );
}

export function ContactPostalAddressDetails({ address = "" }: { address?: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const hasAddress = Boolean(address.trim());

  async function copyAddress() {
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(address);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className={`full ${styles.details}`}>
      <span>Adresse postale</span>
      <p className={styles.address}>{hasAddress ? address : "Non renseignée"}</p>
      {hasAddress && <>
        <button className="secondary-button" type="button" disabled={copyState === "copying"} onClick={copyAddress}>
          COPIER L’ADRESSE
        </button>
        <p role="status" aria-live="polite">
          {copyState === "copied" ? "Adresse copiée" : copyState === "failed"
            ? "Copie impossible. Sélectionnez l’adresse ci-dessous puis copiez-la manuellement."
            : ""}
        </p>
        {copyState === "failed" && <textarea className={styles.fallback} aria-label="Adresse à copier manuellement"
          readOnly rows={4} value={address} onFocus={(event) => event.currentTarget.select()} />}
      </>}
    </div>
  );
}
