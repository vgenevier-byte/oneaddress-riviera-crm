import "server-only";
import { createHash } from "node:crypto";
import type { DriveConfig, DriveMetadata, FonciereDriveFetch } from "./fonciereDrive";
import { validateProjetsRoot } from "./fonciereDrive";

/** Read-only preflight. No copy, finalization, deletion or provider switch occurs here. */
export type AuditAsset = {
  id: string; project_id: string; object_path: string; kind: string; lifecycle: string;
  expected_size: number; expected_mime: string; storage_object_id: string | null;
  storage_object_version: string | null; drive_category: string;
  storage_present: boolean; storage_size: string | null; storage_mime: string | null;
  actual_storage_version: string | null;
};
type Copy = { asset_id: string; project_id: string; storage_object_version: string; category: string; status: string; drive_file_id: string | null };
type Folder = { project_id: string; category: string; parent_drive_folder_id: string; drive_folder_id: string; status: string };
export type DriveInventory = {
  capturedAt: string; sourceSha: string; config: DriveConfig; projects: number;
  buckets: Array<{ bucket_id: string; files: number; bytes: number }>;
  assets: AuditAsset[]; copies: Copy[]; folders: Folder[];
  currentReferences: Array<{ project_id: string; asset_id: string }>;
  snapshotReferences: Array<{ project_id: string; fingerprint: string; project_revision: number; asset_id: string; storage_object_version: string }>;
  presentationAssets: Array<{ id: string; expected_size: number; lifecycle: string }>; presentationVersions: number;
};
export type AuditRow = {
  assetId: string; projectId: string; bytes: number; version: string | null;
  currentReferences: number; snapshotReferences: number; driveId: string | null;
  status: "pending" | "source_mismatch" | "missing_copy" | "ambiguous_copy" | "registry_candidate" | "destination_mismatch" | "drive_unavailable" | "drive_mismatch" | "source_changed" | "verified";
  proof?: { sourceVersion: string; md5: string; sha256: string; driveVersion: string; driveRevision: string; checkedAt: string };
};
const assetKeys: Array<keyof AuditAsset> = ["id", "project_id", "object_path", "kind", "lifecycle", "expected_size", "expected_mime", "storage_object_id", "storage_object_version", "drive_category", "storage_present", "storage_size", "storage_mime", "actual_storage_version"];
const same = (a: AuditAsset, b: AuditAsset) => !!b && assetKeys.every(key => a[key] === b[key]);
function sourceValid(a: AuditAsset) {
  return a.object_path === `${a.project_id}/${a.id}` && a.storage_present && !!a.storage_object_id &&
    !!a.storage_object_version && a.actual_storage_version === a.storage_object_version &&
    Number.isSafeInteger(a.expected_size) && a.expected_size > 0 && a.expected_size <= 25_000_000 &&
    Number(a.storage_size) === a.expected_size && a.storage_mime === a.expected_mime;
}

/** Registry candidates deliberately do not count as verified Drive files. */
export function inventoryDriveCandidates(inventory: DriveInventory): AuditRow[] {
  return inventory.assets.map(a => {
    const copies = inventory.copies.filter(c => c.asset_id === a.id && c.project_id === a.project_id && c.storage_object_version === a.storage_object_version && c.status === "synced" && c.drive_file_id);
    return {
      assetId: a.id, projectId: a.project_id, bytes: a.expected_size, version: a.storage_object_version,
      currentReferences: inventory.currentReferences.filter(r => r.asset_id === a.id && r.project_id === a.project_id).length,
      snapshotReferences: inventory.snapshotReferences.filter(r => r.asset_id === a.id && r.project_id === a.project_id && r.storage_object_version === a.storage_object_version).length,
      driveId: copies.length === 1 ? copies[0].drive_file_id : null,
      status: a.lifecycle !== "finalized" ? "pending" : !sourceValid(a) ? "source_mismatch" : copies.length > 1 ? "ambiguous_copy" : !copies.length ? "missing_copy" : "registry_candidate",
    };
  });
}

/** Validate only registered identities; absence never triggers discovery/creation.
 * Source bytes are read once per asset. No original bytes or arbitrary exception
 * strings appear in the returned report. Callers must use the technical identity.
 */
