import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertCachePlaywrightInputs, isAllowedCacheBrowserURL } from './cache-playwright-target.mjs';
import { assertNeutralDocumentTarget, isExactNeutralNavigation } from './cache-playwright-target.mjs';

const workdir = '/tmp/izord-local-stack-fixture';
function inputs() {
  return {
    workdir, statusFile: `${workdir}/status.json`, fixtureFile: `${workdir}/fixture.json`,
    appManifestFile: `${workdir}/app.json`, acknowledgement: 'IZORD_DISPOSABLE_LOCAL_ONLY',
    stack: { dir: workdir, project: 'izord-local-stack-fixture', network: 'izord-local-stack-fixture-loopback',
      api: 'http://127.0.0.1:55431', app: 'http://127.0.0.1:3159', mail: 'http://127.0.0.1:55434' },
    status: { API_URL: 'http://127.0.0.1:55431', DB_URL: 'postgresql://127.0.0.1:55432/postgres', ANON_KEY: 'invalid-fixture-public-key' },
    fixture: { integrationComplete: true, api: 'http://127.0.0.1:55431', app: 'http://127.0.0.1:3159',
      mail: 'http://127.0.0.1:55434', publicKey: 'invalid-fixture-public-key',
      reuse: { retainedSnapshotFile: `${workdir}/retained.json` },
      users: {
        both: { id: '00000000-0000-4000-8000-000000000001', email: 'both@example.invalid', password: 'invalid-fixture-value' },
        b: { id: '00000000-0000-4000-8000-000000000002', email: 'b@example.invalid', password: 'invalid-fixture-value' }
      } },
    appManifest: { status: 'ready', app: 'http://127.0.0.1:3159', bundler: 'webpack', simulation: 'Google transport only',
      directory: '/tmp/izord-live-app-fixture', sourceFiles: [{ path: 'components/CRMApp.tsx', sha256: 'a'.repeat(64) }] }
  };
}

test('validated retained local inputs do not create a client or expose credentials', () => {
  const result = assertCachePlaywrightInputs(inputs());
  assert.equal(result.app, 'http://127.0.0.1:3159');
  assert.equal('users' in result, false);
  assert.equal('publicKey' in result, false);
});

/** @type {[string, (value: ReturnType<typeof inputs>) => void][]} */
const refusals = [
  ['no opt-in', x => { x.acknowledgement = ''; }],
  ['production API', x => { x.status.API_URL = 'https://jcmnwvlmysecrahupfkk.supabase.co'; }],
  ['other cloud API', x => { x.status.API_URL = 'https://example.supabase.co'; }],
  ['localhost alias', x => { x.status.API_URL = 'http://localhost:55431'; }],
  ['wrong local API port', x => { x.status.API_URL = 'http://127.0.0.1:54321'; }],
  ['remote database', x => { x.status.DB_URL = 'postgresql://remote.example:55432/postgres'; }],
  ['wrong local database', x => { x.status.DB_URL = 'postgresql://127.0.0.1:55432/other'; }],
  ['real profile directory', x => { x.workdir = '/Users/fixture/Library/Application Support/Google/Chrome'; }],
  ['relative workdir', x => { x.workdir = 'izord-local-stack-fixture'; }],
  ['credential file outside stack', x => { x.fixtureFile = '/tmp/unrelated/fixture.json'; }],
  ['same private file reused', x => { x.fixtureFile = x.statusFile; }],
  ['manifest from another stack', x => { x.stack.dir = '/tmp/izord-local-stack-other'; }],
  ['foreign Docker network', x => { x.stack.network = 'unrelated-network'; }],
  ['different fixture API', x => { x.fixture.api = 'http://127.0.0.1:55430'; }],
  ['incomplete fixture', x => { x.fixture.integrationComplete = false; }],
  ['different local key', x => { x.fixture.publicKey = 'different-invalid-value'; }],
  ['retained proof outside stack', x => { x.fixture.reuse.retainedSnapshotFile = '/tmp/foreign.json'; }],
  ['nonfictional account', x => { x.fixture.users.b.email = 'person@real.example'; }],
  ['missing login credential', x => { x.fixture.users.b.password = ''; }],
  ['same account for both roles', x => { x.fixture.users.b = { ...x.fixture.users.both }; }],
  ['remote application manifest', x => { x.appManifest.app = 'https://remote.example'; }],
  ['UI adapter instead of real app', x => { x.appManifest.simulation = 'UI fixture'; }],
  ['missing source provenance', x => { x.appManifest.sourceFiles = []; }],
  ['nonisolated application directory', x => { x.appManifest.directory = '/Users/fixture/Desktop/repo'; }]
];
for (const [name, change] of refusals) test(`refuses ${name} before client creation`, () => {
  const value = inputs();
  change(value);
  let created = 0;
  assert.throws(() => { assertCachePlaywrightInputs(value); created += 1; }, /^Error: CACHE_/);
  assert.equal(created, 0);
});

