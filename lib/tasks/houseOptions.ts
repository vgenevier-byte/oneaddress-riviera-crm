import type { TaskApi, TaskTarget } from "./types";

/** The selector receives the complete authorized house catalogue. The common
 * select then ranks all candidates before limiting its visible suggestions. */
export async function loadTaskHouses(searchTargets: NonNullable<TaskApi["searchTargets"]>, signal?: AbortSignal): Promise<TaskTarget[]> {
  const houses = new Map<string, TaskTarget>();
  let offset = 0;
  for (;;) {
    signal?.throwIfAborted();
    // The production API already pages the SQL catalogue before its display
    // slice. Request all display results once; capped adapters still use the
    // hasMore fallback below without truncating the authorized candidates.
    const page = await searchTargets("", "house", offset, Number.MAX_SAFE_INTEGER);
    signal?.throwIfAborted();
    for (const house of page.items) {
      if (house?.ref?.type === "house" && house.ref.id && house.state !== "inaccessible" && house.state !== "deleted") houses.set(house.ref.id, house);
    }
    if (!page.hasMore) return [...houses.values()];
    if (!page.items.length) throw new Error("Catalogue de maisons incomplet.");
    offset += page.items.length;
  }
}
