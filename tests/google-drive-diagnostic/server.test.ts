import assert from "node:assert/strict";
import test from "node:test";
import {createDriveDiagnosticHandler, requireLiveDiagnosticSession} from "../../app/api/drive/diagnostic/handler";
import {DriveRouteError} from "../../app/api/drive/_utils";
import {inspectContactDriveDestination} from "../../lib/server/contactDriveDiagnostic";
import {GOOGLE_DRIVE_DIAGNOSTIC_OWNER_ID as ownerId, GOOGLE_DRIVE_DIAGNOSTIC_DRIVE_ID as driveId, GOOGLE_DRIVE_DIAGNOSTIC_SERVICE_ACCOUNT as serviceAccount, canUseGoogleDriveDiagnostic} from "../../lib/googleDriveDiagnostic";

const owner = {id: ownerId, email: "vg@oneaddressriviera.com"};
const configuration = {sharedDriveId: driveId, contactsRootId: null, serviceAccountEmail: serviceAccount, humanPrincipals: [owner.email]};
const request = (query = "scope=contacts", method = "GET") => new Request("http://fixture.invalid/api/drive/diagnostic?" + query, {method});
const folder = {id: "fixture-contacts", name: "Documents contacts", mimeType: "application/vnd.google-apps.folder", driveId, parents: ["fixture-parent"], trashed: false, inheritedPermissionsDisabled: true, capabilities: {canAddChildren: true, canListChildren: true}};
const root = {...folder, id: driveId, name: "Drive fictif", parents: []};
const vincent = {id: "fixture-vincent-permission", type: "user", emailAddress: owner.email, role: "organizer", permissionDetails: [{permissionType: "member", role: "organizer", inherited: true, inheritedFrom: driveId}]};
function fixture() {
  const calls: URL[] = [];
  const fetchDrive = async (input: string | URL, init: RequestInit = {}) => {
    const u = new URL(input); calls.push(u);
    assert.equal(init.method, "GET"); assert.equal(init.body, undefined); assert.equal(init.cache, "no-store"); assert(init.signal);
    assert.equal(u.searchParams.has("alt"), false); assert.equal(u.searchParams.has("useDomainAdminAccess"), false);
    if (u.pathname.includes("/drives/")) return Response.json({id: driveId, name: "Drive fictif", orgUnitId: "fixture-unit", capabilities: {canManageMembers: true}, access_token: "fictional-sensitive-marker"});
    if (u.pathname.endsWith("/permissions")) return u.searchParams.has("pageToken") ? Response.json({permissions: [{type: "user", role: "writer", emailAddress: serviceAccount}, {type: "group", role: "writer", emailAddress: "fixture-group@example.invalid"}]}) : Response.json({permissions: [vincent], nextPageToken: "fictional-private-pagination"});
    if (u.pathname.endsWith("/about")) return Response.json({storageQuota: {limit: "1000", usage: "100", usageInDrive: "90"}, refresh_token: "fictional-sensitive-marker"});
    if (u.pathname === "/drive/v3/files") return Response.json({files: [folder]});
    if (u.pathname.endsWith("/" + driveId)) return Response.json(root);
    if (u.pathname.endsWith("/fixture-contacts")) return Response.json(folder);
    if (u.pathname.endsWith("/fixture-parent")) return Response.json({...root, id: "fixture-parent", name: "Parent fictif", parents: [driveId]});
    throw new Error("Unexpected metadata URL");
  };
  return {calls, fetchDrive};
}
function dependencies() {
  const f = fixture(); let tokens = 0, probes = 0, users = 0;
  return {...f, get counts() {return {tokens, probes, users};}, base: {
    requireUser: async () => {users++; return owner;}, requireLiveSession: async () => {probes++;},
    getSharedDriveId: () => driveId, getGcpServiceAccountEmail: () => serviceAccount,
    contactsRootId: () => null, getGoogleAccessToken: async () => {tokens++; return "fictional-memory-only-token";}, fetchDrive: f.fetchDrive
  }};
}

