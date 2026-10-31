import {readPrimaryOriginal,validatePrimaryRead,type DriveAdmission} from './drivePrimary';
import "server-only";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import {createHash} from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type PhotoAdmission = DriveAdmission & { id: string; project_id: string; object_path: string; kind: string; expected_size: number; expected_mime: string; storage_object_version: string; permission_revision: number | string };
class PreviewError extends Error { constructor(public status: number) { super("Aperçu photographique indisponible."); } }
function required(name: string) { const value = process.env[name]; if (!value) throw new PreviewError(503); return value; }
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: "no-store" }) } };

/** The browser receives only a bounded derivative, never a Storage URL or original.
 * Live resource/session admission is repeated after rendering, including revocation. */
export function createFoncierePhotoPreviewHandler(dependencies: { readOriginal?: (origin: string, path: string) => Promise<Blob> } = {}) {
  // Private bounded process memory, never a public/CDN cache. Every hit is admitted twice.
  const cache=new Map<string,{bytes:Buffer;at:number}>(),pending=new Map<string,Promise<Buffer>>();let cacheBytes=0;
  return async function GET(request: Request) {
    try {
      const authorization = request.headers.get("authorization"), id = new URL(request.url).searchParams.get("asset");
      if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) throw new PreviewError(401);
      if (!id || !UUID.test(id)) throw new PreviewError(400);
      const origin = required("NEXT_PUBLIC_SUPABASE_URL");
      const user = createClient(origin, required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), { ...clientOptions, global: { ...clientOptions.global, headers: { Authorization: authorization } } });
      async function authorize(): Promise<PhotoAdmission> {
        const { data, error } = await user.rpc("crm_drive_read", { p_domain:"fonciere",p_asset: id, p_operation: "photo_preview" }).abortSignal(AbortSignal.any([request.signal, AbortSignal.timeout(8000)]));
        if (error) throw new PreviewError(error.code === "42501" ? 403 : 503);
        const row = data as PhotoAdmission;
        if (!row || row.id !== id || !UUID.test(row.project_id) || row.object_path !== `${row.project_id}/${id}` || row.kind !== "photo" || !Number.isInteger(row.expected_size) || row.expected_size < 1 || row.expected_size > 25 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(row.expected_mime) || !row.storage_object_version || row.permission_revision == null) throw new PreviewError(403);
        return row;
      }
      const metadata = await authorize();
      if(metadata.drive)await validatePrimaryRead(metadata);
      const key=createHash('sha256').update(JSON.stringify([origin,metadata.id,metadata.storage_object_version,metadata.expected_size,metadata.expected_mime,metadata.drive?.revision_id,metadata.drive?.sha256,'preview-1024-q70-v1'])).digest('hex');
      const etag='"'+key+'"',notModified=request.headers.get('if-none-match')===etag;
      let bytes:Buffer|undefined,cacheState='not-modified';
      if(!notModified){
        const entry=cache.get(key);if(entry&&Date.now()-entry.at<600_000){bytes=entry.bytes;cacheState='hit';}
        else {cacheState='miss';if(entry){cacheBytes-=entry.bytes.length;cache.delete(key);}let work=pending.get(key);
          if(!work){work=(async()=>{const original=await (metadata.drive?readPrimaryOriginal(metadata):(dependencies.readOriginal||readOriginal)(origin,metadata.object_path));if(original.size!==metadata.expected_size||original.type!==metadata.expected_mime)throw new PreviewError(503);const rendered=await sharp(Buffer.from(await original.arrayBuffer()),{limitInputPixels:40_000_000,animated:false}).rotate().resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:70}).toBuffer();cache.set(key,{bytes:rendered,at:Date.now()});cacheBytes+=rendered.length;while(cacheBytes>32_000_000||cache.size>96){const oldest=cache.keys().next().value!;cacheBytes-=cache.get(oldest)!.bytes.length;cache.delete(oldest);}return rendered;})().finally(()=>pending.delete(key));pending.set(key,work);}
          bytes=await work;
        }
      }
      const confirmed = await authorize();
      if(confirmed.drive)await validatePrimaryRead(confirmed);
      if (JSON.stringify(confirmed) !== JSON.stringify(metadata)) throw new PreviewError(403);
      request.signal.throwIfAborted();
      return new Response(notModified?null:new Uint8Array(bytes!), {status:notModified?304:200, headers: { "content-type": "image/jpeg", "cache-control": "private, no-store", "content-disposition": "inline; filename=photo-preview.jpg", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",etag,"x-preview-cache":cacheState } });
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
