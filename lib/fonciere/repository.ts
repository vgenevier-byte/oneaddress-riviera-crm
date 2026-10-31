import {drivePrimaryEnabled,uploadPrimaryAsset,downloadPrimaryAsset} from '../drivePrimary';
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeAddressValue } from "../address";
import { getContactCompany } from "../contactCompany";
import { createContactFieldResolver } from "../contactSearch";
import { createProjectData, LIMITS, PHOTO_ROLES } from "../izord/model";
import { assertEncodedImageBudget, assertImageByteBudget, encodedJpegLength } from "../izord/image-budget";
import { photoDataToBlob, validateUploadBlob, type OperationOptions } from "../izord/repository";
import { searchProjectContacts, duplicateProjectContacts, type ProjectContact, type ContactCreateInput } from "./contacts";
import { FONCIERE_DOCUMENT_LIMIT, FONCIERE_SCHEMA, validateFonciereData, type FonciereData } from "./model";
import { validateOwnerContext } from "./owners";

export type FonciereProjectRecord = { id: string; owner_id: string; title: string; project_number?: number; project_reference?: string; creation_key?: string; revision: number; status: "active" | "archived"; payload: StoredFoncierePayload; created_at: string; updated_at: string };
export type FonciereProjectSummary = Omit<FonciereProjectRecord,"payload"> & {payload:{data:Partial<FonciereData>;creationIntentHash?:string;creationRequestHash?:string}};
const summaryFields=['name','propertyAddress','city','postalCode','agencyReference','agencyName','agentName','agentEmail','agentPhone','propertyType','askingPrice','area','areaKind','visitDate'] as const;
const summarySelect=['id','owner_id','title','project_number','project_reference','revision','status','created_at','updated_at',...summaryFields.map(k=>`f_${k}:payload->data->${k}`),'g_values:payload->data->guided->values','g_inactive:payload->data->guided->inactive',...['propertyType','askingPrice','area','areaKind'].map(k=>`g_${k}:payload->data->guided->details->${k}`),'intent:payload->creationIntentHash','request:payload->creationRequestHash'].join(',');
function summaryRow(row:Record<string,unknown>):FonciereProjectSummary {const {id,owner_id,title,project_number,project_reference,revision,status,created_at,updated_at}=row;const data:Record<string,unknown>={};for(const key of summaryFields)data[key]=typeof row['f_'+key]==='string'?row['f_'+key]:'';data.guided={version:1,values:row.g_values||{},inactive:row.g_inactive||[],details:Object.fromEntries(['propertyType','askingPrice','area','areaKind'].filter(k=>typeof row['g_'+k]==='string').map(k=>[k,row['g_'+k]]))};return {id,owner_id,title,project_number,project_reference,revision,status,created_at,updated_at,payload:{data,...(row.intent?{creationIntentHash:row.intent}:{}),...(row.request?{creationRequestHash:row.request}:{})}} as FonciereProjectSummary;}
export type FonciereDocumentCategory = "agency" | "plans" | "photos" | "other";
export type FonciereAssetRecord = { storage_provider?: "supabase" | "drive"; id: string; project_id: string; object_path: string; kind: "pdf" | "photo" | "attachment"; lifecycle: "pending" | "finalized" | "withdrawn"; created_by: string; created_at: string; expected_size: number; expected_mime: string; original_name: string; drive_category?: FonciereDocumentCategory };
export type StoredFoncierePayload = { schema: typeof FONCIERE_SCHEMA; data: FonciereData; sourceDocuments: string[]; creationRequestHash?: string; creationIntentHash?: string };
export type FonciereMediaState = { loadId?: string; status: "pending" | "complete" | "failed"; previews: Record<string,string>; errors: string[] };
export type LoadedFonciereProject = { media?: FonciereMediaState; project: FonciereProjectRecord; data: FonciereData; assets: FonciereAssetRecord[]; sourceDocuments: string[]; arbitrationFingerprint?: string };
/** Explicitly accept a fully admitted preview set for media editing; metadata reads never do this implicitly. */
export function resolveFonciereMedia(loaded:LoadedFonciereProject,data=loaded.data):LoadedFonciereProject {
 if(!loaded.media)return {...loaded,data};
 if(loaded.media.status!=='complete')throw new Error("Les photographies ne sont pas toutes disponibles. Vos informations et les références enregistrées sont conservées.");
 const next=structuredClone(data),saved=loaded.project.payload.data.presentationData;
 for(const role of PHOTO_ROLES){const ref=saved.photos[role];if(ref){const value=loaded.media.previews[ref];if(!value)throw Error('Aperçu incomplet');if(data.presentationData.photos[role]===loaded.data.presentationData.photos[role])next.presentationData.photos[role]=value;}}
 next.presentationData.importGallery.forEach((photo,index)=>{const ref=saved.importGallery[index]?.data;if(ref){const value=loaded.media!.previews[ref];if(!value)throw Error('Photothèque incomplète');if(photo.data===loaded.data.presentationData.importGallery[index]?.data)photo.data=value;}});
 const result={...loaded,data:next};delete result.media;return result;
}
export type ContactOption = ProjectContact;
export type { ContactCreateInput } from "./contacts";
export class FonciereConflictError extends Error { constructor() { super("Une autre modification a été enregistrée. Votre saisie est conservée ; rechargez la fiche avant de rapprocher les changements."); this.name = "FonciereConflictError"; } }
export class FonciereCreationConflictError extends Error {
  projectId?: string; projectReference?: string; revision?: number;
  constructor(identity: { projectId?: string; projectReference?: string; revision?: number } = {}) {
    super("Cette identité de création correspond déjà à une fiche enregistrée. Votre brouillon est conservé ; rapprochez explicitement les deux versions avant de poursuivre.");
    this.name = "FonciereCreationConflictError";
    this.projectId = identity.projectId; this.projectReference = identity.projectReference; this.revision = identity.revision;
  }
}
const previewCache = new Map<string,{etag:string;blob:Blob}>();
let previewCacheBytes=0;
export function clearFoncierePreviewCache(){previewCache.clear();previewCacheBytes=0;}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function aborted(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("Opération interrompue.", "AbortError"); }
async function guarded<T>(signal: AbortSignal | undefined, operation: () => PromiseLike<T>): Promise<T> { aborted(signal); try { return await operation(); } finally { aborted(signal); } }
function failure(error: { code?: string; message?: string; details?: string } | null) {
  if (!error) return;
  if (error.message === "fonciere_creation_intent_conflict" || error.message === "fonciere_creation_reconciliation_required") {
    let identity: { projectId?: string; projectReference?: string; revision?: number } = {};
    try { const detail = JSON.parse(error.details || "{}"); identity = { ...(typeof detail.projectId === "string" && UUID.test(detail.projectId) ? { projectId: detail.projectId } : {}), ...(typeof detail.projectReference === "string" && /^PRJ-\d+$/.test(detail.projectReference) ? { projectReference: detail.projectReference } : {}), ...(Number.isInteger(detail.revision) ? { revision: detail.revision } : {}) }; } catch { /* Keep the draft even when the server cannot supply a readable identity. */ }
    throw new FonciereCreationConflictError(identity);
  }
  if (error.code === "40001") throw new FonciereConflictError();
  if (error.code === "42501") throw new Error("Opération refusée : vérifiez vos droits sur le projet, les contacts et les documents.");
  if (error.code === "PGRST205" || error.code === "PGRST202" || error.code === "42P01") throw new Error("Le stockage Foncière n’est pas encore disponible. Conservez votre saisie et contactez l’administrateur.");
  throw new Error("L’enregistrement n’a pas été confirmé par le serveur. Votre saisie est conservée.");
}
function payload(value: unknown): StoredFoncierePayload {
  const raw = value as StoredFoncierePayload;
  if (!raw || raw.schema !== FONCIERE_SCHEMA || !raw.data || !raw.data.presentationData || !Array.isArray(raw.sourceDocuments) || raw.sourceDocuments.length > FONCIERE_DOCUMENT_LIMIT || !Array.isArray(raw.data.presentationData.importGallery) || raw.data.presentationData.importGallery.length > LIMITS.galleryPhotos) throw new Error("Fiche distante invalide.");
  return raw;
}
async function blobData(blob: Blob, options: OperationOptions) {
  const bytes = new Uint8Array(await guarded(options.signal, () => blob.arrayBuffer()));
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}`;
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
async function creationRequestHash(data: FonciereData, files: File[], categories: FonciereDocumentCategory[] | undefined, options: OperationOptions): Promise<string> {
  async function digest(bytes: BufferSource) { return Array.from(new Uint8Array(await guarded(options.signal, () => crypto.subtle.digest("SHA-256", bytes)))).map(byte => byte.toString(16).padStart(2, "0")).join(""); }
  const metadata = structuredClone(data), images = new Map<string, string>();
  async function image(value: string) { if (!images.has(value)) images.set(value, await digest(new TextEncoder().encode(value))); return images.get(value)!; }
  for (const role of PHOTO_ROLES) metadata.presentationData.photos[role] = await image(data.presentationData.photos[role]);
  for (let index = 0; index < metadata.presentationData.importGallery.length; index++) metadata.presentationData.importGallery[index].data = await image(data.presentationData.importGallery[index].data);
  const sources = [];
  for (const [index, file] of files.entries()) sources.push({ name: file.name, mime: file.type, size: file.size, category: categories?.[index] ?? (file.type.startsWith("image/") ? "photos" : file.type === "application/pdf" ? "agency" : "other"), sha256: await digest(await guarded(options.signal, () => file.arrayBuffer())) });
  return digest(new TextEncoder().encode(canonicalJson({ data: metadata, sources })));
}
function contactOption(row: Record<string, unknown>): ContactOption {
  const text = (key: string) => typeof row[key] === "string" ? row[key] as string : "";
  return { id: text("id"), ...(row.entityType === "company" || row.entityType === "person" ? { entityType: row.entityType } : {}), ...(text("companyId") ? { companyId: text("companyId") } : {}), ...(text("primaryContactId") ? { primaryContactId: text("primaryContactId") } : {}), ...(text("mergedIntoCompanyId") ? { mergedIntoCompanyId: text("mergedIntoCompanyId") } : {}), name: text("name"), firstName: text("firstName"), companyName: text("companyName"), email: text("email"), phone: text("phone"), city: text("city"), ...(text("organizationFunction") ? { organizationFunction: text("organizationFunction") } : {}), ...(text("supplierCategory") ? { supplierCategory: text("supplierCategory") } : {}), postalAddress: text("postalAddress"), ...(row.postalAddressDetails ? { postalAddressDetails: normalizeAddressValue(row.postalAddressDetails, text("postalAddress")) } : {}) };
}

/** Captured-token clients from useScopedOperations are supported. Auth, Contacts
 * projection and every asset admission are verified by the existing server ACL. */
export function createFonciereRepository(client: SupabaseClient, configuration: { accessToken?: string; previewBaseUrl?: string } = {}) {
  const store = client.storage.from("fonciere-documents");
  async function readProject(id: string, options: OperationOptions = {}): Promise<FonciereProjectRecord> {
    const result = await guarded(options.signal, () => client.from("fonciere_projects").select("*").eq("id", id).single());
    failure(result.error); if (!result.data) throw new Error("Projet inaccessible."); return result.data;
  }
  async function listAssets(id: string, options: OperationOptions = {}): Promise<FonciereAssetRecord[]> {
    const result = await guarded(options.signal, () => client.from("fonciere_assets").select("*").eq("project_id", id).eq("lifecycle", "finalized").order("created_at", { ascending: false })); failure(result.error); return result.data || [];
  }
  async function authorizeTransfer(id: string, revision: number | null, options: OperationOptions = {}) {
    const result = await guarded(options.signal, () => client.rpc("fonciere_authorize_transfer", { p_project: id, p_revision: revision })); failure(result.error);
  }
  async function previewPhoto(asset: FonciereAssetRecord, options: OperationOptions): Promise<Blob> {
    const token = configuration.accessToken || (await guarded(options.signal, () => client.auth.getSession())).data.session?.access_token;
    if (!token) throw new Error("Session CRM requise pour consulter les photographies.");
    const key=token+":"+asset.id, cached=previewCache.get(key);
    const response = await guarded(options.signal, () => fetch(`${configuration.previewBaseUrl || ""}/api/fonciere/photo-preview?asset=${encodeURIComponent(asset.id)}`, { headers: { Authorization: `Bearer ${token}`, ...(cached?{"If-None-Match":cached.etag}:{}) }, cache: "no-store", signal: options.signal }));
    // Every reuse still reaches live server admission; no byte cache bypasses ACL.
    if(response.status===304&&cached)return cached.blob;
    if (!response.ok) {if(cached){previewCache.delete(key);previewCacheBytes-=cached.blob.size;}throw new Error("Photographie inaccessible. Votre fiche et ses références sont conservées.");}
    const blob = await guarded(options.signal, () => response.blob());
    if (blob.type !== "image/jpeg" || !blob.size || blob.size > LIMITS.fileBytes) throw new Error("Aperçu photographique invalide.");
    const etag=response.headers.get('etag');if(etag){if(cached)previewCacheBytes-=cached.blob.size;previewCache.delete(key);previewCache.set(key,{etag,blob});previewCacheBytes+=blob.size;while(previewCacheBytes>32_000_000||previewCache.size>96){const first=previewCache.keys().next().value!;previewCacheBytes-=previewCache.get(first)!.blob.size;previewCache.delete(first);}}
    return blob;
  }
  async function downloadAsset(asset: FonciereAssetRecord, options: OperationOptions = {}): Promise<Blob> {
    if (asset.object_path !== `${asset.project_id}/${asset.id}` || !UUID.test(asset.id)) throw new Error("Identité documentaire invalide.");
    if(asset.storage_provider==='drive')return downloadPrimaryAsset(client,'fonciere',asset.id,options,configuration.previewBaseUrl);
    const admission = await guarded(options.signal, () => client.rpc("fonciere_asset_access", { p_asset: asset.id, p_operation: "download" })); failure(admission.error);
    if (!admission.data || admission.data.object_path !== asset.object_path) throw new Error("Identité documentaire non confirmée.");
    const result = await guarded(options.signal, () => store.download(asset.object_path)); failure(result.error);
    if (!result.data || result.data.size !== asset.expected_size || result.data.size > LIMITS.fileBytes || result.data.type !== asset.expected_mime) throw new Error("Document reçu invalide ou incomplet."); return result.data;
  }
  async function arbitrationToken(id: string, options: OperationOptions): Promise<{ fingerprint: string; revision: number }> {
    const result = await guarded(options.signal, () => client.rpc("fonciere_arbitrage_read", { p_project: id })); failure(result.error);
    if (!result.data || typeof result.data.fingerprint !== "string" || !Number.isInteger(result.data.revision)) throw new FonciereConflictError();
    return { fingerprint: result.data.fingerprint, revision: result.data.revision };
  }
  async function loadProject(id: string, options: OperationOptions & { purpose?: "transfer"; arbitration?: boolean; media?: "defer" } = {}): Promise<LoadedFonciereProject> {
    const beforeArbitration = options.arbitration ? await arbitrationToken(id, options) : null;
    if (options.purpose === "transfer") await authorizeTransfer(id, null, options);
    const [project,assets,link] = await Promise.all([readProject(id,options),listAssets(id,options),guarded(options.signal, () => client.from("fonciere_project_contacts").select("contact_id,agency_contact_id").eq("project_id", id).maybeSingle())]);
    const saved=payload(project.payload);failure(link.error);
    const data = structuredClone(saved.data), empty = createProjectData(), cache = new Map<string, string>();
    data.agentContactId = link.data?.contact_id || "";
    data.agencyContactId = link.data?.agency_contact_id || "";
    const refs = [...PHOTO_ROLES.map(role => data.presentationData.photos[role]), ...data.presentationData.importGallery.map(item => item.data)].filter(Boolean);
    const declared = refs.map(ref => ({ id: ref, bytes: assets.find(asset => asset.id === ref)?.expected_size || 0 }));
    assertImageByteBudget(declared); assertEncodedImageBudget(declared.map(entry => encodedJpegLength(entry.bytes)));
    async function hydrate(ref: string, fallback: string) {
      if (!ref) return fallback;
      const asset = assets.find(item => item.id === ref && item.project_id === id && item.kind === "photo" && item.lifecycle === "finalized");
      if (!UUID.test(ref) || !asset) throw new Error("Une photographie est inaccessible. La fiche n’a pas été chargée partiellement.");
      if (!cache.has(ref)) cache.set(ref, await blobData(await (options.purpose === "transfer" ? downloadAsset(asset, options) : previewPhoto(asset, options)), options));
      return cache.get(ref)!;
    }
    const deferred=options.media==='defer'&&options.purpose!=='transfer';
    // References remain canonical in project.payload. Display placeholders are never deletions.
    if(!deferred){const queue=[...new Set(refs)];await Promise.all(Array.from({length:Math.min(3,queue.length)},async()=>{while(queue.length){aborted(options.signal);await hydrate(queue.shift()!,empty.photos.main);}}));}
    for(const role of PHOTO_ROLES)data.presentationData.photos[role]=deferred?empty.photos[role]:await hydrate(data.presentationData.photos[role],empty.photos[role]);
    for(const photo of data.presentationData.importGallery)photo.data=deferred?empty.photos.main:await hydrate(photo.data,empty.photos.main);
    for (const ref of saved.sourceDocuments) if (!assets.some(asset => asset.id === ref && asset.project_id === id && ["pdf", "attachment"].includes(asset.kind))) throw new Error("Un document source est inaccessible. La fiche n’a pas été chargée partiellement.");
    if (options.purpose === "transfer") await authorizeTransfer(id, project.revision, options);
    if (beforeArbitration) {
      const afterArbitration = await arbitrationToken(id, options);
      if (beforeArbitration.fingerprint !== afterArbitration.fingerprint || beforeArbitration.revision !== project.revision || afterArbitration.revision !== project.revision) throw new FonciereConflictError();
    }
    return { project, data: validateFonciereData(data), assets, ...(deferred?{media:{loadId:crypto.randomUUID(),status:refs.length?"pending" as const:"complete" as const,previews:{},errors:[]}}:{}), sourceDocuments: [...saved.sourceDocuments], ...(beforeArbitration ? { arbitrationFingerprint: beforeArbitration.fingerprint } : {}) };
  }
  async function hydrateMedia(loaded:LoadedFonciereProject, options:OperationOptions & {onPhoto?:(id:string,data:string)=>void}={}) : Promise<FonciereMediaState> {
    const id=loaded.project.id,saved=payload(loaded.project.payload),refs=[...new Set([...Object.values(saved.data.presentationData.photos),...saved.data.presentationData.importGallery.map(p=>p.data)].filter(Boolean))];
    const previews:Record<string,string>={},errors:string[]=[],queue=[...refs];
    await Promise.all(Array.from({length:Math.min(3,queue.length)},async()=>{while(queue.length){aborted(options.signal);const ref=queue.shift()!;try{const asset=loaded.assets.find(a=>a.id===ref&&a.project_id===id&&a.kind==='photo');if(!asset)throw Error('Missing photo');const value=await blobData(await previewPhoto(asset,options),options);aborted(options.signal);previews[ref]=value;options.onPhoto?.(ref,value);}catch(error){aborted(options.signal);errors.push(ref);}}}));
    return {loadId:loaded.media?.loadId,status:errors.length?'failed':'complete',previews,errors};
  }
  async function uploadAsset(project: FonciereProjectRecord, file: Blob, kind: FonciereAssetRecord["kind"], name: string, options: OperationOptions, category: FonciereDocumentCategory = kind === "photo" ? "photos" : kind === "pdf" ? "agency" : "other", slot = name): Promise<FonciereAssetRecord> {
    if (kind === "attachment" && file.type === "image/webp") {
      const header = new TextDecoder().decode(await guarded(options.signal, () => file.slice(0, 12).arrayBuffer()));
      if (file.size <= 0 || file.size > LIMITS.fileBytes || header.slice(0, 4) !== "RIFF" || header.slice(8, 12) !== "WEBP") throw new Error("Le contenu du fichier WebP est invalide.");
    } else await guarded(options.signal, () => validateUploadBlob(file, kind === "attachment" ? "photo" : kind));
    const safeName = name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 180) || "document";
    if(await drivePrimaryEnabled(client)){
      const id=await uploadPrimaryAsset(client,{domain:'fonciere',project:project.id,source:project.id,revision:project.revision,kind,file,name:safeName,category,slot,baseUrl:configuration.previewBaseUrl},options);
      const asset=(await listAssets(project.id,options)).find(a=>a.id===id);if(!asset)throw Error('Conservation Drive non confirmée.');return asset;
    }
    const registered = await guarded(options.signal, () => client.rpc("fonciere_register_asset", { p_project: project.id, p_revision: project.revision, p_kind: kind, p_size: file.size, p_mime: file.type, p_name: safeName, p_category: category })); failure(registered.error);
    const path = String(registered.data), id = path.split("/")[1];
    if (path !== `${project.id}/${id}` || !UUID.test(id)) throw new Error("Identité de transfert invalide.");
    const transfer = await guarded(options.signal, () => store.upload(path, file, { upsert: false, cacheControl: "0", contentType: file.type })); failure(transfer.error);
    options.onProgress?.({ stage: "upload", completed: file.size, total: file.size, label: name });
    const finalized = await guarded(options.signal, () => client.rpc("fonciere_finalize_asset", { p_asset: id })); failure(finalized.error);
    const asset = (await listAssets(project.id, options)).find(item => item.id === id);
    if (!asset) throw new Error("La conservation du document n’a pas été confirmée."); return asset;
  }
  async function contacts(options: OperationOptions) {
    const result = await guarded(options.signal, () => client.rpc("crm_read_module", { p_module: "contacts" })); failure(result.error);
    const snapshot = result.data as { revision: string; collections: { contacts: Record<string, unknown>[] } };
    if (!snapshot || !Array.isArray(snapshot.collections?.contacts) || typeof snapshot.revision !== "string") throw new Error("Liste des contacts invalide.");
    const rows = snapshot.collections.contacts.map(contactOption);
    // The authorized projection supplies every value; canonical display does
    // not write a historical person's free-text company name.
    const fields = createContactFieldResolver(rows);
    return { revision: snapshot.revision, contacts: rows.map(row => ({ ...row,
      ...(row.entityType !== "company" && row.companyId ? { companyName: getContactCompany(row, rows)?.companyName || row.companyName } : {}),
      searchText: fields(row).filter(Boolean).join(" ")
    })) };
  }
  return {
    async listProjectSummaries(options:OperationOptions={}):Promise<FonciereProjectSummary[]> {
      const rows:FonciereProjectSummary[]=[];for(let offset=0;;offset+=250){const result=await guarded(options.signal,()=>client.from('fonciere_projects').select(summarySelect).order('project_number',{ascending:true}).order('id',{ascending:true}).range(offset,offset+249));failure(result.error);const page=result.data||[];rows.push(...page.map(row=>summaryRow(row as unknown as Record<string,unknown>)));if(page.length<250)return rows;}
    },
    async listProjects(options: OperationOptions = {}): Promise<FonciereProjectRecord[]> {
      const rows: FonciereProjectRecord[] = [], pageSize = 250;
      // RLS remains applied to each page; rank/search only after every eligible page is loaded.
      for (let offset = 0; ; offset += pageSize) {
        const result = await guarded(options.signal, () => client.from("fonciere_projects").select("*").order("project_number", { ascending: true }).order("id", { ascending: true }).range(offset, offset + pageSize - 1));
        failure(result.error);
        const page = (result.data || []) as FonciereProjectRecord[];
        rows.push(...page);
        if (page.length < pageSize) return rows;
      }
    },
    loadProject, hydrateMedia, listAssets, downloadAsset, authorizeTransfer,
    readContacts: contacts,
    async saveProject(input: { data: FonciereData; previous?: LoadedFonciereProject; creationKey?: string; creationReconciled?: boolean; sourceFiles?: File[]; sourceFileCategories?: FonciereDocumentCategory[]; onCreated?: (draft: LoadedFonciereProject) => void }, options: OperationOptions & { arbitration?: boolean; media?: "defer" } = {}): Promise<LoadedFonciereProject> {
      const data = validateFonciereData(input.data), persisted = structuredClone(data), empty = createProjectData();
      // Contact identity has a separate Contacts-protected projection in SQL.
      delete (persisted as Partial<FonciereData>).agentContactId;
      delete (persisted as Partial<FonciereData>).agencyContactId;
      const before = input.previous;
      const partialMedia = Boolean(before?.media && (!input.creationKey || input.creationReconciled));
      if(partialMedia && before && (JSON.stringify(data.presentationData.photos)!==JSON.stringify(before.data.presentationData.photos)||JSON.stringify(data.presentationData.importGallery)!==JSON.stringify(before.data.presentationData.importGallery)||JSON.stringify(data.presentationData.photoGalleryRoles)!==JSON.stringify(before.data.presentationData.photoGalleryRoles)))throw new Error("Chargez toutes les photographies avant de modifier leurs affectations. Les références enregistrées sont conservées.");
      const old = before ? payload(before.project.payload) : null, reuse = new Map<string, string>();
      if (old && before) {
        for (const role of PHOTO_ROLES) if (old.data.presentationData.photos[role]) reuse.set(before.data.presentationData.photos[role], old.data.presentationData.photos[role]);
        old.data.presentationData.importGallery.forEach((photo, index) => { if (before.data.presentationData.importGallery[index]) reuse.set(before.data.presentationData.importGallery[index].data, photo.data); });
      }
      let project = before?.project;
      if (input.creationReconciled && !before) throw new Error("Une fiche enregistrée doit être vérifiée avant le rapprochement. Votre brouillon est conservé.");
      const pendingCreation = !before || Boolean(input.creationKey) && !input.creationReconciled;
      const requestHash = pendingCreation ? await creationRequestHash(data, input.sourceFiles || [], input.sourceFileCategories, options) : undefined;
      if (pendingCreation) {
        const initial = structuredClone(persisted); initial.presentationData.photos = { main: "", view: "", inside: "", operation: "" }; initial.presentationData.importGallery = []; initial.presentationData.photoGalleryRoles = {};
        if (!input.creationKey || !UUID.test(input.creationKey)) throw new Error("Identité de création persistante requise. Votre saisie est conservée.");
        const created = await guarded(options.signal, () => client.rpc("fonciere_create_project", { p_creation_key: input.creationKey, p_payload: { schema: FONCIERE_SCHEMA, data: initial, sourceDocuments: [], creationIntentHash: requestHash }, p_contact: data.agentContactId, p_agency_contact: data.agencyContactId })); failure(created.error);
        if (before && created.data !== before.project.id) throw new FonciereCreationConflictError();
        project = await readProject(String(created.data), options);
        if (project.revision > 1) {
          if (project.payload.creationRequestHash === requestHash) return loadProject(project.id, options);
          throw new FonciereCreationConflictError({ projectId: project.id, projectReference: project.project_reference, revision: project.revision });
        }
        // Surface the confirmed identity before any fallible byte transfer. The
        // editor retains it on failure so retry cannot create a second property.
        if (!before) input.onCreated?.(await loadProject(project.id, options));
      }
      if (!project) throw new Error("Identité du projet non confirmée. Votre brouillon est conservé.");
      const target = project, uploaded = new Map<string, string>();
      async function persistPhoto(value: string, fallback: string, name: string, previousValue?: string, previousReference?: string) {
        // Slot identity preserves distinct originals even when previews have equal bytes.
        if (previousReference !== undefined && value === previousValue) return previousReference;
        if (value === fallback) return "";
        if (reuse.has(value)) return reuse.get(value)!;
        if (!uploaded.has(value)) uploaded.set(value, (await uploadAsset(target, photoDataToBlob(value), "photo", name, options)).id);
        return uploaded.get(value)!;
      }
      if(partialMedia&&old){persisted.presentationData.photos=structuredClone(old.data.presentationData.photos);persisted.presentationData.importGallery=structuredClone(old.data.presentationData.importGallery);persisted.presentationData.photoGalleryRoles=structuredClone(old.data.presentationData.photoGalleryRoles);}
      else {
      for (const role of PHOTO_ROLES) persisted.presentationData.photos[role] = await persistPhoto(data.presentationData.photos[role], empty.photos[role], `${role}.jpg`, before?.data.presentationData.photos[role], old?.data.presentationData.photos[role]);
      for (let index = 0; index < data.presentationData.importGallery.length; index++) {
        const item = data.presentationData.importGallery[index];
        const prior = before?.data.presentationData.importGallery[index];
        const priorRef = old?.data.presentationData.importGallery[index];
        persisted.presentationData.importGallery[index].data = await persistPhoto(item.data, "", `photo-${index + 1}.jpg`, prior?.data, priorRef?.data);
      }
      }
      const sourceDocuments = [...(before?.sourceDocuments || [])];
      if (sourceDocuments.length + (input.sourceFiles?.length || 0) > FONCIERE_DOCUMENT_LIMIT) throw new Error("Trente documents sources maximum par projet.");
      for (const [index, file] of (input.sourceFiles || []).entries()) sourceDocuments.push((await uploadAsset(target, file, file.type === "application/pdf" ? "pdf" : "attachment", file.name, options, input.sourceFileCategories?.[index] ?? (file.type.startsWith("image/") ? "photos" : file.type === "application/pdf" ? "agency" : "other"),`source:${sourceDocuments.length}:${index}`)).id);
      const value: StoredFoncierePayload = { schema: FONCIERE_SCHEMA, data: persisted, sourceDocuments, ...(old?.creationRequestHash || requestHash ? { creationRequestHash: old?.creationRequestHash || requestHash } : {}), ...(project.payload.creationIntentHash ? { creationIntentHash: project.payload.creationIntentHash } : {}) };
      if (new TextEncoder().encode(JSON.stringify(value)).length > 950000) throw new Error("Métadonnées du projet trop volumineuses. Votre saisie est conservée.");
      options.onProgress?.({ stage: "save", completed: 0, total: 1, label: "Enregistrement du projet" });
      const saved = await guarded(options.signal, () => client.rpc("fonciere_save_project", { p_id: target.id, p_expected_revision: target.revision, p_payload: value, p_contact: data.agentContactId, p_agency_contact: data.agencyContactId })); failure(saved.error);
      const confirmed = await readProject(target.id, options);
      if (confirmed.revision !== target.revision + 1) throw new FonciereConflictError();
      // Attribution is owned by the server; reflect its confirmed value at once.
      data.ownerContext = validateOwnerContext(confirmed.payload.data.ownerContext);
      if (options.arbitration) {
        const reviewed = await loadProject(target.id, options);
        if (reviewed.project.revision !== confirmed.revision) throw new FonciereConflictError();
        return reviewed;
      }
      options.onProgress?.({ stage: "save", completed: 1, total: 1, label: "Projet enregistré" });
      if(options.media==='defer'||before?.media)return loadProject(target.id,{...options,media:'defer'});
      return { project: confirmed, data, assets: await listAssets(target.id, options), sourceDocuments };
    },
    async archiveProject(project: FonciereProjectRecord, archived: boolean, options: OperationOptions = {}): Promise<FonciereProjectRecord> {
      const result = await guarded(options.signal, () => client.rpc("fonciere_archive_project", { p_id: project.id, p_expected_revision: project.revision, p_archived: archived })); failure(result.error);
      const confirmed = await readProject(project.id, options); if (confirmed.revision !== Number(result.data)) throw new FonciereConflictError(); return confirmed;
    },
    async searchContacts(query: string, options: OperationOptions = {}): Promise<ContactOption[]> {
      const rows = (await contacts(options)).contacts;
      return searchProjectContacts(rows, query.trim());
    },
    async readContact(id: string, options: OperationOptions = {}): Promise<ContactOption | null> {
      if (!id || id.length > 180) return null;
      return (await contacts(options)).contacts.find(row => row.id === id) || null;
    },
    async createContact(input: ContactCreateInput, options: OperationOptions = {}): Promise<ContactOption> {
      const name = input.name.trim(), companyName = input.companyName.trim(), entityType = input.entityType === "company" ? "company" : "person";
      if (entityType === "company" ? !companyName : !name) throw new Error(entityType === "company" ? "Le nom de l’entreprise est obligatoire." : "Le nom du contact est obligatoire.");
      const existingPersonId = input.existingPersonId?.trim() || null;
      if (entityType === "company" && Boolean(input.firstPerson) === Boolean(existingPersonId)) throw new Error("Choisissez une personne existante ou créez le premier interlocuteur de l’entreprise.");
      if (entityType === "person" && (input.firstPerson || existingPersonId)) throw new Error("Le premier interlocuteur concerne uniquement une entreprise.");
      if (input.firstPerson && !input.firstPerson.name.trim()) throw new Error("Le nom du premier interlocuteur est obligatoire.");
      const snapshot = await contacts(options);
      if (duplicateProjectContacts(snapshot.contacts, input).length) throw new Error("Un contact possède déjà cette identité ou ces coordonnées. Sélectionnez-le dans les résultats de recherche.");
      if (existingPersonId && !snapshot.contacts.some(row => row.id === existingPersonId && row.entityType !== "company" && row.name.trim())) throw new Error("Sélectionnez une véritable fiche personne existante.");
      const id = crypto.randomUUID(), patch = { entityType, name, firstName: input.firstName || "", companyName, email: input.email || "", phone: input.phone || "", city: input.city || "", postalAddress: input.postalAddress || "", ...(input.postalAddressDetails ? { postalAddressDetails: normalizeAddressValue(input.postalAddressDetails, input.postalAddress) } : {}), ...(entityType === "person" && input.companyId ? { companyId: input.companyId } : {}), kind: "Prestataire", supplierCategory: "Agence immobilière" };
      const first = input.firstPerson;
      // Build the person's own coordinates independently. Agency phone, email,
      // address and address metadata never become personal defaults.
      const person = first ? { id: crypto.randomUUID(), entityType: "person", name: first.name.trim(), firstName: first.firstName || "", companyName: first.companyName || "", email: first.email || "", phone: first.phone || "", city: first.city || "", postalAddress: first.postalAddress || "", ...(first.postalAddressDetails ? { postalAddressDetails: normalizeAddressValue(first.postalAddressDetails, first.postalAddress || "") } : {}), kind: "Prestataire", supplierCategory: "Agence immobilière" } : null;
      const result = await guarded(options.signal, () => client.rpc("crm_save_contact_bundle", { p_contact: { ...patch, id }, p_person: person, p_existing_person_id: existingPersonId, p_revision: snapshot.revision })); failure(result.error);
      const row = (result.data as { collections?: { contacts?: Record<string, unknown>[] } })?.collections?.contacts?.find(row => row.id === id);
      if (!row) throw new Error("La création du contact n’a pas été confirmée."); return contactOption(row);
    },
  };
}
