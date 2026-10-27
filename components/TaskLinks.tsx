"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { isCivilDate, taskTargetKey } from "@/lib/tasks/domain";
import type { TaskApi, TaskLink, TaskLinkChanges, TaskTarget, TaskTargetRef } from "@/lib/tasks/types";
import { getVendorInvoiceRemaining, getVendorInvoiceStatus } from "@/lib/vendorFinance";
import { SearchMatchHint } from "./search/SearchMatchHint";
import { SearchableSelect } from "./search/SearchableSelect";
import { loadTaskHouses } from "@/lib/tasks/houseOptions";

const names: Record<string, [string, string]> = {
  contact: ["Contact", "Contact"], lead: ["Demande client", "Enquiry"], quote: ["Devis client", "Customer quote"], booking: ["Réservation", "Booking"],
  vendor_quote: ["Devis prestataire", "Vendor quote"], vendor_invoice: ["Facture prestataire", "Vendor invoice"], bank_account: ["Compte bancaire", "Bank account"],
  worker: ["Intervenant", "Worker"], worker_period: ["Période de travail", "Work period"], time_entry: ["Heures et frais", "Hours and expenses"], staff_payment: ["Paiement personnel", "Staff payment"],
  house: ["Maison suivie", "Tracked house"], property: ["Bien immobilier", "Property"], vehicle: ["Voiture", "Vehicle"], boat: ["Bateau", "Boat"],
  planning_entry: ["Planning", "Schedule"], fonciere_project: ["Projet Foncière", "Property project"], presentation: ["Présentation", "Presentation"],
  document: ["Document", "Document"], folder: ["Dossier", "Folder"], monthly_charges: ["Charges mensuelles", "Monthly charges"], publisher_creation: ["Création Publisher", "Publisher creation"]
};
export function taskTargetTypeLabel(type: string, language = "fr") { return names[type]?.[language === "en" ? 1 : 0] ?? type; }

export function TaskLinkCards({ links, onOpen, onRemove, onPrimary, disabled = false, openInNewTab = false }: {
  links: TaskLink[]; onOpen?: (reference: TaskTargetRef) => void; onRemove?: (id: string) => void;
  onPrimary?: (link: TaskLink) => void; disabled?: boolean; openInNewTab?: boolean;
}) {
  const { language, formatMoney, label } = useI18n(); const en = language === "en";
  return <div className="task-links-cards">{links.map(link => <article key={link.id} className="task-link-card" data-task-link-id={link.id} data-task-link-state={link.state}>
    <div><small>{link.target ? taskTargetTypeLabel(link.target.type, language) : en ? "CRM item" : "Élément CRM"}{link.primary ? en ? " · Primary" : " · Principal" : ""}</small>
      {link.state !== "inaccessible" && link.projectReference && <small>{link.projectReference}</small>}
      <strong>{link.state === "inaccessible" ? en ? "Item unavailable with your current access" : "Élément inaccessible avec vos droits actuels" : link.label || (en ? "Item no longer available" : "Élément devenu indisponible")}</strong>
      {link.state !== "inaccessible" && link.detail && <p>{link.detail}</p>}
      {link.state !== "inaccessible" && (link.financial ? <p>{label(["Annulé", "En attente de facture"].includes(link.financial.status) ? link.financial.status : getVendorInvoiceStatus(link.financial.amount, link.financial.paidAmount, link.financial.dueDate), "modules")} · {en ? "Remaining" : "Reste à payer"} : {formatMoney(getVendorInvoiceRemaining(link.financial))}</p> : link.status && <p>{label(link.status, "modules")}</p>)}
      {link.state === "archived" && <small>{en ? "Archived item · relation retained" : "Élément archivé · relation conservée"}</small>}
      {link.state === "deleted" && <small>{en ? "Deleted item · relation retained" : "Élément supprimé · relation conservée"}</small>}
    </div>
    <div className="task-link-actions">
      {link.target && ["available", "archived"].includes(link.state) && onOpen && <button type="button" disabled={disabled} onClick={() => onOpen(link.target!)}>{openInNewTab ? en ? "Open item in a new tab" : "Ouvrir l’élément dans un nouvel onglet" : en ? "Open item" : "Ouvrir l’élément"}</button>}
      {onPrimary && !link.primary && ["available", "archived"].includes(link.state) && (!link.id.startsWith("new:") || link.target) && <button type="button" disabled={disabled} onClick={() => onPrimary(link)}>{en ? "Make primary" : "Définir comme principal"}</button>}
      {onRemove && <button type="button" disabled={disabled} onClick={() => onRemove(link.id)}>{en ? "Remove link" : "Retirer le lien"}</button>}
    </div>
  </article>)}<TaskLinkStyles /></div>;
}

