/** Supplemental real browser + local Auth/Contacts RPC only, using fictional data. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const fixture = JSON.parse(readFileSync(process.env.FONCIERE_FIXTURE || "/private/tmp/fonciere-delivery/local-fixture.private.json", "utf8"));
const out = process.env.FONCIERE_ARTIFACTS || "/private/tmp/fonciere-guided-delivery";
assert.equal(new URL(fixture.api).hostname, "127.0.0.1"); assert.equal(new URL(fixture.app).hostname, "127.0.0.1");
mkdirSync(out, { recursive: true });
const results = [], errors = [], run = String(Date.now()); let phase = "startup", token, savedId, createdId;
const pass = name => { results.push({ name, passed: true }); console.log("PASS " + name); };
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.route("**/*", route => { const url = new URL(route.request().url()); return ["data:", "blob:"].includes(url.protocol) || ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort(); });
const page = await context.newPage(); page.setDefaultTimeout(30000); page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.accept());
const project = () => page.locator("[data-fonciere-projects]");
const field = key => page.locator(`#fonciere-${key}`);
const creation = () => page.getByRole("region", { name: "Création de contact CRM", exact: true });
const headers = () => ({ apikey: fixture.publicKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
async function signIn(name, target = page) {
  await target.goto(`${fixture.app}/fonciere`);
  await target.getByRole("textbox", { name: "Email", exact: true }).fill(fixture.users[name].email);
  await target.getByLabel(/Mot de passe|Password/).fill(fixture.users[name].password);
  await target.getByRole("button", { name: /Se connecter|Sign in/, exact: true }).click();
  await target.locator("[data-fonciere-projects]").waitFor();
}
try {
  const auth = await fetch(`${fixture.api}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: fixture.publicKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: fixture.users.writer.email, password: fixture.users.writer.password }) }); assert.ok(auth.ok); token = (await auth.json()).access_token;
  await signIn("writer"); await project().getByRole("button", { name: "Nouveau projet", exact: true }).click(); await field("name").waitFor();
  const initialName = `Création contact guidée ${run}`, finalName = `Création contact corrigée ${run}`;
  await field("name").fill(initialName); await field("agentName").fill("Brouillon Conservé"); await field("agentEmail").fill("camille-guided@example.invalid");
  await page.getByRole("button", { name: "Créer un contact", exact: true }).click(); await creation().waitFor();
  phase = "prefill and duplicate safeguards";
  assert.equal(await creation().getByRole("textbox", { name: "Prénom", exact: true }).inputValue(), "Brouillon"); assert.equal(await creation().getByRole("textbox", { name: "Nom", exact: true }).inputValue(), "Conservé");
  assert.equal(await creation().getByRole("textbox", { name: "Email", exact: true }).inputValue(), "camille-guided@example.invalid");
  await creation().getByRole("button", { name: "Créer et sélectionner", exact: true }).click();
  await creation().getByRole("alert").filter({ hasText: /possède déjà/ }).waitFor();
  assert.equal(await creation().getByRole("textbox", { name: "Email", exact: true }).inputValue(), "camille-guided@example.invalid"); assert.equal(await field("name").inputValue(), initialName);
  pass("Creation prefilled from person fields, duplicate rejected through actual CRM projection, form and project input retained");
  let projectSaveCalls = 0; const saveObserver = request => { if (request.url().endsWith("/rpc/fonciere_save_project") && request.method() === "POST") projectSaveCalls++; }; page.on("request", saveObserver);
  await project().getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByText("Terminez ou annulez la création du contact avant d’enregistrer le projet. Les deux brouillons sont conservés.", { exact: true }).waitFor(); assert.equal(projectSaveCalls, 0); assert.equal(await creation().getByRole("textbox", { name: "Nom", exact: true }).inputValue(), "Conservé");
  pass("Pending contact creation blocks project save with a clear message and preserves both drafts");
  phase = "asynchronous creation and draft preservation";
  await creation().getByRole("textbox", { name: "Prénom", exact: true }).fill("Personne"); await creation().getByRole("textbox", { name: "Nom", exact: true }).fill(`Créée ${run}`);
  await creation().getByRole("textbox", { name: "Entreprise / agence", exact: true }).fill(`Agence Création ${run}`);
  await creation().getByRole("textbox", { name: "Email", exact: true }).fill(`person-created-${run}@example.invalid`);
  await creation().getByRole("textbox", { name: "Téléphone", exact: true }).fill("");
  let releaseMutation, mutationSeen; const mutationReady = new Promise(resolve => { mutationSeen = resolve; });
  await page.route("**/rest/v1/rpc/crm_mutate_record", async route => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON(); if (body.p_collection !== "contacts") return route.continue();
    createdId = body.p_id; mutationSeen(); await new Promise(resolve => { releaseMutation = resolve; }); return route.continue();
  });
  await creation().getByRole("button", { name: "Créer et sélectionner", exact: true }).click(); await mutationReady;
  await field("name").fill(finalName); await field("notes").fill("Correction ailleurs pendant la création du contact");
  await project().getByRole("button", { name: "Enregistrer", exact: true }).click(); assert.equal(projectSaveCalls, 0);
  releaseMutation(); await creation().waitFor({ state: "hidden" }); await page.unroute("**/rest/v1/rpc/crm_mutate_record");
  assert.equal(await field("name").inputValue(), finalName); assert.equal(await field("notes").inputValue(), "Correction ailleurs pendant la création du contact"); assert.match(await field("agentName").inputValue(), /Personne Créée/);
  assert.equal(await page.locator('input[name="agentContactId"]').inputValue(), createdId);
  pass("Actual asynchronous contact creation preserves project edits made during the request and selects the canonical created ID");
  phase = "save and reopen created canonical link";
  const saveResponse = page.waitForResponse(response => response.url().endsWith("/rpc/fonciere_save_project") && response.request().method() === "POST" && response.ok());
  await project().getByRole("button", { name: "Enregistrer", exact: true }).click(); await saveResponse; await page.getByText(/Informations et documents enregistrés/).waitFor();
  const projectResponse = await fetch(`${fixture.api}/rest/v1/fonciere_projects?select=*&title=eq.${encodeURIComponent(finalName)}`, { headers: headers() }); assert.ok(projectResponse.ok); const saved = (await projectResponse.json())[0]; assert.ok(saved); savedId = saved.id;
  const linkResponse = await fetch(`${fixture.api}/rest/v1/fonciere_project_contacts?select=*&project_id=eq.${saved.id}`, { headers: headers() }); assert.ok(linkResponse.ok); assert.equal((await linkResponse.json())[0].contact_id, createdId); assert.equal(JSON.stringify(saved.payload).includes(createdId), false);
  await page.reload(); await field("name").waitFor(); await page.getByRole("button", { name: "Ouvrir le contact", exact: true }).waitFor();
  assert.equal(await page.locator('input[name="agentContactId"]').inputValue(), createdId); assert.equal(await field("name").inputValue(), finalName); assert.equal(await field("notes").inputValue(), "Correction ailleurs pendant la création du contact");
  pass("Created contact and canonical link save and reopen through real Auth/RLS; selected contact loads independently of current search");
  const agentPicker = page.locator(".business-contact-picker-field").filter({ hasText: "Agent immobilier / interlocuteur du CRM" });
  await agentPicker.getByRole("button", { name: "Changer", exact: true }).click();
  await page.getByRole("combobox", { name: "Agent immobilier / interlocuteur du CRM", exact: true }).fill("Côte Azur");
  await page.getByRole("option").filter({ hasText: "Camille" }).waitFor();
  assert.equal(await page.getByRole("option").filter({ hasText: "Alex" }).count(), 1);
  await page.locator("#fonciere-section-agency").screenshot({ path: join(out, "screenshots", "contact-company-search-final.png") });
  phase = "Contacts read-only creation controls";
  const readonlyContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); const readonlyPage = await readonlyContext.newPage(); readonlyPage.setDefaultTimeout(30000);
  try { await signIn("other", readonlyPage); await readonlyPage.locator("[data-fonciere-projects]").getByRole("button", { name: "Nouveau projet", exact: true }).click(); await readonlyPage.locator("#fonciere-name").waitFor(); assert.equal(await readonlyPage.getByRole("button", { name: "Créer un contact", exact: true }).count(), 0); assert.equal(await readonlyPage.getByRole("button", { name: "Créer une fiche entreprise", exact: true }).count(), 0); assert.equal(await readonlyPage.getByRole("combobox", { name: "Agent immobilier / interlocuteur du CRM", exact: true }).isEnabled(), true); pass("Contacts read-only contributor can search existing contacts but sees no contact/company creation controls"); }
  finally { await readonlyContext.close(); }
  assert.deepEqual(errors, []); pass("No uncaught browser errors in supplemental contact creation flows");
} catch (error) { console.error("FAIL " + phase + ": " + error.message); await page.screenshot({ path: join(out, "screenshots", "contacts-creation-failure.png") }).catch(() => {}); throw error; }
finally { writeFileSync(join(out, "contacts-browser-results.json"), JSON.stringify({ passed: results.length === 6 && errors.length === 0, actualLocalAuthBrowser: true, remoteWrites: 0, phase, results, errors, projectId: savedId, createdContactId: createdId }, null, 2)); await context.close(); await browser.close(); }
