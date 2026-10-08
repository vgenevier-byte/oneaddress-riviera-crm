"use client";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { specialistMessage } from "@/lib/i18n/catalogs/specialist";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useScopedOperations, isCancelled } from "@/lib/access/operations";
import { readable, type AccessSnapshot } from "@/lib/access/modules";
import { supabase } from "@/lib/supabase";
import { readMonthlyCharges, patchMonthlyCharges } from "@/lib/monthlyCharges/client";
import { buildMonthlyCharges, evaluateMonthlyChargeEntries, exportAnnualChargesCsv, exportDetailedChargesCsv, findRecalculatedMonthlyCharges } from "@/lib/monthlyCharges/calculations";
import type { MonthlyChargesConfig, MonthlyChargesPatch, MonthlyChargesSnapshot, MonthlyChargeSource } from "@/lib/monthlyCharges/types";
import styles from "./MonthlyChargesWorkspace.module.css";

type ChargeEntry = ReturnType<typeof evaluateMonthlyChargeEntries>[number];
type ViewSource = MonthlyChargeSource | "all";
type SelectionDraft = { kind: "selection"; revision: string; original: MonthlyChargesConfig; config: MonthlyChargesConfig; requestId?: string; requestBody?: string };
type AttachmentDraft = { kind: "attachment"; revision: string; sourceId: string; mode: "default" | "month" | "spread"; month: string; startMonth: string; endMonth: string; original: string; requestId?: string; requestBody?: string };
type Draft = SelectionDraft | AttachmentDraft;
// Drafts contain only parameter edits. They are never written to localStorage or
// shared with another Auth identity; source labels/amounts are always reprojected.
const retainedDrafts = new Map<string, Draft>();
const identity = (source: MonthlyChargeSource, id: string) => `${source}:${id}`;
const cloneConfig = (config: MonthlyChargesConfig): MonthlyChargesConfig => structuredClone(config);

function selectionPatch(draft: SelectionDraft): MonthlyChargesPatch {
  const personIds = new Set([...draft.original.personRules, ...draft.config.personRules].map(row => identity(row.source, row.personId)));
  const exceptionIds = new Set([...draft.original.exceptions, ...draft.config.exceptions].map(row => identity(row.source, row.sourceId)));
  const personRules: NonNullable<MonthlyChargesPatch["personRules"]> = [];
  const exceptions: NonNullable<MonthlyChargesPatch["exceptions"]> = [];
  for (const key of personIds) {
    const before = draft.original.personRules.find(row => identity(row.source, row.personId) === key);
    const after = draft.config.personRules.find(row => identity(row.source, row.personId) === key);
    if (Boolean(before) !== Boolean(after)) { const row = after ?? before!; personRules.push({ source: row.source, personId: row.personId, included: Boolean(after) }); }
  }
  for (const key of exceptionIds) {
    const before = draft.original.exceptions.find(row => identity(row.source, row.sourceId) === key);
    const after = draft.config.exceptions.find(row => identity(row.source, row.sourceId) === key);
    if (JSON.stringify(before) !== JSON.stringify(after)) { const row = after ?? before!; exceptions.push({ source: row.source, sourceId: row.sourceId, included: after?.included ?? null, ...(after?.reason ? { reason: after.reason } : {}) }); }
  }
  return { ...(personRules.length ? { personRules } : {}), ...(exceptions.length ? { exceptions } : {}) };
}

function attachmentFields(draft: AttachmentDraft) {
  return JSON.stringify({ mode: draft.mode, month: draft.month, startMonth: draft.startMonth, endMonth: draft.endMonth });
}

function isDraftDirty(draft: Draft | null) {
  if (!draft) return false;
  return draft.kind === "selection" ? Object.keys(selectionPatch(draft)).length > 0 : attachmentFields(draft) !== draft.original;
}

function applyPatch(config: MonthlyChargesConfig, patch: MonthlyChargesPatch) {
  const next = cloneConfig(config);
  for (const row of patch.personRules ?? []) {
    next.personRules = next.personRules.filter(item => item.source !== row.source || item.personId !== row.personId);
    if (row.included) next.personRules.push({ source: row.source, personId: row.personId, included: true });
  }
  for (const row of patch.exceptions ?? []) {
    next.exceptions = next.exceptions.filter(item => item.source !== row.source || item.sourceId !== row.sourceId);
    if (row.included !== null) next.exceptions.push({ source: row.source, sourceId: row.sourceId, included: row.included, ...(row.reason ? { reason: row.reason } : {}) });
  }
  return next;
}

