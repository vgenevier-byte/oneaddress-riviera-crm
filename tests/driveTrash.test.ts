import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createDeleteDriveHandler } from "../app/api/drive/delete/handler";
import { DriveRouteError, type DriveResourceMetadata } from "../app/api/drive/_utils";
import type { DocumentTrashInput, DocumentTrashOperation, DocumentTrashStore } from "../lib/server/documentTrashSupabase";

// The transport and CRM journal below contain fictional resources only. Durable
// SQL authorization and concurrent payload updates have separate local DB tests.
const folderMime = "application/vnd.google-apps.folder";
const root = "fictional-documents-root";
const sharedDrive = "fictional-shared-drive";
const opId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type DocumentRow = { id: string; driveFileId: string; parentId: string; title: string; isFolder: boolean };

function fixture(t: TestContext) {
  for (const [key, value] of Object.entries({
    GOOGLE_DRIVE_SHARED_DRIVE_ID: sharedDrive,
    GOOGLE_DRIVE_DOCUMENTS_FOLDER_ID: root,
    GOOGLE_DRIVE_VENDOR_DOCUMENTS_FOLDER_ID: "fictional-business-root"
  })) {
    const old = process.env[key];
    process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  const records = new Map<string, DocumentRow>([
    ["crm-folder-a", { id: "crm-folder-a", driveFileId: "folder-a", parentId: "", title: "Dossier fictif A", isFolder: true }],
    ["crm-folder-b", { id: "crm-folder-b", driveFileId: "folder-b", parentId: "", title: "Dossier fictif B", isFolder: true }],
    ["crm-file-a", { id: "crm-file-a", driveFileId: "file-a", parentId: "crm-folder-a", title: "Homonyme fictif.pdf", isFolder: false }],
    ["crm-file-b", { id: "crm-file-b", driveFileId: "file-b", parentId: "crm-folder-b", title: "Homonyme fictif.pdf", isFolder: false }]
  ]);
  const files = new Map<string, DriveResourceMetadata>([
    [root, { id: root, name: "Documents fictifs", mimeType: folderMime, parents: [sharedDrive], driveId: sharedDrive, trashed: false, explicitlyTrashed: false, capabilities: { canTrash: true } }],
    ...Array.from(records.values(), row => [row.driveFileId, {
      id: row.driveFileId, name: row.title, mimeType: row.isFolder ? folderMime : "application/pdf",
      parents: [row.parentId ? records.get(row.parentId)!.driveFileId : root], driveId: sharedDrive,
      trashed: false, explicitlyTrashed: false, capabilities: { canTrash: true }
    }] as [string, DriveResourceMetadata])
  ]);
  const journals = new Map<string, DocumentTrashOperation>();
  const calls: Array<{ method: string; id: string; url: string }> = [];
  const state = {
    previewFailure: null as DriveRouteError | null,
    prepareFailure: null as DriveRouteError | null,
    previewCalls: 0, prepareCalls: 0, completeCalls: 0,
    clientCalls: 0, patchCalls: 0, patchResponseLost: 0,
    patchResponseStatus: 200, patchApplies: true, confirmationUnavailable: 0,
    completeFailures: 0, completeResponseLost: 0, finalPending: false,
    concurrentNote: "initial", lastCompletedNote: "", beforePrepare: null as (() => void) | null
  };
  function operation(input: DocumentTrashInput): DocumentTrashOperation {
    const existing = journals.get(input.operationId);
    if (existing) {
      if (existing.resource_id !== input.fileId || existing.record_id !== input.documentId || existing.parent_record_id !== input.parentFolderId) {
        throw new DriveRouteError("Cette opération appartient à une autre cible.", 409);
      }
      return { ...existing };
    }
    const row = records.get(input.documentId);
    if (!row || row.driveFileId !== input.fileId || row.parentId !== input.parentFolderId) {
      throw new DriveRouteError("Le document ou son rattachement a changé.", 409);
    }
    if (row.isFolder && Array.from(records.values()).some(child => child.parentId === row.id)) {
      throw new DriveRouteError("Ce dossier contient encore des fichiers ou sous-dossiers dans le CRM.", 409);
    }
    return {
      operation_id: input.operationId, record_id: row.id, resource_id: row.driveFileId,
      parent_record_id: row.parentId, parent_resource_id: row.parentId ? records.get(row.parentId)!.driveFileId : root,
      is_folder: row.isFolder, status: "pending", snapshot: { ...row }, title: row.title,
      folder_title: row.parentId ? records.get(row.parentId)!.title : "Documents fictifs"
    };
  }
  const store: DocumentTrashStore = {
    async preview(input) {
      state.previewCalls++;
      if (state.previewFailure) throw state.previewFailure;
      return operation(input);
    },
    async prepare(input) {
      state.prepareCalls++;
      state.beforePrepare?.();
      if (state.prepareFailure) throw state.prepareFailure;
      const result = operation(input);
      journals.set(input.operationId, result);
      return { ...result };
    },
    async complete(operationId, drive) {
      state.completeCalls++;
      if (state.completeFailures-- > 0) throw new DriveRouteError("État CRM non confirmé. Reprenez la même opération.", 503);
      const result = journals.get(operationId)!;
      if (state.finalPending) return { ...result, status: "pending" };
      if (result.status !== "completed") {
        assert.equal(drive.id, result.resource_id);
        assert.equal(drive.trashed, true);
        assert.equal(drive.explicitlyTrashed, true);
        records.delete(result.record_id);
        result.status = "completed";
        state.lastCompletedNote = state.concurrentNote;
        result.workspace_payload = { documents: Array.from(records.values()), note: state.concurrentNote };
      }
      if (state.completeResponseLost-- > 0) throw new DriveRouteError("Réponse CRM perdue. Reprenez la même opération.", 503);
      return { ...result };
    }
  };
  const createFetchDrive = () => {
    state.clientCalls++;
    return async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      assert.equal(url.hostname, "www.googleapis.com");
      assert.equal(init?.cache, "no-store");
      assert.ok(init?.signal);
      const method = init?.method || "GET";
      assert.ok(["GET", "PATCH"].includes(method), "Aucune suppression définitive ni emptyTrash");
      assert.equal(url.searchParams.get("supportsAllDrives"), "true");
      const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
      calls.push({ method, id, url: String(url) });
      if (id === "files") {
        const q = url.searchParams.get("q")!;
        assert.match(q, /in parents and trashed = false/);
        assert.equal(q.includes("mimeType"), false, "Les sous-dossiers doivent aussi être comptés");
        const parent = q.match(/^'([^']+)' in parents/)![1];
        return Response.json({ files: Array.from(files.values()).filter(row => !row.trashed && row.parents.includes(parent)) });
      }
      const row = files.get(id);
      if (!row) return Response.json({ error: { message: "Ressource fictive absente" } }, { status: 404 });
      if (method === "PATCH") {
        state.patchCalls++;
        assert.deepEqual(JSON.parse(String(init?.body)), { trashed: true });
        if (state.patchResponseStatus !== 200) return Response.json({ error: { message: "Fictional failure" } }, { status: state.patchResponseStatus });
        if (state.patchApplies) { row.trashed = true; row.explicitlyTrashed = true; }
        if (state.patchResponseLost-- > 0) throw new Error("Lost fictional PATCH reply");
        return Response.json({ id, trashed: true, explicitlyTrashed: true });
      }
      if (state.patchCalls && state.confirmationUnavailable-- > 0) throw new Error("Fictional GET unavailable");
      return Response.json({ ...row });
    };
  };
  const handler = createDeleteDriveHandler({
    requireUser: async () => ({ id: "fictional-actor", email: "fictional@example.invalid" }),
    createFetchDrive,
    createStore: (_request, actor) => { assert.equal(actor, "fictional-actor"); return store; }
  });
  function target(recordId = "crm-file-a", operationId = opId): DocumentTrashInput {
    const row = records.get(recordId)!;
    return {
      operationId, documentId: row.id, fileId: row.driveFileId, parentFolderId: row.parentId,
      parentDriveFolderId: row.parentId ? records.get(row.parentId)!.driveFileId : root, revision: "fictional-revision"
    };
  }
  const request = (input: DocumentTrashInput) => new Request("http://localhost/api/drive/delete", {
    method: "POST", headers: { authorization: "Bearer fictional-jwt", "content-type": "application/json" }, body: JSON.stringify(input)
  });
  return { handler, files, records, journals, calls, state, store, createFetchDrive, request, target };
}

