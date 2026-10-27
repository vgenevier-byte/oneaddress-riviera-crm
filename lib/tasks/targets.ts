import { createSearchIndex, searchIndex } from "../search";
import { taskTargetKey } from "./domain";
import type { TaskTarget, TaskTargetPage } from "./types";

/** Page the complete authorized catalogue before ranking. There is no browser
 * cache and no arbitrary first-page cap before matching. */
export async function searchTaskTargets(
  fetchPage: (offset: number, limit: number) => Promise<TaskTargetPage>,
  query: string, offset = 0, limit = 40,
  additional: () => Promise<TaskTarget[]> = async () => []
): Promise<TaskTargetPage> {
  const targets: TaskTarget[] = [];
  let pageOffset = 0;
  for (;;) {
    const page = await fetchPage(pageOffset, 200);
    targets.push(...page.items.filter(item => item?.ref?.type && item.ref.id && item.state !== "inaccessible"));
    if (!page.hasMore) break;
    if (!page.items.length) throw new Error("Catalogue incomplet. Réessayez la recherche.");
    pageOffset += page.items.length;
  }
  targets.push(...(await additional()).filter(item => item?.ref?.type && item.ref.id && item.state !== "inaccessible"));
  const index = createSearchIndex(targets, target => [target.projectReference, target.projectNumber, target.label, target.detail, target.status, target.ref.id, ...(target.searchFields ?? [])], { getId: target => taskTargetKey(target.ref), getLabel: target => target.label, getExactFields: target => [target.projectReference, target.projectNumber, target.projectReference?.replace(/^PRJ-/i, "")] });
  const ranked = searchIndex(index, query);
  return { items: ranked.slice(offset, offset + limit).map(hit => ({ ...hit.item, approximate: hit.approximate })), hasMore: ranked.length > offset + limit };
}
