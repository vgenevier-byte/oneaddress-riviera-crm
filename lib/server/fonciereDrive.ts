import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createGoogleDriveFetch, DriveRouteError, getSharedDriveId } from "../../app/api/drive/_utils";

export type FonciereDriveFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type DriveCategory = "agency" | "plans" | "photos" | "other";
export const FONCIERE_DRIVE_CATEGORIES: Record<DriveCategory, string> = { agency: "01 - Documents agence", plans: "02 - Plans", photos: "03 - Photos", other: "04 - Autres documents" };
const FILES = "https://www.googleapis.com/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";
const FIELDS = "id,name,mimeType,driveId,parents,trashed,appProperties,size,md5Checksum,capabilities(canAddChildren,canListChildren,canEdit)";
const MAX_BYTES = 25 * 1024 * 1024;
const SUPPORTED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
export type DriveMetadata = { id: string; name: string; mimeType: string; driveId: string; parents?: string[]; trashed: boolean; appProperties?: Record<string, string>; size?: string; md5Checksum?: string; capabilities?: { canAddChildren?: boolean; canListChildren?: boolean; canEdit?: boolean } };
export type DriveConfig = { enabled: boolean; shared_drive_id: string | null; root_folder_id: string | null; root_parent_id?: string | null; reserved_root_id?: string | null };
export type DriveJob = { id: string; project_id: string; asset_id: string | null; job_type: "folder" | "file"; title: string; project_reference: string; category: DriveCategory; expected_size: number; expected_mime: string; object_path: string; original_name: string; storage_object_version: string; reserved_file_id: string | null; attempts: number; lease_token: string };
type FolderReservation = { claimed?: boolean; drive_folder_id: string | null; parent_drive_folder_id?: string; parent_id?: string; status: "creating" | "ready"; title?: string; project_reference?: string };
export interface FonciereDriveStore {
  call<T = unknown>(operation: string, data?: Record<string, unknown>): Promise<T>;
  original(job: DriveJob): Promise<Blob>;
}
export class FonciereDriveError extends Error {
  constructor(public code: string, public permanent = false) { super(code); }
}
function fail(code: string, permanent = false): never { throw new FonciereDriveError(code, permanent); }
async function checked(response: Response, code: string) {
  if (response.ok) return response;
  if (response.status === 403) {
    // Drive reports quota throttling as 403 as well as 429. Only its structured
    // reasons distinguish retryable throttling from actual permission failures.
    const body = await response.clone().json().catch(() => null);
    const errors = body?.error?.errors;
    const reasons: unknown[] = Array.isArray(errors) ? errors.map((entry: { reason?: unknown } | null) => entry?.reason) : [];
    if (reasons.length && reasons.every(reason => reason === "rateLimitExceeded" || reason === "userRateLimitExceeded")) fail("drive_rate_limited");
    fail("drive_access_denied", true);
  }
  if (response.status === 429) fail("drive_rate_limited");
  fail(response.status === 401 ? "drive_access_denied" : code, response.status === 401 || response.status === 400);
}
async function read(fetchDrive: FonciereDriveFetch, id: string): Promise<DriveMetadata | null> {
  const response = await fetchDrive(`${FILES}/${encodeURIComponent(id)}?supportsAllDrives=true&fields=${FIELDS}`, { cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (response.status === 404) return null;
  await checked(response, "drive_metadata_unavailable");
  return await response.json();
}
export async function reserveDriveId(fetchDrive: FonciereDriveFetch) {
  const response = await checked(await fetchDrive(`${FILES}/generateIds?count=1&space=drive&type=files`, { cache: "no-store", signal: AbortSignal.timeout(12000) }), "drive_id_unavailable");
  const id = (await response.json()).ids?.[0];
  if (typeof id !== "string" || !/^[\w-]{1,180}$/.test(id)) fail("drive_id_invalid", true);
  return id as string;
}
function assertFolder(metadata: DriveMetadata | null, driveId: string, parentId?: string, properties?: Record<string, string>, expectedId?: string): asserts metadata is DriveMetadata {
  if (!metadata) fail("managed_folder_missing_or_inaccessible", true);
  if ((expectedId && metadata.id !== expectedId) || metadata.mimeType !== FOLDER || metadata.driveId !== driveId || metadata.trashed !== false || (parentId && (metadata.parents?.length !== 1 || metadata.parents[0] !== parentId)) || (properties && Object.entries(properties).some(([key, value]) => metadata.appProperties?.[key] !== value))) fail("managed_folder_changed", true);
  if (metadata.capabilities?.canAddChildren !== true || metadata.capabilities?.canListChildren !== true) fail("drive_folder_write_denied", true);
}
export async function validateProjetsRoot(fetchDrive: FonciereDriveFetch, configuration: DriveConfig) {
  if (!configuration.enabled || !configuration.root_folder_id || !configuration.shared_drive_id) fail("drive_not_configured", true);
  const folder = await read(fetchDrive, configuration.root_folder_id);
  assertFolder(folder, configuration.shared_drive_id, configuration.root_parent_id || undefined, undefined, configuration.root_folder_id);
  let cursor = folder;
  const seen = new Set<string>();
  while (cursor.id !== configuration.shared_drive_id) {
    if (seen.has(cursor.id) || seen.size > 30 || cursor.parents?.length !== 1) fail("drive_root_ancestry_invalid", true);
    seen.add(cursor.id);
    const parent = await read(fetchDrive, cursor.parents[0]);
    if (!parent || parent.driveId !== configuration.shared_drive_id || parent.trashed !== false || parent.mimeType !== FOLDER) fail("drive_root_ancestry_unavailable", true);
    cursor = parent;
  }
  return folder;
}
export async function discoverProjetsRoot(fetchDrive: FonciereDriveFetch, sharedDriveId: string) {
  const root = await read(fetchDrive, sharedDriveId);
  assertFolder(root, sharedDriveId, undefined, undefined, sharedDriveId);
  const candidates: DriveMetadata[] = [];
  let pageToken = "";
  do {
    // Drive's name contains operator matches prefixes, so it cannot establish
    // absence after a numeric prefix is added. Filter complete folder pages.
    const params = new URLSearchParams({ q: `mimeType = '${FOLDER}' and trashed = false`, corpora: "drive", driveId: sharedDriveId, includeItemsFromAllDrives: "true", supportsAllDrives: "true", spaces: "drive", pageSize: "100", fields: `nextPageToken,incompleteSearch,files(${FIELDS})` });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await checked(await fetchDrive(`${FILES}?${params}`, { cache: "no-store", signal: AbortSignal.timeout(12000) }), "drive_root_search_failed");
    const body = await response.json();
    if (!Array.isArray(body.files) || body.incompleteSearch === true) fail("drive_root_search_incomplete", true);
    for (const candidate of body.files) {
      if (typeof candidate?.name !== "string" || !/^(?:\d+\s*[-–—.]\s*)?Projets$/i.test(candidate.name)) continue;
      assertFolder(candidate, sharedDriveId);
      await validateProjetsRoot(fetchDrive, { enabled: true, shared_drive_id: sharedDriveId, root_folder_id: candidate.id, root_parent_id: candidate.parents?.[0] });
      candidates.push(candidate);
    }
    pageToken = body.nextPageToken || "";
  } while (pageToken);
  return { sharedDriveId, root, candidates, absenceEstablished: candidates.length === 0 };
}
async function createFolder(fetchDrive: FonciereDriveFetch, id: string, name: string, parentId: string, properties: Record<string, string>) {
  let response: Response | undefined;
  try {
    response = await fetchDrive(`${FILES}?supportsAllDrives=true&fields=id`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, name, mimeType: FOLDER, parents: [parentId], appProperties: properties }), signal: AbortSignal.timeout(15000) });
  } catch { /* Ambiguous creation: caller confirms only the persisted ID. */ }
  if (response && !response.ok && response.status !== 409) await checked(response, "drive_folder_create_failed");
  return read(fetchDrive, id);
}
/** Complete discovery establishes absence. Root reservation commits before POST. */
export async function configureProjetsRoot(store: FonciereDriveStore, fetchDrive: FonciereDriveFetch, sharedDriveId: string) {
  const current = await store.call<DriveConfig>("get_config");
  if (current.root_folder_id) {
    if (current.shared_drive_id !== sharedDriveId) fail("drive_configuration_conflict", true);
    await validateProjetsRoot(fetchDrive, { ...current, enabled: true });
    return store.call<DriveConfig>("configure", { shared_drive_id: sharedDriveId, root_folder_id: current.root_folder_id, root_parent_id: current.root_parent_id, enabled: true });
  }
  const discovery = await discoverProjetsRoot(fetchDrive, sharedDriveId);
  if (discovery.candidates.length > 1) fail("drive_root_ambiguous", true);
  let folder = discovery.candidates[0];
  if (!folder) {
    const proposed = current.reserved_root_id || await reserveDriveId(fetchDrive);
    const reserved = await store.call<DriveConfig>("root_reserve", { folder_id: proposed, shared_drive_id: sharedDriveId });
    const id = reserved.reserved_root_id;
    if (!id) fail("drive_root_reservation_failed");
    folder = await read(fetchDrive, id) || await createFolder(fetchDrive, id, "Projets", sharedDriveId, { managedBy: "oar-fonciere", folderKind: "projects-root" }) || fail("drive_root_creation_unconfirmed");
    assertFolder(folder, sharedDriveId, sharedDriveId, { managedBy: "oar-fonciere", folderKind: "projects-root" }, id);
  }
  return store.call<DriveConfig>("configure", { shared_drive_id: sharedDriveId, root_folder_id: folder.id, root_parent_id: folder.parents?.[0] || sharedDriveId, enabled: true });
}
async function resolveFolder(store: FonciereDriveStore, fetchDrive: FonciereDriveFetch, config: DriveConfig, job: DriveJob, category: "project" | DriveCategory, parentId: string, name: string) {
  const args = { project_id: job.project_id, category, lease_token: job.lease_token, parent_id: parentId };
  const reservation = await store.call<FolderReservation>("folder_claim", args);
  if (!reservation || !["creating", "ready"].includes(reservation.status) || (reservation.parent_drive_folder_id || reservation.parent_id) !== parentId) fail("drive_folder_reservation_invalid", true);
  if (!reservation.claimed) fail("drive_folder_busy");
  if (category === "project" && reservation.project_reference && typeof reservation.title === "string") name = `${reservation.project_reference} - ${reservation.title}`;
  const properties = { managedBy: "oar-fonciere", projectId: job.project_id, folderKind: category };
  let id = reservation.drive_folder_id;
  let folder: DriveMetadata | null = id ? await read(fetchDrive, id) : null;
  if (reservation.status === "ready") assertFolder(folder, config.shared_drive_id!, parentId, properties, id!);
  if (!id) {
    const saved = await store.call<FolderReservation>("folder_reserve", { ...args, folder_id: await reserveDriveId(fetchDrive) });
    if (!saved?.drive_folder_id) fail("drive_folder_lease_lost");
    id = saved.drive_folder_id;
    folder = await read(fetchDrive, id);
  }
  if (!folder) folder = await createFolder(fetchDrive, id, name, parentId, properties);
  // An unconfirmed creation can be absent after a lost request. Keep the saved
  // reservation retryable; only a formerly ready folder requires intervention.
  if (!folder) fail("drive_folder_creation_unconfirmed");
  assertFolder(folder, config.shared_drive_id!, parentId, properties, id);
  if (folder.name !== name) {
    const renamed = await fetchDrive(`${FILES}/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }), signal: AbortSignal.timeout(12000) });
    await checked(renamed, "drive_folder_rename_failed");
    const confirmed = await read(fetchDrive, id);
    assertFolder(confirmed, config.shared_drive_id!, parentId, properties, id);
    if (confirmed.name !== name) fail("drive_folder_rename_unconfirmed");
  }
  if (!await store.call("folder_ready", { ...args, folder_id: id })) fail("drive_folder_lease_lost");
  return id;
}
function assertOriginal(job: DriveJob, original: Blob) {
  if (job.object_path !== `${job.project_id}/${job.asset_id}` || !job.storage_object_version || !SUPPORTED.includes(job.expected_mime) || !Number.isInteger(job.expected_size) || job.expected_size < 1 || job.expected_size > MAX_BYTES || original.size !== job.expected_size || original.type !== job.expected_mime) fail("crm_original_invalid", true);
}
function fileProperties(job: DriveJob) { return { managedBy: "oar-fonciere", projectId: job.project_id, assetId: job.asset_id!, storageVersion: job.storage_object_version }; }
function assertFile(metadata: DriveMetadata, job: DriveJob, parentId: string, driveId: string, checksum: string, id: string) {
  if (metadata.id !== id || metadata.driveId !== driveId || metadata.trashed !== false || metadata.parents?.length !== 1 || metadata.parents[0] !== parentId || metadata.mimeType !== job.expected_mime || Number(metadata.size) !== job.expected_size || metadata.md5Checksum !== checksum || Object.entries(fileProperties(job)).some(([key, value]) => metadata.appProperties?.[key] !== value)) fail("drive_file_identity_or_content_mismatch", true);
}
/** A lost upload response or process death recovers through GET of the same ID. */
export async function copyOriginalToDrive(fetchDrive: FonciereDriveFetch, job: DriveJob, original: Blob, parentId: string, driveId: string, id: string) {
  assertOriginal(job, original);
  const bytes = Buffer.from(await original.arrayBuffer());
  const checksum = createHash("md5").update(bytes).digest("hex");
  let confirmed = await read(fetchDrive, id);
  if (!confirmed) {
    const metadata = { id, name: job.original_name, mimeType: job.expected_mime, parents: [parentId], appProperties: fileProperties(job) };
    const initiation = await fetchDrive(`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id`, { method: "POST", headers: { "content-type": "application/json", "x-upload-content-type": job.expected_mime, "x-upload-content-length": String(bytes.length) }, body: JSON.stringify(metadata), signal: AbortSignal.timeout(15000) });
    if (initiation.status !== 409) {
      await checked(initiation, "drive_upload_start_failed");
      const location = initiation.headers.get("location");
      if (!location) fail("drive_upload_session_missing");
      const url = new URL(location);
      if (url.protocol !== "https:" || url.hostname !== "www.googleapis.com" || !url.pathname.startsWith("/upload/drive/")) fail("drive_upload_session_invalid", true);
      for (let offset = 0; offset < bytes.length; offset += 4 * 1024 * 1024) {
        const end = Math.min(bytes.length, offset + 4 * 1024 * 1024);
        let response: Response | undefined;
        try { response = await fetchDrive(location, { method: "PUT", headers: { "content-type": job.expected_mime, "content-length": String(end - offset), "content-range": `bytes ${offset}-${end - 1}/${bytes.length}` }, body: new Uint8Array(bytes.subarray(offset, end)), signal: AbortSignal.timeout(45000) }); }
        catch { confirmed = await read(fetchDrive, id); if (!confirmed) fail("drive_upload_unconfirmed"); break; }
        if (end < bytes.length && response.status !== 308) await checked(response, "drive_upload_failed");
        if (end === bytes.length && !response.ok) { confirmed = await read(fetchDrive, id); if (!confirmed) await checked(response, "drive_upload_failed"); }
      }
    }
    confirmed = confirmed || await read(fetchDrive, id);
  }
  if (!confirmed) fail("drive_upload_unconfirmed");
  assertFile(confirmed, job, parentId, driveId, checksum, id);
  return { id, checksum, size: bytes.length };
}
export async function processFonciereDriveJobs(store: FonciereDriveStore, fetchDrive: FonciereDriveFetch = createGoogleDriveFetch(), options: { maxJobs?: number; maxDurationMs?: number; now?: () => number } = {}) {
  const now = options.now || Date.now, deadline = now() + (options.maxDurationMs || 240000);
  const config = await store.call<DriveConfig>("get_config");
  if (!config.enabled || !config.root_folder_id) return { processed: 0, synced: 0, failed: 0, configured: false };
  if (config.shared_drive_id !== getSharedDriveId()) fail("drive_configuration_conflict", true);
  let processed = 0, synced = 0, failed = 0;
  while (processed < (options.maxJobs || 8) && now() < deadline) {
    const jobs = await store.call<DriveJob[]>("claim", { lease_token: randomUUID(), limit: 1 });
    if (!jobs?.length) break;
    const job = jobs[0];
    try {
      await validateProjetsRoot(fetchDrive, config);
      const projectFolder = await resolveFolder(store, fetchDrive, config, job, "project", config.root_folder_id!, `${job.project_reference} - ${job.title}`);
      const categories = {} as Record<DriveCategory, string>;
      for (const [category, name] of Object.entries(FONCIERE_DRIVE_CATEGORIES)) categories[category as DriveCategory] = await resolveFolder(store, fetchDrive, config, job, category as DriveCategory, projectFolder, name);
      let fileId: string | undefined;
      if (job.job_type === "file") {
        const proposed = job.reserved_file_id || await reserveDriveId(fetchDrive);
        const saved = await store.call<DriveJob>("reserve_file", { id: job.id, lease_token: job.lease_token, file_id: proposed });
        if (!saved?.reserved_file_id) fail("drive_file_lease_lost");
        fileId = saved.reserved_file_id;
        await copyOriginalToDrive(fetchDrive, job, await store.original(job), categories[job.category] || categories.other, config.shared_drive_id!, fileId);
      }
      if (!await store.call("complete", { id: job.id, lease_token: job.lease_token, file_id: fileId })) fail("drive_job_lease_lost");
      synced++;
    } catch (error) {
      const known = error instanceof FonciereDriveError ? error : new FonciereDriveError("drive_temporary_failure");
      try { await store.call("fail", { id: job.id, lease_token: job.lease_token, error: known.code, permanent: known.permanent }); }
      catch { /* A lost lease or unavailable registry cannot erase durable work.
               The current owner or expired-lease recovery will finish it. */ }
      failed++;
    }
    processed++;
  }
  return { processed, synced, failed, configured: true };
}
export function safeDriveError(error: unknown) {
  return error instanceof FonciereDriveError ? error.code : error instanceof DriveRouteError ? "drive_configuration_unavailable" : "drive_temporary_failure";
}
export const DRIVE_ERROR_MESSAGES: Record<string, string> = {
  drive_primary_not_verified: "L’original est conservé. Un administrateur doit vérifier sa copie Drive avant la bascule.",
  drive_rate_limited: "Google Drive limite temporairement le débit. La copie reprendra automatiquement avec temporisation.",
  drive_folder_creation_unconfirmed: "La création du dossier n’est pas encore confirmée. La copie reprendra automatiquement avec la même identité de dossier.",
  drive_not_configured: "La destination Google Drive doit être configurée par l’administrateur.",
  managed_folder_missing_or_inaccessible: "Le dossier géré est absent ou inaccessible. Faites vérifier son accès ou restaurer le même dossier avant de réessayer.",
  managed_folder_changed: "Le dossier géré a été déplacé, mis à la corbeille ou modifié. Faites rétablir son emplacement avant de réessayer.",
  drive_access_denied: "L’identité technique n’a plus accès à Google Drive. Un administrateur doit rétablir son accès.",
  drive_folder_write_denied: "L’identité technique ne peut pas ajouter de fichiers dans le dossier. Un administrateur doit vérifier ses droits.",
  drive_root_ambiguous: "Plusieurs dossiers Projets existent. L’administrateur doit confirmer la destination canonique.",
  crm_original_invalid: "L’original privé ou sa version ne correspond plus au document enregistré. Une vérification est nécessaire.",
  drive_file_identity_or_content_mismatch: "Le fichier Drive ne correspond pas à l’original enregistré. Une vérification est nécessaire.",
  drive_temporary_failure: "La copie reprendra automatiquement après un incident temporaire."
};
export const DRIVE_ERROR_MESSAGES_EN: Record<string, string> = {
  drive_primary_not_verified: "The original is retained. An administrator must verify its Drive copy before switching storage.",
  drive_rate_limited: "Google Drive is temporarily limiting requests. Copying will retry automatically after a delay.",
  drive_folder_creation_unconfirmed: "Folder creation is not yet confirmed. Copying will retry automatically with the same folder identity.",
  drive_not_configured: "An administrator must configure the Google Drive destination.",
  managed_folder_missing_or_inaccessible: "The managed folder is missing or inaccessible. Have its access checked or restore the same folder before retrying.",
  managed_folder_changed: "The managed folder was moved, trashed or changed. Have its original location restored before retrying.",
  drive_access_denied: "The technical identity can no longer access Google Drive. An administrator must restore its access.",
  drive_folder_write_denied: "The technical identity cannot add files to this folder. An administrator must check its permissions.",
  drive_root_ambiguous: "Several Projects folders exist. An administrator must confirm the canonical destination.",
  crm_original_invalid: "The private original or its version no longer matches the saved document. A review is required.",
  drive_file_identity_or_content_mismatch: "The Drive file does not match the saved original. A review is required.",
  drive_temporary_failure: "Copying will retry automatically after a temporary incident."
};
