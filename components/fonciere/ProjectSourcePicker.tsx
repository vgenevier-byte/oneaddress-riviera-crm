"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SearchableSelect } from "@/components/search/SearchableSelect";
import { useScopedOperations, isCancelled } from "@/lib/access/operations";
import type { ProjectData } from "@/lib/izord/model";
import { createFonciereRepository, FonciereCreationConflictError, type FonciereProjectRecord, type LoadedFonciereProject } from "@/lib/fonciere/repository";
import { fromPresentationData, toPresentationData } from "@/lib/fonciere/model";
import { claimFonciereDraft, confirmFonciereDraft, markFonciereDraftAttempted, FonciereDraftInUseError, type FonciereDraftLease } from "@/lib/fonciere/creationKey";
import { readFonciereLocalDraft, saveFonciereLocalDraft, deleteFonciereLocalDraft, type FonciereLocalDraft } from "@/lib/fonciere/draftRecovery";
import { compareProjectNumbers, projectReferenceFields, projectSearchFields } from "@/lib/fonciere/projectSearch";
import { useFonciereLocale } from "@/lib/fonciere/locale";
import styles from "../izord/IzordGenerator.module.css";

type Props = {
  userId: string; data: ProjectData | null; sourceFiles: File[]; draftId: string;
  loadSourceFiles: (signal: AbortSignal) => Promise<File[]>; onBusyChange: (busy: boolean) => void; canWrite: boolean; disabled: boolean; accessSignal: AbortSignal;
  canReadProjects: boolean; canWriteProjects: boolean; canDownloadProjects: boolean;
  onSelect: (data: ProjectData, documents: File[], refresh: boolean) => void;
  onImport: () => void;
  onLinked: (data: ProjectData) => void;
};
const normalize = (value: unknown) => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export default function ProjectSourcePicker({ userId, data, sourceFiles, draftId, loadSourceFiles, onBusyChange, canWrite, canReadProjects, canWriteProjects, canDownloadProjects, disabled, accessSignal, onSelect, onImport, onLinked }: Props) {
  const [locale] = useFonciereLocale(), tr = (fr: string, en: string) => locale === "en" ? en : fr;
  const begin = useScopedOperations("fonciere");
  const [mode, setMode] = useState<"saved" | "direct">(canReadProjects ? "saved" : "direct");
  const [projects, setProjects] = useState<FonciereProjectRecord[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const lifetime = useRef(0);
  const pendingProject = useRef<LoadedFonciereProject | null>(null);
  const creationLease = useRef<FonciereDraftLease | null>(null);
  const [creationConflict, setCreationConflict] = useState<FonciereCreationConflictError | null>(null);
  const [reconciliation, setReconciliation] = useState<LoadedFonciereProject | null>(null);
  const [pendingRecovery, setPendingRecovery] = useState<FonciereLocalDraft | null>(null);
  const creationReconciled = useRef(false);
  useEffect(() => { pendingProject.current = null; creationReconciled.current = false; return () => { creationLease.current?.release(); creationLease.current = null; }; }, [draftId]);
  const invalidate = useCallback(() => { lifetime.current++; }, []);
  function working(value: boolean) { setBusy(value); onBusyChange(value); }
  const source = data?.importMeta?.fonciereSource as { id?: string; revision?: number } | undefined;
  useEffect(() => {
    const current = ++lifetime.current;
    void (async () => {
      await Promise.resolve();
      if (current !== lifetime.current || accessSignal.aborted) return;
      if (!canReadProjects) { setProjects([]); setListLoading(false); return; }
      setListLoading(true);
      try { const op = await begin(); const list = await op.run(() => createFonciereRepository(op.client, { accessToken: op.token }).listProjects({ signal: AbortSignal.any([op.signal, accessSignal]) })); if (current === lifetime.current && !accessSignal.aborted) setProjects(list); }
      catch (error) { if (current === lifetime.current && !accessSignal.aborted && !isCancelled(error)) setMessage("list-unavailable"); }
      finally { if (current === lifetime.current && !accessSignal.aborted) setListLoading(false); }
    })();
    return invalidate;
  }, [begin, accessSignal, draftId, invalidate, canReadProjects]);
  useEffect(() => {
    const candidate = new URL(window.location.href).searchParams.get("sourceDraft");
    if (!candidate || !canWriteProjects || !canDownloadProjects) return;
    const local = new AbortController();
    const current = lifetime.current;
    void (async () => {
      const op = await begin(), signal = AbortSignal.any([op.signal, accessSignal, local.signal]);
      const lease = await claimFonciereDraft(`${userId}:presentation`, candidate, signal);
      if (current !== lifetime.current || signal.aborted) { lease.release(); return; }
      creationLease.current = lease;
      const url = new URL(window.location.href); url.searchParams.set("sourceDraft", lease.identity.draftId); window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      const restored = await readFonciereLocalDraft(lease.identity);
      if (current === lifetime.current && !signal.aborted && creationLease.current === lease && restored) setPendingRecovery(restored);
    })().catch(error => { if (!local.signal.aborted && current === lifetime.current && !isCancelled(error)) setMessage(error instanceof FonciereDraftInUseError ? "draft-in-use" : "draft-storage-unavailable"); });
    return () => local.abort();
  }, [accessSignal, begin, canDownloadProjects, canWriteProjects, draftId, userId]);
  function resumeCreationDraft() {
    if (!pendingRecovery || busy || disabled || !canWrite) return;
    if (data?.state.project?.trim() && !window.confirm(tr("Reprendre le brouillon conservé de cette tentative ? Les champs affichés seront remplacés par ce brouillon, avec ses originaux.", "Restore the retained draft from this attempt? Current fields will be replaced by that draft, with its originals."))) return;
    pendingProject.current = pendingRecovery.loaded; creationReconciled.current = pendingRecovery.creationReconciled;
    onSelect(pendingRecovery.data.presentationData, pendingRecovery.sourceFiles, true); setPendingRecovery(null);
    setMessage(tr("Brouillon et originaux repris. L’identité de la tentative est conservée.", "Draft and originals restored. The attempt identity is retained."));
  }
  async function select(id: string, refresh = false) {
    if (busy || disabled || !canWrite || !canReadProjects || !canDownloadProjects) return;
    const current = lifetime.current; working(true); setMessage("");
    try {
      const op = await begin(), signal = AbortSignal.any([op.signal, accessSignal]), repository = createFonciereRepository(op.client, { accessToken: op.token });
      await op.run(() => repository.authorizeTransfer(id, null, { signal }));
      signal.throwIfAborted();
      if (current !== lifetime.current) return;
      if (data && !window.confirm(refresh ? tr("Reprendre les dernières données et photos du projet ? Cela remplacera les champs et corrections de cette présentation. Les versions enregistrées seront conservées.", "Use the latest project data and photos? This replaces the current presentation fields and edits. Saved versions will be kept.") : tr("Choisir ce projet et commencer une nouvelle présentation ? Le contenu et les photos du brouillon actuel seront remplacés. Les dossiers enregistrés seront conservés.", "Choose this project and start a new presentation? The current draft content and photos will be replaced. Saved dossiers will be kept."))) return;
      const loaded = await op.run(() => repository.loadProject(id, { signal, purpose: "transfer" }));
      if (loaded.project.status === "archived") throw new Error(tr("Ce projet est archivé.", "This project is archived."));
      const documents: File[] = [];
      for (const ref of loaded.sourceDocuments) {
        const asset = loaded.assets.find(item => item.id === ref);
        if (!asset) throw new Error(tr("Document source inaccessible.", "Source document unavailable."));
        const blob = await op.run(() => repository.downloadAsset(asset, { signal }));
        documents.push(new File([blob], asset.original_name, { type: blob.type }));
      }
      const snapshot = toPresentationData(loaded.data, loaded.project);
      await op.run(() => repository.authorizeTransfer(loaded.project.id, loaded.project.revision, { signal }));
      await op.check(); signal.throwIfAborted();
      if (current === lifetime.current) { onSelect(snapshot, documents, refresh); setMessage(tr("Données sauvegardées et visuels repris, sans nouvelle extraction.", "Saved data and images loaded, without running extraction again.")); }
    } catch (error) { if (current === lifetime.current && !isCancelled(error)) setMessage(error instanceof Error ? error.message : tr("Projet indisponible.", "Project unavailable.")); }
    finally { if (current === lifetime.current) working(false); }
  }
  async function saveAsProject() {
    if (!data || busy || disabled || !canWrite || !canWriteProjects || !canDownloadProjects) return;
    const name = String(data.state.project || "").trim();
    if (!name) { setMessage(tr("Renseignez le nom du projet dans le formulaire.", "Enter the project name in the form.")); return; }
    const current = lifetime.current; working(true); setMessage("");
    try {
      const op = await begin(), signal = AbortSignal.any([op.signal, accessSignal]), repository = createFonciereRepository(op.client, { accessToken: op.token }), property = fromPresentationData(data, pendingProject.current?.data);
      const list = await op.run(() => repository.listProjects({ signal }));
      const duplicate = list.some(item => property.agencyReference && normalize(item.payload.data.agencyReference) === normalize(property.agencyReference) || property.propertyAddress && normalize(item.payload.data.propertyAddress) === normalize(property.propertyAddress));
      if (duplicate && !window.confirm(tr("Un projet avec cette référence ou cette adresse existe déjà. Créer une fiche distincte ? Aucune fusion ne sera effectuée.", "A project with this reference or address already exists. Create a separate record? Records will not be merged."))) return;
      if (!creationLease.current) {
        const url = new URL(window.location.href);
        creationLease.current = await claimFonciereDraft(`${userId}:presentation`, url.searchParams.get("sourceDraft") || draftId, signal);
        url.searchParams.set("sourceDraft", creationLease.current.identity.draftId); window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      }
      const identity = creationLease.current.identity;
      const originals = await op.run(() => loadSourceFiles(signal));
      const files = originals.length ? originals : sourceFiles;
      await saveFonciereLocalDraft(identity, { data: property, sourceFiles: files, sourceFileCategories: [], loaded: pendingProject.current, creationReconciled: creationReconciled.current, updatedAt: new Date().toISOString() });
      if (!creationReconciled.current) markFonciereDraftAttempted(identity);
      const saved = await op.run(() => repository.saveProject({ data: property, creationKey: identity.creationKey, creationReconciled: creationReconciled.current, previous: pendingProject.current || undefined, onCreated: draft=>{if (current === lifetime.current) pendingProject.current=draft;}, sourceFiles: files }, { signal }));
      await op.check(); signal.throwIfAborted();
      if (current === lifetime.current) { setProjects(await op.run(() => repository.listProjects({ signal }))); signal.throwIfAborted(); onLinked({ ...data, importMeta: { ...(data.importMeta || {}), fonciereSource: { id: saved.project.id, revision: saved.project.revision, capturedAt: new Date().toISOString() } } }); try { confirmFonciereDraft(identity, saved.project.id); await deleteFonciereLocalDraft(identity); } catch { /* Keep the canonical identity even if its local completion marker fails. */ } const url = new URL(window.location.href); if (url.searchParams.get("sourceDraft") === identity.draftId) { url.searchParams.delete("sourceDraft"); window.history.replaceState(null, "", url.pathname + url.search + url.hash); } creationLease.current?.release(); creationLease.current = null; setCreationConflict(null); setReconciliation(null); setMessage(tr("Fiche enregistrée dans Projets. Copie Google Drive en attente. Enregistrez la présentation pour conserver son lien.", "Project record saved. Google Drive copy pending. Save the presentation to retain its source link.")); }
    } catch (error) { if (current === lifetime.current && !isCancelled(error)) { if (error instanceof FonciereCreationConflictError) { setCreationConflict(error); setReconciliation(null); setMessage(tr("Cette identité de création correspond à une autre intention. Le brouillon et ses originaux sont conservés ; comparez la fiche avant de continuer.", "This creation identity belongs to a different request. The draft and originals are retained; compare the saved record before continuing.")); } else setMessage(error instanceof FonciereDraftInUseError ? "draft-in-use" : error instanceof Error && /identité|brouillon local|brouillons entre onglets|quota|storage/i.test(error.message) ? "draft-storage-unavailable" : error instanceof Error ? error.message : tr("Enregistrement non confirmé.", "Save not confirmed.")); } }
    finally { if (current === lifetime.current) working(false); }
  }
  async function inspectCreationConflict() {
    if (!creationConflict?.projectId || busy || disabled) return;
    const current = lifetime.current; working(true);
    try { const op = await begin(), signal = AbortSignal.any([op.signal, accessSignal]); const canonical = await op.run(() => createFonciereRepository(op.client, { accessToken: op.token }).loadProject(creationConflict.projectId!, { signal })); if (current === lifetime.current) setReconciliation(canonical); }
    catch (error) { if (current === lifetime.current && !isCancelled(error)) setMessage(error instanceof Error ? error.message : tr("Projet inaccessible.", "Project unavailable.")); }
    finally { if (current === lifetime.current) working(false); }
  }
  function reconcileCreation() {
    if (!reconciliation || busy || disabled || reconciliation.project.status === "archived") return;
    pendingProject.current = reconciliation; creationReconciled.current = true; setCreationConflict(null); setReconciliation(null);
    setMessage(tr("La fiche existante sert de base. Le brouillon de présentation et ses originaux sont conservés ; vérifiez puis enregistrez dans Projets.", "The existing record is the baseline. The presentation draft and its originals are retained; review and save in Projects."));
  }
  const sourceReference = projects.find(project => project.id === source?.id)?.project_reference;
  const eligibleProjects = projects.filter(item => item.status === "active").sort(compareProjectNumbers);
  return <section className={styles.panel} aria-label={tr("Source du projet", "Project source")} data-project-source>
    <h2>{tr("Projet", "Project")}</h2>
    <div className={styles.toolbar}><button type="button" disabled={!canReadProjects} className={mode === "saved" ? undefined : styles.quiet} aria-pressed={mode === "saved"} onClick={() => setMode("saved")}>{tr("Choisir un projet enregistré", "Choose a saved project")}</button><button type="button" className={mode === "direct" ? undefined : styles.quiet} aria-pressed={mode === "direct"} onClick={() => setMode("direct")}>{tr("Importer directement une fiche d’agence", "Import an agency sheet directly")}</button></div>
    {!canReadProjects && <p className={styles.muted}>{tr("L’accès à Projets est indépendant de cette présentation. Son instantané reste consultable ; l’accès au projet source est nécessaire pour le choisir ou actualiser ses données.", "Projects access is independent from this presentation. Its snapshot remains readable; source-project access is required to select it or refresh its data.")}</p>}
    {canReadProjects && !canDownloadProjects && <p className={styles.muted}>{tr("Le droit Export et téléchargement de Projets est nécessaire pour reprendre ou actualiser un projet dans une présentation, ainsi que pour enregistrer et lier une présentation dans Projets. Le brouillon et les instantanés existants sont conservés.", "Projects Export and download permission is required to use or refresh a project in a presentation, and to save and link a presentation in Projects. Existing drafts and snapshots are retained.")}</p>}
    {mode === "saved" ? <><label htmlFor="fonciere-source-project">{tr("Rechercher un projet", "Search projects")}</label><SearchableSelect preserveEmptyOrder id="fonciere-source-project" value={source?.id || ""} disabled={disabled || busy || !canWrite || !canReadProjects || !canDownloadProjects || listLoading} onChange={event => { if (eligibleProjects.some(project => project.id === event.target.value)) void select(event.target.value); }}>
      <option value="" disabled>{tr("Choisir un projet enregistré", "Choose a saved project")}</option>
      {source?.id && !eligibleProjects.some(project => project.id === source.id) && <option value={source.id} disabled>{tr("Projet source conservé", "Retained source project")}</option>}
      {eligibleProjects.map(project => <option key={project.id} value={project.id} data-reference={project.project_reference || ""} data-number={projectReferenceFields(project)[1] || ""} data-search={projectSearchFields(project).filter(Boolean).join(" ")} data-secondary={[project.payload.data.propertyAddress, project.payload.data.city, project.payload.data.agencyReference].filter(Boolean).join(" · ")}>{project.title}</option>)}
    </SearchableSelect>{listLoading && <p role="status">{tr("Chargement des projets…", "Loading projects…")}</p>}</> : <><p>{tr("Créez une présentation sans enregistrer de projet au préalable. Vous pourrez la réutiliser ensuite.", "Create a presentation without saving a project first. You can save it for reuse afterwards.")}</p><button type="button" disabled={disabled || busy || !canWrite} onClick={onImport}>{tr("Importer une fiche d’agence", "Import an agency sheet")}</button></>}
    {source?.id && <p>{canReadProjects && sourceReference && <><strong>{sourceReference}</strong> · </>}{canReadProjects && <><a href={`/fonciere?project=${encodeURIComponent(source.id)}`} target="_blank" rel="noreferrer">{tr("Ouvrir le projet source", "Open source project")}</a> · </>}{tr("Données reprises de la révision", "Snapshot from revision")} {source.revision} {canReadProjects && <button type="button" className={styles.quiet} disabled={disabled || busy || !canWrite || !canDownloadProjects} onClick={() => void select(source.id!, true)}>{tr("Reprendre les données actualisées", "Refresh from saved project")}</button>}</p>}
    {data && !source?.id && canWrite && canWriteProjects && <button type="button" className={styles.quiet} disabled={disabled || busy || !canDownloadProjects} onClick={() => void saveAsProject()}>{tr("Enregistrer dans Projets", "Save in Projects")}</button>}
    <p className={styles.muted}>{tr("Chaque présentation conserve son instantané. Les modifications d’une fiche projet ne changent pas les présentations existantes.", "Each presentation retains its own snapshot. Editing a project record does not change existing presentations.")}</p>
    {pendingRecovery && <div data-source-draft-recovery><p>{tr("Tentative conservée", "Retained attempt")} : {pendingRecovery.data.name} · {pendingRecovery.sourceFiles.length} {tr("pièce(s) jointe(s)", "attachment(s)")}</p><button type="button" disabled={busy || disabled || !canWrite} onClick={resumeCreationDraft}>{tr("Reprendre le brouillon de cette tentative", "Restore this attempt’s draft")}</button></div>}
    {creationConflict && <div data-source-creation-reconciliation><p>{tr("Le brouillon de présentation et ses pièces jointes restent conservés. Aucune autre fiche ne sera créée automatiquement.", "The presentation draft and attachments are retained. No other record will be created automatically.")}</p>{creationConflict.projectId && <><button type="button" disabled={busy || disabled} onClick={() => void inspectCreationConflict()}>{tr("Comparer avec la fiche enregistrée", "Compare with the saved record")}</button> <a href={`/fonciere?project=${encodeURIComponent(creationConflict.projectId)}`} target="_blank" rel="noreferrer">{tr("Ouvrir la fiche dans un autre onglet", "Open the record in another tab")}</a></>}{reconciliation && <div><p>{tr("Fiche enregistrée", "Saved record")} : {reconciliation.project.project_reference} · {reconciliation.project.title} · r{reconciliation.project.revision}</p><p>{tr("Votre brouillon", "Your draft")} : {data?.state.project} · {sourceFiles.length} {tr("pièce(s) jointe(s)", "attachment(s)")}</p><button type="button" disabled={busy || disabled || reconciliation.project.status === "archived"} onClick={reconcileCreation}>{tr("Utiliser cette fiche comme base et conserver mon brouillon", "Use this record as the baseline and keep my draft")}</button></div>}</div>}
    {busy && <p role="status">{tr("Récupération des données et des documents…", "Loading data and documents…")}</p>}{message && <p role="status">{message === "list-unavailable" ? tr("Liste des projets indisponible. Vous pouvez importer directement une fiche.", "The saved projects list is unavailable. You can import an agency sheet directly.") : message === "draft-in-use" ? tr("Ce brouillon est déjà ouvert dans un autre onglet. Vérifiez la tentative avant de le reprendre.", "This draft is already open in another tab. Review the save attempt before resuming it.") : message === "draft-storage-unavailable" ? tr("La conservation locale du brouillon ou sa protection entre onglets est indisponible. Votre saisie et vos pièces jointes restent conservées dans cet onglet.", "Local draft storage or protection between tabs is unavailable. Your entries and attachments are retained in this tab.") : message}</p>}
  </section>;
}
