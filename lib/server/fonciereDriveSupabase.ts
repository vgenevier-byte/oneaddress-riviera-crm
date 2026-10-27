import "server-only";
import { createClient } from "@supabase/supabase-js";
import { requireServerEnv } from "../../app/api/drive/_utils";
import { FonciereDriveError, type FonciereDriveStore, type DriveJob } from "./fonciereDrive";

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: "no-store" }) } };
export function createFonciereDriveUserClient(authorization: string | null) {
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) throw new FonciereDriveError("session_required", true);
  return createClient(requireServerEnv("NEXT_PUBLIC_SUPABASE_URL"), requireServerEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), { ...options, global: { ...options.global, headers: { Authorization: authorization } } });
}
export function createFonciereDriveStore(): FonciereDriveStore {
  // Same organization service credential as the existing original-photo reader;
  // it never reaches the browser and does not change an importer's export rights.
  const origin = requireServerEnv("NEXT_PUBLIC_SUPABASE_URL");
  const local = origin === "http://127.0.0.1:56031" && process.env.PREPAID_HOURS_TEST_ACK === "PREPAID_HOURS_LOCAL_ONLY";
  const server = createClient(origin, requireServerEnv(local ? "LOCAL_AUTH_INVITE_KEY" : "CRM_INVITE_AUTH_KEY"), options);
  async function call<T>(operation: string, data: Record<string, unknown> = {}): Promise<T> {
    const result = await server.rpc("fonciere_drive_worker", { p_operation: operation, p_data: data }).abortSignal(AbortSignal.timeout(15000));
    if (result.error) throw new FonciereDriveError(result.error.code === "42501" ? "crm_original_invalid" : "drive_registry_unavailable", result.error.code === "42501");
    return result.data as T;
  }
  async function original(job: DriveJob) {
    const args = { id: job.id, lease_token: job.lease_token };
    await call("asset_validate", args);
    const result = await server.storage.from("fonciere-documents").download(job.object_path);
    if (result.error || !result.data) throw new FonciereDriveError("crm_original_unavailable");
    await call("asset_validate", args);
    return result.data;
  }
  return { call, original };
}
