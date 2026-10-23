/** Loopback-only actual Auth/RLS/RPC integration. No production endpoints accepted. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
const require = createRequire(import.meta.url), { Client } = require("pg"), { createClient } = require("@supabase/supabase-js");
const status = JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE, "utf8"));
const fixture = JSON.parse(readFileSync(process.env.FONCIERE_PRIVATE_FIXTURE, "utf8"));
assert.equal(new URL(status.API_URL).hostname, "127.0.0.1"); assert.equal(new URL(status.API_URL).port, "55931");
assert.equal(new URL(status.DB_URL).hostname, "127.0.0.1"); assert.equal(new URL(status.DB_URL).port, "55932");
assert.equal(process.env.FONCIERE_TEST_ACK, "fictitious-local-only");
const compiled = resolve(process.env.FONCIERE_CONTACTS_COMPILED), out = resolve(process.env.FONCIERE_ARTIFACTS);
mkdirSync(out, { recursive: true });
const { createFonciereRepository } = require(join(compiled, "lib/fonciere/repository.js"));
const { createFonciereData } = require(join(compiled, "lib/fonciere/model.js"));
const { applyProjectContact } = require(join(compiled, "lib/fonciere/contacts.js"));
const sql = new Client({ connectionString: status.DB_URL }), users = {}, results = [];
const ok = async promise => { const result = await promise; if (result.error) throw Object.assign(new Error("Expected success"), { cause: result.error }); return result.data; };
const test = async (name, run) => { await run(); results.push({ name, passed: true }); console.log("PASS " + name); };
await sql.connect();
try {
  await test("additive contact migration preserves CRM records, projects, links, memberships and grants", async () => {
    const exists = await sql.query("select 1 from information_schema.columns where table_schema='public' and table_name='fonciere_project_contacts' and column_name='agency_contact_id'");
    if (exists.rowCount) return;
    const snapshot = async () => Object.fromEntries(await Promise.all(["crm_workspace_state", "fonciere_projects", "fonciere_project_contacts", "app_memberships", "crm_module_grants"].map(async table => [table, (await sql.query(`select to_jsonb(t) r from public.${table} t order by to_jsonb(t)::text`)).rows])));
    const before = await snapshot(); await sql.query(readFileSync("supabase/migrations/20261023092105_fonciere_agency_contact_links.sql", "utf8")); const after = await snapshot();
    for (const key of Object.keys(before)) { if (key === "fonciere_project_contacts") for (const row of after[key]) delete row.r.agency_contact_id; assert.deepEqual(after[key], before[key]); }
  });
  for (const name of ["writer", "other", "noContacts", "reader", "denied", "admin"]) {
    const user = fixture.users[name], client = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    await ok(client.auth.signInWithPassword({ email: user.email, password: user.password })); users[name] = { ...user, client, repository: createFonciereRepository(client) };
  }
  let company, camille, alex;
  await test("fictional canonical company and separate people with different classifications", async () => {
    const previous = JSON.parse(readFileSync(process.env.FONCIERE_PRIVATE_FIXTURE, "utf8")).guidedContacts;
    if (previous) {
      [company, camille, alex] = await Promise.all([previous.company, previous.camille, previous.alex].map(id => users.writer.repository.readContact(id))); return;
    }
    const base = { firstName: "", name: "", companyName: "Agence Côte Azur fictive", phone: "", email: "", city: "Nice", postalAddress: "" };
    company = await users.writer.repository.createContact({ ...base, entityType: "company", email: "agency-guided@example.invalid", phone: "04 93 00 00 44", postalAddress: "99 avenue des Tests" });
    camille = await users.writer.repository.createContact({ ...base, entityType: "person", firstName: "Camille", name: "Génévier", email: "camille-guided@example.invalid", phone: "+33 6 12 34 56 78", postalAddress: "Adresse personnelle fictive" });
    alex = await users.writer.repository.createContact({ ...base, entityType: "person", firstName: "Alex", name: "Durand", email: "alex-guided@example.invalid", phone: "06 98 76 54 32" });
    for (const [row, kind] of [[camille, "Client"], [alex, "Propriétaire"]]) {
      const snapshot = await ok(users.writer.client.rpc("crm_read_module", { p_module: "contacts" }));
      await ok(users.writer.client.rpc("crm_mutate_record", { p_module: "contacts", p_collection: "contacts", p_id: row.id, p_patch: { kind }, p_revision: snapshot.revision, p_delete: false }));
    }
    const nextFixture = JSON.parse(readFileSync(process.env.FONCIERE_PRIVATE_FIXTURE, "utf8"));
    nextFixture.guidedContacts = { company: company.id, camille: camille.id, alex: alex.id }; writeFileSync(process.env.FONCIERE_PRIVATE_FIXTURE, JSON.stringify(nextFixture), { mode: 0o600 });
  });
  await test("same authorized person found through company, names, reverse order, combined fragments and phone variants", async () => {
    for (const query of ["COTE AZUR", "camille", "genevier", "gene cam", "cam gene", "cote cam", "0612345678", "06.12.34.56.78", "cote +33 6 12 34 56 78"]) assert.ok((await users.writer.repository.searchContacts(query)).some(row => row.id === camille.id), query);
    const agency = await users.writer.repository.searchContacts("cote azur"); assert.ok(agency.some(row => row.id === camille.id)); assert.ok(agency.some(row => row.id === alex.id));
    assert.equal((await users.writer.repository.readContact(camille.id)).id, camille.id);
  });
  if (process.env.FONCIERE_CONTACTS_APPLY_ONLY === "1") { writeFileSync(join(out, "contacts-server-seed.json"), JSON.stringify({ passed: true, actualLocalAuthDatabase: true, results }, null, 2)); }
  else {
    let data = createFonciereData(); data.name = "Projet contacts guidés fictif";
    data = applyProjectContact(data, "agency", company); data = applyProjectContact(data, "agent", camille);
    let saved;
    await test("separate canonical agency and agent IDs save then reload independently of searches", async () => {
      saved = await users.writer.repository.saveProject({ data });
      const loaded = await users.writer.repository.loadProject(saved.project.id); assert.equal(loaded.data.agentContactId, camille.id); assert.equal(loaded.data.agencyContactId, company.id);
      assert.equal(loaded.data.agentPhone, camille.phone); assert.equal(loaded.data.agencyPhone, company.phone); assert.equal(loaded.data.agencyAddress, company.postalAddress); assert.notEqual(loaded.data.agencyAddress, camille.postalAddress);
      assert.equal(JSON.stringify(loaded.project.payload).includes(camille.id), false); assert.equal(JSON.stringify(loaded.project.payload).includes(company.id), false);
      const nextFixture = JSON.parse(readFileSync(process.env.FONCIERE_PRIVATE_FIXTURE, "utf8")); nextFixture.guidedContacts.project = saved.project.id; writeFileSync(process.env.FONCIERE_PRIVATE_FIXTURE, JSON.stringify(nextFixture), { mode: 0o600 });
    });
    await test("no-Contacts contributor cannot read/search/forge either ID and saving preserves invisible old links", async () => {
      await sql.query("insert into fonciere_project_assignments(project_id,user_id) values($1,$2) on conflict do nothing", [saved.project.id, users.noContacts.id]);
      const protectedRows = await ok(users.noContacts.client.from("fonciere_project_contacts").select("*")); assert.equal(protectedRows.length, 0);
      await assert.rejects(users.noContacts.repository.searchContacts("camille")); await assert.rejects(users.noContacts.repository.readContact(camille.id));
      const hidden = await users.noContacts.repository.loadProject(saved.project.id); assert.equal(hidden.data.agentContactId, ""); assert.equal(hidden.data.agencyContactId, "");
      const forbidden = await users.noContacts.client.rpc("fonciere_save_project", { p_id: saved.project.id, p_expected_revision: hidden.project.revision, p_payload: hidden.project.payload, p_contact: "", p_agency_contact: company.id }); assert.ok(forbidden.error);
      const anonymous = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } }); assert.ok((await anonymous.rpc("fonciere_save_project", { p_id: saved.project.id, p_expected_revision: hidden.project.revision, p_payload: hidden.project.payload, p_contact: "", p_agency_contact: company.id })).error);
      await users.noContacts.repository.saveProject({ data: { ...hidden.data, notes: "Correction sans accès Contacts" }, previous: hidden });
      saved = await users.writer.repository.loadProject(saved.project.id); assert.equal(saved.data.agentContactId, camille.id); assert.equal(saved.data.agencyContactId, company.id);
    });
    await test("server rejects absent canonical identity and person masquerading as company", async () => {
      for (const agency of ["missing-contact", camille.id]) { const result = await users.writer.client.rpc("fonciere_save_project", { p_id: saved.project.id, p_expected_revision: saved.project.revision, p_payload: saved.project.payload, p_contact: camille.id, p_agency_contact: agency }); assert.ok(result.error); }
      const forgedPayload = structuredClone(saved.project.payload); forgedPayload.data.agencyContactId = company.id;
      assert.ok((await users.writer.client.rpc("fonciere_save_project", { p_id: saved.project.id, p_expected_revision: saved.project.revision, p_payload: forgedPayload, p_contact: camille.id, p_agency_contact: company.id })).error);
    });
    await test("old four-argument save API preserves the newer separate agency identity", async () => {
      await ok(users.writer.client.rpc("fonciere_save_project", { p_id: saved.project.id, p_expected_revision: saved.project.revision, p_payload: saved.project.payload, p_contact: alex.id }));
      saved = await users.writer.repository.loadProject(saved.project.id); assert.equal(saved.data.agentContactId, alex.id); assert.equal(saved.data.agencyContactId, company.id);
    });
    await test("protected agency and agent identities cannot be deleted while linked", async () => {
      for (const id of [alex.id, company.id]) {
        const snapshot = await ok(users.writer.client.rpc("crm_read_module", { p_module: "contacts" }));
        const result = await users.writer.client.rpc("crm_mutate_record", { p_module: "contacts", p_collection: "contacts", p_id: id, p_patch: {}, p_revision: snapshot.revision, p_delete: true }); assert.ok(result.error);
      }
    });
    await test("switch and unlink persist without mixed person coordinates or agency loss", async () => {
      saved = await users.writer.repository.saveProject({ data: applyProjectContact(saved.data, "agent", null), previous: saved });
      assert.equal((await users.writer.repository.loadProject(saved.project.id)).data.agentContactId, ""); assert.equal(saved.data.agencyContactId, company.id);
      saved = await users.writer.repository.saveProject({ data: applyProjectContact(saved.data, "agent", camille), previous: saved });
      assert.equal(saved.data.agentEmail, camille.email); assert.equal(saved.data.agencyEmail, company.email);
    });
    await test("Contacts read-only role cannot create and duplicate checks prevent existing person/phone/company", async () => {
      await assert.rejects(users.other.repository.createContact({ ...camille, name: "Forbidden", email: "forbidden-new@example.invalid", phone: "" }));
      for (const input of [{ ...camille, email: "", phone: "" }, { ...alex, email: "", phone: "06 12 34 56 78" }, { ...company, email: "", phone: "" }]) await assert.rejects(users.writer.repository.createContact(input), /déjà/);
    });
    writeFileSync(join(out, "contacts-server-results.json"), JSON.stringify({ passed: true, actualLocalAuthDatabase: true, remoteWrites: 0, results }, null, 2));
  }
} finally { await sql.end(); }
