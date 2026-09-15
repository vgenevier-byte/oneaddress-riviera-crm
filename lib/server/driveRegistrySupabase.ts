import "server-only";
import { createClient } from "@supabase/supabase-js";
import { DriveRouteError, requireServerEnv } from "../../app/api/drive/_utils";
import type { FolderIdentity, FolderRegistry } from "../../app/api/drive/_folderRegistry";

// Called only after requireAuthenticatedCRMUser has verified this request's JWT.
// The client is private: only the three registry operations are exposed.
export function createFolderRegistry(authorization: string | null): FolderRegistry {
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
    throw new DriveRouteError("Session CRM requise.", 401);
  }
  const client = createClient(requireServerEnv("NEXT_PUBLIC_SUPABASE_URL"), requireServerEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  async function rpc(name: "crm_drive_folder_claim" | "crm_drive_folder_reserve" | "crm_drive_folder_ready", parameters: Record<string, string>) {
    try {
      const { data, error } = await client.rpc(name, parameters).abortSignal(AbortSignal.timeout(8000));
      if (error) throw error;
      return data;
    } catch {
      throw new DriveRouteError("Service temporairement indisponible.", 503);
    }
  }
  const args = (identity: FolderIdentity, token: string) => ({
    p_workspace_id: identity.workspaceId, p_logical_key: identity.logicalKey, p_lease_token: token
  });
  return {
    claim: (identity, token) => rpc("crm_drive_folder_claim", { ...args(identity, token), p_parent_id: identity.parentId }),
    reserve: (identity, token, id) => rpc("crm_drive_folder_reserve", { ...args(identity, token), p_drive_folder_id: id }),
    ready: (identity, token, id) => rpc("crm_drive_folder_ready", { ...args(identity, token), p_drive_folder_id: id })
  };
}
