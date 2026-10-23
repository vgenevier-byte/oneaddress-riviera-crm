/** Real generation/rules/serialization run with simulated provider + SQL boundaries.
 * The separate cars bench verifies the same writes through actual local Postgres.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const contradictoryCarBranding = /aucun texte, logo|sans marque visible|No[^.\n]*(?:visible logo|readable brand)|discreet framing around badges/i;

function assertFactoryBadges(prompt, reference) {
  for (const key of ['referenceId', 'manufacturer', 'model', 'generation', 'variant']) {
    assert.ok(prompt.includes(reference[key]), `Locked ${key} reaches images.generate()`);
  }
  for (const phrase of [
    'original factory manufacturer emblems, monograms, badges and lettering',
    'physical markings on the vehicle, distinct from text or logos added over the image',
    'original front and rear markings at their actual factory locations whenever those areas are visible',
    'A front view shows the front markings; a rear view shows the rear markings',
    'never force both faces into one image, add a second vehicle or create a montage',
    'shape, size, position, colour, finish and orientation',
    'photographic perspective, lighting, reflections and sharpness',
    'Preserve factory manufacturer lettering', 'never replace it with a generic emblem',
    'No invented, deformed, mirrored, duplicated or borrowed badges',
    'Do not deliberately hide badges or frame them out',
    'natural legibility at the shooting distance; never artificially enlarge logos',
    'No added text, advertising copy, superimposed logos, watermark, signature, readable number plate or recognisable face',
    'One principal production vehicle only',
  ]) assert.ok(prompt.includes(phrase), phrase);
  assert.doesNotMatch(prompt, contradictoryCarBranding);
}

function assertCarProviderPrompts(calls, reference) {
  assertFactoryBadges(calls.find(call => call.name === 'image').request.prompt, reference);
  for (const call of calls.filter(call => call.input)) {
    const prompt = JSON.stringify(call.request.input);
    assert.doesNotMatch(prompt, contradictoryCarBranding, `${call.name} must not prohibit physical factory branding`);
    assert.match(prompt, /marquages physiques constructeur d’origine/);
    if (['publisher_creative_plan', 'publisher_image_prompt'].includes(call.name)) {
      assertFactoryBadges(call.input.regles_automobiles, reference);
    }
  }
}

await test('car generation freezes one server reference at the provider boundary and keeps it across regenerations', async t => {
  const { publisherContext } = await import('../../lib/publisher/engine/context.js');
  const postId = 'c1000000-0000-4000-8000-000000000001';
  const music = [1, 2, 3].map(id => ({ id, title: `Fixture song ${id}`, artist: 'Fixture artist', availability_status: 'available', revision: 1, times_used: 0 }));
  const calls = [], deleted = [], journal = new Map();
  let stored = { id: postId, revision: 1, post_date: '2026-10-21', status: 'draft', generation_status: 'generating', creative_universe: 'Voitures', creative_moment: 'Nuit', creative_style: 'Dynamique', format: 'Feed 4:5' };
  let failSave = false, recentContent = [], selectedFormat = 'Feed 4:5', planningVariant = null, regeneratedVisualVariant = null;
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
      if (text.includes('post_date >')) return recentContent;
      if (text.startsWith('SELECT')) return [];
      if (text.startsWith('UPDATE publisher_posts SET')) {
        const writingImage = text.includes('image_url =');
        if (writingImage && failSave) throw new Error('Injected car save failure');
        const next = { ...stored };
        for (const field of ['theme', 'moment', 'creative_universe', 'creative_moment', 'creative_style', 'scene_summary', 'visual_signature', 'caption', 'hashtags', 'primary_music_id', 'alternative_music_ids', 'location', 'format', 'image_url', 'image_pathname', 'image_prompt', 'car_context']) {
          const match = text.match(new RegExp(`\\b${field}\\s*=\\s*\\$(\\d+)`));
          if (match) next[field] = field === 'car_context' ? JSON.parse(values[Number(match[1]) - 1]) : values[Number(match[1]) - 1];
        }
        const sceneMatch = text.match(/\bscene_summary\s*=\s*COALESCE\(\$(\d+),\s*scene_summary\)/);
        if (sceneMatch && values[Number(sceneMatch[1]) - 1] !== null) next.scene_summary = values[Number(sceneMatch[1]) - 1];
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
        const isCar = Boolean(input.reference_automobile_immuable || input.car_context);
        if (isCar) assert.ok(journal.has(publisherContext.getStore().requestId), 'Canonical identity must be journaled before any provider call');
        const visual = isCar
          ? { image_prompt: 'A fictional Client Fake Six Wheel Phantom SUV with six doors and a fixed roof in an impossible CGI city. No visible logo, readable brand.', visual_signature: 'A Client Fake Six Wheel Phantom SUV with six doors in an impossible CGI city' }
          : { image_prompt: 'A quiet Mediterranean scene in natural editorial light, without text, logos or people.', visual_signature: 'Natural Mediterranean light and a calm open horizon.' };
        if (name === 'publisher_creative_plan') return { output_parsed: { ...visual, scene_summary: isCar ? 'A fictional Client Fake Six Wheel Phantom SUV with six doors in an impossible CGI city.' : 'A quiet Mediterranean scene in natural editorial light.', ...planningVariant, format: selectedFormat } };
        if (name === 'publisher_image_prompt') return { output_parsed: { ...visual, ...regeneratedVisualVariant } };
        const editorial = { caption: 'The coast settles into a quieter rhythm. Evening brings a new perspective.', hashtags: ['#Riviera', '#CoastalRoad', '#EveningLight', '#Mediterranean'] };
        return { output_parsed: name === 'publisher_editorial_package' ? { ...editorial, music, location: 'French Riviera' } : editorial };
      } },
      images: { generate: async request => { calls.push({ name: 'image', request }); return { data: [{ b64_json: Buffer.from('fictional-image-bytes').toString('base64') }] }; } },
    }),
    put: async pathname => ({ url: `https://fixture.private.blob.vercel-storage.com/${pathname}`, pathname, contentType: 'image/jpeg' }),
    del: async url => { deleted.push(url); },
  } });
  const { generateClaimedPost, regenerateImage, regenerateText, carSceneForRun } = await import('../../lib/publisher/engine/generation.js');
  const { serializePublisherPost, persistOperationCarContext } = await import('../../lib/publisher/engine/db.js');
  const { resolveCarReference } = await import('../../lib/publisher/engine/cars.js');
  const run = (requestId, callback) => publisherContext.run({ actor: 'd1000000-0000-4000-8000-000000000001', requestId, check: async () => {} }, callback);

  const selection = { carType: 'convertible', carBrand: 'porsche', carModel: 'porsche-911-carrera-cabriolet-2024' };
  const created = await run('e1000000-0000-4000-8000-000000000001', () => generateClaimedPost('f1000000-0000-4000-8000-000000000001', '2026-10-21', { universe: 'cars', moment: 'night', style: 'dynamic', ...selection, carContext: { model: 'Client supplied' } }));
  const fixed = created.car_context;
  assert.equal(fixed.requestedType, 'convertible');
  assert.equal(fixed.requestedBrand, selection.carBrand);
  assert.equal(fixed.requestedModel, selection.carModel);
  assert.equal(fixed.referenceId, selection.carModel);
  assert.equal(calls.length, 3, 'Existing mini-plan, image and editorial call count');
  assert.deepEqual(stored.car_context, fixed);
  assert.deepEqual(serializePublisherPost(stored).car_context, fixed);
  assert.deepEqual(created.music.map(song => song.id), [1, 2, 3]);
  const imageRequest = calls.find(call => call.name === 'image').request;
  assertCarProviderPrompts(calls, fixed);
  assert.ok(imageRequest.prompt.includes(fixed.manufacturer));
  assert.ok(imageRequest.prompt.includes(fixed.model));
  assert.ok(imageRequest.prompt.includes(fixed.variant));
  assert.doesNotMatch(imageRequest.prompt, /Client Fake|Six Wheel Phantom|six doors|CGI city|fixed roof/);
  assert.equal(imageRequest.n, 1);
  assert.equal(imageRequest.quality, 'medium');
  assert.equal(imageRequest.size, '1024x1280');
  for (const call of calls.filter(call => call.input)) {
    assert.ok(JSON.stringify(call.input.reference_automobile_immuable).includes(fixed.referenceId));
  }
  const editorialInput = calls.find(call => call.name === 'publisher_editorial_package').input;
  assert.doesNotMatch(JSON.stringify(editorialInput), /Client Fake|Six Wheel Phantom|six doors|CGI city|fixed roof/);
  assert.equal(editorialInput.mini_plan.format, 'Feed 4:5');
  assert.equal(editorialInput.mini_plan.scene_summary, created.scene_summary);
  assert.equal(editorialInput.mini_plan.visual_signature, created.visual_signature);
  assert.ok(imageRequest.prompt.includes(created.scene_summary));
  assert.ok(imageRequest.prompt.includes(created.visual_signature));
  assert.equal(created.scene_summary, carSceneForRun('f1000000-0000-4000-8000-000000000001'));
  assert.doesNotMatch(JSON.stringify({ scene: stored.scene_summary, signature: stored.visual_signature }), /Client Fake|Six Wheel Phantom|six doors|CGI city/);

  const firstImage = stored.image_url;
  calls.length = 0;
  const regenerated = await run('e1000000-0000-4000-8000-000000000002', () => regenerateImage('f1000000-0000-4000-8000-000000000002', { ...stored }));
  assert.deepEqual(regenerated.car_context, fixed);
  assert.equal(calls.length, 2, 'Existing prompt + image regeneration call count');
  assertCarProviderPrompts(calls, fixed);
  assert.doesNotMatch(calls.find(call => call.name === 'image').request.prompt, /Client Fake|Six Wheel Phantom|six doors|CGI city|fixed roof/);
  assert.doesNotMatch(stored.visual_signature, /Client Fake|Six Wheel Phantom|six doors|CGI city/);
  assert.notEqual(stored.image_url, firstImage);
  assert.deepEqual(stored.alternative_music_ids, [2, 3]);
  assert.equal(deleted.includes(firstImage), true);

  const imageBeforeText = stored.image_url, musicBeforeText = [stored.primary_music_id, ...stored.alternative_music_ids];
  calls.length = 0;
  await run('e1000000-0000-4000-8000-000000000003', () => regenerateText('f1000000-0000-4000-8000-000000000003', { ...stored }));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].input.car_context, fixed);
  assert.equal(calls[0].input.scene_summary, stored.scene_summary, 'Neutral fallback remains available to later text regeneration');
  assert.equal(calls[0].input.visual_signature, stored.visual_signature);
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
  const preservedFailureFields = ['image_url', 'image_pathname', 'image_prompt', 'scene_summary', 'visual_signature', 'caption', 'hashtags', 'car_context', 'primary_music_id', 'alternative_music_ids'];
  const beforeFailure = Object.fromEntries(preservedFailureFields.map(field => [field, stored[field]]));
  const oldImageDeletions = deleted.filter(url => url === stored.image_url).length;
  assert.equal(Object.hasOwn(serializePublisherPost(stored), 'car_context'), false);
  failSave = true; calls.length = 0;
  await assert.rejects(() => run('e1000000-0000-4000-8000-000000000004', () => regenerateImage('f1000000-0000-4000-8000-000000000004', { ...stored })), /Injected car save failure/);
  assert.equal(stored.car_context, null);
  assert.equal(stored.image_url, imageBeforeText);
  assert.deepEqual(Object.fromEntries(preservedFailureFields.map(field => [field, stored[field]])), beforeFailure, 'Failed image commit preserves all old descriptors/media/caption/music');
  assert.equal(deleted.filter(url => url === stored.image_url).length, oldImageDeletions, 'Old image is never deleted on save failure');
  assert.equal(journal.get('e1000000-0000-4000-8000-000000000004').requestedType, 'auto');

  failSave = false; calls.length = 0;
  const oldRegenerated = await run('e1000000-0000-4000-8000-000000000005', () => regenerateImage('f1000000-0000-4000-8000-000000000005', { ...stored }));
  assertCarProviderPrompts(calls, oldRegenerated.car_context);
  assert.equal(oldRegenerated.car_context.requestedType, 'auto');
  assert.notEqual(stored.image_url, imageBeforeText);
  assert.deepEqual(stored.car_context, oldRegenerated.car_context);

  // Safe variable scene descriptions must not turn four stationary fallbacks
  // into an implicit four-creation limit. Keep a growing recent history and the
  // same explicitly selected model throughout more than four generations.
  recentContent = [];
  selectedFormat = 'Reel';
  const variants = [
    { scene_summary: 'A quiet coastal turnout overlooks pale turquoise water and distant limestone cliffs.', visual_signature: 'The horizon is wide above coarse grey tarmac and a soft band of sea haze.' },
    { scene_summary: 'A mineral courtyard opens between tall pines and a shaded stone wall.', visual_signature: 'The foreground holds small gravel textures while irregular foliage shadows cross cream paving.' },
    { scene_summary: 'A peaceful hillside lane curves beside olive terraces under gentle amber light.', visual_signature: 'Warm terracotta earth and silvery leaves frame a long diagonal towards layered hills.' },
    { scene_summary: 'A plain esplanade faces a calm open bay beneath thin rose clouds.', visual_signature: 'The composition places a broad peach sky above horizontal harbour reflections.' },
    { scene_summary: 'A discreet cypress-lined entrance meets an ochre facade with a shadowed arched passage.', visual_signature: 'Natural side light traces rough plaster and slender dark trunks in a balanced symmetrical frame.' },
    { scene_summary: 'A broad sandy overlook borders low dune grasses and wind-shaped scrub.', visual_signature: 'Soft light reveals beige grains against a deep azure sea and sparse silver foliage.' },
  ];
  // Preserve a historical descriptor from the published implementation without
  // rewriting it into one of the new English scenery pairs.
  recentContent.push({ post_date: '2026-10-21', scene_summary: 'Une seule voiture stationnée sur un dégagement autorisé d’une route côtière méditerranéenne plausible, mer en arrière-plan, chaussée sèche.', visual_signature: 'Historic fallback with a distinct prior caption.', caption: 'Historic fallback caption.' });
  const actualImagePrompts = new Set();
  for (const [index, variant] of variants.entries()) {
    const runId = `scene-${index}`;
    planningVariant = variant;
    calls.length = 0;
    const next = await run(`repeat-${index}`, () => generateClaimedPost(runId, '2026-10-21', { universe: 'cars', moment: 'day', style: 'elegant', carType: 'suv', carBrand: 'land-rover', carModel: 'range-rover-l460-swb-se' }));
    assert.equal(next.car_context.referenceId, 'range-rover-l460-swb-se');
    assert.equal(next.car_context.requestedModel, 'range-rover-l460-swb-se');
    assert.equal(next.format, 'Reel', 'Model still chooses the current format');
    assert.equal(next.scene_summary, variant.scene_summary, 'Safe scene remains variable');
    assert.equal(next.visual_signature, variant.visual_signature, 'Safe composition remains variable');
    assert.equal(calls.find(call => call.name === 'image').request.size, '1024x1536');
    const actualImagePrompt = calls.find(call => call.name === 'image').request.prompt;
    const actualEditorialPlan = calls.find(call => call.name === 'publisher_editorial_package').input.mini_plan;
    assert.ok(actualImagePrompt.includes(next.scene_summary));
    assert.ok(actualImagePrompt.includes(next.visual_signature));
    assert.equal(actualEditorialPlan.scene_summary, next.scene_summary);
    assert.equal(actualEditorialPlan.visual_signature, next.visual_signature);
    actualImagePrompts.add(actualImagePrompt);
    assert.equal(calls.length, 3);
    // A unique caption keeps this focused on scene similarity, not the separate
    // exact-caption guard, which remains covered by rules.test.js.
    recentContent.push({ ...next, caption: `Unique historic caption ${index}` });
  }
  assert.equal(actualImagePrompts.size, 6, 'Six approved scenery pairs reach six distinct actual image requests');

  // Two isolated operation journals can use the same run while proposing a
  // different approved scene. The image request must change with the decor,
  // while the catalogue identity is exactly the same.
  recentContent = [];
  const sameRunImages = [], sameRunPosts = [];
  for (const [index, variant] of [variants[1], variants[0]].entries()) {
    planningVariant = variant;
    calls.length = 0;
    const result = await run(`same-run-journal-${index}`, () => generateClaimedPost('same-run-scenery', '2026-10-21', { universe: 'cars', moment: 'day', style: 'elegant', carType: 'suv', carBrand: 'land-rover', carModel: 'range-rover-l460-swb-se' }));
    const request = calls.find(call => call.name === 'image').request;
    assert.ok(request.prompt.includes(variant.scene_summary));
    assert.ok(request.prompt.includes(variant.visual_signature));
    assert.equal(calls.find(call => call.name === 'publisher_editorial_package').input.mini_plan.scene_summary, variant.scene_summary);
    assert.equal(calls.length, 3);
    sameRunImages.push(request.prompt);
    sameRunPosts.push(result);
  }
  assert.notEqual(sameRunImages[0], sameRunImages[1]);
  assert.deepEqual(sameRunPosts[0].car_context, sameRunPosts[1].car_context);
  assert.doesNotMatch(sameRunImages[0], /pale turquoise water and distant limestone cliffs/);
  assert.doesNotMatch(sameRunImages[1], /between tall pines and a shaded stone wall/);

  // Reject either member as a whole pair. An accepted courtyard must never be
  // combined with a fallback coastal signature or an incompatible time of day.
  for (const [index, proposal] of [
    { ...variants[1], visual_signature: 'a countach in a quiet courtyard' },
    { ...variants[1], scene_summary: 'a phantom in a quiet courtyard' },
    { ...variants[1], visual_signature: 'Morning light traces rough plaster and slender dark trunks.' },
    { ...variants[1], visual_signature: 'Low afternoon light reveals soft beige grains.' },
  ].entries()) {
    planningVariant = proposal;
    calls.length = 0;
    const runId = `pair-fallback-${index}`;
    const result = await run(`pair-fallback-journal-${index}`, () => generateClaimedPost(runId, '2026-10-21', { universe: 'cars', moment: index === 2 ? 'night' : 'day', style: 'elegant', carType: 'suv', carBrand: 'land-rover', carModel: 'range-rover-l460-swb-se' }));
    const actualImage = calls.find(call => call.name === 'image').request.prompt;
    const actualEditorial = calls.find(call => call.name === 'publisher_editorial_package').input.mini_plan;
    assert.equal(result.scene_summary, carSceneForRun(runId));
    assert.equal(actualEditorial.scene_summary, result.scene_summary);
    assert.equal(actualEditorial.visual_signature, result.visual_signature);
    assert.ok(actualImage.includes(result.scene_summary));
    assert.ok(actualImage.includes(result.visual_signature));
    assert.notEqual(result.visual_signature, proposal.visual_signature);
    assert.doesNotMatch(result.scene_summary + ' ' + result.visual_signature, /morning|afternoon|evening/i);
  }

  // Image regeneration's existing schema has one signature. Request it as a
  // complete autonomous decor/composition and persist the same string in both
  // descriptors atomically with the successful replacement image.
  const newScenery = variants[1].visual_signature;
  regeneratedVisualVariant = { visual_signature: newScenery };
  const beforeSceneryRegeneration = { ...stored };
  calls.length = 0;
  const sceneryRegenerated = await run('coherent-image-regeneration', () => regenerateImage('coherent-image-regeneration-run', { ...stored }));
  assert.equal(calls.length, 2);
  assert.equal(sceneryRegenerated.scene_summary, newScenery);
  assert.equal(sceneryRegenerated.visual_signature, newScenery);
  assert.ok(calls.find(call => call.name === 'image').request.prompt.includes(newScenery));
  assert.notEqual(stored.image_url, beforeSceneryRegeneration.image_url);
  assert.equal(sceneryRegenerated.caption, beforeSceneryRegeneration.caption);
  assert.deepEqual(sceneryRegenerated.car_context, beforeSceneryRegeneration.car_context);
  const imageAfterSceneryRegeneration = stored.image_url;
  const musicAfterSceneryRegeneration = [stored.primary_music_id, ...stored.alternative_music_ids];
  calls.length = 0;
  await run('coherent-text-regeneration', () => regenerateText('coherent-text-regeneration-run', { ...stored }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.scene_summary, newScenery);
  assert.equal(calls[0].input.visual_signature, newScenery);
  assert.equal(stored.image_url, imageAfterSceneryRegeneration);
  assert.deepEqual([stored.primary_music_id, ...stored.alternative_music_ids], musicAfterSceneryRegeneration);
  regeneratedVisualVariant = null;

  // Existing nine-field contexts are not rewritten/enriched. Free prose from
  // before this change can name another vehicle: do not send it as authority
  // to either text provider, and leave the stored old fields alone on text-only
  // regeneration. These assertions inspect the actual responses.parse calls.
  const legacyContext = resolveCarReference('suv', [], 'historical-nine-field');
  assert.equal(Object.hasOwn(legacyContext, 'requestedBrand'), false);
  stored = {
    ...stored, car_context: legacyContext,
    scene_summary: 'A Client Fake Six Wheel Phantom with a folding roof drives through a fictional city.',
    visual_signature: 'Client Fake Six Wheel Phantom; open roof; six doors and an enormous rear wing.',
    caption: 'A Client Fake Six Wheel Phantom awaits beside the sea.',
    hashtags: ['#ClientFake', '#SixWheelPhantom', '#Convertible', '#Riviera'],
  };
  const historicalScene = stored.scene_summary;
  const historicalSignature = stored.visual_signature;
  const historicalImage = stored.image_url;
  const historicalMusic = [stored.primary_music_id, ...stored.alternative_music_ids];
  calls.length = 0;
  await run('historical-text', () => regenerateText('historical-text-run', { ...stored }));
  assert.equal(calls.length, 1, 'Existing one-call text regeneration count');
  const textInput = calls[0].input;
  assert.deepEqual(textInput.car_context, legacyContext);
  assert.doesNotMatch(JSON.stringify(textInput), /Client Fake|Six Wheel Phantom|ClientFake|SixWheelPhantom|folding roof|open roof|six doors|rear wing/);
  for (const key of ['scene_summary', 'visual_signature', 'caption', 'hashtags']) assert.equal(Object.hasOwn(textInput, key), false);
  assert.equal(stored.scene_summary, historicalScene);
  assert.equal(stored.visual_signature, historicalSignature);
  assert.equal(stored.image_url, historicalImage);
  assert.deepEqual([stored.primary_music_id, ...stored.alternative_music_ids], historicalMusic);
  assert.deepEqual(stored.car_context, legacyContext);

  // Simulate another untouched historical caption to verify image regeneration
  // does not forward the free caption/hashtags through creativePost's spread.
  const historicalInput = { ...stored, caption: 'A Client Fake Six Wheel Phantom awaits beside the sea.', hashtags: ['#ClientFake', '#SixWheelPhantom'] };
  calls.length = 0;
  await run('historical-image', () => regenerateImage('historical-image-run', historicalInput));
  assert.equal(calls.length, 2, 'Existing prompt plus one image regeneration count');
  const imageTextInput = calls.find(call => call.input).input;
  assert.deepEqual(imageTextInput.car_context, legacyContext);
  assert.doesNotMatch(JSON.stringify(imageTextInput), /Client Fake|Six Wheel Phantom|ClientFake|SixWheelPhantom|folding roof|open roof|six doors|rear wing/);
  assert.equal(Object.hasOwn(imageTextInput, 'caption'), false);
  assert.equal(Object.hasOwn(imageTextInput, 'hashtags'), false);
  assert.doesNotMatch(calls.find(call => call.name === 'image').request.prompt, /Client Fake|Six Wheel Phantom|ClientFake|SixWheelPhantom|folding roof|open roof|six doors|rear wing/);
  assert.deepEqual(stored.car_context, legacyContext);
  assert.deepEqual([stored.primary_music_id, ...stored.alternative_music_ids], historicalMusic);

  // Off-reference lower-case model names and new anatomy must also be rejected. A
  // closed vocabulary must not depend on keeping a manufacturer blacklist up
  // to date. Inspect creation/editorial and both regeneration provider paths.
  const identityAttacks = [
    'a countach in a quiet courtyard',
    'a vantage with a removable t-top above a shaded courtyard',
    'a phantom with polished carbon-fibre aero extensions in a quiet courtyard',
  ];
  const attackWords = /countach|vantage|phantom|removable|t-top|carbon.fibre|aero extensions/iu;
  recentContent = [];
  for (const [index, attack] of identityAttacks.entries()) {
    planningVariant = { scene_summary: attack, visual_signature: attack };
    calls.length = 0;
    const createdSafe = await run(`unknown-create-${index}`, () => generateClaimedPost(`unknown-create-run-${index}`, '2026-10-21', { universe: 'cars', moment: 'day', style: 'elegant', carType: 'suv', carBrand: 'land-rover', carModel: 'range-rover-l460-swb-se' }));
    assert.equal(calls.length, 3);
    assert.doesNotMatch(JSON.stringify(calls.find(call => call.name === 'publisher_editorial_package').input), attackWords);
    assert.doesNotMatch(calls.find(call => call.name === 'image').request.prompt, attackWords);
    assert.doesNotMatch(createdSafe.scene_summary + ' ' + createdSafe.visual_signature, attackWords);

    const riskyHistorical = { ...stored, car_context: legacyContext, scene_summary: attack, visual_signature: attack, caption: attack, hashtags: [`#${attack.split(' ')[1]}`] };
    calls.length = 0;
    await run(`unknown-text-${index}`, () => regenerateText(`unknown-text-run-${index}`, riskyHistorical));
    assert.equal(calls.length, 1);
    assert.doesNotMatch(JSON.stringify(calls[0].input), attackWords);
    assert.deepEqual(calls[0].input.car_context, legacyContext);

    regeneratedVisualVariant = { visual_signature: attack };
    calls.length = 0;
    await run(`unknown-image-${index}`, () => regenerateImage(`unknown-image-run-${index}`, riskyHistorical));
    assert.equal(calls.length, 2);
    assert.doesNotMatch(JSON.stringify(calls.find(call => call.input).input), attackWords);
    assert.doesNotMatch(calls.find(call => call.name === 'image').request.prompt, attackWords);
    assert.doesNotMatch(stored.visual_signature, attackWords);
    assert.deepEqual(stored.car_context, legacyContext);
  }

  // A legacy car image has no previous attribution. Explicit image regeneration
  // resolves/journals one reference before the text call, so that reference must
  // also govern the provider context instead of the original null context.
  stored = {
    ...stored, car_context: null, caption: 'A Client Fake Six Wheel Phantom awaits beside the sea.',
    hashtags: ['#ClientFake', '#SixWheelPhantom'], scene_summary: 'A Client Fake Six Wheel Phantom in a quiet courtyard.',
    visual_signature: 'Client Fake Six Wheel Phantom with an open folding roof.',
  };
  regeneratedVisualVariant = null;
  calls.length = 0;
  const legacyImageResult = await run('legacy-unattributed-image', () => regenerateImage('legacy-unattributed-image-run', { ...stored }));
  assert.equal(calls.length, 2, 'Legacy image regeneration still calls one text and one image provider');
  const legacyImageTextInput = calls.find(call => call.input).input;
  assert.ok(legacyImageTextInput.car_context?.referenceId);
  assert.deepEqual(legacyImageTextInput.car_context, journal.get('legacy-unattributed-image'));
  assert.doesNotMatch(JSON.stringify(legacyImageTextInput), /Client Fake|Six Wheel Phantom|ClientFake|SixWheelPhantom|folding roof/);
  assert.equal(Object.hasOwn(legacyImageTextInput, 'caption'), false);
  assert.equal(Object.hasOwn(legacyImageTextInput, 'hashtags'), false);
  assert.deepEqual(legacyImageResult.car_context, legacyImageTextInput.car_context);
  assertCarProviderPrompts(calls, legacyImageResult.car_context);

  // The default automatic selection must use the same physical-badge rules as
  // the explicit brand/model route, without changing the three-call workflow.
  recentContent = []; planningVariant = null; selectedFormat = 'Feed 4:5';
  calls.length = 0;
  const automatic = await run('automatic-badges', () => generateClaimedPost('automatic-badges-run', '2026-10-21', { universe: 'cars', moment: 'day', style: 'elegant' }));
  assert.equal(calls.length, 3);
  for (const field of ['requestedType', 'requestedBrand', 'requestedModel']) assert.equal(automatic.car_context[field], 'auto');
  assertCarProviderPrompts(calls, automatic.car_context);
  assert.deepEqual(journal.get('automatic-badges'), automatic.car_context);

  // Every other universe keeps its original unbranded system/final prompt for
  // creation and image regeneration. This observes the actual image boundary.
  for (const universe of ['landscapes', 'real_estate', 'boats']) {
    calls.length = 0;
    const createdOther = await run(`non-car-${universe}`, () => generateClaimedPost(`non-car-${universe}-run`, '2026-10-21', { universe, moment: 'day', style: 'elegant' }));
    assert.equal(calls.length, 3);
    assert.equal(Object.hasOwn(createdOther, 'car_context'), false);
    const assertUnbrandedCalls = () => {
      const image = calls.find(call => call.name === 'image').request;
      assert.match(image.prompt, /aucun texte, logo, filigrane, marque visible ou visage reconnaissable/);
      assert.match(image.prompt, /Direction visuelle: A quiet Mediterranean scene/);
      assert.doesNotMatch(image.prompt, /SERVER-LOCKED AUTOMOTIVE REFERENCE|factory manufacturer emblems|marquages physiques constructeur/);
      assert.equal(image.n, 1);
      assert.equal(image.quality, 'medium');
      assert.equal(image.size, '1024x1280');
      for (const call of calls.filter(call => call.input)) {
        assert.match(call.request.input.find(item => item.role === 'system').content, /aucun texte, logo, filigrane, marque visible ou visage reconnaissable/);
        assert.equal(Object.hasOwn(call.input, 'reference_automobile_immuable'), false);
        assert.equal(Object.hasOwn(call.input, 'regles_automobiles'), false);
      }
    };
    assertUnbrandedCalls();
    calls.length = 0;
    await run(`non-car-regeneration-${universe}`, () => regenerateImage(`non-car-regeneration-${universe}-run`, { ...stored }));
    assert.equal(calls.length, 2);
    assertUnbrandedCalls();
  }
});