test("fichier puis dossier réellement vide : corbeille confirmée, journal récupérable et compteurs mis à jour", async t => {
  const f = fixture(t);
  const fileInput = f.target();
  const fileResponse = await f.handler(f.request(fileInput));
  assert.equal(fileResponse.status, 200);
  assert.equal(fileResponse.headers.get("cache-control"), "private, no-store");
  const result = await fileResponse.json();
  assert.equal(result.ok, true);
  assert.equal(result.completed, true);
  assert.equal(result.status, "completed");
  assert.equal(result.resource_id, "file-a");
  assert.equal(f.records.size, 3);
  assert.equal(f.files.get("file-a")!.trashed, true);
  assert.equal(f.journals.get(opId)!.snapshot.driveFileId, "file-a");
  assert.equal(f.journals.get(opId)!.folder_title, "Dossier fictif A");
  const folderInput = f.target("crm-folder-a", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  assert.equal((await f.handler(f.request(folderInput))).status, 200);
  assert.equal(f.records.size, 2);
  assert.equal(f.files.get("folder-a")!.trashed, true);
  assert.equal(f.state.patchCalls, 2);
  assert.equal(f.files.get("file-b")!.trashed, false);
  assert.equal(f.files.get("folder-b")!.trashed, false);
  assert.equal((await f.handler(f.request(fileInput))).status, 200, "Rechargement et reprise utilisent le journal conservé");
  assert.equal(f.state.patchCalls, 2);
});

test("dossier CRM non vide refusé avant création du client Google", async t => {
  const f = fixture(t);
  const response = await f.handler(f.request(f.target("crm-folder-a")));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /CRM/);
  assert.equal(f.state.clientCalls, 0);
  assert.equal(f.journals.size, 0);
});

