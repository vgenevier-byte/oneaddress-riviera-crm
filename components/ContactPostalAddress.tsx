"use client";
import { useI18n } from "@/lib/i18n/I18nProvider";

import { useId, useState } from "react";
import styles from "./ContactPostalAddress.module.css";

export function ContactPostalAddressField({ value = "" }: { value?: string }) {
  const {t} = useI18n();

  const helpId = useId();
  return (
    <label className={`full ${styles.field}`}>{t("modules.contactPostalAddress.fullPostalAddress")}
      <textarea name="postalAddress" rows={3} defaultValue={value} aria-describedby={helpId}
        placeholder={t("modules.postal.addressExample")} />
      <small id={helpId}>{t("modules.contactPostalAddress.streetNumberAndNameAdditionalDetailsPostcodeTownOrCityAndCountry")}</small>
    </label>
  );
}

export function ContactPostalAddressDetails({ address = "" }: { address?: string }) {
  const {t} = useI18n();

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
      <span>{t("modules.contactPostalAddress.postalAddress")}</span>
      <p className={styles.address}>{hasAddress ? address : t("modules.contactDocuments.notProvided")}</p>
      {hasAddress && <>
        <button className="secondary-button" type="button" disabled={copyState === "copying"} onClick={copyAddress}>

          {t("modules.contactPostalAddress.copyADDRESS")}
        </button>
        <p role="status" aria-live="polite">
          {copyState === "copied" ? t("modules.contactPostalAddress.addressCopied") : copyState === "failed"
            ? t("modules.contactPostalAddress.unableToCopySelectTheAddressBelowAndCopyItManually")
            : ""}
        </p>
        {copyState === "failed" && <textarea className={styles.fallback} aria-label={t("modules.contactPostalAddress.addressToCopyManually")}
          readOnly rows={4} value={address} onFocus={(event) => event.currentTarget.select()} />}
      </>}
    </div>
  );
}
