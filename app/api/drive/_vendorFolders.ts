import "server-only";
import { randomUUID } from "node:crypto";
import { DriveRouteError, escapeDriveQuery, type createGoogleDriveFetch } from "./_utils";
import type { FolderIdentity, FolderRegistry, FolderReservation } from "./_folderRegistry";

type DriveFetch = ReturnType<typeof createGoogleDriveFetch>;
export type VendorFolderSpec = {
  workspaceId: string;
  contactId: string;
  parentId: string;
  sharedDriveId: string;
  kind: "vendor-root" | "rib";
  name: string;
};
type Folder = { id: string; mimeType: string; driveId: string; parents: string[]; trashed: boolean; appProperties: Record<string, string> };
const base = "https://www.googleapis.com/drive/v3/files";
const folderMime = "application/vnd.google-apps.folder";
const fields = "id,mimeType,driveId,parents,trashed,appProperties";
export function vendorFolderIdentity(spec: VendorFolderSpec): FolderIdentity {
  return { workspaceId: spec.workspaceId, logicalKey: `vendor:${encodeURIComponent(spec.contactId)}${spec.kind === "rib" ? ":rib" : ""}`, parentId: spec.parentId };
}
export function vendorFolderProperties(spec: VendorFolderSpec) {
  return { workspaceId: spec.workspaceId, managedBy: "crm", entityType: "vendor", entityId: spec.contactId, folderKind: spec.kind };
}
export function validateVendorFolder(folder: Folder, spec: VendorFolderSpec, expectedId?: string) {
  if (!folder.id || (expectedId && folder.id !== expectedId) || folder.mimeType !== folderMime
    || folder.driveId !== spec.sharedDriveId || folder.trashed !== false
    || !Array.isArray(folder.parents) || folder.parents.length !== 1 || folder.parents[0] !== spec.parentId
    || Object.entries(vendorFolderProperties(spec)).some(([key, value]) => folder.appProperties?.[key] !== value)) {
    throw new DriveRouteError("Dossier Drive incohérent : ID, parent, Drive partagé ou propriétés invalides.", 409);
  }
  return folder.id;
}
function validateReservation(row: FolderReservation, identity: FolderIdentity) {
  if (!row || row.workspace_id !== identity.workspaceId || row.logical_key !== identity.logicalKey
    || row.parent_drive_folder_id !== identity.parentId || !["creating", "ready"].includes(row.status)) {
    throw new DriveRouteError("Réservation de dossier Drive incohérente.", 409);
  }
}

