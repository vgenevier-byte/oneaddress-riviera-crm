/** Unit tests with deferred Supabase/transport doubles. No Auth, Storage or network
 * integration is claimed: they prove cancellation between awaited continuations. */
import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createGeneratorRepository, type AssetRecord, type OperationOptions, type ProjectRecord } from "../../lib/izord/repository";
import { createProjectData } from "../../lib/izord/model";

const projectId = "11111111-1111-4111-8111-111111111111", userId = "22222222-2222-4222-8222-222222222222", assetId = "33333333-3333-4333-8333-333333333333";
const project: ProjectRecord = { id: projectId, owner_id: userId, title: "Projet fictif", revision: 7, payload: {}, status: "draft", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z" };
const asset = { id: assetId, project_id: projectId, project_revision: 7, object_path: `${projectId}/${assetId}`, kind: "presentation", lifecycle: "finalized" } as AssetRecord;
const ppt = new Blob([new Uint8Array([80, 75, 3, 4, 0])], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
type Reply = { data: unknown; error: null };
type Repository = ReturnType<typeof createGeneratorRepository>;

function harness(block?: string) {
  const calls: string[] = [];
  let release: () => void = () => { throw Error("No deferred operation entered"); };
  let entered: () => void = () => {};
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  function step(label: string, data: unknown): Promise<Reply> {
    calls.push(label);
    if (label !== block) return Promise.resolve({ data, error: null });
    entered();
    return new Promise<Reply>(resolve => { release = () => resolve({ data, error: null }); });
  }
  const client = {
    auth: {
      getUser: () => step("auth:user", { user: { id: userId } }),
      getSession: () => step("auth:session", { session: { user: { id: userId } } }),
    },
    rpc: (name: string) => step(`rpc:${name}`, name === "izord_create_project" ? projectId : name === "izord_register_generator_asset" ? asset.object_path : name === "izord_save_generator" ? 8 : null),
    storage: { from: () => ({
      createSignedUploadUrl: () => step("storage:sign", { signedUrl: "https://storage.invalid/fictional-signed-path" }),
      download: () => step("storage:download", ppt),
    }) },
    from: (table: string) => {
      const rows = table === "izord_projects" ? [{ ...project, revision: 8 }] : table === "izord_assets" ? [asset] : [{ project_id: projectId, revision: 8, author_id: userId }];
      const query = {
        select: () => query, eq: () => query,
        single: () => step(`select:${table}`, rows[0]),
        order: () => step(`select:${table}`, rows),
        in: () => step(`select:${table}`, rows),
      };
      return query;
    },
  };
  return { repository: createGeneratorRepository(client as unknown as SupabaseClient), calls, waiting, release: () => release(), step };
}

test("closed access lease refuses every public repository entry before any request", async () => {
  const { repository, calls } = harness(), lease = new AbortController(); lease.abort();
  const options = { signal: lease.signal };
  const actions = [
    () => repository.listProjects(options), () => repository.listAssets(projectId, options), () => repository.listVersions(projectId, options),
    () => repository.createProject("Fictif", options), () => repository.loadProject(projectId, options),
    () => repository.saveProject({ project, data: createProjectData() }, options),
    () => repository.downloadAsset(asset, options), () => repository.uploadPresentation(project, ppt, options),
    () => repository.abandonAsset(assetId, options), () => repository.setReaderDownload(assetId, true, options),
  ];
  for (const action of actions) await assert.rejects(action(), { name: "AbortError" });
  assert.deepEqual(calls, []);
});

const cases: { name: string; hold: string; execute: (repository: Repository, options: OperationOptions) => Promise<unknown>; transport?: boolean }[] = [
  { name: "late creation may have committed but triggers no project read", hold: "rpc:izord_create_project", execute: (r, o) => r.createProject("Fictif", o) },
  { name: "creation project response triggers no version read after suspension", hold: "select:izord_projects", execute: (r, o) => r.createProject("Fictif", o) },
  { name: "late creation history cannot return an opened project", hold: "select:izord_project_versions", execute: (r, o) => r.createProject("Fictif", o) },
  { name: "late project list starts no author/version lookup", hold: "select:izord_projects", execute: (r, o) => r.listProjects(o) },
  { name: "late author lookup cannot return a usable project list", hold: "select:izord_project_versions", execute: (r, o) => r.listProjects(o) },
  { name: "late Auth verification starts no project hydration", hold: "auth:user", execute: (r, o) => r.loadProject(projectId, o) },
  { name: "late loaded project history starts no asset listing", hold: "select:izord_project_versions", execute: (r, o) => r.loadProject(projectId, o) },
  { name: "late asset listing starts no further Auth or photo download", hold: "select:izord_assets", execute: (r, o) => r.loadProject(projectId, o) },
  { name: "late downloaded bytes are never returned for a browser download", hold: "storage:download", execute: (r, o) => r.downloadAsset(asset, o) },
  { name: "late asset registration does not obtain an upload capability", hold: "rpc:izord_register_generator_asset", execute: (r, o) => r.uploadPresentation(project, ppt, o) },
  { name: "late signed capability never starts its byte transfer", hold: "storage:sign", execute: (r, o) => r.uploadPresentation(project, ppt, o) },
  { name: "late byte transfer never continues to finalization", hold: "transport:upload", execute: (r, o) => r.uploadPresentation(project, ppt, o), transport: true },
  { name: "late finalized upload triggers no asset listing or success result", hold: "rpc:izord_finalize_asset", execute: (r, o) => r.uploadPresentation(project, ppt, o), transport: true },
  { name: "late save acknowledgment starts no reread and emits no confirmed progress", hold: "rpc:izord_save_generator", execute: (r, o) => r.saveProject({ project, data: createProjectData() }, o) },
  { name: "late saved project reread starts no history query", hold: "select:izord_projects", execute: (r, o) => r.saveProject({ project, data: createProjectData() }, o) },
  { name: "late saved asset list emits no confirmed progress or saved state", hold: "select:izord_assets", execute: (r, o) => r.saveProject({ project, data: createProjectData() }, o) },
  { name: "late logical withdrawal is not reported as an active-context success", hold: "rpc:izord_withdraw_asset", execute: (r, o) => r.abandonAsset(assetId, o) },
  { name: "late reader publication is not reported as an active-context success", hold: "rpc:izord_allow_reader_download", execute: (r, o) => r.setReaderDownload(assetId, true, o) },
];
for (const scenario of cases) test(scenario.name, { timeout: 3000 }, async t => {
  const h = harness(scenario.hold), lease = new AbortController(), progress: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    if (!scenario.transport) throw Error("Unexpected transport request in unit test");
    await h.step("transport:upload", null);
    return new Response(null, { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const operation = scenario.execute(h.repository, { signal: lease.signal, onProgress: event => progress.push(`${event.stage}:${event.completed}/${event.total}`) });
  await h.waiting;
  const before = [...h.calls], progressBefore = [...progress];
  lease.abort(); h.release();
  await assert.rejects(operation, { name: "AbortError" });
  assert.deepEqual(h.calls, before, "No additional protected request after the lease closes");
  assert.deepEqual(progress, progressBefore, "No late progress or confirmed-save notification");
});
