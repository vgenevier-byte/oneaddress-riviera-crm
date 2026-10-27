/** Transport fixtures isolate preservation/preflight regressions. Actual Auth,
 * RPC, Storage, browser and mid-response revocation run in the sibling scripts. */
import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFonciereData, FONCIERE_SCHEMA } from "../../lib/fonciere/model";
import { createFonciereRepository, type FonciereProjectRecord, type StoredFoncierePayload } from "../../lib/fonciere/repository";
import { createProjectData } from "../../lib/izord/model";
import { createGeneratorRepository, type LoadedProject, type ProjectRecord } from "../../lib/izord/repository";

const projectId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const photoIds = ["33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555", "66666666-6666-4666-8666-666666666666"];
const documentId = "77777777-7777-4777-8777-777777777777";
const sourceId = "88888888-8888-4888-8888-888888888888";
const timestamp = "2026-10-27T00:00:00.000Z";
const preview = "data:image/jpeg;base64," + Buffer.concat([Buffer.from(createProjectData().photos.main.split(",")[1], "base64"), Buffer.from([1])]).toString("base64");

function forbiddenStorage(transfers: string[]) {
  return { from: () => ({
    download: () => { transfers.push("download"); throw new Error("Unexpected original download"); },
    upload: () => { transfers.push("upload"); throw new Error("Unexpected preview upload"); },
    createSignedUploadUrl: () => { transfers.push("signed-upload"); throw new Error("Unexpected byte transfer"); }
  }) };
}

test("saving a viewed Fonciere record retains distinct original slots and document references when all previews have equal bytes", async () => {
  const data = createFonciereData(); data.name = "Fictional preview preservation";
  data.presentationData.photos.main = preview; data.presentationData.photos.view = preview;
  data.presentationData.importGallery = [0, 1].map(index => ({ data: preview, label: `Distinct original ${index}`, page: null, width: 160, height: 120, source: "" }));
  data.presentationData.photoGalleryRoles = { main: 0, view: 1 };
  const canonical = structuredClone(data);
  canonical.presentationData.photos = { main: photoIds[0], view: photoIds[1], inside: "", operation: "" };
  canonical.presentationData.importGallery.forEach((photo, index) => { photo.data = photoIds[index + 2]; });
  let persisted: StoredFoncierePayload = { schema: FONCIERE_SCHEMA, data: canonical, sourceDocuments: [documentId] }, revision = 7;
  const project = (): FonciereProjectRecord => ({ id: projectId, owner_id: ownerId, title: data.name, revision, status: "active", payload: persisted, created_at: timestamp, updated_at: timestamp });
  const transfers: string[] = [], calls: string[] = [];
  const client = {
    storage: forbiddenStorage(transfers),
    rpc: async (name: string, args: { p_payload: StoredFoncierePayload }) => { calls.push(name); assert.equal(name, "fonciere_save_project"); persisted = structuredClone(args.p_payload); revision++; return { data: projectId, error: null }; },
    from: (table: string) => {
      assert(["fonciere_projects", "fonciere_assets"].includes(table));
      const query = { select: () => query, eq: () => query, single: async () => ({ data: project(), error: null }), order: async () => ({ data: [], error: null }) };
      return query;
    }
  } as unknown as SupabaseClient;
  const before = { project: project(), data: structuredClone(data), assets: [], sourceDocuments: [documentId] }, original = structuredClone(before.project.payload);
  const edited = structuredClone(data); edited.notes = "Metadata edit without original downloads";
  const saved = await createFonciereRepository(client).saveProject({ data: edited, previous: before });
  assert.equal(saved.project.revision, 8);
  assert.deepEqual(persisted.data.presentationData.photos, original.data.presentationData.photos);
  assert.deepEqual(persisted.data.presentationData.importGallery, original.data.presentationData.importGallery);
  assert.deepEqual(persisted.data.presentationData.photoGalleryRoles, original.data.presentationData.photoGalleryRoles);
  assert.deepEqual(persisted.sourceDocuments, [documentId]);
  assert.deepEqual(transfers, []);
  assert.deepEqual(calls, ["fonciere_save_project"]);
  assert.deepEqual(before.project.payload, original, "Saving does not alter the caller's previous baseline");
});

