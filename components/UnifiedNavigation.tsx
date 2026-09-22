"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import crmLogo from "../public/oar-logo-paysage-crm.png";
import { moduleItems, readable, type AccessSnapshot, type ModuleId } from "@/lib/access/modules";
export type UnifiedTab = ModuleId | "admin";
export default function UnifiedNavigation({ access, active, onNavigate, onLogout, badges = {} }: { access: AccessSnapshot; active: UnifiedTab; onNavigate: (tab: UnifiedTab) => void; onLogout: () => void; badges?: Partial<Record<ModuleId, number>> }) {
 const [more, setMore] = useState(false);
 const moreButton = useRef<HTMLButtonElement>(null);
 const morePanel = useRef<HTMLElement>(null);
 const closeButton = useRef<HTMLButtonElement>(null);
 useEffect(() => {
  if (!more) return;
  const trigger = moreButton.current;
  closeButton.current?.focus({ preventScroll: true });
  const desktop = window.matchMedia("(min-width: 1024px)");
  const closeOnDesktop = () => { if (desktop.matches) setMore(false); };
  desktop.addEventListener("change", closeOnDesktop);
  return () => {
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
 const items = [...moduleItems.filter(i => readable(access,i.tab)), ...(access.generalAdmin ? [{ tab: "admin" as const, label: "Administration", icon: "⚙" }] : [])];
 const navigate = (tab: UnifiedTab) => { onNavigate(tab); setMore(false); };
 function button(item: typeof items[number], mobile = false) {
  const count = item.tab === "admin" ? 0 : badges[item.tab];
  return <button key={item.tab} type="button" className={mobile ? `mobile-crm-nav-button ${active===item.tab?"is-active":""}` : `nav-button ${active===item.tab?"active":""}`} aria-current={active===item.tab?"page":undefined} onClick={()=>navigate(item.tab)}><span className="nav-button-icon" aria-hidden="true">{item.icon}</span><span className="nav-button-label">{item.label}</span>{count ? <span className="nav-badge">{count}</span>:null}</button>;
 }
 return <><aside className="sidebar"><div className="brand-block brand-block-logo"><Image src={crmLogo} alt="One Address Riviera" className="crm-sidebar-logo" /></div><nav className="nav-list" aria-label="Navigation principale">{items.map(i=>button(i))}</nav><button className="secondary-button" onClick={onLogout}>Déconnexion</button></aside>
 <nav className="mobile-crm-navigation" aria-label="Navigation mobile principale">{items.slice(0,4).map(i=>button(i,true))}<button ref={moreButton} id="unified-more-trigger" type="button" className="mobile-crm-nav-button" aria-expanded={more} aria-controls="unified-more-panel" aria-haspopup="dialog" onClick={()=>setMore(!more)}>•••<span>Plus</span></button></nav>
 {more && <div className="mobile-sheet-backdrop unified-more-backdrop" onClick={()=>setMore(false)}>
  <section ref={morePanel} id="unified-more-panel" className="mobile-more-menu unified-more-panel" role="dialog" aria-modal="true" aria-labelledby="unified-more-title" onClick={e=>e.stopPropagation()} onKeyDown={event => {
   if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMore(false); }
   if (event.key !== "Tab") return;
   const buttons = morePanel.current?.querySelectorAll<HTMLButtonElement>("button");
   const first = buttons?.[0], last = buttons?.[buttons.length - 1];
   if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
   else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
   <header className="unified-more-header"><h2 id="unified-more-title">Modules autorisés</h2><button ref={closeButton} type="button" className="unified-more-close" onClick={()=>setMore(false)}>Fermer</button></header>
   <div className="unified-more-scroll">
    <nav className="unified-more-list" aria-label="Modules autorisés">
     {items.map(item => {
      const count = item.tab === "admin" ? 0 : badges[item.tab];
      return <button key={item.tab} type="button" className={`unified-more-button ${active === item.tab ? "is-active" : ""}`} aria-current={active === item.tab ? "page" : undefined} onClick={()=>navigate(item.tab)}>
       <span className="unified-more-icon" aria-hidden="true">{item.icon}</span>
       <span className="unified-more-label">{item.label}</span>
       {count ? <span className="unified-more-badge" aria-label={`${count} élément(s) à traiter`}>{count}</span> : null}
      </button>;
     })}
    </nav>
    <button type="button" className="unified-more-signout" onClick={onLogout}>Déconnexion</button>
   </div>
  </section>
 </div>}</>;
}