test('browser HTTP requests allow only the exact app and Auth origins', () => {
  for (const url of ['http://127.0.0.1:3159/spaces', 'http://127.0.0.1:55431/auth/v1/token?grant_type=password'])
    assert.equal(isAllowedCacheBrowserURL(url), true);
  for (const url of ['https://jcmnwvlmysecrahupfkk.supabase.co', 'http://localhost:3159', 'http://127.0.0.1:3000',
    'http://127.0.0.1.evil.example:3159/', 'http://user@127.0.0.1:3159/', 'https://127.0.0.1:3159/', 'invalid'])
    assert.equal(isAllowedCacheBrowserURL(url), false);
});

test('browser sockets enforce the same allowlist independently', () => {
  assert.equal(isAllowedCacheBrowserURL('ws://127.0.0.1:55431/realtime/v1', { webSocket: true }), true);
  for (const url of ['wss://remote.example/', 'ws://localhost:55431/', 'ws://127.0.0.1:9222/', 'http://127.0.0.1:55431/'])
    assert.equal(isAllowedCacheBrowserURL(url, { webSocket: true }), false);
});

const neutralApp = 'http://127.0.0.1:3159';
const neutralPath = '/__e2e__/neutral-12345678-1234-4234-8234-123456789abc.html';
const neutralURL = neutralApp + neutralPath;
const otherNeutralURL = `${neutralApp}/__e2e__/neutral-12345678-1234-4234-8234-123456789abd.html`;

test('neutral document target returns the exact canonical local URL without broadening the network allowlist', () => {
  const result = assertNeutralDocumentTarget(neutralApp, neutralURL);
  assert.ok(result instanceof URL);
  assert.equal(result.href, neutralURL);
  assert.equal(result.origin, neutralApp);
  assert.equal(result.pathname, neutralPath);
  assert.equal(isAllowedCacheBrowserURL(result.href), true);
});

test('neutral documents require the literal app origin even when another URL is browser-allowlisted', () => {
  for (const app of ['http://127.0.0.1:55431', 'http://127.0.0.1:3159/', 'http://localhost:3159',
    'http://127.1:3159', 'https://127.0.0.1:3159', 'http://remote.example:3159', undefined, null]) {
    assert.throws(() => assertNeutralDocumentTarget(app, neutralURL), { code: 'CACHE_NEUTRAL_APP_REFUSED' });
  }
});

const refusedNeutralURLs = [
  ['remote host', `http://remote.example:3159${neutralPath}`],
  ['host suffix', `http://127.0.0.1.evil.example:3159${neutralPath}`],
  ['HTTPS', `https://127.0.0.1:3159${neutralPath}`],
  ['WebSocket', `ws://127.0.0.1:3159${neutralPath}`],
  ['wrong port', `http://127.0.0.1:3000${neutralPath}`],
  ['Auth port otherwise allowed by the network guard', `http://127.0.0.1:55431${neutralPath}`],
  ['localhost alias', `http://localhost:3159${neutralPath}`],
  ['normalized short IPv4', `http://127.1:3159${neutralPath}`],
  ['normalized numeric IPv4', `http://2130706433:3159${neutralPath}`],
  ['normalized port spelling', `http://127.0.0.1:03159${neutralPath}`],
  ['uppercase protocol spelling', `HTTP://127.0.0.1:3159${neutralPath}`],
  ['credentials', `http://fictional:invalid@127.0.0.1:3159${neutralPath}`],
  ['empty credentials', `http://@127.0.0.1:3159${neutralPath}`],
  ['query string', `${neutralURL}?fixture=1`],
  ['empty query', `${neutralURL}?`],
  ['fragment', `${neutralURL}#fixture`],
  ['empty fragment', `${neutralURL}#`],
  ['dot segment', `${neutralApp}/./${neutralPath.slice(1)}`],
  ['parent traversal normalized to the allowed path', `${neutralApp}/discard/..${neutralPath}`],
  ['encoded parent traversal', `${neutralApp}/discard/%2e%2e${neutralPath}`],
  ['encoded separator', neutralURL.replace('/__e2e__/', '/__e2e__%2f')],
  ['backslash normalization', neutralURL.replace('/__e2e__/', '/__e2e__\\')],
  ['encoded UUID character', neutralURL.replace('12345678', '%312345678')],
  ['uppercase UUID', neutralURL.replace('789abc', '789ABC')],
  ['malformed UUID length', neutralURL.replace('12345678', '1234567')],
  ['missing UUID separators', neutralURL.replace('12345678-1234', '123456781234')],
  ['suffix after HTML', `${neutralURL}/extra`],
  ['leading whitespace', ` ${neutralURL}`],
  ['trailing newline normalized by URL parsing', `${neutralURL}\n`]
];
for (const [name, value] of refusedNeutralURLs) test(`neutral target refuses ${name}`, () => {
  assert.throws(() => assertNeutralDocumentTarget(neutralApp, value), { code: 'CACHE_NEUTRAL_URL_REFUSED' });
});