/** Mutations are explicit operations on stable IDs. A masked projection is never
 * submitted as a replacement, including after a permission refresh. */
export function TaskLinksEditor({ api, links, changes = {}, onChange, onOpen, disabled, scope }: {
  api: TaskApi; links: TaskLink[]; changes?: TaskLinkChanges; onChange: (changes: TaskLinkChanges) => void;
  onOpen?: (reference: TaskTargetRef) => void; disabled: boolean; scope: string;
}) {
  const { language } = useI18n(); const en = language === "en";
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState(""); const [type, setType] = useState("");
  const [page, setPage] = useState<{ items: TaskTarget[]; hasMore: boolean }>({ items: [], hasMore: false });
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [offset, setOffset] = useState(0);
  const [additions, setAdditions] = useState<TaskTarget[]>([]);
  const [configuring, setConfiguring] = useState<TaskTarget | null>(null);
  const [contextError, setContextError] = useState("");
  const searchEpoch = useRef(0), resolveEpoch = useRef(0);
  const additionKey = JSON.stringify(changes.add ?? []);
  useEffect(() => {
    const epoch = ++resolveEpoch.current;
    if (!api.resolveTargets || !changes.add?.length) return;
    let cancelled = false;
    const reload = () => {
      setAdditions([]);
      void api.resolveTargets!(JSON.parse(additionKey)).then(items => { if (!cancelled && epoch === resolveEpoch.current) setAdditions(items.filter(item => item?.ref?.type && item.ref.id && item.state !== "inaccessible")); }).catch(() => { if (!cancelled && epoch === resolveEpoch.current) setAdditions([]); });
    };
    reload(); const clock = window.setInterval(reload, 15000); window.addEventListener("focus", reload);
    return () => { cancelled = true; window.clearInterval(clock); window.removeEventListener("focus", reload); };
  }, [api, scope, additionKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const epoch = ++searchEpoch.current;
    let cancelled = false;
    if (!searching || !api.searchTargets) return;
    const timer = window.setTimeout(() => {
      setBusy(true); setPage({ items: [], hasMore: false }); setError("");
      void api.searchTargets!(query, type || undefined, offset, 40).then(result => {
        if (!cancelled && epoch === searchEpoch.current) setPage(result);
      }).catch(() => { if (!cancelled && epoch === searchEpoch.current) { setPage({ items: [], hasMore: false }); setError(en ? "Search unavailable. Check your access and retry." : "Recherche indisponible. Vérifiez vos droits et réessayez."); } }).finally(() => { if (!cancelled && epoch === searchEpoch.current) setBusy(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, searching, query, type, offset, scope, en]);
  const activeLinks = useMemo(() => {
    const removed = new Set(changes.remove ?? []);
    const existing = links.filter(link => !removed.has(link.id)).map(link => ({ ...link }));
    for (const ref of changes.add ?? []) {
      if (existing.some(link => link.target && taskTargetKey(link.target) === taskTargetKey(ref))) continue;
      const resolved = additions.find(item => taskTargetKey(item.ref) === taskTargetKey(ref));
      existing.push({ id: `new:${taskTargetKey(ref)}`, primary: false, state: resolved?.state ?? "inaccessible", ...(resolved ? { target: resolved.ref, label: resolved.label, projectReference: resolved.projectReference, projectNumber: resolved.projectNumber, detail: resolved.detail, status: resolved.status, financial: resolved.financial } : {}) });
    }
    if (Object.prototype.hasOwnProperty.call(changes, "primary")) for (const link of existing) link.primary = changes.primary?.linkId === link.id || Boolean(changes.primary?.target && link.target && taskTargetKey(changes.primary.target) === taskTargetKey(link.target));
    return existing;
  }, [links, changes, additions]);
  const closeSearch = () => { setConfiguring(null); setContextError(""); setSearching(false); setPage({ items: [], hasMore: false }); setQuery(""); setError(""); };
  function choose(target: TaskTarget) {
    if (["worker_period", "monthly_charges"].includes(target.ref.type)) { setConfiguring(target); setContextError(""); }
    else add(target);
  }
  function contextChange(key: string, value: string) {
    setConfiguring(previous => previous ? { ...previous, ref: { ...previous.ref, context: { ...previous.ref.context, [key]: value } } } : previous);
    setContextError("");
  }
  function addContext() {
    if (!configuring) return;
    const { ref } = configuring;
    if (ref.type === "worker_period" && (!isCivilDate(ref.context?.startDate ?? "") || !isCivilDate(ref.context?.endDate ?? "") || ref.context!.startDate > ref.context!.endDate)) { setContextError(en ? "Select a valid work period, with the end on or after the start." : "Choisissez une période de travail valide, avec la fin après le début."); return; }
    if (ref.type === "monthly_charges" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(ref.id)) { setContextError(en ? "Select a valid month." : "Choisissez un mois valide."); return; }
    const context = Object.fromEntries(Object.entries(ref.context ?? {}).filter(([, value]) => value !== ""));
    add({ ...configuring, ref: { ...ref, context } });
  }
  function add(target: TaskTarget) {
    if (disabled || activeLinks.some(link => link.target && taskTargetKey(link.target) === taskTargetKey(target.ref))) return;
    const next = { ...changes, add: [...(changes.add ?? []), target.ref] };
    if (!activeLinks.length && !Object.prototype.hasOwnProperty.call(changes, "primary")) next.primary = { target: target.ref };
    onChange(next); closeSearch();
  }
  function remove(id: string) {
    if (id.startsWith("new:")) {
      const ref = (changes.add ?? []).find(ref => `new:${taskTargetKey(ref)}` === id);
      onChange({ ...changes, add: (changes.add ?? []).filter(ref => `new:${taskTargetKey(ref)}` !== id), ...(ref && changes.primary?.target && taskTargetKey(ref) === taskTargetKey(changes.primary.target) ? { primary: null } : {}) });
    } else onChange({ ...changes, remove: [...new Set([...(changes.remove ?? []), id])], ...(changes.primary?.linkId === id || activeLinks.find(link => link.id === id)?.primary ? { primary: null } : {}) });
  }
  return <fieldset className="taskws-full task-links-editor" disabled={disabled}>
    <legend>{en ? "Linked items" : "Éléments liés"}</legend>
    <p className="taskws-help">{en ? "A task can stand alone. Completing it never validates or pays the linked item." : "Une tâche peut rester indépendante. La terminer ne valide ni ne règle l’élément lié."}</p>
    <TaskLinkCards links={activeLinks} onOpen={onOpen} openInNewTab onRemove={remove} onPrimary={link => onChange({ ...changes, primary: link.id.startsWith("new:") && link.target ? { target: link.target } : { linkId: link.id } })} disabled={disabled} />
    {!activeLinks.length && <p>{en ? "No linked items" : "Aucun élément lié"}</p>}
    {activeLinks.some(link => link.primary) && <button type="button" onClick={() => onChange({ ...changes, primary: null })}>{en ? "Clear primary item" : "Retirer le rôle principal"}</button>}
    {!searching ? <button type="button" disabled={!api.searchTargets} onClick={() => { setSearching(true); setOffset(0); }}>{en ? "Link a CRM item" : "Lier un élément du CRM"}</button> : <div className="task-link-search" onKeyDown={event => { if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) event.preventDefault(); }}>
      <label>{en ? "Search CRM items" : "Rechercher un élément du CRM"}<input type="search" autoFocus value={query} onChange={event => { setQuery(event.target.value); setOffset(0); }} placeholder={en ? "Name, company, city, title, reference…" : "Nom, entreprise, ville, titre, référence…"} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); if (event.key === "Escape") { event.preventDefault(); closeSearch(); } }} /></label>
      <label>{en ? "Item type" : "Type d’élément"}<select value={type} onChange={event => { setType(event.target.value); setOffset(0); }}><option value="">{en ? "All types" : "Tous les types"}</option>{Object.keys(names).map(key => <option value={key} key={key}>{taskTargetTypeLabel(key, language)}</option>)}</select></label>
      {busy && <p role="status">{en ? "Searching all authorized items…" : "Recherche dans tous les éléments autorisés…"}</p>}
      {error && <p role="alert">{error}</p>}
      {!busy && !error && !page.items.length && <p role="status">{en ? "No authorized matches" : "Aucun résultat autorisé"}</p>}
      <div aria-label={en ? "CRM search results" : "Résultats CRM"}>{[...new Set(page.items.map(item => item.ref.type))].map(group => <section key={group}><h4>{taskTargetTypeLabel(group, language)}</h4>{page.items.filter(item => item.ref.type === group).map(item => <article className="task-link-result" key={taskTargetKey(item.ref)} data-task-target-key={taskTargetKey(item.ref)}><div>{item.projectReference && <small>{item.projectReference}</small>}<strong>{item.label}</strong>{item.detail && <p>{item.detail}</p>}{item.status && <small>{item.status}</small>}<SearchMatchHint approximate={item.approximate === true} /></div><button type="button" disabled={activeLinks.some(link => link.target && taskTargetKey(link.target) === taskTargetKey(item.ref))} onClick={() => choose(item)}>{en ? "Link item" : "Lier l’élément"}</button></article>)}</section>)}</div>
      {configuring && <section className="task-link-context" aria-label={en ? "Link context" : "Contexte du rattachement"}><h4>{configuring.label}</h4>
        {configuring.ref.type === "worker_period" ? <><p>{en ? "This work period is separate from the task deadline. No time entry is required to create this link." : "Cette période de travail est distincte de l’échéance de la tâche. Aucune ligne d’heures n’est nécessaire pour créer ce lien."}</p><label>{en ? "Work period start" : "Début de la période de travail"}<input type="date" value={configuring.ref.context?.startDate ?? ""} onChange={event => contextChange("startDate", event.target.value)} /></label><label>{en ? "Work period end" : "Fin de la période de travail"}<input type="date" value={configuring.ref.context?.endDate ?? ""} onChange={event => contextChange("endDate", event.target.value)} /></label></> : <label>{en ? "Charges month" : "Mois des charges"}<input type="month" value={configuring.ref.id} onChange={event => { const id = event.target.value; setConfiguring(previous => previous ? { ...previous, ref: { ...previous.ref, id } } : previous); }} /></label>}
        {(configuring.ref.type === "worker_period" || configuring.ref.type === "monthly_charges") && <TaskHouseSelector key={scope} api={api} scope={scope} houseId={configuring.ref.context?.houseId ?? ""} onChange={houseId => contextChange("houseId", houseId)} disabled={disabled} />}
        {contextError && <p role="alert">{contextError}</p>}<div className="task-link-actions"><button type="button" onClick={addContext}>{en ? "Link this context" : "Lier ce contexte"}</button><button type="button" onClick={() => setConfiguring(null)}>{en ? "Cancel context" : "Annuler ce contexte"}</button></div>
      </section>}
      <div className="task-link-actions">{offset > 0 && <button type="button" disabled={busy} onClick={() => setOffset(value => Math.max(0, value - 40))}>{en ? "Previous page" : "Page précédente"}</button>}{page.hasMore && <button type="button" disabled={busy} onClick={() => setOffset(value => value + 40)}>{en ? "Next page" : "Page suivante"}</button>}<button type="button" onClick={closeSearch}>{en ? "Close search" : "Fermer la recherche"}</button></div>
    </div>}
  </fieldset>;
}

/** Selection and search are independent: typing cannot change houseId. Options
 * remain complete while the common select filters its suggestions locally. */
function TaskHouseSelector({ api, scope, houseId, onChange, disabled }: {
  api: TaskApi; scope: string; houseId: string; onChange: (houseId: string) => void; disabled: boolean;
}) {
  const { language } = useI18n(); const en = language === "en";
  const [snapshot, setSnapshot] = useState<{ scope: string; items: TaskTarget[]; status: "loading" | "ready" | "error" }>({ scope, items: [], status: "loading" });
  const [retry, setRetry] = useState(0);
  const epoch = useRef(0);
  useEffect(() => {
    let cancelled = false;
    let pending: AbortController | undefined;
    async function refresh() {
      pending?.abort();
      const controller = new AbortController(); pending = controller;
      const ticket = ++epoch.current;
      setSnapshot({ scope, items: [], status: "loading" });
      try {
        if (!api.searchTargets) throw new Error("Catalogue indisponible.");
        const items = await loadTaskHouses(api.searchTargets, controller.signal);
        if (!cancelled && ticket === epoch.current) setSnapshot({ scope, items, status: "ready" });
      } catch {
        if (!cancelled && ticket === epoch.current) setSnapshot({ scope, items: [], status: "error" });
      }
    }
    void refresh();
    const focus = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", focus);
    const timer = window.setInterval(focus, 15000);
    return () => { cancelled = true; pending?.abort(); window.removeEventListener("focus", focus); window.clearInterval(timer); };
  }, [api, scope, retry]);
  const houses = snapshot.scope === scope ? snapshot.items : [];
  const status = snapshot.scope === scope ? snapshot.status : "loading";
  const error = status === "error" ? en ? "Houses unavailable. Check your access and retry." : "Maisons indisponibles. Vérifiez vos droits et réessayez." : undefined;
  return <div className="task-house-selector" data-task-house-status={status}>
    <label>{en ? "House (optional)" : "Maison (facultatif)"}<SearchableSelect name="taskContextHouseId" aria-label={en ? "House (optional)" : "Maison (facultatif)"} value={houseId} loading={status === "loading"} error={error} disabled={disabled} placeholder={en ? "Name, address, city…" : "Nom, adresse, ville…"} onChange={event => {
      const id = event.currentTarget.value;
      if (!disabled && status === "ready" && (!id || houses.some(house => house.ref.id === id))) onChange(id);
    }}><option value="">{en ? "All houses" : "Toutes les maisons"}</option>{houses.map(house => <option value={house.ref.id} key={house.ref.id} data-search={[house.label,house.detail,...(house.searchFields ?? [])].filter(Boolean).join(" ")} data-secondary={house.detail}>{house.label}</option>)}{houseId && !houses.some(house => house.ref.id === houseId) && <option value={houseId} disabled>{en ? "Selected house (details unavailable)" : "Maison sélectionnée (détails indisponibles)"}</option>}</SearchableSelect></label>
    {status === "loading" && <p role="status">{en ? "Loading authorized houses…" : "Chargement des maisons autorisées…"}</p>}
    {error && <><p role="alert">{error}</p><button type="button" disabled={disabled} onClick={() => setRetry(value => value + 1)}>{en ? "Retry houses" : "Réessayer les maisons"}</button></>}
  </div>;
}

function TaskLinkStyles() { return <style jsx global>{`
.task-links-cards{display:grid;gap:8px;min-width:0}.task-link-card,.task-link-result{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px;border:1px solid #dce1e7;border-radius:8px;background:#f8fafb;overflow-wrap:anywhere}.task-link-card>div:first-child,.task-link-result>div{flex:1 1 200px;min-width:0}.task-link-card strong{display:block;margin:4px 0}.task-link-card p,.task-link-result p{margin:4px 0;font-size:13px}.task-link-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.task-link-search{display:grid;gap:10px;margin-top:12px}.task-link-result{margin:6px 0}.task-links-editor>button{margin:10px 6px 0 0}.task-link-search h4{margin:14px 0 6px}.task-link-context{display:grid;gap:10px;padding:12px;border:1px solid #a5b9ce;border-radius:8px}.task-link-card small{color:#626d7c}.task-link-result button{flex:0 0 auto}
/* The CRM mobile button rule uses width:100%; constrain only this selector’s inline controls. */
.task-house-selector [data-searchable-select] > span:first-child > button{width:32px;min-width:32px;max-width:32px}
.task-house-selector [data-searchable-select] > span:first-child > button:not(:last-child){right:39px}
.task-house-selector input[role="combobox"]{padding-right:78px}
`}</style>; }
