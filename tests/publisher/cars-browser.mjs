/** Integrated CRM browser demo. Real Publisher API and PostgreSQL, fake Auth/providers. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { directory, fixture, trace } from './cars-local.mjs';
const { chromium, webkit } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const output = new URL('../../docs/publisher/cars/screenshots/', import.meta.url).pathname;
mkdirSync(output, { recursive: true });
const checks = [], errors = [], external = [], mutations = [];
const check = async (name, run) => { await run(); checks.push(name); writeFileSync(`${directory}/browser-progress.json`, JSON.stringify({ checks, errors, external }, null, 2)); console.log('PASS ' + name); };
const types = ['auto','suv','saloon','coupe_gt','sports_car','convertible','supercar','luxury_van'];
async function ready(page) { await page.getByRole('heading', { name: 'Instagram Publisher', exact: true }).waitFor(); await page.locator('.publisher-loading').waitFor({ state: 'hidden' }); }
async function login(page, who, navigate = true) {
  if (navigate) await page.goto(`${fixture.app}/publisher`);
  await page.locator('input[type=email]').fill(fixture.users[who].email);
  await page.locator('input[type=password]').fill(fixture.users[who].password);
  await page.getByRole('button', { name: /Se connecter|Sign in/, exact: true }).click();
  if (who !== 'none') await ready(page);
}
async function newForm(page) {
  const newButton = page.getByRole('button', { name: /^(Nouvelle création|New creation)$/ });
  await page.locator('.publisher-selector').or(newButton).first().waitFor();
  if (await newButton.isVisible()) await newButton.click();
  await page.locator('.publisher-selector').waitFor();
}
async function switchFixtureAccount(page, who) {
  // Change only this bench's fictitious Auth boundary, then exercise the actual
  // mounted AccessPortal focus/account check and draft invalidation.
  await page.evaluate(session => {
    const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!key) throw new Error('Fictitious local session key missing');
    localStorage.setItem(key, JSON.stringify(session));
    window.dispatchEvent(new Event('focus'));
  }, fixture.sessions[who]);
}
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
await context.route('**/*', route => {
  const r = route.request(), url = new URL(r.url());
  if (['http:','https:'].includes(url.protocol) && ![fixture.app, fixture.auth].includes(url.origin)) { external.push(r.url()); return route.abort(); }
  if (url.pathname === '/api/publisher' && r.method() === 'POST') mutations.push(r.postDataJSON());
  return route.continue();
});
const page = await context.newPage(); page.setDefaultTimeout(30000);
page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => void d.accept());
let created;
try {
  await login(page, 'editor');
  if (!process.argv.includes('--from-accounts') && !process.argv.includes('--touch-only')) {
  await check('native menu appears only for cars; all values; changing choices makes no generation request', async () => {
    await newForm(page);
    const n = mutations.length, paid = trace().length;
    assert.equal(await page.locator('#publisher-car-type').count(), 0);
    await page.locator('.publisher-choice-grid').getByRole('button', { name: /^Voitures/ }).click();
    const select = page.getByLabel('Type de voiture', { exact: true });
    assert.equal(await select.inputValue(), 'auto');
    assert.deepEqual(await select.locator('option').evaluateAll(options => options.map(x => x.value)), types);
    for (const type of types) { await select.selectOption(type); assert.equal(await select.inputValue(), type); }
    await page.locator('.publisher-choice-grid').getByRole('button', { name: /^Matinale/ }).click();
    await page.locator('.publisher-choice-grid').getByRole('button', { name: /^Élégant/ }).click();
    await select.selectOption('convertible');
    for (const label of [/^Paysages/, /^Immobilier/, /^Bateaux/]) {
      await page.locator('.publisher-choice-grid').getByRole('button', { name: label }).click();
      assert.equal(await page.locator('#publisher-car-type').count(), 0);
      assert.equal(await page.locator('.publisher-choice-group').nth(1).locator('[aria-pressed=true]').count(), 1);
      assert.equal(await page.locator('.publisher-choice-group').nth(2).locator('[aria-pressed=true]').count(), 1);
    }
    await page.locator('.publisher-choice-grid').getByRole('button', { name: /^Voitures/ }).click();
    assert.equal(await select.inputValue(), 'convertible');
    assert.equal(mutations.length, n); assert.equal(trace().length, paid);
    await page.screenshot({ path: `${output}/desktop-fr.png`, fullPage: true });
  });
  await check('existing CRM language switch translates all car labels and retains exact type/moment/style', async () => {
    const n = mutations.length, paid = trace().length;
    await page.getByRole('button', { name: 'English — EN', exact: true }).first().click();
    const select = page.getByLabel('Car type', { exact: true });
    assert.equal(await select.inputValue(), 'convertible');
    assert.deepEqual(await select.locator('option').allTextContents(), ['Any type','SUV','Saloon','Coupé / GT','Sports car','Convertible / Roadster','Supercar','Luxury van']);
    assert.equal(await page.locator('.publisher-choice-group').nth(1).locator('[aria-pressed=true]').count(), 1);
    assert.equal(await page.locator('.publisher-choice-group').nth(2).locator('[aria-pressed=true]').count(), 1);
    await page.screenshot({ path: `${output}/desktop-en.png`, fullPage: true });
    assert.equal(mutations.length, n); assert.equal(trace().length, paid);
  });
  await check('native keyboard selection preserves accessible label and does not create a request', async () => {
    const n = mutations.length;
    const select = page.getByLabel('Car type', { exact: true });
    // macOS native selects support type-ahead; ArrowDown opens an OS picker
    // whose arrow navigation is not exposed by headless Chromium.
    await select.selectOption('auto'); await select.focus(); await select.press('s'); await select.press('Enter');
    assert.equal(await select.inputValue(), 'suv'); await select.selectOption('convertible');
    assert.equal(mutations.length, n);
  });
  await check('temporary access check failure restores same-account car draft and other choices', async () => {
    await page.route(`${fixture.auth}/auth/v1/user`, r => r.abort('failed'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('button', { name: /Retry verification|Réessayer la vérification/ }).waitFor();
    await page.unroute(`${fixture.auth}/auth/v1/user`);
    await page.getByRole('button', { name: /Retry verification|Réessayer la vérification/ }).click();
    await ready(page);
    assert.equal(await page.getByLabel('Car type', { exact: true }).inputValue(), 'convertible');
    assert.equal(await page.locator('.publisher-choice-grid [aria-pressed=true]').count(), 3);
  });
  await check('browser creation sends type and renders persisted model; text keeps selected music B', async () => {
    const response = page.waitForResponse(r => new URL(r.url()).searchParams.get('action') === 'generate' && r.request().method() === 'POST');
    await page.locator('.publisher-create-button').click(); const r = await response;
    assert.equal(r.status(), 200, await r.text()); created = (await r.json()).post;
    assert.equal(created.car_context.requestedType, 'convertible');
    await page.locator('.publisher-post').waitFor();
    await page.getByRole('button', { name: 'Français — FR', exact: true }).first().click();
    assert.match(await page.locator('.publisher-post .publisher-car-context').first().textContent(), /Modèle de référence/);
    await page.screenshot({ path: `${output}/result-fr.png`, fullPage: true });
    const music = page.locator('.publisher-music').nth(1).locator('.publisher-music-main'); await music.click();
    const text = page.waitForResponse(r => new URL(r.url()).searchParams.get('action') === 'regenerate-text');
    await page.getByRole('button', { name: 'Régénérer le texte', exact: true }).click();
    assert.equal((await text).status(), 200);
    await page.getByRole('button', { name: 'Régénérer le texte', exact: true }).waitFor();
    assert.equal(await music.getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('.publisher-post .publisher-car-context').first().textContent(), new RegExp(created.car_context.model));
  });
  await check('reload history reopens the saved reference and English display leaves caption unchanged', async () => {
    await page.reload(); await ready(page);
    await page.getByRole('button', { name: 'Historique', exact: true }).click();
    const row = page.locator('.publisher-history button').filter({ hasText: created.car_context.model }).first();
    await row.click(); await page.locator('.publisher-post').waitFor();
    await page.getByRole('button', { name: 'English — EN', exact: true }).first().click();
    assert.match(await page.locator('.publisher-post .publisher-car-context').first().textContent(), /Reference model/);
    await page.screenshot({ path: `${output}/result-en.png`, fullPage: true });
  });
  await check('mobile 320 and 430 retain menu touch targets and have no horizontal overflow', async () => {
    await newForm(page);
    for (const width of [320,430]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('.publisher-choice-grid').getByRole('button', { name: /^Cars/ }).click();
      const select = page.getByLabel('Car type', { exact: true }); await select.selectOption('luxury_van');
      assert.ok((await select.boundingBox()).height >= 44);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: `${output}/mobile-en-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1050 });
  });
  await check('confirmed rights reduction discards car draft; none cannot load its content', async () => {
    const permissions = `${directory}/permissions.json`;
    const original = JSON.parse((await import('node:fs')).readFileSync(permissions));
    writeFileSync(permissions, JSON.stringify({ ...original, editor: 'read' }));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('.publisher-permission-note').waitFor();
    await page.locator('.publisher-selector').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#publisher-car-type').count(), 0);
    writeFileSync(permissions, JSON.stringify(original));
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await ready(page);
  });
  }
  if (!process.argv.includes('--touch-only')) {
  await page.getByRole('button', { name: 'English — EN', exact: true }).first().click();
  await check('account change cannot carry car draft into the next account', async () => {
    await newForm(page); await page.locator('.publisher-choice-grid').getByRole('button', { name: /^Cars/ }).click();
    await page.getByLabel('Car type', { exact: true }).selectOption('supercar');
    await switchFixtureAccount(page, 'other');
    await page.waitForFunction(() => document.documentElement.lang === 'fr');
    await ready(page); await newForm(page);
    await page.locator('.publisher-choice-grid').getByRole('button', { name: /^Voitures/ }).click();
    assert.equal(await page.getByLabel('Type de voiture', { exact: true }).inputValue(), 'auto');
  });
  await check('a no-access account cannot mount the Publisher or recover another account draft', async () => {
    await switchFixtureAccount(page, 'none');
    await page.getByRole('heading', { name: /Aucun accès autorisé|No authorised access/ }).waitFor();
    assert.equal(await page.locator('#publisher-car-type').count(), 0);
    assert.equal(await page.locator('.publisher-post').count(), 0);
  });
  await check('no console crashes, external HTTP, publication or publish marking during demo', async () => {
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    assert.ok(mutations.every(x => !('musicId' in x)), 'No publish payload');
  });
  }
  // Actual mobile/touch browser context; native option assignment is automated,
  // not evidence of a physical handset's operating-system picker.
  const touch = await browser.newContext({ viewport: { width:390,height:844 }, isMobile: true, hasTouch: true });
  await touch.route('**/*', r => [fixture.app,fixture.auth].includes(new URL(r.request().url()).origin) ? r.continue() : r.abort());
  const touchPage = await touch.newPage();
  await check('Chromium touch viewport can tap cars and use the native select', async () => {
    await login(touchPage,'other'); await newForm(touchPage);
    await touchPage.locator('.publisher-choice-grid').getByRole('button', { name: /^Voitures/ }).tap();
    const select = touchPage.getByLabel('Type de voiture', { exact:true });
    await select.evaluate(element => element.scrollIntoView({block:'center'}));
    await select.tap(); await select.press('Escape'); await select.selectOption('suv');
    assert.equal(await select.inputValue(),'suv'); await touchPage.screenshot({path:`${output}/mobile-fr-touch.png`,fullPage:false});
  });
  await touch.close();
  let webkitStatus = 'not installed';
  try {
    const wk = await webkit.launch(); const wkContext = await wk.newContext({ viewport:{width:390,height:844},hasTouch:true });
    await wkContext.route('**/*', r => [fixture.app,fixture.auth].includes(new URL(r.request().url()).origin) ? r.continue() : r.abort());
    const wp = await wkContext.newPage();
    await check('WebKit mobile menu remains conditional and type persists through universe change', async()=>{
      await login(wp,'other'); await newForm(wp); await wp.locator('.publisher-choice-grid').getByRole('button',{name:/^Voitures/}).click();
      await wp.getByLabel('Type de voiture',{exact:true}).selectOption('coupe_gt');
      await wp.locator('.publisher-choice-grid').getByRole('button',{name:/^Paysages/}).click(); assert.equal(await wp.locator('#publisher-car-type').count(),0);
      await wp.locator('.publisher-choice-grid').getByRole('button',{name:/^Voitures/}).click(); assert.equal(await wp.getByLabel('Type de voiture',{exact:true}).inputValue(),'coupe_gt');
      await wp.screenshot({path:`${output}/webkit-mobile-fr.png`,fullPage:true});
    });
    webkitStatus='passed'; await wk.close();
  } catch(e) { if (!/Executable doesn't exist|browserType.launch/.test(String(e))) throw e; console.log('WebKit unavailable:',String(e).split('\n')[0]); }
  writeFileSync(`${directory}/browser-results.json`, JSON.stringify({ passed: checks.length, checks, errors, external, webkit:webkitStatus, paidCalls:0, postId:created?.id }, null,2));
} finally { await browser.close(); }
