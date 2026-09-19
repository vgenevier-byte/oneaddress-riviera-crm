"use client";
import Image from "next/image";
import { useState } from "react";
import crmLogo from "../public/oar-logo-paysage-crm.png";
import { moduleItems, readable, type AccessSnapshot, type ModuleId } from "@/lib/access/modules";
export type UnifiedTab = ModuleId | "admin";
export default function UnifiedNavigation({ access, active, onNavigate, onLogout, badges = {} }: { access: AccessSnapshot; active: UnifiedTab; onNavigate: (tab: UnifiedTab) => void; onLogout: () => void; badges?: Partial<Record<ModuleId, number>> }) {
 const [more, setMore] = useState(false);
 const items = [...moduleItems.filter(i => readable(access,i.tab)), ...(access.generalAdmin ? [{ tab: "admin" as const, label: "Administration", icon: "⚙" }] : [])];
 const navigate = (tab: UnifiedTab) => { onNavigate(tab); setMore(false); };
 function button(item: typeof items[number], mobile = false) {
  const count = item.tab === "admin" ? 0 : badges[item.tab];
  return <button key={item.tab} type="button" className={mobile ? `mobile-crm-nav-button ${active===item.tab?"is-active":""}` : `nav-button ${active===item.tab?"active":""}`} aria-current={active===item.tab?"page":undefined} onClick={()=>navigate(item.tab)}><span className="nav-button-icon" aria-hidden="true">{item.icon}</span><span className="nav-button-label">{item.label}</span>{count ? <span className="nav-badge">{count}</span>:null}</button>;
 }
 return <><aside className="sidebar"><div className="brand-block brand-block-logo"><Image src={crmLogo} alt="One Address Riviera" className="crm-sidebar-logo" /></div><nav className="nav-list" aria-label="Navigation principale">{items.map(i=>button(i))}</nav><button className="secondary-button" onClick={onLogout}>Déconnexion</button></aside>
 <nav className="mobile-crm-navigation" aria-label="Navigation mobile principale">{items.slice(0,4).map(i=>button(i,true))}<button className="mobile-crm-nav-button" aria-expanded={more} onClick={()=>setMore(!more)}>•••<span>Plus</span></button></nav>
 {more && <div className="mobile-sheet-backdrop" onClick={()=>setMore(false)}><section className="mobile-more-menu" role="dialog" aria-modal="true" aria-label="Tous les modules" onClick={e=>e.stopPropagation()}><header className="mobile-sheet-header"><h2>Modules autorisés</h2><button onClick={()=>setMore(false)}>Fermer</button></header><div className="mobile-more-menu-scroll"><nav className="nav-list">{items.map(i=>button(i))}</nav><button onClick={onLogout}>Déconnexion</button></div></section></div>}</>;
}
