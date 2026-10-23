/** Real, loopback-only Auth/PostgreSQL/Storage + browser workflow with fictional data.
 * No remote application or provider calls. Private fixture credentials are never output.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const JSZip = require("jszip");
const fixture = JSON.parse(readFileSync(process.env.FONCIERE_FIXTURE || "/tmp/fonciere-delivery/local-fixture.private.json", "utf8"));
const output = resolve(process.env.FONCIERE_ARTIFACTS || "/private/tmp/fonciere-delivery");
const screenshots = join(output, "screenshots"); mkdirSync(screenshots, { recursive: true });
assert.equal(new URL(fixture.api).hostname, "127.0.0.1"); assert.equal(new URL(fixture.app).hostname, "127.0.0.1");
const documentPath = "/private/tmp/fonciere-ocr-fixtures/fiche-texte-fictive.pdf";
const scanPath = "/private/tmp/fonciere-ocr-fixtures/fiche-scan-fictive.pdf";
const imagePath = "/private/tmp/fonciere-ocr-fixtures/fiche-ocr-fictive.png";
const resumed = process.env.FONCIERE_RESUME ? JSON.parse(readFileSync(join(output, "browser-results.json"), "utf8")) : null;
const checks = [...(resumed?.checks || [])], issues = [], consoleErrors = [], externalRequests = [];
const runId = process.env.FONCIERE_RUN_ID || resumed?.runId || String(Date.now());
const names = { manual: `Projet Manuel Navigateur ${runId}`, imported: `Projet Nuage Navigateur ${runId}`, direct: `Projet Direct Navigateur ${runId}` };
let phase = "initialization", accessToken, importedId = resumed?.records.importedId, manualId = resumed?.records.manualId, presentationId = resumed?.records.presentationId;
function pass(name) { checks.push(name); console.log(`PASS ${name}`); }
function step(name) { phase = name; console.log(`STEP ${name}`); }
function headers() { return { apikey: fixture.publicKey, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }; }
async function authenticate(user = fixture.users.writer) {
  const response = await fetch(`${fixture.api}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: fixture.publicKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: user.email, password: user.password }) });
  assert(response.ok, `Real local Auth sign-in failed (${response.status})`); accessToken = (await response.json()).access_token;
}
async function rows(table, query) { const response = await fetch(`${fixture.api}/rest/v1/${table}?${query}`, { headers: headers() }); assert(response.ok, `Local REST ${table} returned ${response.status}`); return response.json(); }
async function rowByName(table, name) { const result = await rows(table, `select=*&title=eq.${encodeURIComponent(name)}&order=created_at.desc`); assert(result.length >= 1, `Saved ${table} row missing`); return result[0]; }
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
await context.route("**/*", async route => { const url = new URL(route.request().url()); if (["data:", "blob:"].includes(url.protocol) || ["127.0.0.1", "localhost"].includes(url.hostname)) await route.continue(); else { externalRequests.push(`${url.origin}${url.pathname}`); await route.abort(); } });
const page = await context.newPage(); page.setDefaultTimeout(45000); page.setDefaultNavigationTimeout(60000);
page.on("pageerror", error => consoleErrors.push(error.message));
page.on("request", request => { if(request.url().includes("agency-runtime")) console.log("RESOURCE " + new URL(request.url()).pathname); });
page.on("requestfailed", request => console.log("REQUEST_FAILED " + new URL(request.url()).pathname + " " + request.failure()?.errorText));
page.on("console", message => { if(message.type() === "error") console.log("BROWSER_ERROR " + message.text().slice(0,300)); });
page.on("dialog", dialog => dialog.accept());
let workers = 0; page.on("worker", () => workers++);
const project = () => page.locator("[data-fonciere-projects]");
async function login(user = fixture.users.writer) {
  await page.goto(`${fixture.app}/fonciere`);
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(user.email);
  await page.getByLabel(/Mot de passe|Password/).fill(user.password);
  await page.getByRole("button", { name: /Se connecter|Sign in/, exact: true }).click();
  await project().waitFor({ state: "visible" });
}
async function saveProject() {
  await project().getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByText(/Informations et documents enregistrés/).waitFor();
  await page.waitForFunction(() => !document.querySelector("[data-fonciere-projects]")?.textContent?.includes("Opération en cours"));
}
async function allProjects() { await project().getByRole("button", { name: "Tous les projets", exact: true }).click(); await project().getByRole("textbox", { name: "Rechercher un projet", exact: true }).waitFor(); }
async function fresh() { await project().getByRole("button", { name: "Nouveau projet", exact: true }).click(); await page.locator("#fonciere-name").waitFor(); }
async function importProjectDocument(path) { await project().locator('input[type="file"]').first().setInputFiles(path); await page.getByRole("dialog", { name: "Vérifiez les informations extraites" }).waitFor({ timeout: 150000 }); }
async function applyImport() { await page.getByRole("dialog").getByRole("button", { name: "Appliquer les propositions cochées", exact: true }).click(); await page.getByRole("dialog").waitFor({ state: "hidden" }); }
async function assertNoOverflow(label) { assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: horizontal overflow`); }
async function projectByUrl(id) { await page.goto(`${fixture.app}/fonciere?project=${id}`); await page.locator("#fonciere-name").waitFor(); }
async function selectSource(name) { const picker = page.locator("[data-project-source]"); await picker.getByRole("textbox", { name: "Rechercher un projet", exact: true }).fill(name); await picker.locator("li").filter({ has: page.getByText(name, { exact: true }) }).getByRole("button", { name: "Utiliser ce projet", exact: true }).click(); await page.locator("#izord-project").waitFor(); await page.waitForFunction(expected => document.querySelector("#izord-project")?.value === expected, name); }
try {
  await authenticate();
  if (!resumed) {
  step("real login and navigation"); await login();
  assert(await page.getByText("Foncière", { exact: true }).count() > 0);
  assert(await page.getByText("Présentations Projets", { exact: true }).count() > 0);
  await assertNoOverflow("desktop projects"); pass("Real local Auth login and Foncière navigation on desktop");

  step("manual minimal creation and durable edits"); await fresh();
  await page.locator("#fonciere-name").fill(names.manual); await saveProject();
  let manual = await rowByName("fonciere_projects", names.manual); manualId = manual.id;
  assert.equal(manual.payload.data.name, names.manual); assert.equal(manual.payload.data.propertyAddress, "");
  await page.locator("#fonciere-propertyAddress").fill("42 rue des Essais Fictifs");
  await page.locator("#fonciere-agencyReference").fill(`MAN-${runId}`);
  await page.locator("#fonciere-askingPrice").fill("345000");
  await page.locator("#fonciere-description").fill("Maison fictive enregistrée sans import, puis complétée manuellement.");
  await saveProject(); await page.reload(); await page.locator("#fonciere-name").waitFor();
  assert.equal(await page.locator("#fonciere-propertyAddress").inputValue(), "42 rue des Essais Fictifs");
  pass("Manual name-only creation, edits, real server save and page reload");

  step("sign out and real sign in persistence");
  await page.getByRole("button", { name: /Se déconnecter|Déconnexion|Sign out|Log out/, exact: true }).click();
  await page.getByRole("textbox", { name: "Email", exact: true }).waitFor(); await login(); await projectByUrl(manualId);
  assert.equal(await page.locator("#fonciere-agencyReference").inputValue(), `MAN-${runId}`);
  pass("Saved project found after real logout, fresh login and canonical project deep link");

  step("known brochure import and editable review"); await allProjects(); await importProjectDocument(documentPath);
  const review = page.getByRole("dialog");
  assert.equal(await review.locator('[data-project-proposal="askingPrice"] textarea').inputValue(), "545000");
  assert.equal(await review.locator('[data-project-proposal="propertyAddress"] textarea').inputValue(), "12 rue des Nuages");
  assert.match(await review.locator('[data-project-proposal="agencyAddress"] textarea').inputValue(), /99 avenue du Test/);
  await review.locator('[data-project-proposal="askingPrice"] textarea').fill("552000");
  await applyImport();
  await page.locator("#fonciere-name").fill(names.imported);
  assert.equal(await page.locator("#fonciere-askingPrice").inputValue(), "552000");
  assert.equal(await page.locator("#fonciere-worksHypothesis").inputValue(), "");
  assert.equal(await page.locator("#fonciere-resaleHypothesis").inputValue(), "");
  assert.match(await page.locator("#fonciere-agencyPotential").inputValue(), /autorisation/i);
  assert(await project().locator("[data-project-gallery] img").count() >= 1);
  pass("Known PDF extracted price/address/photo; reviewed correction and distinct agency address; personal assumptions empty");

  step("existing CRM contact lookup and link");
  await page.locator("#fonciere-agentEmail").fill("camille@example.invalid");
  await page.locator("#fonciere-agentPhone").fill("+33 6 00 11 22 33");
  await project().getByRole("textbox", { name: "Rechercher un contact CRM", exact: true }).fill("camille@example.invalid");
  await project().getByRole("button").filter({ hasText: "Camille Martin" }).first().click();
  await saveProject();
  let imported = await rowByName("fonciere_projects", names.imported); importedId = imported.id;
  const link = await rows("fonciere_project_contacts", `select=*&project_id=eq.${importedId}`);
  assert.equal(link.length, 1); assert.equal(link[0].contact_id, "fictional-agent");
  assert(imported.payload.sourceDocuments.length === 1);
  await projectByUrl(importedId);
  assert.equal(await page.locator("#fonciere-askingPrice").inputValue(), "552000");
  assert(await project().locator("[data-project-gallery] img").count() >= 1);
  assert(await project().getByRole("button", { name: "Ouvrir le contact", exact: true }).count() === 1);
  const [original] = await Promise.all([page.waitForEvent("download"), project().getByRole("button", { name: "Télécharger fiche-texte-fictive.pdf", exact: true }).click()]);
  const originalPath = join(output, "downloaded-original-fictive.pdf"); await original.saveAs(originalPath);
  assert.equal(createHash("sha256").update(readFileSync(originalPath)).digest("hex"), createHash("sha256").update(readFileSync(documentPath)).digest("hex"));
  pass("Existing real CRM contact linked; original PDF byte-identical and photo durable after reload");

  step("safe reimport and new contact creation"); await importProjectDocument(documentPath);
  assert.equal(await page.getByRole("dialog").locator('[data-project-proposal="askingPrice"] input[type=checkbox]').isChecked(), false);
  await applyImport(); assert.equal(await page.locator("#fonciere-askingPrice").inputValue(), "552000");
  await page.locator("#fonciere-agentName").fill("Nouveau Test Fictif");
  await page.locator("#fonciere-agentEmail").fill(`nouveau-${runId}@example.invalid`);
  await page.locator("#fonciere-agentPhone").fill(`+33 6 ${runId.slice(-8)}`);
  await project().getByRole("button", { name: "Créer un contact à partir des coordonnées", exact: true }).click();
  const createPanel = project().locator('[class*="contactCreate"]');
  assert.equal(await createPanel.getByRole("textbox", { name: "Email", exact: true }).inputValue(), `nouveau-${runId}@example.invalid`);
  await createPanel.getByRole("button", { name: "Créer et sélectionner", exact: true }).click();
  await page.getByText("Contact créé dans le CRM et sélectionné.", { exact: false }).waitFor();
  await saveProject(); await projectByUrl(importedId);
  assert.equal(await page.locator("#fonciere-agentEmail").inputValue(), `nouveau-${runId}@example.invalid`);
  const nextLink = await rows("fonciere_project_contacts", `select=*&project_id=eq.${importedId}`); assert(nextLink[0].contact_id !== "fictional-agent");
  await page.screenshot({ path: join(screenshots, "project.png"), fullPage: false });
  pass("Reimport preserves manual price; actual CRM contact created with prefilled details and link survives reload");

  step("search, archive and restore"); await allProjects();
  for (const term of [names.imported, "12 rue des Nuages", "TEST-FONC001"]) { await project().getByRole("textbox", { name: "Rechercher un projet", exact: true }).fill(term); assert(await project().getByRole("button").filter({ hasText: names.imported }).count() >= 1); }
  await projectByUrl(manualId); await project().getByRole("button", { name: "Archiver", exact: true }).click(); await page.getByText("Projet archivé.", { exact: false }).waitFor();
  assert.equal((await rowByName("fonciere_projects", names.manual)).status, "archived");
  await project().getByRole("button", { name: "Réactiver", exact: true }).click(); await page.getByText("Projet réactivé.", { exact: false }).waitFor();
  pass("Name/address/reference search and durable archive/restore");

  } else { step("resume using earlier real saved records"); await login(); }
  step("OCR scan and image imports"); await projectByUrl(manualId);
  for (const source of [scanPath, imagePath]) {
    console.log("OCR_SOURCE " + source.split("/").at(-1));
    await importProjectDocument(source);
    const scanned = page.getByRole("dialog");
    const value = await scanned.locator('[data-project-proposal="askingPrice"] textarea').inputValue(); assert.equal(value, "545000");
    assert.match(await scanned.innerText(), /OCR/i);
    await scanned.getByRole("button", { name: "Conserver seulement le document", exact: true }).click();
  }
  await saveProject();
  pass("Real in-browser local OCR reads scanned PDF and PNG; originals retained without forcing proposals");

  step("English and mobile layouts"); await projectByUrl(importedId); await project().getByRole("button", { name: "EN", exact: true }).click();
  assert.equal(await page.locator('label[for="fonciere-propertyAddress"]>span').first().innerText(), "Property address");
  await assertNoOverflow("English desktop"); await page.setViewportSize({ width: 390, height: 1000 });
  await assertNoOverflow("English mobile"); await page.screenshot({ path: join(screenshots, "project-mobile-en.png"), fullPage: false });
  await project().getByRole("button", { name: "FR", exact: true }).click(); await assertNoOverflow("French mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });
  pass("FR/EN field labels and shared navigation; desktop/mobile without horizontal overflow");

  step("saved source selection and presentation export"); await page.goto(`${fixture.app}/izord`); await page.locator("[data-project-source]").waitFor();
  const workersBefore = workers; await selectSource(names.imported);
  assert.equal(workers, workersBefore, "Saved project selection unexpectedly starts an extraction worker");
  assert.equal(await page.locator("#izord-asking").inputValue(), "552000");
  assert.match(await page.locator("#izord-address").inputValue(), /12 rue des Nuages/);
  const sourcePhoto = await page.locator('[data-izord-generator] img').first().getAttribute("src");
  await page.screenshot({ path: join(screenshots, "selection.png"), fullPage: false });
  for (const [key, value] of [["acq", "500000"], ["works", "100000"], ["resale", "800000"], ["weekly", "3000"]]) await page.locator(`#izord-${key}`).fill(value);
  const [ppt] = await Promise.all([page.waitForEvent("download", { timeout: 180000 }), page.getByRole("button", { name: "Générer le PowerPoint", exact: true }).click()]);
  const pptPath = join(output, "presentation-fictive.pptx"); await ppt.saveAs(pptPath);
  const zip = await JSZip.loadAsync(readFileSync(pptPath)); const xml = (await Promise.all(Object.keys(zip.files).filter(path => /^ppt\/(?:slides|notesSlides)\/.*\.xml$/.test(path)).map(path => zip.files[path].async("string")))).join("\n");
  assert(xml.includes(names.imported), "PowerPoint source project name absent"); assert(xml.includes("12 rue des Nuages"), "PowerPoint source address absent"); assert(xml.includes("IZORD"), "Existing presentation brand absent"); assert(Object.keys(zip.files).some(path => path.startsWith("ppt/media/")));
  const presentation = await rowByName("izord_projects", names.imported); presentationId = presentation.id;
  assert.equal(presentation.payload.data.importMeta.fonciereSource.id, importedId);
  pass("Saved project selected without extraction; original documents/photos loaded; real PowerPoint generated, archived and inspected");

  step("immutable presentation snapshot and explicit refresh");
  const sourceTab = await context.newPage(); await sourceTab.goto(`${fixture.app}/fonciere?project=${importedId}`); await sourceTab.locator("#fonciere-askingPrice").waitFor();
  await sourceTab.locator("#fonciere-askingPrice").fill("599000"); await sourceTab.locator("[data-fonciere-projects]").getByRole("button", { name: "Enregistrer", exact: true }).click(); await sourceTab.getByText("Informations et documents enregistrés", { exact: false }).waitFor(); await sourceTab.close();
  assert.equal(await page.locator("#izord-asking").inputValue(), "552000");
  assert.equal((await rows("izord_projects", `select=*&id=eq.${presentationId}`))[0].payload.data.state.asking, "552000");
  await page.reload(); await page.locator("[data-project-source]").waitFor(); await page.getByRole("button", { name: `Ouvrir ${names.imported}`, exact: true }).click(); await page.locator("#izord-asking").waitFor();
  assert.equal(await page.locator("#izord-asking").inputValue(), "552000");
  await page.locator("[data-project-source]").getByRole("button", { name: "Reprendre les données actualisées", exact: true }).click(); await page.waitForFunction(() => document.querySelector("#izord-asking")?.value === "599000");
  assert.equal((await rows("izord_projects", `select=*&id=eq.${presentationId}`))[0].payload.data.state.asking, "552000");
  await selectSource(names.manual); assert.equal(await page.locator("#izord-ref").inputValue(), `MAN-${runId}`);
  assert.notEqual(await page.locator('[data-izord-generator] img').first().getAttribute("src"), sourcePhoto);
  pass("Source edits do not rewrite saved presentations; refresh explicit; switching project clears previous content/photo");

  step("direct import remains optional"); await page.reload(); await page.locator("[data-project-source]").waitFor();
  await page.locator("[data-project-source]").getByRole("button", { name: "Importer directement une fiche d’agence", exact: true }).click();
  await page.locator('[data-izord-generator] input[type="file"]').first().setInputFiles(documentPath);
  const directReview = page.getByRole("dialog"); await directReview.waitFor({ timeout: 150000 });
  await directReview.locator('input[type="checkbox"]').last().check();
  await directReview.getByRole("button", { name: "Valider et créer la fiche projet", exact: true }).click(); await directReview.waitFor({ state: "hidden" });
  await page.locator("#izord-project").fill(names.direct);
  assert.equal((await rows("fonciere_projects", `select=id&title=eq.${encodeURIComponent(names.direct)}`)).length, 0);
  await page.locator("[data-project-source]").getByRole("button", { name: "Enregistrer dans Projets", exact: true }).click();
  await page.getByText("Fiche enregistrée dans Projets.", { exact: false }).waitFor();
  const direct = await rowByName("fonciere_projects", names.direct); assert(direct.payload.sourceDocuments.length === 1);
  pass("Direct brochure import needs no saved project; optional Save in Projects creates durable record with original");

  assert.deepEqual(consoleErrors, []); pass("No uncaught browser application errors");
} catch (error) {
  issues.push({ phase, message: error.message });
  console.error(`FAIL ${phase}: ${error.message}`);
  await page.screenshot({ path: join(screenshots, "workflow-failure.png"), fullPage: false }).catch(() => {});
  throw error;
} finally {
  writeFileSync(join(output, "browser-results.json"), JSON.stringify({ kind: "real local Auth/PostgreSQL/Storage plus headless desktop/mobile browser; entirely fictional data", runId, passed: checks.length, checks, issues, consoleErrors, externalRequests, records: { manualId, importedId, presentationId }, screenshots: ["project.png", "selection.png", "project-mobile-en.png"] }, null, 2));
  await context.close(); await browser.close();
}