// There is deliberately no process-local lock. Postgres fences reservations;
// the immutable reserved Drive ID fences creation, including after lease expiry.
export async function resolveVendorFolder(spec: VendorFolderSpec, deps: {
  registry: FolderRegistry;
  fetchDrive: DriveFetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
}) {
  const now = deps.now || Date.now;
  const sleep = deps.sleep || ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const deadline = now() + (deps.maxWaitMs ?? 45000);
  const token = randomUUID();
  const identity = vendorFolderIdentity(spec);
  async function drive(url: string, init: RequestInit = {}) {
    const remaining = deadline - now();
    if (remaining <= 0) throw new DriveRouteError("Dossier en préparation. Réessayez dans quelques instants.", 503);
    return deps.fetchDrive(url, { ...init, signal: AbortSignal.timeout(Math.max(1, Math.min(8000, remaining))) });
  }
  async function get(id: string): Promise<Folder | null> {
    const response = await drive(`${base}/${encodeURIComponent(id)}?supportsAllDrives=true&fields=${fields}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new DriveRouteError("Vérification du dossier Drive impossible.", 503);
    const folder = await response.json() as Folder;
    validateVendorFolder(folder, spec, id);
    return folder;
  }
  async function recover() {
    const matches: Folder[] = [];
    let pageToken = "";
    do {
      const q = [`'${escapeDriveQuery(spec.parentId)}' in parents`, "trashed = false",
        ...Object.entries(vendorFolderProperties(spec)).map(([key, value]) => `appProperties has { key='${escapeDriveQuery(key)}' and value='${escapeDriveQuery(value)}' }`)].join(" and ");
      const params = new URLSearchParams({ q, corpora: "drive", driveId: spec.sharedDriveId, spaces: "drive", supportsAllDrives: "true", includeItemsFromAllDrives: "true", fields: `nextPageToken,files(${fields})`, pageSize: "100" });
      if (pageToken) params.set("pageToken", pageToken);
      const response = await drive(`${base}?${params}`);
      if (!response.ok) throw new DriveRouteError("Recherche de récupération Drive impossible.", 503);
      const body = await response.json();
      if (!Array.isArray(body.files)) throw new DriveRouteError("Réponse de récupération Drive invalide.", 503);
      for (const folder of body.files) { validateVendorFolder(folder, spec); matches.push(folder); }
      if (matches.length > 1) throw new DriveRouteError("Plusieurs dossiers correspondent à la même identité CRM. Vérification manuelle requise.", 409);
      pageToken = body.nextPageToken || "";
    } while (pageToken);
    return matches[0] || null;
  }
  try {
    while (now() < deadline) {
      const claim = await deps.registry.claim(identity, token);
      validateReservation(claim, identity);
      if (claim.status === "ready") {
        if (!claim.drive_folder_id || !await get(claim.drive_folder_id)) throw new DriveRouteError("Dossier enregistré absent de Drive. Vérification manuelle requise.", 409);
        return claim.drive_folder_id;
      }
      if (!claim.claimed) { await sleep(250 + Math.floor(Math.random() * 100)); continue; }

      let id = claim.drive_folder_id;
      let existing: Folder | null = id ? await get(id) : null;
      if (!existing) {
        const recovered = await recover();
        if (recovered && id && recovered.id !== id) throw new DriveRouteError("Le dossier retrouvé diffère de l’ID réservé. Vérification manuelle requise.", 409);
        if (recovered) { existing = recovered; id = recovered.id; }
      }
      if (!id) {
        const response = await drive(`${base}/generateIds?count=1&space=drive&type=files`);
        if (!response.ok) throw new DriveRouteError("Réservation d’un ID Google Drive impossible.", 503);
        const body = await response.json();
        id = body.ids?.[0];
        if (typeof id !== "string" || !id) throw new DriveRouteError("ID Google Drive pré-généré absent.", 503);
      }
      // The RPC response is required before any POST to Drive. A lost RPC response
      // cannot result in creation with an uncommitted or overwritten reservation.
      const reserved = await deps.registry.reserve(identity, token, id);
      if (!reserved) continue; // Lease lost; another worker owns the same row.
      validateReservation(reserved, identity);
      if (!reserved.drive_folder_id) throw new DriveRouteError("ID Drive non réservé.", 503);
      if (reserved.drive_folder_id !== id) { id = reserved.drive_folder_id; existing = await get(id); }

      if (!existing) {
        for (let attempt = 0; attempt < 3 && now() < deadline; attempt++) {
          let response: Response | undefined;
          try {
            response = await drive(`${base}?supportsAllDrives=true&fields=id`, {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ id, name: spec.name, mimeType: folderMime, parents: [spec.parentId], appProperties: vendorFolderProperties(spec) })
            });
          } catch { /* Ambiguous timeout: only GET or a retry with this SAME ID is safe. */ }
          if (response && !response.ok && response.status !== 409 && response.status !== 429 && response.status < 500) {
            throw new DriveRouteError("Création du dossier Drive refusée.", response.status === 403 ? 403 : 502);
          }
          existing = await get(id);
          if (existing) break; // Includes successful POST, ambiguous timeout and 409.
          await sleep(200 * (attempt + 1));
        }
        if (!existing) throw new DriveRouteError("Création Drive non confirmée. L’ID réservé sera réutilisé au prochain essai.", 503);
      }
      validateVendorFolder(existing, spec, id);
      if (await deps.registry.ready(identity, token, id)) return id;
      // Crash / expired lease after creation: next claimant verifies the same ID.
    }
    throw new DriveRouteError("Dossier en préparation. Réessayez dans quelques instants.", 503);
  } catch (error) {
    if (error instanceof DriveRouteError) throw error;
    throw new DriveRouteError("Coordination Drive interrompue. La réservation sera reprise au prochain essai.", 503);
  }
}
