import "server-only";
import {
  assertAllowedDriveResource, createGoogleDriveFetch, DriveRouteError,
  driveErrorResponse, getDocumentsRootFolderId, getDriveResourceMetadata,
  getSharedDriveId, jsonError, listDriveChildren, requireAuthenticatedCRMUser,
  type DriveResourceMetadata
} from "../_utils";
import {
  createDocumentTrashStore, type DocumentTrashInput, type DocumentTrashOperation,
  type DocumentTrashStore
} from "../../../../lib/server/documentTrashSupabase";

type DeleteRouteDependencies = {
  requireUser?: typeof requireAuthenticatedCRMUser;
  createFetchDrive?: typeof createGoogleDriveFetch;
  createStore?: (request: Request, actorId: string) => DocumentTrashStore;
};

const FOLDER_MIME = "application/vnd.google-apps.folder";
function parseTarget(body: Record<string, unknown>): DocumentTrashInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new DriveRouteError("Cible de mise à la corbeille invalide.", 400);
  for (const key of ["operationId", "documentId", "fileId", "parentFolderId", "parentDriveFolderId", "revision"]) {
    if (typeof body[key] !== "string" || (body[key] as string).length > 500) {
      throw new DriveRouteError("Identifiants CRM, Drive et rattachement requis.", 400);
    }
  }
  const input = body as DocumentTrashInput;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.operationId)
    || !input.documentId.trim() || !/^[A-Za-z0-9_-]+$/.test(input.fileId)
    || (input.parentDriveFolderId && !/^[A-Za-z0-9_-]+$/.test(input.parentDriveFolderId))) {
    throw new DriveRouteError("Cible de mise à la corbeille invalide.", 400);
  }
  return input;
}

function assertOperation(target: DocumentTrashInput, operation: DocumentTrashOperation) {
  if (!/^[0-9a-f-]{36}$/i.test(operation.operation_id) || operation.record_id !== target.documentId
    || operation.resource_id !== target.fileId || operation.parent_record_id !== target.parentFolderId
    || operation.parent_resource_id !== target.parentDriveFolderId
    || !["pending", "completed"].includes(operation.status)) {
    throw new DriveRouteError("L’opération ne correspond pas à la cible confirmée.", 409);
  }
}

