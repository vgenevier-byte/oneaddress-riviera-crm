"use client";
import { useI18n } from "@/lib/i18n/I18nProvider";

import { useState } from "react";
import type { AddressValue } from "@/lib/address";
import { AddressField } from "./address/AddressField";
import { AddressMapLink } from "./address/AddressMapLink";
import styles from "./ContactPostalAddress.module.css";

export function ContactPostalAddressField({ value = "", metadata }: { value?: string; metadata?: AddressValue }) {
  const { t } = useI18n();
  return <AddressField name="postalAddress" multiline value={value} metadata={metadata} cityFieldName="city"
    className={`full ${styles.field}`} label={t("modules.contactPostalAddress.fullPostalAddress")}
    placeholder={t("modules.postal.addressExample")} />;
}

export function ContactPostalAddressDetails({ address = "", metadata }: { address?: string; metadata?: AddressValue }) {
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
        <AddressMapLink address={address} metadata={metadata} />
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