for (const mimeType of ["application/pdf", folderMime]) {
  test(`enfant Drive ${mimeType === folderMime ? "sous-dossier" : "fichier"} absent du CRM : dossier refusé sans récursion`, async t => {
    const f = fixture(t);
    f.records.delete("crm-file-a");
    f.files.delete("file-a");
    f.files.set("unregistered-child", { id: "unregistered-child", name: "Enfant Drive fictif", mimeType, parents: ["folder-a"], driveId: sharedDrive });
    const response = await f.handler(f.request(f.target("crm-folder-a")));
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /fichiers ou sous-dossiers/);
    assert.equal(f.state.patchCalls, 0);
    assert.equal(f.journals.size, 0);
    assert.equal(f.calls.some(call => call.id === "unregistered-child"), false);
  });
}

for (const reason of ["Contribution Documents absente", "droit Suppression absent", "pièce métier ou bancaire protégée", "fichier référencé ailleurs"]) {
  test(`refus CRM exact : ${reason}, aucun accès Google`, async t => {
    const f = fixture(t);
    f.state.previewFailure = new DriveRouteError(reason, reason.includes("absent") ? 403 : 409);
    const response = await f.handler(f.request(f.target()));
    assert.equal(response.status, reason.includes("absent") ? 403 : 409);
    assert.equal(f.state.clientCalls, 0);
    assert.equal(f.state.patchCalls, 0);
    assert.equal(f.records.size, 4);
  });
}

for (const resourceId of [root, sharedDrive, "fictional-business-root"]) {
  test(`racine ${resourceId} refusée avant autorisation de mutation`, async t => {
    const f = fixture(t);
    const response = await f.handler(f.request({ ...f.target(), fileId: resourceId }));
    assert.equal(response.status, 403);
    assert.equal(f.state.previewCalls, 0);
    assert.equal(f.state.clientCalls, 0);
  });
}

for (const outside of ["Drive partagé", "racine Documents", "rattachement CRM"]) {
  test(`ressource hors ${outside} refusée sans PATCH`, async t => {
    const f = fixture(t);
    const row = f.files.get("file-a")!;
    if (outside === "Drive partagé") row.driveId = "another-fictional-drive";
    if (outside === "racine Documents") row.parents = [sharedDrive];
    if (outside === "rattachement CRM") row.parents = ["folder-b"];
    const response = await f.handler(f.request(f.target()));
    assert.equal(response.status, outside === "rattachement CRM" ? 409 : 403);
    assert.equal(f.state.patchCalls, 0);
    assert.equal(f.journals.size, 0);
  });
}

test("homonymes : les identifiants confirmés touchent uniquement le fichier et le dossier choisis", async t => {
  const f = fixture(t);
  const response = await f.handler(f.request(f.target("crm-file-b")));
  assert.equal(response.status, 200);
  assert.equal(f.files.get("file-a")!.trashed, false);
  assert.equal(f.files.get("file-b")!.trashed, true);
  assert.deepEqual(f.calls.filter(call => call.method === "PATCH").map(call => call.id), ["file-b"]);
  assert.equal(f.records.has("crm-file-a"), true);
});

test("identifiant CRM/Drive incohérent et réutilisation d'une opération pour un autre homonyme sont refusés", async t => {
  const f = fixture(t);
  assert.equal((await f.handler(f.request({ ...f.target(), fileId: "file-b" }))).status, 409);
  const first = f.target();
  assert.equal((await f.handler(f.request(first))).status, 200);
  assert.equal((await f.handler(f.request(f.target("crm-file-b")))).status, 409);
  assert.equal(f.state.patchCalls, 1);
  assert.equal(f.files.get("file-b")!.trashed, false);
});

test("double clic : la même opération est idempotente et aucune autre ressource ne change", async t => {
  const f = fixture(t);
  const input = f.target();
  const responses = await Promise.all([f.handler(f.request(input)), f.handler(f.request(input))]);
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(f.journals.size, 1);
  assert.equal(f.records.size, 3);
  assert.ok(f.calls.filter(call => call.method === "PATCH").every(call => call.id === "file-a"));
  assert.equal(f.files.get("file-b")!.trashed, false);
});

