import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createDriveFileHandler } from "../app/api/drive/file/handler";
import { GET as diagnosticGET } from "../app/api/drive/diagnostic/route";
import { POST as foldersPOST } from "../app/api/drive/folders/route";
import { POST as uploadPOST } from "../app/api/drive/upload/route";
import { POST as deletePOST } from "../app/api/drive/delete/route";
import { POST as bankPOST } from "../app/api/drive/vendor-bank-accounts/upload/route";

const sharedIds = Array.from({ length: 8 }, (_, index) => `fictional-shared-file-${index + 1}`);
const userId = "11111111-1111-4111-8111-111111111111";

function fixture(t: TestContext) {
  for (const [key, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://fixture.example.invalid",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fictional-key",
    GOOGLE_DRIVE_SHARED_DRIVE_ID: "fictional-shared-drive",
    GOOGLE_DRIVE_DOCUMENTS_FOLDER_ID: "fictional-documents-root",
    GOOGLE_DRIVE_VENDOR_DOCUMENTS_FOLDER_ID: "fictional-business-root"
  })) {
    const old = process.env[key];
    process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  const state = { active: true, documents: true, export: true, shared: true, owner: false, trashed: false, writableParent: true };
  const authorizations: Array<{ p_resource: string | null; p_download: boolean; p_write: boolean }> = [];
  const driveRequests: string[] = [];
  let driveClients = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "fixture.example.invalid");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fictional-current-session");
    assert.equal(init?.cache, "no-store");
    if (url.pathname === "/auth/v1/user") return Response.json({ id: userId, email: "shared@example.invalid" });
    if (url.pathname === "/rest/v1/app_memberships") return Response.json({ role: "member" });
    assert.equal(url.pathname, "/rest/v1/rpc/crm_authorize_drive");
    const args = JSON.parse(String(init?.body));
    authorizations.push(args);
    const allowed = state.active && ((state.owner && (!args.p_write || state.writableParent)) || (
      state.documents && state.shared && sharedIds.includes(args.p_resource) &&
      !args.p_write && (!args.p_download || state.export)
    ));
    return Response.json(allowed);
  });
  const handler = createDriveFileHandler({ createFetchDrive: () => {
    driveClients += 1;
    return async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.hostname, "www.googleapis.com");
      assert.equal(init?.method, "GET");
      driveRequests.push(url.toString());
      const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
      if (url.searchParams.get("alt") === "media") return new Response(`Fictional bytes: ${id}`);
      return Response.json({
        id, name: "Document fictif échantillon.pdf", mimeType: "application/pdf",
        parents: [id === "fictional-business-file" ? "fictional-business-root" : "fictional-documents-root"],
        driveId: id === "fictional-outside-drive" ? "another-fictional-drive" : "fictional-shared-drive",
        trashed: state.trashed,
        webViewLink: `https://drive.google.com/file/d/${id}/view`
      });
    };
  } });
  const request = (id: string, download = false) => new Request(
    `http://localhost/api/drive/file?fileId=${encodeURIComponent(id)}${download ? "&download=1" : ""}`,
    { headers: { authorization: "Bearer fictional-current-session" } }
  );
  return { handler, state, authorizations, driveRequests, request, clients: () => driveClients };
}

test("les huit partages fictifs passent par une autorisation ressource puis GET privé, sans lien Drive", async t => {
  const f = fixture(t);
  for (const id of sharedIds) {
    for (const download of [false, true]) {
      const response = await f.handler(f.request(id, download));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("location"), null);
      assert.match(response.headers.get("content-disposition")!, download ? /^attachment;/ : /^inline;/);
      assert.match(response.headers.get("content-disposition")!, /filename\*=UTF-8''Document%20fictif%20%C3%A9chantillon.pdf/);
      assert.equal(await response.text(), `Fictional bytes: ${id}`);
      assert.deepEqual(f.authorizations.at(-1), { p_resource: id, p_write: false, p_download: download });
    }
  }
  assert.equal(f.authorizations.length, 16);
  assert.equal(f.clients(), 16);
});

test("identifiants directs, fichiers voisins et dossiers non partagés refusés avant Drive", async t => {
  const f = fixture(t);
  for (const id of ["fictional-unshared-file", "fictional-business-file", "fictional-folder", "fictional-future-file"]) {
    for (const download of [false, true]) {
      const response = await f.handler(f.request(id, download));
      assert.equal(response.status, 403);
    }
  }
  assert.equal(f.clients(), 0);
  assert.equal(f.driveRequests.length, 0);
});

