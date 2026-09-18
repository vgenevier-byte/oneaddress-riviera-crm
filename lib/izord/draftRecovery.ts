import { createProjectData, type ProjectData } from "./model";
import type { AgencyReport } from "./agency";
import type { LoadedProject, ProjectRecord, ProjectStatus } from "./repository";

// One committed editor snapshot, owned by one portal instance. Never serialized.
// Existing file, image and import budgets still apply; no second draft is retained.
export type GeneratorDraft = {
  draftId: string;
  data: ProjectData | null;
  loaded: LoadedProject | null;
  dirty: boolean;
  sourceFiles: File[];
  reports: AgencyReport[];
  reportIndex: number;
  reviewed: boolean;
  pdfFiles: File[];
  conflict: boolean;
  workflow: ProjectStatus;
};
export type DraftRecovery = { userId: string; workspace: "izord"; role: string; draft: GeneratorDraft };
export type VerifiedDraftProject = Pick<ProjectRecord, "id" | "revision" | "status" | "payload">;

export function temporaryAccessFailure(error: unknown, status?: number): boolean {
  const value = error as { status?: number; name?: string } | null;
  const code = status ?? value?.status;
  if (code !== undefined) return code === 0 || code === 408 || code === 429 || code >= 500;
  return error instanceof TypeError || ["AuthRetryableFetchError", "AbortError", "TimeoutError"].includes(value?.name ?? "");
}
export function reducedIzordRole(previous: string, current: string): boolean {
  const rank: Record<string, number> = { reader: 0, contributor: 1, partner: 2, admin: 3 };
  return !(current in rank) || (rank[current] ?? -1) < (rank[previous] ?? -1);
}
export function draftTarget(draft: GeneratorDraft | undefined): string {
  return draft ? `${draft.draftId}:${draft.loaded?.project.id ?? "new"}:${draft.loaded?.project.revision ?? "new"}` : "none";
}
export function resumeGeneratorDraft(recovery: DraftRecovery, userId: string, role: string, project: VerifiedDraftProject | null): GeneratorDraft | undefined {
  if (recovery.userId !== userId || recovery.workspace !== "izord" || reducedIzordRole(recovery.role, role) || role === "reader") return undefined;
  const draft = recovery.draft;
  if (draft.loaded && project?.id !== draft.loaded.project.id) return undefined;
  if (!draft.loaded && project) return undefined;
  // The old CAS revision is deliberately retained. A remote save must conflict.
  // Official workflow and proposed decision are read anew, never revived as authority.
  const decision = (project?.payload as { data?: { state?: { decision?: unknown } } } | undefined)?.data?.state?.decision;
  const defaultDecision = createProjectData().state.decision;
  return {
    ...draft,
    data: draft.data ? { ...draft.data, state: { ...draft.data.state, decision: typeof decision === "string" ? decision : defaultDecision } } : null,
    loaded: draft.loaded && project ? { ...draft.loaded, project: { ...draft.loaded.project, status: project.status }, assets: [] } : null,
    workflow: project?.status ?? "draft",
  };
}
