import test from "node:test";
import assert from "node:assert/strict";
import { createVendorBankUploadHandler } from "../app/api/drive/vendor-bank-accounts/upload/handler";
import { fictionalContact } from "./fixtures/vendorBanking";
import { memoryFolderRegistry, mockDrive } from "./fixtures/driveFolders";
const requireUser = async () => ({ id: "user-test", email: "test@example.invalid" });
function request(extra?: string, type = "application/pdf", content = "%PDF-1.4 test fictif") {
 const form = new FormData(); form.append("contactId", fictionalContact.id); form.append("file", new File([content], "fictional.pdf", { type })); if (extra) form.append("parentDriveFolderId", extra);
 return new Request("http://localhost/api/drive/vendor-bank-accounts/upload", { method: "POST", body: form });
}
test("upload sans session : 401 avant tout accès externe", async () => {
 const response = await createVendorBankUploadHandler({ fetchDrive: async () => { throw new Error("External access forbidden"); } })(request());
 assert.equal(response.status, 401);
});
test("parent navigateur refusé, format invalide refusé, contact inaccessible refusé", async () => {
 const handler = createVendorBankUploadHandler({ requireUser, loadContact: async () => undefined, fetchDrive: async () => { throw new Error("External access forbidden"); } });
 assert.equal((await handler(request("outside"))).status, 400);
 assert.equal((await handler(request(undefined, "text/html", "<html>"))).status, 400);
 assert.equal((await handler(request(undefined, "application/pdf", "fake pdf"))).status, 400);
 assert.equal((await handler(request())).status, 403);
});
test("upload résout les deux dossiers distribués uniquement sous la racine autorisée", async () => {
 const oldRoot = process.env.GOOGLE_DRIVE_VENDOR_DOCUMENTS_FOLDER_ID; const oldShared = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID;
 process.env.GOOGLE_DRIVE_VENDOR_DOCUMENTS_FOLDER_ID = "vendor-root"; process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID = "shared-test";
 const mock = mockDrive(); const parents: string[] = []; let outside = false;
 const registry = memoryFolderRegistry();
 const handler = createVendorBankUploadHandler({ requireUser, registry, loadContact: async () => fictionalContact, fetchDrive: async (input, init) => {
   const url = new URL(input);
   if (url.pathname.endsWith("/vendor-root")) return Response.json({ id: "vendor-root", driveId: outside ? "outside" : "shared-test", mimeType: "application/vnd.google-apps.folder", parents: [] });
   if (init?.body instanceof FormData) { const meta = JSON.parse(await (init.body.get("metadata") as Blob).text()); parents.push(meta.parents[0]); return Response.json({ id: "rib-file" }); }
   return mock.fetchDrive(input, init);
 } });
 try {
  const first = await handler(request());
  assert.equal(first.status, 200);
  assert.doesNotMatch(JSON.stringify(await first.json()), /lease_token|lease_expires_at|logical_key/);
  assert.equal((await handler(request())).status, 200);
  assert.equal(mock.state.generated, 2); assert.deepEqual(parents, ["reserved-2", "reserved-2"]);
  outside = true; assert.equal((await handler(request())).status, 403);
 } finally { for (const [key, value] of [["GOOGLE_DRIVE_VENDOR_DOCUMENTS_FOLDER_ID", oldRoot], ["GOOGLE_DRIVE_SHARED_DRIVE_ID", oldShared]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; } }
});

test("fichier RIB consultable uniquement avec une session CRM", async () => {
 const { GET } = await import("../app/api/drive/file/route");
 assert.equal((await GET(new Request("http://localhost/api/drive/file?fileId=fictional-rib"))).status, 401);
});
test("ressource sœur dans le même Shared Drive refusée", async () => {
 const { assertAllowedDriveResource } = await import("../app/api/drive/_utils");
 const old = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID; process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID = "shared-test";
 try { await assert.rejects(() => assertAllowedDriveResource("outside", { allowedRootIds: ["vendor-root"], fetchDrive: async () => Response.json({ id: "outside", driveId: "shared-test", parents: ["shared-test"], mimeType: "application/vnd.google-apps.folder" }) }), (error: any) => error.status === 403); }
 finally { if (old === undefined) delete process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID; else process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID = old; }
});
