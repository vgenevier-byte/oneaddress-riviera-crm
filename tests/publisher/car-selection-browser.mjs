/** Integrated CRM browser demo. Real Publisher API and PostgreSQL, fake Auth/providers. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { directory, fixture, trace } from './car-selection-local.mjs';
const { chromium, webkit } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const output = new URL('../../docs/publisher/car-selection/screenshots/', import.meta.url).pathname;
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
const acceptDialog = d => void d.accept();
page.on('pageerror', e => errors.push(e.message)); page.on('dialog', acceptDialog);
let created;
try {
  await login(page, 'editor');
  if (!process.argv.includes('--from-accounts') && !process.argv.includes('--touch-only')) {
  await check('three native menus appear only for cars; defaults and verified options; menu changes never generate', async () => {
    await newForm(page);
    const n = mutations.length, paid = trace().length;
    assert.equal(await page.locator('#publisher-car-type').count(), 0);
    await page.locator('.publisher-choice-grid').getByRole('button', { name: /^Voitures/ }).click();
    const select = page.getByLabel('Type de voiture', { exact: true });
    assert.equal(await select.inputValue(), 'auto');
    const brand = page.getByLabel('Marque', { exact: true }), model = page.getByLabel('Modèle', { exact: true });
    assert.equal(await brand.inputValue(), 'auto'); assert.equal(await model.inputValue(), 'auto');
    assert.equal(await model.isDisabled(), true);
    assert.deepEqual(await brand.locator('option').evaluateAll(options => options.map(x => x.value)), ['auto', 'land-rover', 'porsche', 'bentley', 'lamborghini', 'mercedes-benz']);
    assert.deepEqual(await select.locator('option').evaluateAll(options => options.map(x => x.value)), types);
    for (const type of types) { await select.selectOption(type); assert.equal(await select.inputValue(), type); }
    await page.locator('.publisher-choice-grid').getByRole('button', { name: /^Matinale/ }).click();
    await page.locator('.publisher-choice-grid').getByRole('button', { name: /^Élégant/ }).click();
    await select.selectOption('suv');
    assert.deepEqual(await brand.locator('option').evaluateAll(options => options.map(x => x.value)), ['auto', 'land-rover']);
    await brand.selectOption('land-rover'); assert.equal(await model.isDisabled(), false);
    await model.selectOption('range-rover-l460-swb-se');
    for (const label of [/^Paysages/, /^Immobilier/, /^Bateaux/]) {
      await page.locator('.publisher-choice-grid').getByRole('button', { name: label }).click();
      assert.equal(await page.locator('#publisher-car-type').count(), 0);
      assert.equal(await page.locator('#publisher-car-brand, #publisher-car-model').count(), 0);
      assert.equal(await page.locator('.publisher-choice-group').nth(1).locator('[aria-pressed=true]').count(), 1);
      assert.equal(await page.locator('.publisher-choice-group').nth(2).locator('[aria-pressed=true]').count(), 1);
    }
    await page.locator('.publisher-choice-grid').getByRole('button', { name: /^Voitures/ }).click();
    assert.equal(await select.inputValue(), 'suv'); assert.equal(await brand.inputValue(), 'land-rover');
    assert.equal(await model.inputValue(), 'range-rover-l460-swb-se');
    assert.equal(mutations.length, n); assert.equal(trace().length, paid);
    await page.screenshot({ path: `${output}/desktop-fr.png`, fullPage: true });
  });
  await check('compatible type changes retain brand/model and only incompatible values reset with an accessible explanation', async () => {
    const n = mutations.length, paid = trace().length;
    const type = page.getByLabel('Type de voiture', { exact: true }), brand = page.getByLabel('Marque', { exact: true }), model = page.getByLabel('Modèle', { exact: true });
    await type.selectOption('sports_car'); await brand.selectOption('porsche'); await model.selectOption('porsche-911-carrera-coupe-2024');
    await type.selectOption('coupe_gt');
    assert.equal(await brand.inputValue(), 'porsche'); assert.equal(await model.inputValue(), 'porsche-911-carrera-coupe-2024');
    await type.selectOption('convertible');
    assert.equal(await brand.inputValue(), 'porsche'); assert.equal(await model.inputValue(), 'auto');
    assert.match(await page.locator('.publisher-car-type [role=status]').textContent(), /Le modèle n’est plus compatible/);
    await model.selectOption('porsche-911-carrera-cabriolet-2024');
    await brand.selectOption('bentley');
    assert.equal(await model.inputValue(), 'auto'); assert.equal(await brand.inputValue(), 'bentley');
    await model.selectOption('bentley-continental-gtc-speed-gen4');
    await type.selectOption('suv');
    assert.equal(await brand.inputValue(), 'auto'); assert.equal(await model.inputValue(), 'auto'); assert.equal(await model.isDisabled(), true);
    assert.match(await page.locator('.publisher-car-type [role=status]').textContent(), /La marque et le modèle/);
    await brand.selectOption('land-rover'); await model.selectOption('range-rover-l460-swb-se');
    assert.match(await model.locator('option:checked').textContent(), /empattement standard.*L460/);
    assert.match(await page.locator('#publisher-car-selected-model').textContent(), /empattement standard.*L460/);
    assert.equal(mutations.length, n); assert.equal(trace().length, paid);
    await page.screenshot({ path: `${output}/desktop-fr.png`, fullPage: true });
  });
  await check('existing CRM language switch translates all three car menus and retains exact choices/moment/style', async () => {
    const n = mutations.length, paid = trace().length;
    await page.getByRole('button', { name: 'English — EN', exact: true }).first().click();
    const select = page.getByLabel('Car type', { exact: true });
    assert.equal(await select.inputValue(), 'suv');
    assert.equal(await page.getByLabel('Brand', { exact: true }).inputValue(), 'land-rover');
    const model = page.getByLabel('Model', { exact: true });
    assert.equal(await model.inputValue(), 'range-rover-l460-swb-se');
    assert.match(await model.locator('option:checked').textContent(), /standard wheelbase.*L460/);
    assert.match(await page.locator('#publisher-car-selected-model').textContent(), /standard wheelbase.*L460/);
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
    assert.equal(await select.inputValue(), 'suv');
    assert.equal(await page.getByLabel('Brand', { exact: true }).inputValue(), 'land-rover');
    assert.equal(await page.getByLabel('Model', { exact: true }).inputValue(), 'range-rover-l460-swb-se');
    assert.equal(mutations.length, n);
  });
  await check('cancelled CRM sign-out preserves the selected type, brand and model without a provider request', async () => {
    const n = mutations.length, paid = trace().length;
    page.off('dialog', acceptDialog);
    const dialog = page.waitForEvent('dialog').then(async dialog => { assert.equal(dialog.type(), 'confirm'); await dialog.dismiss(); });
    await page.getByRole('button', { name: /^(Sign out|Se déconnecter)$/ }).first().click(); await dialog;
    page.on('dialog', acceptDialog);
    await ready(page);
    assert.equal(await page.getByLabel('Car type', { exact: true }).inputValue(), 'suv');
    assert.equal(await page.getByLabel('Brand', { exact: true }).inputValue(), 'land-rover');
    assert.equal(await page.getByLabel('Model', { exact: true }).inputValue(), 'range-rover-l460-swb-se');
    assert.equal(mutations.length, n); assert.equal(trace().length, paid);
  });
  await check('temporary access check failure restores same-account car draft and other choices', async () => {
    await page.route(`${fixture.auth}/auth/v1/user`, r => r.abort('failed'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('button', { name: /Retry verification|Réessayer la vérification/ }).waitFor();
    await page.unroute(`${fixture.auth}/auth/v1/user`);
    await page.getByRole('button', { name: /Retry verification|Réessayer la vérification/ }).click();
    await ready(page);
    assert.equal(await page.getByLabel('Car type', { exact: true }).inputValue(), 'suv');
    assert.equal(await page.getByLabel('Brand', { exact: true }).inputValue(), 'land-rover');
    assert.equal(await page.getByLabel('Model', { exact: true }).inputValue(), 'range-rover-l460-swb-se');
    assert.equal(await page.locator('.publisher-choice-grid [aria-pressed=true]').count(), 3);
  });
  await check('a simulated strict validation 400 has a clear FR/EN error, preserves selections and makes no provider call', async () => {
    const paid = trace().length;
    const url = `${fixture.app}/api/publisher?action=generate`;
    let rejected = 0;
    await page.route(url, async route => {
      rejected += 1;
      await route.fulfill({ status: 400, json: { error: 'Le modèle choisi est incompatible avec le type de voiture ou la marque.', terminal: true } });
    });
    await page.getByRole('button', { name: 'Français — FR', exact: true }).first().click();
    await page.locator('.publisher-create-button').click();
    const alert = page.locator('.publisher-alert');
    await alert.getByText(/Le modèle choisi est incompatible/).waitFor();
    assert.equal(rejected, 1); assert.equal(trace().length, paid);
    await page.getByRole('button', { name: 'English — EN', exact: true }).first().click();
    assert.match(await alert.textContent(), /The selected model is incompatible with the car type or brand/);
    await page.getByRole('button', { name: 'Prepare a new attempt', exact: true }).click();
    await page.unroute(url);
    await page.locator('.publisher-selector').waitFor();
    assert.equal(await page.getByLabel('Car type', { exact: true }).inputValue(), 'suv');
    assert.equal(await page.getByLabel('Brand', { exact: true }).inputValue(), 'land-rover');
    assert.equal(await page.getByLabel('Model', { exact: true }).inputValue(), 'range-rover-l460-swb-se');
    assert.equal(trace().length, paid);
  });
  await check('browser creation sends all requested choices and renders the persisted reference; text keeps image/reference/music B', async () => {
    const response = page.waitForResponse(r => new URL(r.url()).searchParams.get('action') === 'generate' && r.request().method() === 'POST');
    await page.locator('.publisher-create-button').click(); const r = await response;
    assert.equal(r.status(), 200, await r.text()); created = (await r.json()).post;
    assert.equal(created.car_context.requestedType, 'suv');
    assert.equal(created.car_context.requestedBrand, 'land-rover'); assert.equal(created.car_context.requestedModel, 'range-rover-l460-swb-se');
    assert.equal(created.car_context.referenceId, 'range-rover-l460-swb-se');
    const sent = mutations.find(body => body.requestId && body.direction?.carModel === 'range-rover-l460-swb-se');
    assert.deepEqual(sent.direction, { universe: 'cars', moment: 'morning', style: 'elegant', carType: 'suv', carBrand: 'land-rover', carModel: 'range-rover-l460-swb-se' });
    await page.locator('.publisher-post').waitFor();
    await page.getByRole('button', { name: 'Français — FR', exact: true }).first().click();
    assert.match(await page.locator('.publisher-post .publisher-car-context').first().textContent(), /Modèle de référence/);
    await page.screenshot({ path: `${output}/result-fr.png`, fullPage: true });
    const music = page.locator('.publisher-music').nth(1).locator('.publisher-music-main'); await music.click();
    const text = page.waitForResponse(r => new URL(r.url()).searchParams.get('action') === 'regenerate-text');
    await page.getByRole('button', { name: 'Régénérer le texte', exact: true }).click();
    const textResponse = await text; assert.equal(textResponse.status(), 200);
    const regenerated = (await textResponse.json()).post;
    assert.deepEqual(regenerated.car_context, created.car_context); assert.equal(regenerated.image_src, created.image_src);
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
    assert.match(await page.locator('.publisher-post .publisher-car-context').first().textContent(), /Requested choices — Brand: Land Rover/);
    await page.screenshot({ path: `${output}/result-en.png`, fullPage: true });
  });
  await check('mobile 320 and 430 retain menu touch targets and have no horizontal overflow', async () => {
    await newForm(page);
    for (const width of [320,430]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('.publisher-choice-grid').getByRole('button', { name: /^Cars/ }).click();
      const select = page.getByLabel('Car type', { exact: true }); await select.selectOption('luxury_van');
      const brand = page.getByLabel('Brand', { exact: true }), model = page.getByLabel('Model', { exact: true });
      await brand.selectOption('mercedes-benz'); await model.selectOption('mercedes-v-class-avantgarde-2024');
      assert.match(await page.locator('#publisher-car-selected-model').textContent(), /Long van.*V447 facelift/);
      for (const menu of [select, brand, model]) assert.ok((await menu.boundingBox()).height >= 44);
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
    await page.getByLabel('Brand', { exact: true }).selectOption('lamborghini');
    await page.getByLabel('Model', { exact: true }).selectOption('lamborghini-huracan-evo-coupe-2019');
    await switchFixtureAccount(page, 'other');
    await page.waitForFunction(() => document.documentElement.lang === 'fr');
    await ready(page); await newForm(page);
    await page.locator('.publisher-choice-grid').getByRole('button', { name: /^Voitures/ }).click();
    assert.equal(await page.getByLabel('Type de voiture', { exact: true }).inputValue(), 'auto');
    assert.equal(await page.getByLabel('Marque', { exact: true }).inputValue(), 'auto');
    assert.equal(await page.getByLabel('Modèle', { exact: true }).inputValue(), 'auto');
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
    const brand = touchPage.getByLabel('Marque', { exact:true }), model = touchPage.getByLabel('Modèle', { exact:true });
    await brand.selectOption('land-rover'); await model.selectOption('range-rover-l460-swb-se');
    for (const menu of [select, brand, model]) assert.ok((await menu.boundingBox()).height >= 44);
    assert.equal(await select.inputValue(),'suv'); assert.equal(await model.inputValue(),'range-rover-l460-swb-se');
    assert.equal(await touchPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await touchPage.screenshot({path:`${output}/mobile-fr-touch.png`,fullPage:true});
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
