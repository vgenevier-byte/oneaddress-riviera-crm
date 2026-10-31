"use client";

import { TaskSourceActions } from "@/components/TaskLinkProvider";
import { TASK_TARGET_NAVIGATED, useTaskTargetFocus } from "@/lib/tasks/navigation";
import { usePageRefreshGuard } from "@/lib/usePageRefreshGuard";
import { beginPageRefreshOperation } from "@/lib/pageRefresh";
import Image from "next/image";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowLeft, ArrowUpRight, Check, Download, FileText, FolderOpen, ImagePlus, MapPin, Plus, RefreshCw, Save, Search, Upload } from "lucide-react";
import { isCancelled, useScopedOperations } from "@/lib/access/operations";
import { createFonciereData, FONCIERE_DOCUMENT_LIMIT, type FonciereData, type FonciereField } from "@/lib/fonciere/model";
import { useFonciereLocale } from "@/lib/fonciere/locale";
import { createFonciereRepository, resolveFonciereMedia, clearFoncierePreviewCache, FonciereCreationConflictError, type FonciereProjectSummary, type FonciereAssetRecord, type LoadedFonciereProject } from "@/lib/fonciere/repository";
import { agencyReportToFonciere, applyAgencyImport, proposeAgencyImport } from "@/lib/fonciere/import";
import { applyOwnerImport, proposeOwnerImport } from "@/lib/fonciere/ownerImport";
import OwnerImportReview from "./OwnerImportReview";
import { analyzeAgencyFiles, type AgencyReport } from "@/lib/izord/agency";
import { addPhotoFile } from "@/lib/izord/photos";
import { LIMITS } from "@/lib/izord/model";
import { normalizeContactSearch } from "@/lib/contactSearch";
import { claimFonciereDraft, confirmFonciereDraft, markFonciereDraftAttempted, FonciereDraftInUseError, type FonciereDraftLease } from "@/lib/fonciere/creationKey";
import { readFonciereLocalDraft, saveFonciereLocalDraft, deleteFonciereLocalDraft } from "@/lib/fonciere/draftRecovery";
import { searchProjects } from "@/lib/fonciere/projectSearch";
import ProjectDriveSync from "./ProjectDriveSync";
import ProjectCalendarSummary from "./ProjectCalendarSummary";
import ProjectArbitrage, { ARBITRAGE_LABELS } from "./ProjectArbitrage";
import { createArbitrageRepository, type ArbitrationState } from "@/lib/fonciere/arbitrage";
import styles from "./ProjectsWorkspace.module.css";
import ProjectAccess from "./ProjectAccess";
import ProjectContacts from "./ProjectContacts";
import ProjectOwners from "./ProjectOwners";
import CompactProjectFields from "./CompactProjectFields";
import GuidedCivilDate from "./GuidedCivilDate";
import { formatCivilDate } from "@/lib/fonciere/calendarDates";
import { mergeProjectDraft, type RentalMergeConflict } from "@/lib/fonciere/mergeDraft";
import {ProjectContactReads} from "./ProjectContactReads";
import ProjectReadSection from "./ProjectReadSection";
import RentalScenarios from "./RentalScenarios";
import { validateRentalPlan } from "@/lib/fonciere/rentals";
import ProjectSection from "./ProjectSection";
import { PROJECT_SECTION_IDS, readProjectSections, writeProjectSections, type ProjectSectionId, type ProjectSectionIdentity } from "@/lib/fonciere/projectSectionState";
import type { ContactCreateIntent } from "@/lib/contacts/createIntent";
import type { ProjectContactReturn } from "@/lib/fonciere/contactCreation";
import { AddressMapLink } from "@/components/address/AddressMapLink";
import { propertyAddressDetails, propertyAddressText } from "@/lib/fonciere/address";
import GuidedProjectField, { type GuidedFieldSpec } from "./GuidedProjectField";
import { sortSelectOptions } from "@/lib/selectOptions";
import { GUIDED_FIELD_DEFINITIONS, currentGuidedValue, formatGuidedValue, guidedReadableFields, isGuidedFieldApplicable, readGuidedField, reconfirmGuidedField, suggestedFonciereName, type GuidedKey } from "@/lib/fonciere/guided";

