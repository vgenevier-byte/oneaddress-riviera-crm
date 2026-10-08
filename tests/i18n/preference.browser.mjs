/** Integrated preference proof: actual local UI, fictitious Auth/RPC, zero real writes. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createFixture,fixtureAccountId} from './fixture.mjs';

const require=createRequire(import.meta.url);
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin=process.env.I18N_ORIGIN||'http://127.0.0.1:3299';
const out=process.env.I18N_PREFERENCE_OUT||'/private/tmp/oar-bilingual-20261008/browser/preference';
assert(['127.0.0.1','localhost'].includes(new URL(origin).hostname),'Local UI only');
mkdirSync(out,{recursive:true});
const prefix='oar.ui-language.v1:';
const accountKey=profile=>prefix+'account:'+fixtureAccountId(profile);
const results=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function setup(browser,{storageUnavailable=false}={}) {
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'fr-FR',timezoneId:'Europe/Paris'});
  if(storageUnavailable)await context.addInitScript(()=>{
    // Isolate unavailable language persistence from the Auth SDK's own storage.
    for(const method of ['getItem','setItem','removeItem']){
      const original=Storage.prototype[method];
      Storage.prototype[method]=function(key,...values){
        if(String(key).startsWith('oar.ui-language.v1:'))throw new DOMException('Fictitious unavailable preference storage','SecurityError');
        return original.call(this,key,...values);
      };
    }
  });
  const fixtures=Object.fromEntries(['full','limited','reader','planning'].map(profile=>[profile,createFixture(profile)]));
  let selected=fixtures.full;
  const transport={auth:[],reads:[],externalBlocked:[],businessMutationAttempts:[],forwardedRealWrites:0};
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin==='http://127.0.0.1:4097'||url.origin===origin&&url.pathname.startsWith('/api/')){
      let body={};try{body=request.postDataJSON()||{};}catch{}
      const bearer=(request.headers().authorization||'').replace(/^Bearer\s+/i,'');
      const byBearer=Object.values(fixtures).find(fixture=>fixture.token===bearer);
      if(url.pathname==='/auth/v1/token'&&request.method()==='POST'){
        selected=Object.values(fixtures).find(fixture=>fixture.user.email===body.email)||byBearer||selected;
      }
      const fixture=byBearer||selected;
      const before=fixture.audit.writes.length;
      const response=fixture.respond(request.method(),url,body);
      if(url.pathname.startsWith('/auth/v1/'))transport.auth.push({method:request.method(),path:url.pathname,profile:fixture.profile});
      else transport.reads.push({method:request.method(),path:url.pathname,profile:fixture.profile});
      if(fixture.audit.writes.length>before)transport.businessMutationAttempts.push(...fixture.audit.writes.slice(before));
      return route.fulfill({status:response.status,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'},contentType:'application/json',body:response.body===null?'':JSON.stringify(response.body)});
    }
    if(url.origin===origin&&!url.pathname.startsWith('/api/')||['blob:','data:'].includes(url.protocol))return route.continue();
    transport.externalBlocked.push(request.method()+' '+url.origin+url.pathname);
    return route.abort();
  });
  const page=await context.newPage(),errors=[],missing=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.text().includes('[i18n] Missing'))missing.push(message.text());});
  page.on('dialog',dialog=>dialog.dismiss());
  return {context,page,fixtures,transport,errors,missing};
}

async function language(page,expected) {
  await page.waitForFunction(value=>document.documentElement.lang===value,expected==='en'?'en-GB':'fr');
  const selectors=page.locator('[data-language-selector]:visible');
  assert(await selectors.count()>0,'A visible language selector is available');
  const selector=selectors.first();
  assert.equal(await selector.getByRole('button',{name:expected==='en'?'English — EN':'Français — FR',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await selector.getByRole('button',{name:expected==='en'?'Français — FR':'English — EN',exact:true}).getAttribute('aria-pressed'),'false');
}
async function choose(page,value,transport) {
  const authBefore=transport.auth.length,writesBefore=transport.businessMutationAttempts.length;
  await page.locator('[data-language-selector]:visible').first().getByRole('button',{name:value==='en'?'English — EN':'Français — FR',exact:true}).click();
  await language(page,value);await delay(30);
  assert.equal(transport.auth.length,authBefore,'Language selection creates no Auth operation');
  assert.equal(transport.businessMutationAttempts.length,writesBefore,'Language selection creates no business mutation');
}
async function login(page,fixture,expected) {
  await page.locator('input[type="email"]').waitFor({state:'visible'});
  await page.locator('input[type="email"]').fill(fixture.user.email);
  await page.locator('input[autocomplete="current-password"]').fill('Bilingual-Fictive-2026!');
  await page.locator('form button:not([type="button"])').first().click();
  await page.locator('.sidebar [data-navigation-module]').first().waitFor({state:'visible',timeout:90000});
  await language(page,expected);
}
async function signOut(page) {
  await page.locator('.sidebar').getByRole('button',{name:/^(Déconnexion|Sign out)$/}).click();
  await page.locator('input[type="email"]').waitFor({state:'visible',timeout:30000});
}
async function connectedCloud(page,expected){
  const status=page.locator('.shared-db-status-desktop span');
  await status.waitFor({state:'visible'});
  const expectedText=expected==='en'?'Shared database loaded from Supabase.':'Base partagée chargée depuis Supabase.';
  await page.waitForFunction(text=>document.querySelector('.shared-db-status-desktop span')?.textContent===text,expectedText);
  assert.equal(await status.textContent(),expectedText,'Connected database status follows the current render language');
}
async function values(page) {
  return page.evaluate(prefix=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.startsWith(prefix))),prefix);
}
function assertTransport(test) {
  assert.deepEqual(test.errors,[],'No uncaught UI errors');
  assert.deepEqual(test.missing,[],'No missing translation reports');
  assert.deepEqual(test.transport.externalBlocked,[],'No external service requested');
  assert.deepEqual(test.transport.businessMutationAttempts,[],'No business mutation attempted');
  assert.equal(test.transport.forwardedRealWrites,0,'No real write can pass the fictional router');
  for(const fixture of Object.values(test.fixtures))assert.deepEqual(fixture.audit.writes,[]);
}

async function persistedAccounts(browser,engine) {
  const test=await setup(browser),{context,page,fixtures,transport}=test;
  const evidence={name:engine+'-persisted-account-preferences',status:'running',steps:[],transport:null};
  try{
    await page.goto(origin);await page.locator('input[type="email"]').waitFor();await language(page,'fr');
    await login(page,fixtures.full,'fr');
    await page.locator('.sidebar [data-navigation-module="contacts"]').click();
    await page.getByText('Alice Alice Exemple',{exact:true}).first().waitFor();
    await connectedCloud(page,'fr');await choose(page,'en',transport);await connectedCloud(page,'en');
    await choose(page,'fr',transport);await connectedCloud(page,'fr');await choose(page,'en',transport);await connectedCloud(page,'en');
    evidence.steps.push({name:'Connected shared-database status changes FR → EN → FR → EN immediately with the current language',language:'en'});
    assert.equal((await values(page))[accountKey('full')],'en');
    const beforeReload=transport.auth.filter(entry=>entry.path==='/auth/v1/token').length;
    await page.reload();await page.locator('.sidebar [data-navigation-module]').first().waitFor({state:'visible'});await language(page,'en');
    assert.equal(transport.auth.filter(entry=>entry.path==='/auth/v1/token').length,beforeReload,'Reload restores the existing session without a fresh password login');
    evidence.steps.push({name:'Full account defaults FR, chooses EN and retains EN after actual page reload',accountId:fixtures.full.user.id,language:'en'});

    await signOut(page);await language(page,'fr');await login(page,fixtures.full,'en');
    evidence.steps.push({name:'Actual sign out and password sign in retain the saved personal EN preference',language:'en'});

    await signOut(page);await login(page,fixtures.limited,'fr');await choose(page,'fr',transport);
    assert.deepEqual(await values(page),{[accountKey('full')]:'en',[accountKey('limited')]:'fr'});
    await signOut(page);await login(page,fixtures.full,'en');await signOut(page);await login(page,fixtures.limited,'fr');
    evidence.steps.push({name:'Same browser switches full EN / limited FR / full EN / limited FR independently',accountValues:await values(page)});

    await signOut(page);await choose(page,'en',transport);await login(page,fixtures.limited,'fr');
    assert.equal((await values(page))[accountKey('limited')],'fr');assert.equal((await values(page))[prefix+'anonymous'],'en');
    evidence.steps.push({name:'Saved limited FR wins over a fresh explicit anonymous EN login choice',language:'fr'});

    await signOut(page);await language(page,'en');await page.reload();await page.locator('input[type="email"]').waitFor();await language(page,'en');
    await login(page,fixtures.reader,'fr');
    assert.equal((await values(page))[accountKey('reader')],undefined,'Default FR does not invent a stored account preference');
    evidence.steps.push({name:'Unsaved third account defaults FR after anonymous EN is remembered across reload without an explicit choice for the current login',accountId:fixtures.reader.user.id,language:'fr'});

    await signOut(page);await language(page,'en');await choose(page,'en',transport);await login(page,fixtures.planning,'en');
    assert.equal((await values(page))[accountKey('planning')],'en');
    evidence.steps.push({name:'Fresh explicit anonymous EN seeds an unsaved account for the current login',accountId:fixtures.planning.user.id,language:'en'});
    const stored=await values(page);assert(Object.values(stored).every(value=>value==='fr'||value==='en'),'Only strict language codes are stored');
    assert(Object.keys(stored).every(key=>key===prefix+'anonymous'||/^oar\.ui-language\.v1:account:[0-9a-f-]{36}$/.test(key)),'Only anonymous and UUID-scoped preference keys exist');
    evidence.preferenceKeys=stored;
    assertTransport(test);evidence.status='passed';
  }catch(error){evidence.status='failed';evidence.error=String(error);throw error;}
  finally{evidence.transport=transport;evidence.errors=test.errors;evidence.missing=test.missing;results.push(evidence);writeFileSync(`${out}/${engine}-results.json`,JSON.stringify(results,null,2));await context.close();}
}

async function unavailableStorage(browser,engine) {
  const test=await setup(browser,{storageUnavailable:true}),{context,page,fixtures,transport}=test;
  const evidence={name:engine+'-unavailable-browser-storage',status:'running',steps:[],transport:null};
  try{
    await page.goto(origin);await page.locator('input[type="email"]').waitFor();await language(page,'fr');
    await choose(page,'en',transport);await choose(page,'fr',transport);await choose(page,'en',transport);
    evidence.steps.push({name:'With language preference getItem/setItem/removeItem throwing SecurityError, anonymous FR → EN → FR → EN remains usable without a blocking error',scope:'Preference persistence unavailable; Auth storage remains available'});
    // Account transitions deliberately reload the app; memory-only choices cannot cross that boundary.
    await login(page,fixtures.limited,'fr');await choose(page,'en',transport);await choose(page,'fr',transport);await choose(page,'en',transport);
    evidence.steps.push({name:'Unavailable preference storage allows authenticated FR → EN → FR → EN toggles within the current document',accountId:fixtures.limited.user.id,language:'en',acrossReload:false});
    await page.reload();await page.locator('.sidebar [data-navigation-module]').first().waitFor({state:'visible'});await language(page,'fr');await choose(page,'en',transport);
    evidence.steps.push({name:'Actual reload safely defaults FR when persistence is unavailable, and EN can be selected again',language:'en',retainedAcrossReload:false});
    assertTransport(test);evidence.status='passed';
  }catch(error){evidence.status='failed';evidence.error=String(error);throw error;}
  finally{evidence.transport=transport;evidence.errors=test.errors;evidence.missing=test.missing;results.push(evidence);writeFileSync(`${out}/${engine}-results.json`,JSON.stringify(results,null,2));await context.close();}
}

for(const engine of process.env.I18N_ENGINE?[process.env.I18N_ENGINE]:['chromium','webkit']){
  const browser=await(engine==='chromium'?chromium.launch({headless:true,channel:'chrome'}):webkit.launch({headless:true,...(process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE}:{})}));
  try{await persistedAccounts(browser,engine);console.log('PASS '+engine+' persisted accounts');await unavailableStorage(browser,engine);console.log('PASS '+engine+' unavailable storage');}
  finally{await browser.close();writeFileSync(`${out}/summary.json`,JSON.stringify({origin,proofBoundary:'Final actual integrated local UI with fictitious Auth/RPC interception. No real Auth, business mutation, deployment or external-system proof.',results},null,2));}
}
