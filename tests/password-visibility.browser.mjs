// Focused local browser fixtures: actual CRM source + actual Supabase SDK,
// intercepted fictitious Auth/REST. Never real authentication evidence.
// No screenshots, traces, video, storage dumps, request-body or password logs.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin = process.env.PASSWORD_TEST_URL || 'http://127.0.0.1:3187';
const output = process.env.PASSWORD_TEST_REPORT || '/private/tmp/password-visibility-results.json';
const harness = join(dirname(fileURLToPath(import.meta.url)), '../app/password-fixture/page.tsx');
const harnessSource = `"use client";
import { useState } from "react";
import PasswordInput from "@/components/PasswordInput";
export default function PasswordFixture() {
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [reset, setReset] = useState(0);
  const [submitted, setSubmitted] = useState(0);
  return <main style={{ padding: 24, maxWidth: 480 }}>
    <h1>Composant commun</h1>
    <form onSubmit={event => { event.preventDefault(); setReset(value => value + 1); setSubmitted(value => value + 1); }}>
      <label>Premier mot de passe<PasswordInput resetKey={reset} autoComplete="new-password" value={first} onChange={event => setFirst(event.target.value)} /></label>
      <label>Confirmation du mot de passe<PasswordInput resetKey={reset} autoComplete="new-password" value={second} onChange={event => setSecond(event.target.value)} /></label>
      <button>Valider la fixture</button>
      <button type="button" onClick={() => setReset(value => value + 1)}>Nouveau parcours fixture</button>
    </form>
    <p role="status">{submitted ? "Fixture envoyée" : "Fixture en attente"}</p>
  </main>;
}
`;
if (existsSync(harness) && readFileSync(harness, 'utf8') !== harnessSource) throw new Error('Existing unrelated fixture route is preserved');
mkdirSync(dirname(harness), { recursive: true });
writeFileSync(harness, harnessSource, { mode: 0o600 });
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Local app required');
const authOrigin = 'http://127.0.0.1:3997';
const user = { id: '10000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'password-fixture@example.invalid', email_confirmed_at: '2026-01-01T00:00:00.000Z', created_at: '2026-01-01T00:00:00.000Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [] };
const session = { access_token: 'fixture-access-token', refresh_token: 'fixture-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
const passwords = ['  Fictif-CRM-71!  ', '1234567', ' Confirmation-82! ', ' Replacement-93! '];
const report = [];
let activeCase = 'initialization';
let activeStep = 'browser initialization';
let failed = false;
class FixtureAssertion extends Error {}
function check(value, name) { if (!value) throw new FixtureAssertion(name); }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(browser, mobile, authenticated) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  const state = { authCalls: 0, signIns: 0, updates: 0, invitations: 0, denied: 0, blocked: 0, unexpected: 0, bodyExact: true, loginError: true, updateError: true, verificationError: false, expected: passwords[0], consoleLeaks: 0, urlLeaks: 0, storageLeaks: 0, downloads: 0, browserErrors: 0, dialogs: 0, optionTabFallback: false, phase: 'startup', authReadPhases: [], navigationAuthReads: 0, navigationWindowFocusEvents: 0 };
  await context.addInitScript(({ authenticated, session, passwords }) => {
    if (authenticated) localStorage.setItem('sb-127-auth-token', JSON.stringify(session));
    window.__passwordTestStorageLeaks = 0;
    window.__passwordTestWindowFocus = 0;
    window.addEventListener('focus', event => { if (event.target === window) window.__passwordTestWindowFocus++; });
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (passwords.some(password => String(key).includes(password) || String(value).includes(password))) window.__passwordTestStorageLeaks++;
      return original.call(this, key, value);
    };
  }, { authenticated, session, passwords });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (passwords.some(password => request.url().includes(password) || request.url().includes(encodeURIComponent(password)))) state.urlLeaks++;
    if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    if (url.origin !== authOrigin) { state.blocked++; return route.abort(); }
    const path = url.pathname, method = request.method();
    const reply = (json, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': origin }, body: JSON.stringify(json) });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS' } });
    if (path.startsWith('/auth/v1/')) state.authCalls++;
    if (path === '/auth/v1/token' && method === 'POST') {
      state.signIns++;
      const body = request.postDataJSON();
      state.bodyExact &&= body.password === state.expected;
      return state.loginError ? reply({ msg: 'Fixture authentication rejected', code: 'invalid_credentials' }, 400) : reply(session);
    }
    if (path === '/auth/v1/user' && method === 'GET') {
      state.authReadPhases.push(state.phase);
      return state.verificationError ? reply({ msg: 'Fixture session denied', code: 'bad_jwt' }, 401) : reply({ user });
    }
    if (path === '/auth/v1/user' && method === 'PUT') {
      state.updates++;
      const body = request.postDataJSON();
      state.bodyExact &&= body.password === state.expected;
      return state.updateError ? reply({ msg: 'Fixture password rejected', code: 'weak_password' }, 422) : reply({ user });
    }
    if (path === '/auth/v1/logout') return reply({});
    if (path === '/rest/v1/app_memberships' && method === 'GET') return reply([]);
    if (path === '/rest/v1/rpc/crm_access_snapshot') return reply({ revision: 1, active: true, generalAdmin: false, fullAccess: false, modules: {} });
    if (path === '/rest/v1/rpc/crm_invite_accept') { state.invitations++; return reply({ accepted: true }); }
    state.unexpected++;
    return route.abort();
  });
  const page = await context.newPage();
  page.on('console', message => { if (passwords.some(password => message.text().includes(password))) state.consoleLeaks++; });
  page.on('pageerror', () => { state.browserErrors++; });
  page.on('download', download => { state.downloads++; void download.cancel(); });
  page.on('dialog', dialog => { state.dialogs++; void dialog.dismiss(); });
  async function finish() {
    if (!page.isClosed()) {
      const leaks = await page.evaluate(passwords => ({ count: window.__passwordTestStorageLeaks || 0, present: passwords.some(password => [localStorage, sessionStorage].some(storage => Object.keys(storage).some(key => key.includes(password) || (storage.getItem(key) || '').includes(password)))), url: passwords.some(password => location.href.includes(password) || location.href.includes(encodeURIComponent(password))) }), passwords);
      state.storageLeaks += leaks.count + Number(leaks.present); state.urlLeaks += Number(leaks.url);
    }
    check(state.bodyExact, 'Exact submitted password retained');
    check(state.blocked === 0 && state.unexpected === 0, 'Only local app and authorized fixture endpoints');
    check(state.consoleLeaks === 0 && state.storageLeaks === 0 && state.urlLeaks === 0 && state.downloads === 0, 'No password disclosure or persistence');
    check(state.browserErrors === 0 && state.dialogs === 0, 'No browser errors or native prompt');
    await context.close();
    return { authCalls: state.authCalls, signIns: state.signIns, updates: state.updates, invitations: state.invitations, remoteRequests: state.blocked, browserErrors: state.browserErrors, passwordLeaks: state.consoleLeaks + state.storageLeaks + state.urlLeaks, captures: 0, optionTabFallback: state.optionTabFallback, navigationAuthReads: state.navigationAuthReads, navigationWindowFocusEvents: state.navigationWindowFocusEvents };
  }
  return { context, page, state, finish };
}

