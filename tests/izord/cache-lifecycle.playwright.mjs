/** Nine corrected cache lifecycle groups; direct, exclusively owned Playwright.
 * One invocation = one fresh browser + ONE shared context, no suite retry.
 * This runner never seeds accounts, starts a stack, or modifies product sources.
 * --logout-smoke runs only the two real logout paths, never the nine cache groups.
 * --neutral-preflight checks technical operations before the separate full campaign.
 * Required: IZORD_LOCAL_WORKDIR, LOCAL_STATUS_FILE, LOCAL_FIXTURE_FILE,
 * IZORD_APP_MANIFEST_FILE, IZORD_PLAYWRIGHT_RUNTIME, IZORD_ARTIFACTS,
 * IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY and explicit local Colima env.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { assertLocalDocker } from './local-target.mjs';
import { assertCachePlaywrightInputs, cacheTargetFailure, isAllowedCacheBrowserURL,
  assertNeutralDocumentTarget, isExactNeutralNavigation } from './cache-playwright-target.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const missing = 'non disponible';
const logoutSmoke = process.argv.length === 3 && process.argv[2] === '--logout-smoke';
const neutralPreflight = process.argv.length === 3 && process.argv[2] === '--neutral-preflight';
assert.ok(process.argv.length === 2 || logoutSmoke || neutralPreflight, 'Unknown explicit runner mode');
const names = neutralPreflight ? [
  'TECHNICAL ONLY: recovery download and real desktop/portal logout paths',
  'TECHNICAL ONLY: neutral shared-origin document, close old OAR, real next IZORD login',
  'TECHNICAL ONLY: neutral old writer, live portals, second download and shared purge'
] : logoutSmoke ? [
  'SHORT ONLY: real OAR login, desktop Actions → Déconnexion, renewed logged-out document',
  'SHORT ONLY: real IZORD-only login in SAME context, Se déconnecter, renewed logged-out document'
] : [
  'Explicit recovery file verified outside origin, then scoped purge; unrelated preferences preserved',
  'AFTER: real OAR payload never persisted in localStorage or sessionStorage',
  'AFTER: normal OAR logout → real IZORD-only login leaves no persisted CRM payload',
  'AFTER: close without logout, local session expires, then real IZORD login: no old persisted payload',
  'AFTER: direct /izord has no raw cache of the previous OAR account',
  'AFTER: logout and next identity propagate to the other OAR tab without a persisted payload',
  'AFTER: an old tab writes a cache → all open portals block and drop in-memory CRM access',
  'Explicit recovery file verified outside origin, then scoped purge; unrelated preferences preserved',
  'AFTER: explicit purge removes shared-origin caches in every tab'
];

async function main() {
  const outValue = process.env.IZORD_ARTIFACTS;
  if (!outValue || !isAbsolute(outValue)) throw Error('Explicit artifact directory required');
  const out = resolve(outValue);
  mkdirSync(out, { recursive: true });
  const tracePath = join(out, 'cache-playwright-trace.jsonl'), resultPath = join(out, 'cache-playwright-result.json');
  if (existsSync(tracePath) || existsSync(resultPath)) throw Error('Never overwrite an earlier run');
  writeFileSync(tracePath, '', { mode: 0o600, flag: 'wx' });
  const started = Date.now(), startedAt = new Date(started).toISOString(), runId = randomUUID();
  let group = 0, currentAction = 'preflight', actionId = 0, recoveryNumber = 0;
  /** @type {import('playwright').Browser} */ let browser;
  /** @type {import('playwright').BrowserContext} */ let context;
  /** @type {import('playwright').Page} */ let current;
  /** @type {ReturnType<typeof assertCachePlaywrightInputs>} */ let targets;
  let fixture, status, privateDir, launchStarted = false;
  let failed = null, fatal = null, stopSignal = null, cleanupPromise = null, launchPromise = null, expectedDisconnect = false;
  let blockedHTTP = 0, blockedWebSockets = 0, unexpectedCloses = 0, crashes = 0;
  const checks = [], health = [], downloadProofs = [], pages = new Map(), expectedPageCloses = new Set();
  const neutralPages = new Map(), neutralProofs = [];
  const versions = {}, sourceFiles = [], cleanupErrors = [];
  const knownPrivateValues = new Set();
  /** @type {Record<string, any>} */
  const processEvidence = { ownerPID: process.pid, ownerExitCode: missing, ownerSignal: missing,
    browserPID: missing, browserExitCode: missing, browserSignal: missing,
    browserProcessEvidence: 'DEBUG=pw:browser only; no private Playwright API or CDP' };
  const counts = { consoleErrors: 0, pageErrors: 0, dialogs: 0, canceledRequests: 0, httpErrors: 0 };
  function trace(event) {
    appendFileSync(tracePath, JSON.stringify({ timestamp: new Date().toISOString(), elapsedMs: Date.now() - started,
      group, groupName: names[group - 1] || 'preflight/cleanup', recoveryNumber, action: currentAction, ...event }) + '\n');
  }
  function rememberPrivateValues(value, key = '') {
    if (typeof value === 'string' && /password|token|key|email|cookie|db_url/i.test(key) && value.length >= 4) knownPrivateValues.add(value);
    else if (value && typeof value === 'object') for (const [childKey, child] of Object.entries(value)) rememberPrivateValues(child, childKey);
  }
  function sanitizeDiagnostic(value) {
    let text = String(value).replace(/\u001b\[[0-9;]*m/g, '');
    for (const secret of [...knownPrivateValues].sort((a, b) => b.length - a.length)) text = text.split(secret).join('[PRIVATE VALUE REDACTED]');
    text = text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, '[JWT REDACTED]')
      .replace(/\b(?:Bearer|Basic)\s+[^\s"'<>]+/gi, '[AUTH HEADER REDACTED]')
      .replace(/\b(?:authorization|apikey|cookie|set-cookie)\s*[:=][^\r\n]*/gi, '[AUTH/COOKIE HEADER REDACTED]')
      .replace(/(["']?(?:password|access_token|refresh_token|service_role_key)["']?\s*[:=]\s*)[^\r\n]*/gi, '$1[REDACTED]')
      .replace(/(?:https?|wss?):\/\/[^\s<>"')]+/g, url => safePath(url))
      .split('\n').map(line => /\b(?:fill|type|pressSequentially|insertText|evaluate|waitForFunction)\(|=>/.test(line)
        ? '[input/evaluation arguments omitted]' : line).join('\n');
    return text.slice(0, 6000);
  }
  function errorSummary(error) {
    const code = typeof error?.code === 'string' && /^CACHE_[A-Z_]+$/.test(error.code) ? error.code : undefined;
    const name = ['AssertionError', 'TimeoutError', 'Error'].includes(error?.name) ? error.name : 'Error';
    const kind = code || (/closed|disconnected/i.test(String(error?.message)) ? 'owned-browser-or-page-closed'
      : /timeout|timed out/i.test(String(error?.message)) ? 'bounded-wait-expired' : 'recorded-action-failed');
    return { name, kind, message: sanitizeDiagnostic(error?.message || 'No technical message available') };
  }
  function invariant(condition, label) { assert.ok(condition, label); }
  async function action(label, task) {
    currentAction = label; const id = ++actionId, begin = Date.now(); trace({ event: 'action-start', id });
    if (fatal) throw Error(fatal);
    try { const value = await task(); trace({ event: 'action-end', id, durationMs: Date.now() - begin }); return value; }
    catch (error) { trace({ event: 'action-failed', id, durationMs: Date.now() - begin, error: errorSummary(error) }); throw error; }
  }
  function pass(number) {
    invariant(number === checks.length + 1, 'All selected controls must run once in order');
    checks.push({ group: number, name: names[number - 1], timestamp: new Date().toISOString() });
    trace({ event: 'group-passed' }); console.log(`PASS ${number}/${names.length} ${names[number - 1]}`);
  }
  function privateJSON(file, enforceMode = true) {
    invariant(typeof file === 'string' && isAbsolute(file), 'Explicit private file required');
    invariant(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'Private input must be a regular file');
    if (enforceMode) invariant((statSync(file).mode & 0o077) === 0, 'Private input permissions must be 0600');
    try { return JSON.parse(readFileSync(file, 'utf8')); }
    catch { cacheTargetFailure('CACHE_PRIVATE_JSON_INVALID'); }
  }
  function safePath(value) {
    try {
      const url = new URL(value);
      if (!isAllowedCacheBrowserURL(value)) return '[blocked-origin]';
      if (/^\/__e2e__\/neutral-[0-9a-f-]+\.html$/.test(url.pathname)) return '/__e2e__/neutral-[owned].html';
      if (/^\/_next\/static\//.test(url.pathname)) return '/_next/static/[asset]';
      if (['/', '/spaces', '/izord', '/favicon.ico', '/icon.png', '/auth/v1/token', '/auth/v1/user',
        '/auth/v1/logout', '/auth/v1/settings', '/rest/v1/app_memberships', '/rest/v1/izord_projects',
        '/rest/v1/crm_workspace_state', '/api/drive/diagnostic'].includes(url.pathname)) return url.pathname;
      return '[other-local-path]';
    } catch { return '[non-network-url]'; }
  }
  async function probe(label, url, headers = {}) {
    const begin = Date.now(); let observation;
    try {
      const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(2000) });
      observation = { label, status: response.status, durationMs: Date.now() - begin };
      await response.body?.cancel();
    } catch { observation = { label, status: null, durationMs: Date.now() - begin, reason: 'local-service-unavailable' }; }
    health.push(observation); trace({ event: 'server-health', ...observation }); return observation.status;
  }
  function attach(page, role) {
    pages.set(page, role);
    page.on('close', () => {
      const expected = expectedPageCloses.has(page);
      trace({ event: 'page-close', page: role, voluntary: expected });
      if (!expected) { unexpectedCloses++; fatal = 'Unexpected owned page closure'; }
    });
    page.on('crash', () => { crashes++; fatal = 'Owned page crash'; trace({ event: 'page-crash', page: role }); });
    page.on('console', message => {
      if (message.type() !== 'error') return;
      counts.consoleErrors++;
      // Text may contain an URL, user input or token. Keep no raw message.
      const text = sanitizeDiagnostic(message.text());
      trace({ event: 'browser-console-error', page: role, message: text, messageSHA256: sha(text) });
    });
    page.on('pageerror', error => { counts.pageErrors++; trace({ event: 'page-error', page: role, error: errorSummary(error) }); });
    page.on('dialog', dialog => {
      counts.dialogs++; fatal = 'Unexpected browser dialog';
      trace({ event: 'dialog', page: role, type: dialog.type(), decision: 'dismiss-and-fail' });
      void dialog.dismiss().catch(() => { trace({ event: 'dialog-dismiss-failed', page: role }); });
    });
    page.on('requestfailed', request => {
      const canceled = /ERR_ABORTED/.test(request.failure()?.errorText || '');
      if (canceled) counts.canceledRequests++;
      trace({ event: 'request-failed', page: role, path: safePath(request.url()), canceled });
    });
    page.on('response', response => {
      if (response.status() >= 400) { counts.httpErrors++; trace({ event: 'http-error', page: role,
        path: safePath(response.url()), status: response.status() }); }
    });
    page.on('download', () => trace({ event: 'download-observed', page: role }));
    return page;
  }
  async function closePage(page, label) {
    finishNeutralPage(page);
    await action(label, async () => {
      expectedPageCloses.add(page); trace({ event: 'voluntary-page-close-start', page: pages.get(page) });
      await page.close({ runBeforeUnload: false });
      trace({ event: 'voluntary-page-close-end', page: pages.get(page), closed: page.isClosed() });
    });
  }
  async function ready(page, path) {
    await page.waitForURL(url => url.origin === targets.app && url.pathname === path, { timeout: 15000 });
    await page.waitForFunction(() => document.readyState !== 'loading' && !!document.body
      && !document.body.textContent.includes('Vérification des accès…'), null, { timeout: 15000 });
  }
  async function navigate(page, path) {
    finishNeutralPage(page);
    await action(`navigate owned page to ${path}`, async () => {
      await page.goto(targets.app + path, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await ready(page, path);
    });
  }
  function finishNeutralPage(page) {
    const state = neutralPages.get(page);
    if (!state) return;
    invariant(state.interceptionRemoved && state.requests === 1 && state.unexpectedRequests === 0,
      'Neutral page must issue only its exact document GET, without any application request');
    page.off('request', state.onRequest);
    page.off('websocket', state.onWebSocket);
    neutralPages.delete(page);
    trace({ event: 'neutral-page-observation-ended', page: pages.get(page),
      documentRequests: state.requests, applicationRequests: state.unexpectedRequests, interceptionRemoved: true });
  }
  async function openNeutralPage(reference, label) {
    // Guard before newPage/route: this origin is the app, never the Auth API or a cloud host.
    const url = `${targets.app}/__e2e__/neutral-${randomUUID()}.html`;
    const target = assertNeutralDocumentTarget(targets.app, url);
    return action('open exact guarded same-origin neutral HTML document', async () => {
      invariant(reference.context() === context && browser.contexts().length === 1,
        'Neutral page must use the existing account context');
      const authBefore = await authFingerprint(reference);
      invariant(authBefore.count > 0, 'Existing fictional local Auth required for shared-storage comparison');
      await assertPreference(reference);
      const page = attach(await context.newPage(), label);
      const proof = { page: label, path: target.pathname, documentRequests: 0, fulfilled: 0,
        interceptionRemoved: false, verified: false };
      neutralProofs.push(proof);
      const matches = request => isExactNeutralNavigation({ app: targets.app, expectedURL: url,
        url: request.url(), method: request.method(), isNavigationRequest: request.isNavigationRequest(),
        isMainFrame: request.frame() === page.mainFrame(), resourceType: request.resourceType() });
      const state = { requests: 0, unexpectedRequests: 0, interceptionRemoved: false,
        onRequest: request => {
          if (matches(request)) { state.requests++; proof.documentRequests++; }
          else { state.unexpectedRequests++; fatal = 'Unexpected request from neutral technical page';
            trace({ event: 'neutral-unexpected-request', page: label, path: safePath(request.url()) }); }
        },
        onWebSocket: () => { state.unexpectedRequests++; fatal = 'Unexpected WebSocket from neutral technical page';
          trace({ event: 'neutral-unexpected-websocket', page: label }); }
      };
      neutralPages.set(page, state);
      page.on('request', state.onRequest); page.on('websocket', state.onWebSocket);
      const exactURL = candidate => candidate.href === url;
      const handler = async route => {
        // Page routes take precedence over context routes. Recheck the same network
        // allowlist here; all nonmatching requests retain the normal context guard.
        if (!isAllowedCacheBrowserURL(route.request().url()) || !matches(route.request())) {
          await route.fallback(); return;
        }
        invariant(proof.fulfilled === 0, 'Neutral document may be fulfilled only once');
        proof.fulfilled++;
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
          headers: { 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; base-uri 'none'; form-action 'none'" },
          body: `<!doctype html><html data-e2e-neutral="${target.pathname}"><head><meta charset="utf-8"><title>Fictitious neutral test page</title></head><body><main id="e2e-neutral">Neutral local test document</main></body></html>` });
      };
      await page.route(exactURL, handler);
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        invariant(response?.status() === 200 && response.headers()['content-type'] === 'text/html; charset=utf-8',
          'Neutral response must be an explicit HTML 200');
        const documentState = await page.evaluate(() => ({ origin: location.origin, path: location.pathname,
          type: document.contentType, marker: document.documentElement.getAttribute('data-e2e-neutral'),
          identifiable: !!document.querySelector('main#e2e-neutral'),
          activeContent: document.querySelectorAll('script,link,iframe,object,embed').length,
          appUI: !!document.querySelector('.nav-list,[data-cache-transition],input[type=password]'),
          resources: performance.getEntriesByType('resource').length }));
        invariant(documentState.origin === targets.app && documentState.path === target.pathname
          && documentState.marker === target.pathname && documentState.type === 'text/html' && documentState.identifiable,
        'Neutral document must actually load at the exact CRM origin and reserved path');
        invariant(documentState.activeContent === 0 && !documentState.appUI && documentState.resources === 0,
          'Neutral HTML must load no CRMApp, AccessPortal, script or external resource');
        await assertPreference(page);
        assert.deepEqual(await authFingerprint(page), authBefore, 'Neutral page must read the SAME existing localStorage');
        invariant(page.context() === reference.context() && state.requests === 1 && state.unexpectedRequests === 0,
          'No application request or context change from neutral document');
        proof.verified = true;
        trace({ event: 'neutral-document-verified', ...proof, sameOrigin: true, sharedLocalStorage: true,
          scripts: 0, applicationRequests: 0, actualAppResponse: false });
        return page;
      } finally {
        if (!page.isClosed()) {
          await page.unroute(exactURL, handler);
          state.interceptionRemoved = true; proof.interceptionRemoved = true;
          trace({ event: 'neutral-interception-removed', page: label });
        }
      }
    });
  }
  async function expireClosedPageAuth(closedOAR) {
    await action('SIMULATION remove closed-page local Auth before next real login', async () => {
      invariant(closedOAR.isClosed(), 'Old OAR page must be closed before session-expiry simulation');
      await current.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('sb-') && key.endsWith('-auth-token'))
        .forEach(key => localStorage.removeItem(key)));
      trace({ event: 'local-session-expiry-simulation', closedOARPage: true, nextLoginUsesRealAuth: true });
    });
  }
  async function login(name, path = '/spaces') {
    await navigate(current, path);
    await action(`real local login ${name}`, async () => {
      const user = fixture.users[name];
      await current.locator('input[type=email]').fill(user.email);
      await current.locator('input[type=password]').fill(user.password);
      await current.getByRole('button', { name: 'Se connecter', exact: true }).click();
      await current.locator('input[type=password]').waitFor({ state: 'detached', timeout: 15000 });
      await current.waitForFunction(email => !document.body.textContent.includes('Vérification des accès…')
        && document.body.textContent.includes(email), user.email, { timeout: 15000 });
    });
  }
  async function logout() {
    const before = await action('read current document identity before user logout', () => current.evaluate(() =>
      ({ timeOrigin: performance.timeOrigin, path: location.pathname })));
    invariant(['/', '/spaces', '/izord'].includes(before.path), 'Logout starts on a known local product route');
    const menu = current.locator('details.crm-topbar-menu');
    if (await menu.count() > 0) {
      await action('open rendered CRM Actions menu if closed', async () => {
        invariant(await menu.count() === 1, 'Exactly one desktop CRM Actions menu required');
        const actions = menu.locator(':scope > summary.crm-topbar-menu-button');
        invariant(await actions.count() === 1, 'Exactly one direct CRM Actions summary required');
        await actions.waitFor({ state: 'visible' });
        const sourceLabel = (await actions.textContent())?.trim();
        const renderedLabel = (await actions.innerText()).trim();
        const textTransform = await actions.evaluate(element => getComputedStyle(element).textTransform);
        trace({ event: 'actions-summary-label-observed', sourceIsActions: sourceLabel === 'Actions',
          renderedLabel: ['Actions', 'ACTIONS'].includes(renderedLabel) ? renderedLabel : '[other label]',
          textTransform: ['none', 'uppercase', 'lowercase', 'capitalize'].includes(textTransform) ? textTransform : '[other style]' });
        invariant(sourceLabel === 'Actions', 'Direct summary source text must be Actions');
        const wasOpen = await menu.getAttribute('open') !== null;
        trace({ event: 'logout-menu-observed', page: pages.get(current), wasOpen,
          selector: 'details.crm-topbar-menu > summary.crm-topbar-menu-button',
          tag: 'summary', exactText: 'Actions', visible: true, matches: await actions.count() });
        if (!wasOpen) await actions.click();
        await current.locator('details.crm-topbar-menu[open]').waitFor({ state: 'visible' });
        invariant(await menu.getAttribute('open') !== null, 'Actions menu must be open before logout');
      });
      await action('normal click on visible enabled CRM Déconnexion in Actions', async () => {
        const button = menu.getByRole('button', { name: 'Déconnexion', exact: true });
        await button.waitFor({ state: 'visible' });
        invariant(await button.count() === 1 && await button.isEnabled(), 'Unique enabled CRM logout required');
        trace({ event: 'logout-control-observed', page: pages.get(current), menuOpen: true,
          accessibleName: 'Déconnexion', role: 'button', visible: true, enabled: true });
        await button.click();
      });
    } else {
      await action('normal click on visible enabled portal Se déconnecter', async () => {
        invariant(await menu.count() === 0, 'Ambiguous CRM menu must never select an arbitrary logout');
        invariant(['/spaces', '/izord'].includes(new URL(current.url()).pathname), 'Explicit portal logout route required');
        const button = current.getByRole('main').getByRole('button', { name: 'Se déconnecter', exact: true });
        await button.waitFor({ state: 'visible' });
        invariant(await button.count() === 1 && await button.isEnabled(), 'Unique enabled portal logout required');
        trace({ event: 'logout-control-observed', page: pages.get(current), menuPresent: false,
          accessibleName: 'Se déconnecter', role: 'button', visible: true, enabled: true });
        await button.click();
      });
    }
    await action('await renewed logged-out document and absent local Auth after user logout', async () => {
      // AccessPortal reloads the current route on identity change and also assigns
      // /spaces after signOut. Observe either product navigation; never trigger it.
      await current.waitForFunction(({ origin, path, timeOrigin }) => location.origin === origin
        && (location.pathname === '/spaces' || location.pathname === path)
        && performance.timeOrigin > timeOrigin && document.readyState === 'complete',
      { origin: targets.app, path: before.path, timeOrigin: before.timeOrigin }, { timeout: 15000 });
      await current.locator('input[type=password]').waitFor({ state: 'visible', timeout: 15000 });
      const loggedOutPath = new URL(current.url()).pathname;
      await ready(current, loggedOutPath);
      await current.getByRole('button', { name: 'Se connecter', exact: true }).waitFor({ state: 'visible' });
      invariant(await current.locator('.nav-list').count() === 0, 'OAR navigation absent after logout');
      invariant(await current.getByRole('button', { name: 'Se déconnecter', exact: true }).count() === 0,
        'Authenticated portal logout absent after logout');
      invariant((await authFingerprint(current)).count === 0, 'Local Auth must be absent after user logout');
      await assertNoCache(current);
      trace({ event: 'logged-out-ui-verified', page: pages.get(current), path: loggedOutPath,
        loginFormVisible: true, documentRenewed: true, localAuthAbsent: true, rawCRMCacheAbsent: true });
    });
  }
  async function recordFailureBeforeCleanup() {
    const observations = await Promise.all([...pages].map(async ([page, role]) => {
      const base = { page: role, path: safePath(page.url()), closed: page.isClosed() };
      if (base.closed || !browser?.isConnected()) return { ...base, state: missing };
      let timer;
      try {
        // Only allowlisted UI booleans/counts: no text, input value, storage or session snapshot.
        const state = await Promise.race([
          page.evaluate(() => {
            const visible = element => !!element && !!(element.getClientRects().length)
              && getComputedStyle(element).visibility !== 'hidden';
            const menus = document.querySelectorAll('header.topbar details.crm-topbar-menu');
            const menu = menus.length === 1 ? menus.item(0) : null;
            const summary = menu?.querySelector('summary');
            const buttons = menu ? [...menu.querySelectorAll('button')].filter(button => button.textContent.trim() === 'Déconnexion') : [];
            const button = buttons.length === 1 ? buttons[0] : null;
            return { readyState: document.readyState, menuCount: menus.length,
              menuOpen: menu ? menu.hasAttribute('open') : null,
              actionsNameMatches: summary ? summary.textContent.trim() === 'Actions' : null,
              actionsVisible: visible(summary), logoutCount: buttons.length,
              logoutVisible: visible(button), logoutEnabled: button ? !button.disabled : null,
              passwordVisible: visible(document.querySelector('input[type=password]')),
              cacheGateVisible: visible(document.querySelector('[data-cache-transition]')),
              oarNavigationPresent: !!document.querySelector('.nav-list') };
          }),
          new Promise(resolveTimeout => { timer = setTimeout(() => resolveTimeout(missing), 2000); })
        ]);
        return { ...base, state };
      } catch (error) { return { ...base, state: missing, error: errorSummary(error) }; }
      finally { clearTimeout(timer); }
    }));
    const snapshot = { timestamp: new Date().toISOString(), elapsedMs: Date.now() - started,
      cleanupStarted: cleanupPromise !== null, lastCompletedGroup: checks.at(-1)?.group ?? 0, failure: failed,
      checks, pages: observations, browserConnected: browser?.isConnected() ?? false, processEvidence: { ...processEvidence },
      counters: { ...counts, blockedHTTP, blockedWebSockets, crashes, unexpectedCloses }, health,
      secretsOrPageContentRecorded: false };
    writeFileSync(join(out, 'cache-playwright-before-cleanup.json'), JSON.stringify(snapshot, null, 2) + '\n',
      { mode: 0o600, flag: 'wx' });
    trace({ event: 'failure-state-recorded-before-cleanup', lastCompletedGroup: snapshot.lastCompletedGroup });
  }
  async function cacheState(page) {
    return page.evaluate(() => {
      const cacheKeys = storage => Object.keys(storage).filter(key => key.startsWith('oneaddress-riviera-crm-') || /^oar:[^:]+:/.test(key));
      return { localKeys: cacheKeys(localStorage), sessionKeys: cacheKeys(sessionStorage),
        localPayload: Object.values(localStorage).some(value => value.includes('OAR LOCAL CONFIDENTIEL')),
        sessionPayload: Object.values(sessionStorage).some(value => value.includes('OAR LOCAL CONFIDENTIEL')) };
    });
  }
  async function assertNoCache(page) {
    const state = await cacheState(page);
    assert.deepEqual(state.localKeys, [], 'Raw localStorage must contain no CRM keys');
    assert.deepEqual(state.sessionKeys, [], 'Raw sessionStorage must contain no CRM keys');
    invariant(!state.localPayload && !state.sessionPayload, 'Raw browser storage must contain no OAR payload');
  }
  async function loadRealOAR(page, persistenceWindow = false) {
    await action('load actual OAR REST payload and show its fictitious contact in product UI', async () => {
      // Start observing before navigation so an empty/skeleton CRM cannot pass.
      // This reads the real response only; no interception, substitution or stub.
      const [response] = await Promise.all([
        page.waitForResponse(response => {
          const url = new URL(response.url());
          return url.origin === targets.api && url.pathname === '/rest/v1/crm_workspace_state'
            && response.request().method() === 'GET';
        }, { timeout: 15000 }),
        page.goto(targets.app + '/', { waitUntil: 'domcontentloaded', timeout: 15000 })
      ]);
      invariant(response.status() === 200, 'Real workspace GET must succeed before raw cache assertions');
      const json = await response.json(), rows = Array.isArray(json) ? json : [json];
      invariant(rows.length === 1 && rows[0]?.payload?.contacts?.some(contact => contact.id === 'fictional-contact-browser'
        && contact.name === 'OAR LOCAL CONFIDENTIEL'), 'Real workspace response must contain the retained fictitious contact');
      await ready(page, '/');
      await page.locator('.nav-list').getByRole('button', { name: /Contacts/ }).click();
      await page.locator('.contacts-list-card').getByRole('heading', { name: 'OAR LOCAL CONFIDENTIEL', exact: true })
        .waitFor({ state: 'visible', timeout: 15000 });
      trace({ event: 'real-oar-load-verified', page: pages.get(page), status: 200,
        fictitiousContactInRealResponse: true, sameContactVisibleInProductUI: true, payloadRecorded: false });
      if (persistenceWindow) await page.waitForTimeout(1800); // Preserve the historical observation window.
      await assertNoCache(page);
    });
  }
  const markers = { legacy: 'FICTIONAL_LEGACY_CACHE_ONLY', scoped: 'FICTIONAL_OLD_OWNER_CACHE_ONLY', other: 'FICTIONAL_UNRELATED_PREFERENCE' };
  const legacy = 'oneaddress-riviera-crm-v1'; let scoped;
  async function seedLegacy(page) {
    await page.evaluate(({ legacy, scoped, markers }) => {
      localStorage.setItem(legacy, markers.legacy); localStorage.setItem(scoped, markers.scoped);
      localStorage.setItem('fictional-ui-preference', markers.other);
    }, { legacy, scoped, markers });
  }
  async function assertPreference(page) {
    invariant(await page.evaluate(marker => localStorage.getItem('fictional-ui-preference') === marker, markers.other), 'Unrelated preference must remain');
  }
  async function authFingerprint(page) {
    const values = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('sb-') && key.endsWith('-auth-token'))
      .sort().map(key => [key, localStorage.getItem(key)]));
    // Raw values never enter artifacts. Exact equality detects arbitrary Auth deletion.
    return { count: values.length, digest: sha(JSON.stringify(values)) };
  }
  async function assertUsable(page, shouldBeAuthenticated) {
    invariant(!page.isClosed(), 'Owned recovery page must remain open');
    const state = await page.evaluate(() => ({ path: location.pathname, ready: document.readyState,
      gate: !!document.querySelector('[data-cache-transition]'), login: !!document.querySelector('input[type=password]') }));
    invariant(state.ready !== 'loading' && state.gate && !state.login, 'Both recovery portals remain responsive after download');
    if (shouldBeAuthenticated) invariant((await authFingerprint(page)).count > 0, 'Existing local Auth must remain present');
    await assertPreference(page);
  }
  async function recoverAndPurge(otherPage = null) {
    recoveryNumber++;
    const participants = otherPage ? [current, otherPage] : [current];
    const authBefore = await Promise.all(participants.map(authFingerprint));
    if (otherPage) invariant(authBefore.every(item => item.count > 0), 'Second recovery starts with real local Auth in shared origin');
    await action('show owned recovery page and acknowledge owner', async () => {
      await current.bringToFront();
      await current.locator('[data-cache-transition]').waitFor({ state: 'visible', timeout: 15000 });
      await current.waitForFunction(() => document.visibilityState === 'visible' && document.hasFocus(), null, { timeout: 15000 });
      invariant(await current.locator('input[type=password]').count() === 0, 'No next-account login before legacy recovery');
      invariant(await current.evaluate(({ legacy, scoped, markers }) => localStorage.getItem(legacy) === markers.legacy
        && localStorage.getItem(scoped) === markers.scoped, { legacy, scoped, markers }), 'Old raw payloads must not be deleted before recovery');
      await current.locator('[data-cache-owner]').check();
      invariant(await current.locator('[data-cache-owner]').isChecked(), 'Owner acknowledgement checked');
    });
    const savePath = join(privateDir, `recovery-${recoveryNumber}.json`);
    await action('download recovery once, saveAs complete, verify private JSON', async () => {
      invariant(!existsSync(savePath), 'Each recovery download gets a new private destination');
      const [download] = await Promise.all([
        current.waitForEvent('download', { timeout: 15000 }),
        current.getByRole('button', { name: 'Télécharger la copie de récupération', exact: true }).click()
      ]);
      trace({ event: 'download-save-start' });
      await download.saveAs(savePath); // Playwright waits for completion, not just file appearance.
      invariant(await download.failure() === null, 'Browser download must complete successfully');
      chmodSync(savePath, 0o600);
      const payload = readFileSync(savePath, 'utf8'), json = JSON.parse(payload);
      invariant(json.format === 'oar-browser-recovery-v1', 'Recovery JSON format required');
      assert.deepEqual(Object.keys(json.entries).sort(), [legacy, scoped].sort(), 'Only the two recognized legacy keys are exported');
      invariant(json.entries[legacy] === markers.legacy && json.entries[scoped] === markers.scoped, 'Recovery preserves both fictitious cache families');
      invariant(payload.includes(markers.legacy) && payload.includes(markers.scoped), 'Expected fictitious payload required');
      invariant(!payload.includes(markers.other) && !/access_token|refresh_token|sb-[^"\s]+-auth-token|eyJ[A-Za-z0-9_-]+\./.test(payload), 'Recovery excludes unrelated preference and Auth sessions');
      for (const user of /** @type {any[]} */ (Object.values(fixture.users))) {
        for (const secret of [user.password, user.token, user.session?.access_token, user.session?.refresh_token]) {
          if (typeof secret === 'string' && secret.length) invariant(!payload.includes(secret), 'No local Auth credential in recovery');
        }
      }
      invariant(!payload.includes(status.ANON_KEY), 'No local API credential in recovery');
      const proof = { recoveryNumber, completed: true, saveAsCompleted: true, bytes: Buffer.byteLength(payload),
        mtimeMs: statSync(savePath).mtimeMs, sha256: sha(payload), payloadPublished: false };
      downloadProofs.push(proof); trace({ event: 'download-verified', ...proof });
      for (let index = 0; index < participants.length; index++) {
        await assertUsable(participants[index], Boolean(otherPage));
        assert.deepEqual(await authFingerprint(participants[index]), authBefore[index], 'Download must not change Auth');
      }
      trace({ event: 'all-recovery-pages-responsive', pages: participants.length, authPreserved: true, preferencePreserved: true });
    });
    await action('confirm verified recovery and explicitly purge old keys', async () => {
      await current.locator('[data-cache-recovered]').check();
      invariant(await current.locator('[data-cache-recovered]').isChecked(), 'Verified recovery acknowledgement checked');
      await current.getByRole('button', { name: 'Effacer les anciennes copies du navigateur', exact: true }).click();
      await current.locator('[data-cache-transition]').waitFor({ state: 'detached', timeout: 15000 });
      await assertNoCache(current); await assertPreference(current);
      assert.deepEqual(await authFingerprint(current), authBefore[0], 'Explicit cache purge must preserve current Auth');
    });
    return authBefore;
  }
  async function verifyRecoveredPortals(otherIZORD, beforeSecondPurge) {
    await action('both portals usable with raw caches purged and Auth/preferences preserved', async () => {
      for (const [index, page] of [current, otherIZORD].entries()) {
        await page.locator('[data-cache-transition]').waitFor({ state: 'detached', timeout: 15000 });
        await page.getByRole('button', { name: 'Se déconnecter', exact: true }).waitFor({ state: 'visible' });
        await page.waitForFunction(email => document.body.textContent.includes(email)
          && document.body.textContent.includes('Rôle :'), fixture.users.b.email, { timeout: 15000 });
        await assertNoCache(page); await assertPreference(page);
        assert.deepEqual(await authFingerprint(page), beforeSecondPurge[index], 'Auth survives explicit purge in both tabs');
        invariant(!page.isClosed(), 'Both live pages survive download and purge');
      }
    });
  }
  async function cleanup() {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      currentAction = 'owned resources cleanup'; trace({ event: 'cleanup-start' });
      // A signal during launch must not finish cleanup before the owned process
      // exists. No new context/page may be created after that signal.
      if (launchPromise) {
        trace({ event: 'cleanup-await-owned-launch-start' });
        try { const launched = await launchPromise; if (!browser) browser = launched; }
        catch { trace({ event: 'owned-launch-failed-before-cleanup' }); }
        trace({ event: 'cleanup-await-owned-launch-end' });
      }
      for (const page of pages.keys()) expectedPageCloses.add(page);
      if (context) {
        trace({ event: 'voluntary-context-close-start' });
        try { await context.close({ reason: 'Owned cache runner completed or failed' }); trace({ event: 'voluntary-context-close-end' }); }
        catch (error) { cleanupErrors.push(errorSummary(error)); trace({ event: 'voluntary-context-close-failed', error: errorSummary(error) }); }
      }
      if (browser) {
        expectedDisconnect = true; trace({ event: 'voluntary-browser-close-start', connected: browser.isConnected() });
        try { await browser.close({ reason: 'Owned cache runner completed or failed' }); trace({ event: 'voluntary-browser-close-end', connected: browser.isConnected() }); }
        catch (error) { cleanupErrors.push(errorSummary(error)); trace({ event: 'voluntary-browser-close-failed', error: errorSummary(error) }); }
      }
      if (privateDir) {
        // Only the mkdtemp directory created by this invocation, never a real profile.
        trace({ event: 'owned-private-directory-remove-start' });
        try { rmSync(privateDir, { recursive: true }); trace({ event: 'owned-private-directory-remove-end' }); }
        catch (error) { cleanupErrors.push(errorSummary(error)); trace({ event: 'owned-private-directory-remove-failed' }); }
      }
      trace({ event: 'cleanup-end' });
    })();
    return cleanupPromise;
  }

  // DEBUG=pw:browser is confined to this process. Never forward raw child logs.
  const originalStderrWrite = process.stderr.write;
  let stderrBuffer = '';
  function browserLog(line) {
    if (!line) return;
    const clean = line.replace(/\u001b\[[0-9;]*m/g, '');
    const launched = /<launched> pid=(\d+)/.exec(clean);
    const exited = /<process did exit: exitCode=(null|-?\d+), signal=(null|SIG[A-Z0-9]+)>/.exec(clean);
    if (launched) processEvidence.browserPID = Number(launched[1]);
    if (exited) {
      processEvidence.browserExitCode = exited[1] === 'null' ? null : Number(exited[1]);
      processEvidence.browserSignal = exited[2] === 'null' ? null : exited[2];
    }
    const lifecycle = launched ? 'browser-process-launched' : exited ? 'browser-process-exited'
      : /<gracefully close start>/.test(clean) ? 'browser-graceful-close-start'
      : /<gracefully close end>/.test(clean) ? 'browser-graceful-close-end' : 'browser-process-log';
    const safeMessage = sanitizeDiagnostic(clean);
    trace({ event: lifecycle, bytes: Buffer.byteLength(safeMessage), message: safeMessage, messageSHA256: sha(safeMessage),
      ...(launched ? { pid: processEvidence.browserPID } : {}),
      ...(exited ? { exitCode: processEvidence.browserExitCode, signal: processEvidence.browserSignal } : {}) });
  }
  /** @param {string | Uint8Array} chunk
   * @param {BufferEncoding | ((error?: Error) => void)} [encoding]
   * @param {(error?: Error) => void} [callback] */
  const sanitizedStderrWrite = function (chunk, encoding, callback) {
    stderrBuffer += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    const lines = stderrBuffer.split('\n'); stderrBuffer = lines.pop() || ''; lines.forEach(browserLog);
    const done = typeof encoding === 'function' ? encoding : callback;
    if (typeof done === 'function') done();
    return true;
  };
  const onExit = code => trace({ event: 'owner-process-exit', pid: process.pid, exitCode: code, signal: stopSignal || null });
  const signalHandlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const handler = () => { stopSignal = signal; processEvidence.ownerSignal = signal; fatal = 'Owner process interrupted';
      trace({ event: 'owner-signal-received', signal }); void cleanup(); };
    signalHandlers.set(signal, handler); process.on(signal, handler);
  }
  process.once('exit', onExit);

  try {
    await action('validate retained local inputs before clients or browser profile', async () => {
      assertLocalDocker(process.env);
      const workdir = process.env.IZORD_LOCAL_WORKDIR;
      invariant(workdir && isAbsolute(workdir), 'Explicit existing stack workdir required');
      const root = realpathSync(workdir);
      const statusFile = process.env.LOCAL_STATUS_FILE, fixtureFile = process.env.LOCAL_FIXTURE_FILE,
        appManifestFile = process.env.IZORD_APP_MANIFEST_FILE;
      for (const file of [statusFile, fixtureFile, appManifestFile]) {
        invariant(file && realpathSync(dirname(file)) === root, 'Inputs must belong to the retained stack');
      }
      status = privateJSON(statusFile); fixture = privateJSON(fixtureFile);
      rememberPrivateValues(status); rememberPrivateValues(fixture);
      const appManifest = privateJSON(appManifestFile), stack = privateJSON(join(workdir, 'manifest.json'), false);
      targets = assertCachePlaywrightInputs({ workdir, statusFile, fixtureFile, appManifestFile, stack, status, fixture,
        appManifest, acknowledgement: process.env.IZORD_TEST_ACK });
      const retained = privateJSON(fixture.reuse.retainedSnapshotFile);
      invariant(realpathSync(dirname(fixture.reuse.retainedSnapshotFile)) === root && resolve(retained.stackDir) === resolve(workdir)
        && retained.runId === fixture.reuse.runId, 'Retained fixture provenance required');
      invariant(retained.workspace?.payload?.contacts?.some(contact => contact.id === 'fictional-contact-browser'
        && contact.name === 'OAR LOCAL CONFIDENTIEL'), 'Known retained fictitious workspace required');
      const appDirectory = realpathSync(appManifest.directory);
      invariant(['/private/tmp/', '/tmp/', '/private/var/folders/', '/var/folders/'].some(prefix => appDirectory.startsWith(prefix)), 'Served copy must be isolated');
      const expected = new Map(appManifest.sourceFiles.map(item => [item.path, item.sha256]));
      const relevant = ['components/CRMApp.tsx', 'components/AccessPortal.tsx', 'components/AccessPortal.module.css',
        'lib/access/crmCache.ts', 'lib/access/workspaceSync.ts', 'lib/taskMaintenance.ts', 'lib/supabase.ts',
        'app/page.tsx', 'app/spaces/page.tsx', 'app/izord/page.tsx', 'app/layout.tsx', 'package.json', 'package-lock.json'];
      for (const file of relevant) {
        const currentSHA = sha(readFileSync(resolve(file))), servedSHA = sha(readFileSync(join(appDirectory, file)));
        invariant(currentSHA === servedSHA, 'Served product source differs from reviewed checkout');
        if (expected.has(file)) invariant(expected.get(file) === servedSHA, 'Served manifest hash mismatch');
        sourceFiles.push({ path: file, currentSHA, servedSHA, identical: true });
      }
      versions.application = appManifest.versions; versions.node = process.version;
      trace({ event: 'local-inputs-verified', fictitiousFixture: true, servedSourcesIdentical: true,
        appManifestStatus: appManifest.status, noAccountCreated: true });
    });
    await action('probe real local app and Auth before browser creation', async () => {
      const appStatus = await probe('app before browser launch', targets.app + '/api/drive/diagnostic');
      const authStatus = await probe('Auth before browser launch', targets.api + '/auth/v1/health', { apikey: status.ANON_KEY });
      if (appStatus !== 401 || authStatus !== 200) cacheTargetFailure('CACHE_LOCAL_SERVICES_UNAVAILABLE');
    });
    let chromium;
    await action('load exact locked external Playwright and bundled headless browser', async () => {
      const runtimeValue = process.env.IZORD_PLAYWRIGHT_RUNTIME;
      invariant(runtimeValue && isAbsolute(runtimeValue), 'Explicit external Playwright runtime required');
      const runtime = realpathSync(runtimeValue), repo = realpathSync(process.cwd());
      invariant(!runtime.startsWith(repo + '/') && ['/tmp/', '/private/tmp/'].some(prefix => runtime.startsWith(prefix)), 'Runtime must be external temporary tooling');
      const packageJSON = JSON.parse(readFileSync(join(runtime, 'package.json'), 'utf8'));
      const lockBytes = readFileSync(join(runtime, 'package-lock.json'));
      const lock = JSON.parse(lockBytes.toString());
      const installed = JSON.parse(readFileSync(join(runtime, 'node_modules/playwright/package.json'), 'utf8'));
      invariant(/^\d+\.\d+\.\d+$/.test(packageJSON.dependencies?.playwright)
        && packageJSON.dependencies.playwright === installed.version
        && lock.packages?.['node_modules/playwright']?.version === installed.version, 'Stable exact runtime and lock must match');
      const browserDirectory = realpathSync(join(runtime, 'browsers'));
      invariant(browserDirectory.startsWith(runtime + '/'), 'Browser bundle must belong to this test runtime');
      const browserSpec = JSON.parse(readFileSync(join(runtime, 'node_modules/playwright-core/browsers.json'), 'utf8'))
        .browsers.find(item => item.name === 'chromium-headless-shell');
      invariant(browserSpec && readdirSync(browserDirectory).some(name => name === `chromium_headless_shell-${browserSpec.revision}`), 'Matching official headless bundle required');
      process.env.PLAYWRIGHT_BROWSERS_PATH = browserDirectory;
      process.env.DEBUG = 'pw:browser'; process.env.DEBUG_COLORS = '0';
      process.stderr.write = sanitizedStderrWrite;
      ({ chromium } = createRequire(join(runtime, 'package.json'))('playwright'));
      versions.playwright = installed.version; versions.runtimeLockSHA256 = sha(lockBytes);
      versions.browserExpected = { revision: browserSpec.revision, version: browserSpec.browserVersion };
    });
    await action('launch exclusively owned Chromium and one empty context', async () => {
      privateDir = mkdtempSync(join(tmpdir(), 'izord-cache-playwright-owned-')); chmodSync(privateDir, 0o700);
      const isolatedHome = join(privateDir, 'home'); mkdirSync(isolatedHome, { mode: 0o700 });
      launchStarted = true; trace({ event: 'owned-browser-launch-start', ownerPID: process.pid });
      launchPromise = chromium.launch({ headless: true, timeout: 20000, downloadsPath: privateDir,
        handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
        env: { PATH: process.env.PATH, HOME: isolatedHome, TMPDIR: privateDir, LANG: 'en_US.UTF-8' } });
      browser = await launchPromise;
      browser.on('disconnected', () => { trace({ event: 'browser-disconnected', voluntary: expectedDisconnect });
        if (!expectedDisconnect) fatal = 'Unexpected owned browser disconnection'; });
      versions.browser = browser.version();
      trace({ event: 'owned-browser-launch-end', browserVersion: versions.browser });
      invariant(!stopSignal, 'Owner interruption forbids creating a context after launch');
      context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
      invariant(!stopSignal, 'Owner interruption forbids continuing context initialization');
      context.setDefaultTimeout(15000); context.setDefaultNavigationTimeout(15000);
      await context.route('**/*', async route => {
        if (!isAllowedCacheBrowserURL(route.request().url())) {
          blockedHTTP++; fatal = 'Unapproved browser request blocked'; trace({ event: 'remote-http-blocked' });
          await route.abort('blockedbyclient'); return;
        }
        await route.continue();
      });
      await context.routeWebSocket('**/*', route => {
        if (!isAllowedCacheBrowserURL(route.url(), { webSocket: true })) {
          blockedWebSockets++; fatal = 'Unapproved browser WebSocket blocked'; trace({ event: 'remote-websocket-blocked' });
          route.close({ code: 1008, reason: 'Local test target only' }); return;
        }
        route.connectToServer();
      });
      current = attach(await context.newPage(), 'initial-portal');
      scoped = `oar:${fixture.users.both.id}:${legacy}`;
    });
    await navigate(current, '/spaces');
    await action('verify fresh shared origin before any identity', async () => {
      await assertNoCache(current);
      invariant((await authFingerprint(current)).count === 0, 'New context must have no previous Auth session');
      invariant(await current.evaluate(() => sessionStorage.length === 0), 'Fresh page sessionStorage required');
      trace({ event: 'fresh-context-verified', contexts: 1, accountIsolationByNewContext: false });
    });

    if (neutralPreflight) {
      group = 1;
      await action('insert fictitious historical cache while unauthenticated', () => seedLegacy(current));
      await navigate(current, '/spaces'); await recoverAndPurge();
      await login('both'); await loadRealOAR(current); await logout();
      await login('b', '/izord'); await logout(); pass(1);

      group = 2;
      await login('both'); await loadRealOAR(current);
      const oldOAR = current;
      current = await openNeutralPage(oldOAR, 'technical-reopened-page');
      await closePage(oldOAR, 'technical close OAR without logout');
      await expireClosedPageAuth(oldOAR);
      await login('b', '/izord'); await assertNoCache(current); pass(2);

      group = 3;
      const otherIZORD = attach(await context.newPage(), 'technical-other-izord'); await navigate(otherIZORD, '/izord');
      const writer = await openNeutralPage(current, 'technical-old-writer');
      await action('technical old writer inserts only existing fictitious cache markers', () => seedLegacy(writer));
      await action('technical both real portals gate on obsolete cache write', async () => {
        for (const page of [current, otherIZORD]) {
          await page.locator('[data-cache-transition]').waitFor({ state: 'visible' });
          invariant(await page.locator('.nav-list').count() === 0, 'No CRM module while legacy cache exists');
        }
      });
      await closePage(writer, 'technical close old cache writer before recovery');
      const beforePurge = await recoverAndPurge(otherIZORD);
      await verifyRecoveredPortals(otherIZORD, beforePurge); pass(3);
    } else if (logoutSmoke) {
      group = 1;
      await login('both'); await loadRealOAR(current); await logout(); pass(1);
      group = 2;
      await login('b', '/izord');
      await action('short check uses original context after real account change', async () => {
        invariant(current.context() === context && browser.contexts().length === 1,
          'Short validation must keep exactly the same context between real accounts');
        await assertNoCache(current);
      });
      await logout(); pass(2);
    } else {
    group = 1;
    await action('insert fictitious historical cache while unauthenticated', () => seedLegacy(current));
    await navigate(current, '/spaces'); await recoverAndPurge(); pass(1);

    group = 2;
    await login('both'); await loadRealOAR(current, true); pass(2);

    group = 3;
    await logout(); await login('b', '/izord');
    await action('raw storage after normal OAR to IZORD-only account change', () => assertNoCache(current)); pass(3);

    group = 4;
    await logout(); await login('both'); await loadRealOAR(current, true);
    const closedOAR = current;
    current = await openNeutralPage(closedOAR, 'reopened-profile');
    await closePage(closedOAR, 'close OAR page without logout');
    await expireClosedPageAuth(closedOAR);
    await login('b', '/izord');
    await action('raw storage after closed-page expiry and real next login', () => assertNoCache(current)); pass(4);

    group = 5;
    await navigate(current, '/izord');
    await action('raw storage on direct IZORD route', () => assertNoCache(current)); pass(5);

    group = 6;
    await logout(); await login('both'); await loadRealOAR(current);
    const otherOAR = attach(await context.newPage(), 'other-oar'); await loadRealOAR(otherOAR);
    await logout(); await login('b', '/izord');
    await action('other OAR tab leaves old identity and has no raw payload', async () => {
      await otherOAR.waitForFunction(() => !document.querySelector('.nav-list')
        && !document.body.textContent.includes('OAR LOCAL CONFIDENTIEL'), null, { timeout: 15000 });
      await assertNoCache(otherOAR);
    }); pass(6);
    await closePage(otherOAR, 'close completed secondary OAR page');

    group = 7;
    const otherIZORD = attach(await context.newPage(), 'other-izord'); await navigate(otherIZORD, '/izord');
    const legacyWriter = await openNeutralPage(current, 'legacy-writer');
    await action('obsolete tab writes fictional old cache into shared origin', () => seedLegacy(legacyWriter));
    await action('both open portals gate and discard prior CRM interface', async () => {
      for (const page of [current, otherIZORD]) {
        await page.locator('[data-cache-transition]').waitFor({ state: 'visible' });
        invariant(await page.locator('.nav-list').count() === 0, 'No CRM module while legacy cache exists');
      }
    }); pass(7);
    await closePage(legacyWriter, 'close only obsolete cache writer before second recovery');

    group = 8;
    const beforeSecondPurge = await recoverAndPurge(otherIZORD); pass(8);

    group = 9;
    await verifyRecoveredPortals(otherIZORD, beforeSecondPurge); pass(9);
    }
    invariant(!fatal && blockedHTTP === 0 && blockedWebSockets === 0 && crashes === 0 && unexpectedCloses === 0, 'No blocked target, crash or unexpected closure');
    await probe('app after successful suite', targets.app + '/api/drive/diagnostic');
  } catch (error) {
    failed = { group, action: currentAction, error: errorSummary(error), timestamp: new Date().toISOString() };
    trace({ event: 'suite-failed', ...failed });
    if (targets) await probe('app at failure', targets.app + '/api/drive/diagnostic');
    await recordFailureBeforeCleanup();
  } finally {
    await cleanup();
    if (stderrBuffer) { browserLog(stderrBuffer); stderrBuffer = ''; }
    process.stderr.write = originalStderrWrite;
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    if (cleanupErrors.length && !failed) failed = { group, action: 'cleanup', error: { kind: 'owned-cleanup-failed' }, timestamp: new Date().toISOString() };
    if (fatal && !failed) failed = { group, action: currentAction, error: { kind: 'fatal-browser-event' }, timestamp: new Date().toISOString() };
    const success = !failed && checks.length === names.length;
    process.exitCode = success ? 0 : 1;
    processEvidence.ownerExitCode = process.exitCode;
    if (!stopSignal) processEvidence.ownerSignal = null;
    const result = { startedAt, endedAt: new Date().toISOString(), durationMs: Date.now() - started, runId,
      mode: neutralPreflight ? 'technical neutral-page preflight only; NOT nine cache groups'
        : logoutSmoke ? 'short logout validation only; NOT nine cache groups' : 'direct owned Playwright; corrected cache lifecycle',
      status: success ? 'passed' : 'failed',
      plannedGroups: names.length, passed: checks.length, checks, failure: failed, retries: 0, oneContextForAllAccountsAndTabs: true,
      browserLaunchStarted: launchStarted, accountCreationAttempts: 0, versions, sourceFiles, processEvidence,
      health, downloadProofs, neutralProofs, counters: { ...counts, blockedHTTP, blockedWebSockets, crashes, unexpectedCloses },
      cleanupErrors, recoveryPayloadPublished: false, harOrSessionTraceRecorded: false, realProfileTouched: false,
      limitations: ['Closed-page local Auth expiry is simulated; subsequent logins use real local Supabase Auth.',
        'Neutral HTML is a scoped test response, not a real Next page; Playwright routing changes HTTP-cache behavior.',
        'Browser process diagnostics depend on sanitized DEBUG=pw:browser events; unavailable values are explicit.',
        'This run does not establish the cause of either historical agent-browser/CDP incident.'] };
    writeFileSync(resultPath, JSON.stringify(result, null, 2), { mode: 0o600, flag: 'wx' });
    trace({ event: 'result-written', passed: checks.length, status: result.status });
    console.log(`${neutralPreflight ? 'Technical preflight only' : logoutSmoke ? 'Short logout only' : 'Cache Playwright'}: ${checks.length}/${names.length}; ${result.status}. Sanitized artifacts written.`);
  }
}

main().catch(() => {
  // Do not print an unhandled Playwright stack: it may contain fill arguments.
  console.error('Cache Playwright refused or failed before report completion; no raw error published.');
  process.exitCode = 1;
});
