/** Local catalogue UI checks. Fictitious Auth, read-only Publisher requests, no generation. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { directory, fixture, trace } from './car-selection-local.mjs';
import { CAR_CATALOGUE, CAR_TYPES, availableCarBrands, availableCarModels } from '../../lib/publisher/carSelection.js';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const output = '/Users/vg/.codex/visualizations/2026/10/21/01a15ec3-4e1e-7ba3-9235-7d27720d6f2b/publisher-catalogue/screenshots';
const messages = readFileSync(new URL('../../lib/i18n/catalogs/specialist.ts', import.meta.url), 'utf8');
const labels = new Map([...messages.matchAll(/"publisher\.car\.model\.([^"]+)"\s*:\s*(\{\s*"fr"\s*:\s*"(?:[^"\\]|\\.)*"\s*,\s*"en"\s*:\s*"(?:[^"\\]|\\.)*"\s*\})/g)].map(([, id, translations]) => [id, JSON.parse(translations)]));
const checks = [], pageErrors = [], blockedExternal = [], publisherPosts = [];
const brands = availableCarBrands('auto');
const origins = new Set([fixture.app, fixture.auth]);
const inspectedBrands = ['ferrari', 'bentley', 'rolls-royce'];
const selectedIds = {
  ferrari: 'ferrari-296-gtb-coupe-2021',
  bentley: 'bentley-continental-gt-speed-gen4',
  'rolls-royce': 'rolls-royce-ghost-series-ii-2024',
};
const beforeTrace = trace();
const check = async (name, run) => { await run(); checks.push(name); console.log('PASS ' + name); };
const values = menu => menu.locator('option').evaluateAll(options => options.map(option => option.value));
const menus = page => ({ type: page.locator('#publisher-car-type'), brand: page.locator('#publisher-car-brand'), model: page.locator('#publisher-car-model') });

function assertNoSideEffects() {
  assert.deepEqual(publisherPosts, [], 'Catalogue interaction must never POST to Publisher');
  assert.deepEqual(blockedExternal, [], 'The browser must only request the local app and fictitious Auth');
  assert.deepEqual(trace(), beforeTrace, 'Provider trace must remain unchanged throughout catalogue checks');
}

async function changeLanguage(page, language) {
  const htmlLanguage = language === 'en' ? 'en-GB' : 'fr';
  if (await page.evaluate(() => document.documentElement.lang) === htmlLanguage) return;
  const name = language === 'en' ? 'English — EN' : 'Français — FR';
  const visibleSelector = page.locator('[data-language-selector]:visible');
  const mobilePanelNeeded = await visibleSelector.count() === 0;
  if (mobilePanelNeeded) await page.locator('#unified-more-trigger').click();
  await page.locator('[data-language-selector]:visible').getByRole('button', { name, exact: true }).first().click();
  await page.waitForFunction(expected => document.documentElement.lang === expected, htmlLanguage);
  if (mobilePanelNeeded) await page.locator('#unified-more-panel .unified-more-close').click();
}

async function enterCars(page) {
  await page.goto(`${fixture.app}/publisher`);
  await page.locator('input[type=email]').fill(fixture.users.editor.email);
  await page.locator('input[type=password]').fill(fixture.users.editor.password);
  await page.getByRole('button', { name: /Se connecter|Sign in/, exact: true }).click();
  await page.getByRole('heading', { name: 'Instagram Publisher', exact: true }).waitFor();
  await page.locator('.publisher-loading').waitFor({ state: 'hidden' });
  const create = page.getByRole('button', { name: /^(Nouvelle création|New creation)$/ });
  await page.locator('.publisher-selector').or(create).first().waitFor();
  if (await create.isVisible()) await create.click();
  await page.locator('.publisher-selector').waitFor();
  await changeLanguage(page, 'fr');
  await page.locator('.publisher-choice-grid').getByRole('button', { name: /^Voitures/ }).click();
  await page.getByLabel('Type de voiture', { exact: true }).waitFor();
}

async function assertModelOptions(page, type, brand, language) {
  const expected = availableCarModels(type, brand);
  const model = menus(page).model;
  assert.deepEqual(await values(model), ['auto', ...expected.map(reference => reference.id)]);
  assert.deepEqual(await model.locator('option').allTextContents(), [language === 'fr' ? 'Au choix' : 'Any model', ...expected.map(reference => labels.get(reference.id)[language])]);
  return expected;
}

async function assertSelected(page, brand, modelId, language) {
  const menu = menus(page);
  assert.equal(await menu.type.inputValue(), 'auto');
  assert.equal(await menu.brand.inputValue(), brand);
  assert.equal(await menu.model.inputValue(), modelId);
  const expectedLabel = labels.get(modelId)[language];
  assert.equal(await menu.model.locator('option:checked').textContent(), expectedLabel);
  assert.equal(await page.locator('#publisher-car-selected-model').textContent(), expectedLabel);
  assert.equal(await menu.model.getAttribute('aria-describedby'), 'publisher-car-model-hint publisher-car-selected-model');
  await page.getByLabel(language === 'fr' ? 'Modèle' : 'Model', { exact: true }).waitFor();
}

async function inspectViewport(page, device) {
  const menu = menus(page);
  await check(`${device}: 20 brands plus automatic choice and all 79 models match the helpers`, async () => {
    assert.equal(await menu.type.inputValue(), 'auto');
    assert.deepEqual(await values(menu.type), [...CAR_TYPES]);
    assert.deepEqual(await values(menu.brand), ['auto', ...brands.map(brand => brand.id)]);
    assert.equal(await menu.brand.locator('option').count(), 21);
    assert.equal(await menu.model.isDisabled(), true);
    let modelCount = 0;
    for (const brand of brands) {
      await menu.brand.selectOption(brand.id);
      modelCount += (await assertModelOptions(page, 'auto', brand.id, 'fr')).length;
    }
    assert.equal(modelCount, 79);
    assertNoSideEffects();
  });

  await check(`${device}: every Ferrari, Bentley and Rolls-Royce option translates and exact selections survive FR/EN`, async () => {
    for (const brand of inspectedBrands) {
      await menu.type.selectOption('auto');
      await menu.brand.selectOption(brand);
      await assertModelOptions(page, 'auto', brand, 'fr');
      const modelId = selectedIds[brand];
      await menu.model.selectOption(modelId);
      await assertSelected(page, brand, modelId, 'fr');
      await changeLanguage(page, 'en');
      await assertModelOptions(page, 'auto', brand, 'en');
      await assertSelected(page, brand, modelId, 'en');
      await changeLanguage(page, 'fr');
      await assertSelected(page, brand, modelId, 'fr');
    }
    assertNoSideEffects();
  });

  await check(`${device}: all type filters expose exactly the compatible brand and model options`, async () => {
    for (const type of CAR_TYPES) {
      await menu.type.selectOption(type);
      const compatible = availableCarBrands(type);
      assert.deepEqual(await values(menu.brand), ['auto', ...compatible.map(brand => brand.id)]);
      for (const brand of inspectedBrands.filter(id => compatible.some(candidate => candidate.id === id))) {
        await menu.brand.selectOption(brand);
        await assertModelOptions(page, type, brand, 'fr');
      }
    }
    assertNoSideEffects();
  });

  await menu.type.selectOption('auto');
  await menu.brand.selectOption('rolls-royce');
  const longModel = availableCarModels('auto', 'rolls-royce').reduce((longest, current) => labels.get(current.id).fr.length > labels.get(longest.id).fr.length ? current : longest);
  await menu.model.selectOption(longModel.id);
  await check(`${device}: selected model remains readable in FR and EN with no horizontal overflow`, async () => {
    for (const language of ['fr', 'en']) {
      await changeLanguage(page, language);
      await assertSelected(page, 'rolls-royce', longModel.id, language);
      for (const control of Object.values(menu)) {
        const bounds = await control.boundingBox();
        assert.ok(bounds && bounds.height >= 44, 'Native select touch target is at least 44px high');
      }
      const layout = await page.locator('#publisher-car-selected-model').evaluate(element => {
        const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
        return {
          pageFits: document.documentElement.scrollWidth <= innerWidth,
          textFits: element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight,
          left: rect.left, right: rect.right, width: innerWidth,
          height: rect.height, lineHeight: parseFloat(style.lineHeight), whiteSpace: style.whiteSpace,
        };
      });
      assert.equal(layout.pageFits, true, `${device}/${language}: no document overflow`);
      assert.equal(layout.textFits, true, `${device}/${language}: selected-model text is not clipped`);
      assert.ok(layout.left >= 0 && layout.right <= layout.width + 1);
      assert.notEqual(layout.whiteSpace, 'nowrap');
      if (device === 'mobile-320') assert.ok(layout.height >= layout.lineHeight * 2 - 1, 'Long model label wraps to multiple readable lines');
    }
    assertNoSideEffects();
  });
  await changeLanguage(page, device === 'desktop' ? 'fr' : 'en');
  await page.locator('.publisher-car-type').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/${device === 'desktop' ? 'desktop-fr' : 'mobile-en-320'}.png`, fullPage: true });
}

await check('local catalogue has exactly 79 unique references across 20 brands and complete FR/EN labels', async () => {
  assert.equal(CAR_CATALOGUE.length, 79);
  assert.equal(new Set(CAR_CATALOGUE.map(reference => reference.id)).size, 79);
  assert.equal(brands.length, 20);
  assert.equal(brands.reduce((count, brand) => count + availableCarModels('auto', brand.id).length, 0), 79);
  for (const reference of CAR_CATALOGUE) {
    assert.ok(labels.get(reference.id)?.fr && labels.get(reference.id)?.en, `Missing model translation: ${reference.id}`);
    for (const language of ['fr', 'en']) assert.ok(labels.get(reference.id)[language].includes(reference.manufacturer));
  }
});

mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const device of ['desktop', 'mobile-320']) {
    const context = await browser.newContext({ viewport: device === 'desktop' ? { width: 1440, height: 1050 } : { width: 320, height: 900 }, hasTouch: device === 'mobile-320' });
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (['http:', 'https:'].includes(url.protocol) && !origins.has(url.origin)) {
        blockedExternal.push({ origin: url.origin, path: url.pathname });
        return route.abort();
      }
      if (url.pathname === '/api/publisher' && request.method() === 'POST') {
        publisherPosts.push({ action: url.searchParams.get('action') });
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => pageErrors.push({ device, message: error.message }));
    try {
      await enterCars(page);
      await inspectViewport(page, device);
    } finally { await context.close(); }
  }
  assert.deepEqual(pageErrors, []);
  assertNoSideEffects();
  const result = { passed: checks.length, checks, references: CAR_CATALOGUE.length, brands: brands.length, publisherPosts, blockedExternal, pageErrors, providerCallsBefore: beforeTrace.length, providerCallsAfter: trace().length, providerCallDelta: 0, screenshots: 2, output, fixtureDirectory: directory, auth: 'normal login against fictitious local Auth', scope: 'local Chromium desktop and 320px touch emulation; no generation, regeneration or mark POST' };
  writeFileSync(`${output}/../browser.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
