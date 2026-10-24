/** Query fixtures only: no authenticated database, storage or network access. */
import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createGeneratorRepository } from "../../lib/izord/repository";

const records = Array.from({ length: 1251 }, (_, index) => ({ id: `project-${String(index).padStart(4,"0")}`, title: `Dossier ${index}`, revision: 12 }));
const history = records.flatMap(project => Array.from({ length: 12 }, (_, index) => ({ project_id: project.id, revision: index + 1, author_id: `author-${project.id}-${index + 1}` })));
function harness(onPage?: (table: string, page: number) => void) {
  const calls: { table: string; ids: string[]; from: number; to: number; orders: string[] }[] = [];
  const client = {
    storage: { from: () => ({}) },
    from(table: string) {
      let ids: string[] = [];
      const orders: string[] = [];
      const query = {
        select() { return query; }, in(_column: string, selected: string[]) { ids = selected; return query; },
        order(column: string) { orders.push(column); return query; },
        range(from: number, to: number) {
          calls.push({ table, ids, from, to, orders });
          const eligible = table === "izord_projects" ? records : history.filter(version => ids.includes(version.project_id));
          onPage?.(table, calls.length);
          return Promise.resolve({ data: eligible.slice(from,to + 1), error: null });
        }
      };
      return query;
    }
  } as unknown as SupabaseClient;
  return { repository: createGeneratorRepository(client), calls };
}

test("presentation source lists every RLS-readable project and current author beyond both first-page caps", async () => {
  const { repository, calls } = harness();
  const rows = await repository.listProjects();
  assert.equal(rows.length,1251);
  assert.equal(rows.at(-1)?.id,"project-1250");
  assert.equal(rows.find(row => row.id === "project-0099")?.author_id,"author-project-0099-12", "Current revision is past the first 1000 versions in its batch");
  assert.equal(rows.at(-1)?.author_id,"author-project-1250-12");
  assert.ok(rows.every(row => row.author_id === `author-${row.id}-12`));
  const projectCalls = calls.filter(call => call.table === "izord_projects"), versionCalls = calls.filter(call => call.table === "izord_project_versions");
  assert.deepEqual(projectCalls.map(call => call.from),[0,250,500,750,1000,1250]);
  assert.ok(projectCalls.every(call => call.orders.join(",") === "updated_at,id"));
  assert.ok(versionCalls.every(call => call.ids.length <= 100 && call.orders.join(",") === "project_id,revision"));
  assert.ok(versionCalls.some(call => call.from === 1000),"Version history is paginated within an ID batch");
});

for (const stop of ["projects", "versions"]) test(`cancelled ${stop} pagination returns no partial result and sends no next query`, async () => {
  const controller = new AbortController();
  const { repository, calls } = harness(table => {
    if (table === (stop === "projects" ? "izord_projects" : "izord_project_versions")) controller.abort();
  });
  await assert.rejects(repository.listProjects({ signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls.filter(call => call.table === (stop === "projects" ? "izord_projects" : "izord_project_versions")).length,1);
  if (stop === "projects") assert.ok(calls.every(call => call.table === "izord_projects"));
});
