import "server-only";
import {
  assertAllowedDriveResource,
  assertDriveFolder,
  createGoogleDriveFetch,
  driveErrorResponse,
  getDocumentsRootFolderId,
  jsonError,
  requireAuthenticatedCRMUser,
  sanitizeDriveName
} from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await requireAuthenticatedCRMUser(request);
    const fetchDrive = createGoogleDriveFetch();

    const body = await request.json().catch(() => ({}));
    const documentsRootFolderId = getDocumentsRootFolderId();
    const parentDriveFolderId = String(body.parentDriveFolderId || documentsRootFolderId).trim();
    const parentFolder = await assertAllowedDriveResource(parentDriveFolderId, { fetchDrive, allowedRootIds: [documentsRootFolderId] });
    assertDriveFolder(parentFolder);
    const name = sanitizeDriveName(body.name, "Nouveau dossier");

    const response = await fetchDrive("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,mimeType,webViewLink,createdTime,modifiedTime", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentDriveFolderId]
      })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return jsonError(payload.error?.message || "Création du dossier Drive impossible.", response.status);
    }

    return Response.json({ ok: true, folder: payload });
  } catch (error) {
    return driveErrorResponse(error, "Erreur serveur Google Drive.");
  }
}
