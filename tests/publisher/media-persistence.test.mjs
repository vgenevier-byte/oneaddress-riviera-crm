/** Failure-injection regression at external SQL/blob/model boundaries.
 * The actual generation engine, DB functions, prompts and parsers run unchanged.
 * Requires node --experimental-test-module-mocks --test this-file.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

await test('committed Publisher media survive a subsequent hydration failure', async t => {
 const postId = 'a1000000-0000-4000-8000-000000000001';
 const oldUrl = 'https://fixture.private.blob.vercel-storage.com/publisher/2026-09-28/old.jpg';
 const newUrl = 'https://fixture.private.blob.vercel-storage.com/publisher/2026-09-28/new.jpg';
 const music = [1, 2, 3].map(id => ({ id, title: `Fixture track ${id}`, artist: `Fixture artist ${id}`, availability_status: 'available', revision: 1, times_used: 0 }));
 const plan = { scene_summary: 'Sunlight crosses a distant coastal headland with calm open water.', visual_signature: 'Soft coastal morning and open horizon', image_prompt: 'A quiet Mediterranean coastline in soft morning sunlight, viewed across clear open water with natural editorial realism, no people, logos or text.', format: 'Feed 4:5' };
 const post = { id: postId, revision: 2, post_date: '2026-09-28', image_url: oldUrl, image_pathname: 'publisher/2026-09-28/old.jpg', primary_music_id: 1, alternative_music_ids: [2, 3], status: 'draft', generation_status: 'ready', format: 'Feed 4:5', hashtags: [], creative_universe: 'Paysages', creative_moment: 'Matinale', creative_style: 'Évasion' };
 let committed = false, failSave = false, ambiguousSave = false, referenceUnavailable = false, invalidations = 0;
 const deleted = [];
 const previousDatabase = process.env.PUBLISHER_DATABASE_URL;
 process.env.PUBLISHER_DATABASE_URL = 'postgresql://fiction@127.0.0.1:55532/publisher_unit';
 t.after(() => { if (previousDatabase === undefined) delete process.env.PUBLISHER_DATABASE_URL; else process.env.PUBLISHER_DATABASE_URL = previousDatabase; });
 t.mock.module(new URL('../../lib/publisher/engine/database.js', import.meta.url), { exports: {
  sql: () => async (strings, ...values) => {
   const text = strings.join('?').replace(/\s+/g, ' ').trim();
   if (text.startsWith('SELECT revision, created_by')) return [];
   if (text.startsWith('SELECT id FROM publisher_posts WHERE generation_run_id')) return committed ? [{ id: postId }] : [];
   if (text.startsWith('SELECT 1 FROM publisher_posts WHERE image_url')) {
    if (referenceUnavailable) throw new Error('Injected reference lookup outage');
    return committed && values[0] === newUrl ? [{ exists: 1 }] : [];
   }
   if (text.includes('SELECT * FROM publisher_music ORDER BY')) return music;
   if (text.includes('SELECT * FROM publisher_music WHERE id = ANY')) {
    if (committed) throw new Error('Injected hydration outage after committed UPDATE');
    return music;
   }
   if (text.startsWith('SELECT')) return [];
   if (text.startsWith('UPDATE publisher_posts SET')) {
    if (text.includes('image_url =') || text.includes('caption =')) {
     if (failSave) throw new Error('Injected save failure before commit');
     if (text.includes('image_url =')) assert.ok(values.includes(newUrl), 'The real DB update must persist the uploaded media URL');
     committed = true;
     if (ambiguousSave) throw new Error('Injected save acknowledgement loss after commit');
     return [{ ...post, image_url: newUrl, image_pathname: 'publisher/2026-09-28/new.jpg' }];
    }
    if (text.includes("generation_status = 'error'") || text.includes('error_message =')) {
     assert.ok(text.includes("AND generation_status = 'generating'"), 'Failure cleanup must never demote a committed ready row');
     if (!committed) invalidations++;
    }
    return [{ id: postId }];
   }
   assert.fail('Unexpected SQL boundary: ' + text);
  },
 } });
 t.mock.module(new URL('../../lib/publisher/engine/provider.js', import.meta.url), { exports: {
  client: () => ({
   responses: { parse: async request => ({ output_parsed: request.text.format.name === 'publisher_editorial_package'
    ? { caption: 'The sea opens under a quiet morning sky. Light moves gently across the coast.', hashtags: ['#Coast', '#Riviera', '#Morning', '#Sea'], music, location: 'French Riviera' }
    : request.text.format.name === 'publisher_text' ? { caption: 'The sea opens under a quiet morning sky. Light moves gently across the coast.', hashtags: ['#Coast', '#Riviera', '#Morning', '#Sea'] } : plan }) },
   images: { generate: async () => ({ data: [{ b64_json: Buffer.from('fictional-jpeg-bytes').toString('base64') }] }) },
  }),
  put: async () => ({ url: newUrl, pathname: 'publisher/2026-09-28/new.jpg', contentType: 'image/jpeg' }),
  del: async url => { deleted.push(url); },
 } });
 const { generateClaimedPost, regenerateImage, regenerateText } = await import('../../lib/publisher/engine/generation.js');
 for (const operation of ['initial', 'regeneration', 'text']) {
  await t.test(operation + ': post-commit hydration failure preserves referenced media and ready state', async () => {
   committed = false; failSave = false; invalidations = 0; deleted.length = 0;
   const run = () => operation === 'initial'
    ? generateClaimedPost('b1000000-0000-4000-8000-000000000001', '2026-09-28', { universe: 'landscapes', moment: 'morning', style: 'escape' })
    : operation === 'text' ? regenerateText('b1000000-0000-4000-8000-000000000001', post) : regenerateImage('b1000000-0000-4000-8000-000000000001', post);
   await assert.rejects(run, /Injected hydration outage/);
   assert.equal(committed, true);
   assert.equal(deleted.includes(newUrl), false, 'A committed post must retain its new image');
   assert.equal(invalidations, 0, 'Do not turn a committed ready post into a failure');
  });
  await t.test(operation + ': uncommitted upload is still cleaned up after save failure', async () => {
   committed = false; failSave = true; invalidations = 0; deleted.length = 0;
   const run = () => operation === 'initial'
    ? generateClaimedPost('b1000000-0000-4000-8000-000000000002', '2026-09-28', { universe: 'landscapes', moment: 'morning', style: 'escape' })
    : operation === 'text' ? regenerateText('b1000000-0000-4000-8000-000000000002', post) : regenerateImage('b1000000-0000-4000-8000-000000000002', post);
   await assert.rejects(run, /Injected save failure/);
   assert.equal(committed, false);
   assert.deepEqual(deleted, operation === 'text' ? [] : [newUrl]);
   assert.equal(invalidations, 1);
  });
 }
 await t.test('ambiguous commit retains an image still referenced by the DB', async () => {
  committed = false; failSave = false; ambiguousSave = true; invalidations = 0; deleted.length = 0;
  await assert.rejects(() => regenerateImage('b1000000-0000-4000-8000-000000000003', post), error => { assert.match(error.message, /acknowledgement loss/); assert.equal(error.persistedPostId, postId); return true; });
  assert.equal(committed, true);
  assert.equal(invalidations, 0);
  assert.equal(deleted.includes(newUrl), false);
 });
 await t.test('uncertain reference lookup retains the image for reconciliation', async () => {
  committed = false; failSave = true; ambiguousSave = false; referenceUnavailable = true; invalidations = 0; deleted.length = 0;
  await assert.rejects(() => regenerateImage('b1000000-0000-4000-8000-000000000004', post), /Injected save failure/);
  assert.equal(deleted.includes(newUrl), false);
 });
});
