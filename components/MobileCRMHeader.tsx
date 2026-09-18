"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  getCRMTabSearchPlaceholder,
  getCRMTabTitle,
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [previousTab, setPreviousTab] = useState(activeTab);
  const [actionsOpen, setActionsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const actionsCloseRef = useRef<HTMLButtonElement>(null);
  const searchable = isCRMTabSearchable(activeTab);
  const searchPlaceholder = getCRMTabSearchPlaceholder(activeTab);

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
          <h1>{getCRMTabTitle(activeTab)}</h1>
        </div>
        <div className="mobile-crm-header-actions">
          {searchable ? (
            <button type="button" className="mobile-icon-button" aria-label="Ouvrir la recherche" onClick={() => setSearchOpen(true)}>
              ⌕
            </button>
          ) : null}
          <button type="button" className="mobile-action-button" aria-label="Ouvrir les actions" onClick={() => setActionsOpen(true)}>
            Actions
          </button>
        </div>
      </header>

      {searchable && searchOpen ? (
        <div className="mobile-sheet-backdrop" onMouseDown={() => setSearchOpen(false)}>
          <section className="mobile-search-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-search-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="mobile-sheet-header">
              <div>
                <p className="eyebrow">Recherche générale</p>
                <h2 id="mobile-search-title">Rechercher dans le CRM</h2>
              </div>
              <button type="button" className="mobile-icon-button" aria-label="Fermer la recherche" onClick={() => setSearchOpen(false)}>×</button>
            </header>
            <label className="mobile-search-field">
              <span>Nom, bien, lead ou référence</span>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder={searchPlaceholder}
              />
            </label>
            <p>La liste du module actif est filtrée au fil de la saisie.</p>
            <button type="button" className="primary-button" onClick={() => setSearchOpen(false)}>Afficher les résultats</button>
          </section>
        </div>
      ) : null}

      {actionsOpen ? (
        <div className="mobile-sheet-backdrop" onMouseDown={() => setActionsOpen(false)}>
          <section className="mobile-actions-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-actions-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="mobile-sheet-header">
              <div>
                <p className="eyebrow">Compte et outils</p>
                <h2 id="mobile-actions-title">Actions</h2>
              </div>
              <button ref={actionsCloseRef} type="button" className="mobile-icon-button" aria-label="Fermer les actions" onClick={() => setActionsOpen(false)}>×</button>
            </header>

            <div className="mobile-actions-scroll">
              <p className="mobile-session-line">Connecté : <strong>{sessionEmail}</strong></p>
              <label className="mobile-actor-field">
                <span>Actions par</span>
                <select value={activeActor} onChange={(event) => onActorChange(event.target.value)}>
                  {actors.map((actor) => <option key={actor}>{actor}</option>)}
                </select>
              </label>
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className={action.tone === "danger" ? "is-danger" : ""}
                  onClick={() => {
                    action.onClick();
                    setActionsOpen(false);
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
