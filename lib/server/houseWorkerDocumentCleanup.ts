import "server-only";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

type CleanupResult = { operation_id: string; status: "pending" | "completed"; action: "delete" | "keep"; refs_removed: number };
export type CleanupJob = CleanupResult & { bucket_id: string; object_path: string; object_id: string; object_version: string; object_missing: boolean };
export type CleanupStore = {
  check(operation: string, lease: string): Promise<CleanupJob>;
  remove(bucket: string, path: string): Promise<void>;
  complete(operation: string, lease: string): Promise<CleanupResult>;
  release(operation: string, lease: string): Promise<void>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function configured(name: string) {
  const value = process.env[name];
  if (!value) throw new Error("cleanup_unconfigured");
  return value;
}
function createCleanupStore(): CleanupStore {
  const origin = configured("NEXT_PUBLIC_SUPABASE_URL");
  const local = origin === "http://127.0.0.1:55431" && process.env.IZORD_TEST_ACK === "IZORD_DISPOSABLE_LOCAL_ONLY";
  const server = createClient(origin, configured(local ? "LOCAL_AUTH_INVITE_KEY" : "CRM_INVITE_AUTH_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: "no-store", signal: init?.signal ?? AbortSignal.timeout(15000) }) }
  });
  async function rpc<T>(name: string, operation: string, lease: string): Promise<T> {
    const { data, error } = await server.rpc(name, { p_operation: operation, p_lease: lease }).abortSignal(AbortSignal.timeout(8000));
    if (error || !data) throw new Error("cleanup_not_confirmed");
    return data as T;
  }
  return {
    check: (operation, lease) => rpc("crm_house_worker_document_removal_check", operation, lease),
    complete: (operation, lease) => rpc("crm_house_worker_document_removal_complete", operation, lease),
    async release(operation, lease) {
      const { error } = await server.rpc("crm_house_worker_document_removal_release", { p_operation: operation, p_lease: lease }).abortSignal(AbortSignal.timeout(8000));
      if (error) throw new Error("cleanup_not_confirmed");
    },
    async remove(bucket, path) {
      // The immutable, service-only SQL reservation supplies this one exact object.
      // Storage's deletion API removes the bytes; no storage.objects SQL deletion.
      const { error } = await server.storage.from(bucket).remove([path]);
      if (error) throw new Error("cleanup_storage_not_confirmed");
    }
  };
}

/** Executes an already authorized, expiring SQL reservation. This route cannot
 * create or extend a job or accept a file target. Its UUID is an execution handle,
 * not CRM identity or a grant. Only service-role begin can authorize a deletion.
 * No paths, file metadata or credentials are returned to the caller. */
export function createHouseWorkerDocumentCleanupHandler(dependencies: { createStore?: () => CleanupStore } = {}) {
  return async function POST(request: Request) {
    const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1
      || !("operationId" in body) || typeof body.operationId !== "string" || !uuid.test(body.operationId)) {
      return Response.json({ ok: false, error: "Opération de nettoyage invalide." }, { status: 400, headers });
    }
    const operation = body.operationId.toLowerCase(), lease = randomUUID();
    let store: CleanupStore | undefined, leased = false;
    try {
      store = (dependencies.createStore ?? createCleanupStore)();
      const job = await store.check(operation, lease);
      if (job.operation_id !== operation || !["delete", "keep"].includes(job.action)) throw new Error("cleanup_invalid_job");
      if (job.status !== "completed") {
        if (job.status !== "pending" || job.bucket_id !== "crm-documents" || !uuid.test(job.object_id)
          || typeof job.object_path !== "string" || !job.object_path || job.object_path.endsWith("/")
          || !job.object_version || typeof job.object_missing !== "boolean") throw new Error("cleanup_invalid_job");
        leased = true;
        if (job.action === "delete" && !job.object_missing) await store.remove(job.bucket_id, job.object_path);
      }
      const result = job.status === "completed" ? job : await store.complete(operation, lease);
      if (result.operation_id !== operation || result.status !== "completed" || result.action !== job.action
        || !Number.isInteger(result.refs_removed) || result.refs_removed < 0) throw new Error("cleanup_not_confirmed");
      return Response.json({ ok: true, completed: true, disposition: result.action === "delete" ? "deleted" : "retained",
        referencesRemoved: result.refs_removed }, { headers });
    } catch {
      if (store && leased) await store.release(operation, lease).catch(() => undefined);
      return Response.json({ ok: false, error: "Nettoyage non confirmé. Reprendre la même opération." }, { status: 503, headers });
    }
  };
}