function restrictDraft(draft: Draft, snapshot: MonthlyChargesSnapshot): Draft | null {
  const allowed = new Set(snapshot.permissions.readableSources);
  const visibleSource = (source: MonthlyChargeSource, id: string) => allowed.has(source) && (
    snapshot.sources[source === "invoice" ? "invoices" : "timeEntries"].some(row => row.id === id) ||
    snapshot.config.exceptions.some(row => row.source === source && row.sourceId === id) ||
    snapshot.config.attachments.some(row => row.source === source && row.sourceId === id));
  if (draft.kind === "attachment") return visibleSource("invoice", draft.sourceId) ? draft : null;
  const restrictConfig = (config: MonthlyChargesConfig): MonthlyChargesConfig => ({
    personRules: config.personRules.filter(row => allowed.has(row.source) && snapshot.sources[row.source === "invoice" ? "suppliers" : "workers"].some(person => person.id === row.personId)),
    exceptions: config.exceptions.filter(row => visibleSource(row.source, row.sourceId)),
    attachments: config.attachments.filter(row => visibleSource(row.source, row.sourceId))
  });
  const original = restrictConfig(draft.original), config = restrictConfig(draft.config);
  const changed = JSON.stringify(original) !== JSON.stringify(draft.original) || JSON.stringify(config) !== JSON.stringify(draft.config);
  return { ...draft, original, config, ...(changed ? { requestId: undefined, requestBody: undefined } : {}) };
}

function errorMessage(error: unknown, action: "read" | "save" | "export") {
  const raw = error instanceof Error ? error.message : "";
  if (isCancelled(error)) return "Opération interrompue : le compte ou les droits ont changé. Rechargez les données autorisées avant de reprendre.";
  if (raw.includes("revision_conflict")) return "Conflit : une autre personne a modifié la sélection. Votre saisie est conservée. Actualisez, puis choisissez de reprendre votre saisie sur la version actualisée.";
  if (raw.includes("export_forbidden")) return "Export refusé pour ce périmètre. Choisissez uniquement des sources pour lesquelles vous avez le droit d’export.";
  if (/forbidden/.test(raw)) return "Action refusée par les droits actuels. Votre saisie reste conservée pour ce compte.";
  if (raw.includes("invalid_monthly_patch")) return "Les paramètres ne sont pas valides. Vérifiez votre sélection et les mois ; votre saisie est conservée.";
  if (action === "save") return "Enregistrement non confirmé. Votre saisie est conservée ; vérifiez la connexion puis réessayez.";
  if (action === "export") return "Export non confirmé. Actualisez vos données et vos droits avant de réessayer.";
  return "Chargement indisponible. Réessayez avec Actualiser.";
}

