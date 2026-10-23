/** Real generation flow with simulated database/model/blob boundaries.
 * No paid model request, image generation or Instagram request is performed.
 * Run with node --experimental-test-module-mocks --test this-file.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

await test('music shortages do not block editorial or image generation', async t => {
  const plan = {
    scene_summary: 'Sunlight crosses a distant coastal headland with calm open water.',
    visual_signature: 'Soft coastal morning and open horizon',
    image_prompt: 'A quiet Mediterranean coastline in soft morning sunlight, viewed across clear open water with natural editorial realism, no people, logos or text.',
    format: 'Feed 4:5',
  };
  const caption = 'The sea opens under a quiet morning sky. Book your next escape to the French Riviera with One Address Riviera.';
  const hashtags = ['#Coast', '#Riviera', '#Morning', '#Sea'];
  const previousDatabase = process.env.PUBLISHER_DATABASE_URL;
  process.env.PUBLISHER_DATABASE_URL = 'postgresql://fiction@127.0.0.1:55532/publisher_music_unit';
  t.after(() => {
    if (previousDatabase === undefined) delete process.env.PUBLISHER_DATABASE_URL;
    else process.env.PUBLISHER_DATABASE_URL = previousDatabase;
  });
  let music = [], saved, requests, uploads, progress, recentMusicIds = [], modelSuggestions;
  const reset = songs => {
    music = songs; saved = undefined; requests = []; uploads = []; progress = []; recentMusicIds = [];
    modelSuggestions = undefined;
    plan.format = 'Feed 4:5';
  };
  const reference = (id, context = 'feed') => ({
    id, title: `Fixture track ${id}`, artist: `Fixture artist ${id}`, version: 'Original mix',
    availability_status: 'available', last_used_at: null,
    verification: {
      status: 'confirmed', method: 'manual_instagram', checked_at: new Date().toISOString(),
      account: 'one-address-riviera', context,
      title: `Fixture track ${id}`, artist: `Fixture artist ${id}`, version: 'Original mix',
    },
  });
  t.mock.module(new URL('../../lib/publisher/engine/db.js', import.meta.url), { exports: {
    generationContext: async () => ({ music, recentMusicIds, recentContent: [] }),
    saveGeneratedPost: async (runId, generated, selectedMusic, image) => {
      saved = { id: runId, ...generated, music: selectedMusic, image_url: image.url };
      return saved;
    },
    hydratePostWithMusic: async post => post,
    updateGenerationProgress: async (_runId, next) => { progress.push(next); },
    committedPostForRun: async () => saved?.id || null,
    isPublisherImageReferenced: async () => false,
    failGeneration: async () => assert.fail('A shortage must not fail generation'),
    cancelRegeneration: async () => assert.fail('Initial generation must not cancel a regeneration'),
    finishImageRegeneration: async () => assert.fail('Initial generation must not regenerate an image'),
    finishTextRegeneration: async () => assert.fail('Initial generation must not regenerate text'),
    isCarPost: () => false,
    persistOperationCarContext: async () => assert.fail('Landscape generation must not lock a car reference'),
    recentCarReferences: async () => [],
  } });
  t.mock.module(new URL('../../lib/publisher/engine/provider.js', import.meta.url), { exports: {
    client: () => ({
      responses: { parse: async request => {
        requests.push(request);
        if (request.text.format.name === 'publisher_creative_plan') return { output_parsed: plan };
        assert.equal(request.text.format.name, 'publisher_editorial_package');
        const input = JSON.parse(request.input.find(item => item.role === 'user').content);
        assert.equal(input.contraintes.musiques, Math.min(input.musiques_eligibles.length, 3));
        assert.ok(input.musiques_eligibles.every(song => song.version === 'Original mix'));
        return { output_parsed: { caption, hashtags, music: modelSuggestions || input.musiques_eligibles.slice(0, 3), location: 'French Riviera' } };
      } },
      images: { generate: async request => {
        requests.push(request);
        return { data: [{ b64_json: Buffer.from('simulated-image-bytes').toString('base64') }] };
      } },
    }),
    put: async (pathname, _body, options) => {
      uploads.push({ pathname, options });
      return { url: `https://fixture.private.blob.vercel-storage.com/${pathname}`, pathname, contentType: 'image/jpeg' };
    },
    del: async () => assert.fail('Successful generation must retain its image'),
  } });
  const { generateClaimedPost } = await import('../../lib/publisher/engine/generation.js');
  const generate = () => generateClaimedPost('b5000000-0000-4000-8000-000000000001', '2026-10-23', {
    universe: 'landscapes', moment: 'morning', style: 'escape',
  });
  const assertContent = post => {
    assert.equal(post.caption, caption);
    assert.equal(post.image_prompt, plan.image_prompt);
    assert.equal(post.location, 'French Riviera');
    assert.equal(requests.filter(request => request.text?.format.name === 'publisher_creative_plan').length, 1);
    assert.equal(requests.filter(request => request.text?.format.name === 'publisher_editorial_package').length, 1);
    assert.equal(requests.filter(request => request.output_format === 'jpeg').length, 1);
    assert.equal(requests.find(request => request.output_format === 'jpeg').n, 1);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].options.access, 'private');
    assert.ok(progress.some(value => value.editorial === 'done' && value.music === 'done'));
  };

  for (let count = 0; count <= 3; count += 1) {
    await t.test(`${count} confirmed references produce exactly ${count} choices with the same provider call count`, async () => {
      reset(Array.from({ length: count }, (_, index) => reference(index + 1)));
      const post = await generate();
      assert.equal(post.music.length, count);
      assertContent(post);
    });
  }
  await t.test('legacy available and unknown references never fill a shortage', async () => {
    reset([
      { id: 1, title: 'Legacy available', artist: 'Fixture', availability_status: 'available' },
      { id: 2, title: 'Legacy unknown', artist: 'Fixture', availability_status: 'unknown' },
      reference(3),
    ]);
    const post = await generate();
    assert.deepEqual(post.music.map(song => song.id), [3]);
    assertContent(post);
  });
  await t.test('out-of-catalogue model suggestions cannot create an unverified music choice', async () => {
    reset([]);
    modelSuggestions = [{ title: 'Unverified model suggestion', artist: 'Unverified artist', version: null }];
    const post = await generate();
    assert.deepEqual(post.music, []);
    assertContent(post);
  });
  await t.test('editorial music ranking retains the exact canonical version', async () => {
    const first = reference(1), second = reference(2);
    reset([first, second]);
    modelSuggestions = [second, first].map(({ title, artist, version }) => ({ title, artist, version }));
    const post = await generate();
    assert.deepEqual(post.music.map(song => song.id), [2, 1]);
    assertContent(post);
  });
  await t.test('Reel generation uses confirmations from the Reel context', async () => {
    reset([reference(1, 'feed'), reference(2, 'reel')]);
    plan.format = 'Reel';
    const post = await generate();
    assert.deepEqual(post.music.map(song => song.id), [2]);
    assertContent(post);
  });
  await t.test('recently used confirmed references stay excluded without blocking content', async () => {
    reset([reference(1), reference(2)]);
    recentMusicIds = [1, 2];
    const post = await generate();
    assert.deepEqual(post.music, []);
    assertContent(post);
  });
});
