"use client";

import { TaskSourceActions } from "@/components/TaskLinkProvider";
import { useTaskTargetFocus, scrollTaskTarget } from "@/lib/tasks/navigation";
import { usePageRefreshGuard } from "@/lib/usePageRefreshGuard";
import { beginPageRefreshOperation } from "@/lib/pageRefresh";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowLeft, ArrowUpRight, Building2, Check, ChevronRight, Download, FileText, FolderOpen, ImagePlus, MapPin, Plus, RefreshCw, Save, Search, Upload } from "lucide-react";
import { isCancelled, useScopedOperations } from "@/lib/access/operations";
import { createFonciereData, FONCIERE_DOCUMENT_LIMIT, type FonciereData, type FonciereField } from "@/lib/fonciere/model";
import { useFonciereLocale } from "@/lib/fonciere/locale";
import { createFonciereRepository, FonciereCreationConflictError, type FonciereAssetRecord, type LoadedFonciereProject } from "@/lib/fonciere/repository";
import { agencyReportToFonciere, applyAgencyImport, proposeAgencyImport } from "@/lib/fonciere/import";
import { analyzeAgencyFiles, type AgencyReport } from "@/lib/izord/agency";
import { addPhotoFile } from "@/lib/izord/photos";
import { LIMITS } from "@/lib/izord/model";
import { normalizeContactSearch } from "@/lib/contactSearch";
import { claimFonciereDraft, confirmFonciereDraft, markFonciereDraftAttempted, FonciereDraftInUseError, type FonciereDraftLease } from "@/lib/fonciere/creationKey";
import { readFonciereLocalDraft, saveFonciereLocalDraft, deleteFonciereLocalDraft } from "@/lib/fonciere/draftRecovery";
import { searchProjects } from "@/lib/fonciere/projectSearch";
import ProjectDriveSync from "./ProjectDriveSync";
import ProjectArbitrage, { ARBITRAGE_LABELS } from "./ProjectArbitrage";
import { createArbitrageRepository, type ArbitrationState } from "@/lib/fonciere/arbitrage";
import styles from "./ProjectsWorkspace.module.css";
import ProjectAccess from "./ProjectAccess";
import ProjectContacts from "./ProjectContacts";
import type { ContactCreateIntent } from "@/lib/contacts/createIntent";
import type { ProjectContactReturn } from "@/lib/fonciere/contactCreation";
import { AddressMapLink } from "@/components/address/AddressMapLink";
import { propertyAddressDetails, propertyAddressText } from "@/lib/fonciere/address";
import GuidedProjectField, { type GuidedFieldSpec } from "./GuidedProjectField";
import { sortSelectOptions } from "@/lib/selectOptions";
import { GUIDED_FIELD_DEFINITIONS, currentGuidedValue, guidedReadableFields, isGuidedFieldApplicable, readGuidedField, reconfirmGuidedField, suggestedFonciereName, type GuidedKey } from "@/lib/fonciere/guided";

