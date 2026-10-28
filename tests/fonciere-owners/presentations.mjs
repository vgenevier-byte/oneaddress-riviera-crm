/** Real isolated persistence and browser exports. Fictional accounts only;
 * no production credentials or external requests are used. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { connect, sql, fixtureFile, output, ok, login, createGeneratorRepository, createFonciereRepository } from '../fonciere-arbitrage/local.mjs';
const require = createRequire(import.meta.url);
const { createFonciereData, toPresentationData, fromPresentationData } = require('../../lib/fonciere/model');
const { createOwnerPerson } = require('../../lib/fonciere/owners');
const { prepareBankPresentation } = require('../../lib/fonciere/bankPresentation');
const { exportProjectJson } = require('../../lib/izord/model');
const { calculate } = require('../../lib/izord/finance');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fixture = JSON.parse(readFileSync(fixtureFile, 'utf8')), users = {}, checks = [], errors = [], external = [];
const dir = join(output, 'presentations'); mkdirSync(dir, { recursive: true });
assert.equal(fixture.app, 'http://127.0.0.1:3197'); assert.equal(fixture.api, 'http://127.0.0.1:56031');
const MARKER = 'PRIVATE_OWNER_CANARY_7651', CONTACT_MARKER = fixture.owners.person1;
for (const name of ['admin', 'vincent', 'annCharlotte']) users[name] = await login(fixture.users[name]);
await connect();
let browser, context, page, project, manualId, bankId, initial, persisted;
const source = createFonciereRepository(users.admin.client), generator = createGeneratorRepository(users.admin.client);
const read = () => ok(users.admin.client.rpc('fonciere_arbitrage_read', { p_project: project }));
async function vote(who) { const state = await read(); return ok(users[who].client.rpc('fonciere_arbitrage_vote', { p_project: project, p_fingerprint: state.fingerprint, p_choice: 'approved', p_remark: MARKER + ' approval' })); }
async function test(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); writeFileSync(join(dir, 'progress.json'), JSON.stringify(checks, null, 2)); }
function privateAbsent(data) { const text = typeof data === 'string' ? data : JSON.stringify(data); for (const marker of [MARKER, CONTACT_MARKER, 'ownerContext']) assert(!text.includes(marker), 'Private marker leaked: ' + marker); }
async function row(id) { return (await sql.query('select * from public.izord_projects where id=$1', [id])).rows[0]; }
async function openPresentation(id) {
  await page.goto(fixture.app + '/izord?crmTarget=' + encodeURIComponent(JSON.stringify({ type: 'presentation', id })));
  await page.locator('input[type=email], .crm-shell:visible').first().waitFor({ timeout: 90000 });
  if (await page.locator('input[type=email]').count()) {
    await page.locator('input[type=email]').first().fill(fixture.users.admin.email); await page.locator('input[autocomplete=current-password]').fill(fixture.users.admin.password); await page.getByRole('button', { name: /^(Se connecter|Sign in)$/ }).click();
  }
  await page.locator('.crm-shell:visible').waitFor({ timeout: 90000 }); await page.locator('#izord-project').waitFor({ timeout: 90000 });
  await page.waitForFunction(() => document.querySelector('#izord-project')?.value?.includes('Propriétaires fictifs'));
}
async function browserExports(name, id) {
  await openPresentation(id);
  const visible = page.locator('[data-izord-generator]:visible');
  let pending = page.waitForEvent('download'); await visible.getByRole('button', { name: /^Exporter le JSON/ }).click(); let download = await pending;
  const json = readFileSync(await download.path(), 'utf8'); privateAbsent(json); await download.saveAs(join(dir, name + '.json'));
  const button = visible.getByRole('button', { name: /Générer le PowerPoint/ }); assert(!await button.isDisabled(), 'PowerPoint available: ' + name);
  pending = page.waitForEvent('download', { timeout: 120000 }); await button.click(); download = await pending;
  const zip = await JSZip.loadAsync(readFileSync(await download.path())); const xml = Object.keys(zip.files).filter(path => /\.(xml|rels)$/.test(path) && !zip.files[path].dir), notes = xml.filter(path => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(path));
  assert(notes.length >= 2); for (const path of xml) privateAbsent(await zip.file(path).async('string')); await download.saveAs(join(dir, name + '.pptx'));
  return { xmlParts: xml.length, notesParts: notes.length, markerOccurrences: 0 };
}
const exported = {};
try {
  await test('Fictional complete owner context persists and reloads after a new authenticated session', async () => {
    const data = createFonciereData(); data.name = 'Propriétaires fictifs — confidentialité'; Object.assign(data, { askingPrice: '950000', area: '120', worksHypothesis: '150000', resaleHypothesis: '1450000', notes: 'Note publique volontaire' });
    Object.assign(data.presentationData.state, { acq: '820000', notaryQuote: '25000', finance: '20000', holding: '18', rentalPeriod: '12', costsReviewed: true });
    Object.assign(data.ownerContext, { organization: 'indivision', rights: 'split', declaredCount: 4, unlinkedOwners: MARKER + ' quoted name' });
    data.ownerContext.owners = [{ contactId: fixture.owners.person1, entityType: 'person', note: MARKER, person: { ...createOwnerPerson(), age: 73, ageAsOf: '2026-10-28', residenceCountry: 'IT', nationalities: ['FR', 'IT'], note: MARKER, information: { source: 'owner', contactId: fixture.owners.person1, documentId: '', detail: MARKER, date: '2026-10-28', confirmation: 'confirm' } } }, { contactId: fixture.owners.company, entityType: 'company', note: MARKER }];
    data.ownerContext.representatives = [{ contactId: fixture.owners.representative, ownerContactId: fixture.owners.company, role: MARKER }]; data.ownerContext.primaryContactId = fixture.owners.representative; data.ownerContext.primaryRole = MARKER;
    Object.assign(data.ownerContext.sale, { agreement: 'confirm', reasons: ['inheritance'], listedOn: '2026-01-31', sellerDeadline: '2027-06-30', priceReductions: MARKER, pricePosition: 'discussion', openQuestions: MARKER });
    Object.assign(data.ownerContext.negotiation, { potential: 'high', justification: MARKER, favorablePoints: MARKER, blockingPoints: MARKER, nextQuestion: MARKER });
    data.ownerContext.provenance = [{ field: 'ownerContext.unlinkedOwners', filename: 'fiche-fictive.pdf', page: 2, extract: MARKER, importedAt: '2026-10-28T12:00:00Z' }];
    initial = await source.saveProject({ data, creationKey: randomUUID() }); project = initial.project.id;
    for (const who of ['vincent', 'annCharlotte']) await sql.query('insert into public.fonciere_project_assignments(project_id,user_id) values($1,$2)', [project, users[who].id]);
    const reconnect = await login(fixture.users.admin); persisted = await createFonciereRepository(reconnect.client).loadProject(project); assert.equal(persisted.data.ownerContext.owners[0].person.note, MARKER); assert.equal(persisted.data.ownerContext.declaredCount, 4); assert.equal(persisted.data.ownerContext.owners.length, 2); assert.equal(persisted.data.ownerContext.representatives[0].contactId, fixture.owners.representative);
    assert.equal(persisted.data.ownerContext.negotiation.updatedBy, users.admin.id); assert(persisted.data.ownerContext.negotiation.updatedAt);
  });
  await test('Manual persisted presentation excludes owner fields, identifiers, provenance and appraisal without changing finance', async () => {
    const mapped = toPresentationData(persisted.data, persisted.project), empty = structuredClone(persisted.data); empty.ownerContext = createFonciereData().ownerContext;
    assert.deepEqual(calculate(mapped.state), calculate(toPresentationData(empty).state));
    const created = await generator.createProject(mapped.state.project); const saved = await generator.saveProject({ project: created, data: mapped, status: 'draft' }); manualId = saved.project.id;
    privateAbsent(await row(manualId)); privateAbsent(saved.data); privateAbsent(exportProjectJson(saved.data));
    assert.equal(saved.data.state.acq, '820000'); assert.equal(saved.data.state.works, '150000'); assert.equal(saved.data.state.resale, '1450000');
  });
  await test('Approved bank presentation uses the approved snapshot and excludes the dedicated internal context from stored data', async () => {
    await vote('vincent'); await vote('annCharlotte'); assert.equal((await read()).status, 'approved');
    await prepareBankPresentation(users.admin.client, project); bankId = (await read()).bank.presentationId; assert(bankId); const bank = await generator.loadProject(bankId); privateAbsent(bank.data); privateAbsent(await row(bankId)); privateAbsent(exportProjectJson(bank.data));
    assert.equal(bank.data.state.asking, '950000'); assert.equal(bank.data.state.works, '150000'); assert.equal(bank.data.state.acq, '820000'); assert.equal(bank.data.state.resale, '1450000');
  });
  await test('Presentation reimport starts with empty internal context and preserves an existing project context during reviewed reconciliation', async () => {
    const manual = await generator.loadProject(manualId); const newProject = fromPresentationData(manual.data); assert.deepEqual(newProject.ownerContext, createFonciereData().ownerContext);
    const reconciled = fromPresentationData(manual.data, persisted.data); assert.deepEqual(reconciled.ownerContext, persisted.data.ownerContext);
  });
  if (!process.argv.includes('--api-only')) {
  browser = await chromium.launch({ headless: true, channel: 'chrome' }); context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  await context.addInitScript(id => { localStorage.setItem('oar.ui-language.v1:anonymous', 'fr'); localStorage.setItem('oar.ui-language.v1:account:' + id, 'fr'); }, fixture.users.admin.id);
  await context.route('**/*', route => { const url = new URL(route.request().url()); if (['http:', 'https:'].includes(url.protocol) && ![fixture.app, fixture.api].includes(url.origin)) { external.push(url.origin + url.pathname); return route.abort(); } return route.continue(); });
  page = await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  await test('Actual browser manual JSON and PowerPoint export contain no private markers in every XML part, including notes', async () => { exported.manual = await browserExports('owners-manual-fictitious', manualId); });
  await test('Actual browser bank JSON and PowerPoint export contain no private markers in every XML part, including notes', async () => { exported.bank = await browserExports('owners-bank-fictitious', bankId); });
  await test('Imported JSON cannot recover ownerContext through nested metadata or PowerPoint speaker notes', async () => {
    const imported = JSON.parse(readFileSync(join(dir, 'owners-manual-fictitious.json'), 'utf8')); imported.importMeta.ownerContext = { secret: MARKER }; imported.importMeta.fonciereSnapshot.ownerContext = { secret: MARKER }; imported.importMeta.nested = [{ ownerContext: { secret: MARKER }, public: 'keep' }];
    await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({ name: 'copie-cachee-fictive.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
    await page.waitForFunction(() => document.querySelector('#izord-project')?.value === 'Propriétaires fictifs — confidentialité');
    const visible = page.locator('[data-izord-generator]:visible'); let pending = page.waitForEvent('download'); await visible.getByRole('button', { name: /^Exporter le JSON/ }).click(); let download = await pending; privateAbsent(readFileSync(await download.path(), 'utf8'));
    pending = page.waitForEvent('download', { timeout: 120000 }); await visible.getByRole('button', { name: /Générer le PowerPoint/ }).click(); download = await pending; const zip = await JSZip.loadAsync(readFileSync(await download.path())); for (const [path, entry] of Object.entries(zip.files)) if (!entry.dir && /\.(xml|rels)$/.test(path)) privateAbsent(await entry.async('string'));
  });
  }
  await test('Internal saved context edit requires arbitration reconfirmation and keeps existing worked presentations and finance intact', async () => {
    const bank = await generator.loadProject(bankId), worked = structuredClone(bank.data); worked.state.decisionNotes = 'WRITTEN PRESENTATION TO KEEP'; const savedBank = await generator.saveProject({ project: bank.project, previous: bank, data: worked, status: 'draft' }); const beforeBank = await row(bankId), beforeManual = await row(manualId), current = await source.loadProject(project);
    const previousArbitration = await read(); const changed = structuredClone(current.data); changed.ownerContext.negotiation.nextQuestion = MARKER + ' next saved question'; const savedSource = await source.saveProject({ data: changed, previous: current }); const pending = await read(); assert.equal(pending.status, 'pending'); assert.notEqual(pending.fingerprint, previousArbitration.fingerprint);
    assert.deepEqual(calculate(toPresentationData(savedSource.data).state), calculate(toPresentationData(current.data).state)); assert.deepEqual(await row(bankId), beforeBank); assert.deepEqual(await row(manualId), beforeManual);
    await vote('vincent'); await vote('annCharlotte'); await prepareBankPresentation(users.admin.client, project); const after = await row(bankId); assert.equal(after.revision, savedBank.project.revision); assert.deepEqual(after.payload, beforeBank.payload); assert.equal((await read()).bank.needsUpdate, true);
  });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  writeFileSync(join(dir, 'results.json'), JSON.stringify({ passed: checks.length, checks, exported, errors, externalRequests: external, project, manualId, bankId, services: 'Real isolated Auth/PostgreSQL/PostgREST/Storage and Chromium JSON/PPTX exports', productionWrites: 0 }, null, 2));
} catch (error) { if (page) { try { await page.screenshot({ path: join(dir, 'failure.png'), fullPage: true }); writeFileSync(join(dir, 'failure-body.txt'), await page.locator('body').innerText()); } catch {} } writeFileSync(join(dir, 'failure.json'), JSON.stringify({ error: error.message, checks, errors, external }, null, 2)); throw error; }
finally { await context?.close(); await browser?.close(); await sql.end(); }
