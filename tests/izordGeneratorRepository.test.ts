import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createProjectData } from "../lib/izord/model";
import { createGeneratorRepository, GeneratorConflictError, validateUploadBlob, photoDataToBlob, type ProjectRecord } from "../lib/izord/repository";
import { assertImageByteBudget, assertEncodedImageBudget, encodedJpegLength, jpegDataByteLength, TOTAL_IMAGE_BYTES } from "../lib/izord/image-budget";

const id = "11111111-1111-4111-8111-111111111111";
const owner = "22222222-2222-4222-8222-222222222222";
const project: ProjectRecord = { id, owner_id: owner, revision: 7, title: "Fictif", status: "draft", payload: {}, created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z" };
function stub(options: { conflict?: boolean; lateRevision?: number; sessionId?: string; signal?: AbortController } = {}) {
  const mutations: { name: string; args: Record<string, unknown> }[] = [];
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: owner } }, error: null }),
      getSession: async () => ({ data: { session: { user: { id: options.sessionId || owner } } } }),
    },
    storage: { from: () => ({}) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      mutations.push({ name, args }); options.signal?.abort();
      return options.conflict ? { data: null, error: { code: "40001", message: "revision_conflict" } } : { data: 8, error: null };
    },
    from: (table: string) => {
      const result = { data: table === "izord_projects" ? { ...project, revision: options.lateRevision || 8 } : [], error: null };
      const query = { select: () => query, eq: () => query, order: async () => result, single: async () => result };
      return query;
    },
  };
  return { repository: createGeneratorRepository(client as unknown as SupabaseClient), mutations };
}

test("generator save sends expected revision and keeps incomplete values distinct from zero", async () => {
  const { repository, mutations } = stub(), data = createProjectData(); data.state.acq = ""; data.state.works = "0";
  const saved = await repository.saveProject({ project, data });
  assert.equal(saved.project.revision, 8); assert.equal(mutations.length, 1);
  assert.equal(mutations[0].name, "izord_save_generator"); assert.equal(mutations[0].args.p_expected_revision, 7);
  const payload = mutations[0].args.p_payload as { data: typeof data };
  assert.equal(payload.data.state.acq, ""); assert.equal(payload.data.state.works, "0");
  assert.deepEqual(Object.values(payload.data.photos), ["", "", "", ""]);
  assert.ok(!JSON.stringify(payload).includes("base64"));
});

test("generator conflict does not alter the caller's unsaved draft", async () => {
  const { repository } = stub({ conflict: true }), data = createProjectData(); data.state.acq = "428000";
  const before = structuredClone(data);
  await assert.rejects(repository.saveProject({ project, data }), GeneratorConflictError);
  assert.deepEqual(data, before);
});

test("later remote save after acknowledgment cannot be mislabeled as our export revision", async () => {
  const { repository } = stub({ lateRevision: 9 });
  await assert.rejects(repository.saveProject({ project, data: createProjectData() }), GeneratorConflictError);
});

test("account change refuses save before any RPC mutation", async () => {
  const { repository, mutations } = stub({ sessionId: "33333333-3333-4333-8333-333333333333" });
  await assert.rejects(repository.saveProject({ project, data: createProjectData() }), { name: "AbortError" });
  assert.equal(mutations.length, 0);
});

test("late acknowledged save after unmount/abort returns no saved state", async () => {
  const signal = new AbortController(), { repository, mutations } = stub({ signal });
  await assert.rejects(repository.saveProject({ project, data: createProjectData() }, { signal: signal.signal }), { name: "AbortError" });
  assert.equal(mutations.length, 1, "The server may have committed; no false cancellation guarantee.");
});

test("direct upload rejects empty, over-limit and misleading content before registration", async () => {
  await assert.rejects(validateUploadBlob(new Blob([], { type: "application/pdf" }), "pdf"));
  await assert.rejects(validateUploadBlob(new Blob([new Uint8Array(25_000_001)], { type: "application/pdf" }), "pdf"));
  await assert.rejects(validateUploadBlob(new Blob(["not a PDF"], { type: "application/pdf" }), "pdf"));
  await assert.rejects(validateUploadBlob(new Blob(["%PDF-1.4"], { type: "image/jpeg" }), "photo"));
  await assert.rejects(validateUploadBlob(new Blob(["not a zip"], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }), "presentation"));
});

test("direct upload accepts PDF signature and JPEG bytes and preserves photo binary", async () => {
  await validateUploadBlob(new Blob(["%PDF-1.4\nFICTIONAL\n%%EOF"], { type: "application/pdf" }), "pdf");
  const image = photoDataToBlob("data:image/jpeg;base64,/9j/2Q==");
  await validateUploadBlob(image, "photo"); assert.deepEqual([...new Uint8Array(await image.arrayBuffer())], [255, 216, 255, 217]);
  assert.throws(() => photoDataToBlob("https://example.invalid/private.jpg"));
});

