/** Lot 2 additive RPC/Storage checks against real local Auth. No schema mutation.
 * LOCAL_STATUS_FILE + LOCAL_FIXTURE_FILE must identify the retained disposable
 * stack; fixture credentials are read privately and never included in outputs.
 */
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { assertLocalTarget } from './local-target.mjs';
const require = createRequire(import.meta.url), { createClient } = require('@supabase/supabase-js');
const status = JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE, 'utf8'));
const fixture = JSON.parse(readFileSync(process.env.LOCAL_FIXTURE_FILE, 'utf8'));
assertLocalTarget({ api: status.API_URL, database: status.DB_URL, app: 'http://127.0.0.1:3159', mail: 'http://127.0.0.1:55434', acknowledgement: process.env.IZORD_TEST_ACK });
assert.equal(fixture.api, status.API_URL);
const out = resolve(process.env.IZORD_ARTIFACTS || '/tmp/izord-generator-live-results'); mkdirSync(out, { recursive: true });
const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const make = () => createClient(status.API_URL, status.ANON_KEY, opts), administrator = make();
const authAdmin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, opts), clients = [administrator, authAdmin], records = [];
const adminFixture = fixture.users.admin || fixture.users.both;
assert.ok(adminFixture?.email?.endsWith('@example.invalid') && adminFixture.password);
const safeCode = error => /^[A-Za-z0-9_-]{1,50}$/.test(String(error?.code || '')) ? error.code : 'unknown';
async function ok(operation) { const result = await operation; if (result.error) throw Object.assign(new Error('Authorized generator operation failed'), { code: safeCode(result.error) }); return result.data; }
async function denied(operation, code) { const result = await operation; assert.ok(result.error || Array.isArray(result.data) && result.data.length === 0); if (code) assert.equal(result.error?.code, code); return result; }
let active = 'initialization';
async function check(name, operation) { active = name; await operation(); records.push({ name, result: 'passed' }); console.log(`PASS ${name}`); }
async function actor(role) {
  const email = `generator-${role}-${randomUUID()}@example.invalid`, password = randomBytes(24).toString('hex');
  const created = await ok(authAdmin.auth.admin.createUser({ email, password, email_confirm: true }));
  const client = make(); clients.push(client);
  const signed = await ok(client.auth.signInWithPassword({ email, password }));
  assert.equal((await ok(client.auth.getUser())).user.id, created.user.id);
  if (role !== 'none') {
    const invitation = await ok(administrator.rpc('izord_invite_izord', { p_email: email, p_role: role }));
    await ok(client.rpc('izord_accept_invitation', { p_token: invitation.token }));
  }
  return { id: created.user.id, client, token: signed.session.access_token };
}
const rpc = (actor, name, args) => actor.client.rpc(name, args);
const store = actor => actor.client.storage.from('izord-documents');
const pdf = text => new Blob([`%PDF-1.4\n${text}\n%%EOF`], { type: 'application/pdf' });
const png = () => new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWq0AAAAASUVORK5CYII=', 'base64')], { type: 'image/png' });
const ppt = () => new Blob(['PK\x03\x04FICTIONAL BACKEND CONTRACT ONLY'], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
const createProject = (who, title) => ok(rpc(who, 'izord_create_project', { p_title: `Fictif lot 2 ${title}` }));
const assetId = path => path.split('/')[1];
const finalize = (who, path) => rpc(who, 'izord_finalize_asset', { p_asset: assetId(path) });
const register = (who, id, revision, kind, blob, name = 'fixture.pdf', size = blob.size) => ok(rpc(who, 'izord_register_generator_asset', { p_project: id, p_revision: revision, p_kind: kind, p_size: size, p_mime: blob.type, p_name: name }));
async function upload(who, id, revision, kind, blob, name) { const path = await register(who, id, revision, kind, blob, name); const signed = await ok(store(who).createSignedUploadUrl(path, { upsert: false })); await ok(store(who).uploadToSignedUrl(path, signed.token, blob)); await ok(finalize(who, path)); return path; }
const payload = (photo = '', source = '') => ({ schema: 'IZORD_GENERATOR_V1', data: { state: { project: 'Projet fictif partagé', acq: '', works: '0' }, photos: { main: photo, view: '', inside: '', operation: '' }, importMeta: { fictitious: true }, importGallery: photo ? [{ data: photo, label: 'Image fictive', page: 1, width: 1, height: 1 }] : [], photoGalleryRoles: photo ? { main: 0 } : {} }, sourceDocuments: source ? [source] : [] });
const save = (who, id, revision, value, state = 'draft') => rpc(who, 'izord_save_generator', { p_id: id, p_expected_revision: revision, p_title: 'Projet fictif partagé', p_payload: value, p_status: state });
try {
  await ok(administrator.auth.signInWithPassword({ email: adminFixture.email, password: adminFixture.password }));
  const admin = { client: administrator }, a = await actor('contributor'), b = await actor('contributor'), reader = await actor('reader'), none = await actor('none');
  let id, other, photo, source, finalPayload, presentation;
  await check('real local Auth identities and current memberships', async () => {
    for (const who of [a, b, reader, none]) { const user = await ok(who.client.auth.getUser(who.token)); assert.equal(user.user.id, who.id); }
    await denied(rpc(none, 'izord_create_project', { p_title: 'Must refuse' }), '42501');
  });
  await check('contributor creates isolated project; foreign contributor cannot read', async () => {
    id = await createProject(a, 'collaboration'); other = await createProject(b, 'foreign');
    assert.deepEqual(await ok(b.client.from('izord_projects').select('id').eq('id', id)), []);
    await denied(save(b, id, 1, payload()), '42501');
  });
  await check('administrator assigns second writer and reader without OAR membership', async () => {
    for (const who of [b, reader]) await ok(rpc(admin, 'izord_assign_project', { p_project: id, p_user: who.id, p_assigned: true }));
    for (const who of [a, b, reader]) {
      assert.equal((await ok(who.client.from('izord_projects').select('id').eq('id', id))).length, 1);
      assert.deepEqual(await ok(who.client.from('crm_workspace_state').select('workspace_id')), []);
    }
  });
  await check('direct signed Storage upload finalizes photos and source PDF', async () => {
    photo = await upload(a, id, 1, 'photo', png(), 'fixture.png'); source = await upload(a, id, 1, 'pdf', pdf('FICTIONAL SOURCE'), 'fixture.pdf');
    assert.equal((await ok(store(a).download(source))).size, pdf('FICTIONAL SOURCE').size);
  });
  await check('actual received size checked even through original finalization RPC', async () => {
    const body = pdf('WRONG EXPECTED SIZE'), path = await register(a, id, 1, 'pdf', body, 'size.pdf', body.size + 1);
    await ok(store(a).upload(path, body)); await denied(finalize(a, path), '23514');
    await ok(rpc(a, 'izord_withdraw_asset', { p_asset: assetId(path) })); await denied(store(a).download(path));
  });
  await check('actual MIME and declared content kind mismatch cannot finalize', async () => {
    const body = pdf('WRONG MIME'), path = await register(a, id, 1, 'pdf', body, 'mime.pdf');
    await ok(store(a).upload(path, new Blob([body], { type: 'image/png' }))); await denied(finalize(a, path), '23514');
    await ok(rpc(a, 'izord_withdraw_asset', { p_asset: assetId(path) }));
  });
  await check('foreign finalized asset cannot be referenced; save rolls back', async () => {
    const foreign = await upload(b, other, 1, 'photo', png(), 'foreign.png');
    await denied(save(a, id, 1, payload(assetId(foreign))), '42501');
    assert.equal((await ok(a.client.from('izord_projects').select('revision').eq('id', id).single())).revision, 1);
  });
  await check('save atomically creates revision with authenticated author and private references', async () => {
    finalPayload = payload(assetId(photo), assetId(source)); assert.equal(await ok(save(a, id, 1, finalPayload)), 2);
    const version = await ok(b.client.from('izord_project_versions').select('*').eq('project_id', id).eq('revision', 2).single());
    assert.equal(version.author_id, a.id); assert.deepEqual(version.payload, finalPayload);
    assert.equal(version.payload.data.state.acq, ''); assert.equal(version.payload.data.state.works, '0');
    const refs = await ok(b.client.from('izord_generator_asset_refs').select('slot,asset_id').eq('project_id', id).eq('project_revision', 2));
    assert.equal(refs.length, 3); assert.ok(!JSON.stringify(version.payload).includes('base64'));
  });
  await check('two writers cannot silently overwrite; stale revision is rejected', async () => {
    assert.equal(await ok(save(b, id, 2, { ...finalPayload, data: { ...finalPayload.data, state: { ...finalPayload.data.state, acq: '123456' } } })), 3);
    await denied(save(a, id, 2, finalPayload), '40001');
    assert.equal((await ok(a.client.from('izord_projects').select('payload').eq('id', id).single())).payload.data.state.acq, '123456');
  });
  await check('reader reads allowed project text but cannot access photo/source, save or upload', async () => {
    assert.equal((await ok(reader.client.from('izord_projects').select('id').eq('id', id))).length, 1);
    for (const path of [photo, source]) await denied(store(reader).download(path));
    await denied(save(reader, id, 3, finalPayload), '42501');
    await denied(rpc(reader, 'izord_register_generator_asset', { p_project: id, p_revision: 3, p_kind: 'pdf', p_size: 10, p_mime: 'application/pdf', p_name: 'refuse.pdf' }), '42501');
    assert.deepEqual(await ok(reader.client.from('izord_generator_asset_refs').select('*').eq('project_id', id)), []);
  });
  await check('contributor cannot approve or publish reader download', async () => {
    await denied(save(a, id, 3, finalPayload, 'approved'), '42501');
    presentation = await upload(a, id, 3, 'presentation', ppt(), 'fixture.pptx');
    await denied(rpc(a, 'izord_allow_reader_download', { p_asset: assetId(presentation), p_allowed: true }), '42501');
    await denied(store(reader).download(presentation));
  });
  await check('explicit partner/admin publication; new presentation has a distinct identity and no inherited grant', async () => {
    await ok(rpc(admin, 'izord_allow_reader_download', { p_asset: assetId(presentation), p_allowed: true }));
    assert.equal((await ok(store(reader).download(presentation))).size, ppt().size);
    const second = await upload(a, id, 3, 'presentation', ppt(), 'second.pptx'); assert.notEqual(second, presentation); await denied(store(reader).download(second));
  });
  await check('finalized objects cannot be removed/replaced through direct Storage', async () => {
    const deletion = await store(a).remove([photo]); assert.ok(deletion.error || deletion.data.length === 0);
    await denied(store(a).upload(photo, png(), { upsert: true }));
    assert.equal((await ok(store(b).download(photo))).size, png().size);
  });
  await check('pending upload abandon retains tombstone and refuses path reuse', async () => {
    const body = pdf('ABANDONED FICTIONAL UPLOAD'), path = await register(a, id, 3, 'pdf', body, 'abandoned.pdf');
    const signed = await ok(store(a).createSignedUploadUrl(path, { upsert: false })); await ok(store(a).uploadToSignedUrl(path, signed.token, body));
    await ok(rpc(a, 'izord_withdraw_asset', { p_asset: assetId(path) }));
    await denied(finalize(a, path), '42501'); await denied(store(a).uploadToSignedUrl(path, signed.token, body)); await denied(store(a).download(path));
  });
  await check('stale pending revision requires administrator abandonment; objects are retained', async () => {
    const pending = await register(a, id, 3, 'pdf', pdf('STALE'), 'stale.pdf');
    assert.equal(await ok(save(a, id, 3, finalPayload)), 4);
    await denied(rpc(a, 'izord_withdraw_asset', { p_asset: assetId(pending) }), '42501');
    await ok(rpc(admin, 'izord_withdraw_asset', { p_asset: assetId(pending) })); await denied(finalize(a, pending), '42501');
  });
  await check('session refresh alone writes no project/version; subsequent real edit succeeds', async () => {
    const before = await ok(a.client.from('izord_project_versions').select('revision').eq('project_id', id));
    await ok(a.client.auth.refreshSession());
    assert.deepEqual(await ok(a.client.from('izord_project_versions').select('revision').eq('project_id', id)), before);
    assert.equal(await ok(save(a, id, 4, finalPayload)), 5);
  });
  await check('revoked still-valid Auth JWT cannot finalize, save, generate/archive or read', async () => {
    const revoked = await actor('contributor'); await ok(rpc(admin, 'izord_assign_project', { p_project: id, p_user: revoked.id, p_assigned: true }));
    const body = pdf('SIGNED BEFORE REVOCATION'), path = await register(revoked, id, 5, 'pdf', body, 'revoked.pdf');
    const signed = await ok(store(revoked).createSignedUploadUrl(path, { upsert: false }));
    await ok(rpc(admin, 'izord_set_izord_member', { p_user: revoked.id, p_role: 'contributor', p_status: 'revoked' }));
    assert.equal((await ok(revoked.client.auth.getUser(revoked.token))).user.id, revoked.id);
    // Existing capability remains upload-capable for up to two hours; no claim
    // that revocation cancels an already-issued Storage capability.
    await ok(store(revoked).uploadToSignedUrl(path, signed.token, body));
    await denied(finalize(revoked, path), '42501'); await denied(save(revoked, id, 5, finalPayload), '42501');
    await denied(rpc(revoked, 'izord_register_generator_asset', { p_project: id, p_revision: 5, p_kind: 'presentation', p_size: ppt().size, p_mime: ppt().type, p_name: 'refuse.pptx' }), '42501');
    await denied(store(revoked).download(path)); await ok(rpc(admin, 'izord_withdraw_asset', { p_asset: assetId(path) }));
    await denied(store(revoked).uploadToSignedUrl(path, signed.token, body));
  });
  await check('raw REST cannot mutate generator reference table', async () => {
    await denied(a.client.from('izord_generator_asset_refs').insert({ project_id: id, project_revision: 5, slot: 'source:0', asset_id: assetId(source) }));
    await denied(a.client.from('izord_generator_asset_refs').delete().eq('project_id', id));
  });
  writeFileSync(join(out, 'results.json'), JSON.stringify({ actualLocalAuth: true, groups: records.length, records, limitations: ['Backend PPT blob is a transport contract fixture, not a PowerPoint rendering test.', 'No physical cleanup: abandoned bytes and immutable tombstones are retained in isolated local volumes.'] }, null, 2));
} catch (error) {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ actualLocalAuth: true, groups: records.length, records, failed: active, code: safeCode(error), error: error?.name || 'Error' }, null, 2));
  console.error(`FAIL ${active} (${safeCode(error)})`); process.exitCode = 1;
} finally { for (const client of clients) await client.removeAllChannels(); }
