/* Simulated Drive/registry contracts. No production credentials or live writes. */
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const { join } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const originalLoad = Module._load;
Module._load = function (id, parent, main) { if (id === "server-only") return {}; return originalLoad.call(this, id, parent, main); };
require.extensions[".ts"] = (mod, file) => mod._compile(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { copyOriginalToDrive, discoverProjetsRoot, configureProjetsRoot, processFonciereDriveJobs } = require(join(process.cwd(), "lib/server/fonciereDrive.ts"));
const { createFonciereDriveWorkerHandler, createFonciereDriveStatusHandler, createFonciereDriveFolderHandler } = require(join(process.cwd(), "lib/server/fonciereDriveHandlers.ts"));
process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID = "fixture-drive";
const FOLDER = "application/vnd.google-apps.folder";
const project = "11111111-1111-4111-8111-111111111111";
const asset = "22222222-2222-4222-8222-222222222222";
const lease = "33333333-3333-4333-8333-333333333333";
const bytes = Buffer.from("%PDF-1.4\nOriginal private fictional document\n%%EOF");
const makeJob = (overrides = {}) => ({ id: "job-1", project_id: project, asset_id: asset, job_type: "file", title: "Villa fictive", project_reference: "PRJ-000001", category: "agency", expected_size: bytes.length, expected_mime: "application/pdf", object_path: `${project}/${asset}`, original_name: "document.pdf", storage_object_version: "immutable-v1", reserved_file_id: null, attempts: 1, lease_token: lease, ...overrides });
function fixture() {
  let generated = 0, sessionNo = 0, lost = false;
  const files = new Map(), sessions = new Map(), requests = [], creations = [];
  const folder = (id, parent, name = id) => ({ id, name, mimeType: FOLDER, driveId: "fixture-drive", parents: parent ? [parent] : [], trashed: false, capabilities: { canAddChildren: true, canListChildren: true } });
  files.set("fixture-drive", folder("fixture-drive", null));
  files.set("fixture-root", folder("fixture-root", "fixture-drive", "Projets"));
  const state = { loseFinal: false, unavailable: false, listIncomplete: false, listPages: null, creates: 0 };
  const fetchDrive = async (input, init = {}) => {
    const url = new URL(input), method = init.method || "GET";
    requests.push({ url, method, body: init.body });
    if (state.unavailable) return Response.json({}, { status: 503 });
    if (url.pathname.endsWith("generateIds")) return Response.json({ ids: [`generated-${++generated}`] });
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      if (state.listPages) return Response.json(state.listPages[url.searchParams.get("pageToken") || "first"]);
      return Response.json({ files: [...files.values()].filter(file => file.name === "Projets" && !file.trashed), incompleteSearch: state.listIncomplete });
    }
    if (url.pathname === "/drive/v3/files" && method === "POST") {
      const data = JSON.parse(init.body);
      creations.push(data.id);
      if (files.has(data.id)) return Response.json({}, { status: 409 });
      files.set(data.id, { ...folder(data.id, data.parents[0], data.name), appProperties: data.appProperties });
      state.creates++;
      return Response.json({ id: data.id });
    }
    if (url.pathname === "/upload/drive/v3/files" && method === "POST") {
      const data = JSON.parse(init.body);
      creations.push(data.id);
      if (files.has(data.id)) return Response.json({}, { status: 409 });
      const session = `session-${++sessionNo}`;
      sessions.set(session, { data, chunks: [] });
      return new Response(null, { status: 200, headers: { location: `https://www.googleapis.com/upload/drive/v3/files/${session}` } });
    }
    if (url.pathname.startsWith("/upload/drive/v3/files/") && method === "PUT") {
      const session = sessions.get(url.pathname.split("/").pop());
      assert(session);
      session.chunks.push(Buffer.from(init.body));
      const range = init.headers["content-range"].match(/bytes (\d+)-(\d+)\/(\d+)/);
      if (Number(range[2]) + 1 < Number(range[3])) return new Response(null, { status: 308 });
      const content = Buffer.concat(session.chunks), data = session.data;
      files.set(data.id, { ...data, driveId: "fixture-drive", trashed: false, size: String(content.length), md5Checksum: createHash("md5").update(content).digest("hex"), content });
      state.creates++;
      if (state.loseFinal && !lost) { lost = true; throw Error("Lost final response"); }
      return Response.json({ id: data.id });
    }
    const id = url.pathname.split("/").pop();
    if (method === "PATCH") {
      const file = files.get(id);
      if (!file) return Response.json({}, { status: 404 });
      Object.assign(file, JSON.parse(init.body));
      return Response.json(file);
    }
    return files.has(id) ? Response.json(files.get(id)) : Response.json({}, { status: 404 });
  };
  const config = { enabled: true, shared_drive_id: "fixture-drive", root_folder_id: "fixture-root", root_parent_id: "fixture-drive" };
  const folders = new Map(), jobs = [], events = [];
  const store = {
    async call(operation, data = {}) {
      events.push({ operation, data });
      if (operation === "get_config") return structuredClone(config);
      if (operation === "root_reserve") { config.reserved_root_id ||= data.folder_id; return structuredClone(config); }
      if (operation === "configure") { Object.assign(config, data); return structuredClone(config); }
      if (operation === "claim") {
        const job = jobs.find(row => row.status === "pending");
        if (!job) return [];
        Object.assign(job, { status: "processing", lease_token: data.lease_token });
        return [structuredClone(job)];
      }
      if (operation.startsWith("folder_")) {
        const key = `${data.project_id}/${data.category}`;
        let row = folders.get(key);
        if (operation === "folder_claim") {
          if (!row) { row = { status: "creating", drive_folder_id: null, parent_drive_folder_id: data.parent_id, lease_token: data.lease_token }; folders.set(key, row); }
          if (row.lease_token && row.lease_token !== data.lease_token) return { ...row, claimed: false };
          row.lease_token = data.lease_token;
          return { ...row, claimed: true };
        }
        assert.equal(row.lease_token, data.lease_token);
        if (operation === "folder_reserve") row.drive_folder_id ||= data.folder_id;
        if (operation === "folder_ready") { row.status = "ready"; row.lease_token = null; }
        return structuredClone(row);
      }
      const job = jobs.find(row => row.id === data.id);
      assert(job);
      assert.equal(job.lease_token, data.lease_token);
      if (operation === "reserve_file") { job.reserved_file_id ||= data.file_id; return structuredClone(job); }
      if (operation === "complete") { job.status = "synced"; return structuredClone(job); }
      if (operation === "fail") { job.status = "retry"; job.error = data.error; job.permanent = data.permanent; return structuredClone(job); }
      throw Error(operation);
    },
    async original() { return new Blob([bytes], { type: "application/pdf" }); }
  };
  return { fetchDrive, state, files, requests, creations, config, store, jobs, folders, events, folder };
}