export async function auditDriveCopies(inventory: DriveInventory, dependencies: {
  fetchDrive: FonciereDriveFetch;
  readSource: (asset: AuditAsset) => Promise<Blob>;
  rereadAsset: (id: string) => Promise<AuditAsset>;
  now?: () => string;
}) {
  const rows = inventoryDriveCandidates(inventory), { fetchDrive } = dependencies;
  await validateProjetsRoot(fetchDrive, inventory.config);
  const fields = "id,mimeType,driveId,parents,trashed,appProperties,size,md5Checksum,version,headRevisionId";
  type Metadata = DriveMetadata & { version?: string; headRevisionId?: string };
  async function metadata(id: string): Promise<Metadata> {
    const result = await fetchDrive(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=${fields}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!result.ok) throw Error("metadata_unavailable");
    return result.json();
  }
  // Memoize metadata of registered folders only, bounded by this inventory/run.
  const folders = new Map<string, Promise<Metadata>>();
  function folder(id: string) { if (!folders.has(id)) folders.set(id, metadata(id)); return folders.get(id)!; }
  function matchesFile(m: Metadata, a: AuditAsset, row: AuditRow, parentId: string) {
    return m.id === row.driveId && m.driveId === inventory.config.shared_drive_id && m.trashed === false &&
      m.parents?.length === 1 && m.parents[0] === parentId && m.mimeType === a.expected_mime &&
      Number(m.size) === a.expected_size && /^[a-f0-9]{32}$/.test(m.md5Checksum || "") &&
      !!m.version && !!m.headRevisionId && m.appProperties?.managedBy === "oar-fonciere" &&
      m.appProperties?.projectId === a.project_id && m.appProperties?.assetId === a.id &&
      m.appProperties?.storageVersion === a.storage_object_version;
  }
  function matchesFolder(m: Metadata, id: string, parent: string, project: string, category: string) {
    return m.id === id && m.driveId === inventory.config.shared_drive_id && m.trashed === false &&
      m.mimeType === "application/vnd.google-apps.folder" && m.parents?.length === 1 && m.parents[0] === parent &&
      m.appProperties?.managedBy === "oar-fonciere" && m.appProperties?.projectId === project && m.appProperties?.folderKind === category;
  }
  let next = 0, sourceBytesRead = 0;
  await Promise.all(Array.from({ length: Math.min(3, rows.length) }, async () => {
    while (next < rows.length) {
      const row = rows[next++]; if (row.status !== "registry_candidate") continue;
      const asset = inventory.assets.find(a => a.id === row.assetId)!;
      const copies = inventory.copies.filter(c => c.asset_id === asset.id && c.project_id === asset.project_id && c.storage_object_version === asset.storage_object_version && c.drive_file_id === row.driveId);
      const projectFolders = inventory.folders.filter(f => f.project_id === asset.project_id && f.category === "project" && f.status === "ready");
      const categoryFolders = inventory.folders.filter(f => f.project_id === asset.project_id && f.category === asset.drive_category && f.status === "ready");
      if (copies.length !== 1 || copies[0].category !== asset.drive_category || projectFolders.length !== 1 || categoryFolders.length !== 1 || projectFolders[0].parent_drive_folder_id !== inventory.config.root_folder_id || categoryFolders[0].parent_drive_folder_id !== projectFolders[0].drive_folder_id) { row.status = "destination_mismatch"; continue; }
      try {
        const project = projectFolders[0], category = categoryFolders[0];
        if (!matchesFolder(await folder(project.drive_folder_id), project.drive_folder_id, inventory.config.root_folder_id!, asset.project_id, "project") || !matchesFolder(await folder(category.drive_folder_id), category.drive_folder_id, project.drive_folder_id, asset.project_id, asset.drive_category)) { row.status = "destination_mismatch"; continue; }
        const before = await metadata(row.driveId!);
        if (!matchesFile(before, asset, row, category.drive_folder_id)) { row.status = "drive_mismatch"; continue; }
        if (!same(asset, await dependencies.rereadAsset(asset.id))) { row.status = "source_changed"; continue; }
        const original = await dependencies.readSource(asset); sourceBytesRead += original.size;
        if (original.size !== asset.expected_size || original.type !== asset.expected_mime) { row.status = "source_mismatch"; continue; }
        const bytes = Buffer.from(await original.arrayBuffer()), md5 = createHash("md5").update(bytes).digest("hex"), sha256 = createHash("sha256").update(bytes).digest("hex");
        if (md5 !== before.md5Checksum) { row.status = "drive_mismatch"; continue; }
        const after = await metadata(row.driveId!);
        if (!matchesFile(after, asset, row, category.drive_folder_id) || after.md5Checksum !== md5 || before.version !== after.version || before.headRevisionId !== after.headRevisionId) { row.status = "drive_mismatch"; continue; }
        if (!same(asset, await dependencies.rereadAsset(asset.id))) { row.status = "source_changed"; continue; }
        // Recheck ancestors after the source download, bypassing the folder memo.
        if (!matchesFolder(await metadata(project.drive_folder_id), project.drive_folder_id, inventory.config.root_folder_id!, asset.project_id, "project") || !matchesFolder(await metadata(category.drive_folder_id), category.drive_folder_id, project.drive_folder_id, asset.project_id, asset.drive_category)) { row.status = "destination_mismatch"; continue; }
        row.proof = { sourceVersion: asset.storage_object_version!, md5, sha256, driveVersion: after.version!, driveRevision: after.headRevisionId!, checkedAt: (dependencies.now || (() => new Date().toISOString()))() };
        row.status = "verified";
      } catch { row.status = "drive_unavailable"; }
    }
  }));
  await validateProjetsRoot(fetchDrive, inventory.config);
  // Receipts are observations only, never authority to switch a provider later.
  // A future cutover must recheck both source version and Drive revision in its CAS.
  return { capturedAt: inventory.capturedAt, auditedAt: (dependencies.now || (() => new Date().toISOString()))(), sourceBytesRead, rows };
}

export function summarizeDriveInventory(inventory: DriveInventory, rows = inventoryDriveCandidates(inventory)) {
  const states: Record<string, { files: number; bytes: number }> = {};
  for (const row of rows) { states[row.status] ||= { files: 0, bytes: 0 }; states[row.status].files++; states[row.status].bytes += row.bytes; }
  return {
    capturedAt: inventory.capturedAt, states,
    unresolvedCurrentReferences: inventory.currentReferences.filter(r => !inventory.assets.some(a => a.id === r.asset_id && a.project_id === r.project_id && a.lifecycle === "finalized")),
    unresolvedSnapshotReferences: inventory.snapshotReferences.filter(r => !inventory.assets.some(a => a.id === r.asset_id && a.project_id === r.project_id && a.storage_object_version === r.storage_object_version && a.lifecycle === "finalized")),
    // Audit alone never makes an original removable. Cutover is a separate step.
    authorizedDeletions: 0, freedSupabaseBytes: 0,
  };
}
