"use client";

import { useI18n } from "@/lib/i18n/I18nProvider";

import LanguageSelector from "./LanguageSelector";
import { useEffect, useRef } from "react";
import {
  getCRMNavigationItem,
  mobileMoreTabs,
  type CRMTab
} from "./crmNavigation";

export type MobileSecondaryAction = {
  id: string;
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
};

type Props = {
  activeTab: CRMTab;
  badgeCounts: Partial<Record<CRMTab, number>>;
  open: boolean;
  sessionEmail: string;
  secondaryActions: MobileSecondaryAction[];
  onClose: () => void;
  onNavigate: (tab: CRMTab) => void;
};

export default function MobileMoreMenu({
  activeTab,
  badgeCounts,
  open,
  sessionEmail,
  secondaryActions,
  onClose,
  onNavigate
}: Props) {
  const { t, label } = useI18n();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="mobile-sheet-backdrop" onMouseDown={onClose}>
      <section
        id="mobile-more-menu"
        className="mobile-more-menu"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-more-menu-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="mobile-sheet-header">
          <div>
            <p className="eyebrow">Navigation</p>
            <h2 id="mobile-more-menu-title">{t("navigation.moreModules")}</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="mobile-icon-button" aria-label={t("navigation.closeMenu")} onClick={onClose}>
            ×
          </button>
        </header>

        <div className="mobile-more-menu-scroll">
          <div className="mobile-more-grid">
            {mobileMoreTabs.map((tab) => {
              const item = getCRMNavigationItem(tab);
              const badge = badgeCounts[tab] ?? 0;

              return (
                <button
                  key={tab}
                  type="button"
                  className={`mobile-more-item ${activeTab === tab ? "is-active" : ""}`}
                  aria-current={activeTab === tab ? "page" : undefined}
                  onClick={() => {
                    onNavigate(tab);
                    onClose();
                  }}
                >
                  <span className="mobile-more-item-icon" aria-hidden="true">{item.icon}</span>
                  <span>{t(`navigation.module.${item.tab}`)}</span>
                  {badge ? <strong aria-label={t("navigation.pendingCount", { count: badge })}>{badge}</strong> : null}
                </button>
              );
            })}
          </div>

          <LanguageSelector />
          <section className="mobile-more-secondary" aria-label={t("navigation.secondary")}>
            <p className="mobile-session-line">{t("navigation.signedIn")} <strong>{sessionEmail}</strong></p>
            {secondaryActions.map((action) => (
              <button
                key={action.id}
                type="button"
                className={action.tone === "danger" ? "is-danger" : ""}
                onClick={() => {
                  action.onClick();
                  onClose();
                }}
              >
                {label(action.label, "crm")}
              </button>
            ))}
          </section>
        </div>
      </section>
    </div>
  );
}
