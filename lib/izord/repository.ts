import type { SupabaseClient } from "@supabase/supabase-js";
import { createProjectData, LIMITS, PHOTO_ROLES, validateProjectData, type ProjectData } from "./model";
import { assertImageByteBudget, assertEncodedImageBudget, encodedJpegLength, type ImageByteEntry } from "./image-budget";

export type ProjectStatus = "draft" | "review" | "approved";
export type ProjectRecord = { id: string; owner_id: string; title: string; revision: number; status: ProjectStatus; created_at: string; updated_at: string; payload: unknown; author_id?: string };
export type VersionRecord = { project_id: string; revision: number; title: string; status: ProjectStatus; author_id: string; created_at: string };
export type AssetRecord = { id: string; project_id: string; project_revision: number; object_path: string; kind: "pdf" | "photo" | "presentation"; lifecycle: "pending" | "finalized" | "withdrawn"; reader_download: boolean; created_by: string; created_at: string; expected_size: number | null; expected_mime: string | null; original_name: string | null };
type StoredPayload = { schema: "IZORD_GENERATOR_V1"; data: ProjectData; sourceDocuments: string[] };
export type LoadedProject = { project: ProjectRecord; data: ProjectData; assets: AssetRecord[]; sourceDocuments: string[] };
export type TransferProgress = { stage: "upload" | "save"; completed: number; total: number; label: string };
export type OperationOptions = { signal?: AbortSignal; onProgress?: (progress: TransferProgress) => void };
export class GeneratorConflictError extends Error { constructor() { super("Une version plus récente existe. Vos modifications locales sont conservées : exportez-les avant de recharger et rapprocher les changements."); this.name = "GeneratorConflictError"; } }
const bucket = "izord-documents";
const pptMime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function abortIfNeeded(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("Opération interrompue.", "AbortError"); }
/** Stop every continuation when the access lease closes. A request already sent
 * may still commit on the server; this guard never claims to roll it back. */
