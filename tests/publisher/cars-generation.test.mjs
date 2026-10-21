/** Real generation/rules/serialization run with simulated provider + SQL boundaries.
 * The separate cars bench verifies the same writes through actual local Postgres.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

await test('car generation freezes one server reference at the provider boundary and keeps it across regenerations', async t => {
  const { publisherContext } = await import('../../lib/publisher/engine/context.js');
  const postId = 'c1000000-0000-4000-8000-000000000001';
  const music = [1, 2, 3].map(id => ({ id, title: `Fixture song ${id}`, artist: 'Fixture artist', availability_status: 'available', revision: 1, times_used: 0 }));
  const calls = [], deleted = [], journal = new Map();
  let stored = { id: postId, revision: 1, post_date: '2026-10-21', status: 'draft', generation_status: 'generating', creative_universe: 'Voitures', creative_moment: 'Nuit', creative_style: 'Dynamique', format: 'Feed 4:5' };
  let failSave = false;
  const oldDatabase = process.env.PUBLISHER_DATABASE_URL;
  process.env.PUBLISHER_DATABASE_URL = 'postgresql://fiction@127.0.0.1:55532/publisher_cars_unit';
  t.after(() => { if (oldDatabase === undefined) delete process.env.PUBLISHER_DATABASE_URL; else process.env.PUBLISHER_DATABASE_URL = oldDatabase; });
  t.mock.module(new URL('../../lib/publisher/engine/database.js', import.meta.url), { exports: {
    sql: () => async (strings, ...values) => {
      const text = strings.reduce((value, part, index) => value + (index ? `$${index}` : '') + part, '').replace(/\s+/g, ' ').trim();
      if (text.startsWith('SELECT revision, created_by')) return [];
      if (text.startsWith('UPDATE publisher_operations SET car_context = COALESCE')) {
        const requestId = values[1];
        if (!journal.has(requestId)) journal.set(requestId, JSON.parse(values[0]));
        return [{ car_context: journal.get(requestId) }];
      }
      if (text.startsWith('SELECT id FROM publisher_posts WHERE generation_run_id')) return [];
      if (text.startsWith('SELECT 1 FROM publisher_posts WHERE image_url')) return stored.image_url === values[0] ? [{ present: 1 }] : [];
      if (text.includes('SELECT * FROM publisher_music')) return music;
      if (text.startsWith('SELECT')) return [];
      if (text.startsWith('UPDATE publisher_posts SET')) {
        const writingImage = text.includes('image_url =');
        if (writingImage && failSave) throw new Error('Injected car save failure');
        const next = { ...stored };
        for (const field of ['theme', 'moment', 'creative_universe', 'creative_moment', 'creative_style', 'scene_summary', 'visual_signature', 'caption', 'hashtags', 'primary_music_id', 'alternative_music_ids', 'location', 'format', 'image_url', 'image_pathname', 'image_prompt', 'car_context']) {
          const match = text.match(new RegExp(`\\b${field}\\s*=\\s*\\$(\\d+)`));
          if (match) next[field] = field === 'car_context' ? JSON.parse(values[Number(match[1]) - 1]) : values[Number(match[1]) - 1];
        }
        if (writingImage || text.includes('caption =')) { next.generation_status = 'ready'; next.revision += 1; }
        stored = next;
        return [{ ...stored }];
      }
      assert.fail('Unexpected fixture SQL: ' + text);
    },
  } });
  t.mock.module(new URL('../../lib/publisher/engine/provider.js', import.meta.url), { exports: {
    client: () => ({
      responses: { parse: async request => {
        const name = request.text.format.name;
        const input = JSON.parse(request.input.find(item => item.role === 'user').content);
        calls.push({ name, input, request });
        assert.ok(journal.has(publisherContext.getStore().requestId), 'Canonical identity must be journaled before any provider call');
        const visual = { image_prompt: 'A fictional Ferrari SUV with six doors and a fixed roof in an impossible CGI city.', visual_signature: 'Low angle and open coastal space, editorial night study' };
        if (name === 'publisher_creative_plan') return { output_parsed: { ...visual, scene_summary: 'A quiet coastal viewpoint bordered by stone and Mediterranean vegetation.', format: 'Feed 4:5' } };
        if (name === 'publisher_image_prompt') return { output_parsed: visual };
        const editorial = { caption: 'The coast settles into a quieter rhythm. Evening brings a new perspective.', hashtags: ['#Riviera', '#CoastalRoad', '#EveningLight', '#Mediterranean'] };
        return { output_parsed: name === 'publisher_editorial_package' ? { ...editorial, music, location: 'French Riviera' } : editorial };
      } },
      images: { generate: async request => { calls.push({ name: 'image', request }); return { data: [{ b64_json: Buffer.from('fictional-image-bytes').toString('base64') }] }; } },
    }),
    put: async pathname => ({ url: `https://fixture.private.blob.vercel-storage.com/${pathname}`, pathname, contentType: 'image/jpeg' }),
    del: async url => { deleted.push(url); },
  } });
  const { generateClaimedPost, regenerateImage, regenerateText } = await import('../../lib/publisher/engine/generation.js');
  const { serializePublisherPost, persistOperationCarContext } = await import('../../lib/publisher/engine/db.js');
  const { resolveCarReference } = await import('../../lib/publisher/engine/cars.js');
  const run = (requestId, callback) => publisherContext.run({ actor: 'd1000000-0000-4000-8000-000000000001', requestId, check: async () => {} }, callback);

  const created = await run('e1000000-0000-4000-8000-000000000001', () => generateClaimedPost('f1000000-0000-4000-8000-000000000001', '2026-10-21', { universe: 'cars', moment: 'night', style: 'dynamic', carType: 'convertible', carContext: { model: 'Client supplied' } }));
  const fixed = created.car_context;
  assert.equal(fixed.requestedType, 'convertible');
  assert.equal(calls.length, 3, 'Existing mini-plan, image and editorial call count');
  assert.deepEqual(stored.car_context, fixed);
  assert.deepEqual(serializePublisherPost(stored).car_context, fixed);
  assert.deepEqual(created.music.map(song => song.id), [1, 2, 3]);
  const imageRequest = calls.find(call => call.name === 'image').request;
  assert.ok(imageRequest.prompt.includes(fixed.manufacturer));
  assert.ok(imageRequest.prompt.includes(fixed.model));
  assert.ok(imageRequest.prompt.includes(fixed.variant));
  assert.doesNotMatch(imageRequest.prompt, /Ferrari|six doors|CGI city|fixed roof/);
  assert.equal(imageRequest.n, 1);
  assert.equal(imageRequest.quality, 'medium');
  assert.equal(imageRequest.size, '1024x1280');
  for (const call of calls.filter(call => call.input)) {
    assert.ok(JSON.stringify(call.input.reference_automobile_immuable).includes(fixed.referenceId));
  }

  const firstImage = stored.image_url;
  calls.length = 0;
  const regenerated = await run('e1000000-0000-4000-8000-000000000002', () => regenerateImage('f1000000-0000-4000-8000-000000000002', { ...stored }));
  assert.deepEqual(regenerated.car_context, fixed);
  assert.equal(calls.length, 2, 'Existing prompt + image regeneration call count');
  assert.notEqual(stored.image_url, firstImage);
  assert.deepEqual(stored.alternative_music_ids, [2, 3]);
  assert.equal(deleted.includes(firstImage), true);

  const imageBeforeText = stored.image_url, musicBeforeText = [stored.primary_music_id, ...stored.alternative_music_ids];
  calls.length = 0;
  await run('e1000000-0000-4000-8000-000000000003', () => regenerateText('f1000000-0000-4000-8000-000000000003', { ...stored }));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].input.car_context, fixed);
  assert.equal(stored.image_url, imageBeforeText);
  assert.deepEqual([stored.primary_music_id, ...stored.alternative_music_ids], musicBeforeText);
  assert.deepEqual(stored.car_context, fixed);

  // COALESCE in the journal must return the first reference even if a caller
  // proposes another reference during a recovery of that same operation.
  await run('e1000000-0000-4000-8000-000000000001', async () => {
    const recovered = await persistOperationCarContext(resolveCarReference('suv', [], 'different'));
    assert.deepEqual(recovered, fixed);
  });

  // Old images retain no attribution. A failed explicit regeneration journals
  // its attempted new reference, but writes neither that reference nor image.
  stored = { ...stored, car_context: null };
  assert.equal(Object.hasOwn(serializePublisherPost(stored), 'car_context'), false);
  failSave = true; calls.length = 0;
  await assert.rejects(() => run('e1000000-0000-4000-8000-000000000004', () => regenerateImage('f1000000-0000-4000-8000-000000000004', { ...stored })), /Injected car save failure/);
  assert.equal(stored.car_context, null);
  assert.equal(stored.image_url, imageBeforeText);
  assert.equal(journal.get('e1000000-0000-4000-8000-000000000004').requestedType, 'auto');

  failSave = false; calls.length = 0;
  const oldRegenerated = await run('e1000000-0000-4000-8000-000000000005', () => regenerateImage('f1000000-0000-4000-8000-000000000005', { ...stored }));
  assert.equal(oldRegenerated.car_context.requestedType, 'auto');
  assert.notEqual(stored.image_url, imageBeforeText);
  assert.deepEqual(stored.car_context, oldRegenerated.car_context);
});
