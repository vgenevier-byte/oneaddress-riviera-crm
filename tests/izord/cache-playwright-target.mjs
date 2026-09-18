/** Pure guards: importing this module creates no client, file, profile or account.
 * assertCachePlaywrightInputs({workdir,statusFile,fixtureFile,appManifestFile,
 *   stack,status,fixture,appManifest,acknowledgement}) returns validated targets.
 * Errors expose a static code only; never echo private JSON or credentials.
 */
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { assertLocalTarget } from './local-target.mjs';

export function cacheTargetFailure(code) {
  throw Object.assign(new Error(code), { code });
}
const requireThat = (condition, code) => { if (!condition) cacheTargetFailure(code); };

export function isAllowedCacheBrowserURL(value, { webSocket = false } = {}) {
  try {
    const url = new URL(value);
    const protocol = webSocket ? 'ws:' : 'http:';
    return url.protocol === protocol && url.hostname === '127.0.0.1'
      && ['3159', '55431'].includes(url.port) && !url.username && !url.password;
  } catch { return false; }
}

/**
 * Validate the raw URL before parsing can normalize aliases or traversal.
 * @param {unknown} app
 * @param {unknown} value
 * @returns {URL}
 */
export function assertNeutralDocumentTarget(app, value) {
  requireThat(app === 'http://127.0.0.1:3159', 'CACHE_NEUTRAL_APP_REFUSED');
  if (typeof value === 'string'
    && /^http:\/\/127\.0\.0\.1:3159\/__e2e__\/neutral-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.html$/.test(value)) {
    const url = new URL(value);
    requireThat(url.href === value && url.origin === app && !url.username && !url.password
      && !url.search && !url.hash && isAllowedCacheBrowserURL(value), 'CACHE_NEUTRAL_URL_REFUSED');
    return url;
  }
  throw Object.assign(new Error('CACHE_NEUTRAL_URL_REFUSED'), { code: 'CACHE_NEUTRAL_URL_REFUSED' });
}

/** Only the registered, exact top-level document navigation may be fulfilled.
 * @param {unknown} input
 * @returns {boolean}
 */
export function isExactNeutralNavigation(input) {
  if (!input || typeof input !== 'object') return false;
  try {
    const { app, expectedURL, url, method, isNavigationRequest, isMainFrame, resourceType }
      = /** @type {Record<string, unknown>} */ (input);
    const expected = assertNeutralDocumentTarget(app, expectedURL);
    const actual = assertNeutralDocumentTarget(app, url);
    return actual.href === expected.href && method === 'GET' && isNavigationRequest === true
      && isMainFrame === true && resourceType === 'document';
  } catch { return false; }
}

export function assertCachePlaywrightInputs({ workdir, statusFile, fixtureFile, appManifestFile,
  stack, status, fixture, appManifest, acknowledgement }) {
  requireThat(typeof workdir === 'string' && isAbsolute(workdir), 'CACHE_WORKDIR_REQUIRED');
  const directory = resolve(workdir);
  requireThat(/^izord-local-stack-[A-Za-z0-9]+$/.test(basename(directory)), 'CACHE_WORKDIR_UNKNOWN');
  requireThat(['/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/'].some(prefix => directory.startsWith(prefix)), 'CACHE_WORKDIR_NOT_TEMPORARY');
  for (const path of [statusFile, fixtureFile, appManifestFile]) {
    requireThat(typeof path === 'string' && isAbsolute(path) && dirname(resolve(path)) === directory, 'CACHE_PRIVATE_FILE_OUTSIDE_STACK');
  }
  requireThat(new Set([statusFile, fixtureFile, appManifestFile]).size === 3, 'CACHE_PRIVATE_FILES_MUST_DIFFER');
  requireThat(stack && typeof stack.dir === 'string' && resolve(stack.dir) === directory, 'CACHE_STACK_DIRECTORY_MISMATCH');
  requireThat(stack.project === basename(directory).toLowerCase() && stack.network === `${stack.project}-loopback`, 'CACHE_STACK_IDENTITY_MISMATCH');
  const app = 'http://127.0.0.1:3159', mail = 'http://127.0.0.1:55434';
  try { assertLocalTarget({ api: status?.API_URL, database: status?.DB_URL, app, mail, acknowledgement }); }
  catch { cacheTargetFailure('CACHE_LOCAL_TARGET_REFUSED'); }
  requireThat(stack.api === status.API_URL && stack.app === app && stack.mail === mail, 'CACHE_STACK_TARGET_MISMATCH');
  requireThat(fixture?.integrationComplete === true && fixture.api === status.API_URL && fixture.app === app && fixture.mail === mail, 'CACHE_FIXTURE_NOT_COMPLETE_LOCAL');
  requireThat(fixture.reuse && typeof fixture.reuse.retainedSnapshotFile === 'string'
    && dirname(resolve(fixture.reuse.retainedSnapshotFile)) === directory, 'CACHE_RETAINED_FIXTURE_REQUIRED');
  requireThat(fixture.publicKey === status.ANON_KEY && typeof status.ANON_KEY === 'string' && status.ANON_KEY.length > 0, 'CACHE_PUBLIC_KEY_MISMATCH');
  const identities = ['both', 'b'].map(name => fixture.users?.[name]);
  requireThat(identities.every(user => user && /^[0-9a-f-]{36}$/i.test(user.id)
    && /^[^@\s]+@example\.invalid$/.test(user.email) && typeof user.password === 'string' && user.password.length >= 8), 'CACHE_FICTITIOUS_IDENTITIES_REQUIRED');
  requireThat(identities[0].id !== identities[1].id && identities[0].email !== identities[1].email, 'CACHE_DISTINCT_IDENTITIES_REQUIRED');
  // A stopped manifest still identifies the build. Live read-only probes must
  // refuse an unavailable app/Auth before the runner creates a browser profile.
  requireThat(['ready', 'stopped'].includes(appManifest?.status) && appManifest.app === app && appManifest.bundler === 'webpack'
    && appManifest.simulation === 'Google transport only', 'CACHE_REAL_APP_MANIFEST_REQUIRED');
  requireThat(typeof appManifest.directory === 'string' && isAbsolute(appManifest.directory)
    && /^izord-live-app-[A-Za-z0-9]+$/.test(basename(appManifest.directory)), 'CACHE_ISOLATED_APP_DIRECTORY_REQUIRED');
  requireThat(Array.isArray(appManifest.sourceFiles) && appManifest.sourceFiles.length > 0, 'CACHE_SERVED_SOURCE_HASHES_REQUIRED');
  return { app, api: status.API_URL, mail, database: status.DB_URL, workdir: directory };
}
