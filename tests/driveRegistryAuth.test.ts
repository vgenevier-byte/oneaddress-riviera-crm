import test from "node:test";
import assert from "node:assert/strict";
import { createFolderRegistry } from "../lib/server/driveRegistrySupabase";
import { createVendorBankUploadHandler } from "../app/api/drive/vendor-bank-accounts/upload/handler";
import { fictionalContact } from "./fixtures/vendorBanking";
import { mockDrive } from "./fixtures/driveFolders";
import { DriveRouteError } from "../app/api/drive/_utils";

const bearer = "Bearer fictional-user-jwt";
const identity = { workspaceId: "oneaddress-riviera", logicalKey: "vendor:test", parentId: "vendor-root" };
function environment(t: any) {
  const values = {
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.invalid",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fictional-publishable-key",
    GOOGLE_DRIVE_VENDOR_DOCUMENTS_FOLDER_ID: "vendor-root",
    GOOGLE_DRIVE_SHARED_DRIVE_ID: "shared-test"
  };
  for (const [key,value] of Object.entries(values)) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}
function request(authorization: string | null = bearer) {
  const form = new FormData();
  form.append("contactId", fictionalContact.id);
  form.append("file", new File(["%PDF-1.4 fictional"], "fictional.pdf", { type: "application/pdf" }));
  return new Request("http://localhost/api/drive/vendor-bank-accounts/upload", {
    method: "POST", body: form, headers: authorization ? { Authorization: authorization } : {}
  });
}
test("client registre : même JWT, publishable key, uniquement les trois RPC", async t => {
  environment(t);
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: any, init: RequestInit) => {
    const url = new URL(String(input)); paths.push(url.pathname);
    const headers = new Headers(init.headers);
    assert.equal(headers.get("authorization"), bearer);
    assert.equal(headers.get("apikey"), "fictional-publishable-key");
    assert.equal(init.method, "POST");
    return Response.json(url.pathname.endsWith("ready") ? true : { workspace_id: identity.workspaceId });
  });
  const registry = createFolderRegistry(bearer);
  assert.deepEqual(Object.keys(registry).sort(), ["claim","ready","reserve"]);
  await registry.claim(identity,"lease"); await registry.reserve(identity,"lease","id"); await registry.ready(identity,"lease","id");
  assert.deepEqual(paths, ["/rest/v1/rpc/crm_drive_folder_claim","/rest/v1/rpc/crm_drive_folder_reserve","/rest/v1/rpc/crm_drive_folder_ready"]);
  assert.throws(() => createFolderRegistry(null), (e: any) => e.status === 401);
});
for (const failure of ["JWT absent", "JWT invalide", "RPC inaccessible", "migration absente"] as const) {
  test(`route authentifiée : ${failure}, aucune création Drive ni fallback`, async t => {
    environment(t);
    const trace: string[] = [];
    t.mock.method(globalThis, "fetch", async (input: any, init: RequestInit) => {
      const url = new URL(String(input)); trace.push(url.pathname);
      assert.equal(new Headers(init.headers).get("authorization"), bearer);
      if (url.pathname === "/auth/v1/user") {
        return failure === "JWT invalide" ? Response.json({ message:"rejected" },{status:401}) : Response.json({ id:"11111111-1111-4111-8111-111111111111", email:"test@example.invalid" });
      }
      if (url.pathname === "/rest/v1/crm_workspace_state") return Response.json({ payload: { contacts: [fictionalContact] } });
      assert.equal(url.pathname,"/rest/v1/rpc/crm_drive_folder_claim");
      if (failure === "RPC inaccessible") throw new Error("internal configuration detail");
      return Response.json({ code:"PGRST202", message:"internal missing function detail" },{status:404});
    });
    const drive = mockDrive(); let drivePosts = 0;
    const response = await createVendorBankUploadHandler({ fetchDrive: async (input,init) => {
      if (init?.method === "POST") drivePosts++;
      if (new URL(input).pathname.endsWith("/vendor-root")) return Response.json({ id:"vendor-root", driveId:"shared-test", mimeType:"application/vnd.google-apps.folder", parents:[] });
      return drive.fetchDrive(input,init);
    } })(request(failure === "JWT absent" ? null : bearer));
    assert.equal(response.status, failure.startsWith("JWT") ? 401 : 503);
    const body = await response.text();
    assert.doesNotMatch(body,/internal|PGRST|NEXT_PUBLIC|GOOGLE_|GCP_|fictional-user-jwt/);
    assert.equal(drivePosts,0); assert.equal(drive.state.generated,0);
    assert.deepEqual(trace, failure === "JWT absent" ? [] : failure === "JWT invalide" ? ["/auth/v1/user"] : ["/auth/v1/user","/rest/v1/crm_workspace_state","/rest/v1/rpc/crm_drive_folder_claim"]);
  });
}
test("configuration absente : erreur générique avant toute écriture", async t => {
  environment(t);
  delete process.env.GOOGLE_DRIVE_VENDOR_DOCUMENTS_FOLDER_ID;
  t.mock.method(globalThis,"fetch", async () => { throw new Error("Unexpected external access"); });
  let driveCalls = 0;
  const response = await createVendorBankUploadHandler({
    requireUser: async () => ({ id:"test",email:"test@example.invalid" }), loadContact: async () => fictionalContact,
    fetchDrive: async () => { driveCalls++; throw new Error("Unexpected Drive access"); }
  })(request());
  assert.equal(response.status,500); assert.deepEqual(await response.json(), { ok:false, error:"Configuration serveur indisponible." });
  assert.equal(driveCalls,0);
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  assert.throws(() => createFolderRegistry(bearer), (e: unknown) => e instanceof DriveRouteError && e.message === "Configuration serveur indisponible.");
});
