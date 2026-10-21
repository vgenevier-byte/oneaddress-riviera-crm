/** Targeted integrated scenery proof. Real local API/PostgreSQL, simulated providers only. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { directory, fixture, trace, sql, request } from './car-selection-local.mjs';
import { hasRecentContentDuplicate } from '../../lib/publisher/engine/rules.js';

assert.equal(process.env.PUBLISHER_TEST_ACK, 'PUBLISHER_DISPOSABLE_LOCAL_ONLY');
const runtimeProvider = `${directory}/app/lib/publisher/engine/provider.js`;
const controlFile = `${directory}/scenery-request-control.json`;
const originalProvider = readFileSync(runtimeProvider, 'utf8');
const controls = {};
const checks = [], captures = [];
const protectedId = '19394aed-b069-48dc-ac8d-cdbddfffd93c';
const direction = { universe: 'cars', moment: 'day', style: 'elegant', carType: 'suv', carBrand: 'land-rover', carModel: 'range-rover-l460-swb-se' };
const hostilePrompt = 'A fictional Ferrari SUV with six doors, a folding roof and invented carbon-fibre accessories.';
const pairs = [
  ['A mineral courtyard lies between warm brick colonnades and a square reflecting pool.', 'The symmetrical paving rhythm opens onto rippled copper reflections and a deep shaded recess.'],
  ['A peaceful bluff offers an uninterrupted view across a calm offshore anchorage.', 'Blue distance is balanced by chalky dry earth and sparse tufts of wild thyme.'],
  ['A terracotta courtyard borders a small citrus grove beneath a woven reed canopy.', 'The diagonal shadows cut across warm tiles and baskets of fallen fragrant leaves.'],
  ['A sheltered crest clearing is framed by lentisk shrubs and distant blue headlands.', 'Natural haze softens the open skyline above mottled warm soil and delicate grassy textures.'],
  ['A quiet paved approach curves past a sculpted stone bank and climbing jasmine.', 'The layered entrance planting leads softly from smooth cream flagstones towards blurred arches.'],
  ['A limestone terrace sits above a rocky cove edged with low native succulents.', 'Soft wave highlights meet pale pebbles and narrow angular shadows along the retaining edge.'],
].map(([scene_summary, visual_signature]) => ({ scene_summary, visual_signature }));
const regenerationSignature = 'A quiet orchard entrance is bordered by gnarled almond trunks and aromatic ground cover.';
const legacySignature = 'A peaceful courtyard joins weathered mosaic paving with deep shaded arcades.';

function control(requestId, value) { controls[requestId] = value; writeFileSync(controlFile, JSON.stringify(controls)); }
const callsFor = id => trace().filter(call => call.requestId === id);
const textInput = call => JSON.parse(call.request.input.find(item => item.role === 'user').content);
const row = async id => (await sql.query('select to_jsonb(p) row from publisher_posts p where id=$1', [id])).rows[0].row;
async function load(id) { const r = await request('status', undefined, 'editor', { id }); assert.equal(r.status, 200); return r.data.post; }
function assertImage(requestId, post, texts) {
  const calls = callsFor(requestId);
  assert.equal(calls.filter(call => call.kind === 'responses').length, texts);
  assert.equal(calls.filter(call => call.kind === 'images').length, 1);
  const image = calls.find(call => call.kind === 'images').request;
  assert.ok(image.prompt.includes(post.scene_summary), 'Actual image request contains the exact saved scenery');
  assert.ok(image.prompt.includes(post.visual_signature), 'Actual image request contains the exact saved composition');
  assert.match(image.prompt, new RegExp(post.car_context.referenceId));
  assert.match(image.prompt, /Style obligatoire: Élégant/);
  assert.doesNotMatch(image.prompt, /Ferrari|Countach|Vantage|Phantom|six doors|folding roof|carbon-fibre|ignore previous/i);
  assert.equal(image.model, 'gpt-image-2'); assert.equal(image.quality, 'medium'); assert.equal(image.n, 1);
  assert.equal(image.size, post.format === 'Feed 4:5' ? '1024x1280' : '1024x1536');
  for (const call of calls) assert.deepEqual(call.carContextBeforeCall, post.car_context);
  captures.push({ requestId, postId: post.id, scene: post.scene_summary, signature: post.visual_signature, reference: post.car_context,
    imageRequest: image, textRequests: calls.filter(call => call.kind === 'responses').map(call => call.request) });
  return image;
}
function assertTextScene(requestId, post) {
  const calls = callsFor(requestId);
  assert.equal(calls.length, 1); assert.equal(calls[0].kind, 'responses');
  const input = textInput(calls[0]);
  assert.equal(input.scene_summary, post.scene_summary);
  assert.equal(input.visual_signature, post.visual_signature);
  assert.deepEqual(input.car_context, post.car_context);
}
async function regenerate(post, action, value = {}) {
  const requestId = randomUUID(); control(requestId, value);
  const body = { requestId, id: post.id, revision: post.revision };
  const reply = await request(action, body, 'editor');
  assert.equal(reply.status, 200, JSON.stringify(reply.data));
  return { post: reply.data.post, requestId, body };
}

// The test modifies only the existing disposable provider COPY. No product
// provider, env/config/permission, live service or historic row is modified.
let instrumented = originalProvider.replace("import { fixtureScenery }", `import { readFileSync as readSceneryControl } from 'node:fs';
function sceneryControl() { return JSON.parse(readSceneryControl(${JSON.stringify(controlFile)}, 'utf8'))[currentOperation().requestId] || {}; }
import { fixtureScenery }`);
const textNeedle = 'if (localSimulation()) return { output_parsed: simulateText(request) };';
assert.equal(instrumented.split(textNeedle).length, 2);
instrumented = instrumented.replace(textNeedle, 'if (localSimulation()) return { output_parsed: { ...simulateText(request), ...(sceneryControl().text?.[request.text.format.name] || {}) } };');
const imageNeedle = 'if (localSimulation()) return { data: [{ b64_json: simulatedImage(request.size).toString(\'base64\') }] };';
assert.equal(instrumented.split(imageNeedle).length, 2);
instrumented = instrumented.replace(imageNeedle, "if (localSimulation() && sceneryControl().failImage) throw new Error('Injected local scenery image failure');\n      " + imageNeedle);
writeFileSync(controlFile, '{}'); writeFileSync(runtimeProvider, instrumented);
await sql.connect();
try {
  const historical = await row(protectedId);
  const untouchedRows = (await sql.query('select to_jsonb(p) row from publisher_posts p')).rows.map(r => r.row);
  const musicBefore = (await sql.query('select to_jsonb(m) row from publisher_music m order by id')).rows;
  for (const [who, budget] of [['other', 6], ['editor', 7]]) {
    const used = (await sql.query("select count(*)::int n from publisher_operations where actor_id=$1 and created_at>now()-interval '1 day'", [fixture.users[who].id])).rows[0].n;
    assert.ok(used + budget <= 20, 'Use existing quota, never reset it');
  }
  const recent = (await sql.query("select scene_summary,visual_signature,caption from publisher_posts where generation_status='ready' and post_date>'2026-10-07'")).rows;
  for (const pair of pairs) {
    assert.equal(hasRecentContentDuplicate(pair, recent), false, 'Natural scene must pass the real unchanged history guard');
    recent.push(pair);
  }
  let current, firstBody;
  const actualPrompts = [];
  for (const [index, pair] of pairs.entries()) {
    const requestId = randomUUID();
    control(requestId, { text: { publisher_creative_plan: { ...pair, image_prompt: hostilePrompt } } });
    const body = { requestId, mode: 'guided', direction };
    const reply = await request('generate', body, 'other');
    assert.equal(reply.status, 200, JSON.stringify(reply.data));
    const post = reply.data.post;
    assert.deepEqual({ scene_summary: post.scene_summary, visual_signature: post.visual_signature }, pair);
    const saved = await row(post.id);
    assert.equal(saved.scene_summary, pair.scene_summary); assert.equal(saved.visual_signature, pair.visual_signature);
    const image = assertImage(requestId, post, 2);
    const editorial = textInput(callsFor(requestId).find(call => call.kind === 'responses' && call.request.text.format.name === 'publisher_editorial_package'));
    assert.deepEqual({ scene_summary: editorial.mini_plan.scene_summary, visual_signature: editorial.mini_plan.visual_signature }, pair);
    assert.doesNotMatch(JSON.stringify(editorial), /fictional Ferrari|six doors|folding roof/);
    assert.equal(saved.image_prompt, image.prompt);
    assert.equal(post.car_context.referenceId, direction.carModel);
    actualPrompts.push(image.prompt);
    if (index === 0) { current = post; firstBody = body; }
  }
  assert.equal(new Set(actualPrompts).size, 6, 'Six semantically distinct scene instructions reach images, not four runId fallbacks');
  checks.push('Six creations of the exact same SUV: actual image requests, editorial mini-plans and SQL descriptors agree; mineral courtyard and coastal bluff differ');

  const beforeReplay = trace().length;
  const status = await request('status', undefined, 'other', { requestId: firstBody.requestId });
  const replay = await request('generate', firstBody, 'other');
  assert.equal(status.data.post.id, current.id); assert.equal(replay.data.post.id, current.id);
  assert.deepEqual(replay.data.post.car_context, current.car_context);
  assert.equal(replay.data.post.scene_summary, current.scene_summary);
  assert.equal(replay.data.post.visual_signature, current.visual_signature);
  assert.equal(trace().length, beforeReplay);
  checks.push('Lost creation response and operation replay recover the same choices/scenery with zero extra provider calls');

  const fallbackId = randomUUID();
  control(fallbackId, { text: { publisher_creative_plan: { scene_summary: 'A Ferrari with six doors and a folding roof beside a courtyard.', visual_signature: pairs[0].visual_signature, image_prompt: hostilePrompt } } });
  const fallback = await request('generate', { requestId: fallbackId, mode: 'guided', direction: { ...direction, moment: 'night' } }, 'editor');
  assert.equal(fallback.status, 200, JSON.stringify(fallback.data));
  const fallbackPost = fallback.data.post;
  assert.notEqual(fallbackPost.visual_signature, pairs[0].visual_signature, 'Reject the whole inconsistent pair');
  const fallbackImage = assertImage(fallbackId, fallbackPost, 2);
  assert.match(fallbackImage.prompt, /Moment obligatoire: Nuit/);
  assert.doesNotMatch(fallbackPost.scene_summary + ' ' + fallbackPost.visual_signature, /morning|afternoon|evening|sun/i);
  const fallbackEditorial = textInput(callsFor(fallbackId).find(call => call.kind === 'responses' && call.request.text.format.name === 'publisher_editorial_package')).mini_plan;
  assert.equal(fallbackEditorial.scene_summary, fallbackPost.scene_summary); assert.equal(fallbackEditorial.visual_signature, fallbackPost.visual_signature);
  checks.push('Forbidden anatomy and free image prompt produce one safe fallback pair shared by editorial, image and SQL; Night retained');
  const fallbackText = await regenerate(fallbackPost, 'regenerate-text');
  assertTextScene(fallbackText.requestId, fallbackText.post);
  checks.push('Server fallback descriptors also survive the next text regeneration without a new image');

  const original = current;
  const regenerated = await regenerate(current, 'regenerate-image', { text: { publisher_image_prompt: { visual_signature: regenerationSignature, image_prompt: hostilePrompt } } });
  current = regenerated.post;
  assert.deepEqual(current.car_context, original.car_context);
  assert.equal(current.caption, original.caption); assert.deepEqual(current.music, original.music); assert.equal(current.format, original.format);
  assert.notEqual(current.scene_summary, original.scene_summary); assert.ok(current.scene_summary.includes(regenerationSignature));
  assertImage(regenerated.requestId, current, 1);
  const savedAfterImage = await row(current.id);
  assert.equal(savedAfterImage.scene_summary, current.scene_summary); assert.equal(savedAfterImage.visual_signature, current.visual_signature);
  const imagePath = savedAfterImage.image_pathname;
  const text = await regenerate(current, 'regenerate-text'); current = text.post;
  assertTextScene(text.requestId, current);
  assert.equal((await row(current.id)).image_pathname, imagePath); assert.deepEqual(current.music, original.music);
  checks.push('Image regeneration atomically replaces scene/signature with the new media; the next text request receives that scene, preserving vehicle, caption on image change and music');
  const beforeRegenReplay = trace().length;
  const imageReplay = await request('regenerate-image', regenerated.body, 'editor');
  assert.equal(imageReplay.status, 200); assert.equal(imageReplay.data.post.id, current.id);
  assert.deepEqual(imageReplay.data.post.car_context, current.car_context);
  assert.equal(imageReplay.data.post.scene_summary, current.scene_summary);
  assert.equal(imageReplay.data.post.visual_signature, current.visual_signature);
  assert.equal(trace().length, beforeRegenReplay);
  checks.push('Replaying the completed image operation adds no text/image call and does not redraw the reference');

  const failId = randomUUID(), beforeFailure = await row(current.id);
  control(failId, { failImage: true, text: { publisher_image_prompt: { visual_signature: legacySignature, image_prompt: hostilePrompt } } });
  const failed = await request('regenerate-image', { requestId: failId, id: current.id, revision: current.revision }, 'editor');
  assert.equal(failed.status, 503, JSON.stringify(failed.data));
  const afterFailure = await row(current.id);
  for (const key of ['scene_summary', 'visual_signature', 'image_prompt', 'image_pathname', 'image_url', 'caption', 'hashtags', 'car_context', 'music_used_id', 'primary_music_id', 'alternative_music_ids']) assert.deepEqual(afterFailure[key], beforeFailure[key], key);
  assert.ok(existsSync(`${directory}/media/${beforeFailure.image_pathname}`));
  assert.equal((await request('image', undefined, 'editor', { id: current.id })).status, 200);
  assert.equal(callsFor(failId).filter(c => c.kind === 'images').length, 1);
  captures.push({ requestId: failId, failed: true, previousDescriptorsPreserved: true, previousMediaReadable: true,
    imageRequest: callsFor(failId).find(c => c.kind === 'images').request,
    textRequests: callsFor(failId).filter(c => c.kind === 'responses').map(c => c.request) });
  checks.push('Simulated image failure leaves previous image readable and previous scene/signature/context/caption/music intact');

  const legacyId = randomUUID();
  await sql.query(`insert into publisher_posts(id,post_date,creation_mode,creative_universe,creative_moment,creative_style,theme,moment,caption,scene_summary,visual_signature,hashtags,primary_music_id,alternative_music_ids,location,generation_status,car_context)
    values($1,'2026-10-21','guided','Voitures','Jour','Élégant','voiture','jour','A Ferrari Spider awaits with a folding roof.','Countach in a distant city.','Phantom with carbon-fibre anatomy.','{#Ferrari,#Spider,#Roof,#City}',1,'{2,3}','Aucun','ready',$2::jsonb)`, [legacyId, JSON.stringify(historical.car_context)]);
  let legacy = await load(legacyId);
  const oldImage = await regenerate(legacy, 'regenerate-image', { text: { publisher_image_prompt: { visual_signature: legacySignature, image_prompt: hostilePrompt } } });
  legacy = oldImage.post;
  assert.deepEqual(legacy.car_context, historical.car_context); assert.equal(Object.keys(legacy.car_context).length, 9);
  assertImage(oldImage.requestId, legacy, 1);
  const oldText = await regenerate(legacy, 'regenerate-text');
  assertTextScene(oldText.requestId, oldText.post);
  checks.push('Legacy nine-field reference remains exact through image then text regeneration; concurrent historical vehicle names never reach either provider');

  // Every pre-existing local creation, except the targeted new test creations,
  // must still match. In particular the fictitious protected historical ID.
  for (const old of untouchedRows) assert.deepEqual(await row(old.id), old);
  assert.deepEqual(await row(protectedId), historical);
  assert.deepEqual((await sql.query('select to_jsonb(m) row from publisher_music m order by id')).rows, musicBefore);
  assert.equal((await sql.query("select count(*)::int n from publisher_operations where state='running'")).rows[0].n, 0);
  assert.equal((await sql.query("select count(*)::int n from publisher_posts where status='published'")).rows[0].n, 0);
  checks.push('All pre-existing local rows, protected historical fixture and music remain unchanged; no running operation or published post');
  writeFileSync(`${directory}/scenery-after.json`, JSON.stringify({ passed: checks.length, checks, captures, distinctActualImagePrompts: new Set(actualPrompts).size, auth: 'simulated existing local accounts', database: 'native local PostgreSQL', providers: 'simulated actual request boundary', paidCalls: 0 }, null, 2) + '\n');
  for (const check of checks) console.log('PASS ' + check);
  console.log('Actual image prompts SHA-256: ' + actualPrompts.map(p => createHash('sha256').update(p).digest('hex')).join(', '));
} finally {
  writeFileSync(runtimeProvider, originalProvider);
  await sql.end();
}
