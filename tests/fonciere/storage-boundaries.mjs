import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
const require = createRequire(import.meta.url), { createClient } = require("@supabase/supabase-js"), { Client } = require("pg");
const fixture = JSON.parse(readFileSync(process.env.FONCIERE_PRIVATE_FIXTURE || "/tmp/fonciere-delivery/local-fixture.private.json", "utf8"));
const status = JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE, "utf8"));
assert.equal(new URL(status.API_URL).hostname, "127.0.0.1"); assert.equal(new URL(status.API_URL).port, "55931"); assert.equal(new URL(status.DB_URL).port, "55932"); assert.equal(process.env.FONCIERE_TEST_ACK, "fictitious-local-only");
const { createFonciereRepository } = require("/tmp/fonciere-delivery/storage-compiled/fonciere/repository.js");
const { createFonciereData, toPresentationData } = require("/tmp/fonciere-delivery/storage-compiled/fonciere/model.js");
const { createProjectData } = require("/tmp/fonciere-delivery/generator-current/model.js");
const { createGeneratorRepository } = require("/tmp/fonciere-delivery/generator-current/repository.js");
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }, users = {}, results = [];
const sql = new Client({ connectionString: status.DB_URL });
const hash = buffer => createHash("sha256").update(Buffer.from(buffer)).digest("hex");
async function ok(promise) { const result = await promise; if (result.error) throw Object.assign(new Error("Expected success"), { cause: result.error }); return result.data; }
async function denied(promise) { const result = await promise; assert.ok(result.error || Array.isArray(result.data) && result.data.length === 0); return result; }
let active = "initialization";
async function test(name, run) { active = name; await run(); results.push({ name, passed: true }); console.log("PASS " + name); }
const out = "/tmp/fonciere-delivery/storage"; mkdirSync(out, { recursive: true });
try {
 await sql.connect();
 for (const [name, user] of Object.entries(fixture.users)) {
  assert.ok(user.email.endsWith("@example.invalid")); const client = createClient(status.API_URL, status.ANON_KEY, options); await ok(client.auth.signInWithPassword({ email: user.email, password: user.password })); users[name] = { ...user, client };
 }
 const repo = createFonciereRepository(users.writer.client), generator = createGeneratorRepository(users.writer.client);
 let property, originalWebp;
 await test("failed first upload retains server identity and retry creates exactly one property", async () => {
  const data = { ...createFonciereData(), name: `Reprise fictive ${randomUUID()}` }; let identity;
  await assert.rejects(repo.saveProject({ data, sourceFiles: [new File(["illlisible"], "invalide.pdf", { type: "application/pdf" })], onCreated: draft => { identity = draft; } }), /contenu/);
  assert.ok(identity?.project.id); assert.equal((await repo.loadProject(identity.project.id)).data.name, data.name);
  property = await repo.saveProject({ data, previous: identity, sourceFiles: [new File(["%PDF-1.4\nREPRISE\n%%EOF"], "original.pdf", { type: "application/pdf" })] });
  assert.equal((await repo.listProjects()).filter(row => row.title === data.name).length, 1);
 });
 await test("JPEG, PNG and WebP originals persist byte for byte in property documents", async () => {
  const jpeg = new Uint8Array(Buffer.from(createProjectData().photos.main.split(",")[1], "base64"));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const webp = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
  const originals = [new File([jpeg], "scan.jpg", { type: "image/jpeg" }), new File([png], "scan.png", { type: "image/png" }), new File([webp], "scan.webp", { type: "image/webp" })];
  property = await repo.saveProject({ data: property.data, previous: property, sourceFiles: originals }); property = await repo.loadProject(property.project.id);
  for (const original of originals) {
   const asset = property.assets.find(asset => asset.original_name === original.name), downloaded = await repo.downloadAsset(asset);
   assert.equal(hash(await downloaded.arrayBuffer()), hash(await original.arrayBuffer()));
  }
  originalWebp = originals[2];
 });
 await test("simultaneous contact creations sharing exact coordinates result in one real canonical contact", async () => {
  const email = `race-${randomUUID()}@example.invalid`, input = { name: "Contact concurrent fictif", email };
  const attempts = await Promise.allSettled([repo.createContact(input), repo.createContact(input)]);
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  assert.equal((await repo.searchContacts(email)).filter(contact => contact.email === email).length, 1);
 });
 let savedPresentation;
 await test("presentation independently stores original images including WebP and all seven source slots", async () => {
  const data = toPresentationData(property.data, { id: property.project.id, revision: property.project.revision });
  const dossier = await generator.createProject("Présentation sept originaux fictifs"), files = [originalWebp, ...Array.from({ length: 6 }, (_, index) => new File([`%PDF-1.4\nSOURCE ${index}\n%%EOF`], `source-${index}.pdf`, { type: "application/pdf" }))];
  savedPresentation = await generator.saveProject({ project: dossier, data, sourceFiles: files });
  const loaded = await generator.loadProject(dossier.id); assert.equal(loaded.sourceDocuments.length, 7);
  const webp = loaded.assets.find(asset => asset.original_name === "scan.webp"); assert.equal(hash(await (await generator.downloadAsset(webp)).arrayBuffer()), hash(await originalWebp.arrayBuffer()));
  const links = await ok(users.writer.client.from("fonciere_presentation_sources").select("*").eq("presentation_id", dossier.id)); assert.equal(links.length, 1); assert.equal(links[0].source_project_id, property.project.id); assert.equal(links[0].source_revision, property.project.revision);
 });
 await test("foreign and forged property source identities or future revisions cannot enter a presentation", async () => {
  const foreign = await createFonciereRepository(users.noContacts.client).saveProject({ data: { ...createFonciereData(), name: "Propriété inaccessible source" } });
  for (const source of [{ id: foreign.project.id, revision: foreign.project.revision }, { id: randomUUID(), revision: 1 }, { id: property.project.id, revision: property.project.revision + 1 }, { id: "invalid", revision: 1 }]) {
   const dossier = await generator.createProject("Lien source refusé fictif"), data = toPresentationData(property.data, source);
   await assert.rejects(generator.saveProject({ project: dossier, data }));
   assert.equal((await generator.loadProject(dossier.id)).project.revision, 1);
  }
 });
 await test("stale acknowledged source snapshot remains independently saveable after current property changes", async () => {
  const prior = property; property = await repo.saveProject({ data: { ...property.data, askingPrice: "990000" }, previous: property });
  const dossier = await generator.createProject("Snapshot antérieur fictif"), data = toPresentationData(prior.data, { id: prior.project.id, revision: prior.project.revision });
  const saved = await generator.saveProject({ project: dossier, data }); assert.equal(saved.data.state.asking, prior.data.askingPrice);
  assert.notEqual(saved.data.state.asking, property.data.askingPrice);
 });
 await test("WebP original cannot be forged into a presentation gallery slot; foreign asset source cannot be forged", async () => {
  const raw = structuredClone(savedPresentation.project.payload), webp = savedPresentation.assets.find(asset => asset.original_name === "scan.webp");
  raw.data.importGallery = [{ data: webp.id, label: "Interdit", page: 1, width: 1, height: 1 }];
  await denied(users.writer.client.rpc("izord_save_generator", { p_id: savedPresentation.project.id, p_expected_revision: savedPresentation.project.revision, p_title: savedPresentation.project.title, p_payload: raw, p_status: "draft" }));
  const dossier = await generator.createProject("Référence croisée refusée"), forged = { schema: "IZORD_GENERATOR_V1", data: createProjectData(), sourceDocuments: [webp.id] }; forged.data.photos = { main: "", view: "", inside: "", operation: "" };
  await denied(users.writer.client.rpc("izord_save_generator", { p_id: dossier.id, p_expected_revision: dossier.revision, p_title: dossier.title, p_payload: forged, p_status: "draft" }));
 });
 await test("presentation-only contributor preserves acknowledged source snapshot without reading the source property", async () => {
  await sql.query("update crm_module_grants set level='contribute' where user_id=$1 and module='izord'", [users.other.id]);
  await ok(users.admin.client.rpc("izord_assign_project", { p_project: savedPresentation.project.id, p_user: users.other.id, p_assigned: true }));
  const contributor = createGeneratorRepository(users.other.client), loaded = await contributor.loadProject(savedPresentation.project.id);
  assert.ok(!(await createFonciereRepository(users.other.client).listProjects()).some(project => project.id === property.project.id));
  const saved = await contributor.saveProject({ project: loaded.project, data: { ...loaded.data, state: { ...loaded.data.state, decisionNotes: "Correction présentation autorisée" } }, previous: loaded });
  assert.equal(saved.data.state.decisionNotes, "Correction présentation autorisée");
  const source = structuredClone(saved.data); source.importMeta.fonciereSource.revision = property.project.revision;
  await assert.rejects(contributor.saveProject({ project: saved.project, data: source, previous: saved }));
 });
 await test("source relation RLS follows presentation scope and permits no client write", async () => {
  const anonymous = createClient(status.API_URL, status.ANON_KEY, options); await denied(anonymous.from("fonciere_presentation_sources").select("*"));
  assert.equal((await ok(users.denied.client.from("fonciere_presentation_sources").select("*"))).length, 0);
  await denied(users.writer.client.from("fonciere_presentation_sources").delete().eq("presentation_id", savedPresentation.project.id));
 });
 await test("only project admins/partners can list active assignment options and assign a reader without changing role grants", async () => {
  const before = (await sql.query("select * from crm_module_grants order by user_id,module")).rows;
  const assignmentOptions = await ok(users.admin.client.rpc("fonciere_access_options", { p_project: property.project.id }));
  assert.ok(assignmentOptions.some(option => option.userId === users.reader.id)); assert.ok(!assignmentOptions.some(option => option.userId === users.denied.id));
  assert.ok(assignmentOptions.every(option => Object.keys(option).sort().join(",") === "assigned,email,inherited,role,userId"));
  for (const name of ["writer", "reader", "noContacts", "denied"]) await denied(users[name].client.rpc("fonciere_access_options", { p_project: property.project.id }));
  const anonymous = createClient(status.API_URL, status.ANON_KEY, options); await denied(anonymous.rpc("fonciere_access_options", { p_project: property.project.id }));
  await ok(users.admin.client.rpc("fonciere_assign_project", { p_project: property.project.id, p_user: users.reader.id, p_assigned: true }));
  assert.equal((await createFonciereRepository(users.reader.client).loadProject(property.project.id)).data.name, property.data.name);
  await ok(users.admin.client.rpc("fonciere_assign_project", { p_project: property.project.id, p_user: users.reader.id, p_assigned: false }));
  await assert.rejects(createFonciereRepository(users.reader.client).loadProject(property.project.id));
  assert.deepEqual((await sql.query("select * from crm_module_grants order by user_id,module")).rows, before);
 });
 writeFileSync(out + "/boundary-results.json", JSON.stringify({ realLocalAuth: true, realLocalStorage: true, realLocalPostgREST: true, testCount: results.length, results }, null, 2));
} catch (error) { writeFileSync(out + "/boundary-failure.json", JSON.stringify({ active, message: error.message, cause: error.cause?.message, code: error.cause?.code, details: error.cause?.details, stack: error.stack }, null, 2)); console.error("FAILED " + active + ": " + error.message); process.exitCode = 1; }
finally { await sql.end(); }
