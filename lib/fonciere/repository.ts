import type { SupabaseClient } from "@supabase/supabase-js";
import { createProjectData, LIMITS, PHOTO_ROLES } from "../izord/model";
import { assertEncodedImageBudget, assertImageByteBudget, encodedJpegLength } from "../izord/image-budget";
import { photoDataToBlob, validateUploadBlob, type OperationOptions } from "../izord/repository";
import { matchesProjectContact, duplicateProjectContacts, type ProjectContact, type ContactCreateInput } from "./contacts";
import { FONCIERE_DOCUMENT_LIMIT, FONCIERE_SCHEMA, validateFonciereData, type FonciereData } from "./model";

export type FonciereProjectRecord = { id: string; owner_id: string; title: string; revision: number; status: "active" | "archived"; payload: StoredFoncierePayload; created_at: string; updated_at: string };
export type FonciereAssetRecord = { id: string; project_id: string; object_path: string; kind: "pdf" | "photo" | "attachment"; lifecycle: "pending" | "finalized" | "withdrawn"; created_by: string; created_at: string; expected_size: number; expected_mime: string; original_name: string };
export type StoredFoncierePayload = { schema: typeof FONCIERE_SCHEMA; data: FonciereData; sourceDocuments: string[] };
export type LoadedFonciereProject = { project: FonciereProjectRecord; data: FonciereData; assets: FonciereAssetRecord[]; sourceDocuments: string[] };
export type ContactOption = ProjectContact;
export type { ContactCreateInput } from "./contacts";
export class FonciereConflictError extends Error { constructor() { super("Une autre modification a été enregistrée. Votre saisie est conservée ; rechargez la fiche avant de rapprocher les changements."); this.name = "FonciereConflictError"; } }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function aborted(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("Opération interrompue.", "AbortError"); }
async function guarded<T>(signal: AbortSignal | undefined, operation: () => PromiseLike<T>): Promise<T> { aborted(signal); try { return await operation(); } finally { aborted(signal); } }
function failure(error: { code?: string; message?: string } | null) {
  if (!error) return;
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
function contactOption(row: Record<string, unknown>): ContactOption {
  const text = (key: string) => typeof row[key] === "string" ? row[key] as string : "";
  return { id: text("id"), ...(row.entityType === "company" || row.entityType === "person" ? { entityType: row.entityType } : {}), name: text("name"), firstName: text("firstName"), companyName: text("companyName"), email: text("email"), phone: text("phone"), city: text("city"), postalAddress: text("postalAddress") };
}

/** Captured-token clients from useScopedOperations are supported. Auth, Contacts
 * projection and every asset admission are verified by the existing server ACL. */
export function createFonciereRepository(client: SupabaseClient) {
  const store = client.storage.from("fonciere-documents");
  async function readProject(id: string, options: OperationOptions = {}): Promise<FonciereProjectRecord> {
    const result = await guarded(options.signal, () => client.from("fonciere_projects").select("*").eq("id", id).single());
    failure(result.error); if (!result.data) throw new Error("Projet inaccessible."); return result.data;
  }
  async function listAssets(id: string, options: OperationOptions = {}): Promise<FonciereAssetRecord[]> {
    const result = await guarded(options.signal, () => client.from("fonciere_assets").select("*").eq("project_id", id).eq("lifecycle", "finalized").order("created_at", { ascending: false })); failure(result.error); return result.data || [];
  }
  async function downloadAsset(asset: FonciereAssetRecord, options: OperationOptions = {}): Promise<Blob> {
    if (asset.object_path !== `${asset.project_id}/${asset.id}` || !UUID.test(asset.id)) throw new Error("Identité documentaire invalide.");
    const result = await guarded(options.signal, () => store.download(asset.object_path)); failure(result.error);
    if (!result.data || result.data.size !== asset.expected_size || result.data.size > LIMITS.fileBytes || result.data.type !== asset.expected_mime) throw new Error("Document reçu invalide ou incomplet."); return result.data;
  }
  async function loadProject(id: string, options: OperationOptions = {}): Promise<LoadedFonciereProject> {
    const project = await readProject(id, options), saved = payload(project.payload), assets = await listAssets(id, options);
    const link = await guarded(options.signal, () => client.from("fonciere_project_contacts").select("contact_id,agency_contact_id").eq("project_id", id).maybeSingle()); failure(link.error);
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
      if (!cache.has(ref)) cache.set(ref, await blobData(await downloadAsset(asset, options), options));
      return cache.get(ref)!;
    }
    for (const role of PHOTO_ROLES) data.presentationData.photos[role] = await hydrate(data.presentationData.photos[role], empty.photos[role]);
    for (const photo of data.presentationData.importGallery) photo.data = await hydrate(photo.data, empty.photos.main);
    for (const ref of saved.sourceDocuments) if (!assets.some(asset => asset.id === ref && asset.project_id === id && ["pdf", "attachment"].includes(asset.kind))) throw new Error("Un document source est inaccessible. La fiche n’a pas été chargée partiellement.");
    return { project, data: validateFonciereData(data), assets, sourceDocuments: [...saved.sourceDocuments] };
  }
  async function uploadAsset(project: FonciereProjectRecord, file: Blob, kind: FonciereAssetRecord["kind"], name: string, options: OperationOptions): Promise<FonciereAssetRecord> {
    if (kind === "attachment" && file.type === "image/webp") {
      const header = new TextDecoder().decode(await guarded(options.signal, () => file.slice(0, 12).arrayBuffer()));
      if (file.size <= 0 || file.size > LIMITS.fileBytes || header.slice(0, 4) !== "RIFF" || header.slice(8, 12) !== "WEBP") throw new Error("Le contenu du fichier WebP est invalide.");
    } else await guarded(options.signal, () => validateUploadBlob(file, kind === "attachment" ? "photo" : kind));
    const safeName = name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 180) || "document";
    const registered = await guarded(options.signal, () => client.rpc("fonciere_register_asset", { p_project: project.id, p_revision: project.revision, p_kind: kind, p_size: file.size, p_mime: file.type, p_name: safeName })); failure(registered.error);
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
    return { revision: snapshot.revision, contacts: snapshot.collections.contacts.map(contactOption) };
  }
  return {
    async listProjects(options: OperationOptions = {}): Promise<FonciereProjectRecord[]> {
      const result = await guarded(options.signal, () => client.from("fonciere_projects").select("*").order("updated_at", { ascending: false })); failure(result.error); return result.data || [];
    },
    loadProject, listAssets, downloadAsset,
    async saveProject(input: { data: FonciereData; previous?: LoadedFonciereProject; sourceFiles?: File[]; onCreated?: (draft: LoadedFonciereProject) => void }, options: OperationOptions = {}): Promise<LoadedFonciereProject> {
      const data = validateFonciereData(input.data), persisted = structuredClone(data), empty = createProjectData();
      // Contact identity has a separate Contacts-protected projection in SQL.
      delete (persisted as Partial<FonciereData>).agentContactId;
      delete (persisted as Partial<FonciereData>).agencyContactId;
      const before = input.previous, old = before ? payload(before.project.payload) : null, reuse = new Map<string, string>();
      if (old && before) {
        for (const role of PHOTO_ROLES) if (old.data.presentationData.photos[role]) reuse.set(before.data.presentationData.photos[role], old.data.presentationData.photos[role]);
        old.data.presentationData.importGallery.forEach((photo, index) => { if (before.data.presentationData.importGallery[index]) reuse.set(before.data.presentationData.importGallery[index].data, photo.data); });
      }
      let project = before?.project;
      if (!project) {
        const initial = structuredClone(persisted); initial.presentationData.photos = { main: "", view: "", inside: "", operation: "" }; initial.presentationData.importGallery = []; initial.presentationData.photoGalleryRoles = {};
        const created = await guarded(options.signal, () => client.rpc("fonciere_save_project", { p_id: null, p_expected_revision: null, p_payload: { schema: FONCIERE_SCHEMA, data: initial, sourceDocuments: [] }, p_contact: data.agentContactId, p_agency_contact: data.agencyContactId })); failure(created.error);
        project = await readProject(String(created.data), options);
        // Surface the confirmed identity before any fallible byte transfer. The
        // editor retains it on failure so retry cannot create a second property.
        input.onCreated?.(await loadProject(project.id, options));
      }
      const target = project, uploaded = new Map<string, string>();
      async function persistPhoto(value: string, fallback: string, name: string) {
        if (value === fallback) return "";
        if (reuse.has(value)) return reuse.get(value)!;
        if (!uploaded.has(value)) uploaded.set(value, (await uploadAsset(target, photoDataToBlob(value), "photo", name, options)).id);
        return uploaded.get(value)!;
      }
      for (const role of PHOTO_ROLES) persisted.presentationData.photos[role] = await persistPhoto(data.presentationData.photos[role], empty.photos[role], `${role}.jpg`);
      for (let index = 0; index < data.presentationData.importGallery.length; index++) persisted.presentationData.importGallery[index].data = await persistPhoto(data.presentationData.importGallery[index].data, "", `photo-${index + 1}.jpg`);
      const sourceDocuments = [...(before?.sourceDocuments || [])];
      if (sourceDocuments.length + (input.sourceFiles?.length || 0) > FONCIERE_DOCUMENT_LIMIT) throw new Error("Trente documents sources maximum par projet.");
      for (const file of input.sourceFiles || []) sourceDocuments.push((await uploadAsset(target, file, file.type === "application/pdf" ? "pdf" : "attachment", file.name, options)).id);
      const value: StoredFoncierePayload = { schema: FONCIERE_SCHEMA, data: persisted, sourceDocuments };
      if (new TextEncoder().encode(JSON.stringify(value)).length > 950000) throw new Error("Métadonnées du projet trop volumineuses. Votre saisie est conservée.");
      options.onProgress?.({ stage: "save", completed: 0, total: 1, label: "Enregistrement du projet" });
      const saved = await guarded(options.signal, () => client.rpc("fonciere_save_project", { p_id: target.id, p_expected_revision: target.revision, p_payload: value, p_contact: data.agentContactId, p_agency_contact: data.agencyContactId })); failure(saved.error);
      const confirmed = await readProject(target.id, options);
      if (confirmed.revision !== target.revision + 1) throw new FonciereConflictError();
      options.onProgress?.({ stage: "save", completed: 1, total: 1, label: "Projet enregistré" });
      return { project: confirmed, data, assets: await listAssets(target.id, options), sourceDocuments };
    },
    async archiveProject(project: FonciereProjectRecord, archived: boolean, options: OperationOptions = {}): Promise<FonciereProjectRecord> {
      const result = await guarded(options.signal, () => client.rpc("fonciere_archive_project", { p_id: project.id, p_expected_revision: project.revision, p_archived: archived })); failure(result.error);
      const confirmed = await readProject(project.id, options); if (confirmed.revision !== Number(result.data)) throw new FonciereConflictError(); return confirmed;
    },
    async searchContacts(query: string, options: OperationOptions = {}): Promise<ContactOption[]> {
      const rows = (await contacts(options)).contacts;
      return rows.filter(row => matchesProjectContact(row, query.trim())).slice(0, 50);
    },
    async readContact(id: string, options: OperationOptions = {}): Promise<ContactOption | null> {
      if (!id || id.length > 180) return null;
      return (await contacts(options)).contacts.find(row => row.id === id) || null;
    },
    async createContact(input: ContactCreateInput, options: OperationOptions = {}): Promise<ContactOption> {
      const name = input.name.trim(), companyName = input.companyName.trim(), entityType = input.entityType === "company" ? "company" : "person";
      if (entityType === "company" ? !companyName : !name) throw new Error(entityType === "company" ? "Le nom de l’entreprise est obligatoire." : "Le nom du contact est obligatoire.");
      const snapshot = await contacts(options);
      if (duplicateProjectContacts(snapshot.contacts, input).length) throw new Error("Un contact possède déjà cette identité ou ces coordonnées. Sélectionnez-le dans les résultats de recherche.");
      const id = crypto.randomUUID(), patch = { entityType, name, firstName: input.firstName || "", companyName, email: input.email || "", phone: input.phone || "", city: input.city || "", postalAddress: input.postalAddress || "", kind: "Prestataire", supplierCategory: "Agence immobilière" };
      const result = await guarded(options.signal, () => client.rpc("crm_mutate_record", { p_module: "contacts", p_collection: "contacts", p_id: id, p_patch: patch, p_revision: snapshot.revision, p_delete: false })); failure(result.error);
      const row = (result.data as { collections?: { contacts?: Record<string, unknown>[] } })?.collections?.contacts?.find(row => row.id === id);
      if (!row) throw new Error("La création du contact n’a pas été confirmée."); return contactOption(row);
    },
  };
}
