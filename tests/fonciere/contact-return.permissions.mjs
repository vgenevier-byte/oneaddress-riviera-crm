/** Read-only loopback Auth/RPC audit. Deliberately rejected writes must leave
 * contact counts, canonical links and project revision unchanged. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
const require = createRequire(import.meta.url), { createClient } = require("@supabase/supabase-js");
const fixture = JSON.parse(readFileSync(process.env.FONCIERE_FIXTURE, "utf8"));
assert.equal(new URL(fixture.api).hostname, "127.0.0.1", "Real local fixture only");
const out = process.env.FONCIERE_ARTIFACTS || "/private/tmp/oar-contact-return-evidence";
mkdirSync(out, { recursive: true });
const clients = {}, checks = [];
const ok = async promise => { const result = await promise; assert.equal(result.error, null, result.error?.message); return result.data; };
const pass = name => { checks.push(name); console.log("PASS " + name); };
for (const name of ["admin", "writer", "other", "noContacts", "reader", "denied"]) {
  const client = createClient(fixture.api, fixture.publicKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  await ok(client.auth.signInWithPassword({ email: fixture.users[name].email, password: fixture.users[name].password })); clients[name] = client;
}
const anonymous = createClient(fixture.api, fixture.publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
const before = await ok(clients.admin.rpc("crm_read_module", { p_module: "contacts" }));
for (const name of ["admin", "writer", "other"]) assert.ok(Array.isArray((await ok(clients[name].rpc("crm_read_module", { p_module: "contacts" }))).collections.contacts));
for (const client of [clients.noContacts, clients.denied, anonymous]) assert.ok((await client.rpc("crm_read_module", { p_module: "contacts" })).error);
pass("Actual full, limited and read-only authorized Contacts projections; no grant and anonymous reads are denied");
const forgedIds = [];
for (const client of [clients.other, clients.noContacts, clients.reader, clients.denied, anonymous]) {
  const id = randomUUID(); forgedIds.push(id);
  const result = await client.rpc("crm_mutate_record", { p_module: "contacts", p_collection: "contacts", p_id: id, p_patch: { entityType: "company", companyName: "Fiche interdite fictive", name: "", firstName: "", kind: "Prestataire" }, p_revision: before.revision, p_delete: false });
  assert.ok(result.error, "Server denies forged contextual contact creation regardless of UI");
}
const after = await ok(clients.admin.rpc("crm_read_module", { p_module: "contacts" }));
for (const id of forgedIds) assert.equal(after.collections.contacts.some(contact => contact.id === id), false);
assert.equal(after.collections.contacts.length, before.collections.contacts.length);
pass("Actual RPC denies contact creation for read-only, missing grant, denied and anonymous accounts with no inserted record");
const projectId = fixture.guidedContacts.project;
const saved = (await ok(clients.writer.from("fonciere_projects").select("*").eq("id", projectId).single()));
const linksBefore = await ok(clients.writer.from("fonciere_project_contacts").select("*").eq("project_id", projectId));
for (const agencyId of ["forged-missing-identity", fixture.guidedContacts.camille]) {
  const result = await clients.writer.rpc("fonciere_save_project", { p_id: projectId, p_expected_revision: saved.revision, p_payload: saved.payload, p_contact: fixture.guidedContacts.camille, p_agency_contact: agencyId });
  assert.ok(result.error, "Missing identity and person passed as agency must be rejected");
}
for (const client of [clients.reader, clients.denied, clients.noContacts, anonymous]) {
  const result = await client.rpc("fonciere_save_project", { p_id: projectId, p_expected_revision: saved.revision, p_payload: saved.payload, p_contact: fixture.guidedContacts.camille, p_agency_contact: fixture.guidedContacts.company });
  assert.ok(result.error, "Project rights and Contacts rights both constrain contextual linkage");
}
const current = await ok(clients.writer.from("fonciere_projects").select("*").eq("id", projectId).single());
assert.equal(current.revision, saved.revision); assert.deepEqual(current.payload, saved.payload);
assert.deepEqual(await ok(clients.writer.from("fonciere_project_contacts").select("*").eq("project_id", projectId)), linksBefore);
pass("Actual project RPC rejects forged agency type/identity, missing project or Contacts permission and anonymous linkage; revision and old roles unchanged");
writeFileSync(join(out, "contact-return-permission-results.json"), JSON.stringify({ passed: true, environment: "real loopback Auth/RPC/RLS with existing fictional fixture", checks, productionWrites: 0, admittedMutations: 0 }, null, 2));