test("original bytes, immutable reserved ID: lost Google response and replay create no duplicate", async () => {
  const f = fixture(); f.state.loseFinal = true;
  const job = makeJob(), original = new Blob([bytes], { type: "application/pdf" });
  const one = await copyOriginalToDrive(f.fetchDrive, job, original, "fixture-root", "fixture-drive", "reserved-original");
  const two = await copyOriginalToDrive(f.fetchDrive, job, original, "fixture-root", "fixture-drive", "reserved-original");
  assert.deepEqual(one, two); assert.equal(f.state.creates, 1); assert.deepEqual(f.files.get(one.id).content, bytes);
  assert.equal(f.creations.length, 1);
});
test("different homonymous assets survive and mismatching content cannot be declared synced", async () => {
  const f = fixture(), original = new Blob([bytes], { type: "application/pdf" });
  await copyOriginalToDrive(f.fetchDrive, makeJob(), original, "fixture-root", "fixture-drive", "first");
  await copyOriginalToDrive(f.fetchDrive, makeJob({ asset_id: "other", object_path: `${project}/other` }), original, "fixture-root", "fixture-drive", "second");
  assert.equal(f.files.get("first").name, f.files.get("second").name); assert.equal(f.state.creates, 2);
  f.files.get("first").md5Checksum = "modified";
  await assert.rejects(() => copyOriginalToDrive(f.fetchDrive, makeJob(), original, "fixture-root", "fixture-drive", "first"), error => error.code === "drive_file_identity_or_content_mismatch");
});
test("large originals use bounded 4 MB chunks with exact content ranges", async () => {
  const f = fixture(), large = Buffer.alloc(5 * 1024 * 1024 + 17, 42), job = makeJob({ expected_size: large.length });
  await copyOriginalToDrive(f.fetchDrive, job, new Blob([large], { type: "application/pdf" }), "fixture-root", "fixture-drive", "large");
  const puts = f.requests.filter(row => row.method === "PUT");
  assert.equal(puts.length, 2); assert(puts.every(row => row.body.length <= 4 * 1024 * 1024)); assert.deepEqual(f.files.get("large").content, large);
});
test("crash before durable completion reuses the reserved file identity on recovery", async () => {
  const f = fixture(); f.jobs.push(makeJob({ status: "pending" }));
  const originalCall = f.store.call.bind(f.store); let crash = true;
  f.store.call = async (operation, data) => {
    if (operation === "complete" && crash) { crash = false; throw Error("Fictional crash before DB acknowledgement"); }
    return originalCall(operation, data);
  };
  assert.equal((await processFonciereDriveJobs(f.store, f.fetchDrive)).failed, 1);
  const id = f.jobs[0].reserved_file_id, before = f.state.creates;
  assert(id); assert.equal(f.jobs[0].status, "retry");
  f.jobs[0].status = "pending";
  assert.equal((await processFonciereDriveJobs(f.store, f.fetchDrive)).synced, 1);
  assert.equal(f.jobs[0].reserved_file_id, id); assert.equal(f.state.creates, before);
});
test("concurrent workers serialize folder creation and recover the contending job", async () => {
  const f = fixture(); f.jobs.push(makeJob({ status: "pending" }), makeJob({ id: "job-2", status: "pending", asset_id: "another", object_path: `${project}/another` }));
  const results = await Promise.all([processFonciereDriveJobs(f.store, f.fetchDrive, { maxJobs: 1 }), processFonciereDriveJobs(f.store, f.fetchDrive, { maxJobs: 1 })]);
  assert.equal(results.reduce((total, row) => total + row.synced, 0), 1);
  const contending = f.jobs.find(row => row.status === "retry"); assert(contending); contending.status = "pending";
  assert.equal((await processFonciereDriveJobs(f.store, f.fetchDrive)).synced, 1);
  assert.equal(f.folders.size, 5); assert.equal(f.state.creates, 7);
});
test("complete paginated root discovery rejects incomplete searches, denial and ambiguous destinations", async () => {
  const f = fixture(); f.state.listPages = { first: { files: [], nextPageToken: "second" }, second: { files: [f.files.get("fixture-root")] } };
  assert.equal((await discoverProjetsRoot(f.fetchDrive, "fixture-drive")).candidates.length, 1);
  assert.equal(f.requests.filter(row => row.url.pathname === "/drive/v3/files").length, 2);
  f.state.listPages = null; f.state.listIncomplete = true;
  await assert.rejects(() => discoverProjetsRoot(f.fetchDrive, "fixture-drive"), error => error.code === "drive_root_search_incomplete");
  assert.equal(f.state.creates, 0);
  f.state.listIncomplete = false; f.config.root_folder_id = null; f.files.set("ambiguous", f.folder("ambiguous", "fixture-drive", "Projets"));
  await assert.rejects(() => configureProjetsRoot(f.store, f.fetchDrive, "fixture-drive"), error => error.code === "drive_root_ambiguous");
  assert.equal(f.state.creates, 0);
  await assert.rejects(() => discoverProjetsRoot(async () => Response.json({}, { status: 403 }), "fixture-drive"), error => error.code === "drive_access_denied");
});
test("root reservation precedes creation; a lost creation response adopts that same ID", async () => {
  const f = fixture(); f.config.root_folder_id = null; f.files.delete("fixture-root");
  let lost = true;
  const fetchDrive = async (input, init) => {
    if (init?.method === "POST") assert(f.config.reserved_root_id, "root reservation must commit first");
    const response = await f.fetchDrive(input, init);
    if (init?.method === "POST" && lost) { lost = false; throw Error("Fictional lost root response"); }
    return response;
  };
  const first = await configureProjetsRoot(f.store, fetchDrive, "fixture-drive");
  const second = await configureProjetsRoot(f.store, fetchDrive, "fixture-drive");
  assert.equal(first.root_folder_id, second.root_folder_id); assert.equal(first.root_folder_id, f.config.reserved_root_id); assert.equal(f.state.creates, 1);
});
test("second job reuses all ready folders; text rename retains IDs and does not upload files", async () => {
  const f = fixture(); f.jobs.push(makeJob({ status: "pending" }), makeJob({ id: "job-2", status: "pending", asset_id: "another", object_path: `${project}/another` }));
  const result = await processFonciereDriveJobs(f.store, f.fetchDrive);
  assert.equal(result.synced, 2); assert.equal(result.failed, 0); assert.equal(f.folders.size, 5);
  assert.equal(f.state.creates, 7); // project, four categories, two distinct originals
  const beforeIds = [...f.folders.values()].map(row => row.drive_folder_id), uploads = f.requests.filter(row => row.url.pathname.startsWith("/upload/")).length;
  f.jobs.push(makeJob({ id: "rename", status: "pending", title: "Villa renommée", job_type: "folder", asset_id: null }));
  assert.equal((await processFonciereDriveJobs(f.store, f.fetchDrive)).synced, 1);
  assert.deepEqual([...f.folders.values()].map(row => row.drive_folder_id), beforeIds);
  assert.equal(f.files.get(beforeIds[0]).name, "PRJ-000001 - Villa renommée");
  assert.equal(f.requests.filter(row => row.url.pathname.startsWith("/upload/")).length, uploads);
});
test("Drive outage leaves durable retry; moved/trashed ready folder never creates replacement", async () => {
  const f = fixture(); f.jobs.push(makeJob({ status: "pending", job_type: "folder", asset_id: null }));
  assert.equal((await processFonciereDriveJobs(f.store, f.fetchDrive)).synced, 1);
  const projectFolder = f.folders.get(`${project}/project`).drive_folder_id;
  f.files.get(projectFolder).trashed = true;
  f.jobs.push(makeJob({ id: "again", status: "pending", job_type: "folder", asset_id: null }));
  const before = f.state.creates, result = await processFonciereDriveJobs(f.store, f.fetchDrive);
  assert.equal(result.failed, 1); assert.equal(f.state.creates, before); assert.equal(f.jobs[1].permanent, true);
  f.state.unavailable = true; f.jobs.push(makeJob({ id: "outage", status: "pending" }));
  assert.equal((await processFonciereDriveJobs(f.store, f.fetchDrive)).failed, 1); assert.equal(f.jobs[2].status, "retry"); assert.equal(f.jobs[2].permanent, false);
});
for (const reason of ["rateLimitExceeded", "userRateLimitExceeded"]) test(`403 ${reason} keeps folder reservation retryable and recovers with the same ID`, async () => {
  const f = fixture(); f.jobs.push(makeJob({ status: "pending", job_type: "folder", asset_id: null }));
  let throttled = false, reserved;
  const limited = async (input, init) => {
    if (init?.method === "POST" && new URL(input).pathname === "/drive/v3/files" && !throttled) {
      throttled = true; reserved = JSON.parse(init.body).id;
      return Response.json({ error: { errors: [{ reason }] } }, { status: 403 });
    }
    return f.fetchDrive(input, init);
  };
  assert.equal((await processFonciereDriveJobs(f.store, limited)).failed, 1);
  assert.equal(f.jobs[0].permanent, false); assert.equal(f.jobs[0].error, "drive_rate_limited");
  assert.equal(f.folders.get(`${project}/project`).drive_folder_id, reserved);
  f.jobs[0].status = "pending";
  // The real SQL fail operation releases every matching folder lease.
  for (const row of f.folders.values()) row.lease_token = null;
  assert.equal((await processFonciereDriveJobs(f.store, limited)).synced, 1);
  assert.equal(f.folders.get(`${project}/project`).drive_folder_id, reserved);
  assert.equal(f.creations.filter(id => id === reserved).length, 1);
});
test("interrupted creating-folder POST followed by 404 keeps the same reservation eligible for retry", async () => {
  const f = fixture(); f.jobs.push(makeJob({ status: "pending", job_type: "folder", asset_id: null }));
  let interrupted = false, reserved;
  const transport = async (input, init) => {
    if (init?.method === "POST" && new URL(input).pathname === "/drive/v3/files" && !interrupted) {
      interrupted = true; reserved = JSON.parse(init.body).id; throw Error("Interrupted before Google creation");
    }
    return f.fetchDrive(input, init);
  };
  assert.equal((await processFonciereDriveJobs(f.store, transport)).failed, 1);
  assert.equal(f.jobs[0].permanent, false); assert.equal(f.jobs[0].error, "drive_folder_creation_unconfirmed");
  assert.equal(f.folders.get(`${project}/project`).status, "creating"); assert.equal(f.files.has(reserved), false);
  f.jobs[0].status = "pending"; for (const row of f.folders.values()) row.lease_token = null;
  assert.equal((await processFonciereDriveJobs(f.store, transport)).synced, 1);
  assert.equal(f.folders.get(`${project}/project`).drive_folder_id, reserved); assert.equal(f.creations.filter(id => id === reserved).length, 1);
});
for (const reason of ["insufficientFilePermissions", "teamDriveMembershipRequired", undefined]) test(`403 ${reason || "without JSON reason"} remains an intervention error`, async () => {
  const f = fixture(); f.jobs.push(makeJob({ status: "pending", job_type: "folder", asset_id: null }));
  const denied = async (input, init) => init?.method === "POST" && new URL(input).pathname === "/drive/v3/files" ? Response.json(reason ? { error: { errors: [{ reason }] } } : {}, { status: 403 }) : f.fetchDrive(input, init);
  assert.equal((await processFonciereDriveJobs(f.store, denied)).failed, 1);
  assert.equal(f.jobs[0].permanent, true); assert.equal(f.jobs[0].error, "drive_access_denied");
});
for (const status of [429, 500, 503]) test(`HTTP ${status} stays eligible for automatic retry`, async () => {
  const f = fixture(); f.jobs.push(makeJob({ status: "pending", job_type: "folder", asset_id: null }));
  const result = await processFonciereDriveJobs(f.store, async () => Response.json({}, { status }));
  assert.equal(result.failed, 1); assert.equal(f.jobs[0].permanent, false); assert.notEqual(f.jobs[0].error, "drive_access_denied");
});
for (const status of [403, 404]) test(`managed ready folder HTTP ${status} is intervention-required, never absence for creation`, async () => {
  const f = fixture(); f.jobs.push(makeJob({ status: "pending", job_type: "folder", asset_id: null }));
  await processFonciereDriveJobs(f.store, f.fetchDrive);
  const id = f.folders.get(`${project}/project`).drive_folder_id;
  f.jobs.push(makeJob({ id: "again", status: "pending", job_type: "folder", asset_id: null }));
  const before = f.state.creates;
  const result = await processFonciereDriveJobs(f.store, async (input, init) => new URL(input).pathname.endsWith(`/${id}`) ? Response.json({}, { status }) : f.fetchDrive(input, init));
  assert.equal(result.failed, 1); assert.equal(f.jobs[1].permanent, true); assert.equal(f.state.creates, before); assert.equal(f.folders.get(`${project}/project`).drive_folder_id, id);
});
test("invalid original or arbitrary upload session never exports private bytes", async () => {
  const f = fixture();
  await assert.rejects(() => copyOriginalToDrive(f.fetchDrive, makeJob(), new Blob(["preview"], { type: "image/jpeg" }), "fixture-root", "fixture-drive", "nope"), error => error.code === "crm_original_invalid");
  assert.equal(f.requests.length, 0);
  await assert.rejects(() => copyOriginalToDrive(async (input, init) => init?.method === "POST" ? new Response(null, { headers: { location: "https://other.invalid/steal" } }) : Response.json({}, { status: 404 }), makeJob(), new Blob([bytes], { type: "application/pdf" }), "fixture-root", "fixture-drive", "nope"), error => error.code === "drive_upload_session_invalid");
});
test("direct routes reject unauthenticated users, no arbitrary destinations, worker secret required", async () => {
  delete process.env.CRON_SECRET;
  let calls = 0;
  const deps = { store: () => { calls++; throw Error("must not run"); } };
  const worker = createFonciereDriveWorkerHandler(deps);
  assert.equal((await worker(new Request("https://fixture.invalid/api/fonciere/drive/worker"))).status, 401); assert.equal(calls, 0);
  process.env.CRON_SECRET = "fictional-secret-for-local-worker-test-only";
  const auth = { authorization: `Bearer ${process.env.CRON_SECRET}`, "content-type": "application/json" };
  assert.equal((await worker(new Request("https://fixture.invalid/api/fonciere/drive/worker", { method: "POST", headers: auth, body: JSON.stringify({ action: "configure", folderId: "arbitrary" }) }))).status, 400);
  assert.equal(calls, 0);
  const status = createFonciereDriveStatusHandler();
  assert.equal((await status(new Request(`https://fixture.invalid/api/fonciere/drive?project=${project}`))).status, 401);
  assert.equal((await status(new Request(`https://fixture.invalid/api/fonciere/drive?project=${project}&folderId=arbitrary`))).status, 400);
  const denied = { userClient: () => ({ rpc: () => ({ abortSignal: async () => ({ data: null, error: { code: "42501" } }) }) }) };
  assert.equal((await createFonciereDriveStatusHandler(denied)(new Request(`https://fixture.invalid/api/fonciere/drive?project=${project}`, { headers: { authorization: "Bearer fictitious" } }))).status, 403);
  assert.equal((await createFonciereDriveFolderHandler(denied)(new Request(`https://fixture.invalid/api/fonciere/drive/folder?project=${project}`, { headers: { authorization: "Bearer fictitious" } }))).status, 403);
});
test("English status diagnostic, no folder URL without export, and post-Drive revocation", async () => {
  const f = fixture();
  const statusClient = { rpc: () => ({ abortSignal: async () => ({ data: { configured: true, state: "retry", can_retry: true, can_open: false, project_error: "managed_folder_changed", files: [], counts: {} }, error: null }) }) };
  const result = await createFonciereDriveStatusHandler({ userClient: () => statusClient })(new Request(`https://fixture.invalid/api/fonciere/drive?project=${project}`, { headers: { authorization: "Bearer fictitious", "accept-language": "en" } }));
  const body = await result.json(); assert.match(body.error, /managed folder was moved/); assert.equal(body.canOpen, false); assert.equal(body.folderUrl, undefined);
  const id = "existing-project-folder";
  f.files.set(id, { ...f.folder(id, "fixture-root"), appProperties: { managedBy: "oar-fonciere", projectId: project, folderKind: "project" } });
  let admissions = 0;
  const userClient = () => ({ rpc: () => ({ abortSignal: async () => ++admissions === 1 ? { data: id, error: null } : { data: null, error: { code: "42501" } } }) });
  const handler = createFonciereDriveFolderHandler({ userClient, store: () => f.store, fetchDrive: f.fetchDrive });
  assert.equal((await handler(new Request(`https://fixture.invalid/api/fonciere/drive/folder?project=${project}`, { headers: { authorization: "Bearer fictitious" } }))).status, 403);
});
