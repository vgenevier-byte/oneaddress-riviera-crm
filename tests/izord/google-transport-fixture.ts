// Test-only transport. Copied into an isolated app; never imported by production.
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

type Resource = {
  id: string; name: string; mimeType: string; parents: string[]; driveId: string;
  trashed: boolean; appProperties: Record<string, string>; size?: string; bytes?: Uint8Array;
};
type FixtureState = { files: Map<string, Resource> };
const sharedDrive = "fixture-shared-drive";
const documents = "fixture-documents-root";
const vendors = "fixture-vendors-root";
const folderMime = "application/vnd.google-apps.folder";
const store = globalThis as typeof globalThis & { __izordLocalGoogleFixture?: FixtureState };

function state() {
  if (!store.__izordLocalGoogleFixture) {
    const files = new Map<string, Resource>();
    const add = (id: string, name: string, mimeType: string, parents: string[], bytes?: Uint8Array) => {
      files.set(id, { id, name, mimeType, parents, driveId: sharedDrive, trashed: false, appProperties: {}, bytes });
    };
    add(documents, "CRM DOCUMENTS", folderMime, [sharedDrive]);
    add(vendors, "PRESTATAIRES FICTIFS", folderMime, [sharedDrive]);
    add("fixture-document", "Document fictif.pdf", "application/pdf", [documents], new TextEncoder().encode("%PDF-1.4\nFICTIONAL DRIVE DOCUMENT\n"));
    store.__izordLocalGoogleFixture = { files };
  }
  return store.__izordLocalGoogleFixture;
}

export function createFixtureGoogleDriveFetch() {
  if (process.env.IZORD_TEST_ACK !== "IZORD_DISPOSABLE_LOCAL_ONLY" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:55431") {
    throw new Error("Local Google fixture requires the approved disposable target");
  }
  return async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input), method = (init.method || "GET").toUpperCase();
    if (url.origin !== "https://www.googleapis.com" || !/^\/(?:upload\/)?drive\/v3\//.test(url.pathname)) {
      throw new Error("Unexpected simulated Google transport operation");
    }
    const trace = process.env.IZORD_GOOGLE_TRACE_FILE;
    if (!trace) throw new Error("Private local Google trace required");
    // Never record request headers, body, tokens or uploaded bytes.
    appendFileSync(trace, JSON.stringify({ method, path: url.pathname, simulation: true }) + "\n", { mode: 0o600 });
    const files = state().files;
    if (url.pathname === `/drive/v3/drives/${sharedDrive}` && method === "GET") {
      return Response.json({ id: sharedDrive, name: "Drive fictif local" });
    }
    if (url.pathname === "/drive/v3/files/generateIds" && method === "GET") {
      return Response.json({ ids: [`fixture-generated-${randomUUID()}`] });
    }
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      const query = url.searchParams.get("q") || "";
      const parent = query.match(/'([^']+)' in parents/)?.[1];
      const properties = [...query.matchAll(/appProperties has \{ key='([^']+)' and value='([^']+)' \}/g)];
      return Response.json({ files: [...files.values()].filter(file =>
        (!parent || file.parents.includes(parent)) && properties.every(([, key, value]) => file.appProperties[key] === value)
      ).map(({ bytes: _bytes, ...metadata }) => metadata) });
    }
    if (url.pathname === "/drive/v3/files" && method === "POST") {
      const body = JSON.parse(String(init.body || "{}"));
      const id = body.id || `fixture-folder-${randomUUID()}`;
      if (files.has(id)) return Response.json({ error: { message: "Fictional ID exists" } }, { status: 409 });
      const resource: Resource = { id, name: body.name, mimeType: body.mimeType, parents: body.parents, appProperties: body.appProperties || {}, driveId: sharedDrive, trashed: false };
      files.set(id, resource);
      return Response.json(resource);
    }
    if (url.pathname === "/upload/drive/v3/files" && method === "POST") {
      if (!(init.body instanceof FormData)) throw new Error("Simulated multipart body expected");
      const metadataPart = init.body.get("metadata"), filePart = init.body.get("file");
      if (!(metadataPart instanceof Blob) || !(filePart instanceof Blob)) throw new Error("Simulated multipart parts required");
      const metadata = JSON.parse(await metadataPart.text()), id = `fixture-file-${randomUUID()}`;
      const resource: Resource = { id, name: metadata.name, mimeType: filePart.type, parents: metadata.parents, driveId: sharedDrive, trashed: false, appProperties: {}, size: String(filePart.size), bytes: new Uint8Array(await filePart.arrayBuffer()) };
      files.set(id, resource);
      const { bytes: _bytes, ...result } = resource;
      return Response.json(result);
    }
    const resourceId = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/)?.[1];
    if (resourceId && method === "GET") {
      const resource = files.get(decodeURIComponent(resourceId));
      if (!resource) return Response.json({ error: { message: "Fictional resource absent" } }, { status: 404 });
      if (url.searchParams.get("alt") === "media") return new Response(resource.bytes ? Buffer.from(resource.bytes) : null, { headers: { "content-type": resource.mimeType } });
      const { bytes: _bytes, ...metadata } = resource;
      return Response.json(metadata);
    }
    throw new Error("Unimplemented simulated Google transport operation");
  };
}
