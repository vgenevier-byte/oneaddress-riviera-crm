/** Contact attachments live in the private document catalogue, never in a Contact payload. */
export const CONTACT_DOCUMENT_TYPES = ["Carte d’identité", "Passeport", "Permis de conduire", "Permis bateau", "Contrat", "Autre"] as const;
export type ContactDocumentType = typeof CONTACT_DOCUMENT_TYPES[number];
export const CONTACT_DOCUMENT_MAX_BYTES = 25_000_000;
export const CONTACT_DOCUMENT_ACCEPT = "application/pdf,image/jpeg,image/png";
const supported = new Set(CONTACT_DOCUMENT_ACCEPT.split(","));
export type ContactDocument = {
  provider: "storage" | "google-drive";
  resource_id: string;
  record_id: string;
  title: string;
  personal_contact?: boolean;
  document_type?: ContactDocumentType;
  file_name?: string;
  mime_type?: string;
  size_bytes?: number;
  expires_on?: string | null;
  created_by?: string;
  created_by_label?: string;
  created_at?: string;
  revision?: number;
  operation_id?: string;
  lifecycle?: "pending" | "active" | "superseded" | "withdrawn";
  superseded_by?: string | null;
  readonly?: boolean;
  replaceable?: boolean;
  deletable?: boolean;
  can_share?: boolean;
  bank?: boolean;
  shared_with?: {user_id: string; email?: string}[];
};
export type ContactDocumentProjection = {documents: ContactDocument[]; revision: string};
export type ContactDocumentDraft = {
  operationId: string;
  contactId: string;
  file: File;
  title: string;
  type: ContactDocumentType;
  expiry: string;
  previous?: Pick<ContactDocument, "resource_id" | "revision">;
};
type Result = {data: unknown; error: {message: string; statusCode?: string | number; error?: string} | null};
export type ContactDocumentTransport = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<Result>;
  upload: (path: string, file: File) => PromiseLike<Result>;
  check: () => Promise<void>;
  onReserved?: (row: ContactDocument) => void;
};
/** An earlier request may finish after a newer authorized catalogue read. */
export class ContactDocumentReadSequence {
  private latest = 0;
  start() { return ++this.latest; }
  current(request: number) { return request === this.latest; }
  invalidate() { this.latest++; }
}
export function validateContactDocumentFile(file: Pick<File,"size"|"type">): string | null {
  if (file.size <= 0 || file.size > CONTACT_DOCUMENT_MAX_BYTES) return "Chaque fichier doit contenir entre 1 octet et 25 Mo.";
  if (!supported.has(file.type)) return "Formats acceptés : PDF, JPEG et PNG.";
  return null;
}
function confirmedRow(value: unknown, draft: ContactDocumentDraft): ContactDocument {
  const row = value as ContactDocument | null;
  if (!row || row.provider !== "storage" || !row.resource_id || row.record_id !== draft.contactId || !["active", "pending"].includes(row.lifecycle ?? "")) throw new Error("Confirmation documentaire invalide. Rechargez la liste avant de reprendre.");
  return row;
}
/** Stable operation UUID makes a lost reservation/upload/confirmation safe to retry.
 * A successful item is removed from the batch by its caller; homonymous files remain distinct.
 */
export async function sendContactDocument(transport: ContactDocumentTransport, draft: ContactDocumentDraft, revision: string | null, signal?: AbortSignal): Promise<ContactDocument> {
  const validation = validateContactDocumentFile(draft.file);
  if (validation) throw new Error(validation);
  async function checkpoint() { signal?.throwIfAborted(); await transport.check(); signal?.throwIfAborted(); }
  async function rpc(name: string, args: Record<string, unknown>) {
    await checkpoint();
    const result = await transport.rpc(name, args);
    await checkpoint();
    if (result.error) throw new Error(result.error.message);
    return result.data;
  }
  const reserved = confirmedRow(await rpc("crm_contact_document_begin", {
    p_operation: draft.operationId, p_contact: draft.contactId, p_title: draft.title.trim(), p_type: draft.type,
    p_filename: draft.file.name, p_mime: draft.file.type, p_size: draft.file.size, p_expiry: draft.expiry || null, p_revision: revision
  }), draft);
  // Only a confirmed reservation locks a draft's metadata. A rejected file or
  // revision must remain removable and editable without a nonexistent cancel.
  transport.onReserved?.(reserved);
  let row = reserved;
  if (reserved.lifecycle === "pending") {
    await checkpoint();
    const uploaded = await transport.upload(reserved.resource_id, draft.file);
    await checkpoint();
    // An interrupted response can hide a successful upload. Only the server's
    // finalization may confirm that existing exact reserved object.
    if (uploaded.error && !(String(uploaded.error.statusCode) === "409" || uploaded.error.error === "Duplicate" || /already exists/i.test(uploaded.error.message))) throw new Error(uploaded.error.message);
    row = confirmedRow(await rpc("crm_contact_document_complete", {p_operation: draft.operationId}), draft);
    if (row.lifecycle !== "active") throw new Error("Le serveur n’a pas confirmé le fichier.");
  }
  if (draft.previous) {
    row = confirmedRow(await rpc("crm_contact_document_replace", {p_previous: draft.previous.resource_id, p_next: row.resource_id, p_revision: draft.previous.revision}), draft);
  }
  await checkpoint();
  return row;
}
export function contactDocumentError(error: unknown): string {
  const message = error instanceof Error ? error.message : (error as {message?: string})?.message ?? "Enregistrement non confirmé.";
  if (/revision_conflict|replacement_conflict/i.test(message)) return "Conflit : le catalogue a changé. Rechargez la liste avant de reprendre ; vos fichiers restent sélectionnés.";
  if (/invalid_contact_document_metadata|invalid_expiration_date/i.test(message)) return "Vérifiez l’intitulé, le nom, le format, la taille et la date d’expiration du fichier.";
  if (/contact_document_operation_conflict/i.test(message)) return "Cette tentative concerne une autre version de votre sélection. Retirez-la avant de sélectionner à nouveau le fichier.";
  if (/contact_document_already_confirmed/i.test(message)) return "L’import est déjà confirmé. Rechargez la liste pour le consulter.";
  if (/forbidden|inactive|permission|denied/i.test(message)) return "Action refusée : vérifiez vos droits Contacts, Documents et le partage de cette pièce.";
  if (/network|failed to fetch|fetch failed/i.test(message)) return "Connexion interrompue. Vérifiez la liste avant de reprendre les fichiers non confirmés.";
  return message;
}