async function sdkEvent(page, event, changedAccount = false) {
  await page.evaluate(async ({ event, session, changedAccount }) => {
    let client;
    window.webpackChunk_N_E.push([[Math.random()], {}, require => {
      const modules = require.c ? Object.values(require.c) : Object.entries(require.m).filter(([, factory]) => String(factory).includes('http://127.0.0.1:3997')).map(([id]) => ({ exports: require(id) }));
      for (const entry of modules) {
        for (const value of Object.values(entry.exports || {})) {
          if (value && typeof value === 'object' && value.auth && typeof value.auth.refreshSession === 'function' && typeof value.from === 'function') { client = value; break; }
        }
        if (client) break;
      }
    }]);
    if (!client) throw new Error('Fixture SDK not found');
    const next = changedAccount ? { ...session, user: { ...session.user, id: '10000000-0000-4000-8000-000000000002', email: 'other-fixture@example.invalid' } } : session;
    if (changedAccount) await client.auth._saveSession(next);
    await client.auth._notifyAllSubscribers(event, next, false);
  }, { event, session, changedAccount });
}

async function verifyField(page, field, autocomplete, state, mobile) {
  // The portal can finish one of its duplicate startup/session GET checks
  // after the first form paint. Wait for bounded read-only quiescence before
  // measuring whether eye interaction creates any Auth call.
  let stable = 0, previous = state.authCalls;
  for (let elapsed = 0; elapsed < 2000 && stable < 250; elapsed += 50) {
    await sleep(50);
    stable = state.authCalls === previous ? stable + 50 : 0;
    previous = state.authCalls;
  }
  check(stable >= 250, 'Initial Auth checks settle before visibility measurement');
  check(state.signIns === 0 && state.updates === 0 && state.invitations === 0, 'Initial verification is read-only');
  check(await field.getAttribute('type') === 'password', 'Masked default');
  check(await field.getAttribute('autocomplete') === autocomplete, 'Password autocomplete retained');
  check(await field.getAttribute('spellcheck') === 'false' && await field.getAttribute('autocapitalize') === 'none' && await field.getAttribute('autocorrect') === 'off', 'No spelling correction or automatic capitals');
  await field.fill(passwords[0]);
  await field.evaluate(input => { input.__passwordIdentity = true; input.focus(); input.setSelectionRange(2, 9, 'backward'); });
  const before = state.authCalls;
  state.phase = 'pointer-reveal';
  const eye = field.locator('xpath=..').getByRole('button', { name: 'Afficher le mot de passe', exact: true });
  check(await eye.getAttribute('type') === 'button', 'Eye never submits a form');
  const geometry = await field.evaluate(input => {
    const button = input.parentElement.querySelector('button'), r = input.getBoundingClientRect(), b = button.getBoundingClientRect();
    return { separate: b.left >= r.right + 4, sized: b.width >= 44 && b.height >= 44, fits: b.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth + 1 };
  });
  check(geometry.separate && geometry.sized && geometry.fits, 'Readable separate touch target without text overlap or overflow');
  if (mobile) {
    await eye.evaluate(button => {
      window.__passwordTestTouchCounts = { pointerdown: 0, pointerup: 0, click: 0 };
      for (const type of ['pointerdown', 'pointerup', 'click']) button.addEventListener(type, () => window.__passwordTestTouchCounts[type]++);
    });
    await eye.tap();
    await sleep(150);
    state.touchCounts = await page.evaluate(() => window.__passwordTestTouchCounts);
    check(state.touchCounts.pointerdown === 1 && state.touchCounts.pointerup === 1 && state.touchCounts.click === 1, 'Touch activation makes one native click');
  } else await eye.click();
  check(await field.getAttribute('type') === 'text', 'Pointer reveals characters');
  check(await field.evaluate(input => input.__passwordIdentity === true && input.selectionStart === 2 && input.selectionEnd === 9 && input.selectionDirection === 'backward' && document.activeElement === input), 'Pointer preserves DOM input caret backward selection and focus');
  check((await field.inputValue()) === passwords[0], 'Pointer preserves exact spaces and value');
  state.phase = 'pointer-mask';
  const mask = field.locator('xpath=..').getByRole('button', { name: 'Masquer le mot de passe', exact: true });
  if (mobile) { await mask.tap(); await sleep(150); } else await mask.click();
  check(await field.getAttribute('type') === 'password', 'Second pointer masks characters');
  await field.evaluate(input => { input.focus(); input.setSelectionRange(5, 5); });
  state.phase = 'caret-reveal';
  const caretReveal = field.locator('xpath=..').getByRole('button', { name: 'Afficher le mot de passe', exact: true });
  if (mobile) { await caretReveal.tap(); await sleep(150); } else await caretReveal.click();
  check(await field.evaluate(input => input.__passwordIdentity === true && input.selectionStart === 5 && input.selectionEnd === 5), 'Reveal preserves collapsed middle caret');
  state.phase = 'caret-mask';
  const caretMask = field.locator('xpath=..').getByRole('button', { name: 'Masquer le mot de passe', exact: true });
  if (mobile) { await caretMask.tap(); await sleep(150); } else await caretMask.click();
  check(await field.evaluate(input => input.__passwordIdentity === true && input.selectionStart === 5 && input.selectionEnd === 5), 'Mask preserves collapsed middle caret');
  await sleep(80);
  check(state.authCalls === before, 'Mouse and touch eye clicks cause no Auth calls');
  await field.evaluate(input => { input.focus(); input.setSelectionRange(2, 9, 'backward'); });
  state.phase = 'keyboard-navigation';
  const focusBefore = await page.evaluate(() => window.__passwordTestWindowFocus);
  await field.focus(); await page.keyboard.press('Tab');
  const keyboardEye = field.locator('xpath=..').getByRole('button', { name: 'Afficher le mot de passe', exact: true });
  if (!(await keyboardEye.evaluate(button => document.activeElement === button)) && page.context().browser().browserType().name() === 'webkit') {
    // macOS WebKit follows Safari's all-controls navigation setting. Its
    // default Option+Tab is documented by Apple; do not modify host settings.
    // https://support.apple.com/en-gb/guide/safari/cpsh003/mac
    await field.focus(); await page.keyboard.press('Alt+Tab');
    state.optionTabFallback = true;
  }
  check(await keyboardEye.evaluate(button => document.activeElement === button), 'Eye reachable by native keyboard navigation');
  check(await keyboardEye.evaluate(button => { const s = getComputedStyle(button); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; }), 'Keyboard focus visible');
  // macOS native all-controls navigation can focus the browser window. The
  // portal's existing window-focus session verification must finish before
  // separately measuring activation of the eye via Space/Enter.
  stable = 0; previous = state.authCalls;
  for (let elapsed = 0; elapsed < 2000 && stable < 250; elapsed += 50) {
    await sleep(50);
    stable = state.authCalls === previous ? stable + 50 : 0;
    previous = state.authCalls;
  }
  check(stable >= 250, 'Existing navigation focus verification settles');
  state.navigationAuthReads += state.authCalls - before;
  state.navigationWindowFocusEvents += (await page.evaluate(() => window.__passwordTestWindowFocus)) - focusBefore;
  const keyboardBefore = state.authCalls;
  state.phase = 'keyboard-reveal';
  await page.keyboard.press('Space');
  check(await field.getAttribute('type') === 'text', 'Space reveals characters');
  check(await field.evaluate(input => input.__passwordIdentity === true && input.selectionStart === 2 && input.selectionEnd === 9 && input.selectionDirection === 'backward'), 'Keyboard preserves same DOM input caret and selection');
  state.phase = 'keyboard-mask';
  await page.keyboard.press('Enter');
  check(await field.getAttribute('type') === 'password', 'Enter masks without submission');
  check((await field.inputValue()) === passwords[0], 'Keyboard preserves exact password');
  await sleep(80);
  check(state.authCalls === keyboardBefore, 'Keyboard eye activation causes no Auth calls');
  // Synthetic paste uses the native insertion path and clipboard paste event.
  await field.evaluate(input => { input.focus(); input.setSelectionRange(0, input.value.length); });
  await page.keyboard.insertText(passwords[0]);
  check((await field.inputValue()) === passwords[0], 'Native text insertion remains allowed');
  check(await field.evaluate(input => !input.onpaste && input.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }))), 'Paste event not blocked');
}