export default function MonthlyChargesWorkspace({ access, userId, onDirtyChange, onNavigateSource }: {
  access: AccessSnapshot;
  userId: string;
  onDirtyChange?: (dirty: boolean) => void;
  onNavigateSource?: (module: "vendorInvoices" | "houseTracking", sourceId: string) => void;
}) {
  const { t, label: displayLabel, formatDate: screenDate, formatMoney: screenMoney, locale } = useI18n();
  const sourceLabel = (source: MonthlyChargeSource) => displayLabel(source === "invoice" ? "Factures prestataires" : "Personnel & interventions", "charges");
  const money = (cents: number | null) => cents === null ? t("charges.invalidAmount") : screenMoney(cents / 100);

  const monthLabels = Array.from({length:12}, (_,index) => screenDate(`2000-${String(index+1).padStart(2,"0")}-15`, {month:"long"}));
  const begin = useScopedOperations("monthlyCharges");
  const [snapshot, setSnapshot] = useState<MonthlyChargesSnapshot | null>(null);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [monthIndex, setMonthIndex] = useState(() => new Date().getMonth());
  const [houseId, setHouseId] = useState("");
  const [source, setSource] = useState<ViewSource>("all");
  const [draft, setDraft] = useState<Draft | null>(() => retainedDrafts.get(userId) ?? null);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const mounted = useRef(true);
  const loadVersion = useRef(0);
  const savePending = useRef(false);
  const exportPending = useRef(false);
  const snapshotRef = useRef<MonthlyChargesSnapshot | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const canContribute = Boolean(snapshot?.permissions.canContribute && access.modules.monthlyCharges?.level === "contribute");
  const canExport = Boolean(access.modules.monthlyCharges?.sensitive.export);
  const filters = useMemo(() => ({ source, ...(houseId ? { houseId } : {}) }), [source, houseId]);
  const calculation = useMemo(() => {
    try { return { result: snapshot ? buildMonthlyCharges(snapshot, year, filters) : null, error: "" }; }
    catch { return { result: null, error: "Les montants enregistrés ne permettent pas un total fiable. Vérifiez les valeurs sources avant de poursuivre." }; }
  }, [snapshot, year, filters]);
  const result = calculation.result;
  const allEntries = useMemo(() => snapshot ? evaluateMonthlyChargeEntries(snapshot) : [], [snapshot]);
  const viewedMonth = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  const dirty = isDraftDirty(draft);
  const draftKind = draft?.kind;
  const hasProjection = Boolean(snapshot);

  const accept = useCallback((next: MonthlyChargesSnapshot) => { snapshotRef.current = next; setSnapshot(next); setDraft(previous => previous ? restrictDraft(previous, next) : null); }, []);
  const refresh = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true); setError("");
    try {
      const operation = await begin();
      const next = await readMonthlyCharges(operation);
      if (!mounted.current || version !== loadVersion.current) return;
      const previous = snapshotRef.current;
      if (previous && findRecalculatedMonthlyCharges(previous, next).length) setMessage("Un montant source a changé. Les rattachements personnalisés et répartitions sont recalculés depuis les montants actuellement enregistrés.");
      accept(next);
    } catch (failure) {
      if (mounted.current && version === loadVersion.current) { setError(errorMessage(failure, "read")); if (isCancelled(failure)) { snapshotRef.current = null; setSnapshot(null); } }
    } finally { if (mounted.current && version === loadVersion.current) setLoading(false); }
  }, [begin, accept]);

  useEffect(() => { mounted.current = true; void Promise.resolve().then(() => { if (mounted.current) void refresh(); }); return () => { mounted.current = false; }; }, [refresh]);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== userId) { retainedDrafts.clear(); mounted.current = false; snapshotRef.current = null; setSnapshot(null); setDraft(null); }
    });
    return () => subscription.unsubscribe();
  }, [userId]);
  useEffect(() => {
    if (draft && dirty) retainedDrafts.set(userId, draft); else retainedDrafts.delete(userId);
    onDirtyChange?.(dirty);
  }, [draft, dirty, userId, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    if (!draftKind || !hasProjection) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLElement>("input,select,button")?.focus();
    return () => { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); };
  }, [draftKind, hasProjection]);

  function discard() { if (savePending.current) return; retainedDrafts.delete(userId); setDraft(null); setSearch(""); setError(""); }
  function openSelection() {
    if (!snapshot || !canContribute) return;
    setError(""); setSearch("");
    setDraft({ kind: "selection", revision: snapshot.revision, original: cloneConfig(snapshot.config), config: cloneConfig(snapshot.config) });
  }
  function updateSelection(change: (config: MonthlyChargesConfig) => MonthlyChargesConfig) {
    setDraft(previous => previous?.kind === "selection" ? { ...previous, config: change(previous.config), requestId: undefined, requestBody: undefined } : previous);
  }
  function setPerson(source: MonthlyChargeSource, personId: string, included: boolean) {
    updateSelection(config => ({ ...config, personRules: [...config.personRules.filter(row => row.source !== source || row.personId !== personId), ...(included ? [{ source, personId, included: true as const }] : [])] }));
  }
  function setException(entry: ChargeEntry, mode: string, reason?: string) {
    updateSelection(config => ({ ...config, exceptions: [...config.exceptions.filter(row => row.source !== entry.source || row.sourceId !== entry.sourceId), ...(mode === "auto" ? [] : [{ source: entry.source, sourceId: entry.sourceId, included: mode === "include", ...(reason ? { reason } : {}) }])] }));
  }
  function openAttachment(entry: ChargeEntry) {
    if (!snapshot || !canContribute || entry.source !== "invoice") return;
    const current = snapshot.config.attachments.find(row => row.sourceId === entry.sourceId);
    const sourceMonth = /^\d{4}-\d{2}-\d{2}$/.test(entry.sourceDate ?? "") ? entry.sourceDate!.slice(0, 7) : viewedMonth;
    const next: AttachmentDraft = { kind: "attachment", sourceId: entry.sourceId, revision: snapshot.revision, mode: current?.mode ?? "default", month: current?.mode === "month" ? current.month : sourceMonth, startMonth: current?.mode === "spread" ? current.startMonth : sourceMonth, endMonth: current?.mode === "spread" ? current.endMonth : sourceMonth, original: "" };
    next.original = attachmentFields(next); setDraft(next); setError("");
  }
  function updateAttachment(values: Partial<AttachmentDraft>) { setDraft(previous => previous?.kind === "attachment" ? { ...previous, ...values, requestId: undefined, requestBody: undefined } : previous); }

  async function saveDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !canContribute || savePending.current) return;
    let patch: MonthlyChargesPatch;
    if (draft.kind === "selection") patch = selectionPatch(draft);
    else {
      const monthNumber = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) : NaN;
      if (draft.mode === "month" && !Number.isFinite(monthNumber(draft.month))) { setError("Choisissez un mois de rattachement valide."); return; }
      if (draft.mode === "spread") {
        const length = monthNumber(draft.endMonth) - monthNumber(draft.startMonth) + 1;
        if (!Number.isFinite(length) || length < 1 || length > 12) { setError("La répartition doit couvrir de 1 à 12 mois consécutifs."); return; }
      }
      patch = { attachments: [draft.mode === "default" ? { source: "invoice", sourceId: draft.sourceId, mode: "default" } : draft.mode === "month" ? { source: "invoice", sourceId: draft.sourceId, mode: "month", month: draft.month } : { source: "invoice", sourceId: draft.sourceId, mode: "spread", startMonth: draft.startMonth, endMonth: draft.endMonth }] };
    }
    if (!isDraftDirty(draft)) { discard(); return; }
    savePending.current = true; setSaving(true); setError("");
    const requestBody = JSON.stringify(patch);
    const submitted = { ...draft, requestBody, requestId: draft.requestBody === requestBody && draft.requestId ? draft.requestId : crypto.randomUUID() };
    setDraft(submitted); retainedDrafts.set(userId, submitted);
    ++loadVersion.current;
    try {
      const operation = await begin();
      const next = await patchMonthlyCharges(operation, submitted.revision, patch, submitted.requestId);
      if (!mounted.current) return;
      accept(next); retainedDrafts.delete(userId); setDraft(null); setSearch(""); setMessage("Sélection et rattachements confirmés par le serveur.");
    } catch (failure) {
      if (mounted.current) { setError(errorMessage(failure, "save")); if (isCancelled(failure)) { snapshotRef.current = null; setSnapshot(null); } }
    } finally { savePending.current = false; if (mounted.current) { setSaving(false); setLoading(false); } }
  }

  function rebaseDraft() {
    if (!snapshot || !draft || savePending.current) return;
    if (draft.kind === "selection") setDraft({ ...draft, revision: snapshot.revision, original: cloneConfig(snapshot.config), config: applyPatch(snapshot.config, selectionPatch(draft)), requestId: undefined, requestBody: undefined });
    else setDraft({ ...draft, revision: snapshot.revision, requestId: undefined, requestBody: undefined });
    setError(""); setMessage("Votre saisie est reprise sur la version actualisée. Vérifiez-la avant d’enregistrer.");
  }

  async function exportCsv(detailed: boolean) {
    if (!canExport || exportPending.current || !snapshot) return;
    exportPending.current = true; setExporting(true); setError("");
    const projectionVersion = loadVersion.current;
    const requested: MonthlyChargeSource[] = source === "all" ? [...snapshot.permissions.readableSources] : [source];
    try {
      const operation = await begin();
      const fresh = await readMonthlyCharges(operation, { export: true, sources: requested });
      const currentResult = buildMonthlyCharges(fresh, year, filters);
      const scope = { source, ...(houseId ? { houseId, houseLabel: fresh.sources.houses.find(row => row.id === houseId)?.name ?? "Maison sélectionnée" } : {}) };
      const csv = detailed ? exportDetailedChargesCsv(currentResult, scope, viewedMonth) : exportAnnualChargesCsv(currentResult, scope);
      // A restricted export projection must not replace the page's wider read
      // projection or erase the configuration shown in the selection form.
      const display = source === "all" ? fresh : await readMonthlyCharges(operation);
      await operation.download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `charges-${detailed ? viewedMonth : year}${detailed ? "-detail" : "-annuel"}.csv`);
      if (mounted.current) {
        if (projectionVersion === loadVersion.current) accept(display);
        setMessage("Export du périmètre autorisé créé depuis une nouvelle lecture serveur.");
      }
    } catch (failure) { if (mounted.current) { setError(errorMessage(failure, "export")); if (isCancelled(failure)) { snapshotRef.current = null; setSnapshot(null); } } }
    finally { exportPending.current = false; if (mounted.current) setExporting(false); }
  }

  function sourceNavigation(entry: ChargeEntry) {
    const targetModule = entry.source === "invoice" ? "vendorInvoices" : "houseTracking";
    if (readable(access, targetModule)) onNavigateSource?.(targetModule, entry.sourceId);
  }
  function entryCard(entry: ChargeEntry, inMonth?: string, outsideTotal = false) {
    const allocation = inMonth ? entry.allocations.find(row => row.month === inMonth) : undefined;
    const origin = allocation?.origin ?? entry.allocations[0]?.origin;
    const originalTarget = snapshot?.sources[entry.source === "invoice" ? "invoices" : "timeEntries"].some(row => row.id === entry.sourceId);
    return <article className={styles.entry} key={`${entry.key}-${inMonth ?? "all"}`}>
      <div className={styles.entryTop}><div><p className={styles.entryTitle}>{entry.title}</p><span className={styles.muted}>{entry.personLabel} · {sourceLabel(entry.source)}</span></div><strong className={styles.entryAmount}>{money(allocation?.amountCents ?? entry.amountCents)}</strong></div>
      <span className={`${styles.badge} ${!entry.selected ? styles.excludedBadge : ""}`}>{entry.selected ? t("charges.selectionnee_f48321") : t("charges.exclue_de_la_synthese_83c18b")}</span>
      <span className={styles.badge}>{entry.selectionOrigin === "individual" ? t("charges.exception_individuelle_e457cd") : entry.selectionOrigin === "person" ? t("charges.regle_de_personne_b70de5") : t("charges.aucune_regle_3738a8")}</span>
      {entry.sourceStatus && <span className={styles.badge}>{t("charges.statut_source_b1adcf")}{" "}{displayLabel(entry.sourceStatus,"crm")}</span>}
      {(outsideTotal || entry.status !== "included") && <span className={`${styles.badge} ${styles.excludedBadge}`}>{t("charges.hors_total_mensuel_39fc9e")}</span>}
      <dl className={styles.metadata}><div><dt>{t("charges.date_source_effbb2")}</dt><dd>{entry.sourceDate ? screenDate(entry.sourceDate) : t("charges.non_renseignee_d6a3c5")}</dd></div><div><dt>{t("charges.mois_retenu_8b6fea")}</dt><dd>{allocation?.month ?? (entry.allocations.length ? entry.allocations.map(row => row.month).join(", ") : t("charges.chooseMonth"))}</dd></div><div><dt>{t("charges.provenance_dd35a8")}</dt><dd>{displayLabel(origin ?? (entry.source === "hours" ? "Date d’intervention" : "Rattachement à définir"),"charges")}</dd></div></dl>
      {entry.reason && <p className={styles.muted}>{t("charges.motif_15bdb0")}{" "}{entry.reason}</p>}
      {entry.issues.length > 0 && <p className={styles.error}>{entry.issues.map(issue => displayLabel(issue,"charges")).join(" · ")}</p>}
      <div className={styles.entryActions}>{originalTarget && onNavigateSource && <button type="button" className="secondary-button" onClick={() => sourceNavigation(entry)}>{entry.source === "invoice" ? t("charges.ouvrir_la_facture_source_24fddc") : t("charges.ouvrir_les_heures_source_0a7473")}</button>}{canContribute && originalTarget && entry.source === "invoice" && <button type="button" className="secondary-button" onClick={() => openAttachment(entry)}>{t("charges.rattachement_repartition_5ecd63")}</button>}</div>
    </article>;
  }

  const currentMonth = result?.months[monthIndex];
  const monthEntries = result?.entries.filter(entry => entry.status === "included" && entry.allocations.some(allocation => allocation.month === viewedMonth)) ?? [];
  const previousTotal = useMemo(() => {
    if (!result) return null;
    if (monthIndex > 0) return result.months[monthIndex - 1].totalCents;
    try { return snapshot ? buildMonthlyCharges(snapshot, year - 1, filters).months[11].totalCents : null; }
    catch { return null; }
  }, [result, monthIndex, snapshot, year, filters]);
  const monthChange = currentMonth && previousTotal !== null ? currentMonth.totalCents - previousTotal : null;
  const query = search.trim().toLocaleLowerCase("fr");
  const selectionEntries = allEntries.filter(entry => snapshot?.sources[entry.source === "invoice" ? "invoices" : "timeEntries"].some(row => row.id === entry.sourceId) && (!query || `${entry.title} ${entry.personLabel} ${entry.sourceDate ?? ""}`.toLocaleLowerCase("fr").includes(query)));
  const attachmentEntry = draft?.kind === "attachment" ? allEntries.find(entry => entry.source === "invoice" && entry.sourceId === draft.sourceId) : undefined;

  return <div className={styles.workspace} aria-busy={loading || saving}>
    <header className={styles.header}><div><p className="eyebrow">{t("charges.crm_interne_1e84ef")}{" "}{canContribute ? t("charges.contribution_982d5a") : t("charges.lecture_3bdb36")}</p><h1>{t("charges.charges_mensuelles_04bd94")}</h1><p className={styles.intro}>{t("charges.voir_ce_que_chaque_mois_coute_independamment_34ddc1")}</p></div><div className={styles.actions}><button type="button" className="secondary-button" disabled={loading || saving} onClick={() => void refresh()}>{loading ? t("charges.chargement_01cba1") : t("charges.actualiser_9d3b2a")}</button>{canContribute && <button type="button" className="primary-button" disabled={saving} onClick={openSelection}>{t("charges.selectionner_mes_charges_c28c34")}</button>}</div></header>
    <p className={styles.notice}>{t("charges.vue_limitee_a_vos_sources_autorisees_la_sele_16c0d0")}</p>
    {message && <p className={styles.notice} role="status">{specialistMessage(message,t)}</p>}
    {error && !draft && <p className={styles.error} role="alert">{specialistMessage(error,t)}</p>}
    {calculation.error && <p className={styles.error} role="alert">{specialistMessage(calculation.error,t)}</p>}
    {!snapshot ? <div className={styles.empty} role="status">{loading ? t("charges.chargement_des_sources_autorisees_9f11e8") : t("charges.aucune_donnee_chargee_utilisez_actualiser_po_ec3bf6")}{error && draft && <p className={styles.error} role="alert">{specialistMessage(error,t)}{" "}{t("charges.votre_brouillon_reste_conserve_pour_ce_compt_a76e2d")}</p>}</div> : !snapshot.permissions.readableSources.length ? <div className={styles.empty}><h2>{t("charges.aucune_source_autorisee_dc76ae")}</h2><p>{t("charges.la_page_charges_mensuelles_necessite_la_lect_2dd1fb")}</p></div> : result && <>
      <div className={styles.toolbar} aria-label={t("charges.filtres_temporaires_945fc5")}><label>{t("charges.annee_1f910d")}<input type="number" min="1900" max="9999" value={year} onChange={event => { const value = Number(event.target.value); if (value >= 1900 && value <= 9999) setYear(value); }} /></label><label>{t("charges.source_6da13a")}<select value={source} onChange={event => setSource(event.target.value as ViewSource)}><option value="all">{t("charges.toutes_les_sources_autorisees_993b11")}</option>{snapshot.permissions.readableSources.includes("invoice") && <option value="invoice">{t("charges.factures_prestataires_8cb043")}</option>}{snapshot.permissions.readableSources.includes("hours") && <option value="hours">{t("charges.personnel_amp_interventions_7ecead")}</option>}</select></label>{snapshot.permissions.readableSources.includes("hours") && <label>{t("charges.maison_a21317")}<select value={houseId} onChange={event => setHouseId(event.target.value)}><option value="">{t("charges.toutes_les_maisons_8f7acd")}</option>{snapshot.sources.houses.map(house => <option key={house.id} value={house.id}>{house.name}</option>)}</select></label>}{canExport && <div className={styles.actions}><button type="button" className="secondary-button" disabled={exporting} onClick={() => void exportCsv(false)}>{exporting ? t("charges.export_0a1163") : t("charges.csv_annuel_b36907")}</button><button type="button" className="secondary-button" disabled={exporting} onClick={() => void exportCsv(true)}>{t("charges.csv_du_mois_detaille_53ce2a")}</button></div>}</div>
      <div className={styles.summary}><div className={styles.summaryCard}><p>{t("charges.total_des_charges_selectionnees_d68abe")}{" "}{year}</p><strong>{money(result.totalCents)}</strong></div><div className={styles.summaryCard}><p>{monthLabels[monthIndex]} {year}</p><strong>{money(currentMonth?.totalCents ?? 0)}</strong></div><div className={styles.summaryCard}><p>{t("charges.mois_precedent_meme_perimetre_a0f693")}</p><strong>{previousTotal === null ? t("charges.indisponible_c04980") : money(previousTotal)}</strong></div></div>
      <section className={styles.section} aria-labelledby="monthly-detail-title"><div className={styles.monthHeading}><h2 id="monthly-detail-title">{t("charges.detail_de_ec3cfd")}{" "}{monthLabels[monthIndex].toLowerCase()} {year}</h2><label className={styles.monthControl}>{t("charges.mois_0d304b")}<select aria-label={t("charges.mois_affiche_5a1b7f")} value={monthIndex} onChange={event => setMonthIndex(Number(event.target.value))}>{monthLabels.map((label, index) => <option key={index} value={index}>{label} {year}{result.months[index].current ? t("charges._en_cours_b365c3") : result.months[index].future ? t("charges._a_venir_f0b48d") : ""}</option>)}</select></label></div><p className={styles.muted}>{monthChange === null ? t("charges.comparaison_indisponible_montants_sources_a_d32786") : <>{t("charges.variation_sur_le_meme_perimetre_2b7406")}{" "}{money(monthChange)}{previousTotal ? ` (${new Intl.NumberFormat(locale, { maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(monthChange / previousTotal * 100)} %)` : t("charges._pas_de_pourcentage_la_base_precedente_est_n_a42681")}.</>}</p>{currentMonth?.current && <p className={styles.notice}>{t("charges.mois_en_cours_les_charges_enregistrees_peuve_aec0ba")}</p>}{currentMonth?.future && <p className={styles.notice}>{t("charges.mois_a_venir_seules_les_charges_deja_enregis_190d80")}</p>}<div className={styles.details}>{monthEntries.length ? monthEntries.map(entry => entryCard(entry, viewedMonth)) : <p className={styles.empty}>{t("charges.aucune_charge_retenue_pour_ce_mois_dans_les_244e76")}</p>}</div></section>
      <section className={styles.section} aria-labelledby="annual-charges-title"><h2 id="annual-charges-title">{t("charges.synthese_annuelle_9508ee")}{" "}{year}</h2><p className={styles.muted}>{t("charges.un_zero_indique_l_absence_de_charge_retenue_9d6d11")}</p><div className={styles.tableScroll} tabIndex={0} role="region" aria-label={t("charges.tableau_annuel_des_charges_defilement_horizo_7aa5fc")}><table className={styles.annual}><thead><tr><th scope="col">{t("charges.source_personne_615073")}</th>{monthLabels.map((label, index) => <th key={index} scope="col"><button type="button" className={index === monthIndex ? styles.activeMonth : ""} aria-label={t("charges.viewMonth",{month:label,year})} onClick={() => setMonthIndex(index)}>{label.slice(0, 3)}{result.months[index].current ? " ●" : result.months[index].future ? " ◦" : ""}</button></th>)}<th scope="col">{t("charges.annee_1f910d")}</th></tr></thead><tbody>{(["invoice", "hours"] as MonthlyChargeSource[]).filter(kind => snapshot.permissions.readableSources.includes(kind) && (source === "all" || source === kind)).map(kind => <FragmentRows key={kind} source={kind} groups={result.groups} months={result.months} />)}<tr className={styles.total}><th scope="row">{t("charges.total_des_charges_selectionnees_d16bba")}</th>{result.months.map(row => <td key={row.month}>{money(row.totalCents)}</td>)}<td>{money(result.totalCents)}</td></tr></tbody></table></div></section>
      <section className={styles.section} aria-labelledby="quality-charges-title"><h2 id="quality-charges-title">{t("charges.autres_depenses_du_perimetre_f49a25")}</h2><p className={styles.muted}>{t("charges.les_factures_attendues_depenses_a_rattacher_239f8d")}</p>{[{ label: "Factures attendues", entries: result.expected }, { label: "À rattacher", entries: result.unattached }, { label: "Exclues", entries: result.excluded }, { label: "Données à vérifier", entries: result.issues }, ...(houseId ? [{ label: "Factures · maison non renseignée", entries: result.houseUnknown }] : [])].map(section => <details key={section.label} className={styles.accordion}><summary>{displayLabel(section.label,"charges")} · {section.entries.length}</summary><div className={styles.details}>{section.entries.length ? section.entries.map(entry => entryCard(entry, undefined, section.label === "Factures · maison non renseignée")) : <p className={styles.muted}>{t("charges.aucun_element_dans_ce_perimetre_e0b4a7")}</p>}</div></details>)}</section>
    </>}
    {draft && snapshot && canContribute && <div className={styles.backdrop}><section ref={dialog} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="monthly-charges-dialog-title" onKeyDown={event => {
      if (event.key === "Escape" && !saving) { event.preventDefault(); discard(); }
      if (event.key === "Tab") { const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]'); const first = elements?.[0], last = elements?.[elements.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    }}><h2 id="monthly-charges-dialog-title">{draft.kind === "selection" ? t("charges.selectionner_mes_charges_c28c34") : t("charges.rattachement_de_la_facture_d10be8")}</h2><form onSubmit={event => void saveDraft(event)}><fieldset disabled={saving}>
      {draft.kind === "selection" ? <><p className={styles.muted}>{t("charges.suivre_une_personne_inclut_ses_depenses_pres_009ced")}</p><label className={styles.field}>{t("charges.rechercher_une_personne_ou_une_depense_a1a85c")}<input className={styles.search} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t("charges.nom_autorise_intitule_ou_date_4f83a4")} /></label>{([{ source: "invoice" as const, label: "Suivre ce fournisseur", people: snapshot.sources.suppliers }, { source: "hours" as const, label: "Suivre cet intervenant", people: snapshot.sources.workers }]).filter(section => snapshot.permissions.readableSources.includes(section.source)).map(section => <section key={section.source}><h3>{sourceLabel(section.source)}</h3><div className={styles.personGrid}>{section.people.filter(person => !query || person.label.toLocaleLowerCase("fr").includes(query)).map(person => <label className={styles.personOption} key={identity(section.source, person.id)}><input type="checkbox" checked={draft.config.personRules.some(rule => rule.source === section.source && rule.personId === person.id)} onChange={event => setPerson(section.source, person.id, event.target.checked)} /><span>{person.label}<small>{displayLabel(section.label,"charges")}{" "}{t("charges._depenses_existantes_et_futures_76c1a8")}{section.source === "hours" && "status" in person && person.status === "Inactif" ? t("charges._intervenant_archive_6afebc") : ""}</small></span></label>)}</div></section>)}<h3>{t("charges.depenses_individuelles_b70413")}</h3><p className={styles.muted}>{t("charges._inclure_seulement_cette_depense_n_abonne_pa_748cf1")}</p>{selectionEntries.map(entry => { const exception = draft.config.exceptions.find(row => row.source === entry.source && row.sourceId === entry.sourceId); const mode = exception ? exception.included ? "include" : "exclude" : "auto"; const follows = draft.config.personRules.some(row => row.source === entry.source && row.personId === entry.personId); return <div className={styles.selectionRow} key={entry.key}><div><p className={styles.entryTitle}>{entry.title}</p><p className={styles.muted}>{entry.personLabel} · {sourceLabel(entry.source)} · {entry.sourceDate ? screenDate(entry.sourceDate) : t("charges.date_non_renseignee_92d127")} · {money(entry.amountCents)}</p><span className={styles.badge}>{mode === "auto" ? follows ? t("charges.retenue_par_la_regle_de_personne_e5705e") : t("charges.non_retenue_par_la_regle_934590") : mode === "include" ? t("charges.inclusion_individuelle_6cab64") : t("charges.exclusion_individuelle_2c76a5")}</span></div><label className={styles.field}>{t("charges.selection_de_cette_depense_7ea9c0")}<select aria-label={t("charges.selectExpense",{title:entry.title})} value={mode} onChange={event => setException(entry, event.target.value, event.target.value === "exclude" ? exception?.reason : undefined)}><option value="auto">{t("charges.regle_automatique_20319d")}</option><option value="include">{t("charges.inclure_seulement_cette_depense_978184")}</option><option value="exclude">{t("charges.exclure_cette_depense_3ea26b")}</option></select></label>{mode === "exclude" && <label className={`${styles.field} ${styles.reason}`}>{t("charges.motif_facultatif_60b580")}<input aria-label={t("charges.reasonExpense",{title:entry.title})} value={exception?.reason ?? ""} maxLength={500} placeholder={t("charges.deja_compte_via_une_autre_source_d2d523")} onChange={event => setException(entry, "exclude", event.target.value)} /></label>}</div>; })}{!selectionEntries.length && <p className={styles.empty}>{t("charges.aucune_depense_trouvee_dans_les_sources_auto_86b677")}</p>}</> : <div className={styles.attachmentForm}><p className={styles.entryTitle}>{attachmentEntry?.title ?? t("charges.facture_source_indisponible_32d0f3")}</p><p className={styles.muted}>{t("charges.le_montant_les_dates_et_les_paiements_de_la_a06e1b")}</p><label className={styles.field}>{t("charges.mode_de_rattachement_4dfc9a")}<select value={draft.mode} onChange={event => updateAttachment({ mode: event.target.value as AttachmentDraft["mode"] })}><option value="default">{t("charges.date_de_facture_revenir_au_defaut_0f52d4")}</option><option value="month">{t("charges.choisir_un_mois_de_rattachement_704316")}</option><option value="spread">{t("charges.repartir_sur_plusieurs_mois_bdd230")}</option></select></label>{draft.mode === "month" && <label className={styles.field}>{t("charges.mois_retenu_8b6fea")}<input type="month" required value={draft.month} onChange={event => updateAttachment({ month: event.target.value })} /></label>}{draft.mode === "spread" && <><div className={styles.attachmentGrid}><label className={styles.field}>{t("charges.premier_mois_1d0b69")}<input type="month" required value={draft.startMonth} onChange={event => updateAttachment({ startMonth: event.target.value })} /></label><label className={styles.field}>{t("charges.dernier_mois_4ab7ac")}<input type="month" required value={draft.endMonth} onChange={event => updateAttachment({ endMonth: event.target.value })} /></label></div><p className={styles.muted}>{t("charges.de_1_a_12_mois_consecutifs_montants_egaux_au_f1b5b6")}</p></>}{draft.mode === "default" && <p className={styles.notice}>{t("charges.la_date_de_facture_sert_de_rattachement_par_4905d4")}</p>}</div>}
    </fieldset>{error && <p className={styles.error} role="alert">{specialistMessage(error,t)}</p>}{draft.revision !== snapshot.revision && <p className={styles.notice}>{t("charges.la_configuration_affichee_a_une_revision_plu_e0e7e6")}{" "}<button type="button" className="secondary-button" disabled={saving} onClick={rebaseDraft}>{t("charges.reprendre_ma_saisie_sur_la_version_actualise_6dd17b")}</button></p>}<div className={styles.dialogActions}><button type="button" className="secondary-button" disabled={saving || loading} onClick={() => void refresh()}>{t("charges.actualiser_les_donnees_3c5007")}</button><button type="button" className="secondary-button" disabled={saving} onClick={discard}>{t("charges.annuler_49ba32")}</button><button type="submit" className="primary-button" disabled={saving || !canContribute}>{saving ? t("charges.enregistrement_e7d5f2") : t("charges.enregistrer_f7c8bc")}</button></div></form></section></div>}
  </div>;
}