type DocumentCategory = "agency" | "plans" | "photos" | "other";
const documentCategoryLabels: Record<DocumentCategory, [string, string]> = { agency: ["Documents agence", "Agency documents"], plans: ["Plans", "Plans"], photos: ["Photos", "Photos"], other: ["Autres documents", "Other documents"] };
type FieldKey = FonciereField | GuidedKey;
type Field = GuidedFieldSpec;
type Section = { id: string; fr: string; en: string; noteFr?: string; noteEn?: string; fields: Field[] };
type ImportReview = { report: AgencyReport; imported: FonciereData; selected: Set<FonciereField>; photos: boolean; };
type Props = { userId: string; canWrite: boolean; canReadContacts?: boolean; canWriteContacts?: boolean; canManageAccess?: boolean; canArchive?: boolean; canDownload?: boolean; accessRevision: number; accessSignal?: AbortSignal; onUnsavedChange?: (dirty: boolean) => void; onOpenContact?: (id: string) => void; onCreateContact?: (intent: ContactCreateIntent) => boolean; contactReturn?: ProjectContactReturn; onContactReturnConsumed?: () => void; };
const sections: Section[] = [
  { id: "identity", fr: "Identification", en: "Identification", fields: [
    { key: "name", fr: "Nom du projet", en: "Project name", wide: true },
    { key: "propertyType", fr: "Type de bien", en: "Property type" }, { key: "agencyReference", fr: "Référence agence", en: "Agency reference" },
    { key: "propertyAddress", fr: "Adresse du bien", en: "Property address", wide: true },
    { key: "city", fr: "Ville", en: "City" }, { key: "postalCode", fr: "Code postal", en: "Postal code" },
    { key: "location", fr: "Quartier / secteur", en: "District / area", wide: true },
    { key: "locationPrecision", fr: "Précision de la localisation", en: "Location precision", wide: true },
  ] },
  { id: "agency", fr: "Agence et interlocuteurs", en: "Agency and contacts", noteFr: "L’adresse de l’agence est distincte de celle du bien. Le contact CRM de l’agent se choisit ci-dessous.", noteEn: "The agency address is separate from the property address. Link the agent to a CRM contact below.", fields: [
    { key: "agencyName", fr: "Nom de l’agence", en: "Agency name", wide: true }, { key: "agencyAddress", fr: "Adresse de l’agence", en: "Agency address", wide: true },
    { key: "agencyPhone", fr: "Téléphone agence", en: "Agency phone" }, { key: "agencyEmail", fr: "Email agence", en: "Agency email" },
    { key: "agentName", fr: "Nom de l’agent", en: "Agent name", wide: true }, { key: "agentPhone", fr: "Téléphone agent", en: "Agent phone" }, { key: "agentEmail", fr: "Email agent", en: "Agent email" },
  ] },
  { id: "property", fr: "Caractéristiques du bien", en: "Property details", fields: [
    { key: "askingPrice", fr: "Prix demandé (€)", en: "Asking price (€)", numeric: true }, { key: "fees", fr: "Honoraires et répartition", en: "Fees and allocation", wide: true },
    { key: "area", fr: "Surface annoncée (m²)", en: "Advertised area (m²)", numeric: true }, { key: "areaKind", fr: "Nature de la surface", en: "Type of measurement" },
    { key: "land", fr: "Terrain (m²)", en: "Land area (m²)", numeric: true }, { key: "rooms", fr: "Pièces", en: "Rooms", numeric: true }, { key: "bedrooms", fr: "Chambres", en: "Bedrooms", numeric: true },
    { key: "condition", fr: "État du bien", en: "Property condition" },
    { key: "floor", fr: "Étage", en: "Floor" }, { key: "lots", fr: "Nombre de lots / logements", en: "Lots / dwellings" },
    { key: "uses", fr: "Usages", en: "Uses", wide: true }, { key: "occupancy", fr: "Occupation du bien", en: "Occupancy" },
    { key: "servicing", fr: "Viabilisation", en: "Utilities" }, { key: "buildability", fr: "Constructibilité à documenter", en: "Buildability — evidence required", wide: true },
    { key: "parkingSpaces", fr: "Nombre de places", en: "Parking spaces" }, { key: "parkingType", fr: "Type de stationnement", en: "Parking type" }, { key: "access", fr: "Accès", en: "Access" },
    { key: "equipment", fr: "Équipements", en: "Equipment", long: true }, { key: "annexes", fr: "Annexes / dépendances", en: "Annexes / outbuildings", long: true },
    { key: "annexCount", fr: "Quantité d’annexes", en: "Number of outbuildings" }, { key: "annexArea", fr: "Surface des annexes", en: "Outbuilding area" },
    { key: "exterior", fr: "Extérieurs", en: "Outdoor spaces", long: true }, { key: "exteriorArea", fr: "Surface des extérieurs", en: "Outdoor area" },
    { key: "pool", fr: "Piscine", en: "Pool", wide: true }, { key: "poolDetails", fr: "Détails de la piscine", en: "Pool details", wide: true },
    { key: "view", fr: "Vue", en: "View", wide: true }, { key: "seaExtent", fr: "Précision de la vue mer", en: "Sea view extent" },
  ] },
  { id: "description", fr: "Description et potentiel annoncé", en: "Description and advertised potential", noteFr: "Faits et possibilités annoncés par l’agence. Une possibilité mentionnée ne constitue pas une autorisation ni une rentabilité acquise.", noteEn: "Facts and possibilities advertised by the agency. An advertised possibility does not establish planning approval or guaranteed returns.", fields: [
    { key: "description", fr: "Description du bien", en: "Property description", long: true, wide: true },
    { key: "agencyPotential", fr: "Potentiel annoncé par l’agence", en: "Potential advertised by the agency", long: true, wide: true },
    { key: "renovation", fr: "Rénovation mentionnée", en: "Mentioned renovation", long: true, wide: true }, { key: "division", fr: "Division mentionnée", en: "Mentioned subdivision", long: true, wide: true },
    { key: "extension", fr: "Agrandissement mentionné", en: "Mentioned extension", long: true, wide: true }, { key: "resale", fr: "Revente mentionnée", en: "Mentioned resale", long: true }, { key: "rental", fr: "Location mentionnée", en: "Mentioned rental", long: true },
    { key: "pointsOfInterest", fr: "Points d’intérêt", en: "Points of interest", long: true }, { key: "pointsToVerify", fr: "Points à vérifier", en: "Points to verify", long: true, wide: true },
  ] },
  { id: "additional", fr: "Diagnostics, charges et contraintes", en: "Reports, charges and constraints", fields: [
    { key: "diagnostics", fr: "Diagnostics mentionnés", en: "Mentioned diagnostic reports", long: true, wide: true }, { key: "charges", fr: "Charges et périodicité", en: "Charges and frequency", long: true, wide: true }, { key: "constraints", fr: "Contraintes mentionnées", en: "Mentioned constraints", long: true, wide: true },
  ] },
  { id: "hypotheses", fr: "Hypothèses personnelles", en: "Personal assumptions", noteFr: "Estimations et hypothèses de travail à renseigner personnellement. Elles restent distinctes des informations issues de la fiche d’agence.", noteEn: "Estimates and working assumptions to enter personally. These remain separate from the agency brochure information.", fields: [
    { key: "worksHypothesis", fr: "Travaux envisagés / budget estimé", en: "Planned works / estimated budget", long: true, wide: true },
    { key: "resaleHypothesis", fr: "Hypothèses de revente", en: "Resale assumptions", long: true, wide: true }, { key: "rentalHypothesis", fr: "Hypothèses de location", en: "Rental assumptions", long: true, wide: true },
    { key: "notes", fr: "Notes personnelles", en: "Personal notes", long: true, wide: true },
  ] },
];
const fieldLabels = new Map(sections.flatMap(section => section.fields.map(field => [field.key, field] as const)));
function messageOf(error: unknown) { return error instanceof Error ? error.message : "L’opération n’a pas été confirmée. Le brouillon est conservé."; }
function bytes(value: number) { return value > 1_000_000 ? `${(value / 1_000_000).toFixed(1)} Mo` : `${Math.ceil(value / 1000)} Ko`; }
export default function ProjectsWorkspace({ userId, canWrite, canReadContacts = false, canWriteContacts = false, canManageAccess = false, canArchive = false, canDownload = false, accessRevision, accessSignal, onUnsavedChange, onOpenContact, onCreateContact, contactReturn, onContactReturnConsumed }: Props) {
  const [lang, setLang] = useFonciereLocale();
  const t = (fr: string, en: string) => lang === "fr" ? fr : en;
  const begin = useScopedOperations("fonciere");
  const creationScope = `${userId}:projects`;
  const draftError = (failure: unknown) => failure instanceof FonciereDraftInUseError ? "draft-in-use" : failure instanceof Error && /identité de brouillon|identité du brouillon|brouillon local|brouillons entre onglets|brouillon conservée|quota|storage/i.test(failure.message) ? "draft-storage-unavailable" : messageOf(failure);
  const draftLease = useRef<FonciereDraftLease | null>(null);
  const draftEpoch = useRef(0);
  const draftPersistence = useRef<Promise<void>>(Promise.resolve());
  const [draftReady, setDraftReady] = useState(false);
  const [creationReconciled, setCreationReconciled] = useState(false);
  const [creationConflict, setCreationConflict] = useState<FonciereCreationConflictError | null>(null);
  const [reconciliation, setReconciliation] = useState<LoadedFonciereProject | null>(null);
  const [projects, setProjects] = useState<LoadedFonciereProject["project"][]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [arbitrageFilter, setArbitrageFilter] = useState("");
  const [arbitrageStatuses, setArbitrageStatuses] = useState<Record<string, { status: ArbitrationState["status"] }>>({});
  const [arbitrageDirty, setArbitrageDirty] = useState(false);
  const [archived, setArchived] = useState(false);
  const [data, setData] = useState<FonciereData | null>(null);
  const [loaded, setLoaded] = useState<LoadedFonciereProject | null>(null);
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [sourceFileCategories, setSourceFileCategories] = useState<DocumentCategory[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accessBusy,setAccessBusy]=useState(false);
  const [contactPending, setContactPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [review, setReview] = useState<ImportReview | null>(null);
  const [activeSection, setActiveSection] = useState("identity");
  const controller = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const initialProjectHandled = useRef(false);
  const taskFocus = useTaskTargetFocus("fonciere_project", "document");
  const handledTaskFocus = useRef("");
  const importInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const reviewRef = useRef<HTMLElement>(null);
  const label = (key: string) => { const value = fieldLabels.get(key as FieldKey); return value ? t(value.fr, value.en) : key; };
  const importPending = review !== null;
  const writable = canWrite && loaded?.project.status !== "archived";

  const operation = useCallback(async () => {
    controller.current?.abort();
    const local = new AbortController();
    controller.current = local;
    const id = ++epoch.current;
    const scoped = await begin();
    const signal = AbortSignal.any([scoped.signal, local.signal, ...(accessSignal ? [accessSignal] : [])]);
    signal.throwIfAborted();
    return { id, scoped, signal, repository: createFonciereRepository(scoped.client, { accessToken: scoped.token }) };
  }, [begin, accessSignal]);
  function draftUrl(draftId: string) { return `/fonciere?draft=${encodeURIComponent(draftId)}`; }
  async function persistDraft() {
    const identity = draftLease.current?.identity;
    if (!identity || !data || !draftReady) return;
    const snapshot = { data, loaded, sourceFiles, sourceFileCategories, creationReconciled, updatedAt: new Date().toISOString() };
    const finished = beginPageRefreshOperation();
    draftPersistence.current = draftPersistence.current.catch(() => {}).then(() => saveFonciereLocalDraft(identity, snapshot)).finally(finished);
    await draftPersistence.current;
  }
  useEffect(() => {
    const candidate = new URL(window.location.href).searchParams.get("draft");
    const controller = new AbortController();
    const generation = ++draftEpoch.current;
    if (candidate && !new URL(window.location.href).searchParams.has("project")) void (async () => {
      const lease = await claimFonciereDraft(creationScope, candidate, controller.signal);
      if (controller.signal.aborted || generation !== draftEpoch.current) { lease.release(); return; }
      draftLease.current = lease;
      // Restoring a draft keeps the full requested route, including its anchor.
      const restoredUrl = new URL(window.location.href);
      if (restoredUrl.searchParams.get("draft") !== lease.identity.draftId) {
        restoredUrl.searchParams.set("draft", lease.identity.draftId);
        window.history.replaceState(null, "", restoredUrl.pathname + restoredUrl.search + restoredUrl.hash);
      }
      const restored = await readFonciereLocalDraft(lease.identity);
      if (controller.signal.aborted || generation !== draftEpoch.current || draftLease.current !== lease) return;
      if (!restored && lease.identity.confirmedProjectId) { lease.release(); draftLease.current = null; await open(lease.identity.confirmedProjectId, true); return; }
      if (restored) { setData(restored.data); setLoaded(restored.loaded); setSourceFiles(restored.sourceFiles); setSourceFileCategories(restored.sourceFileCategories); setCreationReconciled(restored.creationReconciled); setDirty(true); }
      else setData(createFonciereData());
      setDraftReady(true);
    })().catch(failure => { if (!controller.signal.aborted && generation === draftEpoch.current && !isCancelled(failure)) setError(draftError(failure)); });
    return () => { controller.abort(); draftLease.current?.release(); draftLease.current = null; };
    // Restore once per account scope; draftEpoch and lease ownership reject late reads.
    // A changing open callback must not restart recovery over the active editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creationScope]);
  useEffect(() => {
    if (!data || !draftReady || !draftLease.current || !dirty) return;
    const timer = window.setTimeout(() => { void persistDraft().catch(failure => setError(draftError(failure))); }, 150);
    return () => window.clearTimeout(timer);
    // Persist the current committed editor snapshot, scoped to its captured identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loaded, sourceFiles, sourceFileCategories, creationReconciled, draftReady, dirty]);
  function current(id: number) { return epoch.current === id && !controller.current?.signal.aborted && !accessSignal?.aborted; }
  function leave() { return !(dirty || accessBusy || contactPending || arbitrageDirty) || window.confirm(t("Ce projet contient des modifications non enregistrées. Quitter sans les enregistrer ?", "This project has unsaved changes. Leave without saving?")); }
  function edit(next: FonciereData) { if (!writable || busy || accessSignal?.aborted) return; setData(next); setDirty(true); setError(""); setNotice(""); }
  function editField(key: FonciereField, value: string) { if (data) edit({ ...data, [key]: value }); }

  const reload = useCallback(async () => {
    const op = await operation();
    try { const [rows, statuses] = await Promise.all([op.scoped.run(() => op.repository.listProjects({ signal: op.signal })), op.scoped.run(() => createArbitrageRepository(op.scoped.client).list(op.signal))]); if (current(op.id)) { setProjects(rows); setArbitrageStatuses(statuses); setListLoading(false); } }
    catch (failure) { if (current(op.id) && !isCancelled(failure)) { setError(messageOf(failure)); setListLoading(false); } }
  // The epoch intentionally owns async callbacks; current reads refs only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operation]);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => { if (alive) void reload().catch(failure => { if (alive && !isCancelled(failure)) { setError(messageOf(failure)); setListLoading(false); } }); }, 0);
    const stop = () => { controller.current?.abort(); epoch.current++; };
    accessSignal?.addEventListener("abort", stop, { once: true });
    return () => { alive = false; window.clearTimeout(timer); stop(); accessSignal?.removeEventListener("abort", stop); };
  }, [userId, accessRevision, reload, accessSignal]);
  useEffect(() => { onUnsavedChange?.(dirty || importPending || accessBusy || contactPending || arbitrageDirty); return () => onUnsavedChange?.(false); }, [dirty, importPending, accessBusy, contactPending, arbitrageDirty, onUnsavedChange]);
  usePageRefreshGuard({ dirty: dirty || sourceFiles.length > 0 || importPending || contactPending || arbitrageDirty, busy: busy || accessBusy });
  useEffect(() => {
    if (!importPending) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = reviewRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]') || []);
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = focusable(), first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    dialog?.addEventListener("keydown", trap);
    return () => { dialog?.removeEventListener("keydown", trap); previous?.focus(); };
  }, [importPending]);

  const projectHits = useMemo(() => searchProjects(projects.filter(project => (project.status === "archived") === archived && (!arbitrageFilter || (arbitrageStatuses[project.id]?.status || "pending") === arbitrageFilter)), query), [projects, archived, query, arbitrageFilter, arbitrageStatuses]);
  const visibleProjects = projectHits.map(hit => hit.item);
  const approximateProjects = new Set(projectHits.filter(hit => hit.approximate).map(hit => hit.item.id));

  const duplicates = useMemo(() => {
    if (!data) return [];
    const ref = normalizeContactSearch(data.agencyReference), address = normalizeContactSearch(data.propertyAddress);
    return projects.filter(project => { if (project.id === loaded?.project.id) return false; const other = (project.payload as { data?: Partial<FonciereData> } | undefined)?.data; return Boolean(ref && ref === normalizeContactSearch(other?.agencyReference || "") || address.length > 8 && address === normalizeContactSearch(other?.propertyAddress || "")); });
  }, [data, projects, loaded?.project.id]);

  const updateArbitrageStatus = useCallback((state: ArbitrationState) => {
    setArbitrageStatuses(previous => ({ ...previous, [state.projectId]: { status: state.status } }));
  }, []);
  async function rereadForArbitrage() {
    if (!loaded || dirty || busy) throw new Error("Dossier en cours de modification.");
    setBusy(true);
    let op: Awaited<ReturnType<typeof operation>> | undefined;
    try {
      op = await operation();
      const value = await op.scoped.run(() => op!.repository.loadProject(loaded.project.id, { signal: op!.signal, arbitration: true }));
      if (!current(op.id)) throw new Error("Relecture interrompue.");
      setLoaded(value); setData(value.data);
      setProjects(previous => previous.map(project => project.id === value.project.id ? value.project : project));
      return value.arbitrationFingerprint;
    } finally { if (!op || current(op.id)) setBusy(false); }
  }

  async function fresh() {
    if (!canWrite || busy || !leave()) return;
    const generation = ++draftEpoch.current;
    setBusy(true);
    try {
      const lease = await claimFonciereDraft(creationScope);
      if (generation !== draftEpoch.current) { lease.release(); return; }
      draftLease.current?.release(); draftLease.current = lease;
      controller.current?.abort(); epoch.current++;
      window.history.replaceState(null, "", draftUrl(lease.identity.draftId)); setData(createFonciereData()); setLoaded(null); setDraftReady(true); setCreationReconciled(false); setCreationConflict(null); setReconciliation(null); setDirty(false); setSourceFiles([]); setSourceFileCategories([]); setReview(null); setError(""); setNotice(""); setActiveSection("identity");
    } catch (failure) { if (generation === draftEpoch.current) setError(draftError(failure)); }
    finally { if (generation === draftEpoch.current) setBusy(false); }
  }
  async function open(id: string, preserveUrl = false) {
    if (busy || !leave()) return;
    draftEpoch.current++;
    setBusy(true); setError(""); setReview(null);
    let op: Awaited<ReturnType<typeof operation>> | undefined;
    try { op = await operation(); const value = await op.scoped.run(() => op!.repository.loadProject(id, { signal: op!.signal, arbitration: true })); if (current(op.id)) { if (!preserveUrl) window.history.replaceState(null, "", `/fonciere?project=${encodeURIComponent(value.project.id)}`); draftLease.current?.release(); draftLease.current = null; setDraftReady(false); setCreationReconciled(false); setCreationConflict(null); setReconciliation(null); setLoaded(value); setData(value.data); setDirty(false); setSourceFiles([]); setSourceFileCategories([]); setNotice(""); setActiveSection("identity"); } }
    catch (failure) { if ((!op || current(op.id)) && !isCancelled(failure)) setError(messageOf(failure)); }
    finally { if (!op || current(op.id)) setBusy(false); }
  }
  useEffect(() => {
    if (listLoading || initialProjectHandled.current) return;
    initialProjectHandled.current = true;
    const id = new URL(window.location.href).searchParams.get("project");
    if (!id) return;
    const timer = window.setTimeout(() => {
      if (projects.some(project => project.id === id)) void open(id, true);
      else setError(t("Ce projet est inaccessible ou n’existe plus.", "This project is unavailable or no longer exists."));
    }, 0);
    return () => window.clearTimeout(timer);
    // Open a requested record only once after the authorized list is loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listLoading, projects]);
  useEffect(() => {
    if (!taskFocus || listLoading || busy) return;
    const id = taskFocus.type === "fonciere_project" ? taskFocus.id : taskFocus.context?.catalog === "fonciere" ? taskFocus.context.projectId : "";
    const key = JSON.stringify(taskFocus);
    if (!id || handledTaskFocus.current === key) return;
    const timer = window.setTimeout(() => {
      handledTaskFocus.current = key;
      if (loaded?.project.id !== id) void open(id, true);
    }, 0);
    return () => window.clearTimeout(timer);
    // Open through the authorized repository; retain source form during task composition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskFocus, listLoading, busy]);
  useEffect(() => {
    if (taskFocus?.type !== "document" || taskFocus.context?.catalog !== "fonciere" || loaded?.project.id !== taskFocus.context.projectId) return;
    const timer = window.setTimeout(() => scrollTaskTarget(`fonciere-asset-${taskFocus.id}`), 0);
    return () => window.clearTimeout(timer);
  }, [taskFocus, loaded]);
  async function save() {
    if (!data || !writable || busy || review) return;
    if (contactPending) { setError(t("Terminez ou annulez la création du contact avant d’enregistrer le projet. Les deux brouillons sont conservés.", "Finish or cancel contact creation before saving the project. Both drafts are retained.")); document.querySelector<HTMLElement>('[aria-label="Création de contact CRM"], [aria-label="Create CRM contact"]')?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    const invalid = document.querySelector<HTMLElement>('[data-fonciere-projects] [aria-invalid="true"]');
    if (invalid) { setError(t("Corrigez le nombre signalé avant d’enregistrer. Le brouillon est conservé.", "Correct the highlighted number before saving. Your draft is retained.")); invalid.focus(); return; }
    if (!data.name.trim()) { setActiveSection("identity"); setError(t("Le nom du projet est obligatoire. Les autres champs peuvent rester vides.", "A project name is required. Other fields can remain empty.")); document.getElementById("fonciere-name")?.focus(); return; }
    setBusy(true); setError(""); setNotice(t("Enregistrement des informations et des documents…", "Saving information and documents…"));
    let op: Awaited<ReturnType<typeof operation>> | undefined;
    try {
      await persistDraft();
      const identity = draftLease.current?.identity;
      if (!loaded && !identity) throw new Error(t("L’identité du brouillon n’est pas encore confirmée. Votre saisie est conservée.", "Draft identity is not confirmed yet. Your entries are retained."));
      if (identity && !creationReconciled) markFonciereDraftAttempted(identity);
      op = await operation(); const saved = await op.scoped.run(() => op!.repository.saveProject({ data, previous: loaded || undefined, creationKey: identity?.creationKey, creationReconciled, sourceFiles, sourceFileCategories, onCreated: draft => { if (op && current(op.id)) setLoaded(draft); } }, { signal: op!.signal, arbitration: true, onProgress: progress => { if (op && current(op.id)) setNotice(`${progress.label} · ${progress.total ? Math.round(progress.completed / progress.total * 100) : 0} %`); } }));
      if (current(op.id)) { window.history.replaceState(null, "", `/fonciere?project=${encodeURIComponent(saved.project.id)}`); setLoaded(saved); setData(saved.data); setSourceFiles([]); setSourceFileCategories([]); setDirty(false); if (identity) { try { confirmFonciereDraft(identity, saved.project.id); await draftPersistence.current.catch(() => {}); await deleteFonciereLocalDraft(identity); } catch { /* The canonical project remains confirmed; retain its own recovery data if cleanup fails. */ } draftLease.current?.release(); draftLease.current = null; setDraftReady(false); } setCreationConflict(null); setReconciliation(null); setCreationReconciled(false); setNotice(t("Projet enregistré. Copie Google Drive en attente.", "Project saved. Google Drive copy pending.") + ` · ${t("révision", "revision")} ${saved.project.revision}`); setProjects(previous => [saved.project, ...previous.filter(project => project.id !== saved.project.id)]); }
    } catch (failure) { if ((!op || current(op.id)) && !isCancelled(failure)) { if (failure instanceof FonciereCreationConflictError) { setCreationConflict(failure); setReconciliation(null); setError(t("Cette identité de création correspond à une autre intention d’enregistrement. Votre brouillon et ses pièces jointes sont conservés ; comparez la fiche avant de continuer.", "This creation identity belongs to a different save request. Your draft and attachments are retained; compare the saved record before continuing.")); } else setError(draftError(failure)); setNotice(t("Le brouillon et les documents à enregistrer sont conservés dans cet onglet.", "The draft and pending documents remain in this tab.")); } }
    finally { if (!op || current(op.id)) setBusy(false); }
  }
  async function inspectCreationConflict() {
    if (!creationConflict?.projectId || busy) return;
    setBusy(true); let op: Awaited<ReturnType<typeof operation>> | undefined;
    try { op = await operation(); const canonical = await op.scoped.run(() => op!.repository.loadProject(creationConflict.projectId!, { signal: op!.signal, arbitration: true })); if (current(op.id)) setReconciliation(canonical); }
    catch (failure) { if ((!op || current(op.id)) && !isCancelled(failure)) setError(messageOf(failure)); }
    finally { if (!op || current(op.id)) setBusy(false); }
  }
  function reconcileCreation() {
    if (!reconciliation || busy || reconciliation.project.status === "archived") return;
    setLoaded(reconciliation); setCreationReconciled(true); setCreationConflict(null); setReconciliation(null); setDirty(true); setError("");
    setNotice(t("La fiche existante sert maintenant de base. Votre saisie et vos pièces jointes sont conservées. Vérifiez-les avant d’enregistrer.", "The existing record is now the baseline. Your entries and attachments are retained. Review them before saving."));
  }
  async function archive() {
    if (!loaded || !canWrite || !canArchive || busy || !leave()) return;
    const next = loaded.project.status !== "archived";
    if (!window.confirm(t(next ? "Archiver ce projet ? Ses informations et documents seront conservés." : "Réactiver ce projet ?", next ? "Archive this project? Its information and documents will be retained." : "Restore this project?"))) return;
    setBusy(true); setError(""); let op: Awaited<ReturnType<typeof operation>> | undefined;
    try { op = await operation(); await op.scoped.run(() => op!.repository.archiveProject(loaded.project, next, { signal: op!.signal })); const value = await op.scoped.run(() => op!.repository.loadProject(loaded.project.id, { signal: op!.signal, arbitration: true })); if (current(op.id)) { setLoaded(value); setData(value.data); setDirty(false); setSourceFiles([]); setSourceFileCategories([]); setProjects(previous => previous.map(project => project.id === value.project.id ? value.project : project)); setNotice(t(next ? "Projet archivé. Les présentations existantes sont conservées." : "Projet réactivé.", next ? "Project archived. Existing presentations are preserved." : "Project restored.")); } }
    catch (failure) { if ((!op || current(op.id)) && !isCancelled(failure)) setError(messageOf(failure)); }
    finally { if (!op || current(op.id)) setBusy(false); }
  }
  async function importAgency(file: File) {
    if (!canWrite || busy || review || data && !writable) return;
    if (!data) { const generation = ++draftEpoch.current; try { const lease = await claimFonciereDraft(creationScope); if (generation !== draftEpoch.current) { lease.release(); return; } draftLease.current?.release(); draftLease.current = lease; setDraftReady(true); window.history.replaceState(null, "", draftUrl(lease.identity.draftId)); } catch (failure) { setError(draftError(failure)); return; } }
    const initial = data || createFonciereData();
    setData(initial); setBusy(true); setError(""); setNotice(t("Analyse de la fiche d’agence…", "Reading agency brochure…"));
    let op: Awaited<ReturnType<typeof operation>> | undefined;
    try {
      if (sourceFiles.length + (loaded?.sourceDocuments.length || 0) >= FONCIERE_DOCUMENT_LIMIT) throw new Error(t("Trente documents sources maximum par projet.", "A maximum of thirty source documents per project."));
      if (!file.size || file.size > LIMITS.fileBytes || !/\.(?:pdf|jpe?g|png|webp)$/i.test(file.name)) throw new Error(t("Choisissez un PDF, JPEG, PNG ou WebP de 25 Mo maximum.", "Choose a PDF, JPEG, PNG or WebP up to 25 MB."));
      // Preserve the original even when parsing fails. Saving the draft uploads it with server authorization.
      setSourceFiles(previous => [...previous, file]); setSourceFileCategories(previous => [...previous, "agency"]); setDirty(true);
      op = await operation();
      const reports = await analyzeAgencyFiles([file], { signal: op.signal, onProgress: (name, page, total) => { if (op && current(op.id)) setNotice(`${name} · ${t("page", "page")} ${page}${total ? ` / ${total}` : ""}`); } });
      const report = reports[0]; if (!report) throw new Error(t("Aucune donnée extraite. Le document original reste joint ; complétez manuellement.", "No data extracted. The original is attached; complete the form manually."));
      const imported = await agencyReportToFonciere(report, op.signal);
      op.signal.throwIfAborted();
      if (current(op.id)) { const proposals = proposeAgencyImport(initial, imported); setReview({ report, imported, selected: new Set(proposals.filter(item => !item.current.trim()).map(item => item.key)), photos: true }); setNotice(""); }
    } catch (failure) { if ((!op || current(op.id)) && !isCancelled(failure)) { setError(messageOf(failure)); setNotice(t("Extraction impossible ou partielle. Le document original reste joint au brouillon. Les champs peuvent être complétés manuellement.", "Extraction failed or was partial. The original remains attached to the draft. Fields can be completed manually.")); } }
    finally { if (!op || current(op.id)) setBusy(false); }
  }
  function acceptImport() {
    if (!review || !data || !writable) return;
    const invalid = reviewRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (invalid) { invalid.focus(); setError(t("Corrigez le nombre signalé avant d’appliquer l’import.", "Correct the highlighted number before applying the import.")); return; }
    try {
      const imported = structuredClone(review.imported);
      if (!review.photos) imported.presentationData = { ...imported.presentationData, importGallery: [], photos: createFonciereData().presentationData.photos, photoGalleryRoles: {} };
      const next = applyAgencyImport(data, imported, [...review.selected]);
      edit(next); setReview(null); setNotice(t("Propositions retenues appliquées au brouillon. Vérifiez puis enregistrez le projet.", "Selected proposals applied to the draft. Review and save the project."));
    } catch (failure) { setError(messageOf(failure)); }
  }
  async function addPhotos(files: File[]) {
    if (!data || !writable || busy) return;
    if (sourceFiles.length + files.length + (loaded?.sourceDocuments.length || 0) > FONCIERE_DOCUMENT_LIMIT) { setError(t("Trente documents sources maximum par projet, originaux des photos compris.", "A maximum of thirty source documents per project, including original photos.")); return; }
    setBusy(true); setError(""); let op: Awaited<ReturnType<typeof operation>> | undefined;
    try { op = await operation(); let next = data.presentationData; for (const file of files) { op.signal.throwIfAborted(); next = await addPhotoFile(next, file, undefined, op.signal); } if (current(op.id)) { setData({ ...data, presentationData: next }); setSourceFiles(previous => [...previous, ...files]); setSourceFileCategories(previous => [...previous, ...files.map(() => "photos" as const)]); setDirty(true); } }
    catch (failure) { if ((!op || current(op.id)) && !isCancelled(failure)) setError(messageOf(failure)); }
    finally { if (!op || current(op.id)) setBusy(false); }
  }
  function addAttachments(files: File[]) {
    if (!data || !writable || busy) return;
    if (sourceFiles.length + files.length + (loaded?.sourceDocuments.length || 0) > FONCIERE_DOCUMENT_LIMIT) { setError(t("Trente documents sources maximum par projet.", "A maximum of thirty source documents per project.")); return; }
    const invalid = files.find(file => !file.size || file.size > LIMITS.fileBytes || !/\.(?:pdf|jpe?g|png|webp)$/i.test(file.name));
    if (invalid) { setError(`${invalid.name} : ${t("PDF, JPEG, PNG ou WebP de 25 Mo maximum.", "PDF, JPEG, PNG or WebP up to 25 MB.")}`); return; }
    setSourceFiles(previous => [...previous, ...files]); setSourceFileCategories(previous => [...previous, ...files.map(() => "other" as const)]); setDirty(true);
  }
  async function download(asset: FonciereAssetRecord) {
    if (busy || !canDownload) return;
    setBusy(true); setError(""); let op: Awaited<ReturnType<typeof operation>> | undefined;
    try { op = await operation(); const blob = await op.scoped.run(() => op!.repository.downloadAsset(asset, { signal: op!.signal })); await op.scoped.download(blob, asset.original_name || "document"); }
    catch (failure) { if ((!op || current(op.id)) && !isCancelled(failure)) setError(messageOf(failure)); }
    finally { if (!op || current(op.id)) setBusy(false); }
  }
  const gallery = data?.presentationData.importGallery || [];
  const sourceAssets = loaded?.assets.filter(asset => asset.lifecycle === "finalized" && loaded.sourceDocuments.includes(asset.id)) || [];
  const documentOptions = sourceAssets.map(asset => ({ id: asset.id, label: asset.original_name || t("Document du projet", "Project document") }));
  const guidedText = data ? guidedReadableFields(data, lang) : null;
  const propertyType = data ? readGuidedField(data, "propertyType") : undefined;
  const suggestedName = data ? suggestedFonciereName(data, lang) : "";
  const hasSelections = (key: GuidedKey, allowed?: string[]) => {
    const value = data ? currentGuidedValue(data, key) : undefined;
    return Array.isArray(value) && value.some(item => typeof item === "string" && (allowed ? allowed.includes(item) : !["none", "not_applicable", "to_confirm"].includes(item)));
  };
  function fieldContextApplies(key: FieldKey) {
    if (!(key in GUIDED_FIELD_DEFINITIONS) || !data) return true;
    const guidedKey = key as GuidedKey, def = GUIDED_FIELD_DEFINITIONS[guidedKey];
    if (!isGuidedFieldApplicable(guidedKey, propertyType) || "types" in def && !propertyType) return false;
    if (["annexCount", "annexArea"].includes(key)) return hasSelections("annexes");
    if (key === "exteriorArea") return hasSelections("exterior");
    if (key === "poolDetails") return ["private", "shared", "planned"].includes(String(currentGuidedValue(data, "pool")));
    if (key === "seaExtent") return hasSelections("view", ["sea"]);
    return true;
  }
  function isVisibleField(key: FieldKey) { return fieldContextApplies(key) && !(data && key in GUIDED_FIELD_DEFINITIONS && data.guided.inactive.includes(key as GuidedKey)); }
  function retainedFields(section: Section) {
    if (!data) return [];
    return section.fields.filter(field => field.key in GUIDED_FIELD_DEFINITIONS && !isVisibleField(field.key) && (readGuidedField(data, field.key as GuidedKey) !== undefined && readGuidedField(data, field.key as GuidedKey) !== null || typeof data[field.key as FonciereField] === "string" && Boolean(data[field.key as FonciereField]) || Boolean(data.guided.details[field.key as GuidedKey])));
  }
  function suggestionsFor(key: FieldKey): string[] {
    if (!["propertyAddress", "city", "postalCode"].includes(key)) return [];
    return sortSelectOptions([...new Set(projects.flatMap(project => {
      const saved = (project.payload as { data?: Partial<FonciereData> } | undefined)?.data;
      const value = saved?.[key as FonciereField];
      return typeof value === "string" && value.trim() ? [value] : [];
    }))], value => value, lang);
  }

  return <div className={styles.workspace} lang={lang} data-fonciere-projects>
    <input ref={importInput} className={styles.hidden} type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importAgency(file); }} aria-label={t("Importer une fiche d’agence", "Import an agency brochure")} />
    <input ref={photoInput} className={styles.hidden} type="file" multiple accept="image/jpeg,image/png,.jpg,.jpeg,.png" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; void addPhotos(files); }} aria-label={t("Ajouter des photos", "Add photos")} />
    <input ref={attachmentInput} className={styles.hidden} type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; addAttachments(files); }} aria-label={t("Ajouter des documents", "Add documents")} />
    <header className={styles.heading}>
      <div><p className={styles.eyebrow}>FONCIÈRE <span>/</span> {t("PATRIMOINE & OPPORTUNITÉS", "PROPERTY & OPPORTUNITIES")}</p><h1>{t("Projets", "Projects")}</h1><p className={styles.intro}>{t("Un lieu pour réunir vos biens, leurs documents et vos prochaines décisions.", "Your properties, source documents and next decisions, together in one place.")}</p></div>
      <div className={styles.headingActions}><div className={styles.language} aria-label={t("Langue du formulaire", "Form language")}>{(["fr", "en"] as const).map(value => <button key={value} type="button" aria-pressed={lang === value} onClick={() => setLang(value)}>{value.toUpperCase()}</button>)}</div>{canWrite && <button className={styles.primary} type="button" disabled={busy || importPending} onClick={fresh}><Plus size={16} />{t("Nouveau projet", "New project")}</button>}</div>
    </header>
    {error && <p className={styles.error} role="alert">{error === "draft-in-use" ? t("Ce brouillon est déjà ouvert dans un autre onglet. Vérifiez sa tentative d’enregistrement avant de le reprendre.", "This draft is already open in another tab. Review its save attempt before resuming it.") : error === "draft-storage-unavailable" ? t("La conservation locale du brouillon ou sa protection entre onglets est indisponible. Votre saisie reste dans cet onglet ; vérifiez la tentative avant de continuer.", "Local draft storage or protection between tabs is unavailable. Your entries remain in this tab; review the save attempt before continuing.") : error}</p>}
    {creationConflict && <section className={styles.warning} data-creation-reconciliation><h3>{t("Vérifier la tentative d’enregistrement", "Review the save attempt")}</h3><p>{t("Votre brouillon reste conservé. Aucune autre fiche ne sera créée automatiquement.", "Your draft is retained. No other record will be created automatically.")}</p>{creationConflict.projectId && <><button type="button" disabled={busy} onClick={() => void inspectCreationConflict()}>{t("Comparer avec la fiche enregistrée", "Compare with the saved record")}</button> <a href={`/fonciere?project=${encodeURIComponent(creationConflict.projectId)}`} target="_blank" rel="noreferrer">{t("Ouvrir la fiche dans un autre onglet", "Open the record in another tab")}</a></>}{reconciliation && <div><p>{t("Fiche enregistrée", "Saved record")} : {reconciliation.project.project_reference} · {reconciliation.project.title} · r{reconciliation.project.revision}</p><p>{t("Votre brouillon", "Your draft")} : {data?.name} · {sourceFiles.length} {t("pièce(s) jointe(s) conservée(s)", "retained attachment(s)")}</p><button type="button" disabled={busy || reconciliation.project.status === "archived"} onClick={reconcileCreation}>{t("Utiliser cette fiche comme base et conserver mon brouillon", "Use this record as the baseline and keep my draft")}</button></div>}</section>}
    {notice && <p className={styles.notice} role="status"><Check size={16} />{notice}</p>}
    {!data ? <>
      <div className={styles.listToolbar}><label className={styles.search}><Search size={17} /><span className={styles.srOnly}>{t("Rechercher un projet", "Search projects")}</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("Numéro, nom, adresse ou référence agence…", "Number, name, address or agency reference…")} /></label><label className={styles.arbitrageFilter}><span>{t("Arbitrage", "Arbitration")}</span><select value={arbitrageFilter} onChange={event => setArbitrageFilter(event.target.value)}><option value="">{t("Tous les statuts", "All decisions")}</option>{(Object.keys(ARBITRAGE_LABELS) as ArbitrationState["status"][]).map(status => <option key={status} value={status}>{t(ARBITRAGE_LABELS[status][0], ARBITRAGE_LABELS[status][1])}</option>)}</select></label><div className={styles.tabs}><button aria-pressed={!archived} onClick={() => setArchived(false)}>{t("En cours", "Active")} <span>{projects.filter(project => project.status !== "archived").length}</span></button><button aria-pressed={archived} onClick={() => setArchived(true)}>{t("Archivés", "Archived")}</button></div><button className={styles.iconButton} disabled={listLoading || busy} onClick={() => void reload().catch(failure => setError(messageOf(failure)))} aria-label={t("Actualiser la liste", "Refresh list")}><RefreshCw size={17} /></button></div>
      {canWrite && <button className={styles.importBanner} disabled={busy} onClick={() => importInput.current?.click()}><span className={styles.uploadIcon}><Upload size={22} /></span><span><strong>{t("Importer une fiche d’agence", "Import an agency brochure")}</strong><span>{t("PDF ou image · extraction et OCR · validation avant enregistrement", "PDF or image · extraction and OCR · review before saving")}</span></span><ArrowUpRight size={20} /></button>}
      {listLoading ? <div className={styles.empty} role="status"><RefreshCw size={28} /><h2>{t("Chargement des projets…", "Loading projects…")}</h2></div> : visibleProjects.length ? <div className={styles.projectGrid}>{visibleProjects.map(project => { const item = (project.payload as { data?: Partial<FonciereData> } | undefined)?.data; const display = item ? guidedReadableFields({ ...createFonciereData(), ...item }, lang) : undefined; return <button key={project.id} className={styles.projectCard} disabled={busy} onClick={() => void open(project.id)}><div className={styles.cardTop}><span className={styles.propertyIcon}><Building2 size={23} /></span><span className={styles.pill}>{archived ? t("Archivé", "Archived") : display?.propertyType || t("Projet immobilier", "Property project")}</span></div>{project.project_reference && <span className={styles.projectReference}>{project.project_reference}</span>}<h2>{project.title}</h2><span className={styles.arbitrageBadge} data-arbitrage-status={arbitrageStatuses[project.id]?.status || "pending"}>{t(ARBITRAGE_LABELS[arbitrageStatuses[project.id]?.status || "pending"][0], ARBITRAGE_LABELS[arbitrageStatuses[project.id]?.status || "pending"][1])}</span>{approximateProjects.has(project.id) && <small>{t("Correspondance approchée", "Close match")}</small>}<p className={styles.location}><MapPin size={14} />{[item?.propertyAddress, item?.city].filter(Boolean).join(" · ") || t("Adresse à compléter", "Address to complete")}</p><div className={styles.cardBottom}><span>{display?.askingPrice ? display.askingPrice : item?.agencyReference ? `${t("Réf.", "Ref.")} ${item.agencyReference}` : t("Fiche à enrichir", "Ready to enrich")}</span><ChevronRight size={18} /></div></button>; })}</div> : <div className={styles.empty}><FolderOpen size={38} strokeWidth={1} /><h2>{query ? t("Aucun projet trouvé", "No matching projects") : archived ? t("Aucun projet archivé", "No archived projects") : t("Votre premier projet commence ici", "Your first project starts here")}</h2><p>{query ? t("Essayez un nom, une adresse ou une référence différente.", "Try a different name, address or reference.") : t("Créez une fiche à votre rythme ou partez d’une fiche d’agence. Seul le nom du projet est nécessaire.", "Create a record at your own pace or start with an agency brochure. Only a project name is required.")}</p>{canWrite && !archived && <button className={styles.secondary} onClick={fresh}><Plus size={16} />{t("Créer un projet", "Create a project")}</button>}</div>}
    </> : <>
      <TaskSourceActions reference={loaded ? { type: "fonciere_project", id: loaded.project.id } : undefined} saved={Boolean(loaded)} title={t("Compléter le projet", "Complete the project")} />
      <div className={styles.recordToolbar}><button className={styles.back} disabled={busy || importPending} onClick={() => { if (leave()) { window.history.replaceState(null, "", "/fonciere"); draftEpoch.current++; draftLease.current?.release(); draftLease.current = null; setDraftReady(false); controller.current?.abort(); epoch.current++; setData(null); setLoaded(null); setDirty(false); setSourceFiles([]); setSourceFileCategories([]); setReview(null); setError(""); setNotice(""); } }}><ArrowLeft size={16} />{t("Tous les projets", "All projects")}</button><span className={styles.saveState}>{busy ? t("Opération en cours…", "Working…") : dirty ? t("Modifications non enregistrées", "Unsaved changes") : loaded ? `${t("Enregistré", "Saved")} · r${loaded.project.revision}` : t("Nouveau projet", "New project")}</span><div className={styles.recordActions}>{canWrite && canArchive && loaded && <button className={styles.secondary} disabled={busy || importPending} onClick={() => void archive()}><Archive size={15} />{loaded.project.status === "archived" ? t("Réactiver", "Restore") : t("Archiver", "Archive")}</button>}{writable && <button className={styles.primary} disabled={busy || importPending} onClick={() => void save()}><Save size={16} />{t("Enregistrer", "Save project")}</button>}</div></div>
      <div className={styles.recordHero}><div><p className={styles.eyebrow}>{loaded?.project.status === "archived" ? t("PROJET ARCHIVÉ", "ARCHIVED PROJECT") : t("FICHE PROJET", "PROJECT RECORD")}</p><p className={styles.projectReference}>{loaded?.project.project_reference || t("Numéro attribué à l’enregistrement", "Number assigned on save")}</p><h2>{data.name || t("Nouveau projet", "New project")}</h2><p><MapPin size={15} />{[data.propertyAddress, data.city].filter(Boolean).join(" · ") || t("Adresse du bien à renseigner", "Property address to complete")}</p><AddressMapLink address={propertyAddressText(data)} metadata={propertyAddressDetails(data)} lang={lang} /></div><div className={styles.heroMetrics}>{guidedText?.askingPrice && <div><span>{t("Prix demandé", "Asking price")}</span><strong>{guidedText.askingPrice}</strong></div>}{guidedText?.area && <div><span>{guidedText?.areaKind || t("Surface annoncée", "Advertised area")}</span><strong>{guidedText.area}</strong></div>}{data.agencyReference && <div><span>{t("Référence agence", "Agency reference")}</span><strong className={styles.reference}>{data.agencyReference}</strong></div>}</div></div>
      {duplicates.length > 0 && <div className={styles.warning} role="status"><strong>{t("Doublon possible", "Possible duplicate")}</strong><p>{t("Une référence agence ou une adresse correspond à : ", "An agency reference or address matches: ")}{duplicates.map(project => project.title).join(", ")}. {t("Vérifiez avant d’enregistrer. Aucun rapprochement automatique.", "Check before saving. Records are never merged automatically.")}</p></div>}
      <div className={styles.recordLayout}>
        <nav className={styles.sectionNav} aria-label={t("Sections de la fiche projet", "Project record sections")}>{sections.map((section, index) => <a key={section.id} href={`#fonciere-section-${section.id}`} aria-current={activeSection === section.id ? "location" : undefined} onClick={() => setActiveSection(section.id)}><span>{String(index + 1).padStart(2, "0")}</span>{t(section.fr, section.en)}</a>)}<a href="#fonciere-documents" onClick={() => setActiveSection("documents")} aria-current={activeSection === "documents" ? "location" : undefined}><span>07</span>{t("Documents et visuels", "Documents and visuals")}</a><a href="#fonciere-arbitrage" onClick={() => setActiveSection("arbitrage")} aria-current={activeSection === "arbitrage" ? "location" : undefined}><span>08</span>{t("— Arbitrage", "— Arbitration")}</a></nav>
        <div className={styles.sections}>
          {sections.map((section, index) => <section key={section.id} id={`fonciere-section-${section.id}`} className={`${styles.section} ${section.id === "hypotheses" ? styles.assumptions : ""}`}><header className={styles.sectionHeading}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{t(section.fr, section.en)}</h3>{section.noteFr && <p>{t(section.noteFr, section.noteEn || "")}</p>}</div></header><fieldset disabled={!writable || busy || importPending} className={styles.fieldset}><div className={styles.fieldGrid}>{section.id === "identity" && <label className={styles.wide}><span>{t("Référence projet", "Project reference")}</span><input readOnly aria-readonly="true" value={loaded?.project.project_reference || t("Numéro attribué à l’enregistrement", "Number assigned on save")} /></label>}{section.fields.filter(field => section.id !== "agency" && isVisibleField(field.key)).map(field => <GuidedProjectField key={field.key} field={field} data={data} onChange={edit} lang={lang} disabled={!writable || busy || importPending} suggestions={suggestionsFor(field.key)} documents={documentOptions} />)}</div>{section.id === "identity" && !data.name.trim() && suggestedName && <div className={styles.suggestedName}><span>{t("Nom suggéré", "Suggested name")} : {suggestedName}</span><button type="button" onClick={() => editField("name", suggestedName)}>{t("Utiliser ce nom", "Use this name")}</button></div>}</fieldset>
            {retainedFields(section).length > 0 && <details className={styles.contextNote} data-retained-fields><summary>{t("Informations conservées à revoir", "Retained information to review")} ({retainedFields(section).length})</summary><p>{t("Ces informations restent enregistrées. Elles ne sont pas utilisées comme caractéristiques actuelles tant que leur contexte n’est pas confirmé. Revenez au type concerné pour les confirmer, ou consultez-les ici.", "This information remains saved. It is excluded from current property characteristics until its context is confirmed. Return to the relevant property type to confirm it, or review it here.")}</p><fieldset disabled={!writable || busy || importPending}><div className={styles.fieldGrid}>{retainedFields(section).map(field => <div key={field.key} className={field.wide ? styles.wide : ""}><GuidedProjectField field={field} data={data} onChange={next => { const key = field.key as GuidedKey; edit({ ...next, guided: { ...next.guided, inactive: [...new Set([...next.guided.inactive, key])] } }); }} lang={lang} disabled={!writable || busy || importPending} documents={documentOptions} idPrefix="fonciere-retained" />{fieldContextApplies(field.key) && <button type="button" className={styles.reconfirm} onClick={() => edit(reconfirmGuidedField(data, field.key as GuidedKey))}>{t("Confirmer pour ce type de bien", "Confirm for this property type")}</button>}</div>)}</div></fieldset></details>}
            {section.id === "agency" && <ProjectContacts key={loaded?.project.id || "new"} data={data} onChange={edit} canReadContacts={canReadContacts} canWriteContacts={canWriteContacts} disabled={!writable || busy || importPending} accessSignal={accessSignal} onOpenContact={onOpenContact} onPendingChange={setContactPending} onCreateContact={intent => {
              if (!writable || busy || importPending || !onCreateContact) return false;
              setActiveSection("agency");
              return onCreateContact(intent);
            }} contactReturn={contactReturn} onContactReturnHandled={() => {
              setActiveSection("agency");
              if (contactReturn?.contact) setNotice(t("Contact enregistré. Les modifications du projet restent à enregistrer.", "Contact saved. Project changes still need to be saved."));
              onContactReturnConsumed?.();
              document.getElementById("fonciere-section-agency")?.scrollIntoView({ block: "start" });
            }} />}
          </section>)}
          <section id="fonciere-documents" className={styles.section}><header className={styles.sectionHeading}><span>07</span><div><h3>{t("Documents et visuels", "Documents and visuals")}</h3><p>{t("Conservez la fiche originale, les plans et les photos. Les fichiers sont enregistrés avec le projet.", "Keep the original brochure, plans and photos. Files are saved with the project.")}</p></div></header>{writable && <div className={styles.documentActions}><button className={styles.secondary} disabled={busy || importPending} onClick={() => importInput.current?.click()}><Upload size={16} />{t("Importer une fiche d’agence", "Import an agency brochure")}</button><button className={styles.secondary} disabled={busy || importPending} onClick={() => attachmentInput.current?.click()}><FileText size={16} />{t("Ajouter un document / plan", "Add a document / plan")}</button><button className={styles.secondary} disabled={busy || importPending} onClick={() => photoInput.current?.click()}><ImagePlus size={16} />{t("Ajouter des photos", "Add photos")}</button></div>}{loaded && <ProjectDriveSync key={loaded.project.id} projectId={loaded.project.id} revision={loaded.project.revision} lang={lang} accessSignal={accessSignal}/>}<p className={styles.muted}>{t("PDF, JPEG, PNG ou WebP · 25 Mo par fichier · 30 documents sources maximum. Les originaux ajoutés sont conservés ; les aperçus sont optimisés pour les présentations.", "PDF, JPEG, PNG or WebP · 25 MB per file · up to 30 source documents. Added originals are retained; previews are optimized for presentations.")}</p>{!canDownload && sourceAssets.length > 0 && <p className={styles.muted}>{t("Le téléchargement des originaux nécessite le droit Export et téléchargement. Les références documentaires et la consultation du projet restent disponibles.", "Downloading originals requires Export and download permission. Document references and project viewing remain available.")}</p>}<div className={styles.documentList}>{sourceAssets.map(asset => <div id={`fonciere-asset-${asset.id}`} key={asset.id} className={styles.document} style={{ flexWrap: "wrap" }}><FileText size={20} /><span><TaskSourceActions reference={{ type: "document", id: asset.id, context: { catalog: "fonciere", projectId: loaded!.project.id } }} title={t("Vérifier le document", "Review the document")} /><strong>{asset.original_name || t("Document original", "Original document")}</strong><span>{bytes(asset.expected_size)} · {t(...documentCategoryLabels[asset.drive_category || "other"])} · {t("Enregistré", "Saved")}</span></span><button disabled={busy || !canDownload} className={styles.iconButton} onClick={() => void download(asset)} aria-label={`${t("Télécharger", "Download")} ${asset.original_name || "document"}`}><Download size={17} /></button></div>)}{sourceFiles.map((file, index) => <div key={`${file.name}-${index}`} className={styles.document} style={{ flexWrap: "wrap" }}><FileText size={20} /><span><strong>{file.name}</strong><span>{bytes(file.size)} · {t("À enregistrer avec le projet", "Pending project save")}</span></span><label className={styles.fileCategory}><span>{t("Classement Drive", "Drive category")}</span><select aria-label={`${t("Classement", "Category")} · ${file.name}`} disabled={busy || !writable} value={sourceFileCategories[index] || "other"} onChange={event => { const category = event.target.value as DocumentCategory; setSourceFileCategories(previous => sourceFiles.map((_, at) => at === index ? category : previous[at] || "other")); setDirty(true); }}>{(Object.keys(documentCategoryLabels) as DocumentCategory[]).map(category => <option key={category} value={category}>{t(...documentCategoryLabels[category])}</option>)}</select></label><span className={styles.pending}>{t("Brouillon", "Draft")}</span></div>)}</div>{gallery.length > 0 && <div className={styles.gallery} data-project-gallery>{gallery.map((photo, index) => <figure key={`${index}-${photo.label}`}><Image src={photo.data} alt={photo.label || `${t("Photo du projet", "Project photo")} ${index + 1}`} width={260} height={170} unoptimized /><figcaption>{photo.label || `${t("Photo", "Photo")} ${index + 1}`}{photo.source && <span>{photo.source}</span>}</figcaption></figure>)}</div>}{!gallery.length && !sourceFiles.length && !sourceAssets.length && <div className={styles.documentEmpty}><FileText size={23} /><p>{t("Aucun document joint pour le moment.", "No documents attached yet.")}</p></div>}{data.provenance.length > 0 && <details className={styles.provenance}><summary>{t("Provenance des informations importées", "Imported information sources")} <span>{data.provenance.length}</span></summary><p className={styles.muted}>{t("Sources lues lors des imports. Les valeurs retenues dans la fiche restent modifiables.", "Sources read during import. Values retained in the record remain editable.")}</p>{data.provenance.map(source => <article className={styles.source} key={source.id}><h4>{source.filename}</h4><p>{source.method === "ocr" ? t("Lecture OCR", "OCR reading") : source.method === "mixed" ? t("Texte et OCR", "Text and OCR") : t("Lecture du texte", "Text extraction")} · {new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium" }).format(new Date(source.importedAt))}</p>{Object.keys(source.fields).some(key => key !== "coordinates") && <dl>{Object.entries(source.fields).filter(([key]) => key !== "coordinates").map(([key, evidence]) => <div key={key}><dt>{label(key)}{evidence.page ? ` · p. ${evidence.page}` : ""}</dt><dd>{evidence.extract}</dd></div>)}</dl>}{source.warnings.length > 0 && <ul>{source.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}</article>)}</details>}</section>
          <section id="fonciere-arbitrage" className={styles.section}><header className={styles.sectionHeading}><div><h3>{t("08 — Arbitrage", "08 — Arbitration")}</h3><p>{t("Deux avis séparés sur le même dossier enregistré, puis une décision commune calculée automatiquement.", "Two separate opinions on the same saved file, then an automatically calculated joint decision.")}</p></div></header>{loaded ? <ProjectArbitrage key={loaded.project.id} projectId={loaded.project.id} userId={userId} loadedRevision={loaded.project.revision} loadedFingerprint={loaded.arbitrationFingerprint} projectDirty={dirty || sourceFiles.length > 0 || importPending} lang={lang} accessRevision={accessRevision} accessSignal={accessSignal} onDirty={setArbitrageDirty} onStatusChange={updateArbitrageStatus} onReloadProject={rereadForArbitrage}/> : <p className={styles.muted}>{t("Enregistrez le projet pour recueillir les avis sur sa première version. Aucun avis n’est attribué automatiquement.", "Save the project to collect opinions on its first version. No opinion is assigned automatically.")}</p>}</section>
          {canManageAccess && loaded && <ProjectAccess key={loaded.project.id} projectId={loaded.project.id} userId={userId} accessSignal={accessSignal} onDirty={setAccessBusy}/>}
          {writable && <div className={styles.footerSave}><p>{t("Le nom suffit pour enregistrer. Vous pourrez enrichir cette fiche à tout moment.", "A name is enough to save. You can enrich this record at any time.")}</p><button className={styles.primary} disabled={busy || importPending} onClick={() => void save()}><Save size={16} />{t("Enregistrer le projet", "Save project")}</button></div>}
        </div>
      </div>
    </>}
    {review && data && <div className={styles.reviewBackdrop}><section ref={reviewRef} className={styles.review} role="dialog" aria-modal="true" aria-labelledby="fonciere-review-title"><header><p className={styles.eyebrow}>{t("IMPORT DE FICHE D’AGENCE", "AGENCY BROCHURE IMPORT")}</p><h2 id="fonciere-review-title">{t("Vérifiez les informations extraites", "Review extracted information")}</h2><p>{review.report.filename} · {review.report.pages} {t("page(s)", "page(s)")} · {review.report.gallery.length} {t("visuel(s)", "visual(s)")}</p><p>{t("Seuls les champs cochés seront appliqués. Les champs déjà renseignés restent décochés pour préserver vos corrections. Vous pouvez modifier chaque proposition.", "Only selected fields will be applied. Existing values remain unselected to preserve your corrections. Every proposed value is editable.")}</p></header>{[...review.report.warnings, ...review.report.readerWarnings].length > 0 && <div className={styles.warning}><strong>{t("Limites et points à vérifier", "Limitations and points to check")}</strong><ul>{[...new Set([...review.report.warnings, ...review.report.readerWarnings])].map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}<div className={styles.reviewFields}>{proposeAgencyImport(data, review.imported).map(proposal => <div className={styles.proposal} data-project-proposal={proposal.key} key={proposal.key}><label className={styles.checkLabel}><input type="checkbox" checked={review.selected.has(proposal.key)} onChange={event => { const selected = new Set(review.selected); if (event.target.checked) selected.add(proposal.key); else selected.delete(proposal.key); setReview({ ...review, selected }); }} /><strong>{label(proposal.key)}</strong></label>{proposal.current && <div className={styles.currentValue}><span>{t("Valeur actuelle", "Current value")}</span><p>{proposal.current}</p></div>}<div className={styles.importField}><GuidedProjectField field={fieldLabels.get(proposal.key) || { key: proposal.key, fr: proposal.key, en: proposal.key }} data={review.imported} onChange={next => { const selected = new Set(review.selected); if (next.propertyAddressDetails && next.propertyAddressDetails !== review.imported.propertyAddressDetails) for (const key of ["propertyAddress", "city", "postalCode"] as const) selected.add(key); if (next.agencyAddressDetails && next.agencyAddressDetails !== review.imported.agencyAddressDetails) selected.add("agencyAddress"); setReview({ ...review, imported: next, selected }); }} lang={lang} idPrefix="fonciere-import" documents={documentOptions} /></div></div>)}</div>{review.report.gallery.length > 0 && <label className={styles.checkLabel}><input type="checkbox" checked={review.photos} onChange={event => setReview({ ...review, photos: event.target.checked })} />{t("Ajouter les visuels extraits à la photothèque du projet", "Add extracted visuals to the project gallery")} ({review.report.gallery.length})</label>}<p className={styles.muted}>{t("Le document original est joint au brouillon dans tous les cas. L’import ne complète pas vos hypothèses financières personnelles.", "The original is attached to the draft in all cases. Import does not populate personal financial assumptions.")}</p><div className={styles.reviewFooter}><button className={styles.secondary} onClick={() => { setReview(null); setNotice(t("Document original joint. Aucune proposition appliquée ; complétez la fiche manuellement.", "Original attached. No proposals applied; complete the record manually.")); }}>{t("Conserver seulement le document", "Keep original only")}</button><button className={styles.primary} onClick={acceptImport}><Check size={16} />{t("Appliquer les propositions cochées", "Apply selected proposals")}</button></div></section></div>}
  </div>;
}
