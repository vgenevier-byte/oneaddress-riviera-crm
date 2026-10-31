"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Save, ArrowUpRight } from "lucide-react";
import { isCancelled, useScopedOperations } from "@/lib/access/operations";
import { usePageRefreshGuard } from "@/lib/usePageRefreshGuard";
import { createArbitrageRepository, type ArbitrationChoice, type ArbitrationSlot, type ArbitrationState } from "@/lib/fonciere/arbitrage";
import { taskTargetHref } from "@/lib/tasks/navigation";
import { prepareBankPresentation } from "@/lib/fonciere/bankPresentation";
import styles from "./ProjectArbitrage.module.css";

export const ARBITRAGE_LABELS = {
  pending: ["À arbitrer", "Awaiting decision"], approved: ["Validé", "Approved"],
  refused: ["Refusé", "Refused"], deepen: ["À approfondir", "Needs further review"],
} as const;
const names: Record<ArbitrationSlot, string> = { vincent: "Vincent", ann_charlotte: "Ann Charlotte" };
const slots: ArbitrationSlot[] = ["vincent", "ann_charlotte"];
type Draft = { choice: ArbitrationChoice; remark: string };
type Props = {
  projectId: string; userId: string; loadedRevision: number; loadedFingerprint?: string; projectDirty: boolean; lang: "fr" | "en";
  accessRevision: number; accessSignal?: AbortSignal; onDirty: (dirty: boolean) => void; onBusy?: (busy: boolean) => void;
  onStatusChange: (state: ArbitrationState) => void; onReloadProject: () => Promise<string | undefined>;
};

