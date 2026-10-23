/** PostgreSQL + handler verification against an explicitly disposable local DB.
 * Auth is simulated; no Instagram/model/blob request is permitted.
 * PUBLISHER_TEST_ACK=PUBLISHER_DISPOSABLE_LOCAL_ONLY MUSIC_TEST_DATABASE_URL=...
 * node --experimental-test-module-mocks --test tests/publisher/music-database.test.mjs
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';

const target = process.env.MUSIC_TEST_DATABASE_URL;
const enabled = process.env.PUBLISHER_TEST_ACK === 'PUBLISHER_DISPOSABLE_LOCAL_ONLY' && Boolean(target);
await test('contextual music persists with server guards and intact content/history', { skip: !enabled }, async t => {
  const address = new URL(target);
  assert.ok(['localhost', '127.0.0.1'].includes(address.hostname));
  assert.equal(address.port, '55532');
  assert.match(address.pathname, /^\/publisher_music_test(?:_[a-z0-9]+)?$/);
  assert.equal(address.search, '');
  process.env.PUBLISHER_DATABASE_URL = target;
  process.env.PUBLISHER_LOCAL_SIMULATION = '1';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55531';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'local-fiction-only';
  const client = new pg.Client({ connectionString: target });
  await client.connect();
  t.after(() => client.end());
  assert.equal((await client.query('SELECT count(*)::int count FROM pg_tables WHERE schemaname=\'public\'')).rows[0].count, 0, 'Use a new empty disposable database');
  for (const name of ['local-bootstrap.sql', '001-crm-boundary.sql', '002-car-context.sql', '003-contextual-music.sql']) {
    await client.query(await readFile(new URL(`../../lib/publisher/sql/${name}`, import.meta.url), 'utf8'));
  }
  const actor = 'a5000000-0000-4000-8000-000000000001';
  const postId = randomUUID(), publishedId = randomUUID();
  const { resolveCarReference } = await import('../../lib/publisher/engine/cars.js');
  const carContext = resolveCarReference({ carType:'convertible',carBrand:'porsche',carModel:'porsche-911-carrera-cabriolet-2024' },[],'music-preservation-fixture');
  for (let index = 1; index <= 6; index += 1) await client.query('INSERT INTO publisher_music(title,artist,availability_status) VALUES($1,$2,\'available\')', [`Fixture music ${index}`, 'Fixture artist']);
  await client.query(`INSERT INTO publisher_posts(id,post_date,creation_mode,format,status,generation_status,caption,image_url,image_pathname,primary_music_id,alternative_music_ids,music_used_id,published_at)
    VALUES($1,current_date,'guided','Feed 4:5','draft','ready','Preserved editorial text','https://fixture.invalid/image.jpg','fixture/image.jpg',1,'{2,3}',null,null),
      ($2,current_date-30,'guided','Feed 4:5','published','ready','Historical caption','https://fixture.invalid/history.jpg','fixture/history.jpg',1,'{2,3}',2,now()-interval '30 days')`, [postId,publishedId]);
  await client.query("UPDATE publisher_posts SET creative_universe='Voitures',car_context=$2::jsonb WHERE id=$1",[postId,JSON.stringify(carContext)]);
  const snapshot = (await client.query('SELECT row_to_json(p) row FROM publisher_posts p WHERE id=$1', [publishedId])).rows[0].row;
  const verify = async (musicId, context = 'feed') => client.query(`INSERT INTO publisher_music_checks(music_id,account,context,status,method,checked_by,title,artist,version)
    SELECT id,'one-address-riviera',$2,'confirmed','manual_instagram',$3,title,artist,version FROM publisher_music WHERE id=$1`, [musicId,context,actor]);
  await verify(2); await verify(3,'reel'); await verify(4); await verify(5); await verify(6,'reel');
  await client.query('UPDATE publisher_music SET last_used_at=now() WHERE id=5');

  t.mock.module('@supabase/supabase-js', { exports: { createClient: (_url, _key, options) => {
    const token = options.global.headers.Authorization.split(' ')[1];
    return { auth: { getUser: async () => token === 'expired' ? { error: true, data: { user: null } } : { error: null, data: { user: { id: actor } } } },
      rpc: async (_name, { p_action }) => ({ error: null, data: token === 'editor' && ['session','today','history','status','music-status','music-select','music-confirm','music-replace','publish'].includes(p_action) }) };
  } } });
  const forbidden = async () => assert.fail('Music must never invoke a model/image/blob operation');
  // Keep real PostgreSQL execution while closing every test-owned connection.
  const { publisherContext } = await import('../../lib/publisher/engine/context.js');
  let runtimeRole = null;
  const transaction = async statements => {
    const connection = new pg.Client({ connectionString: target }); await connection.connect();
    try {
      await connection.query('BEGIN');
      if (runtimeRole) await connection.query(`SET LOCAL ROLE ${runtimeRole}`);
      await connection.query("select set_config('publisher.actor',$1,true)", [publisherContext.getStore()?.actor || '']);
      const result = [];
      for (const statement of statements) result.push((await connection.query(statement.text, statement.values)).rows);
      await connection.query('COMMIT'); return result;
    } catch (error) { await connection.query('ROLLBACK'); throw error; }
    finally { await connection.end(); }
  };
  const query = async (text, values = []) => (await transaction([{ text, values }]))[0];
  t.mock.module(new URL('../../lib/publisher/engine/database.js', import.meta.url), { exports: {
    transaction, query, sql: () => (strings, ...values) => query(strings.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, ''), values),
  } });
  t.mock.module(new URL('../../lib/publisher/engine/generation.js', import.meta.url), { exports: { generateClaimedPost: forbidden, regenerateText: forbidden, regenerateImage: forbidden } });
  t.mock.module(new URL('../../lib/publisher/engine/provider.js', import.meta.url), { exports: { assertGenerationEnabled: forbidden, get: forbidden } });
  const { handlePublisher } = await import('../../lib/publisher/engine/handler.js');
  const { hydratePostWithMusic, getPostById, saveGeneratedPost } = await import('../../lib/publisher/engine/db.js');
  const load = async () => hydratePostWithMusic(await getPostById(postId));
  const call = async (action, data, token = 'editor') => {
    const response = await handlePublisher(new Request(`http://127.0.0.1:3173/api/publisher?action=${action}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3173' }, body: JSON.stringify({ requestId: randomUUID(), ...data }) }));
    return { status: response.status, body: await response.json() };
  };
  const mutation = (post, extra = {}) => ({ id: post.id, revision: post.revision, ...extra });
  let post = await load();
  assert.equal(post.music[0].availability_status, 'unknown', 'Legacy available is not proof');
  assert.equal(post.music[2].availability_status, 'unknown', 'Reel proof does not confirm Feed');
  assert.equal(post.selected_music_id, null);
  assert.equal(post.music_state, 'insufficient');
  assert.deepEqual(post.car_context,carContext);

  await t.test('missing, denied and expired authorization cannot mutate', async () => {
    assert.equal((await call('music-select', mutation(post, { musicId: 2 }), 'reader')).status, 403);
    assert.equal((await call('music-select', mutation(post, { musicId: 2 }), 'expired')).status, 401);
    const response = await handlePublisher(new Request('http://127.0.0.1:3173/api/publisher?action=music-replace', { method: 'POST', body: '{}' }));
    assert.equal(response.status, 401);
  });
  await t.test('manual confirmation needs explicit method and correct scope', async () => {
    const track = post.music[0];
    const body = { requestId: randomUUID(), id: track.id, postId, revision: post.revision, musicRevision: track.revision, status: 'available' };
    assert.equal((await call('music-status', body)).status, 400);
    assert.equal((await call('music-status', { ...body, requestId: randomUUID(), method: 'manual_instagram', context: 'reel' })).status, 400);
    const response = await call('music-status', { ...body, requestId: randomUUID(), method: 'manual_instagram', context: 'feed' });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    post = response.body.post;
    const proof = post.music[0].verification;
    assert.equal(proof.status, 'confirmed'); assert.equal(proof.account, 'one-address-riviera');
    assert.equal(proof.title, track.title); assert.equal(proof.artist, track.artist);
    assert.ok(proof.checked_at); assert.equal(proof.checked_by, actor);
    assert.equal((await load()).music[0].availability_status, 'available');
  });
  await t.test('selection survives reloading and rejects old revision', async () => {
    const before = post;
    const response = await call('music-select', mutation(post, { musicId: 2 }));
    assert.equal(response.status, 200, JSON.stringify(response.body)); post = response.body.post;
    assert.equal((await load()).selected_music_id, 2);
    assert.equal((await call('music-select', mutation(before, { musicId: 1 }))).status, 409);
    assert.equal((await call('music-select', mutation(post, { musicId: 6 }))).status, 409);
  });
  await t.test('idempotent selection replay returns its original receipt', async () => {
    const payload = mutation(post, { requestId: randomUUID(), musicId: 1 });
    const response = await call('music-select', payload);
    assert.equal(response.status, 200); post = response.body.post;
    const revision = post.revision;
    const replay = await call('music-select', payload);
    assert.equal(replay.status, 200); assert.deepEqual(replay.body, response.body);
    assert.equal((await load()).revision, revision);
  });
  await t.test('concurrent selection cannot silently overwrite a newer revision', async () => {
    const responses = await Promise.all([1,2].map(musicId => call('music-select', mutation(post, { musicId }))));
    assert.deepEqual(responses.map(response => response.status).sort(), [200,409]);
    post = await load();
    assert.ok([1,2].includes(post.selected_music_id));
  });
  await t.test('not found is scoped, append only, and clears selected music', async () => {
    const selected = await call('music-select', mutation(post, { musicId: 2 }));
    assert.equal(selected.status, 200); post = selected.body.post;
    const track = post.music.find(song => song.id === 2);
    const staleMusic = await call('music-status', { id: 2, postId, revision: post.revision, musicRevision: track.revision + 1, status: 'unavailable' });
    assert.equal(staleMusic.status, 409);
    const response = await call('music-status', { id: 2, postId, revision: post.revision, musicRevision: track.revision, status: 'unavailable' });
    assert.equal(response.status, 200, JSON.stringify(response.body)); post = response.body.post;
    assert.equal(post.selected_music_id, null); assert.equal(post.music.find(song => song.id === 2).availability_status, 'unavailable');
    assert.equal((await client.query('SELECT count(*)::int count FROM publisher_music_checks WHERE music_id=2')).rows[0].count, 2);
    const { eligibleMusic } = await import('../../lib/publisher/engine/rules.js');
    assert.equal(eligibleMusic(post.music).some(song => song.id === 2), false);
  });
  await t.test('a recent reference cannot be selected by a manual import', async () => {
    const response = await call('music-confirm', mutation(post, { title: 'Fixture music 5', artist: 'Fixture artist', method: 'manual_instagram', context: 'feed' }));
    assert.equal(response.status, 409);
    assert.equal((await load()).revision, post.revision);
  });
  await t.test('replacement searches beyond displayed choices with cooldown', async () => {
    const response = await call('music-replace', mutation(post, { musicId: 2 }));
    assert.equal(response.status, 200, JSON.stringify(response.body)); post = response.body.post;
    assert.equal(response.body.replacement.id, 4); assert.equal(post.selected_music_id, 4);
    assert.ok(!post.music.some(song => song.id === 2));
    assert.equal(post.caption, 'Preserved editorial text'); assert.ok(post.image_src);
    const none = await call('music-replace', mutation(post));
    assert.equal(none.status, 200); assert.equal(none.body.replacement, null); assert.equal(none.body.music_message, 'none');
  });
  await t.test('new exact versions and actual supplied audio links persist without changing history', async () => {
    const data = mutation(post, { title: 'Fixture music 1', artist: 'Fixture artist', version: 'Alternate test version', method: 'manual_instagram', context: 'feed', instagramAudioUrl: 'https://www.instagram.com/reels/audio/123456789012345/' });
    assert.equal((await call('music-confirm', { ...data, instagramAudioUrl: 'https://example.invalid/audio/1' })).status, 400);
    const response = await call('music-confirm', data);
    assert.equal(response.status, 200, JSON.stringify(response.body)); post = response.body.post;
    assert.notEqual(post.primary_music_id, 1);
    assert.equal(post.music[0].version, 'Alternate test version');
    assert.equal(post.music[0].instagram_audio_url, data.instagramAudioUrl);
    assert.equal(post.music[0].source, 'manual_instagram');
    assert.equal((await load()).selected_music_id, post.primary_music_id);
    const historical = (await client.query('SELECT row_to_json(p) row FROM publisher_posts p WHERE id=$1', [publishedId])).rows[0].row;
    assert.deepEqual(historical, snapshot);
    assert.equal((await call('music-confirm', { ...data, id: publishedId, revision: snapshot.revision })).status, 409);
  });
  await t.test('all reported references leave no unavailable selection or forced replacement', async () => {
    for (const song of post.music) {
      const track = post.music.find(candidate => candidate.id === song.id);
      const response = await call('music-status', { id:track.id,postId,revision:post.revision,musicRevision:track.revision,status:'unavailable' });
      assert.equal(response.status,200); post = response.body.post;
    }
    assert.equal(post.selected_music_id,null); assert.equal(post.music_state,'none');
    const response = await call('music-replace',mutation(post));
    assert.equal(response.status,200); assert.equal(response.body.replacement,null);
    assert.equal(response.body.post.selected_music_id,null);
    assert.equal((await load()).music_state,'none');
  });
  await t.test('zero, one and two references save real generated SQL without losing content', async () => {
    for (let count = 0; count <= 2; count += 1) {
      const id = randomUUID(), runId = randomUUID();
      await client.query(`INSERT INTO publisher_posts(id,post_date,creation_mode,generation_status,generation_run_id) VALUES($1,current_date,'guided','generating',$2)`, [id,runId]);
      const generated = { theme:'paysage',moment:'Matinale',creative_universe:'Paysages',creative_moment:'Matinale',creative_style:'Évasion',scene_summary:'Fixture scenery',visual_signature:'Fixture signature',caption:'Saved without three tracks',hashtags:['#Fixture'],location:'French Riviera',format:'Feed 4:5',image_prompt:'Simulated image only' };
      const image = { url:'https://fixture.invalid/new.jpg',pathname:'fixture/new.jpg',contentType:'image/jpeg',width:1024,height:1280,size:123 };
      const result = await saveGeneratedPost(runId,generated,Array.from({length:count},(_,index)=>({id:index+1})),image);
      assert.equal(result.primary_music_id === null ? null : Number(result.primary_music_id), count ? 1 : null);
      assert.equal(result.selected_music_id === null ? null : Number(result.selected_music_id), count ? 1 : null);
      assert.deepEqual(result.alternative_music_ids.map(Number), count === 2 ? [2] : []);
      assert.equal(result.caption,generated.caption); assert.equal(result.image_url,image.url); assert.equal(result.generation_status,'ready');
    }
  });
  await t.test('a restricted runtime can append verification and cannot alter its history', async () => {
    const role = process.env.MUSIC_TEST_RUNTIME_ROLE;
    assert.match(role || '', /^publisher_music_runtime_test_[a-z0-9]+$/);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(`GRANT SELECT,INSERT ON publisher_music_checks TO ${role}`);
    await client.query(`GRANT USAGE,SELECT ON SEQUENCE publisher_music_checks_id_seq TO ${role}`);
    await client.query(`SET ROLE ${role}`);
    try {
      await client.query('SELECT * FROM publisher_music_checks LIMIT 1');
      await client.query(`INSERT INTO publisher_music_checks(music_id,account,context,status,method,checked_by,title,artist,version) VALUES(1,'one-address-riviera','feed','unknown','manual_instagram',$1,'Fixture music 1','Fixture artist','')`,[actor]);
      await assert.rejects(client.query("UPDATE publisher_music_checks SET status='confirmed'"), { code:'42501' });
      await assert.rejects(client.query('DELETE FROM publisher_music_checks'), { code:'42501' });
    } finally { await client.query('RESET ROLE'); }
    // The append-only trigger also protects history if the migration owner is used.
    await assert.rejects(client.query("UPDATE publisher_music_checks SET status='confirmed'"), { code:'42501' });
    await assert.rejects(client.query('DELETE FROM publisher_music_checks'), { code:'42501' });
  });
  await t.test('music-confirm inserts and upserts exact versions as a restricted runtime', async () => {
    const role = process.env.MUSIC_TEST_RUNTIME_ROLE;
    assert.match(role || '', /^publisher_music_runtime_test_[a-z0-9]+$/);
    await client.query(`GRANT SELECT,UPDATE ON publisher_posts,publisher_music TO ${role}`);
    await client.query(`GRANT SELECT,INSERT,UPDATE ON publisher_operations TO ${role}`);
    assert.equal((await client.query("SELECT has_table_privilege($1,'publisher_music','INSERT') allowed",[role])).rows[0].allowed,false);
    assert.equal((await client.query("SELECT has_sequence_privilege($1,'publisher_music_id_seq','USAGE') allowed",[role])).rows[0].allowed,false);
    const reference = { title:'Restricted runtime fixture',artist:'Fixture runtime artist',version:'Original',method:'manual_instagram',context:'feed' };
    runtimeRole = role;
    try {
      assert.equal((await query('SELECT current_user AS role'))[0].role,role);
      const before = await load();
      const denied = await call('music-confirm',mutation(before,reference));
      assert.equal(denied.status,503,'An unprovisioned runtime must not silently accept a new reference');
      assert.equal((await load()).revision,before.revision,'Failed insertion must roll back the post update');
      assert.equal((await client.query('SELECT count(*)::int count FROM publisher_music WHERE title=$1',[reference.title])).rows[0].count,0);
      await client.query(`GRANT INSERT ON publisher_music TO ${role}`);
      await client.query(`GRANT USAGE ON SEQUENCE publisher_music_id_seq TO ${role}`);
      const created = await call('music-confirm',mutation(before,reference));
      assert.equal(created.status,200,JSON.stringify(created.body));
      post = created.body.post;
      const originalId = post.selected_music_id;
      assert.equal(post.music[0].title,reference.title);
      assert.equal(post.music[0].version,'Original');
      assert.equal(post.music[0].availability_status,'available');
      assert.equal(post.music[0].verification.checked_by,actor);
      const reused = await call('music-confirm',mutation(post,reference));
      assert.equal(reused.status,200,JSON.stringify(reused.body)); post = reused.body.post;
      assert.equal(post.selected_music_id,originalId,'ON CONFLICT must retain the canonical existing ID');
      const versioned = await call('music-confirm',mutation(post,{...reference,version:'Radio edit'}));
      assert.equal(versioned.status,200,JSON.stringify(versioned.body)); post = versioned.body.post;
      assert.notEqual(post.selected_music_id,originalId);
      assert.equal(post.music[0].version,'Radio edit');
      assert.equal((await load()).selected_music_id,post.selected_music_id);
      assert.equal((await client.query('SELECT count(*)::int count FROM publisher_music WHERE title=$1',[reference.title])).rows[0].count,2);
      assert.equal((await client.query('SELECT count(*)::int count FROM publisher_music_checks WHERE title=$1',[reference.title])).rows[0].count,3);
      const privileges = (await client.query(`SELECT has_table_privilege($1,'publisher_music','DELETE') music_delete,
        has_table_privilege($1,'publisher_music_checks','UPDATE') check_update,
        has_table_privilege($1,'publisher_music_checks','DELETE') check_delete,
        has_sequence_privilege($1,'publisher_music_id_seq','SELECT') sequence_select`,[role])).rows[0];
      assert.deepEqual(privileges,{music_delete:false,check_update:false,check_delete:false,sequence_select:false});
      const historical = (await client.query('SELECT row_to_json(p) row FROM publisher_posts p WHERE id=$1',[publishedId])).rows[0].row;
      assert.deepEqual(historical,snapshot);
    } finally { runtimeRole = null; }
  });
  const current = (await client.query('SELECT * FROM publisher_posts WHERE id=$1', [postId])).rows[0];
  assert.equal(current.caption, 'Preserved editorial text');
  assert.equal(current.image_url, 'https://fixture.invalid/image.jpg');
  assert.equal(current.image_pathname, 'fixture/image.jpg');
  assert.deepEqual(current.car_context,carContext);
  assert.deepEqual((await load()).car_context,carContext);
});
