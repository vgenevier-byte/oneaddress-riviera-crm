/** Actual candidate UI and loopback Auth/RPC/Storage, fictional records only.
 * A failed save is deliberately aborted before admission; successful replies
 * are never simulated. Browser viewports are emulations, not physical devices.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const fixture = JSON.parse(readFileSync(process.env.FONCIERE_FIXTURE, "utf8"));
const out = process.env.FONCIERE_ARTIFACTS || "/private/tmp/oar-contact-return-evidence";
for (const url of [fixture.api, fixture.app]) assert.equal(new URL(url).hostname, "127.0.0.1", "Loopback target required");
mkdirSync(join(out, "screenshots"), { recursive: true });
const run = String(Date.now()), checks = [], errors = [], records = [];
let phase = "startup";
const pass = name => { checks.push(name); console.log("PASS " + name); };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const form = page => page.locator(".contact-create-form:visible");
const project = page => page.locator("[data-fonciere-projects]:visible");
const field = (page, name) => project(page).locator(`#fonciere-${name}`);
const contactField = (page, name) => form(page).locator(`[name="${name}"]`);
const saveContact = page => page.getByRole("button", { name: /^(Enregistrer et revenir au projet|Save and return to project)$/, exact: true });
const cancelContact = page => page.getByRole("button", { name: /^(Annuler et revenir au projet|Cancel and return to project)$/, exact: true });
const apiHeaders = token => ({ apikey: fixture.publicKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
async function authenticate(profile) {
  const response = await fetch(fixture.api + "/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: fixture.publicKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: fixture.users[profile].email, password: fixture.users[profile].password }) });
  assert.ok(response.ok, "Actual local Auth"); return (await response.json()).access_token;
}
async function rpc(token, name, body) {
  const response = await fetch(`${fixture.api}/rest/v1/rpc/${name}`, { method: "POST", headers: apiHeaders(token), body: JSON.stringify(body) });
  assert.ok(response.ok, `${name}: ${response.status} ${response.ok ? "" : await response.text()}`); return response.json();
}
async function rows(token, table, query) {
  const response = await fetch(`${fixture.api}/rest/v1/${table}?${query}`, { headers: apiHeaders(token) });
  assert.ok(response.ok, `Actual authorized ${table}`); return response.json();
}
async function session(profile, mobile = false, lang = "fr") {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 900 } : { width: 1440, height: 1000 } });
  await context.route("**/*", route => { const url = new URL(route.request().url()); return ["blob:", "data:"].includes(url.protocol) || ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort(); });
  const page = await context.newPage(); page.setDefaultTimeout(30000); page.on("pageerror", error => errors.push(error.message));
  let accept = true; page.on("dialog", dialog => accept ? dialog.accept() : dialog.dismiss());
  await page.goto(fixture.app + "/?module=contacts");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(fixture.users[profile].email);
  await page.getByLabel(/Mot de passe|Password/).fill(fixture.users[profile].password);
  await page.getByRole("button", { name: /^(Se connecter|Sign in)$/ }).click();
  await page.locator(".crm-shell:visible").waitFor({ timeout: 90000 });
  if (lang === "en") {
    if (mobile) await page.locator("#unified-more-trigger:visible").click();
    await page.locator('[data-language-selector] button[lang="en-GB"]:visible').first().click();
    if (mobile) await page.locator(".unified-more-close:visible").click();
  }
  return { context, page, token: await authenticate(profile), setAccept: value => { accept = value; } };
}
async function navigate(page, tab) {
  const mobile = page.viewportSize().width < 1024;
  if (mobile) { const more = page.locator("#unified-more-panel:visible"); if (!await more.count()) await page.locator("#unified-more-trigger:visible").click(); }
  const menu = page.locator(mobile ? "#unified-more-panel:visible" : ".sidebar:visible");
  let button = menu.locator(`[data-navigation-module="${tab}"]`);
  if (!await button.isVisible()) { const group = tab === "fonciere" ? "fonciere" : null; assert.ok(group); await menu.locator(`[data-navigation-group="${group}"]`).click(); button = menu.locator(`[data-navigation-module="${tab}"]`); }
  await button.click();
}
async function fresh(page) {
  await project(page).getByRole("button", { name: /^(Nouveau projet|New project)$/ }).click(); await field(page, "name").waitFor();
}
async function createFromProject(page, role) {
  await project(page).getByRole("button", { name: role === "agency" ? /^(Créer une fiche entreprise|Create a company contact)$/ : /^(Créer un contact|Create a contact)$/ }).click();
  await form(page).waitFor(); await saveContact(page).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("module"), "contacts");
  assert.equal(await contactField(page, "entityType").inputValue(), role === "agency" ? "company" : "person");
  assert.equal(await form(page).evaluate(node => node.contains(document.activeElement)), true, "Creation form receives focus");
}
async function projectSave(page) {
  const confirmed = page.waitForResponse(response => response.url().endsWith("/rpc/fonciere_save_project") && response.request().method() === "POST" && response.ok());
  await project(page).getByRole("button", { name: /^(Enregistrer|Save project)$/ }).first().click(); await confirmed;
  await project(page).getByText(/Informations et documents enregistrés|Information and documents saved/).waitFor();
}
async function assertPreserved(page, values, fileName) {
  for (const [name, value] of Object.entries(values)) assert.equal(await field(page, name).inputValue(), value, name);
  if (fileName) await project(page).getByText(fileName, { exact: true }).waitFor({ state: "attached" });
}
try {
  for (const scenario of [{ profile: "admin", mobile: false, lang: "fr" }, { profile: "writer", mobile: true, lang: "en" }]) {
    phase = scenario.profile + " session";
    const { context, page, token, setAccept } = await session(scenario.profile, scenario.mobile, scenario.lang);
    const label = `${scenario.profile}-${scenario.lang}`, id = `${label}-${run}`;
    try {
      phase = label + " ordinary draft";
      await form(page).waitFor();
      const ordinaryDraft = `Brouillon Contacts ${id}`;
      const ordinaryDraftField = scenario.profile === "admin" ? "notes" : "source";
      await contactField(page, "name").fill(ordinaryDraft); await contactField(page, ordinaryDraftField).fill("Saisie ordinaire conservée intégralement");
      await navigate(page, "fonciere"); await project(page).waitFor(); await fresh(page);
      const values = { name: `Aller-retour ${id}`, agencyName: `Agence ${id}`, agencyEmail: `agency-${id}@example.invalid`, agencyPhone: "+33 4 00 00 77 88", agencyAddress: "Adresse indépendante de l’agence", agentName: `Jean-Pierre de La Tour ${id}`, agentEmail: `agent-${id}@example.invalid`, agentPhone: "+33 6 00 00 88 99", notes: "Correction import conservée\nDeuxième ligne." };
      for (const [name, value] of Object.entries(values)) await field(page, name).fill(value);
      const fileName = `piece-${id}.pdf`, pdf = Buffer.from("%PDF-1.4\nDocument fictif aller-retour " + id + "\n%%EOF");
      await project(page).getByLabel(/^(Ajouter des documents|Add documents)$/).setInputFiles({ name: fileName, mimeType: "application/pdf", buffer: pdf });
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDdEAAAAASUVORK5CYII=", "base64");
      await project(page).getByLabel(/^(Ajouter des photos|Add photos)$/).setInputFiles({ name: `photo-${id}.png`, mimeType: "image/png", buffer: png });
      await project(page).locator("[data-project-gallery] img").first().waitFor();
      phase = label + " company cancellation";
      await createFromProject(page, "agency");
      for (const [name, value] of [["companyName", values.agencyName], ["email", values.agencyEmail], ["phone", values.agencyPhone], ["postalAddress", values.agencyAddress]]) assert.equal(await contactField(page, name).inputValue(), value);
      await contactField(page, "companyName").fill(values.agencyName + " modifiable"); await cancelContact(page).click();
      await assertPreserved(page, values, fileName); assert.equal(await project(page).locator('input[name="agencyContactId"]').inputValue(), "");
      assert.equal(await project(page).locator("[data-project-gallery] img").count(), 1);
      pass(label + ": direct company form, editable prefill, cancellation retains never-saved project, PDF and photo");
      phase = label + " company save";
      await createFromProject(page, "agency");
      if (scenario.profile === "admin") {
        await page.route("**/rest/v1/rpc/crm_mutate_record", route => route.abort("failed"));
        await saveContact(page).click(); await page.getByText(/Enregistrement non confirmé|Enregistrement refusé|Connexion interrompue/).first().waitFor();
        assert.equal(await contactField(page, "email").inputValue(), values.agencyEmail); await page.unroute("**/rest/v1/rpc/crm_mutate_record");
        pass("Failed contact save stays in Contacts with every prefilled value retained");
      }
      let mutations = 0;
      const observe = request => { if (request.url().endsWith("/rpc/crm_mutate_record") && request.postDataJSON()?.p_collection === "contacts") mutations++; };
      page.on("request", observe);
      await form(page).evaluate(node => { node.requestSubmit(); node.requestSubmit(); });
      await project(page).waitFor(); page.off("request", observe); assert.equal(mutations, 1, "Double submit sends one creation");
      const contacts = (await rpc(token, "crm_read_module", { p_module: "contacts" })).collections.contacts;
      const company = contacts.filter(contact => contact.email === values.agencyEmail); assert.equal(company.length, 1); assert.equal(company[0].entityType, "company");
      assert.equal(await project(page).locator('input[name="agencyContactId"]').inputValue(), company[0].id);
      await assertPreserved(page, values, fileName);
      assert.equal(await project(page).locator('a[href="#fonciere-section-agency"]').getAttribute("aria-current"), "location");
      await project(page).getByText(/Modifications non enregistrées|Unsaved changes/).first().waitFor();
      pass(label + ": confirmed actual contact ID returns to agency section, single creation, project still visibly unsaved");
      phase = label + " person cancellation and save";
      await createFromProject(page, "agent");
      assert.equal(await contactField(page, "firstName").inputValue(), "", "Ambiguous project label does not invent a first name");
      assert.equal(await contactField(page, "name").inputValue(), "", "Ambiguous project label does not invent a last name");
      await page.getByText(values.agentName, { exact: false }).first().waitFor();
      assert.equal(await contactField(page, "companyName").inputValue(), values.agencyName);
      assert.equal(await contactField(page, "email").inputValue(), values.agentEmail);
      assert.equal(await contactField(page, "postalAddress").inputValue(), "", "Agency address is never assigned to a person");
      await cancelContact(page).click(); await assertPreserved(page, values, fileName);
      assert.equal(await project(page).locator('input[name="agencyContactId"]').inputValue(), company[0].id);
      assert.equal(await project(page).locator('input[name="agentContactId"]').inputValue(), "");
      await createFromProject(page, "agent");
      await contactField(page, "firstName").fill("Jean-Pierre"); await contactField(page, "name").fill(`de La Tour ${id}`);
      await saveContact(page).click(); await project(page).waitFor();
      const after = (await rpc(token, "crm_read_module", { p_module: "contacts" })).collections.contacts;
      const agent = after.filter(contact => contact.email === values.agentEmail); assert.equal(agent.length, 1); assert.equal(agent[0].entityType, "person");
      assert.equal(await project(page).locator('input[name="agentContactId"]').inputValue(), agent[0].id);
      assert.equal(await project(page).locator('input[name="agencyContactId"]').inputValue(), company[0].id);
      await assertPreserved(page, values, fileName);
      pass(label + ": person name, direct coordinates and company remain separate; cancel and actual save preserve the agency link");
      phase = label + " duplicate selection and replacement confirmation";
      await field(page, "agentPhone").fill("Correction locale conservée");
      await createFromProject(page, "agent"); await saveContact(page).click();
      const duplicate = page.locator("[data-project-contact-duplicates]").getByRole("button").filter({ hasText: values.agentEmail });
      await duplicate.waitFor(); let duplicateWrites = 0;
      const duplicateObserver = request => { if (request.url().endsWith("/rpc/crm_mutate_record") && request.postDataJSON()?.p_collection === "contacts") duplicateWrites++; };
      page.on("request", duplicateObserver); setAccept(false); await duplicate.click(); await project(page).waitFor();
      assert.equal(await field(page, "agentPhone").inputValue(), "Correction locale conservée");
      assert.equal(await project(page).locator('input[name="agentContactId"]').inputValue(), agent[0].id);
      setAccept(true); await createFromProject(page, "agent"); await saveContact(page).click();
      await page.locator("[data-project-contact-duplicates]").getByRole("button").filter({ hasText: values.agentEmail }).click(); await project(page).waitFor();
      page.off("request", duplicateObserver); assert.equal(duplicateWrites, 0, "Choosing canonical duplicate never creates a record");
      await assertPreserved(page, values, fileName);
      pass(label + ": existing duplicate uses its true ID without a write; replacement confirmation preserves a declined local correction");
      phase = label + " project durable save";
      await projectSave(page);
      const saved = (await rows(token, "fonciere_projects", `select=*&title=eq.${encodeURIComponent(values.name)}`))[0]; assert.ok(saved);
      const links = await rows(token, "fonciere_project_contacts", `select=*&project_id=eq.${saved.id}`); assert.equal(links[0].contact_id, agent[0].id); assert.equal(links[0].agency_contact_id, company[0].id);
      const assets = await rows(token, "fonciere_assets", `select=*&project_id=eq.${saved.id}&lifecycle=eq.finalized`); const source = assets.find(asset => asset.original_name === fileName); assert.ok(source, "Pending File actually uploaded");
      const download = await fetch(`${fixture.api}/storage/v1/object/authenticated/fonciere-documents/${source.object_path}`, { headers: apiHeaders(token) }); assert.ok(download.ok); assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf, "Original pending File bytes survive the complete journey");
      phase = label + " ordinary Contacts draft retained";
      await navigate(page, "contacts"); await form(page).waitFor();
      assert.equal(await cancelContact(page).count(), 0, "Context consumed after confirmed return");
      assert.equal(await contactField(page, "name").inputValue(), ordinaryDraft);
      assert.equal(await contactField(page, ordinaryDraftField).inputValue(), "Saisie ordinaire conservée intégralement");
      pass(label + ": ordinary Contacts draft survives contextual company/person creation and both return actions");
      await page.goto(`${fixture.app}/fonciere?project=${saved.id}`); await field(page, "name").waitFor(); await assertPreserved(page, values, fileName);
      assert.equal(await project(page).locator('input[name="agentContactId"]').inputValue(), agent[0].id); assert.equal(await project(page).locator('input[name="agencyContactId"]').inputValue(), company[0].id);
      assert.equal(await project(page).locator("[data-project-gallery] img").count(), 1);
      records.push({ profile: scenario.profile, projectId: saved.id, agencyContactId: company[0].id, agentContactId: agent[0].id });
      pass(label + ": real project save/reload retains correct canonical roles, exact PDF content and photo");
      phase = label + " existing project and normal Contacts";
      await field(page, "notes").fill(values.notes + "\nCorrection après rechargement");
      await createFromProject(page, "agent"); await cancelContact(page).click();
      assert.equal(await field(page, "notes").inputValue(), values.notes + "\nCorrection après rechargement");
      await page.screenshot({ path: join(out, "screenshots", `contact-return-${label}.png`) });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "No horizontal overflow");
      await navigate(page, "contacts"); await form(page).waitFor(); assert.equal(await cancelContact(page).count(), 0, "Consumed creation context");
      assert.equal(await contactField(page, "entityType").inputValue(), "person");
      pass(label + ": existing-project cancellation preserves correction; next Contacts visit opens ordinary form with consumed context");
      phase = label + " ordinary creation";
      if (scenario.profile === "admin") await page.locator(".mobile-shared-db-status.connected").waitFor({ state: "attached" });
      await contactField(page, "name").fill(`Contact ordinaire ${id}`); await contactField(page, "email").fill(`ordinary-${id}@example.invalid`);
      const ordinarySave = page.waitForResponse(response => response.url().endsWith("/rpc/crm_mutate_record") && response.request().method() === "POST" && response.ok());
      await form(page).locator('button[type="submit"]').click(); await ordinarySave;
      const ordinary = (await rpc(token, "crm_read_module", { p_module: "contacts" })).collections.contacts.filter(contact => contact.email === `ordinary-${id}@example.invalid`);
      assert.equal(ordinary.length, 1); assert.equal(ordinary[0].entityType, "person");
      await form(page).waitFor(); assert.equal(await cancelContact(page).count(), 0);
      pass(label + ": ordinary Contacts creation still saves once through the actual RPC and stays in Contacts");
    } catch (error) {
      await page.screenshot({ path: join(out, "screenshots", `contact-return-failure-${label}.png`) }).catch(() => {});
      writeFileSync(join(out, `contact-return-failure-${label}.json`), JSON.stringify(await page.evaluate(() => ({ url: location.pathname + location.search, forms: Array.from(document.forms, node => ({ classes: node.className, connected: node.isConnected, visible: Boolean(node.getClientRects().length), fields: Array.from(node.elements, element => element.getAttribute("name")) })), text: document.body.innerText.slice(0, 4000) })), null, 2));
      throw error;
    } finally { await context.close(); }
  }
  for (const profile of ["other", "noContacts"]) {
    phase = profile + " UI permission boundary";
    const { context, page } = await session(profile);
    try {
      await navigate(page, "fonciere"); await project(page).waitFor(); await fresh(page);
      assert.equal(await project(page).getByRole("button", { name: /^(Créer une fiche entreprise|Create a company contact|Créer un contact|Create a contact)$/ }).count(), 0);
      pass(profile + ": Contacts read-only or absent permission exposes no project contact creation action");
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, []); pass("No uncaught browser application errors");
} catch (error) {
  errors.push(phase + ": " + error.message); console.error("FAIL " + phase + ": " + error.message); throw error;
} finally {
  writeFileSync(join(out, "contact-return-browser-results.json"), JSON.stringify({ passed: errors.length === 0, environment: "actual candidate UI + real loopback Auth/RPC/Storage, fictional data", productionWrites: 0, physicalDevice: false, run, phase, checks, errors, records }, null, 2));
  await browser.close();
}