test("owner + active/full/general-admin UI gate; server rejects absent/expired/limited/non-owner before WIF", async () => {
  assert.equal(canUseGoogleDriveDiagnostic(ownerId, {active: true, generalAdmin: true, fullAccess: true}), true);
  for (const access of [{active: false, generalAdmin: true, fullAccess: true}, {active: true, generalAdmin: false, fullAccess: true}, {active: true, generalAdmin: true, fullAccess: false}, null]) assert.equal(canUseGoogleDriveDiagnostic(ownerId, access), false);
  assert.equal(canUseGoogleDriveDiagnostic("fixture-another-owner", {active: true, generalAdmin: true, fullAccess: true}), false);
  const f = dependencies();
  const absent = await createDriveDiagnosticHandler({...f.base, requireUser: undefined})(request());
  assert.equal(absent.status, 401); assert.equal(absent.headers.get("cache-control"), "private, no-store");
  const body = await absent.json(); assert.equal(body.error.stage, "crm"); assert.equal(body.reconnect, true); assert.equal(body.googleAuthentication.status, "unknown");
  for (const status of [401, 403, 503]) {
    const response = await createDriveDiagnosticHandler({...f.base, requireUser: async () => {throw new DriveRouteError("arbitrary private details must not be returned", status);}})(request());
    const data = await response.json(); assert.equal(response.status, status); assert.equal(data.error.stage, "crm"); assert.equal(JSON.stringify(data).includes("arbitrary"), false);
  }
  assert.equal((await createDriveDiagnosticHandler({...f.base, requireUser: async () => ({id: "fixture-another-owner", email: owner.email})})(request())).status, 403);
  assert.deepEqual(f.counts, {tokens: 0, probes: 0, users: 0}); assert.equal(f.calls.length, 0);
});

test("strict GET/parameters/configuration rejects target override and all network operations", async () => {
  const f = dependencies();
  for (const query of ["scope=contacts&fileId=arbitrary", "scope=contacts&parentId=arbitrary", "scope=contacts&scope=contacts", "scope=contacts&token=fictional"]) assert.equal((await createDriveDiagnosticHandler(f.base)(request(query))).status, 400);
  assert.equal((await createDriveDiagnosticHandler(f.base)(request("scope=contacts", "POST"))).status, 405);
  for (const override of [{getSharedDriveId: () => "another-drive"}, {getGcpServiceAccountEmail: () => "another@fixture.iam.gserviceaccount.com"}]) {
    const result = await createDriveDiagnosticHandler({...f.base, ...override})(request()); assert.equal(result.status, 503); assert.equal((await result.json()).error.stage, "configuration");
  }
  assert.equal(f.counts.tokens, 0); assert.equal(f.calls.length, 0);
});

test("one WIF acquisition; GET-only metadata, direct/inherited ACLs, bounded parents, unapproved managers and scoped capacity", async () => {
  const f = dependencies(), response = await createDriveDiagnosticHandler(f.base)(request()), data = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("vary"), "Authorization");
  assert.equal(data.crmAuthentication.status, "validated"); assert.equal(data.googleAuthentication.status, "succeeded"); assert.equal(data.status, "available"); assert.equal(data.sharedDrive.data.id, driveId);
  assert.equal(data.drivePermissions.data.length, 3); assert.equal(data.humanPrincipals[0].observation, "observed"); assert.equal(data.humanPrincipals[0].effectiveAccess, "not-verified");
  assert.equal(data.humanPrincipals[0].visiblePermissions[0].permissionDetails[0].inherited, true); assert.equal(data.technicalPrincipal.observation, "observed");
  assert.equal(data.contactsFolder.folders[0].parents[0].metadata.data.name, "Parent fictif"); assert.equal(data.contactsFolder.folders[0].ancestryNotFullyChecked, true);
  assert(data.managers.length > 0); assert(data.managers.every((manager: {approved: boolean}) => manager.approved === false));
  assert.equal(data.quota.data.available, "900"); assert.equal(data.quota.scope, "technical-identity"); assert.equal(data.quota.organizationPooledCapacity, "not-determined"); assert.equal(data.quota.sharedDriveFreeCapacity, "not-determined");
  assert(!JSON.stringify(data).includes("fictional-sensitive-marker")); assert(!JSON.stringify(data).includes("fictional-private-pagination")); assert(!JSON.stringify(data).includes("fictional-memory-only-token"));
  assert.deepEqual(f.counts, {tokens: 1, probes: 2, users: 2});
});

test("safe precise WIF/OIDC/IAM categories never expose SDK payloads or secret-bearing errors", async () => {
  const categories = [
    {error: {response: {data: {error: "invalid_grant", error_description: "Attribute condition rejected; fictional-sensitive-marker"}}}, code: "wif_attribute_condition_rejected"},
    {error: {response: {data: {error: "invalid_grant", error_description: "fictional-sensitive-marker"}}}, code: "wif_subject_rejected"},
    {error: {response: {status: 403, data: {error: {status: "PERMISSION_DENIED", message: "fictional-sensitive-marker"}}}}, code: "google_identity_permission_denied"},
    {error: new DriveRouteError("fictional-sensitive-marker", 503), code: "vercel_oidc_unavailable"},
    {error: new Error("Bearer fictional-sensitive-marker"), code: "google_wif_token_acquisition_failed"}
  ];
  for (const {error, code} of categories) {
    const f = dependencies(); const response = await createDriveDiagnosticHandler({...f.base, getGoogleAccessToken: async () => {throw error;}})(request()), data = await response.json();
    assert.equal(data.crmAuthentication.status, "validated"); assert.equal(data.googleAuthentication.status, "failed"); assert.equal(data.error.stage, "google"); assert.equal(data.error.code, code); assert(!JSON.stringify(data).includes("fictional-sensitive-marker")); assert.equal(f.calls.length, 0);
  }
});

