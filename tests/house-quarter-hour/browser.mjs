/** Real shared form + disposable local Auth/RPC. No Production credentials or writes. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { assertHouseExpensesLocalTarget } from '../house-expenses/server-local-target.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
assert.ok(process.env.HOUSE_EXPENSES_STATUS_FILE, 'Explicit disposable stack required');
const status = JSON.parse(readFileSync(process.env.HOUSE_EXPENSES_STATUS_FILE, 'utf8'));
const origin = 'http://127.0.0.1:3184';
assertHouseExpensesLocalTarget({ api: status.API_URL, database: status.DB_URL, app: origin, mail: 'http://127.0.0.1:56134', acknowledgement: process.env.IZORD_TEST_ACK });
const fixture = JSON.parse(readFileSync(join(dirname(process.env.HOUSE_EXPENSES_STATUS_FILE), 'fixtures.private.json'), 'utf8'));
const output = process.env.HOUSE_QUARTER_OUTPUT || join(dirname(process.env.HOUSE_EXPENSES_STATUS_FILE), 'quarter-browser');
mkdirSync(output, { recursive: true });
const results = [], errors = [], external = [];
const quarterMinutes = ['00', '15', '30', '45'];
const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
const form = page => page.locator('.house-two-columns > section').first().locator('form');
const start = page => form(page).getByRole('group', { name: /^(Heure de début|Start time)$/ });
const end = page => form(page).getByRole('group', { name: /^(Heure de fin|End time)$/ });
const selects = group => group.locator('select');
const values = async group => Promise.all([selects(group).nth(0).inputValue(), selects(group).nth(1).inputValue()]);
const options = select => select.locator('option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, text: node.textContent })));
const preview = page => form(page).locator('.house-calculation-line > p').first();
const normalize = text => text.replace(/[\u00a0\u202f]/g, ' ');
async function setTime(group, value) {
  const [hour, minute] = value.split(':');
  await selects(group).nth(0).selectOption(hour); await selects(group).nth(1).selectOption(minute);
}
async function language(page, lang) {
  if (await page.locator('html').getAttribute('lang') === (lang === 'en' ? 'en-GB' : 'fr')) return;
  const mobile = !await page.locator('[data-language-selector]:visible').count();
  if (mobile) await page.locator('#unified-more-trigger:visible').first().click();
  await page.locator('[data-language-selector]:visible').getByRole('button', { name: lang === 'en' ? 'English — EN' : 'Français — FR', exact: true }).click();
  await page.waitForFunction(lang => document.documentElement.lang === lang, lang === 'en' ? 'en-GB' : 'fr');
  if (mobile) await page.locator('.unified-more-close').click();
}
async function enterHours(page) {
  await page.locator('.house-tracking-view').waitFor();
  await page.locator('.house-tabs').getByRole('button', { name: /^(Heures|Hours)$/ }).click();
  await form(page).waitFor();
}
async function launch(browser, mode, width, lang = 'fr') {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  const requests = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && ![origin, status.API_URL].includes(url.origin)) { external.push(url.origin + url.pathname); return route.abort('blockedbyclient'); }
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  page.on('request', request => { if (request.url().startsWith(status.API_URL)) requests.push({ url: request.url(), body: request.postData() }); });
  let token;
  page.on('response', async response => { if (response.url().includes('/auth/v1/token?grant_type=password') && response.ok()) token = (await response.json()).access_token; });
  await page.goto(origin + '/?module=houseTracking');
  const actor = fixture.users[mode];
  await page.locator('input[type=email]').fill(actor.email);
  await page.locator('input[autocomplete=current-password]').fill(actor.password);
  await page.getByRole('button', { name: /^(Se connecter|Sign in)$/ }).click();
  await enterHours(page); await language(page, lang);
  assert.ok(token, 'Fresh password authentication used');
  const session = { context, page, requests, token };
  if (mode !== 'owner') assert.ok(!requests.some(request => request.url.includes('/crm_workspace_state')), 'Restricted path never reads full workspace');
  return session;
}
async function projection(token) {
  const response = await fetch(status.API_URL + '/rest/v1/rpc/crm_read_module', { method: 'POST', headers: { apikey: status.ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_module: 'houseTracking' }) });
  assert.equal(response.status, 200); return (await response.json()).collections;
}
async function setup(page, from = '08:15', to = '12:45', pause = '30') {
  // The searchable house/worker controls retain the canonical fixture IDs by default.
  const controls = form(page).locator('[data-searchable-select]');
  for (const [index, text] of [[0, 'Maison des frais fictifs'], [1, 'Intervenant frais fictif']]) {
    const control = controls.nth(index); await control.getByRole('combobox').fill(text);
    await control.getByRole('option').filter({ hasText: text }).click();
  }
  assert.equal(await controls.nth(0).locator('select').inputValue(), 'expense-house');
  assert.equal(await controls.nth(1).locator('select').inputValue(), 'expense-worker');
  await form(page).locator('input[type=date]').fill('2026-10-26');
  await setTime(start(page), from); await setTime(end(page), to);
  await form(page).getByLabel(/^(Pause minutes|Break in minutes)$/).fill(pause);
  await form(page).getByLabel(/^(Taux horaire|Hourly rate)$/).fill('25');
}
async function check(name, fn) {
  try { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, passed: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.stack); }
  writeFileSync(join(output, 'results.json'), JSON.stringify({ results, errors, external }, null, 2));
}
async function save(page, mode) {
  const endpoint = mode === 'owner' ? 'crm_create_house_time_entry' : 'crm_mutate_record';
  const response = page.waitForResponse(response => response.url().endsWith('/rpc/' + endpoint) && response.request().method() === 'POST');
  await form(page).locator('button[type=submit]').click();
  assert.equal((await response).status(), 200);
  await form(page).getByLabel('Note', { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.house-two-columns form').matches('[aria-busy=true]'));
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const mode of ['owner', 'contributor']) for (const width of [1440, 390]) for (const lang of ['fr', 'en']) {
    await check(`${mode} ${width}px ${lang}: exact rendered options, keyboard/touch, pauses and midnight`, async () => {
      const session = await launch(browser, mode, width, lang); const { page } = session;
      try {
        assert.equal(await form(page).locator('input[type=time]').count(), 0);
        for (const group of [start(page), end(page)]) {
          assert.equal(await selects(group).count(), 2);
          assert.equal(await group.getByRole('combobox', { name: lang === 'fr' ? 'Heure' : 'Hour', exact: true }).count(), 1);
          assert.equal(await group.getByRole('combobox', { name: 'Minutes', exact: true }).count(), 1);
          assert.deepEqual(await options(selects(group).nth(0)), hours.map(value => ({ value, text: value })));
          assert.deepEqual(await options(selects(group).nth(1)), quarterMinutes.map(value => ({ value, text: value })));
          const minutes = selects(group).nth(1);
          await minutes.selectOption('00');
          if (width < 500) { await minutes.tap(); await minutes.press('Escape'); }
          await minutes.focus(); await minutes.press('1');
          assert.equal(await minutes.inputValue(), '15');
          await minutes.press('Tab'); assert.ok(!await minutes.evaluate(node => document.activeElement === node));
        }
        await setup(page);
        assert.match(normalize(await preview(page).innerText()), /4(?:[,.]00)?\s*h/);
        await setup(page, '23:45', '00:15', '0');
        assert.match(normalize(await preview(page).innerText()), /0\s*h\s*30/);
        await setup(page);
        const metrics = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
        assert.ok(metrics.scroll <= metrics.width + 1, JSON.stringify(metrics));
        for (const group of [start(page), end(page)]) for (const select of [selects(group).nth(0), selects(group).nth(1)]) {
          await select.scrollIntoViewIfNeeded(); const box = await select.boundingBox();
          assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1 && box.height >= 36);
        }
        if (lang === 'fr' && mode === 'owner') await form(page).screenshot({ path: join(output, `form-${width}-fr.png`) });
        if (lang === 'fr' && mode === 'owner' && width === 1440) {
          await selects(start(page)).nth(1).focus(); await selects(start(page)).nth(1).press('Space');
          await form(page).screenshot({ path: join(output, 'native-popup-attempt.png') });
          await selects(start(page)).nth(1).press('Escape');
          // Native popup is outside the page's screenshot surface. Expand the same
          // rendered SELECT only for this diagnostic capture; option DOM is unchanged.
          for (const group of [start(page), end(page)]) await selects(group).nth(1).evaluate(node => { node.size = 4; });
          await form(page).screenshot({ path: join(output, 'four-minute-choices-fr.png') });
          writeFileSync(join(output, 'capture-provenance.json'), JSON.stringify({ file: 'four-minute-choices-fr.png', source: 'actual shared form against isolated Auth/RPC', captureOnlyDOMChange: 'size=4 on both native minute selects to show their existing four options; no option or product source changed', options: quarterMinutes }, null, 2));
        }
      } finally { await session.context.close(); }
    });
  }
  for (const mode of ['owner', 'contributor']) {
    await check(`${mode}: failed save retains draft; pending save locks controls; fresh authentication rereads exact times`, async () => {
      let session = await launch(browser, mode, mode === 'owner' ? 1440 : 390); let release;
      try {
        const { page } = session; await setup(page);
        const note = 'Quarter regression ' + mode + ' ' + Date.now();
        await form(page).getByLabel('Note', { exact: true }).fill(note);
        const before = await projection(session.token);
        const url = status.API_URL + '/rest/v1/rpc/' + (mode === 'owner' ? 'crm_create_house_time_entry' : 'crm_mutate_record');
        await page.route(url, route => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
        await form(page).locator('button[type=submit]').click(); await form(page).getByRole('alert').waitFor();
        assert.deepEqual(await values(start(page)), ['08', '15']); assert.deepEqual(await values(end(page)), ['12', '45']);
        assert.equal(await form(page).getByLabel('Note', { exact: true }).inputValue(), note);
        assert.deepEqual((await projection(session.token)).houseTimeEntries, before.houseTimeEntries);
        await page.unroute(url);
        let arrived; const reached = new Promise(resolve => { arrived = resolve; }); const gate = new Promise(resolve => { release = resolve; }); let posts = 0;
        await page.route(url, async route => { if (route.request().method() !== 'POST') return route.continue(); posts++; const response = await route.fetch(); assert.equal(response.status(), 200); arrived(); await gate; await route.fulfill({ response }); });
        await form(page).locator('button[type=submit]').click(); await Promise.race([reached, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Save did not reach local RPC')), 15000); timer.unref(); })]);
        for (const group of [start(page), end(page)]) for (const select of [selects(group).nth(0), selects(group).nth(1)]) assert.equal(await select.isDisabled(), true);
        await form(page).evaluate(node => { node.requestSubmit(); node.requestSubmit(); }); assert.equal(posts, 1);
        release(); await page.waitForFunction(() => !document.querySelector('.house-two-columns form').matches('[aria-busy=true]'));
        assert.equal(await form(page).getByLabel('Note', { exact: true }).inputValue(), '');
        assert.deepEqual(await values(start(page)), ['08', '15']); assert.deepEqual(await values(end(page)), ['12', '45']);
        await page.unroute(url); await setup(page, '23:45', '00:15', '0');
        await form(page).getByLabel('Note', { exact: true }).fill(note + ' overnight'); await save(page, mode);
        const historicBefore = (await projection(session.token)).houseTimeEntries.find(entry => entry.id === 'quarter-historic');
        assert.ok(historicBefore); assert.equal(historicBefore.startTime, '08:07'); assert.equal(historicBefore.endTime, '12:42');
        await session.context.close();
        session = await launch(browser, mode, mode === 'owner' ? 1440 : 390);
        const after = await projection(session.token);
        const daytime = after.houseTimeEntries.find(entry => entry.note === note), overnight = after.houseTimeEntries.find(entry => entry.note === note + ' overnight');
        assert.ok(daytime && overnight); assert.deepEqual([daytime.startTime, daytime.endTime, daytime.breakMinutes, daytime.hourlyRate], ['08:15', '12:45', 30, 25]);
        assert.deepEqual([overnight.startTime, overnight.endTime, overnight.breakMinutes], ['23:45', '00:15', 0]);
        assert.deepEqual(after.housePayments, before.housePayments);
        const workerFilter = session.page.locator('.house-worker-filter [data-searchable-select]');
        await workerFilter.getByRole('combobox').fill('Intervenant frais fictif');
        await workerFilter.getByRole('option').filter({ hasText: 'Intervenant frais fictif' }).click();
        const historic = session.page.locator('#house-time-quarter-historic'); await historic.waitFor();
        const historyText = normalize(await historic.innerText()); assert.ok(historyText.includes('08:07') && historyText.includes('12:42'));
        await historic.getByRole('button', { name: /^(Modifier les frais|Edit expenses)$/ }).click();
        const editor = session.page.locator('.house-time-history-item > section'); await editor.waitFor();
        await editor.locator('[name=expenseAmount]').fill(mode === 'owner' ? '3,75' : '4.25');
        await editor.locator('[name=expenseNote]').fill('Quarter regression expense only ' + mode);
        const response = session.page.waitForResponse(response => response.url().endsWith('/rpc/crm_update_house_time_expenses') && response.request().method() === 'POST');
        await editor.locator('button[type=submit]').click(); assert.equal((await response).status(), 200); await editor.waitFor({ state: 'detached' });
        const updated = (await projection(session.token)).houseTimeEntries.find(entry => entry.id === historicBefore.id);
        for (const key of Object.keys(historicBefore)) if (!['expenseAmount', 'expenseNote', 'updatedAt', 'updatedBy'].includes(key)) assert.deepEqual(updated[key], historicBefore[key], 'historic field preserved: ' + key);
        const amount = entry => ((Number(entry.endTime.slice(0, 2)) * 60 + Number(entry.endTime.slice(3))) - (Number(entry.startTime.slice(0, 2)) * 60 + Number(entry.startTime.slice(3))) - entry.breakMinutes) / 60 * entry.hourlyRate;
        assert.equal(amount(updated), amount(historicBefore)); assert.equal(updated.expenseAmount, mode === 'owner' ? 3.75 : 4.25);
      } finally { release?.(); await session.context.close(); }
    });
  }
  assert.deepEqual(external, [], 'No external service requests'); assert.deepEqual(errors, [], 'No browser runtime errors');
} finally {
  await browser.close();
  writeFileSync(join(output, 'results.json'), JSON.stringify({ results, errors, external }, null, 2));
  if (results.some(result => !result.passed)) process.exitCode = 1;
}
