/** Final request-boundary proof after scenery hardening. Disposable local data only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { directory, trace, sql, request } from './car-selection-local.mjs';

const protectedId = '19394aed-b069-48dc-ac8d-cdbddfffd93c';
const proof = JSON.parse(readFileSync(`${directory}/selection-api-results.json`));
const checks = [];
const wholeRow = async id => (await sql.query('select to_jsonb(p) row from publisher_posts p where id=$1', [id])).rows[0].row;
const load = async id => {
  const reply = await request('status', undefined, 'editor', { id });
  assert.equal(reply.status, 200);
  return reply.data.post;
};
const callsFor = id => trace().filter(call => call.requestId === id);
function assertInputs(id, context, images) {
  const calls = callsFor(id);
  assert.equal(calls.filter(call => call.kind === 'responses').length, 1);
  assert.equal(calls.filter(call => call.kind === 'images').length, images);
  for (const call of calls) {
    assert.deepEqual(call.carContextBeforeCall, context);
    assert.doesNotMatch(JSON.stringify(call.request), /Ferrari|Countach|Vantage|Phantom|t-top|carbon-fibre|six doors|folding roof/i);
  }
  if (images) {
    const image = calls.find(call => call.kind === 'images').request;
    assert.match(image.prompt, new RegExp(context.referenceId));
    assert.equal(image.model, 'gpt-image-2');
    assert.equal(image.quality, 'medium');
    assert.equal(image.n, 1);
  }
}
async function regenerate(post, action) {
  const requestId = randomUUID();
  const reply = await request(action, { requestId, id: post.id, revision: post.revision });
  assert.equal(reply.status, 200, JSON.stringify(reply.data));
  return { post: reply.data.post, requestId };
}
await sql.connect();
try {
  const protectedBefore = await wholeRow(protectedId);
  let current = await load(proof.createdPostIds[4]);
  const musicBefore = current.music;
  const fields = ['car_context', 'image_url', 'image_pathname', 'image_width', 'image_height', 'format', 'music_used_id', 'primary_music_id', 'alternative_music_ids'];
  const beforeText = await wholeRow(current.id);
  const text = await regenerate(current, 'regenerate-text');
  current = text.post;
  const afterText = await wholeRow(current.id);
  for (const field of fields) assert.deepEqual(afterText[field], beforeText[field], field);
  assertInputs(text.requestId, current.car_context, 0);
  checks.push('New 11-field context survives real SQL text regeneration; image and music unchanged');
  const beforeImage = current;
  const visual = await regenerate(current, 'regenerate-image');
  current = visual.post;
  assert.deepEqual(current.car_context, beforeImage.car_context);
  assert.deepEqual(current.music, musicBefore);
  assert.equal(current.caption, beforeImage.caption);
  assert.equal(current.format, beforeImage.format);
  assertInputs(visual.requestId, current.car_context, 1);
  checks.push('New exact selection survives real SQL image regeneration and actual simulated requests');

  // New synthetic records only: never mutate the protected historical fixture.
  for (const oldContext of [protectedBefore.car_context, null]) {
    const id = randomUUID();
    await sql.query(`insert into publisher_posts
      (id,post_date,creation_mode,creative_universe,creative_moment,creative_style,theme,moment,caption,scene_summary,visual_signature,hashtags,primary_music_id,alternative_music_ids,location,generation_status,car_context)
      values($1,'2026-10-21','guided','Voitures','Jour','Élégant','voiture','jour',
      'Ferrari Spider folding roof and six doors','countach beside a terrace','vantage t-top phantom carbon-fibre',
      '{#Ferrari,#Countach,#Vantage,#Phantom,#Spider}',1,'{2,3}','Aucun','ready',$2::jsonb)`, [id, oldContext ? JSON.stringify(oldContext) : null]);
    let legacy = await load(id);
    if (oldContext) {
      const result = await regenerate(legacy, 'regenerate-text');
      legacy = result.post;
      assert.deepEqual(legacy.car_context, oldContext);
      assert.equal(Object.keys(legacy.car_context).length, 9);
      assertInputs(result.requestId, oldContext, 0);
      checks.push('Legacy 9-field context remains exact; competing historical prose absent from text request');
    }
    const before = legacy;
    const result = await regenerate(legacy, 'regenerate-image');
    legacy = result.post;
    assertInputs(result.requestId, legacy.car_context, 1);
    if (oldContext) assert.deepEqual(legacy.car_context, oldContext);
    assert.equal(Object.keys(legacy.car_context).length, 9);
    assert.equal(legacy.caption, before.caption);
    assert.deepEqual(legacy.music, before.music);
    assert.equal(legacy.format, before.format);
    assert.ok(legacy.car_context.referenceId);
    checks.push(oldContext
      ? 'Legacy exact reference and body preserved through image regeneration; contradictory prose omitted'
      : 'Pre-context legacy car resolves one reference before providers; contradictory prose omitted');
  }
  assert.deepEqual(await wholeRow(protectedId), protectedBefore);
  const savedBefore = JSON.parse(readFileSync(`${directory}/protected-historical-before.json`));
  assert.deepEqual(protectedBefore, savedBefore);
  assert.equal((await sql.query("select count(*)::int n from publisher_operations where state='running'")).rows[0].n, 0);
  assert.equal((await sql.query("select count(*)::int n from publisher_posts where status='published'")).rows[0].n, 0);
  checks.push('Protected historical fixture unchanged; zero running operations and zero published posts');
  const result = { passed: checks.length, checks, database: 'native local PostgreSQL', auth: 'simulated', providers: 'simulated actual request boundary', paidCalls: 0 };
  writeFileSync(`${directory}/selection-regeneration-results.json`, JSON.stringify(result, null, 2) + '\n');
  for (const check of checks) console.log('PASS ' + check);
} finally {
  await sql.end();
}