async function guarded<T>(signal: AbortSignal | undefined, operation: () => PromiseLike<T>): Promise<T> {
  abortIfNeeded(signal);
  try { return await operation(); }
  finally { abortIfNeeded(signal); }
}
function failure(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code === "40001") throw new GeneratorConflictError();
  // Never expose a signed URL, token or backend response body in UI/error logs.
  if (error.code === "42501") throw new Error("Opération refusée : droits ou révision du dossier modifiés.");
  throw new Error("L’opération n’a pas été confirmée par le serveur. Conservez votre brouillon et réessayez après vérification.");
}
function stored(payload: unknown): StoredPayload | null {
  if (!payload || typeof payload !== "object" || (payload as { schema?: string }).schema !== "IZORD_GENERATOR_V1") return null;
  const value = payload as StoredPayload;
  if (!value.data || typeof value.data !== "object" || !Array.isArray(value.data.importGallery) || !Array.isArray(value.sourceDocuments)) throw new Error("Version de dossier invalide.");
  return value;
}
export function photoDataToBlob(value: string): Blob {
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("Photographie JPEG incorporée attendue.");
  const decoded = atob(value.slice(value.indexOf(",") + 1));
  if (decoded.length > LIMITS.fileBytes) throw new Error("Photographie trop volumineuse.");
  return new Blob([Uint8Array.from(decoded, char => char.charCodeAt(0))], { type: "image/jpeg" });
}
async function blobToData(blob: Blob, signal?: AbortSignal): Promise<string> {
  const bytes = new Uint8Array(await guarded(signal, () => blob.arrayBuffer()));
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}`;
}
export async function validateUploadBlob(blob: Blob, kind: AssetRecord["kind"]): Promise<void> {
  if (blob.size <= 0 || blob.size > LIMITS.fileBytes) throw new Error("Le fichier doit contenir entre 1 octet et 25 Mo.");
  const header = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
  const starts = (...bytes: number[]) => bytes.every((byte, index) => header[index] === byte);
  const valid = kind === "pdf" ? blob.type === "application/pdf" && new TextDecoder().decode(header).includes("%PDF-")
    : kind === "photo" ? (blob.type === "image/jpeg" && starts(255, 216, 255)) || (blob.type === "image/png" && starts(137, 80, 78, 71, 13, 10, 26, 10))
      : blob.type === pptMime && starts(80, 75, 3, 4);
  if (!valid) throw new Error("Le contenu du fichier ne correspond pas au type autorisé.");
}

/** Direct Storage upload: no application/Vercel byte proxy and no upsert.
 * The capability URL is kept only in this call, never returned or logged.
 * An interrupted transfer is explicitly abandoned; retry obtains a new identity.
 */
async function uploadSignedBlob(url: string, blob: Blob, options: OperationOptions, label: string) {
  abortIfNeeded(options.signal);
  const body = new FormData(); body.append("cacheControl", "0"); body.append("", blob);
  if (typeof XMLHttpRequest === "undefined") {
    const response = await guarded(options.signal, () => fetch(url, { method: "PUT", body, headers: { "x-upsert": "false" }, signal: options.signal }));
    if (!response.ok) throw new Error("Le transfert Storage a échoué.");
    options.onProgress?.({ stage: "upload", completed: blob.size, total: blob.size, label }); abortIfNeeded(options.signal); return;
  }
  await guarded(options.signal, () => new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = (error?: Error) => { options.signal?.removeEventListener("abort", abort); if (error) reject(error); else resolve(); };
    xhr.open("PUT", url); xhr.setRequestHeader("x-upsert", "false"); xhr.timeout = 120000;
    xhr.upload.onprogress = event => { if (!options.signal?.aborted && event.lengthComputable) options.onProgress?.({ stage: "upload", completed: Math.min(blob.size, Math.round(blob.size * event.loaded / event.total)), total: blob.size, label }); };
    xhr.onload = () => finish(xhr.status >= 200 && xhr.status < 300 ? undefined : new Error("Le transfert Storage a échoué."));
    xhr.onerror = () => finish(new Error("Le transfert Storage a été interrompu."));
    xhr.ontimeout = () => finish(new Error("Le transfert Storage a dépassé deux minutes."));
    xhr.onabort = () => finish(new DOMException("Transfert interrompu.", "AbortError"));
    options.signal?.addEventListener("abort", abort, { once: true }); xhr.send(body);
  }));
}

export function createGeneratorRepository(client: SupabaseClient) {
  const store = client.storage.from(bucket);
  async function actor(signal?: AbortSignal) {
    abortIfNeeded(signal);
    const { data, error } = await guarded(signal, () => client.auth.getUser()); failure(error);
    if (!data.user) throw new Error("Connexion requise."); abortIfNeeded(signal); return data.user.id;
  }
  async function sameActor(id: string, signal?: AbortSignal) {
    abortIfNeeded(signal);
    const { data } = await guarded(signal, () => client.auth.getSession());
    if (data.session?.user.id !== id) throw new DOMException("Le compte a changé.", "AbortError");
    abortIfNeeded(signal);
  }
  async function listAssets(projectId: string, options: OperationOptions = {}): Promise<AssetRecord[]> {
    const { data, error } = await guarded(options.signal, () => client.from("izord_assets").select("*").eq("project_id", projectId).order("created_at", { ascending: false }));
    failure(error); return data || [];
  }
  async function listVersions(projectId: string, options: OperationOptions = {}): Promise<VersionRecord[]> {
    const { data, error } = await guarded(options.signal, () => client.from("izord_project_versions").select("project_id,revision,title,status,author_id,created_at").eq("project_id", projectId).order("revision", { ascending: false }));
    failure(error); return data || [];
  }
  async function readProject(id: string, options: OperationOptions = {}): Promise<ProjectRecord> {
    const { data, error } = await guarded(options.signal, () => client.from("izord_projects").select("*").eq("id", id).single()); failure(error);
    if (!data) throw new Error("Dossier inaccessible.");
    const versions = await guarded(options.signal, () => listVersions(id, options)); return { ...data, author_id: versions.find(version => version.revision === data.revision)?.author_id };
  }
  async function downloadAsset(asset: AssetRecord, options: OperationOptions = {}): Promise<Blob> {
    const who = await guarded(options.signal, () => actor(options.signal));
    const { data, error } = await guarded(options.signal, () => store.download(asset.object_path)); failure(error); await guarded(options.signal, () => sameActor(who, options.signal));
    if (!data || data.size <= 0 || data.size > LIMITS.fileBytes) throw new Error("Document reçu invalide ou trop volumineux.");
    return data;
  }
  async function loadProject(id: string, options: OperationOptions & { hydratePhotos?: boolean } = {}): Promise<LoadedProject> {
    const who = await guarded(options.signal, () => actor(options.signal)), project = await guarded(options.signal, () => readProject(id, options)), assets = await guarded(options.signal, () => listAssets(id, options)), payload = stored(project.payload);
    await guarded(options.signal, () => sameActor(who, options.signal));
    if (!payload) return { project, data: createProjectData(), assets, sourceDocuments: [] };
    if (payload.data.importGallery.length > LIMITS.galleryPhotos || !payload.data.photos || typeof payload.data.photos !== "object") throw new Error("Photothèque distante invalide ou trop volumineuse.");
    const references = [...PHOTO_ROLES.map(role => payload.data.photos[role]), ...payload.data.importGallery.map(photo => photo.data)].filter(Boolean);
    if (options.hydratePhotos !== false) {
      const declared = references.map(reference => ({ id: reference, bytes: assets.find(asset => asset.id === reference)?.expected_size || 0 }));
      assertImageByteBudget(declared); assertEncodedImageBudget(declared.map(item => encodedJpegLength(item.bytes)));
    }
    const data = structuredClone(payload.data), empty = createProjectData(), resolved = new Map<string, string>();
    const received: ImageByteEntry[] = [];
    async function hydrate(reference: string, fallback: string): Promise<string> {
      if (!reference || options.hydratePhotos === false) return fallback;
      if (!uuid.test(reference)) throw new Error("Référence photographique invalide.");
      const asset = assets.find(item => item.id === reference && item.project_id === id && item.kind === "photo" && item.lifecycle === "finalized");
      if (!asset) throw new Error("Une photographie n’est plus disponible pour ce compte. Le dossier n’a pas été chargé partiellement.");
      if (!resolved.has(reference)) {
        const blob = await guarded(options.signal, () => downloadAsset(asset, options));
        received.push({ id: reference, bytes: blob.size }); assertImageByteBudget(received);
        assertEncodedImageBudget(references.map(id => encodedJpegLength(received.find(item => item.id === id)?.bytes || 0)));
        resolved.set(reference, await guarded(options.signal, () => blobToData(blob, options.signal)));
      }
      return resolved.get(reference)!;
    }
    for (const role of PHOTO_ROLES) data.photos[role] = await guarded(options.signal, () => hydrate(data.photos[role], empty.photos[role]));
    if (options.hydratePhotos === false) { data.importGallery = []; data.photoGalleryRoles = {}; }
    else for (const photo of data.importGallery) photo.data = await guarded(options.signal, () => hydrate(photo.data, empty.photos.main));
    await guarded(options.signal, () => sameActor(who, options.signal));
    return { project, data: validateProjectData(data), assets, sourceDocuments: [...payload.sourceDocuments] };
  }
  async function uploadAsset(project: ProjectRecord, blob: Blob, kind: AssetRecord["kind"], name: string, options: OperationOptions): Promise<AssetRecord> {
    const who = await guarded(options.signal, () => actor(options.signal)); await guarded(options.signal, () => validateUploadBlob(blob, kind)); await guarded(options.signal, () => sameActor(who, options.signal));
    const safeName = name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 180) || "document";
    const registered = await guarded(options.signal, () => client.rpc("izord_register_generator_asset", { p_project: project.id, p_revision: project.revision, p_kind: kind, p_size: blob.size, p_mime: blob.type, p_name: safeName }));
    failure(registered.error); const path = String(registered.data), id = path.split("/")[1];
    if (path !== `${project.id}/${id}` || !uuid.test(id)) throw new Error("Identité de transfert invalide.");
    await guarded(options.signal, () => sameActor(who, options.signal));
    const signed = await guarded(options.signal, () => store.createSignedUploadUrl(path, { upsert: false })); failure(signed.error);
    if (!signed.data) throw new Error("Le transfert n’a pas été autorisé.");
    await guarded(options.signal, () => sameActor(who, options.signal));
    const signedUrl = signed.data.signedUrl;
    await guarded(options.signal, () => uploadSignedBlob(signedUrl, blob, options, name)); await guarded(options.signal, () => sameActor(who, options.signal));
    const finalized = await guarded(options.signal, () => client.rpc("izord_finalize_asset", { p_asset: id })); failure(finalized.error); await guarded(options.signal, () => sameActor(who, options.signal));
    const asset = (await guarded(options.signal, () => listAssets(project.id, options))).find(item => item.id === id && item.lifecycle === "finalized");
    if (!asset) throw new Error("La finalisation du document n’a pas été confirmée."); return asset;
  }
  return {
    async listProjects(options: OperationOptions = {}): Promise<ProjectRecord[]> {
      const { data, error } = await guarded(options.signal, () => client.from("izord_projects").select("*").order("updated_at", { ascending: false })); failure(error);
      const rows: ProjectRecord[] = data || [];
      if (!rows.length) return rows;
      const versions = await guarded(options.signal, () => client.from("izord_project_versions").select("project_id,revision,author_id").in("project_id", rows.map(row => row.id))); failure(versions.error);
      return rows.map(row => ({ ...row, author_id: versions.data?.find(version => version.project_id === row.id && version.revision === row.revision)?.author_id }));
    },
    async createProject(title: string, options: OperationOptions = {}): Promise<ProjectRecord> {
      const created = await guarded(options.signal, () => client.rpc("izord_create_project", { p_title: title.trim() || "Nouveau projet" })); failure(created.error); return guarded(options.signal, () => readProject(String(created.data), options));
    },
    listAssets, listVersions, loadProject, downloadAsset,
    async saveProject(input: { project: ProjectRecord; data: ProjectData; previous?: LoadedProject; status?: ProjectStatus; sourceFiles?: File[] }, options: OperationOptions = {}): Promise<LoadedProject> {
      const who = await guarded(options.signal, () => actor(options.signal)), data = validateProjectData(input.data), empty = createProjectData(), persisted = structuredClone(data);
      const before = input.previous?.project.id === input.project.id ? input.previous : undefined, old = stored(before?.project.payload), reusable = new Map<string, string>();
      if (old && before) {
        for (const role of PHOTO_ROLES) if (old.data.photos[role]) reusable.set(before.data.photos[role], old.data.photos[role]);
        old.data.importGallery.forEach((photo, index) => { if (before.data.importGallery[index]) reusable.set(before.data.importGallery[index].data, photo.data); });
      }
      const uploaded = new Map<string, string>();
      async function persistPhoto(value: string, fallback: string, name: string) {
        if (value === fallback) return "";
        if (reusable.has(value)) return reusable.get(value)!;
        if (!uploaded.has(value)) uploaded.set(value, (await guarded(options.signal, () => uploadAsset(input.project, photoDataToBlob(value), "photo", name, options))).id);
        await guarded(options.signal, () => sameActor(who, options.signal)); return uploaded.get(value)!;
      }
      for (const role of PHOTO_ROLES) persisted.photos[role] = await guarded(options.signal, () => persistPhoto(data.photos[role], empty.photos[role], `${role}.jpg`));
      for (let i = 0; i < data.importGallery.length; i++) persisted.importGallery[i].data = await guarded(options.signal, () => persistPhoto(data.importGallery[i].data, "", `galerie-${i + 1}.jpg`));
      const sourceDocuments = [...(before?.sourceDocuments || [])];
      if (sourceDocuments.length + (input.sourceFiles?.length || 0) > LIMITS.pdfFiles) throw new Error("Six documents PDF sources maximum par version.");
      for (const file of input.sourceFiles || []) sourceDocuments.push((await guarded(options.signal, () => uploadAsset(input.project, file, "pdf", file.name, options))).id);
      const payload: StoredPayload = { schema: "IZORD_GENERATOR_V1", data: persisted, sourceDocuments };
      if (new TextEncoder().encode(JSON.stringify(payload)).length > 950000) throw new Error("Métadonnées du dossier trop volumineuses ; aucun enregistrement confirmé.");
      await guarded(options.signal, () => sameActor(who, options.signal)); options.onProgress?.({ stage: "save", completed: 0, total: 1, label: "Enregistrement de la révision" });
      const saved = await guarded(options.signal, () => client.rpc("izord_save_generator", { p_id: input.project.id, p_expected_revision: input.project.revision, p_title: data.state.project.trim() || input.project.title, p_payload: payload, p_status: input.status || input.project.status }));
      failure(saved.error); await guarded(options.signal, () => sameActor(who, options.signal));
      const project = await guarded(options.signal, () => readProject(input.project.id, options)); await guarded(options.signal, () => sameActor(who, options.signal));
      // Another author may already have saved again. Never label our local draft
      // as the newer returned revision: keep the exact acknowledged revision.
      const exact = Number(saved.data);
      if (project.revision !== exact) throw new GeneratorConflictError();
      const result: LoadedProject = { project: { ...project, revision: exact, payload, title: data.state.project.trim() || input.project.title, status: input.status || input.project.status, author_id: who }, data, assets: await guarded(options.signal, () => listAssets(input.project.id, options)), sourceDocuments };
      await guarded(options.signal, () => sameActor(who, options.signal)); options.onProgress?.({ stage: "save", completed: 1, total: 1, label: "Révision confirmée" }); abortIfNeeded(options.signal); return result;
    },
    uploadPresentation(project: ProjectRecord, blob: Blob, options: OperationOptions = {}) { return uploadAsset(project, blob, "presentation", `presentation-r${project.revision}.pptx`, options); },
    async abandonAsset(id: string, options: OperationOptions = {}) { const result = await guarded(options.signal, () => client.rpc("izord_withdraw_asset", { p_asset: id })); failure(result.error); },
    async setReaderDownload(id: string, allowed: boolean, options: OperationOptions = {}) { const result = await guarded(options.signal, () => client.rpc("izord_allow_reader_download", { p_asset: id, p_allowed: allowed })); failure(result.error); }
  };
}
