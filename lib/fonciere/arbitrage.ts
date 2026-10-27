import type { SupabaseClient } from "@supabase/supabase-js";

export type ArbitrationChoice = "pending" | "approved" | "refused" | "deepen";
export type ArbitrationSlot = "vincent" | "ann_charlotte";
export type ArbitrationOpinion = { choice: ArbitrationChoice; remark: string; recordedAt: string; authorId: string; fingerprint: string; stale: boolean };
export type ArbitrationSummary = { status: ArbitrationChoice; pending: ArbitrationSlot[]; disagreement: boolean };
export type ArbitrationConfig = { revision: number; vincent: string | null; annCharlotte: string | null };
export type ArbitrationState = ArbitrationSummary & {
  projectId: string; fingerprint: string; revision: number; private: boolean; canVote: ArbitrationSlot | null;
  opinions?: Partial<Record<ArbitrationSlot, ArbitrationOpinion>>;
  history?: (ArbitrationOpinion & { slot: ArbitrationSlot })[];
  bank: { presentationId: string | null; state: "none" | "pending" | "preparing" | "ready" | "blocked"; reason: string | null; approvedFingerprint: string | null; currentApproval: boolean; needsUpdate: boolean; canPrepare: boolean; canOpen: boolean; missing: string[] };
};
export class ArbitrationConflictError extends Error {
  constructor() { super("Le dossier a changé depuis sa consultation. Relisez sa version enregistrée avant de confirmer votre avis. Votre remarque est conservée."); this.name = "ArbitrationConflictError"; }
}
export function createArbitrageRepository(client: SupabaseClient) {
  async function rpc<T>(name: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    let request = client.rpc(name, args);
    if (signal) request = request.abortSignal(signal);
    const result = await request;
    signal?.throwIfAborted();
    if (result.error) {
      if (result.error.code === "40001") throw new ArbitrationConflictError();
      if (result.error.code === "42501") throw new Error("Opération refusée : vérifiez votre compte et vos droits sur le projet.");
      if (result.error.message === "arbitrage_remark_required") throw new Error("La remarque est obligatoire pour un refus ou une demande d’approfondissement.");
      if (result.error.message === "arbitrage_accounts_must_differ") throw new Error("Les comptes de Vincent et Ann Charlotte doivent être distincts.");
      throw new Error("L’enregistrement n’a pas été confirmé. Votre saisie est conservée ; vérifiez l’état enregistré avant de réessayer.");
    }
    return result.data as T;
  }
  return {
    read: (projectId: string, signal?: AbortSignal) => rpc<ArbitrationState>("fonciere_arbitrage_read", { p_project: projectId }, signal),
    list: (signal?: AbortSignal) => rpc<Record<string, ArbitrationSummary>>("fonciere_arbitrage_list", {}, signal),
    vote: (projectId: string, fingerprint: string, choice: ArbitrationChoice, remark: string, signal?: AbortSignal) => rpc<ArbitrationState>("fonciere_arbitrage_vote", { p_project: projectId, p_fingerprint: fingerprint, p_choice: choice, p_remark: remark }, signal),
    readConfig: (signal?: AbortSignal) => rpc<ArbitrationConfig>("fonciere_arbitrage_config", {}, signal),
    saveConfig: (configuration: ArbitrationConfig, signal?: AbortSignal) => rpc<ArbitrationConfig>("fonciere_arbitrage_config_save", { p_revision: configuration.revision, p_vincent: configuration.vincent || null, p_ann_charlotte: configuration.annCharlotte || null }, signal),
  };
}