test("metadata403/404 remain unknown permissions/folder; Drive401 distinguishes rejected Google authentication", async () => {
  for (const status of [403, 404, 401]) {
    const f = dependencies(); let reads = 0;
    const response = await createDriveDiagnosticHandler({...f.base, fetchDrive: async () => {reads++; return Response.json({error: {message: "fictional-sensitive-marker"}}, {status});}})(request());
    const data = await response.json(); assert.equal(data.crmAuthentication.status, "validated"); assert.equal(data.googleAuthentication.status, status === 401 ? "failed" : "succeeded");
    assert.equal(data.humanPrincipals[0].observation, "unknown"); assert.equal(data.contactsFolder.absenceEstablished, false); assert.equal(data.quota.data, null); assert(!JSON.stringify(data).includes("fictional-sensitive-marker"));
    if (status === 401) {assert.equal(data.error.stage, "google"); assert.equal(data.error.code, "google_access_token_rejected"); assert.equal(reads, 1);}
    else assert.equal(data.sharedDrive.reason, "http_" + status);
  }
  const f = fixture(); const data = await inspectContactDriveDestination(configuration, async (input, init) => new URL(input).pathname.endsWith("/about") ? Response.json({storageQuota: {usage: "100"}}) : f.fetchDrive(input, init));
  assert.equal(data.quota?.data?.limit, null); assert.equal(data.quota?.data?.available, null);
});

test("incomplete search/ACL pagination and candidate/parent bounds preserve unknown access and destination", async () => {
  const f = fixture(), pageCounts = new Map<string, number>();
  const data = await inspectContactDriveDestination(configuration, async (input, init) => {
    const u = new URL(input);
    if (u.pathname.endsWith("/permissions")) {
      const page = (pageCounts.get(u.pathname) || 0) + 1; pageCounts.set(u.pathname, page);
      return Response.json({permissions: [], nextPageToken: "fixture-page-" + page});
    }
    if (u.pathname === "/drive/v3/files") return Response.json({files: Array.from({length: 4}, (_, n) => ({...folder, id: "fixture-contacts-" + n, parents: ["fixture-parent", "fixture-unconfirmed-1", "fixture-unconfirmed-2", "fixture-unconfirmed-3"]})), incompleteSearch: true});
    if (u.pathname.includes("fixture-unconfirmed")) return Response.json({}, {status: 404});
    return f.fetchDrive(input, init);
  });
  assert.equal(data.status, "partial"); assert.equal(data.contactsFolder?.search.status, "partial"); assert.equal(data.contactsFolder?.search.reason, "folder_candidate_limit");
  assert.equal(data.contactsFolder?.observedCandidateCount, 4); assert.equal(data.contactsFolder?.folders.length, 3); assert.equal(data.contactsFolder?.absenceEstablished, false);
  assert.equal(data.humanPrincipals?.[0].observation, "unknown"); assert.equal(data.drivePermissions?.status, "partial");
  assert([...pageCounts.values()].every(count => count <= 5));
  assert(data.contactsFolder?.folders.every(candidate => candidate.parents.length <= 3 && candidate.parentSnapshotComplete === false));
});

test("live session is checked before Google and again after metadata; revoked session discards results", async () => {
  for (const failAt of [1, 2]) {
    const f = dependencies(); let probes = 0;
    const response = await createDriveDiagnosticHandler({...f.base, requireLiveSession: async () => {if (++probes === failAt) throw new DriveRouteError("fictional-sensitive-marker", 401);}})(request());
    const data = await response.json(); assert.equal(response.status, 401); assert.equal(data.reconnect, true); assert.equal(data.error.stage, "crm"); assert.equal(data.sharedDrive, undefined); assert(!JSON.stringify(data).includes("fictional-sensitive-marker"));
    if (failAt === 1) {assert.equal(f.calls.length, 0); assert.equal(f.counts.tokens, 0);}
    else assert(f.calls.length > 0);
  }
});