for (const failure of ["PATCH perdu", "GET confirmation perdu", "finalisation CRM indisponible", "réponse finalisation perdue"]) {
  test(`${failure} : aucun succès prématuré, reprise du même journal sans nouveau PATCH`, async t => {
    const f = fixture(t);
    const input = f.target();
    if (failure === "PATCH perdu") f.state.patchResponseLost = 1;
    if (failure === "GET confirmation perdu") f.state.confirmationUnavailable = 1;
    if (failure === "finalisation CRM indisponible") f.state.completeFailures = 1;
    if (failure === "réponse finalisation perdue") f.state.completeResponseLost = 1;
    const response = await f.handler(f.request(input));
    assert.ok(response.status >= 500);
    assert.equal((await response.json()).ok, false);
    if (failure !== "réponse finalisation perdue") assert.equal(f.records.has("crm-file-a"), true);
    assert.equal(f.files.get("file-a")!.trashed, true);
    assert.equal(f.state.patchCalls, 1);
    const resumed = await f.handler(f.request(input));
    assert.equal(resumed.status, 200);
    assert.equal((await resumed.json()).status, "completed");
    assert.equal(f.state.patchCalls, 1);
    assert.equal(f.records.has("crm-file-a"), false);
    assert.equal(f.files.get("file-b")!.trashed, false);
  });
}

test("réponse PATCH positive mais Drive non confirmé : fiche conservée, même opération reprise", async t => {
  const f = fixture(t);
  const input = f.target();
  f.state.patchApplies = false;
  const response = await f.handler(f.request(input));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /non confirmé/);
  assert.equal(f.records.has("crm-file-a"), true);
  assert.equal(f.journals.get(opId)!.status, "pending");
  assert.equal(f.state.completeCalls, 0);
  f.state.patchApplies = true;
  assert.equal((await f.handler(f.request(input))).status, 200);
  assert.equal(f.journals.size, 1);
  assert.equal(f.state.patchCalls, 2);
});

test("Drive implicitement dans la corbeille : aucune suppression de fiche ni nouveau PATCH", async t => {
  const f = fixture(t);
  f.files.get("file-a")!.trashed = true;
  f.files.get("file-a")!.explicitlyTrashed = false;
  assert.equal((await f.handler(f.request(f.target()))).status, 409);
  assert.equal(f.state.patchCalls, 0);
  assert.equal(f.state.completeCalls, 0);
  assert.equal(f.records.size, 4);
});

test("permissions Google insuffisantes : besoin capabilities.canTrash explicite sans changement de droits", async t => {
  const f = fixture(t);
  f.files.get("file-a")!.capabilities = { canTrash: false };
  const response = await f.handler(f.request(f.target()));
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /capabilities\.canTrash/);
  assert.equal(f.state.patchCalls, 0);
  assert.equal(f.journals.size, 0);
});

test("refus Google au PATCH : CRM conservé avec journal pour la même reprise", async t => {
  const f = fixture(t);
  f.state.patchResponseStatus = 403;
  const input = f.target();
  const response = await f.handler(f.request(input));
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /capabilities\.canTrash/);
  assert.equal(f.records.has("crm-file-a"), true);
  assert.equal(f.journals.get(opId)!.status, "pending");
  assert.equal(f.state.completeCalls, 0);
  f.state.patchResponseStatus = 200;
  assert.equal((await f.handler(f.request(input))).status, 200);
});

test("revalidation CRM après preflight refuse le changement concurrent avant tout PATCH", async t => {
  const f = fixture(t);
  f.state.prepareFailure = new DriveRouteError("La version cloud a changé.", 409);
  assert.equal((await f.handler(f.request(f.target()))).status, 409);
  assert.equal(f.state.patchCalls, 0);
  assert.equal(f.records.size, 4);
});

test("finalisation conserve les autres modifications concurrentes et retourne le payload courant", async t => {
  const f = fixture(t);
  f.state.beforePrepare = () => { f.state.concurrentNote = "brouillon et modification concurrente préservés"; };
  const response = await f.handler(f.request(f.target()));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).workspace_payload.note, f.state.concurrentNote);
  assert.equal(f.state.lastCompletedNote, "brouillon et modification concurrente préservés");
  assert.equal(f.records.has("crm-file-b"), true);
});

test("un journal encore pending ne permet aucun succès final, même lors d'une reprise completed", async t => {
  const f = fixture(t);
  const input = f.target();
  assert.equal((await f.handler(f.request(input))).status, 200);
  f.state.finalPending = true;
  const response = await f.handler(f.request(input));
  assert.ok(response.status >= 500);
  assert.equal((await response.json()).ok, false);
});
