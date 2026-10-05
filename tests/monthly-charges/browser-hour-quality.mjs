/** Targeted presentation regression. Real fictitious local Auth and read RPC;
 * synthetic hours are injected in the browser projection only, never in SQL.
 * This is evidence for the quality counter/details, not server authorization.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, sql, read, login, directory } from './server-local.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fixture = JSON.parse(readFileSync(join(directory, 'fixtures.private.json'), 'utf8'));
const app = 'http://127.0.0.1:3183';
assert.equal(fixture.app, app);

const hourFixtures = [
  { id: 'quality-valid', personLabel: 'Minutes valides', date: '2026-09-15', startTime: '08:07', endTime: '12:42', breakMinutes: 0, hourlyRate: 20 },
  { id: 'quality-rate-precision', personLabel: 'Minutes et taux atypique', date: '2026-09-15', startTime: '08:07', endTime: '12:42', breakMinutes: 0, hourlyRate: 20.005 },
  { id: 'quality-date', personLabel: 'Minutes et date invalide', date: '2026-02-30', startTime: '08:07', endTime: '12:42', breakMinutes: 0, hourlyRate: 20 },
  { id: 'quality-time', personLabel: 'Horaire invalide', date: '2026-09-15', startTime: '25:00', endTime: '12:42', breakMinutes: 0, hourlyRate: 20 },
  { id: 'quality-pause', personLabel: 'Pause invalide', date: '2026-09-15', startTime: '08:07', endTime: '12:42', breakMinutes: -1, hourlyRate: 20 },
  { id: 'quality-rate', personLabel: 'Taux invalide', date: '2026-09-15', startTime: '08:07', endTime: '12:42', breakMinutes: 0, hourlyRate: '' }
].map(row => ({ ...row, personId: `worker-${row.id}`, houseId: 'quality-house', houseName: 'Maison fictive qualité' }));

function projectedHours(snapshot) {
  return {
    ...snapshot,
    permissions: { ...snapshot.permissions, readableSources: ['hours'], exportableSources: ['hours'] },
    config: { personRules: hourFixtures.map(row => ({ source: 'hours', personId: row.personId, included: true })), exceptions: [], attachments: [] },
    sources: {
      invoices: [], suppliers: [], timeEntries: structuredClone(hourFixtures),
      workers: hourFixtures.map(row => ({ id: row.personId, label: row.personLabel, status: 'Actif' })),
      houses: [{ id: 'quality-house', name: 'Maison fictive qualité' }]
    }
  };
}

await connect();
const before = (await sql.query(`select
  (select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera') as source,
  (select jsonb_build_object('config',config,'revision',revision) from app_private.monthly_charges_config) as config,
  (select coalesce(jsonb_agg(to_jsonb(g) order by g.user_id,g.module),'[]'::jsonb) from public.crm_module_grants g) as grants`)).rows[0];
const token = await login(fixture.users.owner);
const realSnapshot = await read(token);
assert.equal(realSnapshot.status, 200, 'Read-only monthly RPC accepts the real local JWT');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
const blocked = [], errors = [], mutations = [], requests = [];
let projectedReads = 0;
await context.route('**/*', route => {
  const request = route.request(), url = new URL(request.url());
  requests.push(url.pathname);
  const local = ['data:', 'blob:'].includes(url.protocol) || ['http:', 'ws:'].includes(url.protocol) && url.hostname === '127.0.0.1' && ['3183', '55631'].includes(url.port);
  if (!local) { blocked.push(url.origin); return route.abort(); }
  if (url.pathname.startsWith('/rest/v1/') && request.method() !== 'GET' && !['/rest/v1/rpc/crm_access_snapshot', '/rest/v1/rpc/crm_read_monthly_charges'].includes(url.pathname)) {
    mutations.push(url.pathname); return route.abort();
  }
  return route.continue();
});
await context.route('**/rest/v1/rpc/crm_read_monthly_charges', async route => {
  const response = await route.fetch();
  assert.equal(response.status(), 200, 'Real local JWT-backed RPC remains readable');
  projectedReads++;
  await route.fulfill({ response, json: projectedHours(await response.json()) });
});

let result;
try {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(app + '/charges');
  await page.getByLabel('Email', { exact: true }).fill(fixture.users.owner.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(fixture.users.owner.password);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await page.getByRole('region', { name: 'Tableau annuel des charges, défilement horizontal' }).waitFor({ timeout: 45000 });
  await page.getByRole('button', { name: 'Afficher septembre 2026', exact: true }).click();
  const detail = page.locator('section').filter({ has: page.locator('#monthly-detail-title') }).last();
  const valid = detail.locator('article').filter({ hasText: 'Minutes valides' });
  assert.equal(await valid.count(), 1, 'A valid minute-granularity historical entry is counted once');
  assert.match(await valid.innerText(), /91,67/);
  assert.ok(!/Horaires historiques hors quarts|quarts d’heure/.test(await valid.innerText()), 'Valid minute precision adds no issue');

  const quality = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Données à vérifier/ }) });
  assert.equal((await quality.locator('summary').innerText()).trim(), 'Données à vérifier · 5', 'Counter omits only the valid historical minute row');
  await quality.locator('summary').click();
  assert.equal(await quality.locator('article').count(), 5);
  assert.equal(await quality.locator('article').filter({ hasText: 'Minutes valides' }).count(), 0);
  const expectedMotifs = [
    ['Minutes et taux atypique', 'Taux avec précision atypique'],
    ['Minutes et date invalide', 'Date d’intervention manquante ou invalide'],
    ['Horaire invalide', 'Horaires manquants ou invalides'],
    ['Pause invalide', 'Pause manquante ou invalide'],
    ['Taux invalide', 'Taux enregistré sur la ligne manquant ou invalide']
  ];
  for (const [label, motif] of expectedMotifs) {
    const card = quality.locator('article').filter({ hasText: label });
    assert.equal(await card.count(), 1, `${label} remains signaled`);
    assert.ok((await card.innerText()).includes(motif), `${label}: the actual remaining reason is shown`);
    assert.ok(!(await card.innerText()).includes('Horaires historiques hors quarts'), 'Removed historical-quarter warning is never shown');
  }
  assert.deepEqual(blocked, [], 'No remote network target');
  assert.deepEqual(mutations, [], 'No source/config/grant/selection mutation request');
  assert.deepEqual(errors, [], 'No browser error');
  assert.ok(projectedReads > 0);
  assert.ok(!requests.includes('/rest/v1/crm_workspace_state'), 'The browser never requests the global payload');
  result = { passed: true, qualityCount: 5, validMinuteCost: '91,67', actualRemainingMotifs: expectedMotifs.map(row => row[1]), realLocalAuth: true, realReadRpc: true, browserProjectionFixture: true, sourceConfigGrantWrites: false, remoteAccess: false };
  console.log('PASS targeted historical-minute quality counter/details: valid omitted; rate/date/time/pause/rate issues retained');
} finally {
  await context.close(); await browser.close();
  const after = (await sql.query(`select
    (select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera') as source,
    (select jsonb_build_object('config',config,'revision',revision) from app_private.monthly_charges_config) as config,
    (select coalesce(jsonb_agg(to_jsonb(g) order by g.user_id,g.module),'[]'::jsonb) from public.crm_module_grants g) as grants`)).rows[0];
  assert.deepEqual(after, before, 'All fictional sources, config/revision and grants are unchanged');
  await sql.end();
  if (result) writeFileSync(join(directory, 'browser-hour-quality-results.json'), JSON.stringify({ ...result, sourceConfigGrantsPreserved: true }, null, 2), { mode: 0o600 });
}
