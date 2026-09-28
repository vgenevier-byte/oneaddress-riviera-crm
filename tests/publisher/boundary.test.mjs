import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { handlePublisher } from '../../lib/publisher/engine/handler.js';
import { localSimulation } from '../../lib/publisher/engine/env.js';

test('legacy shared cookie and benchmark never authorize integrated routes, even in preview', async t => {
  const secret = 'fictitious-local-legacy-secret';
  const payload = Buffer.from(JSON.stringify({ version: 1, issuedAt: Math.floor(Date.now()/1000), expiresAt: Math.floor(Date.now()/1000)+86400 })).toString('base64url');
  const cookie = `oar_publisher_session=${payload}.${createHmac('sha256',secret).update(payload).digest('base64url')}`;
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Legacy request must not touch Auth, storage or any provider'); });
  for (const action of ['session','today','history','status','image','export','export-text','generate','regenerate-text','regenerate-image','music-status','publish']) {
    const method = ['generate','regenerate-text','regenerate-image','music-status','publish'].includes(action) ? 'POST' : 'GET';
    const response = await handlePublisher(new Request(`http://127.0.0.1/api/publisher?action=${action}`, { method, headers: { cookie, 'x-publisher-benchmark': secret, 'x-user-role': 'admin' } }));
    assert.equal(response.status, 401, action);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
});
test('unknown and former authentication actions are closed before any service call', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('No service call allowed'); });
  for (const action of ['login','logout','delete','benchmark','null','other']) {
    assert.equal((await handlePublisher(new Request(`http://127.0.0.1/api/publisher?action=${action}`))).status, 404);
  }
  assert.equal((await handlePublisher(new Request('http://127.0.0.1/api/publisher?action=generate', { method:'POST', headers:{origin:'https://outside.invalid'} }))).status,403);
  // Real Next local Node adapter normalizes request.url to localhost while the
  // browser legitimately addresses 127.0.0.1. It must reach CRM authentication.
  assert.equal((await handlePublisher(new Request('http://localhost:3173/api/publisher?action=generate', { method:'POST', headers:{host:'127.0.0.1:3173',origin:'http://127.0.0.1:3173'} }))).status,401);
  assert.equal((await handlePublisher(new Request('http://localhost:3173/api/publisher?action=generate', { method:'POST', headers:{host:'127.0.0.1:3173',origin:'https://outside.invalid','x-forwarded-host':'outside.invalid'} }))).status,403);
});
test('creative constants, rules and schemas are byte-identical to the deployed source', () => {
  const provenance = JSON.parse(readFileSync('docs/publisher/source.json','utf8'));
  for (const name of ['constants.js','rules.js','schemas.js','storage.js']) {
    const digest = createHash('sha256').update(readFileSync(`lib/publisher/engine/${name}`)).digest('hex');
    assert.equal(digest, provenance.sourceFilesSha256[`app/frontend/server/publisher/${name}`]);
  }
});
test('simulation fails closed when a Production URL is supplied', () => {
  const keys = ['PUBLISHER_LOCAL_SIMULATION','PUBLISHER_DATABASE_URL','NEXT_PUBLIC_SUPABASE_URL'];
  const previous = Object.fromEntries(keys.map(key => [key,process.env[key]]));
  try {
    process.env.PUBLISHER_LOCAL_SIMULATION='1';
    process.env.PUBLISHER_DATABASE_URL='postgresql://fiction@127.0.0.1:55532/publisher_local';
    process.env.NEXT_PUBLIC_SUPABASE_URL='https://jcmnwvlmysecrahupfkk.supabase.co';
    assert.throws(localSimulation, /isolated loopback/);
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});
