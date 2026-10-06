import "server-only";
import { createClient } from "@supabase/supabase-js";
import { DriveRouteError, requireServerEnv } from "../../app/api/drive/_utils";

export type DocumentTrashInput = {
  operationId: string;
  documentId: string;
  fileId: string;
  parentFolderId: string;
  parentDriveFolderId: string;
  revision: string;
};

export type DocumentTrashOperation = {
  operation_id: string;
  record_id: string;
  resource_id: string;
  parent_record_id: string;
  parent_resource_id: string;
  is_folder: boolean;
  status: "pending" | "completed";
  snapshot: Record<string, unknown>;
  title: string;
  folder_title: string;
  workspace_revision?: string;
  previous_workspace_revision?: string;
  workspace_payload?: Record<string, unknown>;
};

export type DocumentTrashStore = {
  preview(input: DocumentTrashInput): Promise<DocumentTrashOperation>;
  prepare(input: DocumentTrashInput): Promise<DocumentTrashOperation>;
  complete(operationId: string, drive: Record<string, unknown>): Promise<DocumentTrashOperation>;
};

function rpcError(error: { message: string; code?: string }): never {
  const messages: Record<string, string> = {
    document_trash_forbidden: "Contribution Documents et droit Suppression requis pour cette ressource.",
    document_actor_inactive: "Session CRM absente, expirée ou inactive.",
    document_trash_target_invalid: "Le document ou son rattachement a changé. Rechargez les documents avant de reprendre.",
    document_trash_root_forbidden: "La racine des documents ne peut pas être mise à la corbeille.",
    document_trash_referenced: "Ce fichier est encore référencé ailleurs dans le CRM. Retirez ces usages avant de le mettre à la corbeille.",
    document_trash_folder_not_empty: "Ce dossier contient encore des fichiers ou sous-dossiers dans le CRM.",
    document_trash_operation_conflict: "Cette opération appartient à une autre cible. Rechargez les documents.",
    revision_conflict: "La version cloud a changé. Rechargez les données avant de mettre ce document à la corbeille.",
    invalid_document_target: "Identifiants CRM/Drive invalides ou ressource protégée. Aucune mise à la corbeille effectuée.",
    document_missing_or_ambiguous: "La cible CRM est absente ou possède plusieurs références. Rechargez les documents.",
    document_parent_mismatch: "Le rattachement du document ou dossier a changé. Rechargez les documents.",
    document_folder_not_empty: "Ce dossier contient encore des fichiers ou sous-dossiers dans le CRM.",
    document_referenced_or_protected: "Cette ressource est protégée ou encore référencée ailleurs dans le CRM. Retirez ses autres usages avant de la mettre à la corbeille.",
    document_trash_identity_conflict: "Une opération existe déjà pour une autre cible ou un autre compte. Reprenez depuis le compte qui l’a commencée.",
    document_trash_other_actor: "Cette mise à la corbeille a été commencée depuis un autre compte. Reprenez depuis le compte initial.",
    document_trash_revision_conflict: "La fiche CRM a changé. Son retrait n’est pas confirmé ; reprenez la même opération."
  };
  const known = Object.keys(messages).find(key => error.message.includes(key));
  throw new DriveRouteError(known ? messages[known] : "État CRM non confirmé. Reprenez la même mise à la corbeille.",
    error.code === "42501" ? 403 : known ? 409 : 503);
}

/** The existing private Auth administration key is reused only for finalization.
 * User JWT authorization and exact CRM identity are checked by begin, before WIF.
 * Nothing here changes invitation activation, credentials, grants or Google IAM.
 */
export function createDocumentTrashStore(request: Request, actorId: string): DocumentTrashStore {
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
    throw new DriveRouteError("Session CRM requise.", 401);
  }
  const origin = requireServerEnv("NEXT_PUBLIC_SUPABASE_URL");
  const local = origin === "http://127.0.0.1:55431" && process.env.IZORD_TEST_ACK === "IZORD_DISPOSABLE_LOCAL_ONLY";
  const adminKey = requireServerEnv(local ? "LOCAL_AUTH_INVITE_KEY" : "CRM_INVITE_AUTH_KEY");
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: "no-store" }) } };
  const user = createClient(origin, requireServerEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    ...options, global: { ...options.global, headers: { Authorization: authorization } }
  });
  const server = createClient(origin, adminKey, options);
  async function begin(input: DocumentTrashInput, preview: boolean): Promise<DocumentTrashOperation> {
    const { data, error } = await user.rpc("crm_document_trash_begin", {
      p_operation: input.operationId, p_record: input.documentId, p_resource: input.fileId,
      p_parent_record: input.parentFolderId, p_parent_resource: input.parentDriveFolderId,
      p_revision: input.revision || null, p_preview: preview
    }).abortSignal(AbortSignal.timeout(8000));
    if (error) rpcError(error);
    if (!data || typeof data !== "object") throw new DriveRouteError("État CRM indisponible.", 503);
    return data as DocumentTrashOperation;
  }
  return {
    preview: input => begin(input, true),
    prepare: input => begin(input, false),
    async complete(operationId, drive) {
      const { data, error } = await server.rpc("crm_document_trash_complete", {
        p_operation: operationId, p_actor: actorId, p_drive: drive
      }).abortSignal(AbortSignal.timeout(8000));
      if (error) rpcError(error);
      if (!data || typeof data !== "object" || data.status !== "completed") {
        throw new DriveRouteError("État CRM non confirmé. Reprenez la même mise à la corbeille.", 503);
      }
      return data as DocumentTrashOperation;
    }
  };
}
