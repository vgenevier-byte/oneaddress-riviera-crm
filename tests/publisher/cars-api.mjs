/** Real Publisher route + native PostgreSQL. Auth/RPC and paid transports simulated. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { directory, fixture, trace, sql, request } from './cars-local.mjs';
const results = [];
const check = async (name, run) => { await run(); results.push(name); console.log('PASS ' + name); };
if (!existsSync(`${directory}/provider-trace.jsonl`)) writeFileSync(`${directory}/provider-trace.jsonl`, '');
await sql.connect();
const direction = { universe: 'cars', moment: 'morning', style: 'elegant', carType: 'convertible' };
const body = { mode: 'guided', requestId: randomUUID(), direction };
let post;
try {
  await check('additive SQL on real PostgreSQL keeps every historical field and adds null only', async () => {
    const before = JSON.parse(readFileSync(`${directory}/historical-before.json`));
    const rows = (await sql.query('select to_jsonb(p) row from publisher_posts p where id=any($1::uuid[]) order by id', [before.map(x => x.id)])).rows.map(x => x.row);
    for (const row of rows) { assert.equal(row.car_context, null); delete row.car_context; }
    assert.deepEqual(rows, before);
  });
  await check('anonymous, read-only and none refuse generation before provider or operation', async () => {
    const n = trace().length;
    for (const [who, code] of [[null,401], ['reader',403], ['none',403]]) assert.equal((await request('generate', { ...body, requestId: randomUUID() }, who)).status, code);
    assert.equal(trace().length, n);
  });
  await check('unknown, null and wrong-typed car values fail with clear 400 before admission', async () => {
    const n = trace().length;
    for (const carType of ['tank', null, 3, {}, 'SUV', '']) {
      const id = randomUUID(); const r = await request('generate', { ...body, requestId: id, direction: { ...direction, carType } });
      assert.equal(r.status, 400, JSON.stringify(r.data)); assert.match(r.data.error, /voiture/);
      assert.equal((await sql.query('select 1 from publisher_operations where request_id=$1', [id])).rowCount, 0);
    }
    assert.equal(trace().length, n);
  });
  await check('double request admits one generation and persists one canonical snapshot', async () => {
    const replies = await Promise.all([request('generate', body), request('generate', body)]);
    for (const r of replies) assert.ok([200,202].includes(r.status), JSON.stringify(r.data));
    post = replies.find(r => r.status === 200 && r.data?.post)?.data.post;
    if (!post) post = (await request('status', undefined, 'editor', { requestId: body.requestId })).data.post;
    assert.equal(post.car_context.requestedType, 'convertible');
    const journal = (await sql.query('select car_context from publisher_operations where request_id=$1', [body.requestId])).rows[0];
    const row = (await sql.query('select car_context from publisher_posts where id=$1', [post.id])).rows[0];
    assert.deepEqual(row.car_context, journal.car_context); assert.deepEqual(row.car_context, post.car_context);
    const calls = trace().filter(x => x.requestId === body.requestId);
    assert.equal(calls.filter(x => x.kind === 'images').length, 1);
    assert.equal(calls.filter(x => x.kind === 'responses').length, 2);
  });
  await check('same requestId with changed type or another account conflicts without paid replay', async () => {
    const n = trace().length;
    assert.equal((await request('generate', { ...body, direction: { ...direction, carType: 'suv' } })).status, 409);
    assert.equal((await request('generate', body, 'other')).status, 409);
    assert.equal(trace().length, n);
  });
  await check('lost response recovery and same-operation replay return the saved reference without calls', async () => {
    const n = trace().length;
    const status = await request('status', undefined, 'editor', { requestId: body.requestId });
    const replay = await request('generate', body);
    assert.equal(status.data.post.id, post.id); assert.deepEqual(replay.data.post.car_context, post.car_context);
    assert.equal(trace().length, n);
  });
  await check('actual history reread returns reference; private media delivered only after authorization', async () => {
    const history = await request('history');
    assert.deepEqual(history.data.posts.find(p => p.id === post.id).car_context, post.car_context);
    const image = await request('image', undefined, 'editor', { id: post.id });
    assert.equal(image.status, 200); assert.match(image.headers.get('content-type'), /svg/);
    assert.equal((await request('image', undefined, 'none', { id: post.id })).status, 403);
  });
  await check('text-only regeneration retains exact image, type, model, format and persisted music choice', async () => {
    const before = (await sql.query('select image_url,image_pathname,car_context,music_used_id,primary_music_id,alternative_music_ids,format from publisher_posts where id=$1', [post.id])).rows[0];
    const r = await request('regenerate-text', { requestId: randomUUID(), id: post.id, revision: post.revision });
    assert.equal(r.status, 200, JSON.stringify(r.data)); post = r.data.post;
    const after = (await sql.query('select image_url,image_pathname,car_context,music_used_id,primary_music_id,alternative_music_ids,format from publisher_posts where id=$1', [post.id])).rows[0];
    assert.deepEqual(after, before);
  });
  await check('image regeneration keeps the exact reference and serializes it after success', async () => {
    const context = post.car_context, caption = post.caption, music = post.music;
    const r = await request('regenerate-image', { requestId: randomUUID(), id: post.id, revision: post.revision });
    assert.equal(r.status, 200, JSON.stringify(r.data)); post = r.data.post;
    assert.deepEqual(post.car_context, context); assert.equal(post.caption, caption); assert.deepEqual(post.music, music);
  });
  await check('legacy payload missing type defaults auto; free client model and URLs cannot substitute reference', async () => {
    const r = await request('generate', { mode: 'guided', requestId: randomUUID(), direction: { universe: 'cars', moment: 'day', style: 'dynamic', model: 'Invented Six Wheel', car_context: { referenceId: 'client' }, imageUrl: 'https://example.invalid/car' } });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.post.car_context.requestedType, 'auto');
    assert.notEqual(r.data.post.car_context.model, 'Invented Six Wheel');
  });
  await check('legacy text regeneration never invents a reference or changes its old image', async () => {
    const id = 'a3000000-0000-4000-8000-000000000001';
    const before = (await request('status', undefined, 'editor', { id })).data.post;
    const r = await request('regenerate-text', { requestId: randomUUID(), id, revision: before.revision });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.post.car_context, undefined); assert.equal(r.data.post.image_src, before.image_src);
  });
  await check('legacy explicit image regeneration records auto only with the successful replacement image', async () => {
    const id = 'a3000000-0000-4000-8000-000000000001';
    const before = (await request('status', undefined, 'editor', { id })).data.post;
    const r = await request('regenerate-image', { requestId: randomUUID(), id, revision: before.revision });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.post.car_context.requestedType, 'auto');
    assert.equal((await sql.query('select image_url is not null ok from publisher_posts where id=$1', [id])).rows[0].ok, true);
  });
  await check('three other universes omit car context and preserve English, five hashtags, three music choices, formats', async () => {
    for (const universe of ['landscapes', 'real_estate', 'boats']) {
      const r = await request('generate', { mode: 'guided', requestId: randomUUID(), direction: { universe, moment: 'evening', style: 'escape', carType: 'invalid-ignored-outside-cars' } });
      assert.equal(r.status, 200, JSON.stringify(r.data)); const p = r.data.post;
      assert.equal(p.car_context, undefined); assert.equal(p.hashtags.length, 5); assert.equal(p.music.length, 3); assert.match(p.caption, /^The coast/);
      assert.equal(p.format, universe === 'boats' ? 'Reel' : 'Feed 4:5');
      if (universe === 'real_estate') assert.equal(p.location, 'Aucun');
    }
  });
  await check('all simulated image requests keep existing model/quality/n and bounded dimensions', async () => {
    for (const { request: r } of trace().filter(x => x.kind === 'images')) {
      assert.equal(r.model, 'gpt-image-2'); assert.equal(r.quality, 'medium'); assert.equal(r.n, 1);
      assert.ok(['1024x1280','1024x1536'].includes(r.size));
    }
  });
  const carImage = trace().find(x => x.kind === 'images' && x.requestId === body.requestId);
  writeFileSync(`${directory}/prompt-example.txt`, carImage.request.prompt + '\n');
  writeFileSync(`${directory}/api-results.json`, JSON.stringify({ passed: results.length, results, postId: post.id, reference: post.car_context, database: 'real native PostgreSQL', auth: 'simulated boundary', paidCalls: 0 }, null, 2));
  console.log(`${results.length} API/database checks passed; zero paid calls`);
} finally { await sql.end(); }
