import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { local, assertPublisherLocalTarget } from './local-target.mjs';

const status = JSON.parse(await readFile(`${local.directory}/local-status.private.json`, 'utf8'));
assertPublisherLocalTarget(status);
const fixtures = JSON.parse(await readFile(`${local.directory}/fixtures.private.json`, 'utf8'));
assert.equal(fixtures.app, local.app);
assert.equal(fixtures.api, local.api);
assert.equal(fixtures.simulatedExternalGeneration, true);
const runtime = process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium, webkit } = await import(pathToFileURL(runtime).href);
const root = path.resolve(import.meta.dirname, '../..');
const screenshots = path.join(root, 'docs/publisher/screenshots');
await mkdir(screenshots, { recursive: true });
const privateScreenshots = `${local.directory}/results/screenshots`;
await mkdir(privateScreenshots, { recursive: true });
const publishedScreenshots = new Set(['chromium-desktop-1440.png', 'chromium-plus-375.png', 'chromium-form-390.png', 'chromium-form-430.png', 'webkit-plus-390.png']);
const screenshotPath = name => `${publishedScreenshots.has(name) ? screenshots : privateScreenshots}/${name}`;
const results = [];
const browsers = process.env.PUBLISHER_BROWSER ? [process.env.PUBLISHER_BROWSER] : ['chromium', 'webkit'];
const timeout = 60000;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function check(name, run) {
  await run(); results.push({ name, passed: true }); console.log(`PASS ${name}`);
}
async function login(page, who, route = '/publisher') {
  await page.goto(`${local.app}${route}`);
  await page.getByLabel('Email', { exact: true }).fill(fixtures.users[who].email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(fixtures.users[who].password);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await page.locator('.crm-shell').waitFor();
}
async function publisherReady(page) {
  await page.getByRole('heading', { name: 'Instagram Publisher', exact: true }).waitFor();
  await page.locator('.publisher-loading').waitFor({ state: 'hidden' });
  await page.locator('.publisher-generation').waitFor({ state: 'hidden' });
}
async function choose(page) {
  for (const label of ['Paysages', 'Matinale', 'Élégant']) {
    await page.locator('.publisher-choice-grid').getByRole('button', { name: new RegExp(label) }).click();
  }
}
async function create(page) {
  if (await page.getByRole('button', { name: 'Nouvelle création', exact: true }).isVisible()) await page.getByRole('button', { name: 'Nouvelle création', exact: true }).click();
  await choose(page);
  const responsePromise = page.waitForResponse(r => new URL(r.url()).searchParams.get('action') === 'generate' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Créer la publication', exact: true }).click();
  const response = await responsePromise;
  assert.equal(response.status(), 200, await response.text());
  const result = await response.json();
  assert.equal(result.state, 'ready');
  await page.locator('.publisher-post').waitFor();
  return result.post;
}
async function logout(page) {
  if (await page.locator('#unified-more-trigger').isVisible()) {
    if (!(await page.getByRole('dialog', { name: 'Modules autorisés' }).isVisible())) await page.locator('#unified-more-trigger').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Déconnexion', exact: true }).click();
  } else await page.locator('.sidebar').getByRole('button', { name: 'Déconnexion', exact: true }).click();
  await page.getByRole('button', { name: 'Se connecter', exact: true }).waitFor();
}

for (const engine of browsers) {
  const browser = await (engine === 'chromium' ? chromium.launch({ channel: 'chrome' }) : webkit.launch());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  const network = [], crashes = [], external = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && ![new URL(local.app).origin, new URL(local.api).origin].includes(url.origin)) {
      external.push(`${url.origin}${url.pathname}`); return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  page.on('pageerror', error => crashes.push(error.message));
  page.on('dialog', dialog => void dialog.accept());
  page.on('request', request => network.push(request.url()));
  try {
    await check(`${engine}: CRM login / Publisher-only / direct reload`, async () => {
      await login(page, 'editor'); await publisherReady(page);
      await page.reload(); await publisherReady(page);
      assert.equal(await page.locator('[data-nextjs-dialog]').count(), 0);
      assert.equal(await page.locator('.sidebar .nav-button').count(), 1);
      assert(network.every(url => !/crm_workspace_state|crm_read_module|izord_projects|izord_read|\/storage\/v1/.test(url)), 'Publisher-only browser must not request global/OAR/IZORD payloads');
    });
    await check(`${engine}: direction draft survives temporary Auth failure`, async () => {
      if (await page.getByRole('button', { name: 'Nouvelle création', exact: true }).isVisible()) await page.getByRole('button', { name: 'Nouvelle création', exact: true }).click();
      await choose(page);
      await page.route(`${local.api}/auth/v1/user`, route => route.abort('failed'));
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.getByRole('button', { name: 'Réessayer la vérification', exact: true }).waitFor();
      await page.unroute(`${local.api}/auth/v1/user`);
      await page.getByRole('button', { name: 'Réessayer la vérification', exact: true }).click();
      await page.locator('.publisher-selector').waitFor();
      assert.equal(await page.locator('.publisher-choice-grid [aria-pressed="true"]').count(), 3);
    });
    let created;
    await check(`${engine}: complete simulated generation, music B survives text regeneration, publication marker`, async () => {
      created = await create(page);
      const musicB = page.locator('.publisher-music').nth(1);
      await musicB.locator('.publisher-music-main').click();
      assert.equal(await musicB.locator('.publisher-music-main').getAttribute('aria-pressed'), 'true');
      const textResponse = page.waitForResponse(r => new URL(r.url()).searchParams.get('action') === 'regenerate-text');
      await page.getByRole('button', { name: 'Régénérer le texte', exact: true }).click();
      assert.equal((await textResponse).status(), 200);
      await page.getByRole('button', { name: 'Régénérer le texte', exact: true }).waitFor({ state: 'visible' });
      assert.equal(await musicB.locator('.publisher-music-main').getAttribute('aria-pressed'), 'true');
      const publishResponse = page.waitForResponse(r => new URL(r.url()).searchParams.get('action') === 'publish');
      await page.getByRole('button', { name: 'Marquer comme publié', exact: true }).click();
      const response = await publishResponse;
      assert.equal(response.status(), 200);
      const result = await response.json();
      assert.equal(result.post.music_used_id, created.music[1].id);
      assert.equal(result.post.status, 'published');
      await page.getByRole('button', { name: 'Publication confirmée', exact: true }).waitFor();
      await page.locator('.publisher-visual img').waitFor();
      assert.match(await page.locator('.publisher-visual img').getAttribute('src'), /^blob:/);
      assert.equal(await page.locator('.publisher-visual img').evaluate(img => img.complete && img.naturalWidth > 0), true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: screenshotPath(`${engine}-desktop-1440.png`), fullPage: true });
    });
    await check(`${engine}: authorized media export preserves real MIME`, async () => {
      // The desktop browser download path is deterministic; optional native share is not invoked.
      await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }));
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      const result = await download;
      assert.match(result.suggestedFilename(), /\.(jpg|png|svg)$/);
      const bytes = await readFile(await result.path());
      if (result.suggestedFilename().endsWith('.svg')) assert.match(bytes.toString('utf8', 0, 120), /<svg/);
      if (result.suggestedFilename().endsWith('.jpg')) assert.equal(bytes.subarray(0, 2).toString('hex'), 'ffd8');
    });
    if (engine === 'chromium') {
      for (const action of ['export', 'export-text']) {
        await check(`chromium: late ${action} cannot download or copy after account change`, async () => {
          let downloads = 0, copies = 0;
          const observedDownload = () => { downloads += 1; };
          page.on('download', observedDownload);
          if (action === 'export-text') {
            // Observe delivery without reading or modifying the user's OS clipboard.
            await page.exposeFunction('__publisherCopied', () => { copies += 1; });
            await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => window.__publisherCopied() }));
          }
          let release, responseReady;
          const held = new Promise(resolve => { release = resolve; });
          const ready = new Promise(resolve => { responseReady = resolve; });
          const pattern = `${local.app}/api/publisher?action=${action}&id=*`;
          await page.route(pattern, async route => {
            const response = await route.fetch(); responseReady(); await held;
            await route.fulfill({ response }).catch(() => {});
          });
          await page.getByRole('button', { name: action === 'export' ? 'Enregistrer' : 'Copier', exact: true }).click();
          await ready; await logout(page); await login(page, 'none');
          await page.getByRole('heading', { name: 'Aucun accès autorisé', exact: true }).waitFor();
          release(); await page.unroute(pattern); await pause(400);
          assert.equal(downloads, 0); assert.equal(copies, 0);
          page.off('download', observedDownload);
          await logout(page); await login(page, 'editor'); await publisherReady(page);
          await page.getByRole('button', { name: 'Historique', exact: true }).click();
          await page.locator('.publisher-history-grid button').first().click();
        });
      }
    }
    for (const width of [375, 390, 430]) {
      await check(`${engine}: mobile ${width}px navigation Plus open and form`, async () => {
        await page.setViewportSize({ width, height: 844 });
        await page.locator('#unified-more-trigger').click();
        const dialog = page.getByRole('dialog', { name: 'Modules autorisés' });
        await dialog.waitFor();
        const label = dialog.locator('.unified-more-label', { hasText: 'Instagram Publisher' });
        assert.equal(await label.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: screenshotPath(`${engine}-plus-${width}.png`), fullPage: false });
        await dialog.getByRole('button', { name: 'Instagram Publisher', exact: true }).click();
        await publisherReady(page);
        await page.getByRole('button', { name: 'Nouvelle création', exact: true }).click();
        await choose(page);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        await page.evaluate(() => window.scrollTo(0, 0));
      if (width === 430) await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.screenshot({ path: screenshotPath(`${engine}-form-${width}.png`), fullPage: false });
        await page.getByRole('button', { name: 'Aujourd’hui', exact: true }).click(); await publisherReady(page);
        // Today may be empty when only guided posts exist: use the shared history.
        if (!(await page.locator('.publisher-post').isVisible())) {
          await page.getByRole('button', { name: 'Historique', exact: true }).click();
          await page.locator('.publisher-history-grid button').first().click();
        }
      });
    }
    await check(`${engine}: reader history is shared and sensitive commands disabled`, async () => {
      await logout(page); await login(page, 'reader'); await publisherReady(page);
      await page.getByRole('button', { name: 'Historique', exact: true }).click();
      await page.locator('.publisher-history-grid button').first().click();
      for (const name of ['Enregistrer', 'Nouvelle création', 'Régénérer le visuel', 'Régénérer le texte']) assert.equal(await page.getByRole('button', { name, exact: true }).isDisabled(), true);
      assert.equal(await page.locator('.publisher-music-main').first().isDisabled(), true);
      assert.equal(await page.locator('.publisher-copy-music').isDisabled(), true);
      await page.locator('.publisher-visual img').waitFor();
      assert.equal(await page.locator('.publisher-visual img').count(), 1);
    });
    await page.setViewportSize({ width: 1440, height: 1050 });
    await check(`${engine}: late real history response cannot reach next account in same context`, async () => {
      let release;
      const held = new Promise(resolve => { release = resolve; });
      let responseReady;
      const ready = new Promise(resolve => { responseReady = resolve; });
      const pattern = `${local.app}/api/publisher?action=history`;
      await page.route(pattern, async route => {
        const response = await route.fetch(); responseReady(); await held;
        await route.fulfill({ response }).catch(() => {});
      });
      await page.getByRole('button', { name: 'Historique', exact: true }).click();
      await ready;
      await logout(page);
      await login(page, 'none');
      await page.getByRole('heading', { name: 'Aucun accès autorisé', exact: true }).waitFor();
      release(); await page.unroute(pattern); await pause(400);
      assert.equal(await page.locator('.publisher-root, .publisher-caption, .publisher-visual').count(), 0);
    });
    await logout(page);
    if (engine === 'chromium') {
      await check('chromium: existing Administration matrix saves Publisher-only explicit sensitive rights', async () => {
        await login(page, 'admin', '/admin');
        await page.getByRole('heading', { name: 'Utilisateurs et accès', exact: true }).waitFor();
        await page.getByRole('button', { name: new RegExp(fixtures.users.matrix.email) }).click();
        const row = page.getByRole('row').filter({ has: page.getByText('Instagram Publisher', { exact: true }) });
        const originalLevel = await row.getByLabel('Droit Instagram Publisher', { exact: true }).inputValue();
        const sensitiveLabels = ['Générer / régénérer', 'Export et téléchargement', 'Marquer comme publié'];
        const originalSensitive = await Promise.all(sensitiveLabels.map(label => row.getByLabel(label, { exact: true }).isChecked()));
        await row.getByLabel('Droit Instagram Publisher', { exact: true }).selectOption('contribute');
        for (const label of sensitiveLabels) await row.getByLabel(label, { exact: true }).check();
        const saveResponse = page.waitForResponse(response => response.url().endsWith('/rest/v1/rpc/crm_admin_save'));
        await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
        assert.equal((await saveResponse).status(), 200);
        await page.getByText('Droits enregistrés et confirmés par le serveur.', { exact: true }).waitFor();
        await page.screenshot({ path: `${privateScreenshots}/chromium-admin-permissions.png`, fullPage: true });
        await row.getByLabel('Droit Instagram Publisher', { exact: true }).selectOption(originalLevel);
        for (const [index, label] of sensitiveLabels.entries()) if (originalSensitive[index]) await row.getByLabel(label, { exact: true }).check();
        const restoreResponse = page.waitForResponse(response => response.url().endsWith('/rest/v1/rpc/crm_admin_save'));
        await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
        assert.equal((await restoreResponse).status(), 200);
      });
      await check('chromium: complete common mobile menu orders IZORD, Publisher, Administration at 375px', async () => {
        await page.setViewportSize({ width: 375, height: 844 });
        await page.locator('#unified-more-trigger').click();
        const dialog = page.getByRole('dialog', { name: 'Modules autorisés' });
        const labels = await dialog.locator('.unified-more-label').allTextContents();
        const index = labels.indexOf('Instagram Publisher');
        assert.equal(labels[index - 1], 'IZORD Invest');
        assert.equal(labels[index + 1], 'Administration');
        await dialog.locator('.unified-more-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
        for (const name of ['IZORD Invest', 'Instagram Publisher', 'Administration']) {
          const item = dialog.getByRole('button', { name, exact: true });
          const rect = await item.boundingBox();
          assert(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 375 && rect.y + rect.height <= 844);
        }
        await page.screenshot({ path: screenshotPath('chromium-plus-375.png'), fullPage: false });
      });
    }
    assert.deepEqual(crashes, [], `${engine} browser runtime errors`);
    assert.deepEqual(external, [], `${engine} unexpected external requests`);
  } catch (error) {
    await page.screenshot({ path: `${local.directory}/results/${engine}-failure.png`, fullPage: true }).catch(() => {});
    await writeFile(`${local.directory}/results/${engine}-failure.txt`, await page.locator('body').innerText().catch(() => ''), { mode: 0o600 });
    throw error;
  } finally { await context.close(); await browser.close(); }
}
await writeFile(`${local.directory}/results/browser.json`, JSON.stringify({ generatedAt: new Date().toISOString(), simulatedExternalGeneration: true, results }, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ passed: results.length, screenshots }));
