/* Finite root-name operation: simulated Google and store only. */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const { join } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript"), originalLoad = Module._load;
Module._load = function (id, parent, main) { return id === "server-only" ? {} : originalLoad.call(this, id, parent, main); };
require.extensions[".ts"] = (mod, file) => mod._compile(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { createFonciereDriveRootNameHandler } = require(join(process.cwd(), "lib/server/fonciereDriveRootName.ts"));
const NOW = 1_900_000_000_000, FOLDER = "application/vnd.google-apps.folder";
function fixture() {
  const secret = `${NOW / 1000 + 1200}:${"ab".repeat(32)}`; process.env.FONCIERE_ROOT_RENAME_SECRET = secret;
  const folder = (id, name, parent = "fixture-drive") => ({ id, name, mimeType: FOLDER, driveId: "fixture-drive", parents: parent ? [parent] : [], trashed: false, capabilities: { canAddChildren: true, canListChildren: true } });
  const root = { ...folder("fixture-root", "Projets"), appProperties: { managedBy: "crm", marker: "preserved" } };
  const siblings = [folder("one", "01 — FACTURES PRESTATAIRES"), folder("two", "02 — DOCUMENTS CONTACTS"), folder("three", "03 — AUTRES"), folder("archive", "99 — ARCHIVES"), root];
  const children = [folder("project-1", "PRJ-000001 - Villa fictive", root.id), { ...folder("piece", "piece-originale.pdf", root.id), mimeType: "application/pdf", size: "117", md5Checksum: "fictional-original-checksum" }];
  const permissions = [{ id: "fictional-private-permission", type: "user", role: "writer", permissionDetails: [{ inherited: true, inheritedFrom: "fixture-drive", permissionType: "member", role: "writer" }] }, { id: "fictional-private-group", type: "group", role: "reader" }];
  const config = { enabled: true, shared_drive_id: "fixture-drive", root_folder_id: root.id, root_parent_id: "fixture-drive" }, calls = [], storeCalls = [];
  const state = { incomplete: false, deniedPermissions: false, losePatchReply: false, changedAfterPatch: null };
  const fetchDrive = async (input, init = {}) => {
    const url = new URL(input), method = init.method || "GET"; calls.push({ url, method, body: init.body });
    if (method === "PATCH") {
      assert.equal(url.pathname, "/drive/v3/files/fixture-root"); assert.equal(url.searchParams.get("addParents"), null); assert.equal(url.searchParams.get("removeParents"), null);
      const change = JSON.parse(init.body); assert.deepEqual(Object.keys(change), ["name"]); root.name = change.name;
      if (state.changedAfterPatch) state.changedAfterPatch();
      if (state.losePatchReply) throw Error("Fictional lost successful PATCH reply");
      return Response.json({ id: root.id, name: root.name });
    }
    assert.equal(method, "GET");
    if (url.pathname.endsWith("/permissions")) {
      assert.equal(url.searchParams.get("supportsAllDrives"), "true"); assert(!/email|domain/i.test(url.searchParams.get("fields")));
      if (state.deniedPermissions) return Response.json({}, { status: 403 });
      return Response.json(url.searchParams.has("pageToken") ? { permissions: permissions.slice(1) } : { permissions: permissions.slice(0, 1), nextPageToken: "permission-page-2" });
    }
    if (url.pathname === "/drive/v3/files") {
      const list = url.searchParams.get("q").includes("'fixture-root'") ? children : siblings;
      const body = url.searchParams.has("pageToken") ? { files: list.slice(1) } : { files: list.slice(0, 1), nextPageToken: "file-page-2" };
      return Response.json({ ...body, incompleteSearch: state.incomplete });
    }
    if (url.pathname.endsWith("/fixture-root")) return Response.json(root);
    if (url.pathname.endsWith("/fixture-drive")) return Response.json(folder("fixture-drive", "Drive fictif", null));
    return Response.json({}, { status: 404 });
  };
  const store = { async call(operation) { storeCalls.push(operation); assert.equal(operation, "get_config", "No database mutation is permitted"); return structuredClone(config); }, async original() { throw Error("No original may be downloaded"); } };
  const handler = createFonciereDriveRootNameHandler({ store: () => store, fetchDrive, sharedDriveId: () => "fixture-drive", canonicalId: "fixture-root", now: () => NOW });
  const request = (body, query = "", authorization = `Bearer ${secret}`) => new Request("https://fixture.invalid/api/fonciere/drive/root-name" + query, { method: body === undefined ? "GET" : "POST", headers: { authorization, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { secret, root, siblings, children, permissions, config, calls, storeCalls, state, handler, request };
}
test("short-lived dedicated secret rejects missing/wrong/expired/>30-minute credentials before any data access", async () => {
  const f = fixture();
  for (const configured of [undefined, `${NOW / 1000 - 1}:${"ab".repeat(32)}`, `${NOW / 1000 + 1801}:${"ab".repeat(32)}`, `${NOW / 1000 + 60}:invalid`]) {
    if (configured === undefined) delete process.env.FONCIERE_ROOT_RENAME_SECRET; else process.env.FONCIERE_ROOT_RENAME_SECRET = configured;
    assert.equal((await f.handler(f.request(undefined, "", `Bearer ${configured || f.secret}`))).status, 401);
  }
  process.env.FONCIERE_ROOT_RENAME_SECRET = f.secret; assert.equal((await f.handler(f.request(undefined, "", "Bearer wrong"))).status, 401);
  assert.equal(f.calls.length, 0); assert.equal(f.storeCalls.length, 0);
});
test("read-only inspection exhausts sibling/child/permission pages and exposes only metadata and digests", async () => {
  const f = fixture(), response = await f.handler(f.request()), data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.root.id, "fixture-root"); assert.equal(data.siblings.length, 5); assert.equal(data.childCount, 2); assert.equal(data.permissionCount, 2);
  assert.match(data.siblingsFingerprint, /^[a-f0-9]{64}$/); assert.match(data.childrenFingerprint, /^[a-f0-9]{64}$/); assert.match(data.permissionsFingerprint, /^[a-f0-9]{64}$/);
  const text = JSON.stringify(data); assert(!text.includes("fictional-private-permission")); assert(!text.includes("fictional-private-group")); assert(!text.includes(f.secret));
  assert(f.calls.every(call => call.method === "GET")); assert(f.calls.filter(call => call.url.pathname.endsWith("/permissions")).length === 2); assert.deepEqual(f.storeCalls, ["get_config"]);
});
test("name-only rename preserves exact root identity, parent, appProperties, children and permissions; replay is idempotent", async () => {
  const f = fixture(), before = await (await f.handler(f.request())).json(), body = { name: "04 — PROJETS", expectedName: "Projets", siblingsFingerprint: before.siblingsFingerprint };
  const response = await f.handler(f.request(body)), after = await response.json(); assert.equal(response.status, 200);
  assert.equal(after.root.name, body.name); assert.equal(after.root.id, before.root.id); assert.equal(after.root.parentId, before.root.parentId); assert.equal(after.root.sharedDriveId, before.root.sharedDriveId);
  assert.equal(after.childrenFingerprint, before.childrenFingerprint); assert.equal(after.permissionsFingerprint, before.permissionsFingerprint); assert.equal(after.verifiedUnchanged, true); assert.equal(after.renamed, true);
  assert.deepEqual(f.root.appProperties, { managedBy: "crm", marker: "preserved" });
  const patches = f.calls.filter(call => call.method === "PATCH"); assert.equal(patches.length, 1); assert.deepEqual(JSON.parse(patches[0].body), { name: body.name });
  const replay = await f.handler(f.request(body)); assert.equal(replay.status, 200); assert.equal((await replay.json()).renamed, false); assert.equal(f.calls.filter(call => call.method === "PATCH").length, 1);
  assert(f.storeCalls.every(operation => operation === "get_config"));
});
test("unexpected canonical ID, arbitrary destination/move parameters, stale siblings and occupied number cannot rename", async () => {
  const f = fixture(), before = await (await f.handler(f.request())).json(), body = { name: "04 — PROJETS", expectedName: "Projets", siblingsFingerprint: before.siblingsFingerprint };
  for (const change of [{ folderId: "arbitrary" }, { parents: ["arbitrary"] }, { id: "arbitrary" }]) assert.equal((await f.handler(f.request({ ...body, ...change }))).status, 400);
  assert.equal((await f.handler(f.request(undefined, "?id=arbitrary"))).status, 400);
  assert.equal((await f.handler(f.request({ ...body, name: "Documents" }))).status, 400);
  f.config.root_folder_id = "unexpected"; const count = f.calls.length; assert.equal((await f.handler(f.request())).status, 409); assert.equal(f.calls.length, count); f.config.root_folder_id = "fixture-root";
  f.siblings.push({ ...f.siblings[0], id: "new-sibling", name: "05 — AJOUTÉ" }); assert.equal((await f.handler(f.request(body))).status, 409);
  const latest = await (await f.handler(f.request())).json(); assert.equal((await f.handler(f.request({ ...body, name: "01 — PROJETS", siblingsFingerprint: latest.siblingsFingerprint }))).status, 409);
  assert.equal(f.calls.filter(call => call.method === "PATCH").length, 0);
});
test("incomplete listing or denied permissions abort before PATCH; missing runtime secret disables the endpoint", async () => {
  const f = fixture(); f.state.incomplete = true; assert.equal((await f.handler(f.request())).status, 503); f.state.incomplete = false;
  f.state.deniedPermissions = true; assert.equal((await f.handler(f.request())).status, 503); assert.equal(f.calls.filter(call => call.method === "PATCH").length, 0);
  delete process.env.FONCIERE_ROOT_RENAME_SECRET; const before = f.calls.length; assert.equal((await f.handler(f.request())).status, 401); assert.equal(f.calls.length, before);
});
test("lost PATCH acknowledgement confirms the same ID; changed children/permissions are never reported unchanged", async () => {
  const f = fixture(), snapshot = await (await f.handler(f.request())).json(); f.state.losePatchReply = true;
  const response = await f.handler(f.request({ name: "04 — PROJETS", expectedName: "Projets", siblingsFingerprint: snapshot.siblingsFingerprint })); assert.equal(response.status, 200); assert.equal((await response.json()).verifiedUnchanged, true);
  const changed = fixture(), original = await (await changed.handler(changed.request())).json(); changed.state.changedAfterPatch = () => { changed.permissions[0].role = "reader"; };
  const conflict = await changed.handler(changed.request({ name: "04 — PROJETS", expectedName: "Projets", siblingsFingerprint: original.siblingsFingerprint })); assert.equal(conflict.status, 409); assert.equal((await conflict.json()).error, "root_contents_or_permissions_changed");
});