export default function ProjectArbitrage({ projectId, userId, loadedRevision, loadedFingerprint, projectDirty, lang, accessRevision, accessSignal, onDirty, onBusy, onStatusChange, onReloadProject }: Props) {
  const t = useCallback((fr: string, en: string) => lang === "fr" ? fr : en, [lang]);
  const begin = useScopedOperations("fonciere");
  const [state, setState] = useState<ArbitrationState | null>(null);
  const [draft, setDraft] = useState<Draft>({ choice: "pending", remark: "" });
  const [editingOpinion,setEditingOpinion] = useState(false);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [reviewRequired, setReviewRequired] = useState(false);
  const [refreshAttempted, setRefreshAttempted] = useState(false);
  const sequence = useRef(0), live = useRef(true), draftChanged = useRef(false), initializedSlot = useRef<ArbitrationSlot | null>(null);
  const rawOwn = state?.canVote ? state.opinions?.[state.canVote] : undefined;
  const own = rawOwn?.authorId === userId && !(rawOwn.stale && rawOwn.fingerprint === state?.fingerprint) ? rawOwn : undefined;
  const reviewedFingerprint = useRef<string | null>(loadedFingerprint || null);
  const dirty = Boolean(state?.canVote && (draft.choice !== (own?.choice || "pending") || draft.remark !== (own?.remark || "")));
  usePageRefreshGuard({ dirty, busy });
  useEffect(() => { onBusy?.(busy); return () => onBusy?.(false); }, [busy, onBusy]);
  useEffect(() => { draftChanged.current = dirty; }, [dirty]);
  const label = (choice: ArbitrationChoice) => { const pair = ARBITRAGE_LABELS[choice]; return t(pair[0], pair[1]); };
  const needsRemark = draft.choice === "refused" || draft.choice === "deepen";
  const unreadRevision = Boolean(state && (state.revision !== loadedRevision || !loadedFingerprint || state.fingerprint !== loadedFingerprint));
  const blocked = busy || loading || !state?.canVote || projectDirty || unreadRevision || reviewRequired || Boolean(accessSignal?.aborted);
  const update = useCallback((next: ArbitrationState, resetDraft = false) => {
    if (!live.current || accessSignal?.aborted) return;
    if (reviewedFingerprint.current && reviewedFingerprint.current !== next.fingerprint) setReviewRequired(true);
    else if (!reviewedFingerprint.current) reviewedFingerprint.current = next.fingerprint;
    setState(next); onStatusChange(next);
    if (!next.canVote) {
      initializedSlot.current = null; setDraft({ choice: "pending", remark: "" });
    } else if (resetDraft || initializedSlot.current !== next.canVote || !draftChanged.current) {
      const candidate = next.opinions?.[next.canVote];
      const opinion = candidate?.authorId === userId && !(candidate.stale && candidate.fingerprint === next.fingerprint) ? candidate : undefined;
      initializedSlot.current = next.canVote;
      setDraft({ choice: opinion?.choice || "pending", remark: opinion?.remark || "" });
    }
  }, [accessSignal, onStatusChange, userId]);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const op = await begin();
      const next = await op.run(() => createArbitrageRepository(op.client).read(projectId, op.signal));
      if (request === sequence.current) { update(next); setLoading(false); return next; }
    } catch (failure) {
      if (live.current && request === sequence.current && !isCancelled(failure)) { if (failure instanceof Error && /Opération refusée|42501/.test(failure.message)) { setState(null); setDraft({ choice: "pending", remark: "" }); onDirty(false); } setError(t("Arbitrage indisponible. Actualisez pour vérifier la décision enregistrée.", "Decisions are unavailable. Refresh to check the saved decision.")); setLoading(false); }
    }
  }, [begin, projectId, update, t, onDirty]);
  useEffect(() => {
    live.current = true;
    const requests = sequence;
    const clear = () => { sequence.current++; setState(null); setDraft({ choice: "pending", remark: "" }); onDirty(false); };
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    const focused = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", focused); document.addEventListener("visibilitychange", focused);
    accessSignal?.addEventListener("abort", clear, { once: true });
    return () => { live.current = false; requests.current++; window.clearTimeout(timer); window.removeEventListener("focus", focused); document.removeEventListener("visibilitychange", focused); accessSignal?.removeEventListener("abort", clear); };
  }, [refresh, accessRevision, accessSignal, onDirty]);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  async function prepare() {
    if (busy || !state?.bank.canPrepare) return;
    setBusy(true); setError("");
    try {
      const op = await begin();
      await op.run(() => prepareBankPresentation(op.client, projectId, { signal: op.signal }));
      await refresh();
    } catch (failure) { if (live.current && !isCancelled(failure)) { setError(t("Présentation à préparer — intervention nécessaire. La décision reste enregistrée ; une reprise est possible avec les droits requis.", "Presentation to prepare — action needed. The decision remains saved; preparation can be resumed with the required permissions.")); await refresh(); } }
    finally { if (live.current) setBusy(false); }
  }
  async function save() {
    if (blocked || !state || needsRemark && !draft.remark.trim()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const op = await begin();
      const next = await op.run(() => createArbitrageRepository(op.client).vote(projectId, state.fingerprint, draft.choice, draft.remark, op.signal));
      sequence.current++; update(next, true);setEditingOpinion(false); setNotice(t("Votre avis est enregistré.", "Your opinion is saved."));
      // Bank preparation has its own permissions and failure boundary. It never rolls back a vote.
      if (next.status === "approved" && next.bank.canPrepare && ["none", "pending", "blocked"].includes(next.bank.state) && !next.bank.needsUpdate) {
        try {
          await op.run(() => prepareBankPresentation(op.client, projectId, { signal: op.signal }));
          await refresh();
        } catch (failure) {
          if (!isCancelled(failure) && live.current) { setError(t("Présentation à préparer — intervention nécessaire. Votre avis et la décision commune sont conservés.", "Presentation to prepare — action needed. Your opinion and the joint decision remain saved.")); await refresh(); }
        }
      }
    } catch (failure) {
      if (live.current && !isCancelled(failure)) {
        const message = failure instanceof Error ? failure.message : "";
        if (/confl|reli|chang|re.?read|fingerprint|40001/i.test(message)) {
          setReviewRequired(true);
          setError(t("Le dossier a changé depuis votre consultation. Relisez la fiche enregistrée avant de reconfirmer votre avis. Votre remarque est conservée.", "The file has changed since you reviewed it. Read the saved record again before reconfirming your opinion. Your remark is retained."));
          await refresh();
        } else setError(t("L’avis n’a pas été confirmé. Votre saisie est conservée ; actualisez pour vérifier l’enregistrement avant de reprendre.", "Your opinion was not confirmed. Your entries are retained; refresh to check whether it was saved before retrying."));
      }
    } finally { if (live.current) setBusy(false); }
  }
  async function reread() {
    setRefreshAttempted(true); setBusy(true); setError("");
    try { const fingerprint = await onReloadProject(); reviewedFingerprint.current = fingerprint || null; const next = await refresh(); setReviewRequired(!next || Boolean(fingerprint && fingerprint !== next.fingerprint)); }
    catch (failure) { if (!isCancelled(failure)) setError(t("La relecture n’a pas été confirmée. Votre remarque est conservée.", "The record could not be refreshed. Your remark is retained.")); }
    finally { if (live.current) setBusy(false); }
  }
  const bankReasons: Record<string, [string, string]> = {
    permissions: ["La préparation nécessite les droits d’export du projet et de création/modification dans Présentations Projets. Un utilisateur autorisé peut la reprendre.", "Preparation requires project export and Project Presentations creation/editing permissions. An authorized user can resume it."],
    preparation_failed: ["Une erreur a interrompu la préparation. La décision est conservée ; reprenez la préparation.", "An error interrupted preparation. The decision is retained; resume preparation."],
    interrupted: ["La préparation a été interrompue et peut reprendre sans créer de doublon.", "Preparation was interrupted and can resume without creating a duplicate."],
    documents: ["Un document nécessaire est inaccessible. Un utilisateur autorisé doit vérifier les pièces jointes avant la reprise.", "A required document is inaccessible. An authorized user must check attachments before resuming."],
    presentation_changed: ["La présentation a été modifiée pendant la préparation. Ouvrez-la pour rapprocher les données ; ses modifications sont conservées.", "The presentation changed during preparation. Open it to reconcile the data; its edits are preserved."],
    error: ["La préparation n’a pas abouti. La décision est conservée ; une nouvelle tentative est possible.", "Preparation could not complete. The decision is retained; it can be retried."],
  };
  const missingLabels: Record<string, [string, string]> = { address: ["adresse du bien", "property address"], asking: ["prix demandé", "asking price"], area: ["surface", "area"], acquisition: ["coût d’acquisition", "acquisition cost"], financing: ["hypothèses de financement", "financing assumptions"], works: ["budget travaux", "works budget"], photos: ["photos", "photos"] };
  const date = (value: string) => new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  return <div className={styles.arbitrage} data-arbitrage data-project-arbitrage aria-busy={busy || loading}>
    {loading && <p role="status">{t("Chargement des avis enregistrés…", "Loading saved opinions…")}</p>}
    {state && <>
      <div className={styles.summary} data-status={state.status}>
        <div><span className={styles.eyebrow}>{t("Décision commune", "Joint decision")}</span><strong>{label(state.status)}</strong></div>
        <button type="button" disabled={busy} onClick={() => void refresh()} aria-label={t("Actualiser l’arbitrage", "Refresh decisions")}><RefreshCw size={16}/></button>
      </div>
      {state.disagreement && <p className={styles.warning} role="status">{t("Désaccord à discuter ensemble", "Disagreement to discuss together")}</p>}
      {state.pending.map(slot => <p className={styles.waiting} key={slot}>{t(slot === "vincent" ? "En attente de l’avis de Vincent" : "En attente de l’avis d’Ann Charlotte", `Awaiting ${names[slot]}’s opinion`)}</p>)}
      {(projectDirty || unreadRevision || reviewRequired) && <div className={styles.warning}>
        <p>{projectDirty ? t("Les modifications du dossier sont en cours. Enregistrez-les avant de donner votre avis sur la version enregistrée.", "The file has unsaved changes. Save them before giving an opinion on the saved version.") : t("Une relecture de la fiche enregistrée est nécessaire avant de donner votre avis. Votre remarque en cours est conservée.", "Read the saved record again before giving your opinion. Your current remark is retained.")}</p>
        {!projectDirty && <button type="button" disabled={busy} onClick={() => void reread()}>{t("Recharger la fiche pour la relire", "Reload the record to review it")}</button>}
      </div>}
      {refreshAttempted && !unreadRevision && !reviewRequired && <p className={styles.muted}>{t("Fiche rechargée. Relisez les données et documents avant d’enregistrer votre avis.", "Record reloaded. Review its information and documents before saving your opinion.")}</p>}
      <div className={styles.opinions}>{slots.map(slot => {
        const opinion = state.opinions?.[slot], mine = state.canVote === slot;
        const selected = mine ? draft.choice : opinion?.choice || "pending";
        const remark = mine ? draft.remark : opinion?.remark || "";
        return <section className={styles.opinion} key={slot} data-opinion={slot} data-arbitrage-slot={slot === "ann_charlotte" ? "annCharlotte" : slot}>
          <h4>{t(slot === "vincent" ? "Avis de Vincent" : "Avis d’Ann Charlotte", `${names[slot]}’s opinion`)}</h4>
          {state.private ? <>
            <p className={styles.saved}>{opinion ? <>{t("Dernier avis enregistré", "Last saved opinion")} · <time dateTime={opinion.recordedAt}>{date(opinion.recordedAt)}</time></> : t("Aucun avis enregistré", "No saved opinion")}</p>
            {opinion?.stale && <p className={styles.warning}>{t("À reconfirmer — le dossier ou le décideur a changé.", "Reconfirmation needed — the file or decision maker has changed.")}</p>}
            {(!mine||!editingOpinion)&&<div className={styles.saved}><strong>{label(opinion?.choice||"pending")}</strong>{opinion?.remark&&<p style={{whiteSpace:"pre-wrap"}}>{opinion.remark}</p>}</div>}
            {mine&&!editingOpinion&&<button type="button" disabled={blocked} onClick={()=>setEditingOpinion(true)}>{t("Modifier mon avis","Edit my opinion")}</button>}
            <div hidden={!mine||!editingOpinion} inert={!mine||!editingOpinion}><fieldset disabled={!mine || blocked} className={styles.choices}>
              <legend>{t("Choix", "Choice")} · {names[slot]}</legend>
              {(Object.keys(ARBITRAGE_LABELS) as ArbitrationChoice[]).map(choice => <label key={choice} className={styles.choice}><input type="radio" name={`arbitrage-${projectId}-${slot}`} value={choice} checked={selected === choice} onChange={() => { setDraft(value => ({ ...value, choice })); setNotice(""); }}/><span>{label(choice)}</span></label>)}
            </fieldset>
            <label className={styles.remark} htmlFor={`arbitrage-remark-${slot}`}><span>{t("Remarque / justification", "Remark / justification")}{mine && needsRemark && ` · ${t("obligatoire", "required")}`}</span><textarea id={`arbitrage-remark-${slot}`} value={remark} readOnly={!mine} disabled={mine && blocked} required={mine && needsRemark} maxLength={10000} rows={4} aria-describedby={`arbitrage-private-${slot}`} onChange={event => { setDraft(value => ({ ...value, remark: event.target.value })); setNotice(""); }}/></label>
            <p id={`arbitrage-private-${slot}`} className={styles.muted}>{t("Remarque privée, réservée à Vincent et Ann Charlotte.", "Private remark, visible only to Vincent and Ann Charlotte.")}</p>
            {mine && <><p className={dirty ? styles.unsaved : styles.muted} role="status">{dirty ? t("Modification en cours — avis non enregistré", "Editing — opinion not saved") : opinion?.stale ? t("L’ancien avis ne valide pas le dossier actuel.", "The previous opinion does not approve the current file.") : opinion ? t("Avis enregistré sur le dossier consulté.", "Opinion saved for the reviewed file.") : t("« À arbitrer » est la valeur initiale ; aucun avis n’a encore été donné.", "“Awaiting decision” is the initial value; no opinion has been given yet.")}</p><button type="button" className={styles.save} disabled={blocked || needsRemark && !draft.remark.trim()} onClick={() => void save()}><Save size={15}/>{t("Enregistrer mon avis", "Save my opinion")}</button><button type="button" disabled={busy} onClick={()=>{setDraft({choice:own?.choice||"pending",remark:own?.remark||""});setEditingOpinion(false);}}>{t("Annuler","Cancel")}</button></>}</div>
          </> : <p className={styles.muted}>{state.pending.includes(slot) ? t("Avis attendu.", "Opinion awaited.") : t("Avis enregistré.", "Opinion saved.")} {t("Les remarques et l’historique détaillé sont réservés aux deux décideurs.", "Remarks and detailed history are restricted to the two decision makers.")}</p>}
        </section>;
      })}</div>
      {!state.canVote && <p className={styles.muted}>{t("Seul le compte CRM désigné peut enregistrer son propre avis. Les droits d’édition du projet ne permettent pas de voter à sa place.", "Only the designated CRM account can save its own opinion. Project editing rights do not allow voting on someone else’s behalf.")}</p>}
      <section className={styles.bank} aria-labelledby={`bank-title-${projectId}`}>
        <h4 id={`bank-title-${projectId}`}>{t("Présentation bancaire", "Bank presentation")}</h4>
        <p>{state.bank.needsUpdate ? t("Les données validées ont changé. La présentation existante et ses modifications sont conservées. Ouvrez-la pour rapprocher explicitement les données approuvées.", "Approved data has changed. The existing presentation and its edits are preserved. Open it to explicitly reconcile the approved data.") : state.bank.state === "ready" ? t("Brouillon persistant préparé dans Présentations Projets.", "Persistent draft prepared in Project Presentations.") : state.bank.state === "preparing" ? t("Préparation en cours… Une reprise utilise la même présentation.", "Preparation in progress… Resuming uses the same presentation.") : state.status === "approved" || state.bank.state === "blocked" ? t("Présentation à préparer — intervention nécessaire", "Presentation to prepare — action needed") : t("La préparation automatique attend deux validations du même dossier.", "Automatic preparation requires both approvals for the same file.")}</p>
        {state.bank.missing && state.bank.missing.length > 0 && <p className={styles.muted}>{t("À compléter", "To complete")} : {state.bank.missing.map(key => { const pair = missingLabels[key]; return pair ? t(pair[0], pair[1]) : key; }).join(", ")}.</p>}
        {state.bank.reason && <p className={styles.muted}>{bankReasons[state.bank.reason] ? t(bankReasons[state.bank.reason][0], bankReasons[state.bank.reason][1]) : t("La préparation nécessite une intervention. La décision et la présentation existante sont conservées.", "Preparation needs attention. The decision and existing presentation are preserved.")}</p>}
        {state.bank.approvedFingerprint && !state.bank.currentApproval && <p className={styles.warning}>{t("L’approbation liée au dossier bancaire n’est plus à jour.", "The approval linked to the bank file is no longer current.")}</p>}
        <p className={styles.muted}>{t("Le brouillon reste à compléter et à vérifier dans son propre workflow. Aucun montant n’est inventé et aucun envoi bancaire n’est déclenché.", "The draft needs completion and review in its own workflow. No amounts are invented and no bank delivery is triggered.")}</p>
        <div className={styles.actions}>{state.bank.canPrepare && state.status === "approved" && state.bank.state !== "ready" && !state.bank.needsUpdate && <button type="button" disabled={busy} onClick={() => void prepare()}>{t("Reprendre la préparation", "Resume preparation")}</button>}{state.bank.presentationId && state.bank.canOpen && <a href={taskTargetHref({ type: "presentation", id: state.bank.presentationId })}>{t("Ouvrir la présentation bancaire", "Open bank presentation")}<ArrowUpRight size={15}/></a>}</div>
      </section>
      {state.private && state.history && state.history.length > 0 && <details className={styles.history}><summary>{t("Historique privé des avis", "Private opinion history")} ({state.history.length})</summary><ol>{state.history.map((entry, index) => <li key={`${entry.recordedAt}-${index}`}><strong>{names[entry.slot]} · {label(entry.choice)}</strong><time dateTime={entry.recordedAt}>{date(entry.recordedAt)}</time>{entry.remark && <p>{entry.remark}</p>}</li>)}</ol></details>}
    </>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {!state && !loading && <button type="button" onClick={() => void refresh()}>{t("Réessayer", "Retry")}</button>}
  </div>;
}
