"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import crmLogo from "../public/oar-logo-paysage-crm.png";
import { type AccessSnapshot, type ModuleId } from "@/lib/access/modules";
import { administrationItem, allowedNavigation, groupForModule, mobileShortcutItems, type NavigationGroupId, type NavigationModule } from "./unifiedNavigationStructure";
import styles from "./UnifiedNavigation.module.css";
import { useI18n } from "@/lib/i18n/I18nProvider";
import LanguageSelector from "./LanguageSelector";
export type UnifiedTab = ModuleId | "admin";
export default function UnifiedNavigation({ access, active, accountId, navigationRevision = 0, onNavigate, onLogout, badges = {} }: { access: AccessSnapshot; active: UnifiedTab; accountId: string; navigationRevision?: number; onNavigate: (tab: UnifiedTab) => boolean | void; onLogout: () => void; badges?: Partial<Record<ModuleId, number>> }) {
 const { t } = useI18n();
 const [more, setMore] = useState(false);
 const [openedGroup, setOpenedGroup] = useState<NavigationGroupId | null>(() => groupForModule(active));
 const [destination, setDestination] = useState({ active, accountId, navigationRevision });
 // Follow confirmed destinations, never data refreshes or badge/access object identity.
 if (destination.active !== active || destination.accountId !== accountId || destination.navigationRevision !== navigationRevision) {
  setDestination({ active, accountId, navigationRevision });
  setOpenedGroup(groupForModule(active));
  if (destination.accountId !== accountId) setMore(false);
 }
 const moreButton = useRef<HTMLButtonElement>(null);
 const morePanel = useRef<HTMLElement>(null);
 const closeButton = useRef<HTMLButtonElement>(null);
 useEffect(() => {
  if (!more) return;
  const trigger = moreButton.current;
  closeButton.current?.focus({ preventScroll: true });
  const containFocus = () => {
   if (!morePanel.current?.contains(document.activeElement)) closeButton.current?.focus({ preventScroll: true });
  };
  // A revoked module can remove the focused button while the panel stays open.
  const focusObserver = new MutationObserver(containFocus);
  if (morePanel.current) focusObserver.observe(morePanel.current, { childList: true, subtree: true });
  document.addEventListener("focusin", containFocus);
  const desktop = window.matchMedia("(min-width: 1024px)");
  const closeOnDesktop = () => { if (desktop.matches) setMore(false); };
  desktop.addEventListener("change", closeOnDesktop);
  return () => {
   focusObserver.disconnect();
   document.removeEventListener("focusin", containFocus);
   desktop.removeEventListener("change", closeOnDesktop);
   // Switching between CRM and IZORD/Admin can mount a new navigation instance.
   window.requestAnimationFrame(() => {
    if (document.getElementById("unified-more-panel")) return;
    // Access revalidation can briefly replace the destination with a loading view.
    // Follow its trigger for a bounded interval, without overriding user input.
    let focusedTrigger: HTMLElement | null = trigger;
    const stop = () => {
     observer.disconnect(); window.clearTimeout(timeout);
     document.removeEventListener("pointerdown", stop, true);
     document.removeEventListener("keydown", stop, true);
    };
    const restoreFocus = () => {
     if (document.getElementById("unified-more-panel")) { stop(); return; }
     if (document.activeElement !== document.body && document.activeElement !== focusedTrigger) { stop(); return; }
     const target = document.getElementById("unified-more-trigger");
     if (target?.getClientRects().length) {
      target.focus({ preventScroll: true });
      focusedTrigger = target;
     }
    };
    const observer = new MutationObserver(restoreFocus);
    const timeout = window.setTimeout(stop, 2000);
    document.addEventListener("pointerdown", stop, true);
    document.addEventListener("keydown", stop, true);
    observer.observe(document.body, { childList: true, subtree: true });
    restoreFocus();
   });
  };
 }, [more]);
 const entries = allowedNavigation(access);
 const navigate = (tab: UnifiedTab) => { if (onNavigate(tab) !== false) setMore(false); };
 function button(item: NavigationModule | typeof administrationItem, surface: "desktop" | "more" | "shortcut") {
  const count = item.tab === "admin" ? 0 : badges[item.tab];
  const selected = active === item.tab;
  const className = surface === "shortcut" ? `mobile-crm-nav-button ${selected ? "is-active" : ""}` : surface === "more" ? `unified-more-button ${selected ? "is-active" : ""}` : `${styles.row} ${selected ? styles.active : ""}`;
  return <button key={item.tab} data-navigation-module={item.tab} type="button" className={className} aria-current={selected ? "page" : undefined} onClick={() => navigate(item.tab)}>
   <span className={surface === "more" ? "unified-more-icon" : surface === "shortcut" ? "nav-button-icon" : styles.icon} aria-hidden="true">{item.icon}</span>
   <span className={surface === "more" ? "unified-more-label" : surface === "shortcut" ? "nav-button-label" : styles.label}>{t(`navigation.module.${item.tab}`)}</span>
   {count ? <span className={surface === "more" ? "unified-more-badge" : surface === "shortcut" ? "nav-badge" : styles.badge} aria-label={t("navigation.pendingCount", { count })}>{count}</span> : null}
  </button>;
 }
 function tree(surface: "desktop" | "more") {
  return entries.map(entry => {
   if (entry.kind === "module") return button(entry.item, surface);
   const expanded = openedGroup === entry.id;
   const containsActive = entry.items.some(item => item.tab === active);
   const pending = !expanded && entry.items.some(item => (badges[item.tab] ?? 0) > 0);
   const panelId = `unified-${surface}-group-${entry.id}`;
   return <div key={entry.id} className={styles.group}>
    <button type="button" data-navigation-group={entry.id} className={`${surface === "more" ? "unified-more-button" : styles.row} ${styles.category} ${!expanded && containsActive ? styles.containsActive : ""}`} aria-expanded={expanded} aria-controls={panelId} onClick={() => setOpenedGroup(expanded ? null : entry.id)}>
     <span className={surface === "more" ? "unified-more-icon" : styles.icon} aria-hidden="true">{expanded ? "▾" : "▸"}</span>
     <span className={surface === "more" ? "unified-more-label" : styles.label}>{t(`navigation.group.${entry.id}`)}</span>
     <span className={styles.indicators}>
      {!expanded && containsActive && <span className={styles.activeDot} role="img" aria-label={t("navigation.activePage")} />}
      {pending && <span className={styles.pendingDot} role="img" aria-label={t("navigation.pending")} />}
     </span>
    </button>
    <div id={panelId} className={styles.children} hidden={!expanded}>{expanded && entry.items.map(item => button(item, surface))}</div>
   </div>;
  });
 }
 return <><aside className={`sidebar ${styles.rail}`}><div className={`brand-block brand-block-logo ${styles.brand}`}><Image src={crmLogo} alt="One Address Riviera" className="crm-sidebar-logo" /></div><nav className={`nav-list ${styles.tree}`} aria-label={t("navigation.main")}>{tree("desktop")}</nav><footer className={styles.footer}><LanguageSelector compact />
  {access.generalAdmin && button(administrationItem, "desktop")}
  <button type="button" className={`${styles.row} ${styles.signout}`} onClick={onLogout}>{t("navigation.signOut")}</button>
 </footer></aside>
 <nav className="mobile-crm-navigation" aria-label={t("navigation.mobile")}>{mobileShortcutItems(access).map(item => button(item, "shortcut"))}<button ref={moreButton} id="unified-more-trigger" type="button" className="mobile-crm-nav-button" aria-expanded={more} aria-controls="unified-more-panel" aria-haspopup="dialog" onClick={()=>setMore(!more)}>•••<span>{t("navigation.more")}</span></button></nav>
 {more && <div className="mobile-sheet-backdrop unified-more-backdrop" onClick={()=>setMore(false)}>
  <section ref={morePanel} id="unified-more-panel" className={`mobile-more-menu unified-more-panel ${styles.panel}`} role="dialog" aria-modal="true" aria-labelledby="unified-more-title" onClick={e=>e.stopPropagation()} onKeyDown={event => {
   if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMore(false); }
   if (event.key !== "Tab") return;
   const buttons = Array.from(morePanel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []).filter(button => button.getClientRects().length > 0);
   const first = buttons[0], last = buttons[buttons.length - 1];
   if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
   else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
   <header className="unified-more-header"><h2 id="unified-more-title">{t("navigation.authorized")}</h2><button ref={closeButton} type="button" className="unified-more-close" onClick={()=>setMore(false)}>{t("navigation.close")}</button></header>
   <div className="unified-more-scroll">
    <nav className="unified-more-list" aria-label={t("navigation.authorized")}>
     {tree("more")}
    </nav>
   </div>
   <footer className={styles.footer}><LanguageSelector compact />{access.generalAdmin && button(administrationItem, "more")}<button type="button" className="unified-more-signout" onClick={onLogout}>{t("navigation.signOut")}</button></footer>
  </section>
 </div>}</>;
}
