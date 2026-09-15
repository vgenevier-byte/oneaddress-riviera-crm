import "server-only";
import {
  assertAllowedDriveResource,
  createGoogleDriveFetch,
  driveErrorResponse,
  jsonError,
  requireAuthenticatedCRMUser
} from "../_utils";

type DeleteRouteDependencies = {
  requireUser?: typeof requireAuthenticatedCRMUser;
  assertAllowedResource?: (resourceId: string) => Promise<unknown>;
};

export function createDeleteDriveHandler(dependencies: DeleteRouteDependencies = {}) {
  const requireUser = dependencies.requireUser || requireAuthenticatedCRMUser;
  return async function POST(request: Request) {
    try {
      await requireUser(request);

      const body = await request.json().catch(() => ({}));
      const fileId = String(body.fileId || "").trim();

      if (!fileId) {
        return jsonError("fileId manquant.", 400);
      }

      const assertAllowedResource = dependencies.assertAllowedResource || (
        (resourceId: string) => assertAllowedDriveResource(resourceId, {
          fetchDrive: createGoogleDriveFetch()
        })
      );
      await assertAllowedResource(fileId);

      return jsonError("Suppression Drive désactivée : utilisez l’archivage.", 409);
    } catch (error) {
      return driveErrorResponse(error, "Erreur serveur Google Drive.");
    }
  };
}