test("published null-owner RPC probe accepts only exact live-session rejection and retrieves no document", async () => {
  const originalFetch = global.fetch, previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture-project.supabase.invalid"; process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "fictional-public-key";
  try {
    for (const response of [{code: "42501", message: "invalid_document_owner", expected: null}, {code: "42501", message: "contact_documents_forbidden", expected: 401}, {code: "42501", message: "invalid_document_owner extra", expected: 401}, {code: "PGRST301", message: "fictional-sensitive-marker", expected: 401}, {code: "XX000", message: "fictional-sensitive-marker", expected: 503}]) {
      let calls = 0;
      global.fetch = async (input, init) => {calls++; assert.equal(String(input), "https://fixture-project.supabase.invalid/rest/v1/rpc/crm_contact_documents"); assert.equal(init?.method, "POST"); assert.equal(init?.cache, "no-store"); assert.deepEqual(JSON.parse(String(init?.body)), {p_contact: null}); return Response.json(response, {status: response.code === "XX000" ? 500 : 403});};
      const req = new Request("http://fixture.invalid", {headers: {authorization: "Bearer fictional-session-only"}});
      if (response.expected === null) await requireLiveDiagnosticSession(req);
      else await assert.rejects(() => requireLiveDiagnosticSession(req), (error) => error instanceof DriveRouteError && error.status === response.expected && !error.message.includes("fictional-sensitive-marker"));
      assert.equal(calls, 1);
    }
  } finally {global.fetch = originalFetch; if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl; if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousKey;}
});

test("real published auth helper requires current membership and fullAccess before WIF, with live-session RPC only", async () => {
  const originalFetch = global.fetch, previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture-project.supabase.invalid"; process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "fictional-public-key";
  try {
    for (const state of ["expired", "inactive", "limited", "owner"] as const) {
      const f = dependencies(), paths: string[] = [];
      global.fetch = async (input, init) => {
        const u = new URL(String(input)); paths.push(u.pathname);
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fictional-session-only"); assert.equal(init?.cache, "no-store");
        if (u.pathname === "/auth/v1/user") return state === "expired" ? Response.json({message: "expired fixture", code: "bad_jwt"}, {status: 401}) : Response.json({...owner, aud: "authenticated", role: "authenticated"});
        if (u.pathname === "/rest/v1/app_memberships") return Response.json(state === "inactive" ? null : {role: "owner"});
        if (u.pathname === "/rest/v1/rpc/crm_authorize_drive") {assert.deepEqual(JSON.parse(String(init?.body)), {p_resource: null, p_write: false, p_download: false}); return Response.json(state !== "limited");}
        if (u.pathname === "/rest/v1/rpc/crm_contact_documents") {assert.deepEqual(JSON.parse(String(init?.body)), {p_contact: null}); return Response.json({code: "42501", message: "invalid_document_owner"}, {status: 403});}
        throw new Error("Unexpected CRM fixture operation");
      };
      const response = await createDriveDiagnosticHandler({...f.base, requireUser: undefined, requireLiveSession: undefined})(new Request("http://fixture.invalid/api/drive/diagnostic?scope=contacts", {headers: {authorization: "Bearer fictional-session-only"}}));
      assert.equal(response.status, state === "owner" ? 200 : state === "expired" ? 401 : 403);
      assert.equal(f.counts.tokens, state === "owner" ? 1 : 0);
      if (state !== "owner") {assert.equal(f.calls.length, 0); assert.equal(paths.includes("/rest/v1/rpc/crm_contact_documents"), false);}
      else assert.equal(paths.filter(path => path === "/rest/v1/rpc/crm_contact_documents").length, 2);
    }
  } finally {global.fetch = originalFetch; if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl; if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousKey;}
});

test("legacy/default diagnostic keeps existing reads/payload and does not introduce owner/probe/WIF changes", async () => {
  const calls: string[] = [], general = {...root, id: "fixture-general", name: "CRM DOCUMENTS", parents: [driveId], capabilities: {canTrash: false}};
  const handler = createDriveDiagnosticHandler({requireUser: async () => ({id: "fixture-nonowner-fullaccess", email: "fixture@example.invalid"}), getSharedDriveId: () => driveId, getGcpProjectId: () => "fixture-project", getGcpServiceAccountEmail: () => serviceAccount, getDocumentsRootFolderId: () => general.id, getSharedDriveMetadata: async () => ({id: driveId, name: "Drive fictif"}), listDriveChildren: async id => {calls.push(id); return id === driveId ? [general] : [];}, requireLiveSession: async () => {throw new Error("must not run");}, getGoogleAccessToken: async () => {throw new Error("must not run");}});
  const normal = await handler(new Request("http://fixture.invalid/api/drive/diagnostic")), other = await handler(request("scope=other"));
  assert.equal(normal.status, 200); assert.deepEqual(await normal.json(), await other.json()); assert.deepEqual(calls, [driveId, general.id, driveId, general.id]);
});