function FragmentRows({ source, groups, months }: { source: MonthlyChargeSource; groups: ReturnType<typeof buildMonthlyCharges>["groups"]; months: ReturnType<typeof buildMonthlyCharges>["months"] }) {
  const { t, label: displayLabel, formatMoney: screenMoney } = useI18n();
  const sourceLabel = (source: MonthlyChargeSource) => displayLabel(source === "invoice" ? "Factures prestataires" : "Personnel & interventions", "charges");
  const money = (cents: number | null) => cents === null ? t("charges.invalidAmount") : screenMoney(cents / 100);

  const rows = groups.filter(group => group.source === source);
  const totals = months.map(month => source === "invoice" ? month.invoiceCents : month.hoursCents);
  return <>{rows.map(group => <tr key={group.key}><th scope="row">{group.label}<small className={styles.muted} style={{ display: "block" }}>{sourceLabel(source)}</small></th>{group.monthsCents.map((amount, index) => <td className={months[index].future ? styles.future : undefined} key={index}>{money(amount)}</td>)}<td>{money(group.totalCents)}</td></tr>)}<tr className={styles.subtotal}><th scope="row">{t("charges.sous_total_306e7e")}{" "}{sourceLabel(source)}</th>{totals.map((amount, index) => <td key={index}>{money(amount)}</td>)}<td>{money(totals.reduce((sum, amount) => sum + amount, 0))}</td></tr></>;
}
