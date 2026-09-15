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

    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File) || file.size <= 0) {
      return jsonError("Aucun fichier reçu.", 400);
    }

    const documentsRootFolderId = getDocumentsRootFolderId();
    const parentDriveFolderId = String(form.get("parentDriveFolderId") || documentsRootFolderId).trim();
    const parentFolder = await assertAllowedDriveResource(parentDriveFolderId, { fetchDrive, allowedRootIds: [documentsRootFolderId] });
    assertDriveFolder(parentFolder);
    const requestedName = sanitizeDriveName(form.get("title") || file.name, file.name || "Document CRM");

    const multipart = new FormData();
    multipart.append("metadata", new Blob([JSON.stringify({
      name: requestedName,
      parents: [parentDriveFolderId]
    })], { type: "application/json" }));
    multipart.append("file", file, file.name || requestedName);

    const response = await fetchDrive("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,webContentLink,iconLink,createdTime,modifiedTime", {
      method: "POST",
      body: multipart
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return jsonError(payload.error?.message || "Upload Google Drive impossible.", response.status);
    }

    return Response.json({ ok: true, file: payload });
  } catch (error) {
    return driveErrorResponse(error, "Erreur serveur Google Drive.");
  }
}
