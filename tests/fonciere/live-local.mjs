/** Real disposable Supabase Auth -> RLS/RPC -> Storage proof. Never accepts a
 * remote endpoint or a reused CRM database; all accounts use example.invalid. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { randomBytes, randomUUID, createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const { Client } = require("pg"), { createClient } = require("@supabase/supabase-js");
const status = JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE, "utf8"));
const api = new URL(status.API_URL), database = new URL(status.DB_URL);
assert.equal(api.hostname, "127.0.0.1"); assert.equal(api.port, "55931");
assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "55932");
assert.equal(process.env.FONCIERE_TEST_ACK, "fictitious-local-only");
const out = resolve(process.env.FONCIERE_ARTIFACTS || "/tmp/fonciere-delivery/storage"); mkdirSync(out, { recursive: true });
const privatePath = resolve(process.env.FONCIERE_PRIVATE_FIXTURE || "/tmp/fonciere-delivery/local-fixture.private.json"); assert.ok(privatePath.startsWith("/tmp/") || privatePath.startsWith("/private/tmp/"));
const compiled = resolve(process.env.FONCIERE_COMPILED || "/tmp/fonciere-delivery/storage-compiled");
const { createFonciereRepository } = require(join(compiled, "fonciere/repository.js"));
const { createFonciereData, toPresentationData, fromPresentationData } = require(join(compiled, "fonciere/model.js"));
const { createProjectData } = require(join(compiled, "izord/model.js"));
const { createGeneratorRepository } = require(join(compiled, "izord/repository.js"));
const sql = new Client({ connectionString: status.DB_URL });
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(api.href, status.SERVICE_ROLE_KEY, options), anonymous = createClient(api.href, status.ANON_KEY, options);
const users = {}, results = [], fixture = { api: status.API_URL, app: "http://127.0.0.1:3159", publicKey: status.ANON_KEY, users: {}, projects: {} };
let active = "initialization";
const hash = value => createHash("sha256").update(value instanceof ArrayBuffer ? Buffer.from(value) : value).digest("hex");
async function ok(promise) { const result = await promise; if (result.error) throw Object.assign(new Error("Expected success"), { cause: result.error }); return result.data; }
async function denied(promise) { const result = await promise; assert.ok(result.error || Array.isArray(result.data) && result.data.length === 0); return result; }
async function test(name, run) { active = name; await run(); results.push({ name, passed: true }); console.log("PASS " + name); }
function writeFixture() { writeFileSync(privatePath, JSON.stringify(fixture), { mode: 0o600 }); }
try {
 await sql.connect();
 if (process.env.FONCIERE_REUSE_TEST_STATE === "1") {
  Object.assign(fixture, JSON.parse(readFileSync(privatePath, "utf8")));
  assert.equal(fixture.api, status.API_URL);
  for (const [name, user] of Object.entries(fixture.users)) {
   const client = createClient(api.href, status.ANON_KEY, options), signed = await ok(client.auth.signInWithPassword({ email: user.email, password: user.password }));
   users[name] = { ...user, client, token: signed.session.access_token };
  }
  await sql.query("update crm_module_grants set level='contribute' where user_id=$1 and module='izord'", [users.other.id]);
 } else {
 await test("fresh loopback database, all historical migrations plus additive Fonciere migration", async () => {
  assert.equal((await sql.query("select count(*)::int n from auth.users")).rows[0].n, 0);
  const base = resolve(process.env.FONCIERE_MIGRATION_ROOT || ".");
  if (process.env.FONCIERE_RESUME_SETUP !== "1") {
   assert.equal((await sql.query("select to_regclass('public.crm_workspace_state') t")).rows[0].t, null, "Refuse to reset an existing database");
   const source = readFileSync("tests/izord/sql-fixture.sql", "utf8");
   await sql.query(source.slice(source.indexOf("create table public.crm_workspace_state"), source.indexOf("create schema storage;")));
   await sql.query("insert into storage.buckets(id,name,public) values('crm-documents','crm-documents',false); create policy crm_docs on storage.objects for all to authenticated using(bucket_id='crm-documents') with check(bucket_id='crm-documents');");
   for (const name of readdirSync(join(base, "supabase/migrations")).filter(name => name.endsWith(".sql") && !name.includes("fonciere")).sort()) await sql.query(readFileSync(join(base, "supabase/migrations", name), "utf8"));
  } else assert.equal((await sql.query("select to_regclass('public.fonciere_projects') t")).rows[0].t, null, "Resume requires unapplied Fonciere migration and no accounts");
  const before = await sql.query("select payload,updated_at from crm_workspace_state"), presentations = await sql.query("select * from izord_projects");
  const migration = readdirSync("supabase/migrations").find(name => name.endsWith("_fonciere_property_projects.sql"));
  await sql.query(readFileSync(join("supabase/migrations", migration), "utf8"));
  for (const name of readdirSync(join(base, "supabase/migrations")).filter(name => name.endsWith("_fonciere_presentation_sources.sql"))) await sql.query(readFileSync(join(base, "supabase/migrations", name), "utf8"));
  assert.deepEqual((await sql.query("select payload,updated_at from crm_workspace_state")).rows, before.rows);
  assert.deepEqual((await sql.query("select * from izord_projects")).rows, presentations.rows);
 });
 await test("fictional users sign in with real local Auth and explicit module/role grants", async () => {
  for (const [name, role, contacts] of [["admin", "admin", "contribute"], ["writer", "contributor", "contribute"], ["other", "contributor", "read"], ["reader", "reader", null], ["noContacts", "contributor", null], ["denied", null, null]]) {
   const email = `fonciere-${name}-${randomUUID()}@example.invalid`, password = randomBytes(24).toString("hex");
   const created = await ok(admin.auth.admin.createUser({ email, password, email_confirm: true }));
   const client = createClient(api.href, status.ANON_KEY, options), signed = await ok(client.auth.signInWithPassword({ email, password }));
   users[name] = { id: created.user.id, email, password, client, token: signed.session.access_token }; fixture.users[name] = { id: created.user.id, email, password, session: signed.session };
   await sql.query("insert into crm_access_profiles(user_id,general_admin) values($1,$2)", [created.user.id, name === "admin"]);
   if (role) {
    await sql.query("insert into app_memberships(user_id,workspace_id,role) values($1,'izord',$2)", [created.user.id, role]);
    await sql.query("insert into crm_module_grants(user_id,module,level,sensitive) values($1,'izord',$2,'{\"export\":true,\"delete\":true}')", [created.user.id, role === "reader" ? "read" : "contribute"]);
   }
   if (contacts || name === "admin") {
    await sql.query("insert into app_memberships(user_id,workspace_id,role) values($1,'oar','member')", [created.user.id]);
    const modules = name === "admin" ? [...new Set([...(await sql.query("select distinct module from app_private.module_collections")).rows.map(row => row.module), "dashboard", "documents", "planning", "bookings", "publisher"])] : ["contacts"];
    for (const moduleId of modules) await sql.query("insert into crm_module_grants(user_id,module,level,sensitive) values($1,$2,$3,$4) on conflict(user_id,module) do nothing", [created.user.id, moduleId, contacts || "contribute", { delete: true, export: true, ...(moduleId === "contacts" ? { bank_read: true, bank_write: true } : {}), ...(moduleId === "vendorInvoices" ? { payment: true } : {}) }]);
   }
  }
  await sql.query("update crm_workspace_state set payload=jsonb_set(payload,'{contacts}',$1::jsonb)", [JSON.stringify([{ id: "fictional-agent", entityType: "person", name: "Martin", firstName: "Camille", companyName: "Agence Démonstration", email: "camille@example.invalid", phone: "+33 6 00 11 22 33", kind: "Prestataire", city: "Nice" }])]);
  for (let retry = 0; ; retry++) { const result = await users.writer.client.from("fonciere_projects").select("id"); if (!result.error) break; if (retry > 40) throw result.error; await new Promise(resolve => setTimeout(resolve, 100)); }
  writeFixture();
 });
 }
 const writer = createFonciereRepository(users.writer.client), other = createFonciereRepository(users.other.client), noContacts = createFonciereRepository(users.noContacts.client);
 let saved;
 await test("manual incomplete project creates, persists, reloads with a newly signed-in client", async () => {
  const data = createFonciereData(); data.name = "Villa de démonstration";
  saved = await writer.saveProject({ data }); assert.equal(saved.project.revision, 2);
  const reconnect = createClient(api.href, status.ANON_KEY, options); await ok(reconnect.auth.signInWithPassword({ email: users.writer.email, password: users.writer.password }));
  assert.equal((await createFonciereRepository(reconnect).loadProject(saved.project.id)).data.name, data.name); fixture.projects.manual = saved.project.id; writeFixture();
 });
 await test("edit, canonical contact link, source PDF and photographs survive real Storage reload byte for byte", async () => {
  const data = structuredClone(saved.data); data.agencyReference = "FICT-042"; data.propertyAddress = "12 avenue des Oliviers"; data.city = "Nice"; data.postalCode = "06000"; data.askingPrice = "1250000"; data.agentContactId = "fictional-agent";
  data.description = "Bien fictif, 180 m² habitables ; piscine et jardin."; data.agencyPotential = "Rénovation annoncée, autorisations à vérifier."; data.worksHypothesis = "120000";
  const jpeg = new Uint8Array(Buffer.from(createProjectData().photos.main.split(",")[1], "base64"));
  data.presentationData.importGallery = [{ data: `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`, label: "Photo fictive", page: 1, width: 1200, height: 800 }];
  data.presentationData.photos.main = data.presentationData.importGallery[0].data;
  const pdf = new File(["%PDF-1.4\nFICHE AGENCE FICTIVE\n%%EOF"], "fiche-fictive.pdf", { type: "application/pdf" });
  saved = await writer.saveProject({ data, previous: saved, sourceFiles: [pdf] });
  const loaded = await writer.loadProject(saved.project.id); assert.equal(loaded.data.agentContactId, "fictional-agent"); assert.equal(loaded.data.propertyAddress, data.propertyAddress); assert.equal(loaded.sourceDocuments.length, 1);
  assert.equal(hash(await (await writer.downloadAsset(loaded.assets.find(asset => asset.id === loaded.sourceDocuments[0]))).arrayBuffer()), hash(await pdf.arrayBuffer()));
  assert.equal(loaded.data.presentationData.importGallery[0].data, data.presentationData.importGallery[0].data); saved = loaded; fixture.projects.rich = loaded.project.id; writeFixture();
 });
 await test("optimistic revisions reject a stale save without losing the saved manual correction", async () => {
  const stale = saved; saved = await writer.saveProject({ data: { ...saved.data, notes: "Correction manuelle conservée" }, previous: saved });
  await assert.rejects(writer.saveProject({ data: { ...stale.data, notes: "Écrasement interdit" }, previous: stale }), /autre modification/);
  assert.equal((await writer.loadProject(saved.project.id)).data.notes, "Correction manuelle conservée");
 });
 await test("anonymous, absent-grant and other contributor cannot read or mutate a property or document", async () => {
  assert.ok(!(await other.listProjects()).some(project => project.id === saved.project.id)); assert.deepEqual(await createFonciereRepository(users.denied.client).listProjects(), []);
  await denied(anonymous.from("fonciere_projects").select("*"));
  await assert.rejects(other.loadProject(saved.project.id)); await assert.rejects(other.downloadAsset(saved.assets[0]));
  await assert.rejects(other.saveProject({ data: saved.data, previous: saved }));
  await denied(users.writer.client.from("fonciere_projects").update({ owner_id: users.other.id }).eq("id", saved.project.id));
 });
 await test("assigned reader can read property and photos but cannot edit, archive, or access canonical Contacts relation", async () => {
  await ok(users.admin.client.rpc("fonciere_assign_project", { p_project: saved.project.id, p_user: users.reader.id, p_assigned: true }));
  const repo = createFonciereRepository(users.reader.client), loaded = await repo.loadProject(saved.project.id);
  assert.equal(loaded.data.name, saved.data.name); assert.equal(loaded.data.agentContactId, "");
  await assert.rejects(repo.saveProject({ data: loaded.data, previous: loaded })); await assert.rejects(repo.archiveProject(loaded.project, true));
  await assert.rejects(repo.searchContacts("Camille"));
 });
 await test("Contacts permission independently governs lookup/create/link; missing/forged IDs are rejected", async () => {
  assert.equal((await writer.searchContacts("camille@example.invalid"))[0].id, "fictional-agent");
  await assert.rejects(writer.saveProject({ data: { ...saved.data, agentContactId: "forged-contact" }, previous: saved }));
  const data = createFonciereData(); data.name = "Projet sans droit Contacts"; data.agentContactId = "fictional-agent";
  await assert.rejects(noContacts.saveProject({ data })); data.agentContactId = ""; const privateProject = await noContacts.saveProject({ data });
  await assert.rejects(noContacts.searchContacts("Camille")); await assert.rejects(noContacts.createContact({ name: "Impossible" }));
  assert.ok(privateProject.project.id);
  const created = await writer.createContact({ name: "Durand", firstName: "Léa", companyName: "Agence fictive", email: `lea-${randomUUID()}@example.invalid` });
  assert.match(created.email, /^lea-.*@example.invalid$/); await assert.rejects(writer.createContact({ name: "Autre nom", email: created.email }), /déjà/);
  saved = await writer.saveProject({ data: { ...saved.data, agentContactId: created.id }, previous: saved }); assert.equal((await writer.loadProject(saved.project.id)).data.agentContactId, created.id);
 });
 await test("contact JSON FK semantics prevent silent removal of a linked canonical identity", async () => {
  const result = await users.writer.client.rpc("crm_read_module", { p_module: "contacts" });
  await denied(users.writer.client.rpc("crm_mutate_record", { p_module: "contacts", p_collection: "contacts", p_id: saved.data.agentContactId, p_patch: {}, p_revision: result.data.revision, p_delete: true }));
  assert.equal((await writer.loadProject(saved.project.id)).data.agentContactId, saved.data.agentContactId);
 });
 await test("project without Contacts permission preserves an existing hidden link on normal property edit", async () => {
  await ok(users.admin.client.rpc("fonciere_assign_project", { p_project: saved.project.id, p_user: users.noContacts.id, p_assigned: true }));
  const loaded = await noContacts.loadProject(saved.project.id); assert.equal(loaded.data.agentContactId, "");
  await noContacts.saveProject({ data: { ...loaded.data, equipment: "Cuisine à vérifier" }, previous: loaded });
  saved = await writer.loadProject(saved.project.id); assert.ok(saved.data.agentContactId);
 });
 await test("cross-property assets and embedded contact identities cannot be injected through RPC", async () => {
  const foreign = await other.saveProject({ data: { ...createFonciereData(), name: "Autre propriété" } });
  const forged = structuredClone(foreign.project.payload); forged.data.presentationData.photos.main = saved.assets.find(asset => asset.kind === "photo").id;
  await denied(users.other.client.rpc("fonciere_save_project", { p_id: foreign.project.id, p_expected_revision: foreign.project.revision, p_payload: forged, p_contact: "" }));
  const own = structuredClone(saved.project.payload); own.data.agentContactId = "fictional-agent";
  await denied(users.writer.client.rpc("fonciere_save_project", { p_id: saved.project.id, p_expected_revision: saved.project.revision, p_payload: own, p_contact: "" }));
 });
 await test("finalized original files reject replacement, move, delete and forged size/MIME finalization", async () => {
  const source = saved.assets.find(asset => asset.kind === "pdf"), store = users.writer.client.storage.from("fonciere-documents");
  await denied(store.upload(source.object_path, new Blob(["%PDF-corrupt"], { type: "application/pdf" }), { upsert: true }));
  await denied(store.move(source.object_path, source.object_path + "-moved"));
  const deleted = await store.remove([source.object_path]); assert.ok(deleted.error || deleted.data.length === 0);
  assert.ok((await writer.downloadAsset(source)).size);
  const path = await ok(users.writer.client.rpc("fonciere_register_asset", { p_project: saved.project.id, p_revision: saved.project.revision, p_kind: "pdf", p_size: 99, p_mime: "application/pdf", p_name: "wrong.pdf" }));
  await ok(store.upload(path, new Blob(["%PDF-1.4\nwrong size"], { type: "application/pdf" })));
  await denied(users.writer.client.rpc("fonciere_finalize_asset", { p_asset: path.split("/")[1] }));
 });
 await test("archive is durable, blocks writes and uploads, restore preserves documents and contact link", async () => {
  const archived = await writer.archiveProject(saved.project, true); assert.equal(archived.status, "archived");
  const loaded = await writer.loadProject(saved.project.id); assert.equal(loaded.project.status, "archived");
  await assert.rejects(writer.saveProject({ data: loaded.data, previous: loaded }));
  await denied(users.writer.client.rpc("fonciere_register_asset", { p_project: saved.project.id, p_revision: archived.revision, p_kind: "pdf", p_size: 5, p_mime: "application/pdf", p_name: "blocked.pdf" }));
  await writer.archiveProject(archived, false); saved = await writer.loadProject(saved.project.id); assert.equal(saved.project.status, "active"); assert.ok(saved.data.agentContactId); assert.ok(saved.sourceDocuments.length);
 });
 await test("presentation gets independent cloned photo/data snapshot and existing revisions stay unchanged after property edit", async () => {
  const presentation = toPresentationData(saved.data, { id: saved.project.id, revision: saved.project.revision });
  assert.equal(presentation.state.project, saved.data.name); assert.equal(presentation.state.asking, saved.data.askingPrice); assert.equal(presentation.importGallery[0].data, saved.data.presentationData.importGallery[0].data);
  const generator = createGeneratorRepository(users.writer.client), dossier = await generator.createProject("Présentation fictive indépendante");
  const generated = await generator.saveProject({ project: dossier, data: presentation });
  const before = JSON.stringify((await generator.loadProject(dossier.id)).data);
  saved = await writer.saveProject({ data: { ...saved.data, askingPrice: "1350000", description: "Modification après présentation" }, previous: saved });
  assert.equal(JSON.stringify((await generator.loadProject(dossier.id)).data), before);
  const reverse = fromPresentationData(presentation); assert.equal(reverse.propertyAddress, saved.data.propertyAddress); assert.equal(reverse.city, saved.data.city);
  fixture.projects.presentation = generated.project.id; writeFixture();
 });
 await test("actual account grant revocation removes property and object access", async () => {
  await sql.query("update crm_module_grants set level='none' where user_id=$1 and module='izord'", [users.other.id]);
  assert.deepEqual(await other.listProjects(), []); await assert.rejects(other.saveProject({ data: { ...createFonciereData(), name: "Refusé" } }));
 });
 await test("all new tables have RLS and no new privileged helper is callable anonymously", async () => {
  const tables = await sql.query("select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname in ('fonciere_projects','fonciere_project_assignments','fonciere_project_contacts','fonciere_assets')"); assert.equal(tables.rowCount, 4); assert.ok(tables.rows.every(row => row.relrowsecurity));
  assert.equal((await sql.query("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like '%fonciere%' and p.prosecdef and has_function_privilege('anon',p.oid,'execute')")).rows[0].n, 0);
 });
 fixture.integrationComplete = true; writeFixture();
 writeFileSync(join(out, "results.json"), JSON.stringify({ realLocalAuth: true, realLocalPostgREST: true, realLocalStorage: true, testCount: results.length, results }, null, 2));
} catch (error) {
 writeFileSync(join(out, "failure.json"), JSON.stringify({ active, message: error.message, cause: error.cause?.message, code: error.cause?.code, detail: error.cause?.details, stack: error.stack }, null, 2));
 console.error("FAILED " + active + ": " + error.message + (error.cause?.code ? " (" + error.cause.code + ")" : "")); process.exitCode = 1;
} finally { await sql.end(); }