export function createDeleteDriveHandler(dependencies: DeleteRouteDependencies = {}) {
  const requireUser = dependencies.requireUser || requireAuthenticatedCRMUser;
  const createFetchDrive = dependencies.createFetchDrive || createGoogleDriveFetch;
  const createStore = dependencies.createStore || createDocumentTrashStore;
  return async function POST(request: Request) {
    try {
      const actor = await requireUser(request);
      const body = await request.json().catch(() => ({}));
      const target = parseTarget(body);
      const rootId = getDocumentsRootFolderId();
      if ([rootId, getSharedDriveId(), process.env.GOOGLE_DRIVE_VENDOR_DOCUMENTS_FOLDER_ID].includes(target.fileId)) {
        return jsonError("Les racines CRM et Drive ne peuvent pas être mises à la corbeille.", 403);
      }
      const store = createStore(request, actor.id);
      // Read-only authorization before Google; rejected preflights leave no pending operation.
      let operation = await store.preview(target);
      assertOperation(target, operation);
      // Another tab may already have started this exact target. Reuse its durable ID.
      target.operationId = operation.operation_id;
      if (operation.status === "completed") {
        const completed = await store.complete(operation.operation_id, {});
        assertOperation(target, completed);
        if (completed.status !== "completed") throw new DriveRouteError("État CRM non confirmé. Reprenez la même opération.", 503);
        if ((await requireUser(request)).id !== actor.id) throw new DriveRouteError("La session CRM a changé.", 403);
        const visible = await store.preview(target); // Strict live session, exact rights, current payload.
        assertOperation(target, visible);
        if (visible.status !== "completed") throw new DriveRouteError("État CRM non confirmé.", 503);
        return Response.json({ ok: true, completed: true, ...visible }, { headers: { "cache-control": "private, no-store" } });
      }
      const google = createFetchDrive();
      const fetchDrive = (input: string | URL, init: RequestInit = {}) => google(input, {
        ...init, signal: AbortSignal.timeout(8000), cache: "no-store"
      });
      async function preflight(): Promise<DriveResourceMetadata> {
        const metadata = await assertAllowedDriveResource(target.fileId, { allowedRootIds: [rootId], fetchDrive });
        if (metadata.id !== target.fileId || (metadata.mimeType === FOLDER_MIME) !== operation.is_folder
          || metadata.parents.length !== 1 || metadata.parents[0] !== (operation.parent_resource_id || rootId)) {
          throw new DriveRouteError("Le rattachement réel Drive diffère de la cible CRM. Aucune mise à la corbeille effectuée.", 409);
        }
        if (metadata.trashed && !metadata.explicitlyTrashed) {
          throw new DriveRouteError("Le dossier parent est dans la corbeille. L’état de ce document doit être vérifié avant de reprendre.", 409);
        }
        if (!metadata.trashed && metadata.capabilities?.canTrash !== true) {
          throw new DriveRouteError("Google Drive refuse la mise à la corbeille : le compte Google existant doit disposer de capabilities.canTrash sur cet élément (rôle Gestionnaire de contenu ou Gestionnaire du Drive partagé). Aucun droit Google n’a été modifié.", 403);
        }
        if (operation.is_folder && (await listDriveChildren(target.fileId, fetchDrive)).length > 0) {
          throw new DriveRouteError("Ce dossier contient encore des fichiers ou sous-dossiers dans Google Drive. Seuls les dossiers vides peuvent être mis à la corbeille.", 409);
        }
        return metadata;
      }
      await preflight();
      // Revalidate under the workspace row lock; freeze this exact record and its references.
      operation = await store.prepare(target);
      assertOperation(target, operation);
      if (operation.status !== "completed") {
        const current = await preflight();
        if (!current.trashed) {
          const response = await fetchDrive(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(target.fileId)}?supportsAllDrives=true&fields=id,trashed,explicitlyTrashed`,
            { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ trashed: true }) }
          );
          if (!response.ok) {
            throw new DriveRouteError(response.status === 403
              ? "Google Drive refuse la mise à la corbeille : capabilities.canTrash est requis pour le compte Google existant. Aucun droit Google n’a été modifié. Reprenez la même opération après vérification."
              : "Mise à la corbeille Drive non confirmée. Reprenez la même opération pour vérifier son état.", response.status === 403 ? 403 : 502);
          }
        }
        // Never erase CRM metadata on an ambiguous PATCH response, or an implicitly trashed child.
        const confirmed = await getDriveResourceMetadata(target.fileId, fetchDrive);
        if (confirmed.id !== target.fileId || !confirmed.trashed || !confirmed.explicitlyTrashed) {
          throw new DriveRouteError("État de la corbeille Drive non confirmé. La fiche CRM est conservée ; reprenez la même opération.", 502);
        }
        operation = await store.complete(operation.operation_id, confirmed as unknown as Record<string, unknown>);
      } else {
        operation = await store.complete(operation.operation_id, {});
      }
      assertOperation(target, operation);
      if (operation.status !== "completed") throw new DriveRouteError("État CRM non confirmé. Reprenez la même opération.", 503);
      if ((await requireUser(request)).id !== actor.id) throw new DriveRouteError("La session CRM a changé.", 403);
      operation = await store.preview(target);
      assertOperation(target, operation);
      if (operation.status !== "completed") throw new DriveRouteError("État CRM non confirmé.", 503);
      return Response.json({ ok: true, completed: true, ...operation }, { headers: { "cache-control": "private, no-store" } });
    } catch (error) {
      return driveErrorResponse(error, "Mise à la corbeille non confirmée. Reprenez la même opération ; la fiche CRM est conservée tant que son état est incertain.");
    }
  };
}
