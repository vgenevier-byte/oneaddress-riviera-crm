import "server-only";
import { timingSafeEqual } from "node:crypto";
import { createGoogleDriveFetch, getSharedDriveId } from "../../app/api/drive/_utils";
import { configureProjetsRoot, discoverProjetsRoot, DRIVE_ERROR_MESSAGES, DRIVE_ERROR_MESSAGES_EN, FonciereDriveError, processFonciereDriveJobs, safeDriveError, validateProjetsRoot, type DriveConfig, type FonciereDriveFetch, type FonciereDriveStore } from "./fonciereDrive";
import { createFonciereDriveStore, createFonciereDriveUserClient } from "./fonciereDriveSupabase";
import { testFonciereDriveIntegration } from "./fonciereDriveTest";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const headers = { "cache-control": "private, no-store", vary: "Authorization", "referrer-policy": "no-referrer" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
function message(code: string | null | undefined, request?: Request) { const messages = /^en\b/i.test(request?.headers.get("accept-language") || "") ? DRIVE_ERROR_MESSAGES_EN : DRIVE_ERROR_MESSAGES; return code ? messages[code] || messages.drive_temporary_failure : undefined; }
function state(value: string) { return value === "processing" ? "copying" : value === "synced" ? "synced" : value === "retry" ? "retry" : "pending"; }
type Status = { configured: boolean; state: string; can_retry: boolean; can_open: boolean; folder_id?: string; project_error: string | null; files: Array<{ asset_id: string; original_name: string; category: string; state: string; error?: string }>; counts: Record<string, number> };
type Dependencies = { userClient?: typeof createFonciereDriveUserClient; store?: () => FonciereDriveStore; fetchDrive?: FonciereDriveFetch; sharedDriveId?: () => string };
function errorResponse(error: unknown, request: Request) {
  const code = safeDriveError(error);
  return json({ error: message(code, request), code }, error instanceof FonciereDriveError && error.code === "session_required" ? 401 : error instanceof FonciereDriveError && error.permanent ? 409 : 503);
}
/** RPCs apply current project scope and module rights, including revocation. */
export function createFonciereDriveStatusHandler(deps: Dependencies = {}) {
  return async (request: Request) => {
    try {
      const url = new URL(request.url);
      if (request.method !== "GET" && request.method !== "POST") return json({ error: "Méthode refusée." }, 405);
      if ([...url.searchParams.keys()].some(key => key !== "project") || url.searchParams.getAll("project").length > 1) return json({ error: "Paramètres invalides." }, 400);
      const client = (deps.userClient || createFonciereDriveUserClient)(request.headers.get("authorization"));
      let projectId: string;
      if (request.method === "POST") {
        const body = await request.json();
        if (!body || typeof body !== "object" || Object.keys(body).some(key => !["projectId", "assetId"].includes(key)) || (body.assetId != null && !UUID.test(body.assetId))) return json({ error: "Paramètres invalides." }, 400);
        projectId = body.projectId;
        if (!UUID.test(projectId)) return json({ error: "Projet invalide." }, 400);
        const retry = await client.rpc("fonciere_drive_retry", { p_project: projectId, p_asset: body.assetId || null }).abortSignal(AbortSignal.any([request.signal, AbortSignal.timeout(10000)]));
        if (retry.error) return json({ error: "Opération refusée sur ce projet." }, retry.error.code === "42501" ? 403 : 503);
      } else projectId = url.searchParams.get("project") || "";
      if (!UUID.test(projectId)) return json({ error: "Projet invalide." }, 400);
      const result = await client.rpc("fonciere_drive_status", { p_project: projectId }).abortSignal(AbortSignal.any([request.signal, AbortSignal.timeout(10000)]));
      if (result.error) return json({ error: "Projet inaccessible." }, result.error.code === "42501" ? 403 : 503);
      const row = result.data as Status;
      if (!row || !Array.isArray(row.files)) return json({ error: "Suivi temporairement indisponible." }, 503);
      return json({ configured: row.configured, projectId, status: state(row.state), canRetry: row.can_retry, canOpen: row.can_open && Boolean(row.folder_id), error: row.configured ? message(row.project_error, request) : message("drive_not_configured", request), counts: row.counts, files: row.files.map(file => ({ assetId: file.asset_id, name: file.original_name, category: file.category, status: state(file.state), error: message(file.error, request) })) });
    } catch (error) { return errorResponse(error, request); }
  };
}
/** Returning a native Drive URL requires the same live original-export right. */
export function createFonciereDriveFolderHandler(deps: Dependencies = {}) {
  return async (request: Request) => {
    try {
      const url = new URL(request.url), projectId = url.searchParams.get("project") || "";
      if (request.method !== "GET") return json({ error: "Méthode refusée." }, 405);
      if (!UUID.test(projectId) || [...url.searchParams.keys()].some(key => key !== "project") || url.searchParams.getAll("project").length !== 1) return json({ error: "Projet invalide." }, 400);
      const client = (deps.userClient || createFonciereDriveUserClient)(request.headers.get("authorization"));
      const authorize = () => client.rpc("fonciere_drive_folder", { p_project: projectId }).abortSignal(AbortSignal.any([request.signal, AbortSignal.timeout(10000)]));
      const result = await authorize();
      if (result.error) return json({ error: "Téléchargement non autorisé sur ce projet." }, result.error.code === "42501" ? 403 : 503);
      const id = result.data;
      if (typeof id !== "string" || !/^[\w-]{1,180}$/.test(id)) return json({ error: "Le dossier est en attente de copie." }, 409);
      const store = (deps.store || createFonciereDriveStore)(), fetchDrive = deps.fetchDrive || createGoogleDriveFetch();
      const config = await store.call<DriveConfig>("get_config");
      await validateProjetsRoot(fetchDrive, config);
      const metadata = await fetchDrive(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,mimeType,driveId,parents,trashed,appProperties`, { cache: "no-store", signal: AbortSignal.timeout(12000) });
      if (!metadata.ok) throw new FonciereDriveError("managed_folder_missing_or_inaccessible", true);
      const folder = await metadata.json();
      if (folder.id !== id || folder.mimeType !== "application/vnd.google-apps.folder" || folder.driveId !== config.shared_drive_id || folder.trashed !== false || folder.parents?.length !== 1 || folder.parents[0] !== config.root_folder_id || folder.appProperties?.managedBy !== "oar-fonciere" || folder.appProperties?.projectId !== projectId || folder.appProperties?.folderKind !== "project") throw new FonciereDriveError("managed_folder_changed", true);
      const final = await authorize();
      if (final.error || final.data !== id) return json({ error: "Téléchargement non autorisé sur ce projet." }, 403);
      return json({ url: `https://drive.google.com/drive/folders/${encodeURIComponent(id)}` });
    } catch (error) { return errorResponse(error, request); }
  };
}
function workerAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 24) return false;
  const expected = Buffer.from(`Bearer ${secret}`), received = Buffer.from(request.headers.get("authorization") || "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
/** Platform Cron owns retries after the browser closes; finite operational actions
 * use this same server secret and accept no destination supplied by a client. */
export function createFonciereDriveWorkerHandler(deps: Dependencies = {}) {
  return async (request: Request) => {
    if (!workerAuthorized(request)) return json({ error: "Service non autorisé." }, 401);
    try {
      if (!["GET", "POST"].includes(request.method)) return json({ error: "Méthode refusée." }, 405);
      if (new URL(request.url).search) return json({ error: "Paramètres invalides." }, 400);
      const body = request.method === "POST" ? await request.json() : { action: "run" };
      if (!body || typeof body !== "object" || Object.keys(body).some(key => key !== "action") || !["run", "diagnose", "configure", "backfill", "report", "test"].includes(body.action)) return json({ error: "Action invalide." }, 400);
      const fetchDrive = deps.fetchDrive || createGoogleDriveFetch(), sharedDriveId = (deps.sharedDriveId || getSharedDriveId)();
      if (body.action === "diagnose") {
        const discovery = await discoverProjetsRoot(fetchDrive, sharedDriveId);
        return json({ sharedDriveId, absenceEstablished: discovery.absenceEstablished, candidates: discovery.candidates.map(item => ({ id: item.id, name: item.name, parents: item.parents, canAddChildren: item.capabilities?.canAddChildren, canListChildren: item.capabilities?.canListChildren })) });
      }
      const store = (deps.store || createFonciereDriveStore)();
      if (body.action === "configure") return json(await configureProjetsRoot(store, fetchDrive, sharedDriveId));
      if (body.action === "test") return json(await testFonciereDriveIntegration(store, fetchDrive, sharedDriveId));
      if (body.action === "backfill" || body.action === "report") return json(await store.call(body.action));
      return json(await processFonciereDriveJobs(store, fetchDrive));
    } catch (error) { return errorResponse(error, request); }
  };
}
