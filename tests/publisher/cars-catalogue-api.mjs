/** One end-to-end creation against the reused local bench; all providers are simulated. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CAR_CATALOGUE, CAR_CATALOGUE_VERSION } from '../../lib/publisher/carSelection.js';
import { directory, trace, sql, request } from './car-selection-local.mjs';
const output = process.env.PUBLISHER_CATALOGUE_EVIDENCE || `${directory}/catalogue`;
mkdirSync(output, { recursive: true });
const protectedId = '19394aed-b069-48dc-ac8d-cdbddfffd93c';
const checks = [];
const check = async (name, run) => { await run(); checks.push(name); console.log('PASS ' + name); };
const reference = CAR_CATALOGUE.find(r => r.id === 'ferrari-296-gtb-coupe-2021');
assert.ok(reference);
const body = { requestId: randomUUID(), mode: 'guided', direction: {
  universe: 'cars', moment: 'day', style: 'elegant', carType: 'supercar', carBrand: 'ferrari', carModel: reference.id,
} };
const receiptPath = `${output}/operation.json`;
if (process.argv.includes('--resume')) {
  assert.ok(existsSync(receiptPath), 'A saved request is required to resume this same simulated creation');
  const receipt = JSON.parse(readFileSync(receiptPath));
  assert.deepEqual(receipt.direction, body.direction);
  body.requestId = receipt.requestId;
} else {
  assert.ok(!existsSync(receiptPath), 'A prior test exists: use --resume instead of creating again');
  writeFileSync(receiptPath, JSON.stringify(body, null, 2) + '\n');
}
let post, calls;
await sql.connect();
try {
  const historical = JSON.parse(readFileSync(`${directory}/protected-historical-before.json`));
  const readHistorical = async () => (await sql.query('select to_jsonb(p) row from publisher_posts p where id=$1', [protectedId])).rows[0].row;
  await check('existing historical fixture remains byte-equivalent and its v1 nine-field context is readable', async () => {
    assert.deepEqual(await readHistorical(), historical);
    const r = await request('status', undefined, 'editor', { id: protectedId });
    assert.equal(r.status, 200); assert.deepEqual(r.data.post.car_context, historical.car_context);
    assert.equal(Object.keys(r.data.post.car_context).length, 9);
  });
  await check('incompatible SUV/McLaren fails before journal admission and any provider', async () => {
    const n = trace().length, requestId = randomUUID();
    const r = await request('generate', { ...body, requestId, direction: { ...body.direction, carType: 'suv', carBrand: 'mclaren', carModel: 'auto' } });
    assert.equal(r.status, 400); assert.match(r.data.error, /compatible/);
    assert.equal((await sql.query('select 1 from publisher_operations where request_id=$1', [requestId])).rowCount, 0);
    assert.equal(trace().length, n);
  });
  await check('one new selected Ferrari creation resolves v2 before two text and one image requests', async () => {
    const r = await request('generate', body);
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.state, 'ready'); post = r.data.post;
    assert.equal(post.status, 'draft'); assert.equal(post.car_context.catalogueVersion, CAR_CATALOGUE_VERSION);
    assert.equal(post.car_context.referenceId, reference.id);
    assert.equal(post.car_context.requestedBrand, 'ferrari'); assert.equal(post.car_context.requestedModel, reference.id);
    calls = trace().filter(c => c.requestId === body.requestId);
    assert.equal(calls.filter(c => c.kind === 'responses').length, 2); assert.equal(calls.filter(c => c.kind === 'images').length, 1);
    for (const call of calls) assert.deepEqual(call.carContextBeforeCall, post.car_context);
    const image = calls.find(c => c.kind === 'images').request;
    for (const part of [reference.id, reference.model, reference.variant, reference.generation]) assert.ok(image.prompt.includes(part), part);
    assert.doesNotMatch(image.prompt, /fictional Ferrari|six doors|plastic bodywork|giant invented accessories/i);
    assert.equal(image.model, 'gpt-image-2'); assert.equal(image.quality, 'medium'); assert.equal(image.n, 1);
    assert.ok(['1024x1280', '1024x1536'].includes(image.size));
    for (const text of calls.filter(c => c.kind === 'responses')) assert.equal(text.request.model, 'gpt-5.6-luna');
    // Recent creative descriptors can be present; no other catalogue identity or source is transmitted.
    for (const call of calls) {
      const payload = JSON.stringify(call.request);
      for (const other of CAR_CATALOGUE.filter(r => r.id !== reference.id)) assert.ok(!payload.includes(other.id), other.id);
      assert.ok(!payload.includes('CAR_CATALOGUE'));
      for (const url of reference.sources) assert.ok(!payload.includes(url));
    }
  });
  await check('actual editorial and image requests use the same accepted scene and saved descriptors', async () => {
    const image = calls.find(c => c.kind === 'images').request;
    const editorial = calls.filter(c => c.kind === 'responses')[1].request;
    const text = JSON.stringify(editorial);
    assert.ok(post.scene_summary.length > 12); assert.ok(post.visual_signature.length > 12);
    for (const value of [post.scene_summary, post.visual_signature]) {
      assert.ok(image.prompt.includes(value), 'image scenery equals saved scenery');
      assert.ok(text.includes(value), 'editorial scenery equals saved scenery');
    }
    const saved = (await sql.query('select car_context,scene_summary,visual_signature from publisher_posts where id=$1', [post.id])).rows[0];
    assert.deepEqual(saved, { car_context: post.car_context, scene_summary: post.scene_summary, visual_signature: post.visual_signature });
  });
  await check('reload/status/history and replay retain the same new reference without further provider calls', async () => {
    const n = trace().length;
    const status = await request('status', undefined, 'editor', { requestId: body.requestId });
    const history = await request('history');
    const replay = await request('generate', body);
    assert.equal(status.status, 200); assert.equal(history.status, 200); assert.equal(replay.status, 200);
    const historyPost = history.data.posts.find(p => p.id === post.id); assert.ok(historyPost);
    for (const saved of [status.data.post, historyPost, replay.data.post]) {
      assert.equal(saved.id, post.id); assert.deepEqual(saved.car_context, post.car_context); assert.equal(saved.status, 'draft');
    }
    assert.equal(trace().length, n); assert.deepEqual(await readHistorical(), historical);
  });
  writeFileSync(`${output}/api.json`, JSON.stringify({ checks, requestId: body.requestId, postId: post.id, context: post.car_context, format: post.format, dimensions: [post.image_width, post.image_height], observedSimulatedCalls: { text: 2, image: 1 }, paidCalls: 0, historicalFixtureUnchanged: true, productionDatabaseContacted: false }, null, 2) + '\n');
  writeFileSync(`${output}/provider-requests.json`, JSON.stringify(calls, null, 2) + '\n');
} finally { await sql.end(); }
