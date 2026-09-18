/** Real portal login, real refreshSession, and a second real OAR JWT writer.
 * Run --before on the preserved baseline, then without it on the corrected app.
 * No mocked Auth/REST response and no existing personal browser profile.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { assertLocalTarget } from './local-target.mjs';
const require = createRequire(import.meta.url);
const status = JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE, 'utf8'));
const fixture = JSON.parse(readFileSync(process.env.LOCAL_FIXTURE_FILE, 'utf8'));
const api = status.API_URL, app = 'http://127.0.0.1:3159';
assertLocalTarget({ api, database: status.DB_URL, app, mail: 'http://127.0.0.1:55434', acknowledgement: process.env.IZORD_TEST_ACK });
assert.equal(fixture.api, api);
const before = process.argv.includes('--before'), out = resolve(process.env.IZORD_ARTIFACTS || '/tmp/izord-token-refresh');
mkdirSync(out, { recursive: true });
const config = join(out, 'browser-config.json'); writeFileSync(config, '{}');
const binary = process.env.AGENT_BROWSER_BIN || '/tmp/izord-browser-runtime/node_modules/.bin/agent-browser';
const browserSession = `izord-refresh-${process.pid}`;
const browserEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
const userA = fixture.users.oar, userB = fixture.users.oar2;
assert.ok(userA?.password && userB?.password);
const { createClient } = require('@supabase/supabase-js');
const clientB = createClient(api, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const checks = [], traffic = [], pending = new Map();
let socket, sessionId, requestId = 0, original, initial, errors = 0, remote = 0, holdWorkspaceResponses = false, interceptionError = false, inFlightDirtyProof = null;
const heldWorkspaceResponses = [];
const pause = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
const hash = value => createHash('sha256').update(value).digest('hex');
const pass = text => { checks.push(text); console.log(`PASS ${text}`); };
function ab(...args) { try { return execFileSync(binary, ['--config', config, '--session', browserSession, ...args], { encoding: 'utf8', timeout: 45000, env: browserEnv }).trim(); } catch { throw Error('Isolated browser command failed; private arguments withheld'); } }
function send(method, params = {}, session = sessionId) { return new Promise((resolveResult, reject) => { const id = ++requestId; const timeout = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout ${method}`)); }, 25000); pending.set(id, { resolve: resolveResult, reject, timeout }); socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) })); }); }
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error('Browser evaluation failed; details withheld'); return result.result.value; }
async function waitFor(check, label) { for (let attempt = 0; attempt < 160; attempt++) { if (interceptionError) throw Error('Real response interception failed'); if (await check()) return; await pause(100); } throw Error(`Timed out: ${label}`); }
async function readRow() { const { data, error } = await clientB.from('crm_workspace_state').select('payload, updated_at, updated_by').eq('workspace_id', 'oneaddress-riviera').single(); assert.equal(error, null); return data; }
async function writeAsB(payload) { const { data, error } = await clientB.from('crm_workspace_state').update({ payload, updated_at: new Date().toISOString(), updated_by: userB.id }).eq('workspace_id', 'oneaddress-riviera').select('updated_at,updated_by').single(); assert.equal(error, null); assert.equal(data.updated_by, userB.id); return data; }
const marker = name => ({ id: 'token-refresh-fictional-contact', name, kind: 'Client', email: 'refresh@example.invalid', phone: '', city: '', postalAddress: '', budget: 0, source: 'Test', notes: '', createdAt: '2026-09-16' });
const payloadWith = name => ({ ...original.payload, contacts: [...(original.payload.contacts || []).filter(c => c.id !== 'token-refresh-fictional-contact'), marker(name)] });
const writesSince = index => traffic.slice(index).filter(r => r.path === '/rest/v1/crm_workspace_state' && ['POST', 'PUT', 'PATCH'].includes(r.method));
async function action(label) { await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!button)throw Error('Missing action');button.click();return true})()`); }
async function addContact(name) {
  await evaluate(`(()=>{document.querySelector('.nav-list button:nth-child(2)').click();return true})()`);
  await waitFor(() => evaluate(`!!document.querySelector('.contact-create-form [name="name"]')`), 'contact form');
  await evaluate(`(()=>{const form=document.querySelector('.contact-create-form'),input=form.querySelector('[name="name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(name)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));form.requestSubmit();return true})()`);
}
async function warnsBeforeUnload() { return evaluate("(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented})()"); }
async function releaseWorkspaceResponse(response) {
  await send('Fetch.continueResponse', { requestId: response.requestId });
  response.released = true;
}
async function loadedMarker(marker) {
  return evaluate(`(()=>{
    let found=false;
    window.webpackChunk_N_E.push([[Math.random()],{},require=>{
      for(const [id,factory] of Object.entries(require.m)) {
        if(!String(factory).includes('oar-cache-lifecycle'))continue;
        for(const value of Object.values(require(id)||{}))if(value&&typeof value.getItem==='function'&&typeof value.setItem==='function')found=String(value.getItem('oneaddress-riviera-crm-v1')||'').includes(${JSON.stringify(marker)});
      }
    }]);
    return found || ${before} && Object.keys(localStorage).filter(k=>k.startsWith('oar:')).some(k=>String(localStorage.getItem(k)).includes(${JSON.stringify(marker)}));
  })()`);
}
async function refreshActualSDK() {
  return evaluate(`(async()=>{
    let client;
    window.webpackChunk_N_E.push([[Math.random()],{},require=>{const modules=require.c?Object.values(require.c):Object.entries(require.m).filter(([,factory])=>String(factory).includes('http://127.0.0.1:55431')).map(([id])=>({exports:require(id)}));for(const module of modules){for(const value of Object.values(module.exports||{})){if(value&&typeof value==='object'&&value.auth&&typeof value.auth.refreshSession==='function'&&typeof value.from==='function'){client=value;break;}}if(client)break;}}]);
    if(!client)throw Error('Actual app Supabase client not found');
    const previous=(await client.auth.getSession()).data.session;
    const refreshed=await client.auth.refreshSession();
    if(refreshed.error)throw Error('Real local refresh failed');
    return {sameIdentity:previous.user.id===refreshed.data.session.user.id,tokenChanged:previous.access_token!==refreshed.data.session.access_token};
  })()`);
}
try {
  const loginB = await clientB.auth.signInWithPassword({ email: userB.email, password: userB.password }); assert.equal(loginB.error, null);
  original = await readRow(); await writeAsB(payloadWith('TOKEN OLD PAYLOAD'));
  ab('--allowed-domains', '127.0.0.1', 'open', app + '/spaces');
  const endpoint = ab('get', 'cdp-url'); assert.match(endpoint, /^ws:\/\/127\.0\.0\.1:/);
  socket = new WebSocket(endpoint); await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', () => reject(Error('Local CDP failed')), { once: true }); });
  socket.addEventListener('message', message => {
    const data = JSON.parse(String(message.data));
    if (data.id) { const found = pending.get(data.id); if (found) { clearTimeout(found.timeout); pending.delete(data.id); data.error ? found.reject(Error('CDP operation rejected')) : found.resolve(data.result); } return; }
    if (data.sessionId !== sessionId) return;
    if (data.method === 'Fetch.requestPaused') {
      const paused = data.params;
      if (holdWorkspaceResponses && new URL(paused.request.url).pathname === '/rest/v1/crm_workspace_state' && paused.request.method === 'PATCH' && paused.responseStatusCode === 200) {
        heldWorkspaceResponses.push({ requestId: paused.requestId, status: paused.responseStatusCode, containsNewEdit: Boolean(paused.request.postData?.includes('TOKEN EDIT DURING MANUAL SAVE')), released: false });
      } else void send('Fetch.continueResponse', { requestId: paused.requestId }).catch(() => { interceptionError = true; });
      return;
    }
    if (data.method === 'Runtime.exceptionThrown') errors++;
    if (data.method === 'Network.requestWillBeSent') {
      const request = data.params.request, url = new URL(request.url); if (!['http:', 'https:'].includes(url.protocol)) return;
      if (url.hostname !== '127.0.0.1') remote++;
      const authorization = Object.entries(request.headers || {}).find(([key]) => key.toLowerCase() === 'authorization')?.[1] || '';
      traffic.push({ path: url.pathname, method: request.method, tokenHash: authorization ? hash(authorization) : null, oldPayload: Boolean(request.postData?.includes('TOKEN OLD PAYLOAD')), nextPayload: Boolean(request.postData?.includes('TOKEN NEW PAYLOAD')) });
    }
  });
  const targets = await send('Target.getTargets', {}, null), target = targets.targetInfos.find(t => t.type === 'page' && t.url.startsWith(app)); assert.ok(target);
  sessionId = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
  await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable');
  await waitFor(() => evaluate('!!document.querySelector("input[type=password]")'), 'real login form');
  await evaluate(`(()=>{for(const [selector,value]of [['input[type=email]',${JSON.stringify(userA.email)}],['input[type=password]',${JSON.stringify(userA.password)}]]){const el=document.querySelector(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}document.querySelector('form').requestSubmit();return true})()`);
  await waitFor(() => evaluate('!document.querySelector("input[type=password]")&&!document.body.textContent.includes("Vérification des accès…")'), 'real A login');
  await send('Page.navigate', { url: app + '/' });
  await waitFor(() => evaluate('!!document.querySelector(".nav-list")&&/Base partagée chargée|Base partagée synchronisée/.test(document.body.textContent)'), 'A shared workspace load');
  await evaluate('document.querySelector(".nav-list button:nth-child(2)").click();true');
  await waitFor(() => loadedMarker('TOKEN OLD PAYLOAD'), 'A old payload loaded');
  await pause(2200); initial = await readRow(); pass('A authenticated through the real portal and loaded the old fictional payload');
  await writeAsB(payloadWith('TOKEN NEW PAYLOAD')); const newer = await readRow(); assert.ok(JSON.stringify(newer.payload).includes('TOKEN NEW PAYLOAD')); pass('B saved a newer payload using its own real local Auth JWT');
  const index = traffic.length, refreshed = await refreshActualSDK(); assert.equal(refreshed.sameIdentity, true); assert.equal(refreshed.tokenChanged, true);
  await pause(2300); const afterRefresh = await readRow(), refreshWrites = writesSince(index);
  const reproduced = JSON.stringify(afterRefresh.payload).includes('TOKEN OLD PAYLOAD') && afterRefresh.updated_by === userA.id && refreshWrites.some(r => r.oldPayload);
  if (before) { assert.equal(reproduced, true, 'Baseline must demonstrate the stale write after token-only refresh'); pass('BEFORE: real token refresh alone caused A to overwrite the newer B payload'); }
  else {
    assert.equal(refreshWrites.length, 0, 'A token-only refresh must never trigger a workspace write'); assert.deepEqual(afterRefresh.payload, newer.payload); assert.equal(afterRefresh.updated_at, newer.updated_at); pass('AFTER: real token refresh preserves B payload and causes zero workspace writes');
    await addContact('TOKEN STALE LOCAL EDIT'); await waitFor(() => evaluate('/modifiée ailleurs|version plus récente|Conflit/.test(document.body.textContent)'), 'visible stale revision conflict');
    const afterConflict = await readRow(); assert.deepEqual(afterConflict.payload, newer.payload); assert.equal(await loadedMarker('TOKEN STALE LOCAL EDIT'), true); pass('Dirty stale edit is refused by compare-and-swap; newer server payload remains intact');
    assert.equal(await evaluate("(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented})()"),true);
    await evaluate("(()=>{window.confirm=()=>false;[...document.querySelectorAll('nav a')].find(e=>e.textContent.trim()==='Mes espaces').click();return true})()"); await pause(300); assert.equal(await loadedMarker('TOKEN STALE LOCAL EDIT'),true); assert.equal(await evaluate("!!document.querySelector('.nav-list')"),true); pass('Unsaved changes warn before closing and cancelling navigation preserves the draft');
    const conflictIndex=traffic.length; await refreshActualSDK(); await pause(1300); assert.equal(writesSince(conflictIndex).length,0); assert.equal(await loadedMarker('TOKEN STALE LOCAL EDIT'),true); pass('Refreshing a conflicted dirty session preserves its unsaved edits and makes no retry');
    await evaluate('window.confirm=()=>true;true'); await action('Forcer synchro'); await action('Sauvegarde cloud'); await pause(700); assert.equal(writesSince(conflictIndex).length,0); assert.equal(traffic.slice(conflictIndex).some(r=>r.path==='/rest/v1/crm_backups'&&r.method==='POST'),false); assert.deepEqual((await readRow()).payload,newer.payload); pass('Manual sync and cloud backup cannot bypass a detected conflict');
    await evaluate('window.confirm=()=>true;true'); await action('Recharger cloud'); await waitFor(() => loadedMarker('TOKEN NEW PAYLOAD'), 'fresh cloud payload'); await pause(1200);
    const freshIndex = traffic.length; await refreshActualSDK(); await pause(1300); assert.equal(writesSince(freshIndex).length, 0);
    await addContact('TOKEN EDIT AFTER REFRESH'); await waitFor(async () => JSON.stringify((await readRow()).payload).includes('TOKEN EDIT AFTER REFRESH'), 'actual business edit after refresh saved');
    assert.ok(JSON.stringify((await readRow()).payload).includes('TOKEN NEW PAYLOAD')); await pause(100); assert.equal(await evaluate("(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented})()"),false); pass('A genuine business edit after token refresh saves using the current revision and token');

    // Hold genuine successful responses, never forge an acknowledgement or an
    // Auth event. The manual write survives a new edit in the same identity.
    await send('Fetch.enable', { patterns: [{ urlPattern: api + '/rest/v1/crm_workspace_state*', requestStage: 'Response' }] });
    holdWorkspaceResponses = true;
    const inFlightIndex = traffic.length;
    await action('Forcer synchro');
    await waitFor(() => heldWorkspaceResponses.length === 1, 'old manual save response held after real server commit');
    assert.equal(heldWorkspaceResponses[0].containsNewEdit, false);
    assert.equal(await warnsBeforeUnload(), false, 'A clean payload remains clean while its manual sync is in flight');
    await addContact('TOKEN EDIT DURING MANUAL SAVE');
    await waitFor(() => loadedMarker('TOKEN EDIT DURING MANUAL SAVE'), 'new edit retained in browser memory');
    await waitFor(() => warnsBeforeUnload(), 'new edit marks the UI dirty before its acknowledgement');
    assert.equal(JSON.stringify((await readRow()).payload).includes('TOKEN EDIT DURING MANUAL SAVE'), false, 'The first committed request predates the new edit');
    await releaseWorkspaceResponse(heldWorkspaceResponses[0]);
    await waitFor(() => heldWorkspaceResponses.length === 2, 'new autosave response held after old acknowledgement was processed');
    assert.equal(heldWorkspaceResponses[1].containsNewEdit, true);
    assert.equal(await warnsBeforeUnload(), true, 'The old acknowledgement must not clear the newer dirty edit');
    assert.equal(await loadedMarker('TOKEN EDIT DURING MANUAL SAVE'), true);
    const newCommitted = await readRow();
    assert.ok(JSON.stringify(newCommitted.payload).includes('TOKEN EDIT DURING MANUAL SAVE'));
    assert.equal(newCommitted.updated_by, userA.id);
    await releaseWorkspaceResponse(heldWorkspaceResponses[1]);
    await waitFor(async () => !(await warnsBeforeUnload()), 'UI becomes clean only after acknowledgement of its current edit');
    holdWorkspaceResponses = false;
    await send('Fetch.disable');
    assert.equal(writesSince(inFlightIndex).length, 2, 'One manual save and one save of the later business edit');
    inFlightDirtyProof = { realSuccessfulResponsesHeld: heldWorkspaceResponses.length, oldAcknowledgementPreservedNewDirtyEdit: true, cleanAfterCurrentAcknowledgement: true, writes: writesSince(inFlightIndex).length };
    pass('An old manual-save acknowledgement preserves a newer dirty edit; only its own real autosave acknowledgement clears the warning');
  }
  assert.equal(remote, 0); assert.equal(errors, 0);
  writeFileSync(join(out, before ? 'token-refresh-before.json' : 'token-refresh-after.json'), JSON.stringify({ mode: before ? 'before' : 'after', passed: checks.length, checks, inFlightDirtyProof, staleOverwriteReproduced: reproduced, realPortalLogin: true, realSecondWriterJWT: true, realRefreshSession: true, tokenChanged: refreshed.tokenChanged, sameIdentity: refreshed.sameIdentity, writesAfterTokenOnlyRefresh: refreshWrites.length, oldPayloadWritesAfterRefresh: refreshWrites.filter(r => r.oldPayload).length, remoteRequests: remote, browserErrors: errors }, null, 2));
} catch (error) {
  let debug;try{debug={ui:await evaluate('({hasCRM:!!document.querySelector(".nav-list"),oldMarker:document.body.textContent.includes("TOKEN OLD PAYLOAD"),nextMarker:document.body.textContent.includes("TOKEN NEW PAYLOAD"),contactRows:document.querySelectorAll(".oar-contact-row").length})'),workspaceOld:JSON.stringify((await readRow()).payload).includes('TOKEN OLD PAYLOAD'),workspaceNew:JSON.stringify((await readRow()).payload).includes('TOKEN NEW PAYLOAD'),workspaceRequests:traffic.filter(r=>r.path==='/rest/v1/crm_workspace_state').map(({tokenHash,...safe})=>safe)};}catch{}
  writeFileSync(join(out, 'token-refresh-failure.json'), JSON.stringify({ passed: checks.length, checks, debug, error: String(error.message || 'Local verification failed').replace(/eyJ[A-Za-z0-9_.-]+/g, '[JWT REDACTED]') }, null, 2));
  throw Error('Token refresh verification failed; see sanitized report');
} finally {
  holdWorkspaceResponses = false;
  if (socket?.readyState === WebSocket.OPEN) for (const response of heldWorkspaceResponses.filter(item => !item.released)) { try { await releaseWorkspaceResponse(response); } catch {} }
  if (socket) socket.close(); try { ab('close'); } catch {}
  if (original) await writeAsB(original.payload);
  clientB.auth.stopAutoRefresh();
}
