"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SearchableSelect } from "@/components/search/SearchableSelect";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { isCancelled, useScopedOperations } from "@/lib/access/operations";
import { createArbitrageRepository } from "@/lib/fonciere/arbitrage";
import styles from "./ProjectArbitrage.module.css";

type Config = { revision: number; vincent: string | null; annCharlotte: string | null };
type Account = { id: string; email: string; active: boolean; confirmed: boolean };
export default function ArbitrageAdministration({ users, onDirty }: { users: Account[]; onDirty: (dirty: boolean) => void }) {
  const { language } = useI18n();
  const t = useCallback((fr: string, en: string) => language === "fr" ? fr : en, [language]);
  const begin = useScopedOperations("admin");
  const [saved, setSaved] = useState<Config | null>(null), [draft, setDraft] = useState<Config | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const live = useRef(true);
  const dirty = Boolean(draft && saved && (draft.vincent !== saved.vincent || draft.annCharlotte !== saved.annCharlotte));
  const distinct = !draft?.vincent || !draft?.annCharlotte || draft.vincent !== draft.annCharlotte;
  useEffect(() => {
    live.current = true;
    void (async () => {
      try {
        const op = await begin();
        const next = await op.run(() => createArbitrageRepository(op.client).readConfig(op.signal));
        if (live.current) { setSaved(next); setDraft(next); }
      } catch (failure) { if (live.current && !isCancelled(failure)) setMessage("configuration-unavailable"); }
    })();
    return () => { live.current = false; };
  }, [begin]);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  async function save() {
    if (!draft || !distinct || busy) return;
    setBusy(true); setMessage("");
    try {
      const op = await begin();
      const next = await op.run(() => createArbitrageRepository(op.client).saveConfig(draft, op.signal));
      if (live.current) { setSaved(next); setDraft(next); setMessage(t("Comptes décideurs enregistrés. Aucun droit supplémentaire n’a été accordé ; les anciennes validations restent dans leur historique.", "Decision maker accounts saved. No additional rights were granted; previous approvals remain in their history.")); }
    } catch (failure) { if (live.current && !isCancelled(failure)) setMessage(t("Configuration non confirmée. Rechargez l’administration pour vérifier sa version ; votre sélection est conservée.", "Configuration was not confirmed. Reload Administration to check its version; your selection is retained.")); }
    finally { if (live.current) setBusy(false); }
  }
  return <section className={styles.admin} data-arbitrage-administration aria-labelledby="arbitrage-admin-title">
    <h2 id="arbitrage-admin-title">{t("Décideurs Foncière — Arbitrage", "Property decision makers — Arbitration")}</h2>
    <p>{t("Associez Vincent et Ann Charlotte à leurs véritables comptes CRM, distincts. Chaque compte pourra uniquement enregistrer son propre avis sur les projets auxquels il a accès.", "Link Vincent and Ann Charlotte to their distinct, real CRM accounts. Each account can only save its own opinion on projects it can access.")}</p>
    <p>{t("Les changements sont tracés. Une validation antérieure n’est jamais transférée au nouveau compte ; aucun droit de projet ou de présentation n’est ajouté.", "Changes are recorded. An existing approval is never transferred to a new account; no project or presentation permissions are added.")}</p>
    {draft ? <>
      <div className={styles.adminGrid}>{(["vincent", "annCharlotte"] as const).map(slot => <label htmlFor={`arbitrage-admin-${slot}`} key={slot}><span>{slot === "vincent" ? "Vincent" : "Ann Charlotte"}</span><SearchableSelect id={`arbitrage-admin-${slot}`} aria-label={t(`Compte CRM de ${slot === "vincent" ? "Vincent" : "Ann Charlotte"}`, `${slot === "vincent" ? "Vincent" : "Ann Charlotte"} CRM account`)} value={draft[slot] || ""} disabled={busy} onChange={event => { const value = event.target.value || null; setDraft(previous => previous ? { ...previous, [slot]: value } : previous); setMessage(""); }}>
        <option value="">{t("Compte à identifier", "Account to identify")}</option>
        {users.filter(account => account.active && account.confirmed || account.id === draft[slot]).map(account => <option key={account.id} value={account.id} disabled={!account.active || !account.confirmed} data-search={`${account.email} ${account.id}`} data-secondary={account.id}>{account.email}{!account.active ? ` · ${t("inactif", "inactive")}` : !account.confirmed ? ` · ${t("non confirmé", "unconfirmed")}` : ""}</option>)}
      </SearchableSelect></label>)}</div>
      {!distinct && <p className={styles.error} role="alert">{t("Vincent et Ann Charlotte doivent être associés à deux comptes distincts.", "Vincent and Ann Charlotte must be linked to two distinct accounts.")}</p>}
      <button type="button" disabled={busy || !dirty || !distinct} onClick={() => void save()}>{busy ? t("Enregistrement…", "Saving…") : t("Enregistrer les décideurs", "Save decision makers")}</button>
      {dirty && <p>{t("Configuration modifiée, non enregistrée.", "Configuration changed, not saved.")}</p>}
    </> : <p role="status">{t("Chargement de la configuration…", "Loading configuration…")}</p>}
    {message && <p role="status">{message === "configuration-unavailable" ? t("Configuration des décideurs indisponible.", "Decision maker configuration is unavailable.") : message}</p>}
  </section>;
}
