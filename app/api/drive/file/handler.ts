import "server-only";
import {
  assertAllowedDriveResource,
  createGoogleDriveFetch,
  driveErrorResponse,
  jsonError,
  requireAuthenticatedCRMUser
} from "../_utils";

type FileRouteDependencies = {
  requireUser?: typeof requireAuthenticatedCRMUser;
  createFetchDrive?: typeof createGoogleDriveFetch;
};

function asciiFallbackFileName(value: unknown) {
  const raw = String(value || "document").trim() || "document";
  const withoutAccents = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const ascii = withoutAccents
    .replace(/[\r\n]/g, " ")
    .replace(/["\\;]/g, "")
    .replace(/[^\x20-\x7E]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (ascii || "document").slice(0, 150);
}

function encodeRFC5987ValueChars(value: string) {
  return encodeURIComponent(value)
    .replace(/[']/g, "%27")
    .replace(/[()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");
}

function contentDispositionHeader(disposition: "inline" | "attachment", fileName: unknown) {
  const originalName = String(fileName || "document").trim() || "document";
  // Headers must be ByteString-compatible; filename* preserves the UTF-8 name.
  return `${disposition}; filename="${asciiFallbackFileName(originalName)}"; filename*=UTF-8''${encodeRFC5987ValueChars(originalName)}`;
}

export function createDriveFileHandler(dependencies: FileRouteDependencies = {}) {
  const requireUser = dependencies.requireUser || requireAuthenticatedCRMUser;
  const createFetchDrive = dependencies.createFetchDrive || createGoogleDriveFetch;
  return async function GET(request: Request) {
    try {
      // Authenticate and recheck the current resource/download rights before WIF.
      await requireUser(request);
      const url = new URL(request.url);
      const fileId = url.searchParams.get("fileId");
      const download = url.searchParams.get("download") === "1";
      if (!fileId) return jsonError("fileId manquant.", 400);

      const fetchDrive = createFetchDrive();
      const metadata = await assertAllowedDriveResource(fileId, { fetchDrive });
      const mediaResponse = await fetchDrive(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
        { method: "GET" }
      );
      if (!mediaResponse.ok || !mediaResponse.body) {
        const payload = await mediaResponse.json().catch(() => ({} as { error?: { message?: string } }));
        return jsonError(payload.error?.message || "Lecture du fichier Drive impossible.", mediaResponse.status);
      }

      const headers = new Headers();
      headers.set("content-type", metadata.mimeType || mediaResponse.headers.get("content-type") || "application/octet-stream");
      headers.set("cache-control", "private, no-store");
      headers.set("content-disposition", contentDispositionHeader(download ? "attachment" : "inline", metadata.name || "document"));
      return new Response(mediaResponse.body, { status: 200, headers });
    } catch (error) {
      return driveErrorResponse(error, "Erreur serveur Google Drive.");
    }
  };
}