test('neutral target never intercepts real application, Auth or REST paths', () => {
  for (const path of ['/', '/spaces', '/izord', '/favicon.ico', '/api/drive/diagnostic',
    '/auth/v1/token', '/auth/v1/logout', '/rest/v1/crm_workspace_state', '/__e2e__/neutral.html']) {
    assert.throws(() => assertNeutralDocumentTarget(neutralApp, neutralApp + path), { code: 'CACHE_NEUTRAL_URL_REFUSED' });
  }
});

test('neutral target rejects non-string values without reflecting them in the error', () => {
  for (const value of [undefined, null, 1, {}, new URL(neutralURL), { toString: () => neutralURL }]) {
    assert.throws(() => assertNeutralDocumentTarget(neutralApp, value), {
      message: 'CACHE_NEUTRAL_URL_REFUSED', code: 'CACHE_NEUTRAL_URL_REFUSED'
    });
  }
});

const neutralNavigation = () => ({ app: neutralApp, expectedURL: neutralURL, url: neutralURL,
  method: 'GET', isNavigationRequest: true, isMainFrame: true, resourceType: 'document' });

test('only an exact GET navigation of the main document matches the registered neutral URL', () => {
  assert.equal(isExactNeutralNavigation(neutralNavigation()), true);
});

test('a different valid neutral UUID cannot satisfy another registered URL', () => {
  assert.equal(assertNeutralDocumentTarget(neutralApp, otherNeutralURL).href, otherNeutralURL);
  assert.equal(isExactNeutralNavigation({ ...neutralNavigation(), url: otherNeutralURL }), false);
  assert.equal(isExactNeutralNavigation({ ...neutralNavigation(), expectedURL: otherNeutralURL }), false);
  assert.equal(isExactNeutralNavigation({ ...neutralNavigation(), expectedURL: otherNeutralURL, url: otherNeutralURL }), true);
});

test('non-GET methods never match a neutral document navigation', () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'get', '', undefined])
    assert.equal(isExactNeutralNavigation({ ...neutralNavigation(), method }), false);
});

test('non-navigation, iframe and subresource requests cannot use the neutral HTML response', () => {
  for (const field of ['isNavigationRequest', 'isMainFrame']) {
    for (const value of [false, undefined, 1, 'true'])
      assert.equal(isExactNeutralNavigation({ ...neutralNavigation(), [field]: value }), false);
  }
  for (const resourceType of ['fetch', 'xhr', 'image', 'script', 'stylesheet', 'other', 'Document', undefined])
    assert.equal(isExactNeutralNavigation({ ...neutralNavigation(), resourceType }), false);
});

test('navigation matching validates both raw URL inputs and the application origin', () => {
  for (const [, value] of refusedNeutralURLs) {
    assert.equal(isExactNeutralNavigation({ ...neutralNavigation(), url: value }), false);
    assert.equal(isExactNeutralNavigation({ ...neutralNavigation(), expectedURL: value }), false);
  }
  for (const app of ['http://127.0.0.1:55431', 'http://localhost:3159', undefined])
    assert.equal(isExactNeutralNavigation({ ...neutralNavigation(), app }), false);
});

test('invalid navigation descriptors fail closed without throwing', () => {
  for (const input of [undefined, null, false, 'GET', {}, [], { get app() { throw new Error('invalid descriptor'); } }])
    assert.equal(isExactNeutralNavigation(input), false);
});