test("new source admission rejects before target creation, actor reads or byte transfers and leaves the draft intact", async () => {
  const calls: string[] = [], transfers: string[] = [];
  let actorReads = 0, tableReads = 0;
  const client = {
    auth: { getUser: async () => { actorReads++; throw new Error("Preflight must precede actor/target work"); } },
    storage: forbiddenStorage(transfers),
    from: () => { tableReads++; throw new Error("Preflight must precede target work"); },
    rpc: async (name: string) => { calls.push(name); assert.equal(name, "fonciere_authorize_transfer"); return { data: null, error: { code: "42501" } }; }
  } as unknown as SupabaseClient;
  const repository = createGeneratorRepository(client), data = createProjectData();
  data.state.project = "Retained fictitious draft"; data.importMeta = { fonciereSource: { id: sourceId, revision: 4, capturedAt: timestamp } };
  const original = structuredClone(data);
  // This public admission is called by the generator before createProject.
  await assert.rejects(repository.authorizeSource(data), /refusée/);
  const target: ProjectRecord = { id: projectId, owner_id: ownerId, title: "Existing empty target", revision: 1, status: "draft", payload: {}, created_at: timestamp, updated_at: timestamp };
  // Direct repository users are admitted again before assets or a save RPC.
  await assert.rejects(repository.saveProject({ project: target, data, sourceFiles: [new File(["%PDF-1.4\nNever transferred\n%%EOF"], "denied.pdf", { type: "application/pdf" })] }), /refusée/);
  assert.deepEqual(calls, ["fonciere_authorize_transfer", "fonciere_authorize_transfer"]);
  assert.equal(actorReads, 0); assert.equal(tableReads, 0); assert.deepEqual(transfers, []);
  assert.deepEqual(data, original);
});

test("editing a presentation's unchanged historical source snapshot saves without source permission or new transfers", async () => {
  const data = createProjectData(); data.state.project = "Fictitious historical source snapshot";
  data.importMeta = { fonciereSource: { id: sourceId, revision: 2, capturedAt: timestamp } };
  data.photos.main = preview;
  data.importGallery = [{ data: preview, label: "Retained snapshot photo", page: null, width: 160, height: 120, source: "" }];
  data.photoGalleryRoles = { main: 0 };
  const canonical = structuredClone(data); canonical.photos = { main: photoIds[0], view: "", inside: "", operation: "" }; canonical.importGallery[0].data = photoIds[1];
  let persisted = { schema: "IZORD_GENERATOR_V1", data: canonical, sourceDocuments: [documentId] }, revision = 7;
  const project = (): ProjectRecord => ({ id: projectId, owner_id: ownerId, author_id: ownerId, title: data.state.project, revision, status: "draft", payload: persisted, created_at: timestamp, updated_at: timestamp });
  const transfers: string[] = [], calls: string[] = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: ownerId } }, error: null }), getSession: async () => ({ data: { session: { user: { id: ownerId } } } }) },
    storage: forbiddenStorage(transfers),
    rpc: async (name: string, args: { p_payload: typeof persisted }) => {
      calls.push(name);
      if (name === "fonciere_authorize_transfer") return { data: null, error: { code: "42501" } };
      assert.equal(name, "izord_save_generator"); persisted = structuredClone(args.p_payload); revision++; return { data: revision, error: null };
    },
    from: (table: string) => {
      assert(["izord_projects", "izord_project_versions", "izord_assets"].includes(table));
      const rows = table === "izord_project_versions" ? [{ project_id: projectId, revision, author_id: ownerId }] : [];
      const query = { select: () => query, eq: () => query, order: () => query, single: async () => ({ data: project(), error: null }), then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve, reject) };
      return query;
    }
  } as unknown as SupabaseClient;
  const before: LoadedProject = { project: project(), data: structuredClone(data), assets: [], sourceDocuments: [documentId], photoHydration: "complete", historicalRevision: null }, original = structuredClone(before.project.payload);
  const edited = structuredClone(data); edited.state.project = "Edited independent presentation";
  const saved = await createGeneratorRepository(client).saveProject({ project: before.project, data: edited, previous: before });
  assert.equal(saved.project.revision, 8);
  assert.deepEqual(persisted.data.importMeta?.fonciereSource, canonical.importMeta?.fonciereSource);
  assert.deepEqual(persisted.data.photos, canonical.photos);
  assert.deepEqual(persisted.data.importGallery, canonical.importGallery);
  assert.deepEqual(persisted.sourceDocuments, [documentId]);
  assert.deepEqual(transfers, []);
  assert.deepEqual(calls, ["izord_save_generator"], "Retained snapshots need no new source admission");
  assert.deepEqual(before.project.payload, original);
});
