/** Browser proof against the actual candidate and real isolated LOCAL services.
 * Successful Auth, reads and mutations are never fulfilled by this harness.
 * Delay-only gates forward unchanged requests. Failure-only cases are separate.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, webkit } = require('/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
assert.ok(process.env.CONTACTS_ENTITY_BENCH, 'Explicit real LOCAL bench JSON required');
const bench = JSON.parse(readFileSync(process.env.CONTACTS_ENTITY_BENCH, 'utf8'));
const origin = process.env.CONTACTS_ENTITY_ORIGIN || 'http://127.0.0.1:3399';
const backend = new URL(bench.origin).origin;
for (const value of [origin, backend]) assert.ok(new URL(value).protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(new URL(value).hostname), 'Only localhost services may be exercised');
const destination = resolve(process.env.CONTACTS_ENTITY_DEST || dirname(process.cwd()));
const out = resolve(process.env.CONTACTS_ENTITY_BROWSER_OUT || join(dirname(process.cwd()), 'evidence/browser'));
const captures = join(out, 'captures');
mkdirSync(captures, { recursive: true });
const manifestPath = process.env.CONTACTS_ENTITY_DEMO_MANIFEST || join(destination, 'evidence/demo-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.status, 'ready'); assert.equal(manifest.mode, 'production'); assert.equal(manifest.app, origin); assert.equal(manifest.backend, backend);
function sourceMatch() {
  const mismatches = [];
  for (const file of manifest.sourceFiles) for (const [name, root] of [['source', manifest.sourceRoot], ['servedCopy', manifest.directory]]) {
    const actual = createHash('sha256').update(readFileSync(join(root, file.path))).digest('hex');
    if (actual !== file.sha256) mismatches.push({ name, path: file.path, expected: file.sha256, actual });
  }
  assert.deepEqual(mismatches, [], 'The production-mode demo must serve the final exact candidate');
  return { files: manifest.sourceFiles.length, sourceAndServedCopyMatch: true, mismatches };
}
const sourceBefore = sourceMatch();
const runId = process.env.CONTACTS_ENTITY_RUN_ID || new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const testSha256 = createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
const previous = process.env.CONTACTS_ENTITY_APPEND && existsSync(join(out, 'results.json')) ? JSON.parse(readFileSync(join(out, 'results.json'), 'utf8')) : null;
if (previous) { assert.equal(previous.origin, origin); assert.equal(previous.backend, backend); }
const results = previous ? previous.results.map(record => ({ runId: previous.runId, testSha256: previous.testSha256, ...record })) : [];
const configurations = ['chromium', 'webkit'].flatMap(engine => [{ engine, viewport: { width: 1440, height: 1000 }, mobile: false }, { engine, viewport: { width: 390, height: 667 }, mobile: true }]);
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function nav(page, mobile) { return page.locator(mobile ? '.unified-more-panel' : '.sidebar'); }
async function language(page, config, value, record) {
  const languageName = value === 'en' ? 'English — EN' : 'Français — FR';
  const modal = await page.getByRole('dialog').count() > 0;
  if (config.mobile && !await nav(page, true).isVisible()) {
    if (modal) await page.locator('#unified-more-trigger').evaluate(button => button.click());
    else await page.locator('#unified-more-trigger').click();
  }
  const button = nav(page, config.mobile).locator('[data-language-selector]').getByRole('button', { name: languageName, exact: true });
  if (modal) { await button.evaluate(element => element.click()); record.programmaticModalLanguageChanges++; }
  else await button.click();
  if (config.mobile) {
    const close = nav(page, true).locator('.unified-more-close');
    if (modal) await close.evaluate(element => element.click()); else await close.click();
  }
  await page.waitForFunction(expected => document.documentElement.lang === expected, value === 'en' ? 'en-GB' : 'fr');
}
function mutation(request) { return request.method() === 'POST' && new URL(request.url()).pathname === '/rest/v1/rpc/crm_mutate_record'; }
async function watch(context, record) {
  const calls = [], auth = [], unexpected = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if ([origin, backend].includes(url.origin)) return route.continue();
    unexpected.push({ origin: url.origin, path: url.pathname });
    return route.abort();
  });
  context.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== backend) return;
    if (url.pathname.startsWith('/auth/')) auth.push({ method: request.method(), path: url.pathname });
    if (mutation(request)) calls.push({ request, body: request.postDataJSON(), responseStatus: null, response: null });
  });
  context.on('response', async response => {
    if (!mutation(response.request())) return;
    const call = calls.find(item => item.request === response.request());
    if (call) { call.responseStatus = response.status(); try { call.response = await response.json(); } catch { call.response = null; } }
  });
  record.proofBoundary = 'Actual integrated candidate. Password Auth, JWT verification, PostgREST reads and successful RPC writes are real LOCAL services with fictional accounts. No Production session or business record is used. Delay-only interception forwards an unchanged request; failure-only interception is reported separately.';
  return { calls, auth, unexpected };
}
async function login(page, profile) {
  await page.goto(origin + '/contacts-entity-demo', { waitUntil: 'domcontentloaded' });
  await page.locator(`[data-local-profile="${profile}"]`).click();
  await page.waitForURL(url => url.pathname === '/');
  await page.locator('.crm-shell').waitFor();
  await settledContacts(page, profile);
}
async function settledContacts(page, profile) {
  await page.locator('.contacts-workspace[data-crm-module="contacts"]').waitFor();
  await page.locator('.contact-create-form').waitFor();
  // The owner cloud load starts after a 700 ms timer, later than networkidle.
  // Wait for its actual completion before attributing calls to a UI toggle.
  if (profile === 'owner') await page.locator('.shared-db-status-panel.connected').waitFor({ state: 'attached' });
  await page.waitForLoadState('networkidle');
}
async function snapshot(page, form, record, view, state, value) {
  const button = form.locator('button[type="submit"]');
  if (state === 'validation') await form.locator('[aria-invalid="true"]').first().scrollIntoViewIfNeeded();
  else await button.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500); // Let native smooth scrolling settle before the evidence frame.
  const path = join(captures, `${record.name}-${view}-${value}-${state}.png`);
  await page.screenshot({ path });
  record.screenshots.push({ path, language: value, view, state });
}
function contrast(color, background) {
  const luminance = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
  const a = luminance(color), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
async function buttonMetrics(button) {
  const value = await button.evaluate(element => {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect(), form = element.closest('form');
    let background = 'rgb(255, 255, 255)';
    for (let node = element.parentElement; node; node = node.parentElement) { const candidate = getComputedStyle(node).backgroundColor, numbers = candidate.match(/[\d.]+/g)?.map(Number) || []; if (numbers.length === 3 || numbers[3] === 1) { background = candidate; break; } }
    return { text: element.textContent.trim(), color: style.color, backgroundColor: style.backgroundColor, backdrop: background, opacity: Number(style.opacity), display: style.display, height: rect.height, width: rect.width, border: style.border, outline: style.outline, boxShadow: style.boxShadow, disabled: element.matches(':disabled'), focused: document.activeElement === element, formWidth: form.getBoundingClientRect().width, formClientWidth: form.clientWidth, formScrollWidth: form.scrollWidth };
  });
  value.contrast = contrast(value.color, value.backgroundColor);
  const rgb = text => text.match(/[\d.]+/g).slice(0, 3).map(Number), under = rgb(value.backdrop);
  const blend = color => 'rgb(' + rgb(color).map((part, index) => part * value.opacity + under[index] * (1 - value.opacity)).join(',') + ')';
  value.compositedContrast = contrast(blend(value.color), blend(value.backgroundColor));
  assert.ok(value.compositedContrast >= 4.5, 'Contacts submit text remains readable');
  assert.ok(value.height >= 37 && value.height < 64, 'Contacts submit remains compact');
  assert.notEqual(value.display, 'grid');
  assert.ok(value.formScrollWidth <= value.formClientWidth + 2, 'Contacts form has no horizontal overflow');
  return value;
}
async function styles(page, form, record, view, value) {
  const button = form.locator('button[type="submit"]');
  for (const state of ['normal', 'hover', 'focus']) {
    await page.mouse.move(0, 0);
    if (state === 'hover') await button.hover();
    if (state === 'focus') { await page.keyboard.press('Tab'); await button.focus(); }
    await page.waitForTimeout(180);
    record.styles[`${view}-${value}-${state}`] = await buttonMetrics(button);
    await snapshot(page, form, record, view, state, value);
  }
}
async function identity(form) {
  const handles = {};
  for (const field of ['entityType', 'name', 'companyName', 'firstName', 'civility']) handles[field] = await form.locator(`[name="${field}"]`).elementHandle();
  return handles;
}
async function preserved(form, handles, values) {
  for (const [field, handle] of Object.entries(handles)) {
    assert.equal(await handle.evaluate(element => element.isConnected), true, `${field} retains DOM identity`);
    assert.equal(await form.locator(`[name="${field}"]`).evaluate((element, old) => element === old, handle), true);
  }
  for (const [field, expected] of Object.entries(values)) assert.equal(await form.locator(`[name="${field}"]`).inputValue(), expected);
}
async function noOperations(audit, operation) {
  const writes = audit.calls.length, auth = audit.auth.length;
  await operation(); await pause(80);
  assert.equal(audit.calls.length, writes, 'Draft/language change must not submit');
  assert.equal(audit.auth.length, auth, 'Draft/language change must not reauthenticate');
}
async function invalid(page, form, field, fragment) {
  await form.locator('button[type="submit"]').click();
  const input = form.locator(`[name="${field}"]`);
  const describedBy = await input.getAttribute('aria-describedby');
  assert.ok(describedBy);
  await page.locator('#' + describedBy.split(' ')[0]).filter({ hasText: fragment }).waitFor();
  assert.equal(await input.getAttribute('aria-invalid'), 'true');
  assert.ok(await input.getAttribute('aria-describedby'));
  assert.equal(await input.evaluate(element => element === document.activeElement), true, 'Validation focuses the relevant identity field');
}
async function localToken(page) {
  // Only the freshly signed-in fictional LOCAL session. It is never persisted in evidence.
  return page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.endsWith('-auth-token')) { try { const session = JSON.parse(localStorage.getItem(key)); if (session.access_token) return session.access_token; } catch { /* Not an Auth entry. */ } } throw new Error('No local Auth session'); });
}
async function readContacts(context, page, record) {
  const token = await localToken(page);
  const response = await context.request.post(backend + '/rest/v1/rpc/crm_read_module', { headers: { apikey: bench.publishableKey, Authorization: 'Bearer ' + token }, data: { p_module: 'contacts' } });
  assert.equal(response.status(), 200, 'Real local JWT read must succeed');
  const data = await response.json();
  assert.ok(Array.isArray(data.collections?.contacts));
  record.realReads.push({ at: new Date().toISOString(), status: response.status(), revision: data.revision, ids: data.collections.contacts.map(contact => contact.id) });
  return data;
}
function row(page, label) { return page.locator('.oar-contact-row').filter({ has: page.getByRole('heading', { name: label, exact: true }) }); }
async function edit(page, label) {
  await row(page, label).getByRole('button', { name: /^(Modifier|Edit)$/ }).click();
  const form = page.locator('#contact-edit-panel form'); await form.waitFor(); return form;
}
async function closeSavedDetail(page) {
  await page.locator('#contact-edit-panel').waitFor({ state: 'hidden' });
  const detail = page.locator('#contact-detail-panel');
  if (await detail.isVisible()) await detail.locator('[data-crm-dismiss="true"]').click();
}
async function saveReal(page, form, audit, record) {
  const index = audit.calls.length;
  const responsePromise = page.waitForResponse(response => mutation(response.request()));
  await form.locator('button[type="submit"]').click();
  const response = await responsePromise;
  assert.equal(response.status(), 200, 'Real LOCAL RPC must confirm the submitted record');
  const data = await response.json();
  assert.ok(Array.isArray(data.collections?.contacts));
  assert.equal(audit.calls.length, index + 1, 'One submit creates one RPC mutation');
  record.realSaves.push({ status: response.status(), id: audit.calls[index].body.p_id, patch: audit.calls[index].body.p_patch, revision: data.revision });
  return { id: audit.calls[index].body.p_id, data, patch: audit.calls[index].body.p_patch };
}
async function delayedRealCreate(context, page, form, audit, config, record) {
  let release, pending;
  const gate = new Promise(resolve => { release = resolve; });
  const handler = async route => { if (!mutation(route.request())) return route.continue(); pending = route.request(); await gate; return route.continue(); };
  await context.route('**/rest/v1/rpc/crm_mutate_record', handler);
  const count = audit.calls.length;
  const responsePromise = page.waitForResponse(response => mutation(response.request()));
  await form.locator('button[type="submit"]').dblclick();
  for (let i = 0; !pending && i < 150; i++) await pause(20);
  assert.ok(pending, 'Real mutation reaches the delay-only forwarding gate');
  const handles = await identity(form);
  for (const value of ['fr', 'en', 'fr']) {
    await noOperations(audit, () => language(page, config, value, record));
    await preserved(form, handles, { entityType: 'company' });
    assert.equal(await form.locator('[name="companyName"]').isDisabled(), true, 'Pending fields remain locked');
    const metrics = await buttonMetrics(form.locator('button[type="submit"]'));
    assert.equal(metrics.disabled, true);
    record.styles[`create-${value}-pending`] = metrics;
    if (!record.screenshots.some(item => item.view === 'create' && item.state === 'pending' && item.language === value)) await snapshot(page, form, record, 'create', 'pending', value);
    assert.equal(audit.calls.length, count + 1, 'Double click and language changes must not create a second request');
  }
  record.delayOnly = { requestForwardedUnchanged: true, successfulResponseSimulated: false, doubledClickRequests: audit.calls.length - count };
  release();
  const response = await responsePromise;
  assert.equal(response.status(), 200);
  const data = await response.json();
  const body = audit.calls[count].body;
  record.realSaves.push({ status: response.status(), id: body.p_id, patch: body.p_patch, revision: data.revision, delayedBeforeForwarding: true });
  await context.unroute('**/rest/v1/rpc/crm_mutate_record', handler);
  return { id: body.p_id, data, patch: body.p_patch };
}

