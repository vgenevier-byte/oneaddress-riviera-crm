import { createSearchIndex, searchIndex, type SearchHit } from "../search";
import type { FonciereData } from "./model";

/** Only server-confirmed references are displayed; never derive a draft number. */
export type ProjectIdentity = { id: string; title: string; project_reference?: string | null; project_number?: number | string | null };
export function projectReferenceFields(project: ProjectIdentity): string[] {
  return [project.project_reference, project.project_number === null || project.project_number === undefined ? "" : String(project.project_number), project.project_reference?.replace(/^PRJ-/i, "")].filter((value): value is string => Boolean(value));
}
export function compareProjectNumbers(left: ProjectIdentity, right: ProjectIdentity): number {
  const a = Number(left.project_number), b = Number(right.project_number);
  const validA = Number.isSafeInteger(a) && a > 0, validB = Number.isSafeInteger(b) && b > 0;
  return (validA && validB ? a - b : validA ? -1 : validB ? 1 : 0) || left.id.localeCompare(right.id);
}
export function projectSearchFields(project: ProjectIdentity & { payload?: { data?: Partial<FonciereData> } }): (string | undefined)[] {
  const data = project.payload?.data;
  return [...projectReferenceFields(project), project.id, project.title, data?.name, data?.propertyAddress, data?.city, data?.agencyReference,
    data?.agencyName, data?.agentName, data?.agentEmail, data?.agentPhone];
}
export function searchProjects<T extends ProjectIdentity>(projects: readonly T[], query: string): SearchHit<T>[] {
  const index = createSearchIndex([...projects].sort(compareProjectNumbers), projectSearchFields,
    { getId: project => project.id, getLabel: project => project.title, getExactFields: projectReferenceFields });
  return searchIndex(index, query, { preserveEmptyOrder: true });
}
