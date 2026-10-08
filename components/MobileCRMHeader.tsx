"use client";

import { useI18n } from "@/lib/i18n/I18nProvider";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  isCRMTabSearchable,
  type CRMTab
} from "./crmNavigation";
import type { MobileSecondaryAction } from "./MobileMoreMenu";

type Props = {
  activeActor: string;
  activeTab: CRMTab;
  actors: readonly string[];
  query: string;
  sessionEmail: string;
  actions: MobileSecondaryAction[];
  onActorChange: (actor: string) => void;
  onQueryChange: (query: string) => void;
};

export default function MobileCRMHeader({
  activeActor,
  activeTab,
  actors,
  query,
  sessionEmail,
  actions,
  onActorChange,
  onQueryChange
}: Props) {
  const { t, label } = useI18n();
  const [searchOpen, setSearchOpen] = useState(false);
  const [previousTab, setPreviousTab] = useState(activeTab);
  const [actionsOpen, setActionsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const actionsCloseRef = useRef<HTMLButtonElement>(null);
  const searchable = isCRMTabSearchable(activeTab);
  const searchPlaceholder = searchable ? t(`navigation.search.${activeTab}`) : "";

  if (previousTab !== activeTab) {
    setPreviousTab(activeTab);
    setSearchOpen(false);
  }

  useEffect(() => {
    if (!searchOpen && !actionsOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setSearchOpen(false);
      setActionsOpen(false);
    }

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [actionsOpen, searchOpen]);

  useEffect(() => {
    if (searchOpen) window.requestAnimationFrame(() => searchRef.current?.focus());
  }, [searchOpen]);

  useEffect(() => {
    if (actionsOpen) window.requestAnimationFrame(() => actionsCloseRef.current?.focus());
  }, [actionsOpen]);

  return (
    <>
      <header className="mobile-crm-header">
        <Image src="/oar-logo-paysage-crm.png" alt="One Address Riviera" width={96} height={84} priority />
        <div className="mobile-crm-header-title">
          <span>One Address · CRM</span>
          <h1>{t(`navigation.module.${activeTab}`)}</h1>
        </div>
        <div className="mobile-crm-header-actions">
          {searchable ? (
            <button type="button" className="mobile-icon-button" aria-label={t("navigation.openSearch")} onClick={() => setSearchOpen(true)}>
              ⌕
            </button>
          ) : null}
          <button type="button" className="mobile-action-button" aria-label={t("navigation.openActions")} onClick={() => setActionsOpen(true)}>
            Actions
          </button>
        </div>
      </header>

      {searchable && searchOpen ? (
        <div className="mobile-sheet-backdrop" onMouseDown={() => setSearchOpen(false)}>
          <section className="mobile-search-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-search-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="mobile-sheet-header">
              <div>
                <p className="eyebrow">{t("navigation.generalSearch")}</p>
                <h2 id="mobile-search-title">{t("navigation.searchCRM")}</h2>
              </div>
              <button type="button" className="mobile-icon-button" aria-label={t("navigation.closeSearch")} onClick={() => setSearchOpen(false)}>×</button>
            </header>
            <label className="mobile-search-field">
              <span>{t("navigation.searchField")}</span>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder={searchPlaceholder}
              />
            </label>
            <p>{t("navigation.filterHint")}</p>
            <button type="button" className="primary-button" onClick={() => setSearchOpen(false)}>{t("navigation.showResults")}</button>
          </section>
        </div>
      ) : null}

      {actionsOpen ? (
        <div className="mobile-sheet-backdrop" onMouseDown={() => setActionsOpen(false)}>
          <section className="mobile-actions-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-actions-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="mobile-sheet-header">
              <div>
                <p className="eyebrow">{t("navigation.accountTools")}</p>
                <h2 id="mobile-actions-title">{t("navigation.actions")}</h2>
              </div>
              <button ref={actionsCloseRef} type="button" className="mobile-icon-button" aria-label={t("navigation.closeActions")} onClick={() => setActionsOpen(false)}>×</button>
            </header>

            <div className="mobile-actions-scroll">
              <p className="mobile-session-line">{t("navigation.signedIn")} <strong>{sessionEmail}</strong></p>
              <label className="mobile-actor-field">
                <span>{t("navigation.actionsBy")}</span>
                <select value={activeActor} onChange={(event) => onActorChange(event.target.value)}>
                  <option value="">{t("navigation.unspecified")}</option>
                  {actors.map((actor) => <option key={actor}>{actor}</option>)}
                </select>
              </label>
              {actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className={action.tone === "danger" ? "is-danger" : ""}
                  onClick={() => {
                    action.onClick();
                    setActionsOpen(false);
                  }}
                >
                  {label(action.label, "crm")}
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
