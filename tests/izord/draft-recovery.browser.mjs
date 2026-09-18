/** Real local Auth/access-refresh recovery, owned direct Playwright. No CDP or product mock. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { assertLocalTarget } from './local-target.mjs';
import { assertNeutralDocumentTarget, isExactNeutralNavigation } from './cache-playwright-target.mjs';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const runtime = process.env.IZORD_PLAYWRIGHT_RUNTIME;
assert.ok(runtime, 'Owned Playwright runtime is required');
const { chromium } = require(join(runtime, 'node_modules/playwright'));
const mode = process.argv[2];
assert.ok(['--before', '--after'].includes(mode), 'Explicit bounded before/after campaign is required');
const resumeOption = process.argv[3];
const resumeSkip = resumeOption === '--resume-from-assignment' ? 6 : resumeOption === '--resume-from-reader' ? 7 : 0;
assert.ok(process.argv.length === 3 || mode === '--after' && resumeSkip > 0 && process.argv.length === 4, 'Unknown campaign option');
const status = JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE, 'utf8'));
const fixture = JSON.parse(readFileSync(process.env.LOCAL_FIXTURE_FILE, 'utf8'));
const app = 'http://127.0.0.1:3159', api = status.API_URL;
assertLocalTarget({ api, database: status.DB_URL, app, mail: 'http://127.0.0.1:55434', acknowledgement: process.env.IZORD_TEST_ACK });
assert.equal(fixture.api, api);
assert.match(fixture.users.admin.email, /@example\.invalid$/);
const out = resolve(process.env.IZORD_ARTIFACTS), inputs = process.env.IZORD_GENERATOR_FIXTURES;
assert.ok(inputs, 'Existing fictional fixture directory is required');
assert.ok(!existsSync(join(out, 'results.json')), 'Refuse to replace a previous campaign');
for (const name of ['fiche-numerique-fictive.pdf', 'photo-fictive.webp']) assert.ok(existsSync(join(inputs, name)));
mkdirSync(out, { recursive: true });
const privateDir = mkdtempSync(join(tmpdir(), 'izord-draft-recovery-'));
const evidence = { startedAt: new Date().toISOString(), mode, scope: resumeSkip ? `Only controls ${resumeSkip+1}–13; earlier successes are referenced individually below` : 'Complete bounded campaign', previouslyCovered: [], checks: [], events: [], failure: null, unexpectedCloses: 0 };
let controlsToSkip = resumeSkip;
const secrets = [status.ANON_KEY, status.SERVICE_ROLE_KEY, fixture.users.admin.password];
const clients = [], identities = {}, ownedProjects = new Set(), downloads = [];
let browser, page, neutral, browserContext, active = 'local-preflight', expectedClose = false;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const sanitize = value => {
  let safe = String(value?.stack || value);
  for (const secret of secrets.filter(Boolean)) safe = safe.split(secret).join('[REDACTED]');
  return safe.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT REDACTED]')
    .replace(/(?:access_token|refresh_token|token)=[^\s"'&]+/g, 'token=[REDACTED]').slice(0,10000);
};
const event = (name, details = {}) => evidence.events.push({ at: new Date().toISOString(), control: active, name, ...details });
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url || input.href);
  assert.equal(url.origin, api, 'Node Auth/REST must use only the guarded local API');
  return fetch(input, init);
} } };
const admin = createClient(api, status.ANON_KEY, options), authAdmin = createClient(api, status.SERVICE_ROLE_KEY, options);
clients.push(admin, authAdmin);
async function ok(request) { const result = await request; if (result.error) throw new Error('Local API rejected: ' + (result.error.code || 'unknown')); return result.data; }
async function identity(label) {
  const email = `draft-recovery-${label}-${randomUUID()}@example.invalid`, password = randomBytes(24).toString('hex');
  secrets.push(password);
  const { user } = await ok(authAdmin.auth.admin.createUser({ email, password, email_confirm: true }));
  const client = createClient(api, status.ANON_KEY, options); clients.push(client);
  await ok(client.auth.signInWithPassword({ email, password }));
  const invite = await ok(admin.rpc('izord_invite_izord', { p_email: email, p_role: 'contributor' }));
  await ok(client.rpc('izord_accept_invitation', { p_token: invite.token }));
  const verified = await ok(client.auth.getUser()); assert.equal(verified.user.id, user.id);
  return { id: user.id, email, password, client };
}
const notice = () => page.locator('[data-izord-generator] > [role="status"]');
async function screenshot(name) {
  await page.screenshot({ path: join(out, name), fullPage: true, mask: [page.locator('[class*="identity"]')] });
}
async function uiState() {
  const observed = await page.evaluate(() => {
    const field = name => document.querySelector('#izord-' + name)?.value ?? null;
    return {
      path: location.pathname, title: field('project'), acq: field('acq'), works: field('works'), resale: field('resale'),
      generatorPresent: !!document.querySelector('[data-izord-generator]'),
      notice: document.querySelector('[data-izord-generator] > [role="status"]')?.textContent ?? null,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(node => node.textContent),
      pdfDialog: !!document.querySelector('[role="dialog"][aria-label="Vérification de la fiche PDF"]'),
      pdfFields: Array.from(document.querySelectorAll('[role="dialog"] input:not([type="checkbox"]), [role="dialog"] select')).map(node => ({ tag: node.tagName, value: node.value })),
      galleryImages: Array.from(document.querySelectorAll('img[alt^="Photothèque — photo"]')).map(node => node.getAttribute('src')),
      hasRecoveryExport: Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Exporter le JSON de récupération' && !button.disabled),
      protectedButtons: Array.from(document.querySelectorAll('[data-izord-generator] button')).map(button => ({ name: button.textContent, disabled: button.disabled })),
    };
  });
  return { ...observed, galleryImages: observed.galleryImages.map(data => ({ sha256: sha256(data), characters: data.length })) };
}
async function serverState(title) {
  const rows = await ok(admin.from('izord_projects').select('id,revision,title,status,payload').eq('title', title));
  assert.ok(rows.length <= 1, 'Unique fixture title');
  if (!rows.length) return { exists: false, title, revision: null, versionCount: 0, assetCount: 0 };
  const row = rows[0], versions = await ok(admin.from('izord_project_versions').select('revision').eq('project_id', row.id));
  const assets = await ok(admin.from('izord_assets').select('id,kind,lifecycle').eq('project_id', row.id));
  ownedProjects.add(row.id);
  return { exists: true, title: row.title, revision: row.revision, status: row.status,
    state: { project: row.payload?.data?.state?.project ?? null, acq: row.payload?.data?.state?.acq ?? null, works: row.payload?.data?.state?.works ?? null, resale: row.payload?.data?.state?.resale ?? null },
    versionCount: versions.length, versionRevisions: versions.map(value => value.revision).sort((a,b) => a-b),
    assetCount: assets.length, assets: assets.map(({ kind, lifecycle }) => ({ kind, lifecycle })) };
}
async function save() {
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await notice().filter({ hasText: /^Enregistré · révision/ }).waitFor({ timeout: 45000 });
  await page.waitForFunction(() => !document.querySelector('fieldset')?.disabled);
}
async function fresh(title) {
  await page.getByRole('button', { name: 'Nouveau projet', exact: true }).click();
  for (const [key, value] of Object.entries({ project: title, acq: '500000', works: '50000', resale: '750000', weekly: '0' })) await page.locator('#izord-' + key).fill(value);
}
async function importPdf(apply) {
  await page.getByLabel('Importer une fiche PDF', { exact: true }).setInputFiles(join(inputs, 'fiche-numerique-fictive.pdf'));
  const dialog = page.getByRole('dialog', { name: 'Vérification de la fiche PDF', exact: true }); await dialog.waitFor();
  if (apply) {
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Valider et créer la fiche projet', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  }
}
async function addPhoto() {
  await page.getByLabel('Ajouter à la photothèque', { exact: true }).setInputFiles(join(inputs, 'photo-fictive.webp'));
  await page.waitForFunction(() => !document.querySelector('fieldset')?.disabled);
  assert.ok(await page.locator('img[alt^="Photothèque — photo"]').count() > 0);
}
async function check(name, operation) {
  if(controlsToSkip>0) { const ordinal=resumeSkip-controlsToSkip+1;controlsToSkip--;evidence.previouslyCovered.push({name,executedHere:false,reference:ordinal<=6?'after-1/results.json':'after-2/results.json'});return; }
  active = name; await operation(); evidence.checks.push({ name, result: 'passed', at: new Date().toISOString() }); console.log('PASS ' + name);
}
async function focusRefresh() {
  // The real portal listener runs. No hook, Auth state or component is replaced.
  await neutral.bringToFront();
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  event('real-portal-focus-listener-triggered');
}
async function baselineCase(target, kind, index) {
  const title = `Brouillon fictif ${target} ${kind} ${randomUUID().slice(0,8)}`;
  if (kind === 'existing') {
    await fresh(title); await save();
    await page.locator('#izord-acq').fill('612345'); await page.locator('#izord-works').fill('65432');
    await addPhoto(); await importPdf(false);
  } else {
    await importPdf(true); await page.locator('#izord-project').fill(title);
    await page.locator('#izord-acq').fill('712345'); await page.locator('#izord-works').fill('75432'); await addPhoto();
  }
  const before = await uiState(), serverBefore = await serverState(title);
  assert.equal(before.title, title); assert.ok(before.galleryImages.length > 0);
  if (kind === 'existing') { assert.equal(serverBefore.exists, true); assert.equal(serverBefore.state.acq, '500000'); assert.equal(before.pdfDialog, true); }
  else { assert.equal(serverBefore.exists, false); assert.equal(before.pdfDialog, false); }
  await screenshot(`${index}-${target}-${kind}-before.png`);
  const pathname = target === 'getUser' ? '/auth/v1/user' : '/rest/v1/app_memberships';
  const pattern = url => url.origin === api && url.pathname === pathname;
  let failures = 0;
  const fail = route => {
    if (route.request().method() !== 'GET') return route.continue();
    failures++; event('bounded-503-injected', { pathname, method: 'GET', status: 503 });
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Fictional access verification temporarily unavailable' }) });
  };
  await page.route(pattern, fail); await focusRefresh();
  await page.getByRole('alert').filter({ hasText: /indisponible/i }).waitFor({ timeout: 20000 });
  const interrupted = await uiState(); await screenshot(`${index}-${target}-${kind}-unavailable.png`);
  assert.ok(failures > 0); assert.equal(interrupted.generatorPresent, false);
  assert.equal(interrupted.hasRecoveryExport, false);
  const pausedAt = evidence.events.length; await page.waitForTimeout(250);
  assert.equal(evidence.events.slice(pausedAt).some(item => item.name === 'protected-request'), false);
  await page.unroute(pattern, fail); const returnAt=evidence.events.length;
  const verified = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/app_memberships' && response.status() === 200);
  await focusRefresh(); await verified; await page.locator('[data-izord-generator]').waitFor();
  await page.getByRole('button', { name: 'Nouveau projet', exact: true }).waitFor();
  const after = await uiState(), serverAfter = await serverState(title);
  await screenshot(`${index}-${target}-${kind}-restored-access.png`);
  assert.deepEqual(serverAfter, serverBefore, 'No saved server version or file is deleted/changed by access failure');
  assert.equal(evidence.events.slice(returnAt).some(isProtectedWrite),false,'Restoring access alone never writes or archives');
  const reproduced = after.title === null && after.acq === null && after.galleryImages.length === 0 && after.pdfDialog === false;
  const proof = { target, kind, injection: 'Only exact local GET failed with HTTP 503; all other Auth/REST uses real service', failures, before, serverBefore, interrupted, after, serverAfter, reproduced };
  writeFileSync(join(out, `${index}-${target}-${kind}.json`), JSON.stringify(proof, null, 2));
  if(mode==='--before') {
    assert.equal(reproduced, true, 'Expected baseline loss not observed; do not infer reproduction or continue to a speculative product fix');
    event('baseline-loss-observed', { target, kind, serverRevision: serverAfter.revision, unsavedAcq: before.acq, recoveredAcq: after.acq });
  } else {
    for(const key of ['title','acq','works','resale','galleryImages','pdfDialog','pdfFields']) assert.deepEqual(after[key],before[key],`Recovered ${key} must match the pre-interruption draft`);
    assert.match(after.notice,/repris|retrouv|non enregistr|brouillon/i); assert.doesNotMatch(after.notice,/^Enregistré/);
    if(kind==='existing') await page.getByRole('dialog',{name:'Vérification de la fiche PDF'}).getByRole('button',{name:'Ne pas appliquer',exact:true}).click();
    if(kind==='new') {
      await save();
      const row=await ownedProject(title), assets=await ok(identities.a.client.from('izord_assets').select('*').eq('project_id',row.id));
      const pdfs=assets.filter(asset=>asset.kind==='pdf'&&asset.lifecycle==='finalized'); assert.equal(pdfs.length,1,'The original unsaved PDF File survives and transfers only on explicit save');
      const file=await ok(identities.a.client.storage.from('izord-documents').download(pdfs[0].object_path));
      assert.equal(sha256(Buffer.from(await file.arrayBuffer())),sha256(readFileSync(join(inputs,'fiche-numerique-fictive.pdf'))));
      assert.ok(assets.some(asset=>asset.kind==='photo'&&asset.lifecycle==='finalized'));
      event('recovered-pdf-and-photos-explicitly-saved',{target,pdfFiles:pdfs.length,pdfBytes:file.size,revision:(await serverState(title)).revision});
    }
    event('recovery-confirmed',{target,kind,originalRevision:serverBefore.revision,unsavedAcq:before.acq,recoveredAcq:after.acq});
  }
}

function isProtectedWrite(item) { return item.name==='protected-request' && ['POST','PUT','PATCH','DELETE'].includes(item.method); }
function isProtectedRequest(item) { return item.name==='protected-request' && item.path!=='/rest/v1/app_memberships'; }
async function ownedProject(title, client=admin) {
  assert.match(title,/^(Brouillon fictif|Reprise fictive)/);
  const row=await ok(client.from('izord_projects').select('*').eq('title',title).single()); ownedProjects.add(row.id); return row;
}
async function membership(who,role,statusValue) {
  assert.ok(Object.values(identities).some(identity=>identity.id===who.id));
  await ok(admin.rpc('izord_set_izord_member',{p_user:who.id,p_role:role,p_status:statusValue}));
  event('fictional-membership-change',{identity:who===identities.a?'a':'b',role,status:statusValue});
}
async function assign(project,who,enabled) {
  assert.ok(ownedProjects.has(project.id)); assert.ok(Object.values(identities).some(identity=>identity.id===who.id));
  await ok(admin.rpc('izord_assign_project',{p_project:project.id,p_user:who.id,p_assigned:enabled}));
  event('fictional-assignment-change',{identity:who===identities.a?'a':'b',assigned:enabled});
}
async function login(who,navigate=true) {
  if(navigate)await page.goto(app+'/izord');
  await page.getByLabel('Email',{exact:true}).fill(who.email); await page.getByLabel('Mot de passe',{exact:true}).fill(who.password);
  await page.getByRole('button',{name:'Se connecter',exact:true}).click(); await page.locator('[data-izord-generator]').waitFor();
}
async function logout() {
  await page.getByRole('button',{name:'Se déconnecter',exact:true}).click(); await page.getByLabel('Email',{exact:true}).waitFor();
}
async function open(title) {
  const details=page.locator('details').filter({has:page.locator('summary').filter({hasText:/Dossiers accessibles/})});
  if(!await details.evaluate(element=>element.open))await details.locator('summary').click();
  await page.getByRole('button',{name:'Ouvrir '+title,exact:true}).click(); await notice().filter({hasText:/Enregistré · révision/}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('fieldset')?.disabled);
}
async function downloadJson(name,scope=page) {
  const waiter=page.waitForEvent('download'); await scope.getByRole('button',{name:'Exporter le JSON de récupération',exact:true}).click();
  const file=await waiter; await file.saveAs(join(out,name)); assert.equal(await file.failure(),null);event('download-retained',{artifact:name});
  return JSON.parse(readFileSync(join(out,name),'utf8'));
}
async function rawCache(markers) {
  const result=await page.evaluate(async markers=>{
    let matches=0;
    for(const storage of [localStorage,sessionStorage])for(let i=0;i<storage.length;i++){const value=storage.getItem(storage.key(i))||'';if(markers.some(marker=>value.includes(marker)))matches++;}
    return{matches,cacheStorageEntries:(await caches.keys()).length,indexedDBDatabases:(await indexedDB.databases()).length};
  },markers);
  assert.deepEqual(result,{matches:0,cacheStorageEntries:0,indexedDBDatabases:0});event('no-business-persistent-cache',result);
}
async function unavailable(target='getUser') {
  const path=target==='getUser'?'/auth/v1/user':'/rest/v1/app_memberships'; let hits=0;
  const pattern=url=>url.origin===api&&url.pathname===path;
  const handler=route=>{if(route.request().method()!=='GET')return route.continue();hits++;event('bounded-503-injected',{pathname:path,status:503});return route.fulfill({status:503,contentType:'application/json',body:'{"message":"Fictional access verification unavailable"}'});};
  await page.route(pattern,handler);await focusRefresh();await page.getByRole('alert').filter({hasText:/indisponible/i}).waitFor();
  assert.ok(hits>0);assert.equal(await page.locator('[data-izord-generator]').count(),0,'Unavailable verification unmounts the operational editor');
  const start=evidence.events.length;await page.waitForTimeout(350);assert.equal(evidence.events.slice(start).some(isProtectedRequest),false,'No hidden editor requests while suspended');
  assert.equal(await page.getByRole('button',{name:/Enregistrer|Générer le PowerPoint|Exporter le JSON de récupération/}).count(),0);
  return {restore:()=>page.unroute(pattern,handler)};
}
async function waitRecovered() {
  await focusRefresh();await page.locator('[data-izord-generator]').waitFor();
  await page.getByRole('button',{name:'Nouveau projet',exact:true}).waitFor();
}
async function holdResponse(path,method='GET',matches=()=>true,holdAll=false) {
  let signalReady,releaseGate,captured=false;
  const ready=new Promise(resolve=>{signalReady=resolve;}),gate=new Promise(resolve=>{releaseGate=resolve;});
  const pattern=url=>url.origin===api&&url.pathname===path;
  const handler=async route=>{
    if((captured&&!holdAll)||route.request().method()!==method||!matches(new URL(route.request().url())))return route.continue();
    captured=true;const response=await route.fetch();assert.ok(response.status()>=200&&response.status()<300);event('actual-response-held',{path,method,status:response.status()});signalReady();await gate;
    try{await route.fulfill({response});event('actual-response-released',{path,method});}catch(error){event('stale-response-delivery-cancelled',{path,message:sanitize(error)});}
  };
  await page.route(pattern,handler);
  return {ready:async()=>{let timer;try{await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Expected real response not reached: '+path)),20000);})]);}finally{clearTimeout(timer);}},release:async()=>{releaseGate();await page.unroute(pattern,handler);}};
}
async function preparedDraft(suffix,{saved=true,photo=false}={}) {
  const title='Reprise fictive '+suffix+' '+randomUUID().slice(0,8);await fresh(title);if(saved)await save();
  await page.locator('#izord-acq').fill('634567');if(photo)await addPhoto();return title;
}
async function afterSecurityMatrix() {
  await check('Explicit logout while unavailable and account A/B/A preserve SAME context with no old draft',async()=>{
    const title=await preparedDraft('compte',{saved:false,photo:true}), originalContext=page.context();
    const outage=await unavailable();await screenshot('05-account-unavailable.png');await outage.restore();
    await logout();await login(identities.b,false);assert.equal(page.context(),originalContext);assert.equal(page.context(),browserContext);
    assert.equal(await page.locator('#izord-project').count(),0);assert.equal(await page.getByRole('button',{name:'Ouvrir '+title,exact:true}).count(),0);
    assert.doesNotMatch(await page.locator('body').innerText(),new RegExp(title));await rawCache([title,'IZORD_FICHE_V1','IZORD_GENERATOR_V1','importGallery','data:image/jpeg;']);
    await logout();await login(identities.a,false);assert.equal(await page.locator('#izord-project').count(),0);await screenshot('05-after-account-change.png');
  });
  await check('Confirmed real membership revocation purges suspended draft and refuses recovery export',async()=>{
    const title=await preparedDraft('revocation',{photo:true}),before=await serverState(title),outage=await unavailable('app_memberships');
    await membership(identities.a,'contributor','revoked');await outage.restore();await focusRefresh();
    await page.getByRole('alert').filter({hasText:/ne dispose pas.*IZORD|révoqu|retiré/i}).waitFor();
    assert.equal(await page.locator('[data-izord-generator]').count(),0);assert.equal(await page.getByRole('button',{name:'Exporter le JSON de récupération',exact:true}).count(),0);
    await rawCache([title,'634567','importGallery']);assert.deepEqual(await serverState(title),before);await screenshot('06-revoked.png');
    await membership(identities.a,'contributor','active');await waitRecovered();assert.equal(await page.locator('#izord-project').count(),0,'Regrant cannot resurrect revoked draft');
  });
  await check('Same contributor loses project assignment: real RLS denies capsule recovery despite global role',async()=>{
    const title=await preparedDraft('projet-de-b');await save();const initial=await ownedProject(title);
    // Create a separate project truly owned by B; copy only this fixture payload under real B JWT.
    const foreignTitle='Reprise fictive affectation '+randomUUID().slice(0,8);
    const id=await ok(identities.b.client.rpc('izord_create_project',{p_title:foreignTitle}));ownedProjects.add(id);
    const bProject=await ownedProject(foreignTitle,identities.b.client),payload=structuredClone(initial.payload);payload.data.state.project=foreignTitle;
    await ok(identities.b.client.rpc('izord_save_generator',{p_id:id,p_expected_revision:bProject.revision,p_title:foreignTitle,p_payload:payload,p_status:'draft'}));
    await assign(bProject,identities.a,true);await page.getByRole('button',{name:'Actualiser la liste',exact:true}).click();await open(foreignTitle);
    await page.locator('#izord-acq').fill('645678');const before=await serverState(foreignTitle),outage=await unavailable();
    await assign(bProject,identities.a,false);await outage.restore();await focusRefresh();
    await page.getByRole('alert').filter({hasText:'L’accès à ce dossier a été retiré.'}).waitFor();
    assert.equal(await page.locator('[data-izord-generator]').count(),0);assert.equal(await page.locator('#izord-project').count(),0);
    assert.equal(await page.getByRole('button',{name:'Exporter le JSON de récupération',exact:true}).count(),0);
    const visible=await ok(identities.a.client.from('izord_projects').select('id').eq('id',id));assert.equal(visible.length,0);
    assert.deepEqual(await serverState(foreignTitle),before);await rawCache([foreignTitle,'645678']);await screenshot('07-assignment-removed.png');
    await waitRecovered();assert.equal(await page.locator('#izord-project').count(),0);assert.equal(await page.getByRole('button',{name:'Ouvrir '+foreignTitle,exact:true}).count(),0);
  });
  await check('Writer reduced to assigned reader cannot recover prior edits, source photos, PDF or export',async()=>{
    const title=await preparedDraft('lecteur',{photo:true}),project=await ownedProject(title);await assign(project,identities.a,true);
    await importPdf(false);const before=await uiState(),serverBefore=await serverState(title),outage=await unavailable();
    await membership(identities.a,'reader','active');await outage.restore();await focusRefresh();await page.locator('[data-izord-generator]').waitFor();
    assert.match(await page.locator('[data-izord-generator]').innerText(),/Rôle : Lecteur/);
    assert.equal(await page.locator('#izord-project').count(),0);assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal(await page.getByRole('button',{name:/Enregistrer|Générer le PowerPoint|Exporter le JSON/}).count(),0);
    await page.getByRole('button',{name:'Ouvrir '+title,exact:true}).click();await page.locator('#izord-acq').waitFor();
    assert.equal(await page.locator('#izord-acq').inputValue(),'500000');assert.equal(await page.locator('#izord-acq').isDisabled(),true);
    const reader=await uiState();assert.equal(reader.galleryImages.length,0);assert.equal(reader.pdfDialog,false);
    assert.ok(before.galleryImages.length>0);assert.deepEqual(await serverState(title),serverBefore);await screenshot('08-reader-current-rights.png');
    const upgradeAt=evidence.events.length;await membership(identities.a,'contributor','active');await waitRecovered();
    assert.equal(await page.locator('#izord-acq').inputValue(),'500000','A fresh server view may survive a rights increase; the discarded 634567 draft must not');
    const upgraded=await uiState();assert.equal(upgraded.galleryImages.length,0);assert.equal(upgraded.pdfDialog,false);assert.equal(upgraded.hasRecoveryExport,false);
    assert.equal(await page.getByRole('button',{name:'Enregistrer',exact:true}).isDisabled(),true);assert.equal(evidence.events.slice(upgradeAt).some(isProtectedWrite),false);
  });
  await check('A confirmed reader downgrade closes old writer capabilities before delayed project responses return',async()=>{
    const title=await preparedDraft('lecteur-controle-retarde',{photo:true}),project=await ownedProject(title);await assign(project,identities.a,true);
    const hold=await holdResponse('/rest/v1/izord_projects','GET',()=>true,true);
    await membership(identities.a,'reader','active');await focusRefresh();await hold.ready();
    assert.equal(await page.getByRole('button',{name:/Enregistrer|Générer le PowerPoint|Exporter le JSON/}).count(),0,'Membership-confirmed reader cannot retain old writer/export controls during the next request');
    assert.equal(await page.locator('#izord-acq').count(),0);assert.equal(await page.locator('img[alt^="Photothèque — photo"]').count(),0);
    await screenshot('08b-reader-before-project-response.png');await hold.release();await page.locator('[data-izord-generator]').waitFor();
    assert.match(await page.locator('[data-izord-generator]').innerText(),/Rôle : Lecteur/);assert.equal(await page.locator('#izord-project').count(),0);
    await membership(identities.a,'contributor','active');await waitRecovered();assert.equal(await page.locator('#izord-project').count(),0);
  });
  await check('An older successful membership response cannot reopen a newer unavailable verification',async()=>{
    const title=await preparedDraft('controle-tardif'),before=await uiState();const hold=await holdResponse('/rest/v1/app_memberships');
    await focusRefresh();await hold.ready();const outage=await unavailable();const suspendedAt=evidence.events.length;await hold.release();await page.waitForTimeout(500);
    assert.equal(await page.locator('[data-izord-generator]').count(),0);assert.equal(evidence.events.slice(suspendedAt).some(isProtectedRequest),false);
    await screenshot('09-late-control-stays-closed.png');await outage.restore();await waitRecovered();
    assert.equal(await page.locator('#izord-project').inputValue(),title);assert.equal(await page.locator('#izord-acq').inputValue(),before.acq);
  });
  await check('Actual create acknowledgment delayed past suspension cannot continue save/photo/PPT or download',async()=>{
    const title=await preparedDraft('creation-tardive',{saved:false,photo:true}),before=await uiState();
    const hold=await holdResponse('/rest/v1/rpc/izord_create_project','POST');const downloadStart=downloads.length;
    await page.getByRole('button',{name:'Générer le PowerPoint',exact:true}).click();await hold.ready();
    const committed=await serverState(title);assert.equal(committed.exists,true);assert.equal(committed.revision,1);
    const outage=await unavailable(),closedAt=evidence.events.length;await hold.release();await page.waitForTimeout(500);
    assert.equal(evidence.events.slice(closedAt).some(isProtectedRequest),false,'Late creation cannot initiate secondary requests');assert.equal(downloads.length,downloadStart);
    assert.equal(await page.locator('[data-izord-generator]').count(),0);assert.deepEqual(await serverState(title),committed);
    await outage.restore();const resumeAt=evidence.events.length;await waitRecovered();
    assert.equal(await page.locator('#izord-project').inputValue(),title);assert.equal(await page.locator('#izord-acq').inputValue(),before.acq);
    assert.equal(evidence.events.slice(resumeAt).some(isProtectedWrite),false);assert.equal(downloads.length,downloadStart);
    await screenshot('10-late-create-recovered-draft.png');event('inflight-write-boundary',{committedRevision:1,subsequentWrites:0,downloads:0});
  });
  await check('Writer B commits during outage; recovered A retains original revision and reaches real save conflict',async()=>{
    const title=await preparedDraft('conflit'),original=await ownedProject(title);await assign(original,identities.b,true);
    const outage=await unavailable('app_memberships'),remotePayload=structuredClone(original.payload);remotePayload.data.state.acq='845678';
    const bRevision=await ok(identities.b.client.rpc('izord_save_generator',{p_id:original.id,p_expected_revision:original.revision,p_title:title,p_payload:remotePayload,p_status:'draft'}));
    assert.equal(bRevision,original.revision+1);const remote=await serverState(title);assert.equal(remote.state.acq,'845678');
    await outage.restore();const restoredAt=evidence.events.length;await waitRecovered();assert.equal(await page.locator('#izord-acq').inputValue(),'634567');
    assert.equal(evidence.events.slice(restoredAt).some(isProtectedWrite),false);await page.getByRole('button',{name:'Enregistrer',exact:true}).click();
    const conflict=page.getByRole('region',{name:'Conflit de sauvegarde',exact:true});await conflict.waitFor();
    assert.equal(await page.locator('#izord-acq').inputValue(),'634567');const recovered=await downloadJson('conflict-recovery.json',conflict);assert.equal(recovered.state.acq,'634567');
    await conflict.getByRole('button',{name:'Comparer à la version partagée',exact:true}).click();await conflict.getByText('Version partagée '+bRevision+' — votre brouillon reste dans le formulaire',{exact:true}).waitFor();
    assert.match(await conflict.locator('pre').innerText(),/845678/);assert.equal(await page.locator('#izord-acq').inputValue(),'634567');
    assert.deepEqual(await serverState(title),remote);await screenshot('11-real-conflict-preserved.png');event('optimistic-conflict-preserved',{originalRevision:original.revision,remoteRevision:bRevision,localAcq:'634567',remoteAcq:'845678'});
  });
  await check('Explicit new-project replacement cannot resurrect the preceding recovered draft',async()=>{
    const discarded=await page.locator('#izord-project').inputValue(),title=await preparedDraft('remplacement',{saved:false});
    const outage=await unavailable();await outage.restore();await waitRecovered();assert.equal(await page.locator('#izord-project').inputValue(),title);
    assert.notEqual(title,discarded);assert.equal(await page.getByRole('region',{name:'Conflit de sauvegarde'}).count(),0);await rawCache([title,discarded]);
    await screenshot('12-explicit-replacement.png');
  });
}

try {
  await ok(admin.auth.signInWithPassword({ email: fixture.users.admin.email, password: fixture.users.admin.password }));
  identities.a = await identity('a'); identities.b = await identity('b');
  writeFileSync(join(privateDir, 'users.json'), JSON.stringify(Object.fromEntries(Object.entries(identities).map(([key,value]) => [key,{ id:value.id,email:value.email,password:value.password }]))), { mode: 0o600 });
  browser = await chromium.launch({ headless: true,
    executablePath: join(runtime, 'browsers/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'),
    env: { PATH: process.env.PATH, HOME: privateDir, TMPDIR: privateDir }, args: ['--disable-background-networking'] });
  evidence.browser = browser.version(); evidence.playwright = require(join(runtime, 'node_modules/playwright/package.json')).version;
  browser.on('disconnected', () => { if (!expectedClose) evidence.unexpectedCloses++; });
  const context = await browser.newContext({ viewport: { width:1440,height:1000 }, acceptDownloads:true });browserContext=context;
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['data:','blob:','about:'].includes(url.protocol) && ![app,api].includes(url.origin)) { event('remote-blocked', { origin:url.origin }); return route.abort(); }
    return route.continue();
  });
  await context.routeWebSocket(/.*/, socket => { event('websocket-blocked'); socket.close(); });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('dialog', dialog => dialog.accept());
  page.on('pageerror', error => event('pageerror', { message:sanitize(error) }));
  page.on('crash', () => event('crash'));
  page.on('download', download => { downloads.push(download.suggestedFilename());event('download',{filename:download.suggestedFilename()}); });
  page.on('requestfailed', request => event('requestfailed', { path:new URL(request.url()).pathname, method:request.method(), failure:request.failure()?.errorText }));
  page.on('response', response => { const path=new URL(response.url()).pathname; if(path.startsWith('/auth/')||path.includes('app_memberships')) event('access-response',{path,status:response.status()}); });
  page.on('request', request => { const path=new URL(request.url()).pathname; if(path.startsWith('/rest/')||path.startsWith('/storage/')) event('protected-request',{path,method:request.method()}); });
  // Reuse the cache runner's exact same-origin neutral-document guards, no app request substitution.
  neutral = await context.newPage(); const neutralURL = app + '/__e2e__/neutral-' + randomUUID() + '.html';
  assertNeutralDocumentTarget(app,neutralURL);
  await neutral.route(neutralURL,route=>{
    const request=route.request();
    assert.equal(isExactNeutralNavigation({app,expectedURL:neutralURL,url:request.url(),method:request.method(),isNavigationRequest:request.isNavigationRequest(),isMainFrame:request.frame()===neutral.mainFrame(),resourceType:request.resourceType()}),true);
    return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang="fr"><meta charset="utf-8"><title>Page neutre fictive</title><body>Page neutre fictive, sans application.</body></html>'});
  });
  await neutral.goto(neutralURL); event('owned-neutral-page-ready',{sameContext:neutral.context()===page.context()});
  await page.goto(app+'/izord'); await page.getByLabel('Email',{exact:true}).fill(identities.a.email);
  await page.getByLabel('Mot de passe',{exact:true}).fill(identities.a.password);
  await page.getByRole('button',{name:'Se connecter',exact:true}).click();
  await page.locator('[data-izord-generator]').waitFor();
  let index=0;
  for (const kind of ['existing','new']) for (const target of ['getUser','app_memberships']) await check(`${target}: ${kind} ${mode==='--before'?'draft loss before correction':'draft recovery with real local Auth'}`,()=>baselineCase(target,kind,String(++index).padStart(2,'0')));
  if(mode==='--after')await afterSecurityMatrix();
  assert.equal(evidence.events.some(item=>['remote-blocked','pageerror','crash'].includes(item.name)),false);
  assert.equal(evidence.unexpectedCloses,0);
} catch(error) {
  evidence.failure={control:active,error:sanitize(error)};
  if(page&&!page.isClosed()) { try { evidence.failure.page=await uiState(); await screenshot('failure.png'); } catch { evidence.failure.page='non disponible'; } }
  process.exitCode=1; console.error('FAIL '+active+' '+sanitize(error));
} finally {
  evidence.finishedAt=new Date().toISOString();evidence.downloads=downloads;
  writeFileSync(join(out,'result-before-cleanup.json'),JSON.stringify(evidence,null,2));
  expectedClose=true; if(browser)await browser.close(); for(const client of clients)await client.auth.stopAutoRefresh();
  writeFileSync(join(out,'results.json'),JSON.stringify({...evidence,cleanup:'Owned isolated browser closed; fictitious accounts, saved versions and volumes retained'},null,2));
  console.log(JSON.stringify({checks:evidence.checks.length,failure:!!evidence.failure,report:join(out,'results.json')}));
}
