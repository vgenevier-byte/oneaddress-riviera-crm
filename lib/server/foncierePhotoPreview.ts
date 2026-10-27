import "server-only";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type PhotoAdmission = { id: string; project_id: string; object_path: string; kind: string; expected_size: number; expected_mime: string; storage_object_version: string; permission_revision: number | string };
class PreviewError extends Error { constructor(public status: number) { super("Aperçu photographique indisponible."); } }
function required(name: string) { const value = process.env[name]; if (!value) throw new PreviewError(503); return value; }
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: "no-store" }) } };

/** The browser receives only a bounded derivative, never a Storage URL or original.
 * Live resource/session admission is repeated after rendering, including revocation. */
export function createFoncierePhotoPreviewHandler(dependencies: { readOriginal?: (origin: string, path: string) => Promise<Blob> } = {}) {
  return async function GET(request: Request) {
    try {
      const authorization = request.headers.get("authorization"), id = new URL(request.url).searchParams.get("asset");
      if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) throw new PreviewError(401);
      if (!id || !UUID.test(id)) throw new PreviewError(400);
      const origin = required("NEXT_PUBLIC_SUPABASE_URL");
      const user = createClient(origin, required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), { ...clientOptions, global: { ...clientOptions.global, headers: { Authorization: authorization } } });
      async function authorize(): Promise<PhotoAdmission> {
        const { data, error } = await user.rpc("fonciere_asset_access", { p_asset: id, p_operation: "photo_preview" }).abortSignal(AbortSignal.any([request.signal, AbortSignal.timeout(8000)]));
        if (error) throw new PreviewError(error.code === "42501" ? 403 : 503);
        const row = data as PhotoAdmission;
        if (!row || row.id !== id || !UUID.test(row.project_id) || row.object_path !== `${row.project_id}/${id}` || row.kind !== "photo" || !Number.isInteger(row.expected_size) || row.expected_size < 1 || row.expected_size > 25 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(row.expected_mime) || !row.storage_object_version || row.permission_revision == null) throw new PreviewError(403);
        return row;
      }
      const metadata = await authorize();
      const original = await (dependencies.readOriginal || readOriginal)(origin, metadata.object_path);
      if (original.size !== metadata.expected_size || original.type !== metadata.expected_mime) throw new PreviewError(503);
      const bytes = await sharp(Buffer.from(await original.arrayBuffer()), { limitInputPixels: 40_000_000, animated: false }).rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 70 }).toBuffer();
      const confirmed = await authorize();
      if (JSON.stringify(confirmed) !== JSON.stringify(metadata)) throw new PreviewError(403);
      request.signal.throwIfAborted();
      return new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg", "cache-control": "private, no-store", "content-disposition": "inline; filename=photo-preview.jpg", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
    } catch (error) {
      return Response.json({ error: "Aperçu photographique indisponible." }, { status: error instanceof PreviewError ? error.status : 503, headers: { "cache-control": "private, no-store" } });
    }
  };
}
async function readOriginal(origin: string, path: string): Promise<Blob> {
  const local = origin === "http://127.0.0.1:56031" && process.env.PREPAID_HOURS_TEST_ACK === "PREPAID_HOURS_LOCAL_ONLY";
  const server = createClient(origin, required(local ? "LOCAL_AUTH_INVITE_KEY" : "CRM_INVITE_AUTH_KEY"), clientOptions);
  const { data, error } = await server.storage.from("fonciere-documents").download(path);
  if (error || !data) throw new PreviewError(503);
  return data;
}
