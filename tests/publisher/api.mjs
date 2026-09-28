/** Targeted actual Next/Auth/Postgres/media integration. External generation alone
 * is simulated. It never invokes a deployed application, Drive or Instagram.
 */
import './network-guard.cjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Client, status, fixturePath, login, request, appRequest, local, output } from './local.mjs';

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const tokens = {};
for (const [name, user] of Object.entries(fixture.users)) tokens[name] = await login(user);
const sql = new Client({ connectionString: status.DB_URL }), publisher = new Client({ connectionString: status.PUBLISHER_DATABASE_URL });
await sql.connect(); await publisher.connect();
const evidenceFile = join(output, 'api.json'), stateFile = join(local.directory, 'api-state.private.json');
const resume = process.argv.includes('--resume');
const results = resume && existsSync(evidenceFile) ? JSON.parse(readFileSync(evidenceFile, 'utf8')).results.filter(result => result.passed) : [];
const control = join(local.directory, 'provider-control.txt');
const direction = { universe: 'landscapes', moment: 'morning', style: 'elegant' };
const generate = () => ({ requestId: randomUUID(), mode: 'guided', direction });
const stats = async () => (await publisher.query('select (select count(*)::int from publisher_posts) posts,(select count(*)::int from publisher_operations) operations')).rows[0];
async function test(name, callback) {
  if (results.some(result => result.name === name && result.passed)) return;
  try { await callback(); results.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, passed: false, error: String(error.message) }); throw error; }
  finally {
    writeFileSync(evidenceFile, JSON.stringify({ actualAuth: true, actualPostgres: true, actualLocalMedia: true, externalGeneration: 'simulated', results }, null, 2));
    if (generated) writeFileSync(stateFile, JSON.stringify(generated), { mode: 0o600 });
  }
}
async function running(id) {
  for (let i = 0; i < 100; i++) {
    const rows = (await publisher.query('select state from publisher_operations where request_id=$1', [id])).rows;
    if (rows[0]?.state === 'running') return;
    if (rows[0]) throw new Error('Operation already ended before concurrency observation');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Operation did not claim its durable database lock');
}
let generated = resume && existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : undefined;
try {
  await test('anonymous, no grant, revoked and administration-only receive no content or media', async () => {
    const before = await stats();
    for (const name of ['anonymous', 'none', 'revoked', 'admin-only', 'full-oar']) {
      for (const action of ['session', 'today', 'history', 'status', 'image', 'export', 'export-text']) {
        const result = await appRequest(action, tokens[name], undefined, { id: fixture.historicalIds[0] });
        assert.equal(result.status, name === 'anonymous' ? 401 : 403, `${name}/${action}`);
        assert.ok(!result.bytes.includes(Buffer.from('Archive fictive')));
        assert.match(result.headers.get('cache-control'), /no-store/);
      }
      assert.equal((await appRequest('generate', tokens[name], generate())).status, name === 'anonymous' ? 401 : 403);
    }
    assert.deepEqual(await stats(), before, 'Read and refusal must not start a job');
  });
  await test('reader view and download commands have distinct current server rights', async () => {
    const id = fixture.historicalIds[0];
    const image = await appRequest('image', tokens.reader, undefined, { id });
    assert.equal(image.status, 200); assert.match(image.headers.get('content-type'), /image\/svg/);
    assert.match(image.headers.get('content-disposition'), /^inline/);
    assert.match(image.headers.get('cache-control'), /no-store/); assert.ok(image.headers.get('vary').split(/,\s*/).includes('Authorization'));
    assert.match(image.headers.get('content-security-policy'), /sandbox/);
    for (const action of ['export', 'export-text']) assert.equal((await appRequest(action, tokens.reader, undefined, { id })).status, 403);
    const downloaded = await appRequest('export', tokens['reader-export'], undefined, { id });
    assert.equal(downloaded.status, 200); assert.match(downloaded.headers.get('content-disposition'), /^attachment/);
    assert.deepEqual(downloaded.bytes, image.bytes);
    assert.equal((await appRequest('image', tokens.reader, undefined, { id: '../../etc/passwd' })).status, 400);
    assert.equal((await appRequest('image', tokens.reader, undefined, { id: randomUUID() })).status, 404);
    for (const action of ['generate', 'regenerate-text', 'regenerate-image', 'music-status', 'publish']) assert.equal((await appRequest(action, tokens.reader, {})).status, 403);
    for (const action of ['generate', 'regenerate-text', 'regenerate-image', 'publish']) assert.equal((await appRequest(action, tokens.contributor, {})).status, 403);
    assert.equal((await appRequest('export', tokens.contributor, undefined, { id })).status, 403);
  });
  await test('Publisher-only cannot read legacy owner records despite matching Auth user IDs', async () => {
    assert.ok(fixture.boundaries?.historicalRows, 'Concrete boundary fixtures required');
    for (const [table, id] of Object.entries(fixture.boundaries.historicalRows)) {
      assert.equal((await sql.query(`select user_id from public.${table} where id=$1`, [id])).rows[0].user_id, fixture.users.editor.id);
      const response = await request('/rest/v1/' + table + '?select=*&id=eq.' + id, tokens.editor);
      assert.equal(response.status, 200); assert.deepEqual(response.data, []);
    }
    assert.deepEqual((await request('/rest/v1/crm_workspace_state?select=*', tokens.editor)).data, []);
  });
  await test('legacy cookie, benchmark actions, forged roles and invalid requests do not bypass CRM', async () => {
    const before = await stats();
    const old = await fetch(local.app + '/api/publisher?action=session', { headers: { Cookie: 'oar_publisher_session=legacy-fixture', 'X-Publisher-Benchmark': 'true', 'X-Publisher-Role': 'admin' } });
    assert.equal(old.status, 401);
    for (const action of ['login', 'logout', 'benchmark', 'generate-benchmark', 'unknown']) assert.equal((await appRequest(action, tokens.admin, {})).status, 404);
    for (const action of ['generate', 'regenerate-text', 'regenerate-image', 'music-status', 'publish']) {
      for (const body of [null, [], { requestId: null }, { requestId: randomUUID(), role: 'admin', mode: 'unknown' }]) assert.equal((await appRequest(action, tokens.editor, body)).status, 400);
    }
    const forgery = await appRequest('generate', tokens.none, { ...generate(), role: 'admin', permissions: { generate: true }, user_metadata: { generalAdmin: true } });
    assert.equal(forgery.status, 403); assert.deepEqual(await stats(), before);
  });
  await test('real Next accepts browser destination Origin and rejects foreign Origin or forwarded-host forgery', async () => {
    const before = await stats();
    assert.equal((await appRequest('generate', tokens.editor, {})).status, 400, 'Legitimate browser Origin reaches authenticated body validation');
    for (const origin of ['https://external.example.invalid', 'http://127.0.0.1:9999']) {
      const response = await fetch(local.app + '/api/publisher?action=generate', { method: 'POST', headers: { Authorization: 'Bearer ' + tokens.editor, Origin: origin, 'X-Forwarded-Host': new URL(origin).host, 'Content-Type': 'application/json' }, body: JSON.stringify(generate()) });
      assert.equal(response.status, 403);
    }
    assert.deepEqual(await stats(), before, 'Rejected origins never create a job');
  });
  await test('one persistent job handles double-click, retry, concurrent user and state recovery', async () => {
    const body = generate(), before = await stats();
    const first = appRequest('generate', tokens.editor, body);
    await running(body.requestId);
    const duplicate = appRequest('generate', tokens.editor, body);
    const parallel = await appRequest('generate', tokens.admin, generate());
    assert.equal(parallel.status, 409, 'Cross-user persistent lock must refuse a second job');
    const state = await appRequest('status', tokens.editor, undefined, { requestId: body.requestId });
    assert.equal(state.status, 200); assert.ok(['preparing', 'ready'].includes(state.data.state));
    const [firstResult, repeatResult] = await Promise.all([first, duplicate]);
    assert.equal(firstResult.status, 200, JSON.stringify(firstResult.data));
    assert.ok([200, 202].includes(repeatResult.status));
    generated = firstResult.data.post;
    assert.equal(generated.created_by, fixture.users.editor.id);
    assert.equal(generated.updated_by, fixture.users.editor.id);
    assert.equal(generated.generation_status, 'ready');
    assert.equal(generated.post_date, new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()));
    const again = await appRequest('generate', tokens.editor, body);
    assert.equal(again.status, 200); assert.equal(again.data.post.id, generated.id);
    assert.equal((await appRequest('generate', tokens.admin, body)).status, 409, 'Another actor cannot adopt a receipt');
    assert.deepEqual(await stats(), { posts: before.posts + 1, operations: before.operations + 1 });
    const shared = await appRequest('history', tokens.reader);
    assert.equal(shared.data.posts.some(post => post.id === generated.id), true, 'Authorized history is shared');
    const image = await appRequest('image', tokens.reader, undefined, { id: generated.id });
    assert.equal(image.status, 200); assert.ok(image.bytes.includes(Buffer.from('DÉMONSTRATION LOCALE')));
  });
  await test('music choice, text regeneration, optimistic conflict and mark-published preserve source behavior', async () => {
    const initial = generated, selected = generated.music[1].id;
    const regenerated = await appRequest('regenerate-text', tokens.editor, { id: initial.id, revision: initial.revision, requestId: randomUUID() });
    assert.equal(regenerated.status, 200, JSON.stringify(regenerated.data)); generated = regenerated.data.post;
    assert.ok(generated.revision > initial.revision); assert.notEqual(generated.caption, initial.caption);
    const caption = generated.caption, musicIds = generated.music.map(music => music.id);
    const refreshedImage = await appRequest('regenerate-image', tokens.editor, { id: generated.id, revision: generated.revision, requestId: randomUUID() });
    assert.equal(refreshedImage.status, 200, JSON.stringify(refreshedImage.data)); generated = refreshedImage.data.post;
    assert.equal(generated.caption, caption); assert.deepEqual(generated.music.map(music => music.id), musicIds);
    const before = (await publisher.query('select caption,revision from publisher_posts where id=$1', [generated.id])).rows[0];
    const conflict = await appRequest('publish', tokens.editor, { id: generated.id, revision: initial.revision, musicId: selected, requestId: randomUUID() });
    assert.equal(conflict.status, 409);
    assert.deepEqual((await publisher.query('select caption,revision from publisher_posts where id=$1', [generated.id])).rows[0], before);
    const unrelated = await appRequest('music-status', tokens.contributor, { id: 24, postId: generated.id, revision: generated.revision, musicRevision: 1, status: 'available', requestId: randomUUID() });
    assert.equal(unrelated.status, 404, 'Global music identity must belong to this post');
    const published = await appRequest('publish', tokens.editor, { id: generated.id, revision: generated.revision, musicId: selected, requestId: randomUUID() });
    assert.equal(published.status, 200, JSON.stringify(published.data));
    assert.equal(published.data.post.status, 'published'); assert.equal(published.data.post.music_used_id, selected);
    assert.ok(published.data.post.published_at);
    const statsBefore = await stats();
    assert.equal((await appRequest('status', tokens.reader, undefined, { id: generated.id })).data.post.music_used_id, selected);
    assert.deepEqual(await stats(), statsBefore, 'Status read never starts generation');
  });
  await test('daily generation preserves the one-post-per-day source constraint across new request IDs', async () => {
    const first = await appRequest('generate', tokens.editor, { ...generate(), mode: 'daily' });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    const before = (await publisher.query("select count(*)::int count from publisher_posts where creation_mode='daily'")).rows[0].count;
    const second = await appRequest('generate', tokens.admin, { ...generate(), mode: 'daily' });
    assert.equal(second.status, 200); assert.equal(second.data.post.id, first.data.post.id);
    assert.equal((await publisher.query("select count(*)::int count from publisher_posts where creation_mode='daily'")).rows[0].count, before);
    assert.equal((await appRequest('today', tokens.reader)).data.post.id, first.data.post.id);
  });
  await test('client timeout recovers the existing durable result without another generation', async () => {
    const body = generate(), controller = new AbortController(), before = await stats();
    const pending = fetch(local.app + '/api/publisher?action=generate', { method: 'POST', signal: controller.signal, headers: { Authorization: 'Bearer ' + tokens.editor, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(response => response.status, error => error.name);
    await running(body.requestId); controller.abort(); assert.equal(await pending, 'AbortError');
    let completed;
    for (let attempt = 0; attempt < 100; attempt++) {
      completed = (await publisher.query('select state from publisher_operations where request_id=$1', [body.requestId])).rows[0]?.state;
      if (completed !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(completed, 'complete');
    const recovered = await appRequest('status', tokens.editor, undefined, { requestId: body.requestId });
    assert.equal(recovered.status, 200); assert.equal(recovered.data.state, 'ready');
    const repeated = await appRequest('generate', tokens.editor, body);
    assert.equal(repeated.status, 200); assert.equal(repeated.data.post.id, recovered.data.post.id);
    assert.deepEqual(await stats(), { posts: before.posts + 1, operations: before.operations + 1 });
  });
  await test('provider outage is terminal for its request ID; state and retry never relaunch it', async () => {
    const body = generate(); writeFileSync(control, 'fail', { mode: 0o600 });
    try {
      const failed = await appRequest('generate', tokens.editor, body);
      assert.equal(failed.status, 503); assert.equal(failed.data.terminal, true);
      const before = await stats();
      const state = await appRequest('status', tokens.editor, undefined, { requestId: body.requestId });
      assert.equal(state.data.state, 'error'); assert.equal(state.data.terminal, true);
      const retry = await appRequest('generate', tokens.editor, body);
      assert.equal(retry.status, 409); assert.equal(retry.data.terminal, true);
      assert.deepEqual(await stats(), before);
    } finally { writeFileSync(control, '', { mode: 0o600 }); }
  });
  await test('revocation during generation prevents result delivery and further provider work', async () => {
    const body = generate(), first = appRequest('generate', tokens.editor, body);
    await running(body.requestId);
    await sql.query('update public.crm_access_profiles set active=false,revision=revision+1 where user_id=$1', [fixture.users.editor.id]);
    try {
      const result = await first;
      assert.equal(result.status, 403); assert.ok(!result.data.post);
      assert.equal((await appRequest('history', tokens.editor)).status, 403);
      assert.equal((await appRequest('image', tokens.editor, undefined, { id: generated.id })).status, 403);
    } finally { await sql.query('update public.crm_access_profiles set active=true,revision=revision+1 where user_id=$1', [fixture.users.editor.id]); }
    const resumed = await appRequest('status', tokens.editor, undefined, { requestId: body.requestId });
    assert.equal(resumed.data.state, 'error');
    assert.equal((await publisher.query('select state from publisher_operations where request_id=$1', [body.requestId])).rows[0].state, 'failed');
  });
  await test('logout invalidates the previously issued JWT at Publisher authorization boundary', async () => {
    const token = await login(fixture.users.contributor);
    assert.equal((await appRequest('history', token)).status, 200);
    const logout = await request('/auth/v1/logout?scope=local', token, undefined, 'POST'); assert.equal(logout.status, 204);
    assert.ok([401, 403].includes((await appRequest('history', token)).status));
  });
  await test('legacy fixtures keep exact IDs dates media references status music and unknown authors', async () => {
    const before = JSON.parse(readFileSync(join(local.directory, 'history-before.private.json'), 'utf8'));
    const after = (await publisher.query('select to_jsonb(p) row from publisher_posts p where id=any($1::uuid[]) order by id', [before.map(row => row.id)])).rows.map(row => row.row);
    for (const row of after) { assert.equal(row.created_by, null); assert.equal(row.updated_by, null); delete row.revision; delete row.created_by; delete row.updated_by; }
    assert.deepEqual(after, before);
    const history = await appRequest('history', tokens.reader);
    for (const row of before) { const actual = history.data.posts.find(post => post.id === row.id); assert.equal(actual.post_date, row.post_date); assert.equal(actual.music_used_id, row.music_used_id); }
  });
} finally {
  writeFileSync(control, '', { mode: 0o600 });
  await sql.query('update public.crm_access_profiles set active=true where user_id=$1', [fixture.users.editor.id]);
  await sql.end(); await publisher.end();
}