async function runCase(browser, engine, mobile, name, authenticated, work) {
  if (process.env.PASSWORD_TEST_CASE && name !== process.env.PASSWORD_TEST_CASE) return;
  activeCase = `${engine}-${mobile ? 'mobile' : 'desktop'}-${name}`;
  activeStep = 'fixture initialization';
  const f = await fixture(browser, mobile, authenticated);
  f.page.setDefaultTimeout(10000);
  try {
    await work(f);
    report.push({ name: activeCase, passed: true, ...(await f.finish()) });
    console.log(`PASS ${activeCase}`);
  } catch (error) {
    await f.context.close();
    // Failure messages are only fixed assertion names: no browser HTML, request,
    // input value, network bodies, storage, error stacks or password evidence.
    report.push({ name: activeCase, passed: false, assertion: error instanceof FixtureAssertion ? error.message : 'Browser operation did not complete', step: activeStep, authReadPhases: f.state.authReadPhases, signIns: f.state.signIns, updates: f.state.updates, invitations: f.state.invitations, touchCounts: f.state.touchCounts });
    throw new Error(`Failed ${activeCase}`);
  }
}

try {
  for (const engine of process.env.PASSWORD_TEST_ENGINE ? [process.env.PASSWORD_TEST_ENGINE] : ['chromium', 'webkit']) {
    activeCase = `${engine}-initialization`;
    activeStep = 'browser initialization';
    const browser = await (engine === 'chromium' ? chromium.launch({ headless: true, channel: 'chrome' }) : webkit.launch({ headless: true }));
    try {
      for (const mobile of process.env.PASSWORD_TEST_DESKTOP_ONLY ? [false] : [false, true]) {
        await runCase(browser, engine, mobile, 'login-error-retry', false, async ({ page, state }) => {
          await page.goto(origin + '/');
          const field = page.getByLabel('Mot de passe', { exact: true });
          await field.waitFor(); await sleep(120);
          await verifyField(page, field, 'current-password', state, mobile);
          await page.getByLabel('Email', { exact: true }).fill(user.email);
          await field.locator('xpath=..').getByRole('button', { name: 'Afficher le mot de passe', exact: true }).click();
          await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
          await page.getByText('Connexion impossible. Vérifiez vos identifiants.', { exact: true }).waitFor();
          check(state.signIns === 1, 'Only explicit login submits');
          check(await field.getAttribute('type') === 'password' && (await field.inputValue()) === passwords[0], 'Login error masks and retains exact password');
          state.loginError = false;
          await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
          await page.getByRole('heading', { name: 'Aucun accès autorisé', exact: true }).waitFor();
          check(state.signIns === 2 && state.updates === 0, 'Login retry uses existing Auth sign in only');
        });

        await runCase(browser, engine, mobile, 'invitation-definition-error-retry', true, async ({ page, state }) => {
          await page.goto(origin + '/?invite=fixture-business-invite&setup=1');
          const field = page.getByLabel('Choisissez un mot de passe', { exact: true });
          await field.waitFor(); await sleep(120);
          await verifyField(page, field, 'new-password', state, mobile);
          await field.fill(passwords[1]);
          const accept = page.getByRole('button', { name: 'Accepter mon invitation', exact: true });
          check(await accept.isDisabled() || await field.evaluate(input => !input.checkValidity()), 'Invitation minimum eight retained');
          check(state.updates === 0 && state.invitations === 0, 'Invalid invitation password makes no write');
          await field.fill(passwords[0]);
          await field.locator('xpath=..').getByRole('button', { name: 'Afficher le mot de passe', exact: true }).click();
          await accept.click();
          await page.getByRole('alert').filter({ hasText: 'Invitation acceptée. Mot de passe non enregistré' }).waitFor();
          check(state.invitations === 1 && state.updates === 1, 'Invitation accept before password update');
          check(await field.getAttribute('type') === 'password' && (await field.inputValue()) === passwords[0], 'Invitation error masks and retains exact password');
          state.updateError = false;
          await page.getByRole('button', { name: 'Enregistrer mon mot de passe', exact: true }).click();
          await page.getByRole('heading', { name: 'Aucun accès autorisé', exact: true }).waitFor();
          check(state.invitations === 1 && state.updates === 2, 'Invitation retry never accepts twice');
          check(await page.getByLabel('Choisissez un mot de passe', { exact: true }).count() === 0, 'Successful definition closes existing setup');
        });

        await runCase(browser, engine, mobile, 'recovery-validation-error-retry-cancel', true, async ({ page, state }) => {
          await page.goto(origin + '/'); await page.getByRole('heading', { name: 'Aucun accès autorisé', exact: true }).waitFor();
          await sdkEvent(page, 'PASSWORD_RECOVERY');
          activeStep = 'recovery form first open';
          const field = page.getByLabel('Nouveau mot de passe', { exact: true });
          await field.waitFor(); await sleep(120);
          await verifyField(page, field, 'new-password', state, mobile);
          activeStep = 'recovery minimum validation';
          await field.fill(passwords[1]);
          const submit = page.getByRole('button', { name: 'Enregistrer le mot de passe', exact: true });
          await field.locator('xpath=..').getByRole('button', { name: 'Afficher le mot de passe', exact: true }).click();
          if (!(await submit.isDisabled())) await submit.click();
          check(state.updates === 0, 'Recovery minimum eight blocks update');
          check(await field.getAttribute('type') === 'password' && (await field.inputValue()) === passwords[1], 'Invalid recovery attempt masks and retains short password');
          await field.fill(passwords[0]);
          await field.locator('xpath=..').getByRole('button', { name: 'Afficher le mot de passe', exact: true }).click();
          await submit.click();
          activeStep = 'recovery error status';
          await page.getByText('Mot de passe non modifié. Réessayez.', { exact: true }).waitFor();
          check(state.updates === 1, 'Explicit recovery validation uses original update');
          check(await field.getAttribute('type') === 'password' && (await field.inputValue()) === passwords[0], 'Recovery error masks and retains exact password');
          state.updateError = false;
          await submit.click();
          activeStep = 'recovery success status';
          await page.getByText('Mot de passe enregistré.', { exact: true }).waitFor();
          check(state.updates === 2, 'Recovery retry explicitly updates once');
          check(await field.count() === 0, 'Successful recovery closes form');
          await sdkEvent(page, 'PASSWORD_RECOVERY'); await field.waitFor();
          activeStep = 'recovery reopen clear';
          check(await field.getAttribute('type') === 'password' && (await field.inputValue()) === '', 'New recovery starts masked without previous password');
          await field.fill(passwords[3]);
          await field.locator('xpath=..').getByRole('button', { name: 'Afficher le mot de passe', exact: true }).click();
          await sdkEvent(page, 'PASSWORD_RECOVERY');
          await sleep(100);
          check(await field.getAttribute('type') === 'password' && (await field.inputValue()) === '', 'Reopening recovery masks and clears previous flow');
          const before = state.updates;
          await page.getByRole('button', { name: 'Annuler', exact: true }).click();
          check(await field.count() === 0 && state.updates === before, 'Recovery cancel causes no update');
        });

        await runCase(browser, engine, mobile, 'recovery-session-account-guards', true, async ({ page, state }) => {
          await page.goto(origin + '/'); await page.getByRole('heading', { name: 'Aucun accès autorisé', exact: true }).waitFor();
          await sdkEvent(page, 'PASSWORD_RECOVERY');
          const field = page.getByLabel('Nouveau mot de passe', { exact: true });
          await field.waitFor(); await field.fill(passwords[0]);
          state.verificationError = true;
          await page.getByRole('button', { name: 'Enregistrer le mot de passe', exact: true }).click();
          await sleep(350);
          check(state.updates === 0, 'Failed verification never changes password');
          state.verificationError = false;
          await sdkEvent(page, 'PASSWORD_RECOVERY'); await field.waitFor();
          await field.fill(passwords[0]);
          await sdkEvent(page, 'SIGNED_IN', true);
          await sleep(350);
          check(await field.count() === 0, 'Account change closes recovery through original reload');
          check(state.updates === 0, 'Account change never writes previous account password');
        });

        await runCase(browser, engine, mobile, 'common-component-independent-fields', false, async ({ page, state }) => {
          await page.goto(origin + '/password-fixture');
          const first = page.getByLabel('Premier mot de passe', { exact: true }), second = page.getByLabel('Confirmation du mot de passe', { exact: true });
          await first.waitFor(); await verifyField(page, first, 'new-password', state, mobile);
          await second.fill(passwords[2]);
          await first.locator('xpath=..').getByRole('button', { name: 'Afficher le mot de passe', exact: true }).click();
          check(await first.getAttribute('type') === 'text' && await second.getAttribute('type') === 'password', 'First reveal leaves confirmation masked');
          await second.locator('xpath=..').getByRole('button', { name: 'Afficher le mot de passe', exact: true }).click();
          await first.locator('xpath=..').getByRole('button', { name: 'Masquer le mot de passe', exact: true }).click();
          check(await first.getAttribute('type') === 'password' && await second.getAttribute('type') === 'text', 'Confirmation reveal independent of first field');
          check((await first.inputValue()) === passwords[0] && (await second.inputValue()) === passwords[2], 'Independent toggles preserve both exact values');
          await page.getByRole('button', { name: 'Valider la fixture', exact: true }).click();
          check(await first.getAttribute('type') === 'password' && await second.getAttribute('type') === 'password', 'Submit masks every field');
          check((await first.inputValue()) === passwords[0] && (await second.inputValue()) === passwords[2], 'Submit masking retains resumable input');
          await first.locator('xpath=..').getByRole('button', { name: 'Afficher le mot de passe', exact: true }).click();
          await page.getByRole('button', { name: 'Nouveau parcours fixture', exact: true }).click();
          check(await first.getAttribute('type') === 'password' && await second.getAttribute('type') === 'password', 'New common component flow masked');
          check(state.signIns === 0 && state.updates === 0, 'Common component is display local only');
        });
      }
    } finally { await browser.close(); }
  }
} catch {
  failed = true;
  if (report.at(-1)?.passed !== false) report.push({ name: activeCase, passed: false, assertion: 'Browser operation did not complete', step: activeStep });
  console.error(`FAIL ${activeCase}; see fixed assertion name in boolean/count report`);
  process.exitCode = 1;
} finally {
  rmSync(harness);
  try { rmdirSync(dirname(harness)); } catch { /* Preserve unrelated files. */ }
  writeFileSync(output, JSON.stringify({ passed: !failed && report.length > 0 && report.every(item => item.passed), fictitiousNetworkFixtures: true, actualSupabaseSdk: true, realAuthenticationProof: false, screenshots: false, traces: false, cases: report }, null, 2), { mode: 0o600 });
}