for (const config of configurations.filter(config => !process.env.CONTACTS_ENTITY_ENGINE || config.engine === process.env.CONTACTS_ENTITY_ENGINE)) {
  const browser = await (config.engine === 'chromium' ? chromium.launch({ headless: true, channel: 'chrome' }) : webkit.launch({ headless: true }));
  for (const profile of ['owner', 'contributor'].filter(profile => !process.env.CONTACTS_ENTITY_PROFILE || profile === process.env.CONTACTS_ENTITY_PROFILE)) {
    const record = { name: `${config.engine}-${config.mobile ? 'mobile' : 'desktop'}-${profile}`, profile, runId, testSha256, viewport: config.viewport, browserVersion: browser.version(), status: 'running', screenshots: [], styles: {}, realSaves: [], realReads: [], programmaticModalLanguageChanges: 0, checks: [] };
    const context = await browser.newContext({ viewport: config.viewport });
    const audit = await watch(context, record), page = await context.newPage(), errors = [];
    page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    try {
      await login(page, profile); await language(page, config, 'fr', record);
      const form = page.locator('.contact-create-form'), handles = await identity(form);
      assert.equal(await form.locator('[name="entityType"]').inputValue(), 'person');
      await form.locator('[name="firstName"]').fill('Guillaume');
      await form.locator('[name="companyName"]').fill('Entreprise de rattachement fictive');
      await noOperations(audit, async () => { await form.locator('[name="entityType"]').selectOption('company'); await form.locator('[name="entityType"]').selectOption('person'); for (const value of ['en', 'fr']) await language(page, config, value, record); });
      await preserved(form, handles, { entityType: 'person', firstName: 'Guillaume', name: '', companyName: 'Entreprise de rattachement fictive', kind: 'Client' });
      let count = audit.calls.length;
      await invalid(page, form, 'name', 'Veuillez renseigner le nom de famille.');
      assert.equal(audit.calls.length, count);
      await form.locator('[name="companyName"]').fill('');
      await invalid(page, form, 'name', 'Veuillez renseigner le nom de famille.');
      assert.equal(audit.calls.length, count, 'First name alone cannot create a Person');
      await snapshot(page, form, record, 'person-invalid', 'validation', 'fr');
      await noOperations(audit, () => language(page, config, 'en', record));
      assert.equal(await form.locator('[name="name"]').getAttribute('aria-invalid'), 'true');
      assert.ok(!(await form.textContent()).includes('Veuillez renseigner le nom de famille.'));
      await snapshot(page, form, record, 'person-invalid', 'validation', 'en');
      await language(page, config, 'fr', record);
      await form.locator('[name="entityType"]').selectOption('company');
      await form.locator('[name="companyName"]').fill('   ');
      await invalid(page, form, 'companyName', 'Veuillez renseigner le nom de l’entreprise.');
      assert.equal(audit.calls.length, count);
      await snapshot(page, form, record, 'company-invalid', 'validation', 'fr');
      await noOperations(audit, () => language(page, config, 'en', record));
      assert.equal(await form.locator('[name="companyName"]').getAttribute('aria-invalid'), 'true');
      await snapshot(page, form, record, 'company-invalid', 'validation', 'en');
      const company = `Société Émeraude ${runId}-${record.name}-seule`;
      await form.locator('[name="companyName"]').fill(company);
      await form.locator('[name="firstName"]').fill('');
      await form.locator('[name="name"]').fill('');
      for (const value of ['fr', 'en', 'fr']) { await noOperations(audit, () => language(page, config, value, record)); if (!record.styles[`create-${value}-normal`]) await styles(page, form, record, 'create', value); }
      const created = await delayedRealCreate(context, page, form, audit, config, record);
      assert.equal(created.patch.entityType, 'company'); assert.equal(created.patch.companyName, company); assert.ok(!created.patch.name); assert.ok(!created.patch.firstName);
      await row(page, company).waitFor();
      let read = await readContacts(context, page, record);
      let saved = read.collections.contacts.find(contact => contact.id === created.id);
      assert.ok(saved); assert.equal(saved.entityType, 'company'); assert.equal(saved.companyName, company); assert.ok(!saved.name); assert.ok(!saved.firstName); assert.equal(read.collections.contacts.filter(contact => contact.companyName === company).length, 1);
      await page.reload(); await settledContacts(page, profile); await row(page, company).waitFor();
      let editing = await edit(page, company);
      assert.equal(await editing.locator('[name="entityType"]').inputValue(), 'company'); assert.equal(await editing.locator('[name="companyName"]').inputValue(), company); assert.equal(await editing.locator('[name="name"]').inputValue(), '');
      const editHandles = await identity(editing);
      await editing.locator('[name="firstName"]').fill('Guillaume');
      count = audit.calls.length;
      await noOperations(audit, async () => { await editing.locator('[name="entityType"]').selectOption('person'); await editing.locator('[name="entityType"]').selectOption('company'); for (const value of ['en', 'fr']) await language(page, config, value, record); });
      await preserved(editing, editHandles, { entityType: 'company', firstName: 'Guillaume', name: '', companyName: company, kind: 'Client' });
      for (const value of ['fr', 'en', 'fr']) { await noOperations(audit, () => language(page, config, value, record)); if (!record.styles[`edit-${value}-normal`]) await styles(page, editing, record, 'edit', value); }
      const updated = await saveReal(page, editing, audit, record);
      assert.equal(updated.id, created.id, 'Adding an interlocutor must preserve the contact ID');
      await closeSavedDetail(page);
      read = await readContacts(context, page, record); saved = read.collections.contacts.find(contact => contact.id === created.id);
      assert.equal(saved.firstName, 'Guillaume'); assert.ok(!saved.name); assert.equal(saved.companyName, company); assert.equal(saved.entityType, 'company');
      assert.equal(await row(page, company).getByRole('heading', { name: company, exact: true }).count(), 1, 'Company remains the primary identity with a first-name-only interlocutor');
      editing = await edit(page, company); await editing.locator('[name="phone"]').fill('+33000000777');
      const phone = await saveReal(page, editing, audit, record); assert.equal(phone.id, created.id);
      assert.ok(!['entityType', 'name', 'firstName', 'civility', 'companyName'].some(field => field in phone.patch), 'A phone-only edit omits every identity field');
      await closeSavedDetail(page);
      read = await readContacts(context, page, record); saved = read.collections.contacts.find(contact => contact.id === created.id); assert.equal(saved.phone, '+33000000777'); assert.equal(saved.firstName, 'Guillaume'); assert.equal(saved.companyName, company); assert.equal(saved.entityType, 'company');
      const second = `Société Guillaume ${runId}-${record.name}`;
      await form.locator('[name="entityType"]').selectOption('company'); await form.locator('[name="companyName"]').fill(second); await form.locator('[name="firstName"]').fill('Guillaume'); await form.locator('[name="name"]').fill('');
      const firstOnly = await saveReal(page, form, audit, record); assert.equal(firstOnly.patch.entityType, 'company'); assert.equal(firstOnly.patch.firstName, 'Guillaume'); assert.ok(!firstOnly.patch.name); await row(page, second).waitFor();
      const personName = `Nom seul ${runId}-${record.name}`;
      await form.locator('[name="entityType"]').selectOption('person'); await form.locator('[name="companyName"]').fill(''); await form.locator('[name="firstName"]').fill(''); await form.locator('[name="name"]').fill(personName);
      const person = await saveReal(page, form, audit, record); assert.equal(person.patch.entityType, 'person'); assert.equal(person.patch.name, personName); assert.ok(!person.patch.firstName); await row(page, personName).waitFor();
      await page.reload(); await settledContacts(page, profile); await row(page, second).waitFor();
      editing = await edit(page, second); assert.equal(await editing.locator('[name="firstName"]').inputValue(), 'Guillaume'); assert.equal(await editing.locator('[name="name"]').inputValue(), ''); assert.equal(await editing.locator('[name="companyName"]').inputValue(), second);
      for (const value of ['fr', 'en']) {
        await noOperations(audit, () => language(page, config, value, record)); await editing.locator('[name="entityType"]').scrollIntoViewIfNeeded();
        const path = join(captures, `${record.name}-company-guillaume-reopened-${value}.png`); await page.screenshot({ path }); record.screenshots.push({ path, language: value, view: 'company-guillaume-reopened', state: 'real-reloaded' });
      }
      await page.locator('#contact-edit-panel [data-crm-dismiss="true"]').click();
      read = await readContacts(context, page, record);
      const legacy = read.collections.contacts.find(contact => contact.id === 'legacy-blank');
      assert.ok(legacy && legacy.entityType === undefined, 'An unqualified historical record remains available without automatic classification');
      const legacyLabel = [legacy.firstName, legacy.name].filter(Boolean).join(' ').trim() || legacy.companyName;
      editing = await edit(page, legacyLabel);
      assert.equal(await editing.locator('[name="entityType"]').inputValue(), '', 'A legacy edit does not force a type choice');
      await editing.locator('[name="phone"]').fill('+33000' + runId.slice(-3) + (config.engine === 'chromium' ? '1' : '2') + (profile === 'owner' ? '1' : '2') + (config.mobile ? '2' : '1'));
      const legacyPhone = await saveReal(page, editing, audit, record);
      assert.equal(legacyPhone.id, legacy.id); assert.ok(!['entityType', 'name', 'firstName', 'companyName', 'civility'].some(field => field in legacyPhone.patch));
      await closeSavedDetail(page);
      read = await readContacts(context, page, record);
      const legacyAfter = read.collections.contacts.find(contact => contact.id === legacy.id);
      for (const field of ['entityType', 'name', 'firstName', 'companyName', 'civility']) assert.equal(legacyAfter[field], legacy[field], 'A phone-only legacy edit preserves identity');
      assert.ok(read.collections.contacts.some(contact => contact.id === 'homonym-one') && read.collections.contacts.some(contact => contact.id === 'homonym-two'), 'Homonyms retain their separate IDs');
      record.legacy = { id: legacy.id, natureNotInvented: true, phoneOnlyPatch: legacyPhone.patch, identityPreserved: true, homonymIds: ['homonym-one', 'homonym-two'] };
      async function searchContacts(query) {
        if (config.mobile && profile === 'owner') {
          // The actual mobile header exposes search through its existing sheet.
          await page.locator('.mobile-crm-header-actions .mobile-icon-button').click();
          const sheet = page.locator('.mobile-search-sheet');
          const input = sheet.locator('input[type="search"]:visible');
          await input.waitFor({ state: 'visible' }); await input.fill(query);
          await sheet.locator('button.primary-button').click(); await sheet.waitFor({ state: 'hidden' });
        } else await page.locator('input[type="search"]:visible').first().fill(query);
      }
      await searchContacts('societe emeraude'); await row(page, company).waitFor(); await searchContacts('guillaum'); await row(page, second).waitFor(); await searchContacts('');
      record.overflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
      assert.ok(record.overflow.document <= config.viewport.width + 2 && record.overflow.body <= config.viewport.width + 2, 'Contacts page has no horizontal overflow');
      assert.deepEqual(errors, []); assert.deepEqual(audit.unexpected, []);
      record.checks = ['real local password Auth', 'client person validation with employer and first name alone', 'client company whitespace validation with first name', 'field focus and accessible translated error', 'same DOM/draft/type/kind FR→EN→FR', 'company-only real RPC save/read/reload/reopen', 'first-name-only company interlocutor', 'later interlocutor preserves ID', 'phone update omits identity fields and preserves identity', 'last-name-only person accepted', 'one record after double click', 'no operation caused by language/type changes', 'legacy phone edit does not force or invent a type', 'homonym IDs remain separate', 'accent/case/fragment search preserved', 'normal/hover/focus/pending contrast and compact styles', 'no horizontal overflow'];
      record.status = 'passed';
    } catch (error) { record.status = 'failed'; record.error = error.stack; const path = join(captures, record.name + '-failure.png'); await page.screenshot({ path }).catch(() => {}); record.screenshots.push({ path, language: 'unknown', view: 'failure', state: 'failure' }); }
    finally { record.errors = errors; record.authCalls = audit.auth; record.unexpectedRequests = audit.unexpected; record.mutations = audit.calls.map(({ body, responseStatus, response }) => ({ body, responseStatus, response })); writeFileSync(join(out, record.name + '.json'), JSON.stringify(record, null, 2) + '\n'); const index = results.findIndex(item => item.name === record.name); if (index < 0) results.push(record); else results[index] = record; await context.close(); console.log(record.name + ' ' + record.status); if (record.error) console.error(record.error); }
  }
  await browser.close();
}
writeFileSync(join(out, 'results.json'), JSON.stringify({ runId, origin, backend, destination, sourceBefore, sourceAfter: sourceMatch(), testSha256, reusedPassedContexts: previous ? previous.results.filter(record => record.status === 'passed').map(record => ({ name: record.name, runId: previous.runId, testSha256: previous.testSha256, reason: 'Unchanged contributor journeys reused; only owner startup readiness waiting changed.' })) : [], results }, null, 2) + '\n');
if (results.some(record => record.status !== 'passed')) process.exitCode = 1;