test("aggregate image budget rejects a many-small-files overflow without large allocations", () => {
  assert.equal(assertImageByteBudget([{ id: "a", bytes: 25_000_000 }, { id: "b", bytes: 25_000_000 }, { id: "c", bytes: 25_000_000 }, { id: "d", bytes: 25_000_000 }]), TOTAL_IMAGE_BYTES);
  assert.throws(() => assertImageByteBudget([{ id: "a", bytes: 25_000_000 }, { id: "b", bytes: 25_000_000 }, { id: "c", bytes: 25_000_000 }, { id: "d", bytes: 25_000_000 }, { id: "e", bytes: 1 }]));
});

test("aggregate budget counts duplicate identities once and conservatively keeps their largest size", () => {
  assert.equal(assertImageByteBudget([{ id: "same-photo", bytes: 10 }, { id: "same-photo", bytes: 10 }, { id: "other", bytes: 20 }]), 30);
  assert.equal(assertImageByteBudget([{ id: "same-photo", bytes: 10 }, { id: "same-photo", bytes: 20 }]), 20);
  for (const bytes of [-1, NaN, Infinity, 1.5]) assert.throws(() => assertImageByteBudget([{ id: "bad", bytes }]));
});

test("base64 decoded length is obtained without allocating binary copies", () => {
  for (const [encoded, size] of [["/w==", 1], ["/9g=", 2], ["/9j/", 3]] as const) assert.equal(jpegDataByteLength(`data:image/jpeg;base64,${encoded}`), size);
  assert.throws(() => jpegDataByteLength("https://example.invalid/photo.jpg"));
  assert.throws(() => jpegDataByteLength("data:image/jpeg;base64,/w="));
});

test("duplicate references cannot bypass the future JSON export aggregate size limit", () => {
  const samePhoto = Array.from({ length: 480 }, () => ({ id: "one-photo", bytes: 25_000_000 }));
  assert.equal(assertImageByteBudget(samePhoto), 25_000_000);
  assert.throws(() => assertEncodedImageBudget(samePhoto.map(item => encodedJpegLength(item.bytes))), /répétées/);
  assert.equal(assertEncodedImageBudget([encodedJpegLength(3), encodedJpegLength(3)]), 54);
});

test("Storage hydration preflights declared aggregate sizes before downloading any bytes", async () => {
  const photoIds = Array.from({ length: 5 }, (_, index) => `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`);
  const remote = { ...createProjectData(), importGallery: photoIds.map(data => ({ data, label: "Fictif", page: null, width: null, height: null })) };
  remote.photos = { main: "", view: "", inside: "", operation: "" };
  let downloads = 0;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: owner } }, error: null }), getSession: async () => ({ data: { session: { user: { id: owner } } } }) },
    storage: { from: () => ({ download: async () => { downloads++; throw new Error("Must not download"); } }) },
    from: (table: string) => {
      const result = { data: table === "izord_projects" ? { ...project, payload: { schema: "IZORD_GENERATOR_V1", data: remote, sourceDocuments: [] } } : table === "izord_assets" ? photoIds.map(id => ({ id, expected_size: 25_000_000 })) : [], error: null };
      const query = { select: () => query, eq: () => query, order: async () => result, single: async () => result }; return query;
    },
  };
  await assert.rejects(createGeneratorRepository(client as unknown as SupabaseClient).loadProject(id), /100 Mo/);
  assert.equal(downloads, 0);
});

test("Storage hydration enforces actual cumulative bytes when legacy sizes are unknown", async () => {
  const photoIds = Array.from({ length: 5 }, (_, index) => `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`);
  const remote = { ...createProjectData(), importGallery: photoIds.map(data => ({ data, label: "Fictif", page: null, width: null, height: null })) };
  remote.photos = { main: "", view: "", inside: "", operation: "" };
  let downloads = 0;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: owner } }, error: null }), getSession: async () => ({ data: { session: { user: { id: owner } } } }) },
    storage: { from: () => ({ download: async () => {
      downloads++;
      // Simulate Storage-reported received bytes without allocating 125 MB.
      const blob = photoDataToBlob(createProjectData().photos.main); Object.defineProperty(blob, "size", { value: 25_000_000 });
      return { data: blob, error: null };
    } }) },
    from: (table: string) => {
      const result = { data: table === "izord_projects" ? { ...project, payload: { schema: "IZORD_GENERATOR_V1", data: remote, sourceDocuments: [] } } : table === "izord_assets" ? photoIds.map(assetId => ({ id: assetId, project_id: id, kind: "photo", lifecycle: "finalized", expected_size: null, object_path: `${id}/${assetId}` })) : [], error: null };
      const query = { select: () => query, eq: () => query, order: async () => result, single: async () => result }; return query;
    },
  };
  await assert.rejects(createGeneratorRepository(client as unknown as SupabaseClient).loadProject(id), /100 Mo/);
  assert.equal(downloads, 5, "The fifth received file is refused before base64 accumulation or returning a loaded project.");
});
