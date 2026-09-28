/** Targeted real-product P1 test. Only external provider transport is simulated.
 * Auth outage is injected in the browser AFTER PostgreSQL admission, never by
 * holding the generate response. Production engine/API/Auth/RPC remain real.
 */
import './network-guard.cjs';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { local, status, Client, fixturePath, login as tokenLogin, appRequest } from './local.mjs';
const before = process.argv.includes('--before');
const fixtures = JSON.parse(await readFile(fixturePath, 'utf8'));
const manifest = JSON.parse(await readFile(`${local.directory}/app.private.json`, 'utf8'));
assert.equal(manifest.fixtureAdapter?.name, 'recovery-provider-entry-v1', 'Launch serve.mjs --recovery-probe');
const { chromium, webkit } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const db = new Client({ connectionString: status.PUBLISHER_DATABASE_URL });
const crm = new Client({ connectionString: status.DB_URL });
await db.connect(); await crm.connect();
// Additional fictitious tracks keep the source 14-day music exclusion intact.
// Idempotent, fixed local fixtures: no deletion/reset of historical selections.
for (let i = 1; i <= 36; i++) {
  const title = `Reprise locale fictive ${String(i).padStart(2, '0')}`;
  await db.query('insert into publisher_music(id,title,artist,availability_status) values($1,$2,$3,$4) on conflict(id) do nothing', [900000 + i, title, 'Artiste fictif de démonstration', 'unknown']);
  assert.equal((await db.query('select title from publisher_music where id=$1', [900000 + i])).rows[0].title, title, 'Never overwrite an unrelated track');
}
const gatePath = `${local.directory}/recovery-control.txt`, tracePath = `${local.directory}/recovery-provider.jsonl`;
const providerControl = `${local.directory}/provider-control.txt`;
let actorName = 'admin', actor = fixtures.users.admin;
const prior = process.argv.includes('--remaining') ? JSON.parse(await readFile(`${local.directory}/results/recovery-after.json`, 'utf8')) : null;
if (prior) { assert.equal(before, false); assert.equal(prior.buildID, manifest.buildID, 'Resume only the same product build'); }
const results = prior?.results || [];
// Reuse the existing matrix fixture for WebKit, restoring its exact local grant.
// This leaves the demo editor's remaining quota untouched and never resets limits.
let matrixOriginal;
if (!before) {
  const id = fixtures.users.matrix.id;
  matrixOriginal = (await crm.query("select level,sensitive from crm_module_grants where user_id=$1 and module='publisher'", [id])).rows[0];
  assert(matrixOriginal, 'Existing fictitious matrix grant required');
  await crm.query("update crm_module_grants set level='contribute',sensitive=$2 where user_id=$1 and module='publisher'", [id, {generate:true,export:true,mark_published:true}]);
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const gate = value => writeFile(gatePath, value, { mode: 0o600 });
async function until(get, predicate, label) {
  for (let i = 0; i < 200; i++) { const value = await get(); if (predicate(value)) return value; await pause(100); }
  throw new Error(`Timed out: ${label}`);
}
const operation = async id => (await db.query('select * from publisher_operations where request_id=$1', [id])).rows[0];
const counts = async () => Number((await db.query('select count(*) from publisher_operations where actor_id=$1', [actor.id])).rows[0].count);
const calls = async id => (await readFile(tracePath, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.requestId === id);
async function login(page, who = actorName) {
  await page.goto(`${local.app}/publisher`);
  await page.getByLabel('Email', { exact: true }).fill(fixtures.users[who].email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(fixtures.users[who].password);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await page.locator('.crm-shell').waitFor();
}
async function ready(page) {
  await page.getByRole('heading', { name: 'Instagram Publisher', exact: true }).waitFor();
  await page.locator('.publisher-loading, .publisher-generation').waitFor({ state: 'hidden' });
}
async function choose(page) {
  for (const label of ['Paysages', 'Matinale', 'Élégant']) await page.locator('.publisher-choice-grid').getByRole('button', { name: new RegExp(label) }).click();
}
async function guided(page) {
  await ready(page);
  if (!(await page.locator('.publisher-post').isVisible())) {
    await page.getByRole('button', { name: 'Historique', exact: true }).click();
    await page.locator('.publisher-history-grid button').first().click();
  }
  await page.getByRole('button', { name: 'Nouvelle création', exact: true }).click(); await choose(page);
}
async function outage(page) {
  await page.route(`${local.api}/auth/v1/user`, route => route.abort('failed'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('button', { name: 'Réessayer la vérification', exact: true }).waitFor();
  assert.equal(await page.locator('.publisher-root').count(), 0, 'Publisher actually unmounted');
}
async function restore(page) {
  await page.unroute(`${local.api}/auth/v1/user`);
  await page.getByRole('button', { name: 'Réessayer la vérification', exact: true }).click();
  await page.getByRole('heading', { name: 'Instagram Publisher', exact: true }).waitFor();
}
async function start(page, sent) {
  const n = sent.length;
  await page.getByRole('button', { name: 'Créer la publication', exact: true }).click();
  const body = await until(async () => sent[n], Boolean, 'generate request');
  assert.equal(body.mode, 'guided');
  const op = await until(() => operation(body.requestId), value => value?.state === 'running', 'real PostgreSQL admission');
  assert.equal(op.actor_id, actor.id);
  await until(() => calls(body.requestId), rows => rows.length > 0, 'simulated provider entered');
  return body.requestId;
}
async function complete(id) { return until(() => operation(id), row => row?.state === 'complete', 'persisted post'); }
async function displayed(page, op) {
  await page.locator('.publisher-post').waitFor();
  assert.equal(await page.locator('.publisher-caption').innerText(), op.result.post.caption);
}
async function pendingKey(page, id) {
  assert.equal(await page.evaluate(id => Object.keys(sessionStorage).some(key => key.startsWith('oar-publisher-active-generation-v1:') && sessionStorage.getItem(key) === id), id), true);
}
async function check(engine, name, fn) {
  if (results.some(row => row.engine === engine && row.name === name && row.passed)) return;
  const browser = await (engine === 'chromium' ? chromium.launch({ channel: 'chrome' }) : webkit.launch());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const external = [], errors = [], sent = [], reads = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && ![local.app, local.api].includes(url.origin)) { external.push(url.origin); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(25000);
  page.on('dialog', dialog => void dialog.accept());
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/publisher' && url.searchParams.get('action') === 'generate' && request.method() === 'POST') sent.push(request.postDataJSON());
    if (url.pathname === '/api/publisher' && url.searchParams.get('action') === 'status') reads.push(url.searchParams.get('requestId'));
  });
  const baseline = await counts();
  const traceBaseline = (await readFile(tracePath, 'utf8').catch(() => '')).split('\n').filter(Boolean).length;
  try {
    await gate(''); await writeFile(providerControl, '');
    await login(page); const detail = await fn({ page, sent, reads });
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    assert.equal(await page.locator('[data-nextjs-dialog]').count(), 0);
    const admissions = (await counts()) - baseline;
    assert.equal(admissions, sent.length, 'Exactly the explicit requests were admitted');
    if (!sent.length) assert.equal((await readFile(tracePath, 'utf8')).split('\n').filter(Boolean).length, traceBaseline, 'No provider calls for unsubmitted draft');
    const evidence = { engine, name, passed: true, admissions, ...detail };
    results.push({ ...evidence, account: actorName }); console.log(JSON.stringify(evidence));
  } finally { await gate(''); await writeFile(providerControl, ''); await context.close(); await browser.close(); }
}
try {
  for (const engine of process.env.PUBLISHER_BROWSER ? [process.env.PUBLISHER_BROWSER] : ['chromium', 'webkit']) {
    actorName = !before && engine === 'webkit' ? 'matrix' : 'admin'; actor = fixtures.users[actorName];
    await check(engine, 'ready during access outage', async ({ page, sent, reads }) => {
      const admissionsBefore = await counts();
      await guided(page); await gate('hold'); const r1 = await start(page, sent);
      const revision = (await crm.query('select revision from crm_access_profiles where user_id=$1', [actor.id])).rows[0].revision;
      await outage(page); await gate(''); const op1 = await complete(r1); const initialCalls = (await calls(r1)).length;
      assert.equal(initialCalls, 3); const readCount = reads.length;
      await restore(page);
      assert.equal((await crm.query('select revision from crm_access_profiles where user_id=$1', [actor.id])).rows[0].revision, revision);
      if (before) {
        await page.locator('.publisher-selector').waitFor();
        assert.equal(await page.locator('.publisher-choice-grid [aria-pressed="true"]').count(), 3);
        assert.equal(reads.length, readCount, 'BEFORE: draft prevents R1 status read');
        await gate('hold'); const r2 = await start(page, sent); assert.notEqual(r1, r2);
        await gate(''); const op2 = await complete(r2); await displayed(page, op2);
        assert.equal(sent.length, 2); assert.equal((await calls(r2)).length, 3);
        return { defectConfirmed: true, r1, post1: op1.result.post.id, r2, post2: op2.result.post.id, generatePosts: sent.length, providerCalls: [initialCalls, (await calls(r2)).length] };
      }
      await displayed(page, op1); assert(reads.slice(readCount).includes(r1)); assert.equal(sent.length, 1);
      assert.equal((await calls(r1)).length, initialCalls);
      assert.equal((await counts()) - admissionsBefore, 1, 'Recovery adds no admission');
      if (engine === 'webkit') return { r1, post1: op1.result.post.id, recoveredSamePost: true, extraCallsForRecovery: 0, generatePosts: sent.length, providerCalls: [initialCalls] };
      // Deliberately identical subsequent creation remains possible by explicit action.
      await guided(page); await gate('hold'); const r2 = await start(page, sent); assert.notEqual(r1, r2);
      assert.deepEqual(sent[0].direction, sent[1].direction);
      await gate(''); const op2 = await complete(r2); await displayed(page, op2);
      return { r1, post1: op1.result.post.id, recoveredSamePost: true, extraCallsForRecovery: 0, explicitIdenticalRequest: r2, generatePosts: sent.length, providerCalls: [initialCalls, (await calls(r2)).length] };
    });
    if (before) continue;
    await check(engine, 'running on return; unavailable status keeps request and choices', async ({ page, sent, reads }) => {
      await guided(page); await gate('hold'); const r1 = await start(page, sent); await outage(page);
      const pattern = `${local.app}/api/publisher?action=status*`;
      await page.route(pattern, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'État temporairement indisponible (fixture)' }) }));
      await restore(page); await page.getByText('État temporairement indisponible (fixture)', { exact: false }).waitFor();
      await pendingKey(page, r1); assert.equal(await page.getByRole('button', { name: 'Créer la publication', exact: true }).count(), 0);
      assert.equal(sent.length, 1); assert.equal((await operation(r1)).state, 'running');
      await page.unroute(pattern);
      // Unknown status must also retain R1, never prepare a new POST.
      await page.route(pattern, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'empty' }) }));
      await page.getByRole('button', { name: 'Reprendre l’état', exact: true }).first().click();
      await page.locator('.publisher-loading').waitFor({ state: 'hidden' }); await pendingKey(page, r1);
      assert.equal(await page.getByRole('button', { name: 'Créer la publication', exact: true }).count(), 0);
      await page.unroute(pattern);
      await page.getByRole('button', { name: 'Reprendre l’état', exact: true }).first().click();
      await page.locator('.publisher-generation').waitFor(); assert.equal(sent.length, 1);
      assert.equal((await operation(r1)).state, 'running'); assert(reads.includes(r1));
      await gate(''); const op = await complete(r1); await displayed(page, op); assert.equal(sent.length, 1);
      assert.equal((await calls(r1)).length, 3);
      return { r1, generatePosts: sent.length, providerCalls: (await calls(r1)).length, extraAdmissions: 0, unknownStatusRetained: true };
    });
    await check(engine, 'terminal result requires explicit new key', async ({ page, sent }) => {
      await guided(page); await gate('hold'); const r1 = await start(page, sent); await outage(page); await restore(page);
      await page.locator('.publisher-generation').waitFor();
      await writeFile(providerControl, 'fail'); await gate('');
      await until(() => operation(r1), row => row?.state === 'failed', 'terminal receipt');
      await page.getByRole('button', { name: 'Préparer une nouvelle tentative', exact: true }).waitFor();
      assert.equal(sent.length, 1); assert.equal(await page.getByRole('button', { name: 'Créer la publication', exact: true }).count(), 0);
      await pendingKey(page, r1); const failedCalls = (await calls(r1)).length;
      await writeFile(providerControl, '');
      await page.getByRole('button', { name: 'Préparer une nouvelle tentative', exact: true }).click();
      assert.equal(await page.locator('.publisher-choice-grid [aria-pressed="true"]').count(), 3);
      assert.equal(sent.length, 1);
      await gate('hold'); const r2 = await start(page, sent); assert.notEqual(r1, r2); assert.deepEqual(sent[0].direction, sent[1].direction);
      await gate(''); const op = await complete(r2); await displayed(page, op);
      return { r1, r2, generatePosts: sent.length, providerCalls: [failedCalls, (await calls(r2)).length], explicitRetryOnly: true };
    });
    await check(engine, 'unsubmitted draft survives outage without generation', async ({ page, sent }) => {
      await guided(page); await outage(page); await restore(page); await page.locator('.publisher-selector').waitFor();
      assert.equal(await page.locator('.publisher-choice-grid [aria-pressed="true"]').count(), 3); assert.equal(sent.length, 0);
      return { generatePosts: 0, providerCalls: 0 };
    });
    await check(engine, 'account change cannot recover pending result', async ({ page, sent, reads }) => {
      await guided(page); await gate('hold'); const r1 = await start(page, sent); await outage(page);
      await gate(''); await complete(r1); const count = reads.length;
      await page.unroute(`${local.api}/auth/v1/user`);
      await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
      await page.getByRole('button', { name: 'Se connecter', exact: true }).waitFor();
      await login(page, 'none'); await page.getByRole('heading', { name: 'Aucun accès autorisé', exact: true }).waitFor();
      assert.equal(await page.locator('.publisher-root, .publisher-caption').count(), 0); assert.equal(reads.length, count);
      const token = await tokenLogin(fixtures.users.none); assert.equal((await appRequest('status', token, undefined, { requestId: r1 })).status, 403);
      return { r1, generatePosts: sent.length, providerCalls: (await calls(r1)).length, deliveredToNextAccount: false };
    });
    await check(engine, 'revoked access cannot recover pending result with old token', async ({ page, sent, reads }) => {
      const profile = (await crm.query('select active,revision from crm_access_profiles where user_id=$1', [actor.id])).rows[0];
      const oldToken = await tokenLogin(actor);
      try {
        await guided(page); await gate('hold'); const r1 = await start(page, sent); await outage(page);
        await gate(''); await complete(r1); const count = reads.length;
        await crm.query('update crm_access_profiles set active=false,revision=revision+1 where user_id=$1', [actor.id]);
        await page.unroute(`${local.api}/auth/v1/user`);
        await page.getByRole('button', { name: 'Réessayer la vérification', exact: true }).click();
        await page.getByRole('heading', { name: 'Aucun accès autorisé', exact: true }).waitFor();
        assert.equal(await page.locator('.publisher-root, .publisher-caption').count(), 0); assert.equal(reads.length, count);
        assert.equal((await appRequest('status', oldToken, undefined, { requestId: r1 })).status, 403);
        return { r1, generatePosts: sent.length, providerCalls: (await calls(r1)).length, oldTokenDenied: true };
      } finally { await crm.query('update crm_access_profiles set active=$2,revision=$3 where user_id=$1', [actor.id, profile.active, profile.revision]); }
    });
  }
} finally {
  await gate(''); await writeFile(providerControl, '');
  await writeFile(`${local.directory}/results/recovery-${before ? 'before' : 'after'}.json`, JSON.stringify({ phase: before ? 'before' : 'after', buildID: manifest.buildID, realBrowserAuthPostgres: true, externalTransport: 'simulated with test-only gate and counter', results }, null, 2), { mode: 0o600 });
  if (matrixOriginal) await crm.query("update crm_module_grants set level=$2,sensitive=$3 where user_id=$1 and module='publisher'", [fixtures.users.matrix.id, matrixOriginal.level, matrixOriginal.sensitive]);
  await db.end(); await crm.end();
}
