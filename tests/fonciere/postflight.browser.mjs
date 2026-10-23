/** Additional real local browser permission checks and final delivery screenshots. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const fixture = JSON.parse(readFileSync("/tmp/fonciere-delivery/local-fixture.private.json", "utf8"));
const prior = JSON.parse(readFileSync("/tmp/fonciere-delivery/browser-results.json", "utf8"));
const projectId = prior.records.importedId, displayName = "Villa des Nuages — démonstration";
const checks = [], errors = [], contexts = []; let phase = "initialization";
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--no-sandbox"] });
async function session(user) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); contexts.push(context);
  await context.route("**/*", route => { const url = new URL(route.request().url()); return ["data:", "blob:"].includes(url.protocol) || ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort(); });
  const page = await context.newPage(); page.setDefaultTimeout(45000); page.on("dialog", dialog => dialog.accept()); page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${fixture.app}/fonciere`); await page.getByRole("textbox", { name: "Email", exact: true }).fill(user.email); await page.getByLabel(/Mot de passe|Password/).fill(user.password); await page.getByRole("button", { name: /Se connecter|Sign in/, exact: true }).click();
  return page;
}
function pass(name) { checks.push(name); console.log(`PASS ${name}`); }
function step(name) { phase = name; console.log(`STEP ${name}`); }
try {
  step("linked contact canonical drawer"); const writer = await session(fixture.users.writer);
  await writer.locator("[data-fonciere-projects]").waitFor(); await writer.goto(`${fixture.app}/fonciere?project=${projectId}`); await writer.locator("#fonciere-name").waitFor();
  await writer.getByRole("button", { name: "Ouvrir le contact", exact: true }).click();
  const contact = writer.locator("#contact-detail-panel"); await contact.waitFor(); assert((await contact.innerText()).includes(`nouveau-${prior.runId}@example.invalid`));
  pass("Linked contact opens the canonical real CRM contact detail drawer with the correct email");

  step("final screenshots and scoped CSS verification"); await writer.goto(`${fixture.app}/fonciere?project=${projectId}`); await writer.locator("#fonciere-name").waitFor();
  await writer.locator("#fonciere-name").fill(displayName); await writer.locator("[data-fonciere-projects]").getByRole("button", { name: "Enregistrer", exact: true }).click(); await writer.getByText("Informations et documents enregistrés", { exact: false }).waitFor();
  const headers = await writer.locator('[data-fonciere-projects] header').evaluateAll(values => values.map(value => ({ background: getComputedStyle(value).backgroundColor, height: value.getBoundingClientRect().height })));
  assert(headers.every(header => header.background === "rgba(0, 0, 0, 0)"), "A global navy header rule still overrides the project form"); assert(headers.slice(1).every(header => header.height < 120));
  await writer.evaluate(() => scrollTo(0, 0)); await writer.screenshot({ path: "/private/tmp/fonciere-delivery/screenshots/project.png" });
  await writer.locator("#fonciere-documents").scrollIntoViewIfNeeded(); await writer.screenshot({ path: "/private/tmp/fonciere-delivery/screenshots/project-documents.png" });
  await writer.setViewportSize({ width: 390, height: 1000 }); await writer.locator("[data-fonciere-projects]").getByRole("button", { name: "EN", exact: true }).click(); await writer.evaluate(() => scrollTo(0, 0)); assert(await writer.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await writer.screenshot({ path: "/private/tmp/fonciere-delivery/screenshots/project-mobile-en.png" }); await writer.locator("[data-fonciere-projects]").getByRole("button", { name: "FR", exact: true }).click(); await writer.setViewportSize({ width: 1440, height: 1000 });
  await writer.goto(`${fixture.app}/izord`); const picker = writer.locator("[data-project-source]"); await picker.waitFor(); await picker.getByRole("textbox", { name: "Rechercher un projet", exact: true }).fill(displayName); await picker.getByRole("button", { name: "Utiliser ce projet", exact: true }).click(); await writer.waitForFunction(expected => document.querySelector("#izord-project")?.value === expected, displayName); await writer.evaluate(() => scrollTo(0, 0)); await writer.screenshot({ path: "/private/tmp/fonciere-delivery/screenshots/selection.png" });
  pass("Final desktop project/source-picker and mobile EN screenshots; form headers transparent and no overflow");

  step("admin assignment and reader restrictions"); const admin = await session(fixture.users.admin); await admin.locator("[data-fonciere-projects]").waitFor(); await admin.goto(`${fixture.app}/fonciere?project=${projectId}`); await admin.locator("#fonciere-name").waitFor();
  const access = admin.locator('[aria-labelledby="fonciere-access-title"]'); await access.waitFor(); const readerBox = access.locator("label").filter({ hasText: fixture.users.reader.email }).locator('input[type="checkbox"]'); await readerBox.waitFor();
  if (!await readerBox.isChecked()) { await readerBox.click(); await access.getByText("Accès au projet mis à jour.", { exact: true }).waitFor(); }
  await admin.reload(); await admin.locator("#fonciere-name").waitFor(); assert(await admin.locator('[aria-labelledby="fonciere-access-title"] label').filter({ hasText: fixture.users.reader.email }).locator('input[type="checkbox"]').isChecked());
  const reader = await session(fixture.users.reader); await reader.locator("[data-fonciere-projects]").waitFor(); await reader.goto(`${fixture.app}/fonciere?project=${projectId}`); await reader.locator("#fonciere-name").waitFor(); assert(await reader.locator("#fonciere-name").isDisabled()); assert.equal(await reader.getByRole("button", { name: "Nouveau projet", exact: true }).count(), 0); assert.equal(await reader.getByRole("button", { name: "Enregistrer", exact: true }).count(), 0); assert.equal(await reader.locator('[aria-labelledby="fonciere-access-title"]').count(), 0);
  await admin.locator('[aria-labelledby="fonciere-access-title"] label').filter({ hasText: fixture.users.reader.email }).locator('input[type="checkbox"]').click(); await admin.locator('[aria-labelledby="fonciere-access-title"]').getByText("Accès au projet mis à jour.", { exact: true }).waitFor(); await reader.reload(); await reader.getByText("Ce projet est inaccessible ou n’existe plus.", { exact: true }).waitFor(); assert.equal(await reader.locator("#fonciere-name").count(), 0);
  pass("Admin assignment persists after reload; reader sees disabled fields; removing assignment removes access");

  step("denied Contacts preserves draft"); const noContacts = await session(fixture.users.noContacts); const area = noContacts.locator("[data-fonciere-projects]"); await area.waitFor(); await area.getByRole("button", { name: "Nouveau projet", exact: true }).click(); await noContacts.locator("#fonciere-name").fill("Projet fictif sans accès Contacts"); await noContacts.locator("#fonciere-agentName").fill("Agent Fictif"); await noContacts.locator("#fonciere-agentEmail").fill("camille@example.invalid"); await area.getByRole("button", { name: "Créer un contact à partir des coordonnées", exact: true }).click(); await area.getByRole("button", { name: "Créer et sélectionner", exact: true }).click(); await area.locator('[class*="contactLink"]').getByRole("alert").waitFor(); assert.match(await area.locator('[class*="contactLink"]').getByRole("alert").innerText(), /droits|refusée/); assert.equal(await noContacts.locator("#fonciere-name").inputValue(), "Projet fictif sans accès Contacts");
  pass("Actual Contacts permission denial is visible and preserves unsaved property input");

  step("denied module UI"); const denied = await session(fixture.users.denied); await denied.getByText(/Aucun accès autorisé/).waitFor(); assert.equal(await denied.locator("[data-fonciere-projects]").count(), 0); assert.equal(await denied.locator("[data-izord-generator]").count(), 0);
  pass("Account without IZORD rights cannot mount Projects or Project Presentations");
  assert.deepEqual(errors, []); pass("No uncaught browser application errors in permission and screenshot checks");
} catch (error) { errors.push(`${phase}: ${error.message}`); throw error; }
finally {
  writeFileSync("/private/tmp/fonciere-delivery/browser-postflight.json", JSON.stringify({ kind: "real local browser/Auth/PostgreSQL/Storage; fictional data", passed: checks.length, checks, errors, displayName, sourceProjectId: projectId }, null, 2));
  for (const context of contexts) await context.close(); await browser.close();
}
