/** Targeted real LOCAL Auth → JWT → PostgREST → Leads persistence proof.
 * No SQL/schema writes, existing permission changes, or repository .env reads.
 * Browser fixtures are created through the same owner RPC, with reserved IDs.
 * An explicitly authorised NEW fictional local profile uses crm_admin_save.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { getBench } from './server-control.mjs';

const { bench, status } = getBench();
const sql = new Client({ connectionString: status.DB_URL });
const evidence = resolve('../evidence/leads-correction/server');
const results = [], requests = [], sessions = {}, capabilities = {};
let newFixtureProfileCreated = false;
const runId = randomUUID();
const prefix = 'leads-server-' + runId + '-';
const cases = [
  { key: 'surname', contactName: 'Dupont' },
  { key: 'full', contactName: 'Alice Dupont' },
  { key: 'civility', contactName: 'Mme Alice Dupont' },
  { key: 'missing', contactName: 'Ancien libellé hors annuaire' },
  { key: 'homonym', contactName: 'Camille Martin' },
  { key: 'company', contactName: 'Société Seule' },
  { key: 'company-guillaume', contactName: 'Société Guillaume' }
];
const fixtureContacts = [
  { id: 'leads-browser-contact-alice', name: 'Dupont', firstName: 'Alice' },
  { id: 'leads-browser-contact-homonym-one', name: 'Martin', firstName: 'Camille' },
  { id: 'leads-browser-contact-homonym-two', name: 'Martin', firstName: 'Camille' },
  { id: 'leads-browser-contact-company', entityType: 'company', companyName: 'Société Seule', name: '', firstName: '' },
  { id: 'leads-browser-contact-company-guillaume', entityType: 'company', companyName: 'Société Guillaume', name: '', firstName: 'Guillaume' }
];

async function request(path, profile, body, method = body === undefined ? 'GET' : 'POST') {
  assert(/^\/(?:auth\/v1\/(?:token\?grant_type=password|user)|rest\/v1\/rpc\/(?:crm_access_snapshot|crm_admin_save|crm_read_module|crm_mutate_record|crm_reference_options))$/.test(path), 'Only targeted local Auth/RPC paths');
  const session = sessions[profile];
  requests.push({ method, path: path.split('?')[0], profile });
  const response = await fetch(bench.origin + path, {
    method, redirect: 'error',
    headers: {
      apikey: bench.publishableKey,
      ...(session ? { Authorization: 'Bearer ' + session.access_token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}
function ok(response) {
  assert.equal(response.status, 200, 'Unexpected local response: ' + response.status + ' ' + String(response.data?.message || response.data?.error_code || ''));
  return response.data;
}
function refused(response, code) {
  assert(response.status >= 400 && response.status < 600);
  assert.equal(response.data.code, code);
  assert.equal(Object.hasOwn(response.data, 'collections'), false);
  return { status: response.status, code: response.data.code, message: response.data.message };
}
const rpc = (name, profile, body) => request('/rest/v1/rpc/' + name, profile, body);
const read = async (profile = 'owner', collection = 'leads') => ok(await rpc('crm_read_module', profile, { p_module: collection }));
const mutate = (profile, collection, id, patch, revision) => rpc('crm_mutate_record', profile, {
  p_module: collection, p_collection: collection, p_id: id,
  p_patch: patch, p_revision: revision, p_delete: false
});
async function save(profile, collection, id, patch) {
  const before = await read(profile, collection);
  const projection = ok(await mutate(profile, collection, id, patch, before.revision));
  assert.equal(typeof projection.revision, 'string');
  assert(Array.isArray(projection.collections[collection]));
  const row = projection.collections[collection].find(item => item.id === id); assert(row);
  return row;
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function metadataSnapshot() {
  // The sole authorised new fixture is excluded so that all preexisting
  // accounts/rights are compared before and after its creation and the tests.
  const newUser = bench.accounts.leadsContributor?.id || '00000000-0000-0000-0000-000000000000';
  const queries = {
    grants: 'select to_jsonb(g) value from public.crm_module_grants g where user_id<>$1 order by user_id,module',
    profiles: 'select to_jsonb(p) value from public.crm_access_profiles p where user_id<>$1 order by user_id',
    memberships: 'select to_jsonb(m) value from public.app_memberships m where user_id<>$1 order by user_id,workspace_id',
    catalogues: 'select * from app_private.module_collections order by collection',
    shares: 'select to_jsonb(s) value from public.crm_document_shares s order by provider,resource_id,user_id',
    scopes: 'select to_jsonb(s) value from public.crm_document_scopes s order by provider,resource_id',
    targetFunctions: "select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) definition,p.proacl,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname in ('crm_mutate_record','crm_read_module','crm_reference_options')) or (n.nspname='app_private' and p.proname in ('validate_business_patch','tasks_previous_mutate_record','guard_contact_entity_identity')) order by n.nspname,p.proname,args"
  };
  const snapshot = {};
  for (const [key, query] of Object.entries(queries)) snapshot[key] = digest((await sql.query(query, query.includes('$1') ? [newUser] : [])).rows);
  return snapshot;
}
async function ensureLeadsContributor() {
  if (!bench.accounts.leadsContributor) {
    const email = 'contacts-entity-leads-contributor-' + randomUUID() + '@example.invalid';
    const password = randomBytes(24).toString('hex');
    requests.push({ method: 'POST', path: '/auth/v1/admin/users', profile: 'local-fixture-admin' });
    const response = await fetch(bench.origin + '/auth/v1/admin/users', {
      method: 'POST', redirect: 'error',
      headers: { apikey: bench.publishableKey, Authorization: 'Bearer ' + status.SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true })
    });
    assert.equal(response.status, 200, 'Only new fictional local Auth account creation is authorised');
    const user = await response.json(); assert.equal(user.email, email);
    // Persist only the new fake account in the existing private mode-600 file.
    // The browser launcher receives its fake email/password, never admin keys.
    bench.accounts.leadsContributor = { id: user.id, email, password };
    ok(await rpc('crm_admin_save', 'owner', {
      p_user: user.id, p_revision: 0, p_active: true, p_general_admin: false,
      p_grants: { leads: { level: 'contribute', sensitive: {} }, contacts: { level: 'read', sensitive: {} } },
      p_izord_role: null, p_assignments: []
    }));
    const { path } = getBench();
    writeFileSync(path, JSON.stringify(bench, null, 2), { mode: 0o600 });
    newFixtureProfileCreated = true;
  }
  const account = bench.accounts.leadsContributor;
  assert(account.email.startsWith('contacts-entity-leads-contributor-') && account.email.endsWith('@example.invalid'));
  sessions.leadsContributor = ok(await request('/auth/v1/token?grant_type=password', 'leadsContributor', { email: account.email, password: account.password }));
  assert.equal(ok(await request('/auth/v1/user', 'leadsContributor')).id, account.id);
  const claims = JSON.parse(Buffer.from(sessions.leadsContributor.access_token.split('.')[1], 'base64url'));
  assert.equal((await sql.query('select count(*)::int n from auth.sessions where id=$1 and user_id=$2', [claims.session_id, account.id])).rows[0].n, 1);
  const snapshot = ok(await rpc('crm_access_snapshot', 'leadsContributor', {}));
  assert.equal(snapshot.generalAdmin, false); assert.equal(snapshot.active, true);
  assert.equal(snapshot.modules.leads.level, 'contribute'); assert.equal(snapshot.modules.contacts.level, 'read');
  assert.deepEqual(Object.keys(snapshot.modules).sort(), ['contacts', 'leads']);
  capabilities.leadsContributor = { active: true, generalAdmin: false, contacts: snapshot.modules.contacts, leads: snapshot.modules.leads };
  return { newFictionalLocalProfileOnly: true, createdInThisRun: newFixtureProfileCreated, existingProfilesUnchanged: true, benchKey: 'leadsContributor', capabilities: capabilities.leadsContributor };
}
async function test(name, run) {
  const detail = await run(); results.push({ name, passed: true, ...(detail ? { detail } : {}) });
  console.log('PASS ' + name);
}
async function seedBrowser() {
  for (const contact of fixtureContacts) {
    const { id, ...patch } = contact;
    await save('owner', 'contacts', id, { kind: 'Client', ...patch });
  }
  const leads = [];
  for (const item of cases) {
    const id = 'leads-browser-' + item.key;
    const nextAction = 'leads-browser-case-' + item.key;
    const row = await save('owner', 'leads', id, { contactName: item.contactName, category: 'Villa', status: 'Nouveau', value: 100, dueDate: '2026-10-20', nextAction });
    assert.equal(row.contactName, item.contactName);
    leads.push({ id, key: item.key, contactName: item.contactName, nextAction });
  }
  const manifest = { localOnly: true, actualAuthRPC: true, origin: bench.origin, category: 'Villa', contacts: fixtureContacts, leads, existingProfilesUnchanged: true, limitedProfile: bench.accounts.leadsContributor ? 'leadsContributor' : null };
  writeFileSync(resolve(evidence, 'browser-seed.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

mkdirSync(evidence, { recursive: true });
await sql.connect();
try {
  assert.equal((await sql.query("select count(*)::int n from auth.users where email not like 'contacts-entity-%@example.invalid'")).rows[0].n, 0, 'Fictional users only');
  const metadataBefore = await metadataSnapshot();
  await test('existing owner and Contacts-only contributor log in through real local GoTrue', async () => {
    for (const profile of ['owner', 'contributor']) {
      const account = bench.accounts[profile]; assert(account.email.endsWith('@example.invalid'));
      sessions[profile] = ok(await request('/auth/v1/token?grant_type=password', profile, { email: account.email, password: account.password }));
      assert.equal(sessions[profile].user.id, account.id);
      assert.equal(ok(await request('/auth/v1/user', profile)).id, account.id);
      const claims = JSON.parse(Buffer.from(sessions[profile].access_token.split('.')[1], 'base64url'));
      assert.equal((await sql.query('select count(*)::int n from auth.sessions where id=$1 and user_id=$2', [claims.session_id, account.id])).rows[0].n, 1);
      const snapshot = ok(await rpc('crm_access_snapshot', profile, {}));
      capabilities[profile] = { active: snapshot.active, generalAdmin: snapshot.generalAdmin, contacts: snapshot.modules.contacts ?? null, leads: snapshot.modules.leads ?? null };
      assert.equal(snapshot.active, true);
    }
    assert.equal(capabilities.owner.leads.level, 'contribute');
    assert.equal(capabilities.contributor.contacts.level, 'contribute');
    assert.equal(capabilities.contributor.leads, null, 'Do not add Leads rights to an existing Contacts-only contributor');
    return capabilities;
  });
  if (!process.argv.includes('--seed-browser-only')) await test('new fictional LOCAL Leads contributor has only Leads contribute / Contacts read; original accounts unchanged', ensureLeadsContributor);
  if (!process.argv.includes('--no-browser-seed')) await test('five distinct Contacts and seven historical/new labels are seeded only through real owner RPCs', seedBrowser);
  if (!process.argv.includes('--seed-browser-only')) {
    const contactsBefore = await read('owner', 'contacts');
    const homonyms = contactsBefore.collections.contacts.filter(contact => ['leads-browser-contact-homonym-one', 'leads-browser-contact-homonym-two'].includes(contact.id));
    assert.equal(homonyms.length, 2);
    assert.equal(new Set(homonyms.map(contact => contact.id)).size, 2);
    for (const profile of ['owner', 'leadsContributor']) {
    for (const language of ['fr', 'en']) {
      for (const item of cases) {
        await test(profile + ' / ' + language + ': unrelated amount/date/action changes retain exact ' + item.key + ' contactName after real save and reread', async () => {
          const id = prefix + profile + '-' + language + '-' + item.key;
          const initial = await save(profile, 'leads', id, { contactName: item.contactName, category: 'Villa', status: 'Nouveau', value: 100, nextAction: 'Initial ' + language, dueDate: '2026-10-20' });
          const patch = { contactName: item.contactName, value: 125.5, nextAction: language === 'fr' ? 'Action libre à conserver' : 'Free action to preserve', dueDate: '2026-10-21' };
          const confirmed = await save(profile, 'leads', id, patch);
          const reloaded = (await read(profile)).collections.leads.find(row => row.id === id);
          assert.equal(confirmed.contactName, item.contactName); assert.equal(reloaded.contactName, item.contactName);
          for (const key of ['createdAt', 'createdBy']) assert.equal(reloaded[key], initial[key]);
          assert.equal(reloaded.updatedBy, bench.accounts[profile].id);
          const partial = await save(profile, 'leads', id, { value: 126.5 });
          assert.equal(partial.contactName, item.contactName);
          return { id, contactName: reloaded.contactName, sentUnchangedExplicitValue: true, omittedContactNameAlsoPreserved: true };
        });
      }
    }
    }
    await test('whitespace and old civility are preserved byte-for-byte for both actual authorised profiles', async () => {
      const contactName = '  Mme Alice Dupont\u00a0 ';
      for (const profile of ['owner', 'leadsContributor']) {
        const id = prefix + profile + '-spaces';
        await save(profile, 'leads', id, { contactName, value: 100 });
        await save(profile, 'leads', id, { contactName, nextAction: 'Exact old label retained' });
        assert.equal((await read(profile)).collections.leads.find(row => row.id === id).contactName, contactName);
      }
    });
    await test('only an explicit contactName patch changes a historical attachment; no ID/name matching is inferred', async () => {
      const id = prefix + 'explicit';
      await save('owner', 'leads', id, { contactName: 'Dupont', nextAction: 'Initial attachment' });
      for (const contactName of ['Société Guillaume', 'Alice Dupont', 'Camille Martin']) {
        const confirmed = await save('owner', 'leads', id, { contactName });
        assert.equal(confirmed.contactName, contactName);
        assert.equal((await read()).collections.leads.find(row => row.id === id).contactName, contactName);
      }
    });
    await test('actual stale revision and invalid field responses preserve exact stored historical attachment', async () => {
      const id = prefix + 'conflict';
      await save('owner', 'leads', id, { contactName: 'Mme Alice Dupont', value: 100 });
      const stale = await read();
      await save('owner', 'leads', id, { nextAction: 'Concurrent confirmed action' });
      const current = await read();
      const conflict = refused(await mutate('owner', 'leads', id, { contactName: 'Société Guillaume', value: 200 }, stale.revision), '40001');
      assert.equal(conflict.message, 'revision_conflict');
      assert.deepEqual(await read(), current);
      const invalid = refused(await mutate('owner', 'leads', id, { contactName: 'Mme Alice Dupont', value: -1 }, current.revision), 'P0001');
      assert.deepEqual(await read(), current);
      return { conflict, invalid, retainedContactName: current.collections.leads.find(row => row.id === id).contactName };
    });
    await test('real Contacts contributor has no Leads read/write access and cannot obtain or replace historical attachments', async () => {
      const before = await read();
      const readRefusal = refused(await rpc('crm_read_module', 'contributor', { p_module: 'leads' }), '42501');
      const referenceRefusal = refused(await rpc('crm_reference_options', 'contributor', { p_module: 'leads' }), '42501');
      const writeRefusal = refused(await mutate('contributor', 'leads', 'leads-browser-surname', { contactName: 'Société Guillaume', value: 300 }, before.revision), '42501');
      assert.deepEqual(await read(), before);
      assert.equal((await read('contributor', 'contacts')).collections.contacts.some(contact => contact.id === 'leads-browser-contact-company-guillaume'), true);
      return { contacts: 'contribute', leads: 'none', readRefusal, referenceRefusal, writeRefusal, acceptedLimitedLeadsWriteTested: false };
    });
    await test('Leads changes do not merge homonyms or mutate Contacts identity/banking/history', async () => {
      assert.deepEqual(await read('owner', 'contacts'), contactsBefore);
    });
  }
  const metadataAfter = await metadataSnapshot();
  assert.deepEqual(metadataAfter, metadataBefore, 'Permissions/catalogues/SQL functions/document sharing unchanged');
  const proof = {
    passed: true, executedAt: new Date().toISOString(), runId, origin: bench.origin,
    actualLocalAuth: true, actualLocalJWTSessions: true, actualPostgREST: true, mockedSuccessResponses: 0,
    remoteRequests: 0, sqlWrites: 0, existingPermissionChanges: 0, newFictionalLocalProfileCreated: newFixtureProfileCreated, capabilities,
    acceptedProfiles: process.argv.includes('--seed-browser-only') ? ['owner'] : ['owner', 'leadsContributor'], limitedLeadsAcceptedBoundary: 'A separately authorised NEW fictional local profile has Leads contribute / Contacts read. The original Contacts-only contributor retains no Leads permission and its rejection is tested.',
    languageBoundary: 'FR/EN identify input scenarios only. This server test does not execute React, native select behavior, translations, or browser cancellation; see integrated browser proof.',
    seedOnly: process.argv.includes('--seed-browser-only'), tests: results, requestCount: requests.length, requests,
    metadataPreservationBoundary: 'Grants/profiles/memberships compare all preexisting accounts, excluding only the separately authorised NEW leadsContributor fixture. SQL definitions, catalogues, document shares and scopes compare in full.',
    preservedMetadataHashes: metadataAfter,
    priorContactsServerProofReusedWithoutRerun: '../../server/real-auth-results.json',
    priorMigrationProofReusedWithoutReapply: '../../server/migration-preservation.json',
    migrationFileSha256: createHash('sha256').update(readFileSync('supabase/migrations/20261008194000_contact_entity_identity.sql')).digest('hex')
  };
  writeFileSync(resolve(evidence, 'real-auth-results.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, tests: results.length, requests: requests.length, seedManifest: resolve(evidence, 'browser-seed.json'), evidence: resolve(evidence, 'real-auth-results.json'), existingPermissionsUnchanged: true, newFictionalLocalProfileCreated: newFixtureProfileCreated }));
} finally { await sql.end(); }