type DocumentCategory = "agency" | "plans" | "photos" | "other";
const documentCategoryLabels: Record<DocumentCategory, [string, string]> = { agency: ["Documents agence", "Agency documents"], plans: ["Plans", "Plans"], photos: ["Photos", "Photos"], other: ["Autres documents", "Other documents"] };
type FieldKey = FonciereField | GuidedKey;
type Field = GuidedFieldSpec;
type Section = { id: string; fr: string; en: string; noteFr?: string; noteEn?: string; fields: Field[] };
type ImportReview = { report: AgencyReport; imported: FonciereData; selected: Set<FonciereField>; ownerSelected: Set<string>; photos: boolean; };
type Props = { navigationIntentRef?: { current: ((intent: "list", confirmed?: boolean) => Promise<boolean>) | null }; userId: string; canWrite: boolean; canReadContacts?: boolean; canWriteContacts?: boolean; canManageAccess?: boolean; canArchive?: boolean; canDownload?: boolean; accessRevision: number; accessSignal?: AbortSignal; onUnsavedChange?: (dirty: boolean) => void; onOpenContact?: (id: string) => void; onCreateContact?: (intent: ContactCreateIntent) => boolean; contactReturn?: ProjectContactReturn; onContactReturnConsumed?: () => void; };
const sections: Section[] = [
  { id: "identity", fr: "Identification", en: "Identification", fields: [
    { key: "name", fr: "Nom du projet", en: "Project name", wide: true },
    { key: "propertyType", fr: "Type de bien", en: "Property type" }, { key: "agencyReference", fr: "Référence agence", en: "Agency reference" },
    { key: "propertyAddress", fr: "Adresse du bien", en: "Property address", wide: true },
    { key: "city", fr: "Ville", en: "City" }, { key: "postalCode", fr: "Code postal", en: "Postal code" },
    { key: "location", fr: "Quartier / secteur", en: "District / area", wide: true },
    { key: "locationPrecision", fr: "Précision de la localisation", en: "Location precision", wide: true },
  ] },
  { id: "agency", fr: "Agence, propriétaires et vente", en: "Agency, owners and sale", noteFr: "L’adresse de l’agence est distincte de celle du bien. Le contact CRM de l’agent se choisit ci-dessous.", noteEn: "The agency address is separate from the property address. Link the agent to a CRM contact below.", fields: [
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
    { key: "personalStrategy", fr: "Stratégie personnelle du projet", en: "Personal project strategy", wide: true },
    { key: "worksHypothesis", fr: "Travaux envisagés / budget estimé", en: "Planned works / estimated budget", long: true, wide: true },
    { key: "resaleHypothesis", fr: "Hypothèses de revente", en: "Resale assumptions", long: true, wide: true }, { key: "rentalHypothesis", fr: "Hypothèses de location", en: "Rental assumptions", long: true, wide: true },
    { key: "notes", fr: "Notes personnelles", en: "Personal notes", long: true, wide: true },
  ] },
];
const fieldLabels = new Map(sections.flatMap(section => section.fields.map(field => [field.key, field] as const)));
function messageOf(error: unknown) { return error instanceof Error ? error.message : "L’opération n’a pas été confirmée. Le brouillon est conservé."; }
function bytes(value: number) { return value > 1_000_000 ? `${(value / 1_000_000).toFixed(1)} Mo` : `${Math.ceil(value / 1000)} Ko`; }
function RetainedTools({active,children}:{active:boolean;children:React.ReactNode}){const [used,setUsed]=useState(active);if(active&&!used)setUsed(true);return active||used?<>{children}</>:null;}
function SectionEditActions({editing,disabled,resuming,onSave,onCancel,onEdit,t,multi}:{editing:boolean;disabled:boolean;resuming:boolean;onSave:()=>void;onCancel:()=>void;onEdit:()=>void;t:(fr:string,en:string)=>string;multi:boolean}) {return <>{editing?<><button type="button" disabled={disabled} onClick={onSave}>{resuming?t("Reprendre l’enregistrement","Resume save"):multi?t("Enregistrer l’import (plusieurs rubriques)","Save import (multiple sections)"):t("Enregistrer","Save")}</button><button type="button" disabled={disabled||resuming} onClick={onCancel}>{t("Annuler","Cancel")}</button></>:<button type="button" disabled={disabled||resuming} onClick={onEdit}>{t("Modifier","Edit")}</button>}</>;}
export default function ProjectsWorkspace(props:Props){return <ProjectContactReads><ProjectsWorkspaceBody {...props}/></ProjectContactReads>;}
function ProjectsWorkspaceBody({ navigationIntentRef, userId, canWrite, canReadContacts = false, canWriteContacts = false, canManageAccess = false, canArchive = false, canDownload = false, accessRevision, accessSignal, onUnsavedChange, onOpenContact, onCreateContact, contactReturn, onContactReturnConsumed }: Props) {
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
  const [projects, setProjects] = useState<(LoadedFonciereProject["project"]|FonciereProjectSummary)[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [arbitrageFilter, setArbitrageFilter] = useState("");
  const [arbitrageStatuses, setArbitrageStatuses] = useState<Record<string, { status: ArbitrationState["status"] }>>({});
  const [arbitrageBusy, setArbitrageBusy] = useState(false);
  const returningToList = useRef(false);
  const [arbitrageDirty, setArbitrageDirty] = useState(false);
  const [archived, setArchived] = useState(false);
  const [data, setData] = useState<FonciereData | null>(null);
  // Accepted records reset calendar drafts and compact-editor disclosure state.
  // Ordinary edits and section toggles keep mounted input drafts and focus.
  const [calendarInputEpoch, setCalendarInputEpoch] = useState(0);
  const [recordComplete, setRecordComplete] = useState(false);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const switchDialog = useRef<HTMLElement>(null);
  const editFocus = useRef<HTMLElement|null>(null);
  const [switchTarget, setSwitchTarget] = useState<string | null>(null);
  const [rentalMergeConflict,setRentalMergeConflict]=useState<RentalMergeConflict|null>(null);
  const [needsResume, setNeedsResume] = useState(false);
  const [importSections, setImportSections] = useState<string[]>([]);
  const [resumeDraftId, setResumeDraftId] = useState("");
  const editBaseline = useRef<{data:FonciereData;loaded:LoadedFonciereProject|null;sourceFiles:File[];sourceFileCategories:DocumentCategory[]} | null>(null);
  const [loaded, setLoaded] = useState<LoadedFonciereProject | null>(null);
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [sourceFileCategories, setSourceFileCategories] = useState<DocumentCategory[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accessBusy,setAccessBusy]=useState(false);
  const [agencyContactPending, setAgencyContactPending] = useState(false);
  const [ownerContactPending, setOwnerContactPending] = useState(false);
  const contactPending = agencyContactPending || ownerContactPending;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [review, setReview] = useState<ImportReview | null>(null);
  const [activeSection, setActiveSection] = useState("identity");
  const [openSections, setOpenSections] = useState<Set<ProjectSectionId>>(new Set());
  const [sectionIdentity, setSectionIdentity] = useState<ProjectSectionIdentity | null>(null);
  const sectionState = useRef<{ identity: ProjectSectionIdentity | null; opened: Set<ProjectSectionId> }>({ identity: null, opened: new Set() });
  const controller = useRef<AbortController | null>(null);
  const mediaController=useRef<AbortController|null>(null);
  const [showAccess,setShowAccess]=useState(false);
  const [mediaAttempt,setMediaAttempt]=useState(0);
  const epoch = useRef(0);
  const initialProjectHandled = useRef(false);
  const taskFocus = useTaskTargetFocus("fonciere_project", "document");
  const handledTaskFocus = useRef("");
  const importInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const planInput = useRef<HTMLInputElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const reviewRef = useRef<HTMLElement>(null);
  const label = (key: string) => { const value = fieldLabels.get(key as FieldKey); return value ? t(value.fr, value.en) : key; };
  const importPending = review !== null;
  const writable = canWrite && loaded?.project.status !== "archived";

  function selectSectionIdentity(identity: ProjectSectionIdentity) {
    const opened = readProjectSections(userId, identity);
    sectionState.current = { identity, opened };
    setSectionIdentity(identity); setOpenSections(opened);
  }
  function rememberOpenSections(opened: Set<ProjectSectionId>) {
    sectionState.current.opened = opened;
    if (sectionState.current.identity) writeProjectSections(userId, sectionState.current.identity, opened);
    // A partially created record can still retain its durable recovery draft.
    if (draftLease.current) writeProjectSections(userId, { kind: "draft", id: draftLease.current.identity.draftId }, opened);
    setOpenSections(opened);
  }
  function adoptProjectSections(id: string) {
    const identity: ProjectSectionIdentity = { kind: "project", id };
    writeProjectSections(userId, identity, sectionState.current.opened);
    // Saving adopts the durable ID without replaying an already handled URL anchor.
    sectionState.current.identity = identity;
  }
  function changeSections(opened: Set<ProjectSectionId>) {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement) {
      const section = focused.closest<HTMLElement>("[data-project-section]");
      const id = section?.dataset.projectSection as ProjectSectionId | undefined;
      if (id && !opened.has(id) && document.getElementById(`fonciere-panel-${id}`)?.contains(focused)) document.getElementById(`fonciere-toggle-${id}`)?.focus();
    }
    rememberOpenSections(opened);
  }
  function toggleSection(id: ProjectSectionId) {
    const next = new Set(sectionState.current.opened);
    if (next.has(id)) next.delete(id); else next.add(id);
    changeSections(next);
  }
  const revealProjectElement = useCallback((target: HTMLElement | null, focus = false) => {
    if (!target) return;
    const section = target.closest<HTMLElement>("[data-project-section]");
    const id = section?.dataset.projectSection as ProjectSectionId | undefined;
    if (id) {
      const opened = new Set(sectionState.current.opened).add(id);
      sectionState.current.opened = opened;
      if (sectionState.current.identity) writeProjectSections(userId, sectionState.current.identity, opened);
      if (draftLease.current) writeProjectSections(userId, { kind: "draft", id: draftLease.current.identity.draftId }, opened);
      setOpenSections(opened); setActiveSection(id);
    }
    // Nested owner/retained-field details can also conceal a validation target.
    for (let parent = target.parentElement; parent && parent !== section; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) { parent.hidden = false; parent.open = true; }
    const show = (attempt = 0) => window.requestAnimationFrame(() => {
      if (!target.isConnected) return;
      if (!target.getClientRects().length) { if (attempt < 10) show(attempt + 1); return; }
      target.scrollIntoView({ block: "center" });
      if (focus) { if (!target.matches("input,textarea,select,button,a[href],[tabindex]")) target.tabIndex = -1; target.focus({ preventScroll: true }); }
    });
    show();
  }, [userId]);
  function navigateSection(event: React.MouseEvent<HTMLAnchorElement>, anchor: string) {
    event.preventDefault();
    window.history.replaceState(null, "", `#${anchor}`);
    revealProjectElement(document.getElementById(anchor));
  }
  useEffect(() => {
    if (!sectionIdentity) return;
    const revealHash = () => {
      let anchor: string;
      try { anchor = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
      const target = document.getElementById(anchor);
      if (target?.closest("[data-project-section]")) revealProjectElement(target);
    };
    const timer = window.setTimeout(revealHash, 0);
    window.addEventListener("hashchange", revealHash);
    return () => { window.clearTimeout(timer); window.removeEventListener("hashchange", revealHash); };
  }, [sectionIdentity, revealProjectElement]);

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
  function recoverableLoaded(value:LoadedFonciereProject|null){return value?.media?{...value,media:{loadId:crypto.randomUUID(),status:"pending" as const,previews:{},errors:[]}}:value;}
  async function persistDraft() {
    const identity = draftLease.current?.identity;
    if (!identity || !data || !draftReady) return;
    const recoveryLoaded=recoverableLoaded(loaded),recoveryBaseline=editBaseline.current?{...editBaseline.current,loaded:recoverableLoaded(editBaseline.current.loaded)}:null;
    const snapshot = { data, loaded:recoveryLoaded, sourceFiles, sourceFileCategories, creationReconciled, recordComplete, editingSection, rentalMergeConflict, editBaseline: recoveryBaseline, needsResume, importSections, updatedAt: new Date().toISOString() };
    const finished = beginPageRefreshOperation();
    draftPersistence.current = draftPersistence.current.catch(() => {}).then(() => saveFonciereLocalDraft(identity, snapshot)).finally(finished);
    await draftPersistence.current;
  }
  useEffect(()=>{if(!switchTarget)return;const dialog=switchDialog.current;const controls=()=>Array.from(dialog?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]);const timer=window.setTimeout(()=>controls()[0]?.focus(),0);const trap=(event:KeyboardEvent)=>{if(event.key!=='Tab')return;const list=controls(),first=list[0],last=list.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}};dialog?.addEventListener('keydown',trap);return()=>{window.clearTimeout(timer);dialog?.removeEventListener('keydown',trap);if(editFocus.current?.isConnected)editFocus.current.focus();};},[switchTarget]);
  const isEditing = (id:string) => !recordComplete || editingSection === id;
  const resumeStorageKey = `oar:fonciere:resume:${creationScope}`;
  useEffect(() => { const timer=window.setTimeout(()=>{try { setResumeDraftId(localStorage.getItem(resumeStorageKey)||""); } catch { /* Explicit draft URL remains usable. */ }},0);return()=>window.clearTimeout(timer); }, [resumeStorageKey]);
  function rememberResume(id:string) { setResumeDraftId(id); try { if(id)localStorage.setItem(resumeStorageKey,id);else localStorage.removeItem(resumeStorageKey); } catch { /* Existing IndexedDB/lease errors remain authoritative. */ } }
  async function beginSection(id:string, initial=data, previous=loaded, force=false) {
    if (!initial || busy || !writable || needsResume) return;
    if(listLoading)void reload();
    if (!force && editingSection && editingSection!==id && (dirty || contactPending)) { setSwitchTarget(id); return; }
    if (!force && editingSection===id) return;
    try {
      const lease=draftLease.current || await claimFonciereDraft(creationScope);
      const baseline={data:structuredClone(initial),loaded:previous,sourceFiles:force?[]:[...sourceFiles],sourceFileCategories:force?[]:[...sourceFileCategories]};
      await saveFonciereLocalDraft(lease.identity,{...baseline,loaded:recoverableLoaded(baseline.loaded),creationReconciled:true,recordComplete:true,editingSection:id,editBaseline:{...baseline,loaded:recoverableLoaded(baseline.loaded)},needsResume:false,importSections:[],updatedAt:new Date().toISOString()});
      draftLease.current=lease;setDraftReady(true);setCreationReconciled(true);rememberResume(lease.identity.draftId);
      editBaseline.current=baseline;
      setEditingSection(id);setDirty(false);setImportSections([]);setRentalMergeConflict(null);setError("");
      changeSections(new Set(sectionState.current.opened).add(id as ProjectSectionId));
      window.requestAnimationFrame(()=>Array.from(document.querySelectorAll<HTMLElement>(`[data-project-section="${id}"] input:not([readonly]),[data-project-section="${id}"] select,[data-project-section="${id}"] textarea`)).find(node=>!node.closest('[hidden],[inert],details:not([open])')&&!(node as HTMLInputElement).disabled)?.focus());
    } catch(failure) { setError(draftError(failure)); }
  }
  async function cancelSection() {
    if (busy || needsResume || !editBaseline.current) return null;
    const base=editBaseline.current;setData(structuredClone(base.data));setLoaded(base.loaded);setSourceFiles([...base.sourceFiles]);setSourceFileCategories([...base.sourceFileCategories]);setCalendarInputEpoch(v=>v+1);setEditingSection(null);setImportSections([]);setRentalMergeConflict(null);setDirty(false);setError("");setReview(null);editBaseline.current=null;
    if(draftLease.current){const lease=draftLease.current;await draftPersistence.current.catch(()=>{});await deleteFonciereLocalDraft(lease.identity);lease.release();draftLease.current=null;setDraftReady(false);}rememberResume("");return base;
  }
  function current(id: number) { return epoch.current === id && !controller.current?.signal.aborted && !accessSignal?.aborted; }
  function leave() { return !(dirty || accessBusy || contactPending || arbitrageDirty) || window.confirm(t("Ce projet contient des modifications non enregistrées. Quitter sans les enregistrer ?", "This project has unsaved changes. Leave without saving?")); }
  function edit(next: FonciereData) { if (!writable || busy || accessSignal?.aborted) return; setData(next); setDirty(true); setError(""); setNotice(""); }
  function editField(key: FonciereField, value: string) { if (data) edit({ ...data, [key]: value }); }

  async function open(id: string, preserveUrl = false) {
    if (busy || !leave()) return;
    mediaController.current?.abort();
    draftEpoch.current++;
    setBusy(true); setError(""); setReview(null);
    let op: Awaited<ReturnType<typeof operation>> | undefined;
    try { op = await operation(); const value = await op.scoped.run(() => op!.repository.loadProject(id, { signal: op!.signal, arbitration: true, media:"defer" })); if (current(op.id)) { if (!preserveUrl) window.history.replaceState(null, "", `/fonciere?project=${encodeURIComponent(value.project.id)}`); draftLease.current?.release(); draftLease.current = null; setDraftReady(false); setCreationReconciled(false); setCreationConflict(null); setReconciliation(null); selectSectionIdentity({ kind: "project", id: value.project.id }); setRecordComplete(!(value.project.payload.creationIntentHash&&!value.project.payload.creationRequestHash));setEditingSection(null);setNeedsResume(false);editBaseline.current=null;setImportSections([]);setRentalMergeConflict(null); setShowAccess(false); setLoaded(value); setData(value.data); setCalendarInputEpoch(previous => previous + 1); setDirty(false); setSourceFiles([]); setSourceFileCategories([]); setNotice(""); setActiveSection("identity"); } }
    catch (failure) { if ((!op || current(op.id)) && !isCancelled(failure)) setError(messageOf(failure)); }
    finally { if (!op || current(op.id)) setBusy(false); }
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
      if(restored?.editBaseline)restored.editBaseline={...restored.editBaseline,loaded:recoverableLoaded(restored.editBaseline.loaded)};
      if(restored?.loaded){const op=await begin();await op.run(()=>createFonciereRepository(op.client,{accessToken:op.token}).loadProject(restored.loaded!.project.id,{signal:controller.signal,media:'defer'}));if(restored.loaded.media){restored.loaded={...restored.loaded,media:{loadId:crypto.randomUUID(),status:'pending',previews:{},errors:[]}};}else{const old=restored.loaded;const media=await op.run(()=>createFonciereRepository(op.client,{accessToken:op.token}).hydrateMedia(old,{signal:controller.signal}));const admitted={...old,media};restored.data=resolveFonciereMedia(admitted,restored.data).data;restored.loaded=resolveFonciereMedia(admitted);if(restored.editBaseline)restored.editBaseline={...restored.editBaseline,data:resolveFonciereMedia(admitted,restored.editBaseline.data).data,loaded:restored.loaded};}}
      if (controller.signal.aborted || generation !== draftEpoch.current || draftLease.current !== lease) return;
      if (!restored && lease.identity.confirmedProjectId) { lease.release(); draftLease.current = null; await open(lease.identity.confirmedProjectId, true); return; }
      if (restored) { setData(restored.data); setLoaded(restored.loaded); setSourceFiles(restored.sourceFiles); setSourceFileCategories(restored.sourceFileCategories); setCreationReconciled(restored.creationReconciled);setRecordComplete(restored.recordComplete??false);setEditingSection(restored.editingSection??null);editBaseline.current=restored.editBaseline??null;setNeedsResume(restored.needsResume??false);setImportSections(restored.importSections??[]);setRentalMergeConflict(restored.rentalMergeConflict??null); setDirty(true); }
      else setData(createFonciereData());
      selectSectionIdentity({ kind: "draft", id: lease.identity.draftId });rememberResume(lease.identity.draftId);
      setCalendarInputEpoch(previous => previous + 1);
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
  }, [data, loaded, sourceFiles, sourceFileCategories, creationReconciled, draftReady, dirty, recordComplete, editingSection, needsResume, importSections, rentalMergeConflict]);

  const reload = useCallback(async () => {
    const scoped=await begin();const signal=AbortSignal.any([scoped.signal,...(accessSignal?[accessSignal]:[])]);
    try {const [rows,statuses]=await scoped.run(()=>Promise.all([createFonciereRepository(scoped.client,{accessToken:scoped.token}).listProjectSummaries({signal}),createArbitrageRepository(scoped.client).list(signal)]));signal.throwIfAborted();setProjects(rows);setArbitrageStatuses(statuses);setListLoading(false);}
    catch(failure){if(!isCancelled(failure)){setError(messageOf(failure));setListLoading(false);}}
  },[begin,accessSignal]);
  useEffect(()=>{let alive=true;const direct=new URL(window.location.href).searchParams.get('project');const timer=window.setTimeout(()=>{if(alive&&!direct&&!taskFocus)void reload();},0);const stop=()=>{controller.current?.abort();mediaController.current?.abort();clearFoncierePreviewCache();epoch.current++;if(accessSignal?.aborted)setLoaded(previous=>previous?{...previous,media:{status:"failed",previews:{},errors:["access"]}}:previous);};accessSignal?.addEventListener('abort',stop,{once:true});return()=>{alive=false;window.clearTimeout(timer);stop();accessSignal?.removeEventListener('abort',stop);};},[userId,accessRevision,reload,accessSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(!loaded?.media)return;const projectId=loaded.project.id,revision=loaded.project.revision,loadId=loaded.media.loadId,local=new AbortController();mediaController.current?.abort();mediaController.current=local;void(async()=>{const op=await begin(),signal=AbortSignal.any([op.signal,local.signal,...(accessSignal?[accessSignal]:[])]);const result=await op.run(()=>createFonciereRepository(op.client,{accessToken:op.token}).hydrateMedia(loaded,{signal,onPhoto:(id,value)=>{if(!signal.aborted)setLoaded(previous=>previous?.project.id===projectId&&previous.project.revision===revision&&previous.media&&previous.media.loadId===loadId?{...previous,media:{...previous.media,previews:{...previous.media.previews,[id]:value}}}:previous);}}));signal.throwIfAborted();setLoaded(previous=>previous?.project.id===projectId&&previous.project.revision===revision&&previous.media&&previous.media.loadId===loadId?{...previous,media:result}:previous);})().catch(failure=>{if(!local.signal.aborted){clearFoncierePreviewCache();setLoaded(previous=>previous?.project.id===projectId&&previous.project.revision===revision&&previous.media&&previous.media.loadId===loadId?{...previous,media:{loadId:previous.media.loadId,status:'failed',previews:{},errors:['admission']}}:previous);if(!isCancelled(failure))setNotice(t('Aperçus indisponibles ; les informations et références sont conservées.','Previews unavailable; information and references are preserved.'));}});return()=>local.abort();},[loaded?.project.id,loaded?.project.revision,loaded?.media?.loadId,begin,accessSignal,mediaAttempt]); // eslint-disable-line react-hooks/exhaustive-deps
  async function returnToList(_intent: "list" = "list", confirmed = false) {
    if (returningToList.current) return false;
    if (busy || accessBusy || importPending || contactPending || arbitrageBusy) {
      window.alert(t("Une opération est en cours. Attendez sa fin avant de revenir à la liste.", "An operation is in progress. Wait for it to finish before returning to the list."));
      return false;
    }
    if (!confirmed && (dirty || sourceFiles.length > 0 || arbitrageDirty) && !window.confirm(t("Ce projet contient des modifications non enregistrées (fiche, fichiers ou arbitrage). Quitter sans les enregistrer ?", "This project has unsaved changes (record, files or arbitration). Leave without saving?"))) return false;
    returningToList.current = true;
    setBusy(true);
    try {
      // Flush the existing local recovery snapshot before releasing its lease.
      // A persistence failure leaves the editor and its URL intact.
      await persistDraft();
      await draftPersistence.current;
      draftEpoch.current++;
      controller.current?.abort();
      mediaController.current?.abort();
      epoch.current++;
      clearFoncierePreviewCache();
      draftLease.current?.release(); draftLease.current = null;
      setDraftReady(false); setData(null); setLoaded(null); setDirty(false);
      setSourceFiles([]); setSourceFileCategories([]); setReview(null);
      setArbitrageDirty(false); setEditingSection(null); setSwitchTarget(null);
      setError(""); setNotice("");
      window.history.replaceState(null, "", "/fonciere");
      window.dispatchEvent(new Event(TASK_TARGET_NAVIGATED));
      if (listLoading) void reload();
      return true;
    } catch (failure) { setError(draftError(failure)); return false; }
    finally { returningToList.current = false; setBusy(false); }
  }
  useLayoutEffect(() => {
    if (!navigationIntentRef) return;
    navigationIntentRef.current = returnToList;
    return () => { navigationIntentRef.current = null; };
  });
  function prepareMediaEdit(){if(!data)return null;if(!loaded?.media)return data;const baseline=resolveFonciereMedia(loaded),current=resolveFonciereMedia(loaded,data);if(editBaseline.current)editBaseline.current={...editBaseline.current,data:resolveFonciereMedia(loaded,editBaseline.current.data).data,loaded:baseline};setLoaded(baseline);setData(current.data);return current.data;}
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
      const value = await op.scoped.run(() => op!.repository.loadProject(loaded.project.id, { signal: op!.signal, arbitration: true, media:"defer" }));
      if (!current(op.id)) throw new Error("Relecture interrompue.");
      setRecordComplete(true);setEditingSection(null);setNeedsResume(false);editBaseline.current=null;setImportSections([]);setRentalMergeConflict(null); setShowAccess(false); setLoaded(value); setData(value.data); setCalendarInputEpoch(previous => previous + 1);
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
      selectSectionIdentity({ kind: "draft", id: lease.identity.draftId });
      controller.current?.abort(); epoch.current++;
      window.history.replaceState(null, "", draftUrl(lease.identity.draftId)); setRecordComplete(false);setEditingSection(null);setNeedsResume(false);setImportSections([]);setRentalMergeConflict(null);editBaseline.current=null;rememberResume(lease.identity.draftId);setData(createFonciereData()); setCalendarInputEpoch(previous => previous + 1); setLoaded(null); setDraftReady(true); setCreationReconciled(false); setCreationConflict(null); setReconciliation(null); setDirty(false); setSourceFiles([]); setSourceFileCategories([]); setReview(null); setError(""); setNotice(""); setActiveSection("identity");
    } catch (failure) { if (generation === draftEpoch.current) setError(draftError(failure)); }
    finally { if (generation === draftEpoch.current) setBusy(false); }
  }

  useEffect(() => {
    if (initialProjectHandled.current) return;
    initialProjectHandled.current = true;
    const id = new URL(window.location.href).searchParams.get("project");
    if (!id) return;
    const timer = window.setTimeout(() => {
      void open(id,true);
    }, 0);
    return () => window.clearTimeout(timer);
    // Open a requested record only once after the authorized list is loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  useEffect(() => {
    if (!taskFocus) { handledTaskFocus.current = ""; return; }
    if (busy) return;
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
  }, [taskFocus, busy]);
  useEffect(() => {
    if (taskFocus?.type !== "document" || taskFocus.context?.catalog !== "fonciere" || loaded?.project.id !== taskFocus.context.projectId) return;
    const timer = window.setTimeout(() => revealProjectElement(document.getElementById(`fonciere-asset-${taskFocus.id}`), true), 0);
    return () => window.clearTimeout(timer);
  }, [taskFocus, loaded?.project.id, revealProjectElement]);
  async function save() {
    if (!data || !writable || busy || review) return;
    if(loaded?.project.payload.creationIntentHash&&!loaded.project.payload.creationRequestHash&&!draftLease.current){setError(t("Cette création attend la reprise de son brouillon local et de ses fichiers. Utilisez Reprendre le brouillon inachevé.","This creation requires its local draft and files. Use Resume unfinished draft."));return;}
    if(rentalMergeConflict){setError(t("Choisissez les hypothèses locatives à conserver avant d’enregistrer. Les deux versions et les fichiers sont conservés.","Choose which rental assumptions to keep before saving. Both versions and files are retained."));return;}
    if (contactPending) { setError(t("Terminez ou annulez la sélection ou la création du contact avant d’enregistrer le projet. Le contact et le brouillon sont conservés.", "Finish or cancel contact selection or creation before saving the project. The contact and draft are retained.")); const pending = document.querySelector<HTMLElement>('[data-fonciere-projects] [data-pending-representative], [data-fonciere-projects] [data-contact-pending="true"], [data-fonciere-projects] [aria-label="Création de contact CRM"], [data-fonciere-projects] [aria-label="Create CRM contact"]') || document.querySelector<HTMLElement>(ownerContactPending ? "[data-project-owners]" : "[data-project-contacts]"); revealProjectElement(pending?.querySelector<HTMLElement>('[role="combobox"]:not(:disabled), input:not([type="hidden"]):not(:disabled),select:not(:disabled),button:not(:disabled)') || pending, true); return; }
    const invalid = document.querySelector<HTMLElement>('[data-fonciere-projects] [aria-invalid="true"]');
    if (invalid) { setError(t("Corrigez la valeur signalée avant d’enregistrer. Le brouillon est conservé.", "Correct the highlighted value before saving. Your draft is retained.")); revealProjectElement(invalid, true); return; }
    if (!data.name.trim()) { setActiveSection("identity"); setError(t("Le nom du projet est obligatoire. Les autres champs peuvent rester vides.", "A project name is required. Other fields can remain empty.")); revealProjectElement(document.getElementById("fonciere-name"), true); return; }
    if(recordComplete&&editBaseline.current&&JSON.stringify(data)===JSON.stringify(editBaseline.current.data)&&sourceFiles.length===editBaseline.current.sourceFiles.length&&!document.querySelector('[data-fonciere-projects] [aria-invalid="true"]')){await cancelSection();return loaded||undefined;}
    try { validateRentalPlan(data.rentalPlan); } catch (failure) { setError(messageOf(failure)); revealProjectElement(document.querySelector<HTMLElement>("[data-rental-scenarios]"),true);return; }
    setBusy(true); setError(""); setNotice(t("Enregistrement des informations et des documents…", "Saving information and documents…"));
    let op: Awaited<ReturnType<typeof operation>> | undefined;
    try {
      await persistDraft();
      const identity = draftLease.current?.identity;
      if (!loaded && !identity) throw new Error(t("L’identité du brouillon n’est pas encore confirmée. Votre saisie est conservée.", "Draft identity is not confirmed yet. Your entries are retained."));
      if (identity && !creationReconciled) markFonciereDraftAttempted(identity);
      op = await operation(); const saved = await op.scoped.run(() => op!.repository.saveProject({ data, previous: loaded || undefined, creationKey: identity?.creationKey, creationReconciled, sourceFiles, sourceFileCategories, onCreated: draft => { if (op && current(op.id)) { adoptProjectSections(draft.project.id); setLoaded(draft); } } }, { signal: op!.signal, arbitration: true, media:"defer", onProgress: progress => { if (op && current(op.id)) setNotice(`${progress.label} · ${progress.total ? Math.round(progress.completed / progress.total * 100) : 0} %`); } }));
      if (current(op.id)) { adoptProjectSections(saved.project.id); window.history.replaceState(null, "", `/fonciere?project=${encodeURIComponent(saved.project.id)}`); setLoaded(saved); setData(saved.data); setRecordComplete(true);setEditingSection(null);setNeedsResume(false);setImportSections([]);setRentalMergeConflict(null);editBaseline.current=null;rememberResume("");setSourceFiles([]); setSourceFileCategories([]); setDirty(false); if (identity) { try { confirmFonciereDraft(identity, saved.project.id); await draftPersistence.current.catch(() => {}); await deleteFonciereLocalDraft(identity); } catch { /* The canonical project remains confirmed; retain its own recovery data if cleanup fails. */ } draftLease.current?.release(); draftLease.current = null; setDraftReady(false); } setCreationConflict(null); setReconciliation(null); setCreationReconciled(false); setNotice(t("Projet enregistré. Copie Google Drive en attente.", "Project saved. Google Drive copy pending.") + ` · ${t("révision", "revision")} ${saved.project.revision}`); setProjects(previous => [saved.project, ...previous.filter(project => project.id !== saved.project.id)]);return saved; }
    } catch (failure) { if ((!op || current(op.id)) && !isCancelled(failure)) { if(sourceFiles.length||!recordComplete)setNeedsResume(true); if (failure instanceof FonciereCreationConflictError) { setCreationConflict(failure); setReconciliation(null); setError(t("Cette identité de création correspond à une autre intention d’enregistrement. Votre brouillon et ses pièces jointes sont conservés ; comparez la fiche avant de continuer.", "This creation identity belongs to a different save request. Your draft and attachments are retained; compare the saved record before continuing.")); } else setError(draftError(failure)); setNotice(t("Le brouillon et les documents à enregistrer sont conservés dans cet onglet.", "The draft and pending documents remain in this tab.")); } }
    finally { if (!op || current(op.id)) setBusy(false); }
  }
  async function reconcileRevision() {
    if(!loaded||!data||busy||!editBaseline.current||rentalMergeConflict)return;
    const focus = document.activeElement instanceof HTMLElement && document.activeElement.matches('input,select,textarea') ? document.activeElement : editFocus.current;
    setBusy(true);let op:Awaited<ReturnType<typeof operation>>|undefined;
    try {op=await operation();const remote=await op.scoped.run(()=>op!.repository.loadProject(loaded.project.id,{signal:op!.signal,arbitration:true,media:loaded.media?"defer":undefined}));if(!current(op.id))return;const merged=mergeProjectDraft(editBaseline.current.data,data,remote.data);setLoaded(remote);setData(merged.data);setRentalMergeConflict(merged.rentalConflict);editBaseline.current={...editBaseline.current,data:structuredClone(remote.data),loaded:remote};setDirty(true);setError(merged.validationError);setNotice(t("Version serveur rapprochée ; vos modifications locales sont conservées. Vérifiez avant d’enregistrer.","Server version reconciled; local edits are retained. Review before saving.")+(merged.conflicts.length?` · ${t("Champs modifiés des deux côtés","Fields changed on both sides")} : ${merged.conflicts.join(', ')}`:""));}catch(failure){if((!op||current(op.id))&&!isCancelled(failure))setError(messageOf(failure));}finally{if(!op||current(op.id)){setBusy(false);window.requestAnimationFrame(()=>{if(focus?.isConnected&&!focus.closest("[hidden],[inert]"))focus.focus();});}}
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
    adoptProjectSections(reconciliation.project.id); setLoaded(reconciliation); setCreationReconciled(true); setCreationConflict(null); setReconciliation(null); setDirty(true); setError("");
    setNotice(t("La fiche existante sert maintenant de base. Votre saisie et vos pièces jointes sont conservées. Vérifiez-les avant d’enregistrer.", "The existing record is now the baseline. Your entries and attachments are retained. Review them before saving."));
  }
  async function archive() {
    if (!loaded || !canWrite || !canArchive || busy || editingSection || !leave()) return;
    const next = loaded.project.status !== "archived";
    if (!window.confirm(t(next ? "Archiver ce projet ? Ses informations et documents seront conservés." : "Réactiver ce projet ?", next ? "Archive this project? Its information and documents will be retained." : "Restore this project?"))) return;
    setBusy(true); setError(""); let op: Awaited<ReturnType<typeof operation>> | undefined;
    try { op = await operation(); await op.scoped.run(() => op!.repository.archiveProject(loaded.project, next, { signal: op!.signal })); const value = await op.scoped.run(() => op!.repository.loadProject(loaded.project.id, { signal: op!.signal, arbitration: true, media:"defer" })); if (current(op.id)) { setRecordComplete(true);setEditingSection(null);setNeedsResume(false);editBaseline.current=null;setImportSections([]);setRentalMergeConflict(null); setShowAccess(false); setLoaded(value); setData(value.data); setCalendarInputEpoch(previous => previous + 1); setDirty(false); setSourceFiles([]); setSourceFileCategories([]); setProjects(previous => previous.map(project => project.id === value.project.id ? value.project : project)); setNotice(t(next ? "Projet archivé. Les présentations existantes sont conservées." : "Projet réactivé.", next ? "Project archived. Existing presentations are preserved." : "Project restored.")); } }
    catch (failure) { if ((!op || current(op.id)) && !isCancelled(failure)) setError(messageOf(failure)); }
    finally { if (!op || current(op.id)) setBusy(false); }
  }
  async function importAgency(file: File) {
    if (!canWrite || busy || review || data && !writable) return;
    if (!data) { setRecordComplete(false);setEditingSection(null);const generation = ++draftEpoch.current; try { const lease = await claimFonciereDraft(creationScope); if (generation !== draftEpoch.current) { lease.release(); return; } draftLease.current?.release(); draftLease.current = lease; rememberResume(lease.identity.draftId);selectSectionIdentity({ kind: "draft", id: lease.identity.draftId }); setDraftReady(true); window.history.replaceState(null, "", draftUrl(lease.identity.draftId)); } catch (failure) { setError(draftError(failure)); return; } }
    const initial = data ? prepareMediaEdit()! : createFonciereData();
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
      if (current(op.id)) { const proposals = proposeAgencyImport(initial, imported); setReview({ report, imported, selected: new Set(proposals.filter(item => !item.current.trim()).map(item => item.key)), ownerSelected: new Set(), photos: true }); setNotice(""); }
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
      next.ownerContext = applyOwnerImport(data.ownerContext, proposeOwnerImport(review.report, data.ownerContext), [...review.ownerSelected]);
      setImportSections([...new Set([...sections.filter(section=>section.fields.some(field=>review.selected.has(field.key as FonciereField))).map(section=>section.id),...(review.ownerSelected.size?["agency"]:[]),"documents"])]);edit(next); setReview(null); setNotice(t("Propositions retenues appliquées au brouillon. Vérifiez puis enregistrez le projet.", "Selected proposals applied to the draft. Review and save the project."));
    } catch (failure) { setError(messageOf(failure)); }
  }
  async function addPhotos(files: File[]) {
    if (!data || !writable || busy || importPending || !isEditing("documents")) return;
    if (sourceFiles.length + files.length + (loaded?.sourceDocuments.length || 0) > FONCIERE_DOCUMENT_LIMIT) { setError(t("Trente documents sources maximum par projet, originaux des photos compris.", "A maximum of thirty source documents per project, including original photos.")); return; }
    setBusy(true); setError(""); let op: Awaited<ReturnType<typeof operation>> | undefined;
    try { const base=prepareMediaEdit()!;op = await operation(); let next = base.presentationData; for (const file of files) { op.signal.throwIfAborted(); next = await addPhotoFile(next, file, undefined, op.signal); } if (current(op.id)) { setData({ ...base, presentationData: next }); setSourceFiles(previous => [...previous, ...files]); setSourceFileCategories(previous => [...previous, ...files.map(() => "photos" as const)]); setDirty(true); } }
    catch (failure) { if ((!op || current(op.id)) && !isCancelled(failure)) setError(messageOf(failure)); }
    finally { if (!op || current(op.id)) setBusy(false); }
  }
  function addAttachments(files: File[], category: "plans" | "other" = "other") {
    if (!data || !writable || busy || importPending || !isEditing("documents")) return;
    if (sourceFiles.length + files.length + (loaded?.sourceDocuments.length || 0) > FONCIERE_DOCUMENT_LIMIT) { setError(t("Trente documents sources maximum par projet.", "A maximum of thirty source documents per project.")); return; }
    const invalid = files.find(file => !file.size || file.size > LIMITS.fileBytes || !/\.(?:pdf|jpe?g|png|webp)$/i.test(file.name));
    if (invalid) { setError(`${invalid.name} : ${t("PDF, JPEG, PNG ou WebP de 25 Mo maximum.", "PDF, JPEG, PNG or WebP up to 25 MB.")}`); return; }
    setSourceFiles(previous => [...previous, ...files]); setSourceFileCategories(previous => [...previous, ...files.map(() => category)]); setDirty(true);
  }
  async function download(asset: FonciereAssetRecord) {
    if (busy || !canDownload) return;
    setBusy(true); setError(""); let op: Awaited<ReturnType<typeof operation>> | undefined;
    try { op = await operation(); const blob = await op.scoped.run(() => op!.repository.downloadAsset(asset, { signal: op!.signal })); await op.scoped.download(blob, asset.original_name || "document"); }
    catch (failure) { if ((!op || current(op.id)) && !isCancelled(failure)) setError(messageOf(failure)); }
    finally { if (!op || current(op.id)) setBusy(false); }
  }
  const gallery = data?.presentationData.importGallery || [];
  const displayPhoto=(index:number)=>accessSignal?.aborted?undefined:loaded?.media?loaded.media.previews[loaded.project.payload.data.presentationData.importGallery[index]?.data]:gallery[index]?.data;
  const mediaReady=!loaded?.media||loaded.media.status==='complete';
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
  function scenarioFieldActive(key: FieldKey) {
    const strategy = data ? currentGuidedValue(data, "personalStrategy") : null;
    if (key === "resaleHypothesis") return strategy === "resale" || strategy === "rental_then_resale";
    if (key === "rentalHypothesis") return strategy === "rental" || strategy === "rental_then_resale";
    return true;
  }
  function retainedScenarioFields() {
    if (!data) return [];
    return sections.find(section => section.id === "hypotheses")!.fields.filter(field => !scenarioFieldActive(field.key) && (readGuidedField(data, field.key as GuidedKey) != null || data[field.key as FonciereField] || data.guided.details[field.key as GuidedKey]));
  }
  function retainedScenarioText(key: GuidedKey) {
    if (!data) return "";
    return [formatGuidedValue(key, readGuidedField(data, key), lang), data[key as FonciereField], data.guided.details[key]].filter(Boolean).join("\n");
  }
  function isVisibleField(key: FieldKey) { return fieldContextApplies(key) && !(data && key in GUIDED_FIELD_DEFINITIONS && data.guided.inactive.includes(key as GuidedKey)); }
  function retainedFields(section: Section) {
    if (!data) return [];
    return section.fields.filter(field => scenarioFieldActive(field.key) && field.key in GUIDED_FIELD_DEFINITIONS && !isVisibleField(field.key) && (readGuidedField(data, field.key as GuidedKey) !== undefined && readGuidedField(data, field.key as GuidedKey) !== null || typeof data[field.key as FonciereField] === "string" && Boolean(data[field.key as FonciereField]) || Boolean(data.guided.details[field.key as GuidedKey])));
  }
  function suggestionsFor(key: FieldKey): string[] {
    if (!["propertyAddress", "city", "postalCode"].includes(key)) return [];
    return sortSelectOptions([...new Set(projects.flatMap(project => {
      const saved = (project.payload as { data?: Partial<FonciereData> } | undefined)?.data;
      const value = saved?.[key as FonciereField];
      return typeof value === "string" && value.trim() ? [value] : [];
    }))], value => value, lang);
  }

  return <div className={styles.workspace} lang={lang} data-fonciere-projects onFocusCapture={event=>{if(event.target instanceof HTMLElement&&event.target.matches("input,select,textarea")&&event.target.closest("[data-project-section]"))editFocus.current=event.target;}}>
    <input ref={importInput} className={styles.hidden} type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importAgency(file); }} aria-label={t("Importer une fiche d’agence", "Import an agency brochure")} />
    <input ref={photoInput} className={styles.hidden} type="file" multiple accept="image/jpeg,image/png,.jpg,.jpeg,.png" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; void addPhotos(files); }} aria-label={t("Ajouter des photos", "Add photos")} />
    <input ref={attachmentInput} className={styles.hidden} type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; addAttachments(files); }} aria-label={t("Ajouter des documents", "Add documents")} />
    <input ref={planInput} className={styles.hidden} type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; addAttachments(files, "plans"); }} aria-label={t("Ajouter des plans", "Add plans")} />
    <header className={styles.heading}>
      <div><p className={styles.eyebrow}>FONCIÈRE <span>/</span> {t("PATRIMOINE & OPPORTUNITÉS", "PROPERTY & OPPORTUNITIES")}</p><h1>{t("Projets", "Projects")}</h1><p className={styles.intro}>{t("Un lieu pour réunir vos biens, leurs documents et vos prochaines décisions.", "Your properties, source documents and next decisions, together in one place.")}</p></div>
      <div className={styles.headingActions}><div className={styles.language} aria-label={t("Langue du formulaire", "Form language")}>{(["fr", "en"] as const).map(value => <button key={value} type="button" aria-pressed={lang === value} onClick={() => setLang(value)}>{value.toUpperCase()}</button>)}</div>{canWrite && <button className={styles.primary} type="button" disabled={busy || importPending} onClick={fresh}><Plus size={16} />{t("Nouveau projet", "New project")}</button>}</div>
    </header>
    {error && <p className={styles.error} role="alert">{error === "draft-in-use" ? t("Ce brouillon est déjà ouvert dans un autre onglet. Vérifiez sa tentative d’enregistrement avant de le reprendre.", "This draft is already open in another tab. Review its save attempt before resuming it.") : error === "draft-storage-unavailable" ? t("La conservation locale du brouillon ou sa protection entre onglets est indisponible. Votre saisie reste dans cet onglet ; vérifiez la tentative avant de continuer.", "Local draft storage or protection between tabs is unavailable. Your entries remain in this tab; review the save attempt before continuing.") : error}</p>}
    {error&&recordComplete&&editingSection&&<button type="button" className={styles.secondary} disabled={busy||!!rentalMergeConflict} onClick={()=>void reconcileRevision()}>{t("Relire et rapprocher la version serveur sans perdre mon travail","Reread and reconcile the server version without losing my work")}</button>}
    {rentalMergeConflict&&<section className={styles.warning} data-rental-merge-conflict role="group" aria-label={t("Résoudre les scénarios locatifs","Resolve rental scenarios")}><h3>{t("Choisir une version locative cohérente","Choose a coherent rental version")}</h3><p>{t("La suppression d’un scénario et le choix de référence sont incompatibles. Les deux versions et vos fichiers restent conservés jusqu’à votre choix. Choisissez une version ci-dessous ou annulez l’édition avant un nouveau rapprochement.","A scenario deletion conflicts with the reference choice. Both versions and your files are retained until you choose. Choose a version below or cancel editing before reconciling again.")}</p>{(["local","remote"] as const).map(key=>{const plan=rentalMergeConflict[key];return <div key={key}><p>{key==='local'?t("Version locale","Local version"):t("Version serveur","Server version")} : {plan?.scenarios.map(s=>s.name+(s.id===plan.referenceId?' ('+t('référence','reference')+')':'')).join(', ')||t('Aucun scénario','No scenarios')}</p><button type="button" disabled={busy} onClick={()=>{try{validateRentalPlan(plan);if(data)setData({...data,rentalPlan:structuredClone(plan)});setRentalMergeConflict(null);setDirty(true);setError("");}catch(failure){setError(messageOf(failure));}}}>{key==='local'?t("Conserver la version locale","Keep local version"):t("Conserver la version serveur","Keep server version")}</button></div>;})}</section>}
    {creationConflict && <section className={styles.warning} data-creation-reconciliation><h3>{t("Vérifier la tentative d’enregistrement", "Review the save attempt")}</h3><p>{t("Votre brouillon reste conservé. Aucune autre fiche ne sera créée automatiquement.", "Your draft is retained. No other record will be created automatically.")}</p>{creationConflict.projectId && <><button type="button" disabled={busy} onClick={() => void inspectCreationConflict()}>{t("Comparer avec la fiche enregistrée", "Compare with the saved record")}</button> <a href={`/fonciere?project=${encodeURIComponent(creationConflict.projectId)}`} target="_blank" rel="noreferrer">{t("Ouvrir la fiche dans un autre onglet", "Open the record in another tab")}</a></>}{reconciliation && <div><p>{t("Fiche enregistrée", "Saved record")} : {reconciliation.project.project_reference} · {reconciliation.project.title} · r{reconciliation.project.revision}</p><p>{t("Votre brouillon", "Your draft")} : {data?.name} · {sourceFiles.length} {t("pièce(s) jointe(s) conservée(s)", "retained attachment(s)")}</p><button type="button" disabled={busy || reconciliation.project.status === "archived"} onClick={reconcileCreation}>{t("Utiliser cette fiche comme base et conserver mon brouillon", "Use this record as the baseline and keep my draft")}</button></div>}</section>}
    {notice && <p className={styles.notice} role="status"><Check size={16} />{notice}</p>}
    {data&&needsResume&&<p className={styles.warning}>{t("Enregistrement interrompu : certains fichiers peuvent déjà avoir été transférés. Votre brouillon est conservé ; reprenez l’enregistrement. Annuler ne peut pas retirer ces transferts.","Save interrupted: some files may already have transferred. Your draft is retained; resume saving. Cancel cannot undo these transfers.")}</p>}
    {data&&importSections.length>0&&<p className={styles.warning}>{t("Import à enregistrer — rubriques concernées","Import to save — affected sections")} : {importSections.map(id=>id==='documents'?'07':String(sections.findIndex(s=>s.id===id)+1).padStart(2,'0')).join(', ')}</p>}
    {switchTarget&&<div className={styles.reviewBackdrop}><section ref={switchDialog} className={styles.review} role="dialog" aria-modal="true" aria-label={t("Changer de rubrique","Change section")}><h3>{t("Des modifications sont en cours","Changes are in progress")}</h3><button disabled={busy||importPending} onClick={async()=>{const target=switchTarget;const saved=await save();if(saved){setSwitchTarget(null);await beginSection(target,saved.data,saved,true);}else setSwitchTarget(null);}}>{t("Enregistrer puis changer","Save then change")}</button><button disabled={busy||needsResume} onClick={async()=>{const target=switchTarget;const base=await cancelSection();if(base){setSwitchTarget(null);await beginSection(target,base.data,base.loaded,true);}}}>{t("Abandonner les modifications","Discard changes")}</button><button disabled={busy} onClick={()=>setSwitchTarget(null)}>{t("Continuer l’édition actuelle","Continue current edit")}</button></section></div>}
    {!data ? <>{resumeDraftId&&<a className={styles.secondary} href={draftUrl(resumeDraftId)}>{t("Reprendre le brouillon inachevé","Resume unfinished draft")}</a>}
      <div className={styles.listToolbar}><label className={styles.search}><Search size={17} /><span className={styles.srOnly}>{t("Rechercher un projet", "Search projects")}</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("Numéro, nom, adresse ou référence agence…", "Number, name, address or agency reference…")} /></label><label className={styles.arbitrageFilter}><span>{t("Arbitrage", "Arbitration")}</span><select aria-label={t("Arbitrage", "Arbitration")} value={arbitrageFilter} onChange={event => setArbitrageFilter(event.target.value)}><option value="">{t("Tous les statuts", "All decisions")}</option>{(Object.keys(ARBITRAGE_LABELS) as ArbitrationState["status"][]).map(status => <option key={status} value={status}>{t(ARBITRAGE_LABELS[status][0], ARBITRAGE_LABELS[status][1])}</option>)}</select></label><div className={styles.tabs}><button aria-pressed={!archived} onClick={() => setArchived(false)}>{t("En cours", "Active")} <span>{projects.filter(project => project.status !== "archived").length}</span></button><button aria-pressed={archived} onClick={() => setArchived(true)}>{t("Archivés", "Archived")}</button></div><button className={styles.iconButton} disabled={listLoading || busy} onClick={() => void reload().catch(failure => setError(messageOf(failure)))} aria-label={t("Actualiser la liste", "Refresh list")}><RefreshCw size={17} /></button></div>
      {canWrite && <button className={styles.importBanner} disabled={busy} onClick={() => importInput.current?.click()}><span className={styles.uploadIcon}><Upload size={22} /></span><span><strong>{t("Importer une fiche d’agence", "Import an agency brochure")}</strong><span>{t("PDF ou image · extraction et OCR · validation avant enregistrement", "PDF or image · extraction and OCR · review before saving")}</span></span><ArrowUpRight size={20} /></button>}
      {listLoading ? <div className={styles.empty} role="status"><RefreshCw size={28} /><h2>{t("Chargement des projets…", "Loading projects…")}</h2></div> : visibleProjects.length ? <div className={styles.projectRows} role="list">{visibleProjects.map(project => { const item = (project.payload as { data?: Partial<FonciereData> } | undefined)?.data; const display = item ? guidedReadableFields({ ...createFonciereData(), ...item }, lang) : undefined; return <div role="listitem" key={project.id} className={styles.projectRow}>
        <button className={styles.projectIdentity} disabled={busy} onClick={() => void open(project.id)}><span className={styles.projectReference}>{project.project_reference}</span><strong>{project.title}</strong><span>{item?.city}</span>{project.payload.creationIntentHash&&!project.payload.creationRequestHash&&<small>{t("Brouillon à terminer","Unfinished draft")}</small>}{approximateProjects.has(project.id) && <small>{t("Correspondance approchée", "Close match")}</small>}</button>
        <span className={styles.rowType}>{display?.propertyType || "—"}</span><span className={styles.rowPrice}>{display?.askingPrice || "—"}</span><span className={styles.rowArea}>{display?.area}</span><span className={styles.rowVisit}><small>{t("Visite", "Visit")}</small> {formatCivilDate(item?.visitDate || "", lang) || "—"}</span><span className={styles.arbitrageBadge} data-arbitrage-status={arbitrageStatuses[project.id]?.status || "pending"}>{t(ARBITRAGE_LABELS[arbitrageStatuses[project.id]?.status || "pending"][0], ARBITRAGE_LABELS[arbitrageStatuses[project.id]?.status || "pending"][1])}</span>
      </div>; })}</div> : <div className={styles.empty}><FolderOpen size={38} strokeWidth={1} /><h2>{query ? t("Aucun projet trouvé", "No matching projects") : archived ? t("Aucun projet archivé", "No archived projects") : t("Votre premier projet commence ici", "Your first project starts here")}</h2><p>{query ? t("Essayez un nom, une adresse ou une référence différente.", "Try a different name, address or reference.") : t("Créez une fiche à votre rythme ou partez d’une fiche d’agence. Seul le nom du projet est nécessaire.", "Create a record at your own pace or start with an agency brochure. Only a project name is required.")}</p>{canWrite && !archived && <button className={styles.secondary} onClick={fresh}><Plus size={16} />{t("Créer un projet", "Create a project")}</button>}</div>}
    </> : <>
      <TaskSourceActions reference={loaded ? { type: "fonciere_project", id: loaded.project.id } : undefined} saved={Boolean(loaded)} title={t("Compléter le projet", "Complete the project")} />
      <div className={styles.recordToolbar}><button className={styles.back} disabled={busy || importPending} onClick={() => void returnToList()}><ArrowLeft size={16} />{t("Tous les projets", "All projects")}</button><span className={styles.saveState}>{recordComplete&&!editingSection?t("Mode lecture","Read mode"):loaded&&!recordComplete?t("Brouillon à terminer — transferts non confirmés","Unfinished draft — transfers unconfirmed"):busy ? t("Opération en cours…", "Working…") : dirty ? t("Modifications non enregistrées", "Unsaved changes") : loaded ? `${t("Enregistré", "Saved")} · r${loaded.project.revision}` : t("Nouveau projet", "New project")}</span><div className={styles.recordActions}>{canWrite && canArchive && loaded && <button className={styles.secondary} disabled={busy || importPending || !!editingSection || !recordComplete} onClick={() => void archive()}><Archive size={15} />{loaded.project.status === "archived" ? t("Réactiver", "Restore") : t("Archiver", "Archive")}</button>}{writable && !recordComplete && <button className={styles.primary} disabled={busy || importPending} onClick={() => void save()}><Save size={16} />{t("Enregistrer", "Save project")}</button>}</div></div>
      <div className={styles.recordHero}><div><p className={styles.eyebrow}>{loaded?.project.status === "archived" ? t("PROJET ARCHIVÉ", "ARCHIVED PROJECT") : t("FICHE PROJET", "PROJECT RECORD")}</p><p className={styles.projectReference}>{loaded?.project.project_reference || t("Numéro attribué à l’enregistrement", "Number assigned on save")}</p><h2>{data.name || t("Nouveau projet", "New project")}</h2><p><MapPin size={15} />{[data.propertyAddress, data.city].filter(Boolean).join(" · ") || t("Adresse du bien à renseigner", "Property address to complete")}</p><AddressMapLink address={propertyAddressText(data)} metadata={propertyAddressDetails(data)} lang={lang} /></div><div className={styles.heroMetrics}>{guidedText?.askingPrice && <div><span>{t("Prix demandé", "Asking price")}</span><strong>{guidedText.askingPrice}</strong></div>}{guidedText?.area && <div><span>{guidedText?.areaKind || t("Surface annoncée", "Advertised area")}</span><strong>{guidedText.area}</strong></div>}{data.agencyReference && <div><span>{t("Référence agence", "Agency reference")}</span><strong className={styles.reference}>{data.agencyReference}</strong></div>}</div></div>
      {duplicates.length > 0 && <div className={styles.warning} role="status"><strong>{t("Doublon possible", "Possible duplicate")}</strong><p>{t("Une référence agence ou une adresse correspond à : ", "An agency reference or address matches: ")}{duplicates.map(project => project.title).join(", ")}. {t("Vérifiez avant d’enregistrer. Aucun rapprochement automatique.", "Check before saving. Records are never merged automatically.")}</p></div>}
      <div className={styles.recordLayout}>
        <nav className={styles.sectionNav} aria-label={t("Sections de la fiche projet", "Project record sections")}>{sections.map((section, index) => <a key={section.id} href={`#fonciere-section-${section.id}`} aria-current={activeSection === section.id ? "location" : undefined} onClick={event => navigateSection(event, `fonciere-section-${section.id}`)}><span>{String(index + 1).padStart(2, "0")}</span>{t(section.fr, section.en)}</a>)}<a href="#fonciere-documents" onClick={event => navigateSection(event, "fonciere-documents")} aria-current={activeSection === "documents" ? "location" : undefined}><span>07</span>{t("Documents et visuels", "Documents and visuals")}</a><a href="#fonciere-arbitrage" onClick={event => navigateSection(event, "fonciere-arbitrage")} aria-current={activeSection === "arbitrage" ? "location" : undefined}><span>08</span>{t("— Arbitrage", "— Arbitration")}</a></nav>
        <div className={styles.sections}>
          <div className={styles.sectionCommands}><button type="button" className={styles.secondary} onClick={() => changeSections(new Set())}>{t("Tout replier", "Collapse all")}</button><button type="button" className={styles.secondary} onClick={() => changeSections(new Set(PROJECT_SECTION_IDS))}>{t("Tout déplier", "Expand all")}</button></div>
          {sections.map((section, index) => <ProjectSection key={section.id} sectionId={section.id as ProjectSectionId} anchor={`fonciere-section-${section.id}`} number={String(index + 1).padStart(2, "0")} title={t(section.fr, section.en)} actions={recordComplete&&writable?<SectionEditActions editing={editingSection===section.id} disabled={busy||importPending} resuming={needsResume} onSave={()=>void save()} onCancel={()=>void cancelSection()} onEdit={()=>void beginSection(section.id)} t={t} multi={importSections.length>0}/>:undefined} summary={section.id === "identity" ? [loaded?.project.project_reference, formatCivilDate(data.visitDate, lang)].filter(Boolean).join(" · ") : section.id === "agency" ? [data.agencyName, data.ownerContext.declaredCount !== null ? `${data.ownerContext.declaredCount} ${t("propriétaires déclarés", "declared owners")}` : "", data.ownerContext.owners.length ? `${data.ownerContext.owners.length} ${t("identifiés", "identified")}` : ""].filter(Boolean).join(" · ") : section.id === "property" ? [guidedReadableFields(data, lang).propertyType, guidedReadableFields(data, lang).askingPrice, guidedReadableFields(data, lang).area].filter(Boolean).join(" · ") : section.id === "additional" ? [data.diagnosticsReceived ? t("Diagnostics reçus", "Reports received") + " : " + (data.diagnosticsReceived === "yes" ? t("Oui", "Yes") : t("Non", "No")) : "", guidedReadableFields(data, lang).charges].filter(Boolean).join(" · ") : undefined} note={section.noteFr ? t(section.noteFr, section.noteEn || "") : undefined} open={openSections.has(section.id as ProjectSectionId)} onToggle={() => toggleSection(section.id as ProjectSectionId)}><div hidden={isEditing(section.id)} inert={isEditing(section.id)}><ProjectReadSection id={section.id} fields={section.fields} data={data} lang={lang} onOpenContact={onOpenContact} canReadContacts={canReadContacts} active={openSections.has(section.id as ProjectSectionId)&&!isEditing(section.id)} />{section.id==="hypotheses"&&<><ProjectCalendarSummary data={data} lang={lang}/><RentalScenarios data={data} onChange={edit} lang={lang} editing={false}/></>}</div><div hidden={!isEditing(section.id)} inert={!isEditing(section.id)}><RetainedTools key={loaded?.project.id||"draft"} active={isEditing(section.id)}><fieldset disabled={!writable || busy || importPending || !isEditing(section.id)} className={styles.fieldset}><div className={styles.fieldGrid}>{section.id === "identity" && <label className={styles.wide}><span>{t("Référence projet", "Project reference")}</span><input readOnly aria-readonly="true" value={loaded?.project.project_reference || t("Numéro attribué à l’enregistrement", "Number assigned on save")} /></label>}{section.id === "identity" && <div className={styles.field}><label htmlFor="fonciere-visitDate">{t("Date de visite", "Visit date")}</label><GuidedCivilDate key={`visit:${calendarInputEpoch}`} id="fonciere-visitDate" value={data.visitDate} onInvalidDraft={() => edit(data)} onChange={value => edit({ ...data, visitDate: value || "" })} lang={lang} disabled={!writable || busy || importPending || !isEditing(section.id)} label={t("Date de visite", "Visit date")} /></div>}{["property", "description", "additional"].includes(section.id) ? <div className={styles.wide}><CompactProjectFields key={`${section.id}:${calendarInputEpoch}`} section={section.id} fields={section.fields.filter(field => scenarioFieldActive(field.key) && isVisibleField(field.key))} data={data} onChange={edit} lang={lang} calendarInputEpoch={calendarInputEpoch} disabled={!writable || busy || importPending || !isEditing(section.id)} documents={documentOptions} /></div> : section.fields.filter(field => section.id !== "agency" && scenarioFieldActive(field.key) && isVisibleField(field.key)).map(field => field.key === "rentalHypothesis" ? <details key={field.key} className={styles.wide} open={!data.rentalPlan||undefined}><summary>{t("Ancienne hypothèse locative — occupation sur la période étudiée à confirmer","Original rental assumption — occupancy over the study period requires confirmation")}</summary><GuidedProjectField key={field.key} calendarInputEpoch={calendarInputEpoch} field={field} data={data} onChange={edit} lang={lang} disabled={!writable || busy || importPending || !isEditing(section.id)} suggestions={suggestionsFor(field.key)} documents={documentOptions} /></details> : <GuidedProjectField key={field.key} calendarInputEpoch={calendarInputEpoch} field={field} data={data} onChange={edit} lang={lang} disabled={!writable || busy || importPending || !isEditing(section.id)} suggestions={suggestionsFor(field.key)} documents={documentOptions} />)}</div>{section.id === "identity" && !data.name.trim() && suggestedName && <div className={styles.suggestedName}><span>{t("Nom suggéré", "Suggested name")} : {suggestedName}</span><button type="button" onClick={() => editField("name", suggestedName)}>{t("Utiliser ce nom", "Use this name")}</button></div>}</fieldset>
            {section.id === "hypotheses" && <><RentalScenarios data={data} onChange={edit} lang={lang} editing disabled={busy||!writable||!isEditing("hypotheses")}/><ProjectCalendarSummary data={data} lang={lang} />{retainedScenarioFields().length > 0 && <details className={styles.contextNote} data-retained-scenarios><summary>{t("Hypothèses conservées des autres scénarios", "Retained assumptions from other scenarios")} ({retainedScenarioFields().length})</summary><p>{t("Ces valeurs sont conservées. Sélectionnez la stratégie correspondante pour les consulter et les modifier dans le formulaire ; elles ne servent pas au calendrier du scénario actif.", "These values are retained. Select the corresponding strategy to view and edit them in the form; they are excluded from the active scenario calendar.")}</p><dl className={styles.retainedScenarioList}>{retainedScenarioFields().map(field => <div key={field.key}><dt>{t(field.fr, field.en)}</dt><dd>{retainedScenarioText(field.key as GuidedKey) || t("À renseigner", "To complete")}</dd></div>)}</dl></details>}</>}
            {retainedFields(section).length > 0 && <details className={styles.contextNote} data-retained-fields><summary>{t("Informations conservées à revoir", "Retained information to review")} ({retainedFields(section).length})</summary><p>{t("Ces informations restent enregistrées. Elles ne sont pas utilisées comme caractéristiques actuelles tant que leur contexte n’est pas confirmé. Revenez au type concerné pour les confirmer, ou consultez-les ici.", "This information remains saved. It is excluded from current property characteristics until its context is confirmed. Return to the relevant property type to confirm it, or review it here.")}</p><fieldset disabled={!writable || busy || importPending || !isEditing(section.id)}><div className={styles.fieldGrid}>{retainedFields(section).map(field => <div key={field.key} className={field.wide ? styles.wide : ""}><GuidedProjectField calendarInputEpoch={calendarInputEpoch} field={field} data={data} onChange={next => { const key = field.key as GuidedKey; edit({ ...next, guided: { ...next.guided, inactive: [...new Set([...next.guided.inactive, key])] } }); }} lang={lang} disabled={!writable || busy || importPending || !isEditing(section.id)} documents={documentOptions} idPrefix="fonciere-retained" />{fieldContextApplies(field.key) && <button type="button" className={styles.reconfirm} onClick={() => edit(reconfirmGuidedField(data, field.key as GuidedKey))}>{t("Confirmer pour ce type de bien", "Confirm for this property type")}</button>}</div>)}</div></fieldset></details>}
            {section.id === "agency" && <><ProjectContacts key={`contacts-${loaded?.project.id || "new"}-${calendarInputEpoch}`} data={data} onChange={edit} canReadContacts={canReadContacts} canWriteContacts={canWriteContacts} disabled={!writable || busy || importPending || !isEditing(section.id)} accessSignal={accessSignal} onOpenContact={onOpenContact} onPendingChange={setAgencyContactPending} onCreateContact={intent => {
              if (!writable || busy || importPending || !onCreateContact) return false;
              setActiveSection("agency");
              return onCreateContact(intent);
            }} contactReturn={contactReturn} onContactReturnHandled={() => {
              setActiveSection("agency");
              if (contactReturn?.contact) setNotice(t("Contact enregistré. Les modifications du projet restent à enregistrer.", "Contact saved. Project changes still need to be saved."));
              onContactReturnConsumed?.();
              revealProjectElement(document.querySelector<HTMLElement>(`[data-project-contacts] [data-contact-role="${contactReturn?.role === "agent" ? "agent" : "agency"}"]`));
            }} /><ProjectOwners key={`owners-${loaded?.project.id || "new"}-${calendarInputEpoch}`} data={data} onChange={edit} lang={lang} canReadContacts={canReadContacts} canWriteContacts={canWriteContacts} documents={documentOptions} disabled={!writable || busy || importPending || !isEditing(section.id)} accessSignal={accessSignal} onOpenContact={onOpenContact} onPendingChange={setOwnerContactPending} onCreateContact={intent => {
              if (!writable || busy || importPending || !onCreateContact) return false;
              setActiveSection("agency");
              return onCreateContact(intent);
            }} contactReturn={contactReturn} onContactReturnHandled={() => {
              setActiveSection("agency");
              if (contactReturn?.contact) setNotice(t("Contact enregistré. Les modifications du projet restent à enregistrer.", "Contact saved. Project changes still need to be saved."));
              onContactReturnConsumed?.();
              revealProjectElement(document.querySelector<HTMLElement>("[data-project-owners]"));
            }} /></>}
          </RetainedTools></div></ProjectSection>)}
          <ProjectSection sectionId="documents" anchor="fonciere-documents" number="07" title={t("Documents et visuels", "Documents and visuals")} actions={recordComplete&&writable?<SectionEditActions editing={editingSection==="documents"} disabled={busy||importPending} resuming={needsResume} onSave={()=>void save()} onCancel={()=>void cancelSection()} onEdit={()=>void beginSection("documents")} t={t} multi={importSections.length>0}/>:undefined} note={t("Conservez la fiche originale, les plans et les photos. Les fichiers sont enregistrés avec le projet.", "Keep the original brochure, plans and photos. Files are saved with the project.")} open={openSections.has("documents")} onToggle={() => toggleSection("documents")}>{loaded?.media&&<p role="status" data-media-status={loaded.media.status}>{loaded.media.status==='pending'?t("Chargement progressif des photographies… Les informations sont consultables.","Photographs are loading progressively. The record is available."):loaded.media.status==='failed'?t("Certaines photographies sont indisponibles. Leurs références et originaux sont conservés.","Some photographs are unavailable. Their references and originals are preserved."):t("Photographies chargées.","Photographs loaded.")}</p>}{loaded?.media?.status==='failed'&&<button type="button" className={styles.secondary} onClick={()=>setMediaAttempt(n=>n+1)}>{t('Réessayer les aperçus','Retry previews')}</button>}{writable && <div hidden={!isEditing("documents")} inert={!isEditing("documents")}><div data-document-upload-actions className={styles.documentActions}><button className={styles.secondary} disabled={busy || importPending || !mediaReady} onClick={() => importInput.current?.click()}><Upload size={16} />{t("Importer une fiche d’agence", "Import an agency brochure")}</button>{(["plans", "other"] as const).map(category => <button key={category} type="button" className={styles.uploadZone} disabled={busy || importPending} onClick={() => (category === "plans" ? planInput : attachmentInput).current?.click()} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={event => { event.preventDefault(); addAttachments(Array.from(event.dataTransfer.files), category); }}><FileText size={16} /><strong>{category === "plans" ? t("Ajouter un plan", "Add a plan") : t("Ajouter un document", "Add a document")}</strong><small>{t("Déposer ou choisir des fichiers", "Drop or choose files")} · {category === "plans" ? "02 - Plans" : "04 - Autres documents"}</small></button>)}<button className={styles.secondary} disabled={busy || importPending || !mediaReady} onClick={() => photoInput.current?.click()}><ImagePlus size={16} />{t("Ajouter des photos", "Add photos")}</button></div></div>}{loaded && <RetainedTools key={loaded.project.id} active={openSections.has("documents")}><ProjectDriveSync key={loaded.project.id} projectId={loaded.project.id} revision={loaded.project.revision} lang={lang} accessSignal={accessSignal}/></RetainedTools>}<p className={styles.muted}>{t("PDF, JPEG, PNG ou WebP · 25 Mo par fichier · 30 documents sources maximum. Les originaux ajoutés sont conservés ; les aperçus sont optimisés pour les présentations.", "PDF, JPEG, PNG or WebP · 25 MB per file · up to 30 source documents. Added originals are retained; previews are optimized for presentations.")}</p>{!canDownload && sourceAssets.length > 0 && <p className={styles.muted}>{t("Le téléchargement des originaux nécessite le droit Export et téléchargement. Les références documentaires et la consultation du projet restent disponibles.", "Downloading originals requires Export and download permission. Document references and project viewing remain available.")}</p>}<div className={styles.documentList}>{sourceAssets.map(asset => <div id={`fonciere-asset-${asset.id}`} key={asset.id} className={styles.document} style={{ flexWrap: "wrap" }}><FileText size={20} /><span><TaskSourceActions reference={{ type: "document", id: asset.id, context: { catalog: "fonciere", projectId: loaded!.project.id } }} title={t("Vérifier le document", "Review the document")} /><strong>{asset.original_name || t("Document original", "Original document")}</strong><span>{bytes(asset.expected_size)} · {t(...documentCategoryLabels[asset.drive_category || "other"])} · {t("Enregistré", "Saved")}</span></span><button disabled={busy || !canDownload} className={styles.iconButton} onClick={() => void download(asset)} aria-label={`${t("Télécharger", "Download")} ${asset.original_name || "document"}`}><Download size={17} /></button></div>)}{sourceFiles.map((file, index) => <div key={`${file.name}-${index}`} className={styles.document} style={{ flexWrap: "wrap" }}><FileText size={20} /><span><strong>{file.name}</strong><span>{bytes(file.size)} · {t("À enregistrer avec le projet", "Pending project save")}</span></span><span className={styles.fileCategory}>{t(...documentCategoryLabels[sourceFileCategories[index] || "other"])}</span><span className={styles.pending}>{t("Brouillon", "Draft")}</span></div>)}</div>{gallery.length > 0 && <div className={styles.gallery} data-project-gallery>{gallery.map((photo, index) => <figure key={`${index}-${photo.label}`}>{displayPhoto(index)?<Image src={displayPhoto(index)!} alt={photo.label || `${t("Photo du projet", "Project photo")} ${index + 1}`} width={260} height={170} unoptimized />:<div role="status" className={styles.photoLoading}>{t(loaded?.media?.status==='failed'?"Aperçu indisponible":"Chargement de la photo…",loaded?.media?.status==='failed'?"Preview unavailable":"Loading photo…")}</div>}<figcaption>{photo.label || `${t("Photo", "Photo")} ${index + 1}`}{photo.source && <span>{photo.source}</span>}</figcaption></figure>)}</div>}{!gallery.length && !sourceFiles.length && !sourceAssets.length && <div className={styles.documentEmpty}><FileText size={23} /><p>{t("Aucun document joint pour le moment.", "No documents attached yet.")}</p></div>}{data.provenance.length > 0 && <details className={styles.provenance}><summary>{t("Provenance des informations importées", "Imported information sources")} <span>{data.provenance.length}</span></summary><p className={styles.muted}>{t("Sources lues lors des imports. Les valeurs retenues dans la fiche restent modifiables.", "Sources read during import. Values retained in the record remain editable.")}</p>{data.provenance.map(source => <article className={styles.source} key={source.id}><h4>{source.filename}</h4><p>{source.method === "ocr" ? t("Lecture OCR", "OCR reading") : source.method === "mixed" ? t("Texte et OCR", "Text and OCR") : t("Lecture du texte", "Text extraction")} · {new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium" }).format(new Date(source.importedAt))}</p>{Object.keys(source.fields).some(key => key !== "coordinates") && <dl>{Object.entries(source.fields).filter(([key]) => key !== "coordinates").map(([key, evidence]) => <div key={key}><dt>{label(key)}{evidence.page ? ` · p. ${evidence.page}` : ""}</dt><dd>{evidence.extract}</dd></div>)}</dl>}{source.warnings.length > 0 && <ul>{source.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}</article>)}</details>}</ProjectSection>
          <ProjectSection sectionId="arbitrage" anchor="fonciere-arbitrage" number="08" title={t("Arbitrage", "Arbitration")} note={t("Deux avis séparés sur le même dossier enregistré, puis une décision commune calculée automatiquement.", "Two separate opinions on the same saved file, then an automatically calculated joint decision.")} open={openSections.has("arbitrage")} onToggle={() => toggleSection("arbitrage")}><RetainedTools key={loaded?.project.id||"draft"} active={openSections.has("arbitrage")}>{loaded ? <ProjectArbitrage key={loaded.project.id} projectId={loaded.project.id} userId={userId} loadedRevision={loaded.project.revision} loadedFingerprint={loaded.arbitrationFingerprint} projectDirty={!recordComplete || dirty || sourceFiles.length > 0 || importPending} lang={lang} accessRevision={accessRevision} accessSignal={accessSignal} onBusy={setArbitrageBusy} onDirty={setArbitrageDirty} onStatusChange={updateArbitrageStatus} onReloadProject={rereadForArbitrage}/> : <p className={styles.muted}>{t("Enregistrez le projet pour recueillir les avis sur sa première version. Aucun avis n’est attribué automatiquement.", "Save the project to collect opinions on its first version. No opinion is assigned automatically.")}</p>}</RetainedTools></ProjectSection>
          {canManageAccess && loaded && <details className={styles.contextNote} onToggle={event=>{if(event.currentTarget.open)setShowAccess(true);}}><summary>{t("Gestion des accès au projet","Project access management")}</summary><RetainedTools key={loaded.project.id} active={showAccess}><ProjectAccess key={loaded.project.id} projectId={loaded.project.id} userId={userId} accessSignal={accessSignal} onDirty={setAccessBusy}/></RetainedTools></details>}
          {writable && !recordComplete && <div className={styles.footerSave}><p>{t("Le nom suffit pour enregistrer. Vous pourrez enrichir cette fiche à tout moment.", "A name is enough to save. You can enrich this record at any time.")}</p><button className={styles.primary} disabled={busy || importPending} onClick={() => void save()}><Save size={16} />{t("Enregistrer le projet", "Save project")}</button></div>}
        </div>
      </div>
    </>}
    {review && data && <div className={styles.reviewBackdrop}><section ref={reviewRef} className={styles.review} role="dialog" aria-modal="true" aria-labelledby="fonciere-review-title"><header><p className={styles.eyebrow}>{t("IMPORT DE FICHE D’AGENCE", "AGENCY BROCHURE IMPORT")}</p><h2 id="fonciere-review-title">{t("Vérifiez les informations extraites", "Review extracted information")}</h2><p>{review.report.filename} · {review.report.pages} {t("page(s)", "page(s)")} · {review.report.gallery.length} {t("visuel(s)", "visual(s)")}</p><p>{t("Seuls les champs cochés seront appliqués. Les champs déjà renseignés restent décochés pour préserver vos corrections. Vous pouvez modifier chaque proposition.", "Only selected fields will be applied. Existing values remain unselected to preserve your corrections. Every proposed value is editable.")}</p></header>{[...review.report.warnings, ...review.report.readerWarnings].length > 0 && <div className={styles.warning}><strong>{t("Limites et points à vérifier", "Limitations and points to check")}</strong><ul>{[...new Set([...review.report.warnings, ...review.report.readerWarnings])].map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}<p>{t("Rubriques proposées","Proposed sections")} : {sections.filter(section=>section.fields.some(field=>review.selected.has(field.key as FonciereField))).map(section=>String(sections.indexOf(section)+1).padStart(2,"0")).join(", ")} · 07</p><div className={styles.reviewFields}>{proposeAgencyImport(data, review.imported).map(proposal => <div className={styles.proposal} data-project-proposal={proposal.key} key={proposal.key}><label className={styles.checkLabel}><input type="checkbox" checked={review.selected.has(proposal.key)} onChange={event => { const selected = new Set(review.selected); if (event.target.checked) selected.add(proposal.key); else selected.delete(proposal.key); setReview({ ...review, selected }); }} /><strong>{label(proposal.key)}</strong></label>{proposal.current && <div className={styles.currentValue}><span>{t("Valeur actuelle", "Current value")}</span><p>{proposal.current}</p></div>}<div className={styles.importField}><GuidedProjectField field={fieldLabels.get(proposal.key) || { key: proposal.key, fr: proposal.key, en: proposal.key }} data={review.imported} onChange={next => { const selected = new Set(review.selected); if (next.propertyAddressDetails && next.propertyAddressDetails !== review.imported.propertyAddressDetails) for (const key of ["propertyAddress", "city", "postalCode"] as const) selected.add(key); if (next.agencyAddressDetails && next.agencyAddressDetails !== review.imported.agencyAddressDetails) selected.add("agencyAddress"); setReview({ ...review, imported: next, selected }); }} lang={lang} idPrefix="fonciere-import" documents={documentOptions} /></div></div>)}</div><OwnerImportReview proposals={proposeOwnerImport(review.report, data.ownerContext)} selected={review.ownerSelected} onChange={ownerSelected=>setReview({ ...review, ownerSelected })} lang={lang} />{review.report.gallery.length > 0 && <label className={styles.checkLabel}><input type="checkbox" checked={review.photos} onChange={event => setReview({ ...review, photos: event.target.checked })} />{t("Ajouter les visuels extraits à la photothèque du projet", "Add extracted visuals to the project gallery")} ({review.report.gallery.length})</label>}<p className={styles.muted}>{t("Le document original est joint au brouillon dans tous les cas. L’import ne complète pas vos hypothèses financières personnelles.", "The original is attached to the draft in all cases. Import does not populate personal financial assumptions.")}</p><div className={styles.reviewFooter}><button className={styles.secondary} onClick={() => { setReview(null); setNotice(t("Document original joint. Aucune proposition appliquée ; complétez la fiche manuellement.", "Original attached. No proposals applied; complete the record manually.")); }}>{t("Conserver seulement le document", "Keep original only")}</button><button className={styles.primary} onClick={acceptImport}><Check size={16} />{t("Appliquer les propositions cochées", "Apply selected proposals")}</button></div></section></div>}
  </div>;
}
