/** Real handler, normalization and idempotency; isolated Auth/SQL/transport mocks.
 * No account, production database or provider is contacted.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

await test('car selections are validated before admission and retain legacy operation fingerprints', async t => {
  const actor = 'ab000000-0000-4000-8000-000000000001';
  const post = { id: 'bc000000-0000-4000-8000-000000000001', generation_status: 'ready', status: 'draft', revision: 1 };
  const rows = new Map();
  let admissions = 0, providerCalls = 0, checks = 0;
  const environment = {
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55541',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'isolated-fictitious-publishable-key',
    PUBLISHER_DATABASE_URL: 'postgresql://fiction@127.0.0.1:55542/publisher_selection_unit',
  };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  t.mock.module('@supabase/supabase-js', { exports: { createClient: (url, key, config) => {
    const token = config.global.headers.Authorization;
    return {
      auth: { getUser: async () => ({ data: { user: token === 'Bearer expired' ? null : { id: actor } } }) },
      rpc: async () => { checks += 1; return { data: token === 'Bearer editor' }; },
    };
  } } });
  t.mock.module(new URL('../../lib/publisher/engine/database.js', import.meta.url), { exports: {
    query: async (text, values) => {
      if (text.startsWith('SELECT * FROM publisher_operations')) return rows.has(values[0]) ? [rows.get(values[0])] : [];
      if (text.startsWith('UPDATE publisher_operations SET state=')) {
        Object.assign(rows.get(values[0]), { state: values[1], result: JSON.parse(values[2]) });
        return [];
      }
      if (text.startsWith('UPDATE publisher_operations SET target_post_id=')) return [];
      assert.fail('Unexpected handler SQL: ' + text);
    },
    transaction: async statements => {
      const [requestId, actorId, action, fingerprint] = statements[1].values;
      admissions += 1;
      const row = { request_id: requestId, actor_id: actorId, action, fingerprint, state: 'running' };
      rows.set(requestId, row);
      return [[], [row]];
    },
  } });
  const unreachable = async () => { throw new Error('Unrelated mutation must not run'); };
  t.mock.module(new URL('../../lib/publisher/engine/db.js', import.meta.url), { exports: {
    claimGuidedGeneration: async () => ({ decision: 'ready', post }), claimTodayGeneration: unreachable,
    claimRegeneration: unreachable, getPostById: unreachable, getPostByRequestId: unreachable,
    getTodayPost: unreachable, hydratePostWithMusic: async value => value,
    listHistory: unreachable, markPublished: unreachable, normalizeGenerationProgress: value => value,
    setMusicStatus: unreachable, replacePostMusic: unreachable, confirmPostMusic: unreachable, selectPostMusic: unreachable,
  } });
  const paid = async () => { providerCalls += 1; throw new Error('A paid transport must not run'); };
  t.mock.module(new URL('../../lib/publisher/engine/generation.js', import.meta.url), { exports: {
    generateClaimedPost: paid, regenerateImage: paid, regenerateText: paid,
  } });
  t.mock.module(new URL('../../lib/publisher/engine/provider.js', import.meta.url), { exports: {
    assertGenerationEnabled: () => {}, get: paid,
  } });
  const { handlePublisher } = await import('../../lib/publisher/engine/handler.js');
  const baseDirection = { universe: 'cars', moment: 'day', style: 'elegant' };
  const send = async (body, token = 'editor') => {
    const response = await handlePublisher(new Request('http://127.0.0.1/api/publisher?action=generate', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  };
  for (const invalid of [
    { carBrand: 'Ferrari' }, { carBrand: null }, { carBrand: {} },
    { carModel: 'fictional' }, { carModel: null }, { carModel: [] },
    { carType: 'suv', carBrand: 'mclaren' },
    { carType: 'convertible', carBrand: 'land-rover' },
    { carType: 'suv', carBrand: 'land-rover', carModel: 'porsche-911-carrera-coupe-2024' },
    { carModel: 'range-rover-l460-swb-se' },
  ]) {
    const before = admissions;
    const response = await send({ requestId: randomUUID(), mode: 'guided', direction: { ...baseDirection, ...invalid } });
    assert.equal(response.status, 400, JSON.stringify(response));
    assert.match(response.body.error, /voiture|marque|modèle|automobile/i);
    assert.equal(admissions, before);
  }
  for (const [token, status] of [[null, 401], ['expired', 401], ['reader', 403], ['none', 403]]) {
    assert.equal((await send({ requestId: randomUUID(), mode: 'guided', direction: baseDirection }, token)).status, status);
  }
  assert.equal(admissions, 0);

  const legacy = { requestId: randomUUID(), mode: 'guided', direction: baseDirection };
  assert.equal((await send(legacy)).status, 200);
  const expectedLegacy = { ...legacy, direction: { ...baseDirection, carType: 'auto' } };
  const expectedFingerprint = createHash('sha256').update(JSON.stringify({ action: 'generate', body: expectedLegacy })).digest('hex');
  assert.equal(rows.get(legacy.requestId).fingerprint, expectedFingerprint);
  assert.equal((await send({ ...legacy, direction: { ...baseDirection, carType: 'auto', carBrand: 'auto', carModel: 'auto' } })).status, 200);
  assert.equal(admissions, 1, 'Explicit new defaults recover the same historical receipt');

  const selected = { requestId: randomUUID(), mode: 'guided', direction: { ...baseDirection, carType: 'convertible', carBrand: 'porsche', carModel: 'porsche-911-carrera-cabriolet-2024' } };
  assert.equal((await send(selected)).status, 200);
  const selectedFingerprint = createHash('sha256').update(JSON.stringify({ action: 'generate', body: selected })).digest('hex');
  assert.equal(rows.get(selected.requestId).fingerprint, selectedFingerprint);
  assert.equal((await send({ ...selected, direction: { ...selected.direction, carModel: 'auto' } })).status, 409);
  assert.equal((await send({ ...selected, direction: { ...selected.direction, carBrand: 'bentley', carModel: 'bentley-continental-gtc-speed-gen4' } })).status, 409);
  assert.equal((await send({ ...selected, direction: { ...selected.direction, model: 'Injected competitor', car_context: { referenceId: 'forged' }, image_prompt: 'Fictional Ferrari' } })).status, 200);
  assert.equal(admissions, 2);
  assert.equal(providerCalls, 0);
  assert.ok(checks > admissions);
});
