import "server-only";
import {
  assertAllowedDriveResource,
  createGoogleDriveFetch,
  driveErrorResponse,
  jsonError,
  requireAuthenticatedCRMUser
} from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asciiFallbackFileName(value: unknown) {
  const raw = String(value || "document").trim() || "document";

  const withoutAccents = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

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
  const fallbackName = asciiFallbackFileName(originalName);
  const encodedName = encodeRFC5987ValueChars(originalName);

  // Important: Headers in Next/undici must be ByteString-compatible.
  // filename is ASCII fallback, filename* keeps the real UTF-8 name via percent encoding.
  return `${disposition}; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`;
}

export async function GET(request: Request) {
  try {
    await requireAuthenticatedCRMUser(request);
    const fetchDrive = createGoogleDriveFetch();

    const url = new URL(request.url);
    const fileId = url.searchParams.get("fileId");
    const download = url.searchParams.get("download") === "1";

    if (!fileId) {
      return jsonError("fileId manquant.", 400);
    }

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
}
