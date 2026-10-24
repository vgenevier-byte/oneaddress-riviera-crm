import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFonciereRepository } from "../../lib/fonciere/repository";

/** Local query fixture only: real server RLS is unchanged and not exercised here. */
test("Fonciere project source reads every authorized page with deterministic ordering", async () => {
  const records = Array.from({ length: 1251 }, (_, position) => ({ id: `project-${position}`, title: position === 1250 ? "Villa des Oliviers à Cannes" : `Project ${position}` }));
  const ranges: number[][] = [], orders: string[] = [];
  const client = {
    storage: { from: () => ({}) },
    from(table: string) {
      assert.equal(table, "fonciere_projects");
      const query = {
        select(columns: string) { assert.equal(columns, "*"); return query; },
        order(column: string) { orders.push(column); return query; },
        range(from: number, to: number) { ranges.push([from, to]); return Promise.resolve({ data: records.slice(from, to + 1), error: null }); }
      };
      return query;
    }
  } as unknown as SupabaseClient;
  const rows = await createFonciereRepository(client).listProjects();
  assert.equal(rows.length, records.length);
  assert.equal(rows.at(-1)?.id, "project-1250", "A source beyond the first 1000 rows remains searchable");
  assert.deepEqual(ranges, [[0,249], [250,499], [500,749], [750,999], [1000,1249], [1250,1499]]);
  assert.deepEqual(orders, Array.from({ length: 6 }, () => ["updated_at", "id"]).flat());
});

test("a cancelled source search cannot admit a partially loaded project list", async () => {
  const controller = new AbortController();
  let pages = 0;
  const client = {
    storage: { from: () => ({}) },
    from() {
      const query = { select: () => query, order: () => query, range: () => { pages++; controller.abort(); return Promise.resolve({ data: [{ id: "stale" }], error: null }); } };
      return query;
    }
  } as unknown as SupabaseClient;
  await assert.rejects(createFonciereRepository(client).listProjects({ signal: controller.signal }), { name: "AbortError" });
  assert.equal(pages, 1);
});
