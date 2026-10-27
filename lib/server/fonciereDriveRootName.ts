import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { createGoogleDriveFetch, escapeDriveQuery, getSharedDriveId } from "../../app/api/drive/_utils";
import { FonciereDriveError, validateProjetsRoot, type DriveConfig, type FonciereDriveFetch, type FonciereDriveStore } from "./fonciereDrive";
import { createFonciereDriveStore } from "./fonciereDriveSupabase";

const CANONICAL_ROOT_ID = "1asCPnhFDabwSbdWCgtzm8b6NhGbeEeag";
const FILES = "https://www.googleapis.com/drive/v3/files", FOLDER = "application/vnd.google-apps.folder";
const FILE_FIELDS = "id,name,mimeType,driveId,parents,trashed,appProperties,size,md5Checksum";
type Descriptor = { id: string; name: string; mimeType?: string; driveId?: string; parents?: string[]; trashed?: boolean; appProperties?: Record<string, string> };
type Dependencies = { store?: () => FonciereDriveStore; fetchDrive?: FonciereDriveFetch; sharedDriveId?: () => string; canonicalId?: string; now?: () => number };
class RootNameError extends Error { constructor(public code: string, public status = 409) { super(code); } }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
const fingerprint = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "private, no-store", vary: "Authorization", "referrer-policy": "no-referrer" } });
function authorized(request: Request, now: number) {
  const secret = process.env.FONCIERE_ROOT_RENAME_SECRET || "", match = secret.match(/^([1-9]\d{9,11}):[a-f0-9]{64}$/);
  if (!match || Number(match[1]) <= now / 1000 || Number(match[1]) > now / 1000 + 1800) return false;
  const expected = Buffer.from(`Bearer ${secret}`), received = Buffer.from(request.headers.get("authorization") || "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
async function googleJson(fetchDrive: FonciereDriveFetch, url: string, init: RequestInit = {}) {
  const response = await fetchDrive(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new RootNameError("drive_inspection_unavailable", 503);
  return response.json();
}
async function pages(fetchDrive: FonciereDriveFetch, url: string, parameters: Record<string, string>, collection: "files" | "permissions"): Promise<Descriptor[]> {
  const rows: Descriptor[] = [], seen = new Set<string>(); let pageToken = "";
  do {
    const params = new URLSearchParams(parameters); if (pageToken) params.set("pageToken", pageToken);
    const body = await googleJson(fetchDrive, `${url}?${params}`);
    if (body.incompleteSearch === true || !Array.isArray(body[collection])) throw new RootNameError("drive_inspection_incomplete", 503);
    rows.push(...body[collection]);
    pageToken = body.nextPageToken || "";
    if (typeof pageToken !== "string" || pageToken && seen.has(pageToken)) throw new RootNameError("drive_inspection_incomplete", 503);
    if (pageToken) seen.add(pageToken);
  } while (pageToken);
  return rows;
}
async function inspect(fetchDrive: FonciereDriveFetch, config: DriveConfig) {
  const root = await validateProjetsRoot(fetchDrive, { ...config, enabled: true });
  const shared = { corpora: "drive", driveId: config.shared_drive_id!, spaces: "drive", supportsAllDrives: "true", includeItemsFromAllDrives: "true", pageSize: "100", fields: `nextPageToken,incompleteSearch,files(${FILE_FIELDS})` };
  const children = await pages(fetchDrive, FILES, { ...shared, q: `'${escapeDriveQuery(root.id)}' in parents` }, "files");
  const permissions = await pages(fetchDrive, `${FILES}/${encodeURIComponent(root.id)}/permissions`, { supportsAllDrives: "true", pageSize: "100", fields: "nextPageToken,permissions(id,type,role,allowFileDiscovery,deleted,expirationTime,pendingOwner,permissionDetails)" }, "permissions");
  // Read siblings last so their fingerprint is checked immediately before PATCH.
  const siblings = await pages(fetchDrive, FILES, { ...shared, q: `'${escapeDriveQuery(config.root_parent_id!)}' in parents and mimeType = '${FOLDER}' and trashed = false` }, "files");
  const ownSibling = siblings.find(item => item.id === root.id);
  if (!ownSibling || ownSibling.name !== root.name || siblings.some(item => !item.id || !item.name || item.driveId !== config.shared_drive_id || item.parents?.length !== 1 || item.parents[0] !== config.root_parent_id || item.mimeType !== FOLDER || item.trashed !== false)) throw new RootNameError("drive_sibling_snapshot_changed");
  const invariants = { id: root.id, driveId: root.driveId, parents: root.parents, mimeType: root.mimeType, trashed: root.trashed, appProperties: root.appProperties };
  return { root, siblings, siblingsFingerprint: fingerprint(siblings), childrenFingerprint: fingerprint(children), permissionsFingerprint: fingerprint(permissions), invariantsFingerprint: fingerprint(invariants), childCount: children.length, permissionCount: permissions.length };
}
type Snapshot = Awaited<ReturnType<typeof inspect>>;
function publicSnapshot(snapshot: Snapshot) {
  return { root: { id: snapshot.root.id, name: snapshot.root.name, parentId: snapshot.root.parents?.[0], sharedDriveId: snapshot.root.driveId, url: `https://drive.google.com/drive/folders/${encodeURIComponent(snapshot.root.id)}` }, siblings: snapshot.siblings.map(item => ({ id: item.id, name: item.name })).sort((a, b) => a.name.localeCompare(b.name)), siblingsFingerprint: snapshot.siblingsFingerprint, childrenFingerprint: snapshot.childrenFingerprint, permissionsFingerprint: snapshot.permissionsFingerprint, childCount: snapshot.childCount, permissionCount: snapshot.permissionCount };
}
/** One temporary organization operation, restricted to this exact configured ID.
 * Credentials, ACL entries, database writes and arbitrary destinations are absent. */
export function createFonciereDriveRootNameHandler(deps: Dependencies = {}) {
  return async (request: Request) => {
    if (!authorized(request, (deps.now || Date.now)())) return json({ error: "Service non autorisé." }, 401);
    try {
      if (!["GET", "POST"].includes(request.method)) return json({ error: "Méthode refusée." }, 405);
      if (new URL(request.url).search) return json({ error: "Paramètres invalides." }, 400);
      const body = request.method === "POST" ? await request.json() : null;
      if (body && (Object.keys(body).sort().join(",") !== "expectedName,name,siblingsFingerprint" || typeof body.name !== "string" || body.name.length > 80 || !/^\d+\s*[-–—.]\s*Projets$/i.test(body.name) || typeof body.expectedName !== "string" || !/^[a-f0-9]{64}$/.test(body.siblingsFingerprint))) return json({ error: "Paramètres invalides." }, 400);
      if (request.method === "POST" && !body) return json({ error: "Paramètres invalides." }, 400);
      const store = (deps.store || createFonciereDriveStore)(), config = await store.call<DriveConfig>("get_config");
      if (config.root_folder_id !== (deps.canonicalId || CANONICAL_ROOT_ID) || !config.root_parent_id || config.shared_drive_id !== (deps.sharedDriveId || getSharedDriveId)()) throw new RootNameError("canonical_destination_mismatch");
      const fetchDrive = deps.fetchDrive || createGoogleDriveFetch(), before = await inspect(fetchDrive, config);
      if (request.method === "GET") return json(publicSnapshot(before));
      if (before.root.name === body.name) return json({ ...publicSnapshot(before), renamed: false, verifiedUnchanged: true });
      if (before.root.name !== "Projets" || before.root.name !== body.expectedName || before.siblingsFingerprint !== body.siblingsFingerprint) throw new RootNameError("rename_snapshot_conflict");
      const number = BigInt(body.name.match(/^\d+/)![0]);
      if (before.siblings.some(item => item.id !== before.root.id && (item.name.normalize("NFKC").trim().toLocaleLowerCase("fr") === body.name.normalize("NFKC").trim().toLocaleLowerCase("fr") || /^\d+\s*[-–—.]/.test(item.name) && BigInt(item.name.match(/^\d+/)![0]) === number))) throw new RootNameError("sibling_number_or_name_collision");
      let patchFailed = false;
      try { const response = await fetchDrive(`${FILES}/${encodeURIComponent(before.root.id)}?supportsAllDrives=true&fields=id,name`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: body.name }), signal: AbortSignal.timeout(15000) }); patchFailed = !response.ok; }
      catch { patchFailed = true; /* Re-read the same identity after an ambiguous reply. */ }
      const after = await inspect(fetchDrive, config);
      if (after.root.name !== body.name) throw new RootNameError(patchFailed ? "rename_not_confirmed" : "rename_snapshot_conflict", patchFailed ? 503 : 409);
      if (after.invariantsFingerprint !== before.invariantsFingerprint || after.childrenFingerprint !== before.childrenFingerprint || after.permissionsFingerprint !== before.permissionsFingerprint) throw new RootNameError("root_contents_or_permissions_changed");
      return json({ ...publicSnapshot(after), renamed: true, verifiedUnchanged: true });
    } catch (error) { return json({ error: error instanceof RootNameError || error instanceof FonciereDriveError ? error.code : "root_name_operation_unavailable" }, error instanceof RootNameError ? error.status : error instanceof FonciereDriveError && error.permanent ? 409 : 503); }
  };
}
