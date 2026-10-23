/** Real handler, generation, normalizers and DB writes; simulated transport only.
 * Run with node --experimental-test-module-mocks --test this-file.
 * No external request, real image generation or Instagram operation is allowed.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const hashtags = ['#Riviera', '#CoastalMood', '#Mediterranean', '#PrivateEscape'];
const hook = 'The coast settles into a softer rhythm.';
const booking = 'Reserve your next escape to the French Riviera with One Address Riviera.';
const music = [1, 2, 3].map(id => ({ id, title: `Fixture song ${id}`, artist: 'Fixture artist', availability_status: 'available', revision: 1, times_used: 0 }));
const plan = {
  scene_summary: 'A quiet Mediterranean scene in natural editorial light.',
  visual_signature: 'Natural Mediterranean light and a calm open horizon.',
  image_prompt: 'A quiet Mediterranean coastline in soft morning sunlight, viewed across clear open water with natural editorial realism, no people, logos or text.',
  format: 'Feed 4:5',
};
const articleCars = [
  { manufacturer: 'Aston Martin', model: 'DBX707', article: 'an', carType: 'suv', carBrand: 'aston-martin', carModel: 'aston-martin-dbx707-suv-2024' },
  { manufacturer: 'Audi', model: 'Q8', article: 'an', carType: 'suv', carBrand: 'audi', carModel: 'audi-q8-suv-coupe-2023' },
  { manufacturer: 'Alpine', model: 'A110', article: 'an', carType: 'sports_car', carBrand: 'alpine', carModel: 'alpine-a110-second-gen-coupe' },
  { manufacturer: 'Lamborghini', model: 'Urus SE', article: 'a', carType: 'suv', carBrand: 'lamborghini', carModel: 'lamborghini-urus-se-suv-2024' },
];

function assertCaption(post, subject) {
  const sentences = post.caption.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  assert.equal(sentences.length, 2, post.caption);
  assert.equal((post.caption.match(/\b(?:book|reserve)\b/gi) || []).length, 1, 'Exactly one explicit booking invitation');
  assert.match(sentences[1], /\b(?:book|reserve)\b/i, 'The invitation is the final caption sentence');
  assert.match(sentences[1], /One Address Riviera/);
  assert.match(sentences[1], /French Riviera/);
  assert.match(sentences[1], subject);
  assert.doesNotMatch(post.caption, /\p{Extended_Pictographic}/u);
  const words = post.caption.normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z]+/gi) || [];
  assert.ok(words.length <= 36, `${words.length} words: ${post.caption}`);
  assert.match(sentences[0], /\b(?:the|a|your|with|on|in|where|of|to)\b/i, 'The hook remains English');
  assert.doesNotMatch(post.caption, /\b(?:réservez|reservez|votre|séjour|séjournez|notre|avec)\b/i);
  assert.equal(post.hashtags.length, 5);
  assert.equal(post.hashtags[0], '#OneAddressRiviera');
  assert.deepEqual(post.hashtags.slice(1), hashtags);
  assert.doesNotMatch(post.caption, /#/u, 'Hashtags remain separate from the caption');
}

await test('booking invitations reach saved captions in daily, guided and regenerated text without extra model calls', async t => {
  const actor = 'ab000000-0000-4000-8000-000000000001';
  const operations = new Map(), calls = [], writes = [], journal = new Map();
  let stored = null, proposedCaption = `${hook} The evening opens a new perspective.`;
  const environment = {
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55541',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'isolated-fictitious-publishable-key',
    PUBLISHER_DATABASE_URL: 'postgresql://fiction@127.0.0.1:55542/publisher_booking_unit',
  };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('No real network call is allowed in booking simulations'); });
  t.mock.module('@supabase/supabase-js', { exports: { createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: actor } } }) },
    rpc: async () => ({ data: true }),
  }) } });
  t.mock.module(new URL('../../lib/publisher/engine/database.js', import.meta.url), { exports: {
    query: async (text, values) => {
      if (text.startsWith('SELECT * FROM publisher_operations')) return operations.has(values[0]) ? [operations.get(values[0])] : [];
      if (text.startsWith('UPDATE publisher_operations SET state=')) {
        Object.assign(operations.get(values[0]), { state: values[1], result: JSON.parse(values[2]) });
        return [];
      }
      if (text.startsWith('UPDATE publisher_operations SET target_post_id=')) return [];
      assert.fail('Unexpected handler SQL: ' + text);
    },
    transaction: async statements => {
      const [requestId, actorId, action, fingerprint] = statements[1].values;
      const row = { request_id: requestId, actor_id: actorId, action, fingerprint, state: 'running' };
      operations.set(requestId, row);
      return [[], [row]];
    },
    sql: () => async (strings, ...values) => {
      const text = strings.reduce((result, part, index) => result + (index ? `$${index}` : '') + part, '').replace(/\s+/g, ' ').trim();
      if (text.startsWith('SELECT revision, created_by')) return [];
      if (text.includes('SELECT * FROM publisher_music')) return music;
      if (text.startsWith('SELECT * FROM publisher_posts WHERE id =')) return stored?.id === values[0] ? [{ ...stored }] : [];
      if (text.startsWith('SELECT')) return [];
      if (text.startsWith('INSERT INTO publisher_posts')) {
        stored = {
          id: values[0], revision: 1, post_date: values[1], creation_mode: text.includes("'daily'") ? 'daily' : 'guided',
          creative_universe: values[2], creative_moment: values[3], creative_style: values[4], generation_request_id: values[5],
          generation_run_id: values[6], status: 'draft', generation_status: 'generating',
        };
        return [{ ...stored }];
      }
      if (text.startsWith('UPDATE publisher_operations SET car_context = COALESCE')) {
        if (!journal.has(values[1])) journal.set(values[1], JSON.parse(values[0]));
        return [{ car_context: journal.get(values[1]) }];
      }
      if (text.startsWith('UPDATE publisher_posts SET')) {
        if (text.includes('caption =')) writes.push({ text, values: structuredClone(values) });
        for (const field of [
          'theme', 'moment', 'creative_universe', 'creative_moment', 'creative_style', 'scene_summary', 'visual_signature',
          'caption', 'hashtags', 'primary_music_id', 'alternative_music_ids', 'location', 'format',
          'image_url', 'image_pathname', 'image_prompt', 'car_context', 'generation_run_id',
        ]) {
          const match = text.match(new RegExp(`\\b${field}\\s*=\\s*\\$(\\d+)`));
          if (match) {
            const value = values[Number(match[1]) - 1];
            stored[field] = field === 'car_context' && value ? JSON.parse(value) : value;
          }
        }
        if (text.includes('caption =')) { stored.generation_status = 'ready'; stored.revision += 1; }
        return [{ ...stored }];
      }
      assert.fail('Unexpected generation SQL: ' + text);
    },
  } });
  t.mock.module(new URL('../../lib/publisher/engine/provider.js', import.meta.url), { exports: {
    assertGenerationEnabled: () => {},
    client: () => ({
      responses: { parse: async request => {
        const name = request.text.format.name;
        calls.push({ name, request });
        if (name === 'publisher_creative_plan') return { output_parsed: plan };
        assert.ok(['publisher_editorial_package', 'publisher_text'].includes(name), name);
        return { output_parsed: {
          caption: proposedCaption, hashtags,
          ...(name === 'publisher_editorial_package' ? { music, location: 'French Riviera' } : {}),
        } };
      } },
      images: { generate: async request => {
        calls.push({ name: 'image', request });
        return { data: [{ b64_json: Buffer.from('fictional-image-bytes').toString('base64') }] };
      } },
    }),
    put: async pathname => ({ url: `https://fixture.private.blob.vercel-storage.com/${pathname}`, pathname, contentType: 'image/jpeg' }),
    del: async () => { assert.fail('Successful text fixtures never delete an image'); },
    get: async () => { assert.fail('No image download or export is part of these text checks'); },
  } });
  const { handlePublisher } = await import('../../lib/publisher/engine/handler.js');
  const send = async (action, body) => {
    calls.length = 0; writes.length = 0;
    const response = await handlePublisher(new Request(`http://127.0.0.1/api/publisher?action=${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer fixture' }, body: JSON.stringify({ requestId: randomUUID(), ...body }),
    }));
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(writes.length, 1, 'Exactly one caption SQL commit');
    const captionParam = writes[0].text.match(/\bcaption\s*=\s*\$(\d+)/);
    assert.equal(writes[0].values[Number(captionParam[1]) - 1], stored.caption, 'Assert the actual persisted SQL caption');
    assert.equal(result.post.caption, stored.caption, 'Hydrated API response contains exactly the saved caption');
    return result.post;
  };
  let lockedCar;
  for (const scenario of [
    { label: 'automatic landscape missing invitation', mode: 'daily', universe: 'landscapes', subject: /escape/i },
    { label: 'manual fictional villa missing invitation', mode: 'guided', universe: 'real_estate', subject: /stay/i },
    { label: 'manual yacht missing invitation', mode: 'guided', universe: 'boats', subject: /yacht/i },
    { label: 'manual locked automobile missing invitation', mode: 'guided', universe: 'cars', subject: /Lamborghini Urus SE/, selection: { carType: 'suv', carBrand: 'lamborghini', carModel: 'lamborghini-urus-se-suv-2024' } },
  ]) await t.test(scenario.label, async () => {
    stored = null;
    proposedCaption = `${hook} The evening opens a new perspective.`;
    const post = await send('generate', { mode: scenario.mode, direction: { universe: scenario.universe, moment: 'day', style: 'elegant', ...scenario.selection } });
    assertCaption(post, scenario.subject);
    assert.equal(post.creation_mode, scenario.mode);
    assert.equal(calls.length, 3, 'One plan, one simulated image and one editorial response; no repair model call');
    assert.deepEqual(post.music.map(song => song.id), [1, 2, 3]);
    if (scenario.universe === 'real_estate') {
      assert.equal(post.location, 'Aucun', 'A fictional villa is not given an Instagram location');
      assert.doesNotMatch(post.caption, /(?:book|reserve)\s+(?:this|the)\s+(?:villa|property|estate)/i);
    }
    if (scenario.selection) lockedCar = structuredClone(stored);
    assert.doesNotMatch(calls.find(call => call.name === 'image').request.prompt, /Book your next|Reserve your next/);
  });

  const legacy = (overrides = {}) => ({
    id: randomUUID(), revision: 3, post_date: '2026-10-23', creation_mode: 'guided',
    status: 'draft', generation_status: 'ready', theme: 'paysage', creative_universe: 'Paysages',
    creative_moment: 'Jour', creative_style: 'Élégant', moment: 'Jour', ...plan,
    caption: 'An existing caption remains untouched until explicit regeneration.', hashtags: ['#Historic'],
    image_url: 'https://fixture.private.blob.vercel-storage.com/old.jpg', image_pathname: 'old.jpg',
    primary_music_id: 1, alternative_music_ids: [2, 3], car_context: null, location: 'French Riviera',
    ...overrides,
  });
  await t.test('reading an existing publication preserves its historical caption without generation', async () => {
    stored = legacy();
    const before = structuredClone(stored);
    calls.length = 0; writes.length = 0;
    const response = await handlePublisher(new Request(`http://127.0.0.1/api/publisher?action=status&id=${stored.id}`, {
      headers: { authorization: 'Bearer fixture' },
    }));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.post.caption, before.caption);
    assert.deepEqual(result.post.hashtags, before.hashtags);
    assert.deepEqual(stored, before);
    assert.equal(calls.length, 0);
    assert.equal(writes.length, 0);
  });
  for (const scenario of [
    { label: 'missing invitation', caption: `${hook} The evening opens a new perspective.`, subject: /escape/i },
    { label: 'invitation in third sentence', caption: `${hook} The evening opens a new perspective. ${booking}`, subject: /escape/i, exact: `${hook} ${booking}` },
    { label: 'duplicate invitations', caption: `${hook} ${booking} Book your next escape to the French Riviera with One Address Riviera.`, subject: /escape/i },
    { label: 'long caption and emoji', caption: 'The golden morning light moves slowly across the calm Mediterranean sea and invites you to discover a beautifully peaceful moment along the coast today. ✨ Reserve your next escape to the French Riviera with One Address Riviera.', subject: /escape/i },
    { label: 'private experience', caption: hook, subject: /escape/i, overrides: { theme: 'expérience privée', creative_universe: null } },
    { label: 'travel', caption: hook, subject: /trip/i, overrides: { theme: 'lifestyle', creative_universe: 'Voyage', scene_summary: 'A private journey along the Mediterranean coast.' } },
    { label: 'hotel stay', caption: hook, subject: /stay/i, overrides: { theme: 'hôtel', creative_universe: null } },
    { label: 'yacht', caption: hook, subject: /yacht/i, overrides: { theme: 'yacht', creative_universe: 'Bateaux' } },
    { label: 'legacy automobile without reliable reference', caption: `${hook} Book your next ride in a Ferrari Roma on the French Riviera with One Address Riviera.`, subject: /ride on the French Riviera/i, overrides: { theme: 'automobile', creative_universe: 'Voitures', caption: 'A Porsche 911 finds its place by the sea.', image_prompt: 'An old free-text description mentions a Lamborghini Urus but proves no identity.' } },
    { label: 'locked automobile preserves exact model', caption: `${hook} Book your next ride in a Ferrari Roma on the French Riviera with One Address Riviera.`, subject: /Lamborghini Urus SE/, overrides: lockedCar },
  ]) await t.test('regeneration: ' + scenario.label, async () => {
    stored = legacy(scenario.overrides);
    const before = structuredClone(stored), journalBefore = journal.size;
    proposedCaption = scenario.caption;
    const post = await send('regenerate-text', { id: stored.id, revision: stored.revision });
    assertCaption(post, scenario.subject);
    if (scenario.exact) assert.equal(post.caption, scenario.exact, 'Keep the first evocative sentence and the third-sentence invitation');
    assert.equal(calls.length, 1, 'Only the existing text call is made, with no repair call or image generation');
    assert.equal(calls[0].name, 'publisher_text');
    assert.equal(stored.image_url, before.image_url);
    assert.equal(stored.image_prompt, before.image_prompt);
    assert.deepEqual([stored.primary_music_id, ...stored.alternative_music_ids], [before.primary_music_id, ...before.alternative_music_ids]);
    assert.deepEqual(stored.car_context, before.car_context, 'Text regeneration never selects or changes the car');
    assert.doesNotMatch(writes[0].text, /(?:image_url|car_context|primary_music_id|alternative_music_ids)\s*=/, 'The real text SQL writes only the text fields');
    if (scenario.label.startsWith('legacy automobile')) {
      assert.equal(journal.size, journalBefore, 'No vehicle reference is journaled for legacy text regeneration');
      assert.doesNotMatch(post.caption, /Porsche|Ferrari|Lamborghini|Urus|Roma|911/);
      assert.equal(Object.hasOwn(post, 'car_context'), false);
    }
    if (before.car_context) {
      assert.deepEqual(post.car_context, before.car_context);
      assert.doesNotMatch(post.caption, /Ferrari|Roma/);
      assert.ok(journal.size > journalBefore, 'The existing locked reference is journaled');
    }
  });

  for (const car of articleCars) {
    const identity = `${car.manufacturer} ${car.model}`;
    const correctInvitation = `Reserve your next ride in ${car.article} ${identity} on the French Riviera with One Address Riviera.`;
    const fallbackInvitation = `Book your next ride in ${car.article} ${identity} on the French Riviera with One Address Riviera.`;
    for (const scenario of [
      { label: 'correct article is preserved', caption: `${hook} ${correctInvitation}`, expected: `${hook} ${correctInvitation}` },
      { label: 'missing invitation gets the correct article', caption: `${hook} The evening opens a new perspective.`, expected: `${hook} ${fallbackInvitation}` },
      { label: 'incorrect article is replaced', caption: `${hook} Reserve your next ride in ${car.article === 'an' ? 'a' : 'an'} ${identity} on the French Riviera with One Address Riviera.`, expected: `${hook} ${fallbackInvitation}` },
    ]) await t.test(`saved ${identity}: ${scenario.label}`, async t => {
      await t.test('creation', async () => {
        stored = null;
        proposedCaption = scenario.caption;
        const post = await send('generate', {
          mode: 'guided', direction: { universe: 'cars', moment: 'day', style: 'elegant', carType: car.carType, carBrand: car.carBrand, carModel: car.carModel },
        });
        assertCaption(post, new RegExp(`ride in ${car.article} ${identity}`));
        assert.equal(post.caption, scenario.expected, 'The final saved caption keeps a valid invitation or repairs it without changing the car identity');
        assert.equal(post.car_context.manufacturer, car.manufacturer);
        assert.equal(post.car_context.model, car.model);
        assert.equal(post.car_context.referenceId, car.carModel);
        assert.deepEqual(post.car_context, stored.car_context);
        assert.deepEqual(calls.map(call => call.name), ['publisher_creative_plan', 'image', 'publisher_editorial_package'], 'Creation uses only the existing simulated plan, image and editorial calls');
      });
      await t.test('regeneration', async () => {
        const before = structuredClone(stored);
        proposedCaption = scenario.caption;
        const post = await send('regenerate-text', { id: stored.id, revision: stored.revision });
        assertCaption(post, new RegExp(`ride in ${car.article} ${identity}`));
        assert.equal(post.caption, scenario.expected, 'The regenerated caption is saved with the correct article and exact locked identity');
        assert.deepEqual(calls.map(call => call.name), ['publisher_text'], 'Regeneration makes one simulated text call and no repair or image call');
        assert.deepEqual(stored.car_context, before.car_context, 'Regeneration never selects or changes the locked car');
        assert.deepEqual(post.car_context, before.car_context);
        assert.equal(stored.image_url, before.image_url);
        assert.equal(stored.image_prompt, before.image_prompt);
        assert.deepEqual([stored.primary_music_id, ...stored.alternative_music_ids], [before.primary_music_id, ...before.alternative_music_ids]);
        assert.doesNotMatch(writes[0].text, /(?:image_url|car_context|primary_music_id|alternative_music_ids)\s*=/, 'Regeneration saves text fields without reassigning the reference');
      });
    });
  }
});
