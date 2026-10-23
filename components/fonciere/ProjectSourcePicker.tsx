"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useScopedOperations, isCancelled } from "@/lib/access/operations";
import type { ProjectData } from "@/lib/izord/model";
import { createFonciereRepository, type FonciereProjectRecord, type LoadedFonciereProject } from "@/lib/fonciere/repository";
import { fromPresentationData, toPresentationData } from "@/lib/fonciere/model";
import { useFonciereLocale } from "@/lib/fonciere/locale";
import styles from "../izord/IzordGenerator.module.css";

type Props = {
  data: ProjectData | null; sourceFiles: File[]; draftId: string;
  loadSourceFiles: (signal: AbortSignal) => Promise<File[]>; onBusyChange: (busy: boolean) => void; canWrite: boolean; disabled: boolean; accessSignal: AbortSignal;
  onSelect: (data: ProjectData, documents: File[], refresh: boolean) => void;
  onImport: () => void;
  onLinked: (data: ProjectData) => void;
};
const normalize = (value: unknown) => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export default function ProjectSourcePicker({ data, sourceFiles, draftId, loadSourceFiles, onBusyChange, canWrite, disabled, accessSignal, onSelect, onImport, onLinked }: Props) {
  const [locale] = useFonciereLocale(), tr = (fr: string, en: string) => locale === "en" ? en : fr;
  const begin = useScopedOperations("izord");
  const [mode, setMode] = useState<"saved" | "direct">("saved");
  const [projects, setProjects] = useState<FonciereProjectRecord[]>([]), [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const lifetime = useRef(0);
  const pendingProject = useRef<LoadedFonciereProject | null>(null);
  useEffect(() => { pendingProject.current = null; }, [draftId]);
  const invalidate = useCallback(() => { lifetime.current++; }, []);
  function working(value: boolean) { setBusy(value); onBusyChange(value); }
  const source = data?.importMeta?.fonciereSource as { id?: string; revision?: number } | undefined;
  useEffect(() => {
    const current = ++lifetime.current;
    void (async () => {
      try { const op = await begin(); const list = await op.run(() => createFonciereRepository(op.client).listProjects({ signal: AbortSignal.any([op.signal, accessSignal]) })); if (current === lifetime.current && !accessSignal.aborted) setProjects(list); }
      catch (error) { if (current === lifetime.current && !accessSignal.aborted && !isCancelled(error)) setMessage("list-unavailable"); }
    })();
    return invalidate;
  }, [begin, accessSignal, draftId, invalidate]);
  async function select(id: string, refresh = false) {
    if (busy || disabled || !canWrite) return;
    if (data && !window.confirm(refresh ? tr("Reprendre les dernières données et photos du projet ? Cela remplacera les champs et corrections de cette présentation. Les versions enregistrées seront conservées.", "Use the latest project data and photos? This replaces the current presentation fields and edits. Saved versions will be kept.") : tr("Choisir ce projet et commencer une nouvelle présentation ? Le contenu et les photos du brouillon actuel seront remplacés. Les dossiers enregistrés seront conservés.", "Choose this project and start a new presentation? The current draft content and photos will be replaced. Saved dossiers will be kept."))) return;
    const current = lifetime.current; working(true); setMessage("");
    try {
      const op = await begin(), signal = AbortSignal.any([op.signal, accessSignal]), repository = createFonciereRepository(op.client);
      const loaded = await op.run(() => repository.loadProject(id, { signal }));
      if (loaded.project.status === "archived") throw new Error(tr("Ce projet est archivé.", "This project is archived."));
      const documents: File[] = [];
      for (const ref of loaded.sourceDocuments) {
        const asset = loaded.assets.find(item => item.id === ref);
        if (!asset) throw new Error(tr("Document source inaccessible.", "Source document unavailable."));
        const blob = await op.run(() => repository.downloadAsset(asset, { signal }));
        documents.push(new File([blob], asset.original_name, { type: blob.type }));
      }
      const snapshot = toPresentationData(loaded.data, loaded.project);
      await op.check(); signal.throwIfAborted();
      if (current === lifetime.current) { onSelect(snapshot, documents, refresh); setMessage(tr("Données sauvegardées et visuels repris, sans nouvelle extraction.", "Saved data and images loaded, without running extraction again.")); }
    } catch (error) { if (current === lifetime.current && !isCancelled(error)) setMessage(error instanceof Error ? error.message : tr("Projet indisponible.", "Project unavailable.")); }
    finally { if (current === lifetime.current) working(false); }
  }
  async function saveAsProject() {
    if (!data || busy || disabled || !canWrite) return;
    const name = String(data.state.project || "").trim();
    if (!name) { setMessage(tr("Renseignez le nom du projet dans le formulaire.", "Enter the project name in the form.")); return; }
    const current = lifetime.current; working(true); setMessage("");
    try {
      const op = await begin(), signal = AbortSignal.any([op.signal, accessSignal]), repository = createFonciereRepository(op.client), property = fromPresentationData(data);
      const list = await op.run(() => repository.listProjects({ signal }));
      const duplicate = list.some(item => property.agencyReference && normalize(item.payload.data.agencyReference) === normalize(property.agencyReference) || property.propertyAddress && normalize(item.payload.data.propertyAddress) === normalize(property.propertyAddress));
      if (duplicate && !window.confirm(tr("Un projet avec cette référence ou cette adresse existe déjà. Créer une fiche distincte ? Aucune fusion ne sera effectuée.", "A project with this reference or address already exists. Create a separate record? Records will not be merged."))) return;
      const originals = await op.run(() => loadSourceFiles(signal));
      const saved = await op.run(() => repository.saveProject({ data: property, previous: pendingProject.current || undefined, onCreated: draft=>{pendingProject.current=draft;}, sourceFiles: originals.length ? originals : sourceFiles }, { signal }));
      await op.check(); signal.throwIfAborted();
      if (current === lifetime.current) { setProjects(await repository.listProjects({ signal })); onLinked({ ...data, importMeta: { ...(data.importMeta || {}), fonciereSource: { id: saved.project.id, revision: saved.project.revision, capturedAt: new Date().toISOString() } } }); setMessage(tr("Fiche enregistrée dans Projets. Enregistrez la présentation pour conserver son lien.", "Project record saved. Save the presentation to retain its source link.")); }
    } catch (error) { if (current === lifetime.current && !isCancelled(error)) setMessage(error instanceof Error ? error.message : tr("Enregistrement non confirmé.", "Save not confirmed.")); }
    finally { if (current === lifetime.current) working(false); }
  }
  const needle = normalize(query), filtered = projects.filter(item => item.status === "active" && normalize([item.title, item.payload.data.propertyAddress, item.payload.data.city, item.payload.data.agencyReference].join(" ")).includes(needle));
  return <section className={styles.panel} aria-label={tr("Source du projet", "Project source")} data-project-source>
    <h2>{tr("Projet", "Project")}</h2>
    <div className={styles.toolbar}><button type="button" className={mode === "saved" ? undefined : styles.quiet} aria-pressed={mode === "saved"} onClick={() => setMode("saved")}>{tr("Choisir un projet enregistré", "Choose a saved project")}</button><button type="button" className={mode === "direct" ? undefined : styles.quiet} aria-pressed={mode === "direct"} onClick={() => setMode("direct")}>{tr("Importer directement une fiche d’agence", "Import an agency sheet directly")}</button></div>
    {mode === "saved" ? <><label>{tr("Rechercher un projet", "Search projects")}<input value={query} onChange={event => setQuery(event.target.value)} placeholder={tr("Nom, adresse ou référence agence", "Name, address or agency reference")} /></label><ul className={styles.projects}>{filtered.map(project => <li key={project.id}><div><strong>{project.title}</strong><span>{[project.payload.data.propertyAddress, project.payload.data.city, project.payload.data.agencyReference].filter(Boolean).join(" · ")}</span></div><button type="button" disabled={disabled || busy || !canWrite} onClick={() => void select(project.id)}>{tr("Utiliser ce projet", "Use this project")}</button></li>)}</ul>{!filtered.length && <p>{tr("Aucun projet enregistré correspondant.", "No matching saved projects.")}</p>}</> : <><p>{tr("Créez une présentation sans enregistrer de projet au préalable. Vous pourrez la réutiliser ensuite.", "Create a presentation without saving a project first. You can save it for reuse afterwards.")}</p><button type="button" disabled={disabled || busy || !canWrite} onClick={onImport}>{tr("Importer une fiche d’agence", "Import an agency sheet")}</button></>}
    {source?.id && <p><a href={`/fonciere?project=${encodeURIComponent(source.id)}`} target="_blank" rel="noreferrer">{tr("Ouvrir le projet source", "Open source project")}</a> · {tr("Données reprises de la révision", "Snapshot from revision")} {source.revision} <button type="button" className={styles.quiet} disabled={disabled || busy || !canWrite} onClick={() => void select(source.id!, true)}>{tr("Reprendre les données actualisées", "Refresh from saved project")}</button></p>}
    {data && !source?.id && canWrite && <button type="button" className={styles.quiet} disabled={disabled || busy} onClick={() => void saveAsProject()}>{tr("Enregistrer dans Projets", "Save in Projects")}</button>}
    <p className={styles.muted}>{tr("Chaque présentation conserve son instantané. Les modifications d’une fiche projet ne changent pas les présentations existantes.", "Each presentation retains its own snapshot. Editing a project record does not change existing presentations.")}</p>
    {busy && <p role="status">{tr("Récupération des données et des documents…", "Loading data and documents…")}</p>}{message && <p role="status">{message === "list-unavailable" ? tr("Liste des projets indisponible. Vous pouvez importer directement une fiche.", "The saved projects list is unavailable. You can import an agency sheet directly.") : message}</p>}
  </section>;
}