for (const revoked of ["shared", "documents", "active"] as const) {
  test(`retrait ${revoked} : le même JWT est revérifié et refusé dès la requête suivante`, async t => {
    const f = fixture(t);
    assert.equal((await f.handler(f.request(sharedIds[0]))).status, 200);
    f.state[revoked] = false;
    assert.equal((await f.handler(f.request(sharedIds[0]))).status, 403);
    assert.equal((await f.handler(f.request(sharedIds[0], true))).status, 403);
    assert.equal(f.authorizations.length, 3);
    assert.equal(f.clients(), 1);
  });
}

test("retrait Export bloque attachment tout en conservant la consultation autorisée", async t => {
  const f = fixture(t);
  assert.equal((await f.handler(f.request(sharedIds[0], true))).status, 200);
  f.state.export = false;
  assert.equal((await f.handler(f.request(sharedIds[0], true))).status, 403);
  assert.equal((await f.handler(f.request(sharedIds[0]))).status, 200);
  assert.equal(f.clients(), 2);
});

test("un fichier partagé dans la corbeille n'est plus consultable ni téléchargeable depuis le CRM", async t => {
  const f = fixture(t);
  f.state.trashed = true;
  for (const download of [false, true]) {
    const response = await f.handler(f.request(sharedIds[0], download));
    assert.equal(response.status, 410);
    assert.match((await response.json()).error, /corbeille/);
  }
  assert.equal(f.driveRequests.filter(url => url.includes("alt=media")).length, 0);
});

test("les huit partages de consultation et téléchargement n'autorisent aucune mise à la corbeille", async t => {
  const f = fixture(t);
  for (const id of sharedIds) {
    const response = await deletePOST(new Request("http://localhost/api/drive/delete", {
      method: "POST",
      headers: { authorization: "Bearer fictional-current-session", "content-type": "application/json" },
      body: JSON.stringify({
        operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", documentId: `crm-${id}`,
        fileId: id, parentFolderId: "", parentDriveFolderId: "fictional-documents-root", revision: "fictional-revision"
      })
    }));
    assert.equal(response.status, 403);
  }
  assert.deepEqual(f.authorizations, sharedIds.map(() => ({ p_resource: null, p_write: false, p_download: false })));
  assert.equal(f.clients(), 0);
  assert.equal(f.driveRequests.length, 0);
});

for (const path of ["folders", "upload"]) {
  test(`parent avec mise à la corbeille engagée : ${path} refusé avant tout client Google`, async t => {
    const f = fixture(t);
    f.state.owner = true;
    f.state.writableParent = false;
    let body: BodyInit;
    const headers: Record<string, string> = {authorization: "Bearer fictional-current-session"};
    if (path === "folders") {
      headers["content-type"] = "application/json";
      body = JSON.stringify({parentDriveFolderId: "fictional-pending-folder", name: "Dossier fictif interdit"});
    } else {
      const form = new FormData();
      form.append("parentDriveFolderId", "fictional-pending-folder");
      form.append("file", new File(["Fictional bytes"], "fictional.txt"));
      body = form;
    }
    const response = await (path === "folders" ? foldersPOST : uploadPOST)(new Request(`http://localhost/api/drive/${path}`, {
      method: "POST", headers, body
    }));
    assert.equal(response.status, 403);
    assert.deepEqual(f.authorizations, [
      {p_resource: null, p_write: false, p_download: false},
      {p_resource: "fictional-pending-folder", p_write: true, p_download: false}
    ]);
    assert.equal(f.clients(), 0);
    assert.equal(f.driveRequests.length, 0);
  });
}

test("propriétaire conserve les documents métier et la validation des racines Drive", async t => {
  const f = fixture(t);
  f.state.owner = true;
  assert.equal((await f.handler(f.request("fictional-business-file", true))).status, 200);
  assert.equal((await f.handler(f.request("fictional-unshared-file"))).status, 200);
  assert.equal((await f.handler(f.request("fictional-outside-drive"))).status, 403);
  assert.equal(f.driveRequests.filter(url => url.includes("fictional-outside-drive") && url.includes("alt=media")).length, 0);
});

for (const [path, handler, method] of [
  ["diagnostic", diagnosticGET, "GET"], ["folders", foldersPOST, "POST"],
  ["upload", uploadPOST, "POST"],
  ["vendor-bank-accounts/upload", bankPOST, "POST"]
] as const) {
  test(`un partage Documents ne donne aucun accès global ni écriture via ${path}`, async t => {
    const f = fixture(t);
    const response = await handler(new Request(`http://localhost/api/drive/${path}`, {
      method, headers: { authorization: "Bearer fictional-current-session" }
    }));
    assert.equal(response.status, 403);
    assert.deepEqual(f.authorizations, [{ p_resource: null, p_write: false, p_download: false }]);
    assert.equal(f.clients(), 0);
  });
}
