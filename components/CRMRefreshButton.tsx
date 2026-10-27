"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { requestPageRefresh } from "@/lib/pageRefresh";
import styles from "./CRMRefreshButton.module.css";

export default function CRMRefreshButton({ children }: { children: ReactNode }) {
  const { language } = useI18n();
  const english = language === "en";
  const label = english ? "Refresh CRM" : "Actualiser le CRM";
  return <button type="button" className={styles.button} data-crm-refresh aria-label={label} title={label} onClick={() => requestPageRefresh({
    confirm: message => window.confirm(message),
    alert: message => window.alert(message),
    // Reload the complete current URL without navigation, storage changes or saves.
    reload: () => window.location.reload(),
    confirmMessage: english
      ? "Refresh the CRM? Unsaved changes, including drafts and pending files in other views, may be lost."
      : "Actualiser le CRM ? Les modifications non enregistrées, y compris les brouillons et fichiers en attente dans les autres vues, peuvent être perdues.",
    busyMessage: english
      ? "An operation is in progress. Wait for it to finish, then click the logo again to refresh the CRM."
      : "Une opération est en cours. Attendez sa fin, puis cliquez à nouveau sur le logo pour actualiser le CRM."
  })}>{children}</button>;
}
