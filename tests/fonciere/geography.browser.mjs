/** Real loopback Auth/RPC/browser regression. Requires existing fictional fixtures. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { createFonciereData } = require(join(process.env.FONCIERE_COMPILED, 'lib/fonciere/model.js'));
const { chromium } = require(process.env.FONCIERE_PLAYWRIGHT || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const JSZip = require('jszip');
const fixture = JSON.parse(readFileSync(process.env.FONCIERE_FIXTURE, 'utf8'));
const app = process.env.ADDRESS_APP || fixture.app;
const out = process.env.FONCIERE_ARTIFACTS || '/private/tmp/oar-no-geography-evidence';
for (const url of [app, fixture.api]) assert.equal(new URL(url).hostname, '127.0.0.1');
mkdirSync(join(out, 'screenshots'), { recursive: true });
const checks = [], errors = [], run = Date.now();
const pass = name => { checks.push(name); console.log('PASS ' + name); };
let token, phase = 'initialization';
const headers = () => ({ apikey: fixture.publicKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
async function rpc(name, args) {
  const r = await fetch(`${fixture.api}/rest/v1/rpc/${name}`, { method: 'POST', headers: headers(), body: JSON.stringify(args) });
  assert(r.ok, `${name}: ${r.status} ${await r.clone().text()}`); return r.json();
}
async function row(table, id) {
  const r = await fetch(`${fixture.api}/rest/v1/${table}?select=*&id=eq.${id}`, { headers: headers() });
  assert(r.ok); const rows = await r.json(); assert(rows[0]); return rows[0];
}
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
// This suite uses no external services. Real IGN is exercised by the existing address suite.
await context.route('**/*', route => { const u = new URL(route.request().url()); return ['data:', 'blob:'].includes(u.protocol) || ['127.0.0.1', 'localhost'].includes(u.hostname) ? route.continue() : route.abort(); });
const page = await context.newPage(); page.setDefaultTimeout(30000);
page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
const ws = () => page.locator('[data-fonciere-projects]');
async function absent(root = ws()) {
  assert.doesNotMatch(await root.innerText(), /Coordonnées géographiques|Geographic coordinates|\bLatitude\b|\bLongitude\b/i);
  assert.equal(await root.locator('[data-guided-field=coordinates], [id*=coordinates-latitude], [id*=coordinates-longitude]').count(), 0);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
}
async function matrix(label, root = ws()) {
  for (const lang of ['FR', 'EN']) {
    await ws().getByRole('button', { name: lang, exact: true }).click();
    for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await absent(root); }
  }
  await ws().getByRole('button', { name: 'FR', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 }); pass(label + ': FR/EN desktop/mobile without geographic controls or headings');
}
async function save() {
  const pending = page.waitForResponse(r => r.url().endsWith('/rpc/fonciere_save_project') && r.request().method() === 'POST' && r.ok());
  await ws().getByRole('button', { name: 'Enregistrer', exact: true }).click(); await pending;
  await page.getByText(/Informations et documents enregistrés/).waitFor();
}
try {
  const auth = await fetch(`${fixture.api}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: fixture.publicKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: fixture.users.writer.email, password: fixture.users.writer.password }) });
  assert(auth.ok); token = (await auth.json()).access_token;
  phase = 'legacy record seed'; const data = createFonciereData();
  Object.assign(data, { name: `Sans géographie ${run}`, propertyAddress: '12 rue fictive', postalCode: '00123', city: 'Nice', location: 'Quartier conservé', agencyName: 'Agence historique', agencyAddress: '99 avenue fictive', agencyEmail: 'agence@example.invalid', agencyPhone: '04 93 00 00 44', agentName: 'Camille Exemple', agentPhone: '06 12 34 56 78', agentEmail: 'camille@example.invalid', notes: 'Note historique' });
  data.guided.values.coordinates = { latitude: 43.712345, longitude: 7.265432 };
  data.guided.details.coordinates = 'Ancienne précision conservée';
  data.presentationData.state.environment = 'Ancienne présentation 43.712345, 7.265432';
  delete data.agentContactId; delete data.agencyContactId;
  data.presentationData.photos = { main: '', view: '', inside: '', operation: '' };
  const id = await rpc('fonciere_save_project', { p_id: null, p_expected_revision: null, p_payload: { schema: 'FONCIERE_PROPERTY_V1', data, sourceDocuments: [] }, p_contact: null, p_agency_contact: null });
  const before = await row('fonciere_projects', id);
  phase = 'login and creation'; await page.goto(app + '/fonciere');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(fixture.users.writer.email);
  await page.getByLabel(/Mot de passe|Password/).fill(fixture.users.writer.password);
  await page.getByRole('button', { name: /Se connecter|Sign in/, exact: true }).click(); await ws().waitFor();
  await ws().getByRole('button', { name: 'FR', exact: true }).click();
  await ws().getByRole('button', { name: 'Nouveau projet', exact: true }).click();
  await page.locator('#fonciere-name').waitFor(); await matrix('Creation');
  phase = 'legacy open/edit/reload'; await page.goto(`${app}/fonciere?project=${id}`); await page.locator('#fonciere-name').waitFor(); await matrix('Legacy detail/edit');
  for (const key of ['agencyAddress', 'agencyEmail', 'agencyPhone', 'agentEmail', 'agentPhone']) assert.equal(await page.locator(`#fonciere-${key}`).inputValue(), data[key]);
  await page.locator('#fonciere-notes').fill('Note historique modifiée'); await save(); await page.reload(); await page.locator('#fonciere-name').waitFor(); await absent();
  const after = await row('fonciere_projects', id);
  assert.deepEqual(after.payload.data.guided, before.payload.data.guided);
  assert.deepEqual(after.payload.data.presentationData, before.payload.data.presentationData);
  for (const [key, value] of Object.entries(before.payload.data)) if (key !== 'notes') assert.deepEqual(after.payload.data[key], value, key);
  assert.equal(after.payload.data.notes, 'Note historique modifiée');
  await page.locator('#fonciere-propertyAddress').scrollIntoViewIfNeeded(); await page.screenshot({ path: join(out, 'screenshots', 'legacy-fr-desktop.png') });
  pass('Legacy coordinates preserved through actual save/reload; other fields and saved presentation unchanged; agency/agent contact fields retained');
  phase = 'new presentation and export'; await page.goto(app + '/izord');
  const source = page.locator('[data-project-source]'); await source.waitFor();
  await source.getByRole('textbox', { name: 'Rechercher un projet', exact: true }).fill(data.name);
  await source.getByRole('button', { name: 'Utiliser ce projet', exact: true }).click(); await page.locator('#izord-project').waitFor();
  for (const [key, value] of [['acq', '400000'], ['works', '50000'], ['resale', '650000']]) await page.locator(`#izord-${key}`).fill(value);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), page.getByRole('button', { name: 'Générer le PowerPoint', exact: true }).click()]);
  const pptx = join(out, 'sans-geographie.pptx'); await download.saveAs(pptx);
  const zip = await JSZip.loadAsync(readFileSync(pptx));
  const xml = (await Promise.all(Object.keys(zip.files).filter(p => /^ppt\/(?:slides|notesSlides)\/.*\.xml$/.test(p)).map(p => zip.files[p].async('string')))).join('\n');
  assert.doesNotMatch(xml, /43[.,]712345|7[.,]265432|Latitude|Longitude|Coordonnées géographiques|Geographic coordinates|Ancienne précision conservée/);
  assert.match(xml, /Quartier conservé/); assert.match(xml, /camille@example.invalid/);
  assert.deepEqual((await row('fonciere_projects', id)).payload.data.presentationData, before.payload.data.presentationData);
  pass('New saved presentation and actual PowerPoint slides/notes exclude geographic text; area and agent contact retained; historical presentation preserved');
  phase = 'real PDF import review';
  for (const lang of ['FR', 'EN']) {
    await page.goto(app + '/fonciere'); await ws().waitFor(); await ws().getByRole('button', { name: lang, exact: true }).click();
    await ws().getByRole('button', { name: lang === 'FR' ? 'Nouveau projet' : 'New project', exact: true }).click();
    await ws().locator('input[type=file]').first().setInputFiles(process.env.FONCIERE_IMPORT_PDF || '/private/tmp/fonciere-ocr-fixtures/fiche-texte-fictive.pdf');
    const dialog = page.getByRole('dialog'); await dialog.waitFor({ timeout: 150000 });
    for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await absent(dialog); }
    assert(await page.locator('#fonciere-import-propertyAddress').count());
    await page.screenshot({ path: join(out, 'screenshots', `import-${lang.toLowerCase()}-mobile.png`) });
    await dialog.getByRole('button', { name: lang === 'FR' ? 'Appliquer les propositions cochées' : 'Apply selected proposals', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' }); await absent();
  }
  pass('Actual PDF extraction/review/application in FR/EN desktop/mobile excludes geographic controls and retains address proposals');
  assert.deepEqual(errors, []); pass('No uncaught browser errors');
} catch (error) {
  await page.screenshot({ path: join(out, 'screenshots', 'geography-failure.png') }).catch(() => {}); console.error('FAIL ' + phase + ': ' + error.message); throw error;
} finally {
  writeFileSync(join(out, 'geography-browser-results.json'), JSON.stringify({ kind: 'Real local fictional Auth/RPC/browser/PDF/PPTX; no Production business writes', phase, checks, errors }, null, 2));
  await context.close(); await browser.close();
}
