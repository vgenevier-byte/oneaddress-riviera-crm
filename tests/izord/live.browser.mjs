/** Actual local Auth + browser integration, with delayed real responses via CDP.
 * No mocked Auth/REST payloads. Only artificial response latency is introduced.
 * Private fixture file contains fictional credentials and is never copied to artifacts.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { assertLocalTarget } from './local-target.mjs';
const require=createRequire(import.meta.url);
const status=JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE,'utf8'));
const fixture=JSON.parse(readFileSync(process.env.LOCAL_FIXTURE_FILE,'utf8'));
const api=status.API_URL, app='http://127.0.0.1:3159', mail='http://127.0.0.1:55434';
assertLocalTarget({api,database:status.DB_URL,app,mail,acknowledgement:process.env.IZORD_TEST_ACK});
assert.equal(fixture.api,api,'Fixture must belong to this local API');
const out=resolve(process.env.IZORD_ARTIFACTS || '/tmp/izord-artifacts');mkdirSync(out,{recursive:true});
const binary=process.env.AGENT_BROWSER_BIN || '/tmp/izord-browser-runtime/node_modules/.bin/agent-browser';
const browserSession=`izord-real-${process.pid}`;
const browserConfig=join(out,'browser-config.json');writeFileSync(browserConfig,'{}');
const browserEnv={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR};
const users=fixture.users, names=new Map(Object.entries(users).map(([name,user])=>[user.id,name]));
const checks=[], traffic=[], pending=new Map(), handlers=new Map(), held=new Map();
let socket,sessionId,requestId=0,sql,revokedByTest=false,originalWorkspace=null,holdRule=null,holdObserved=0,heldCancelled=0,remoteAttempts=0,browserErrors=0;
const pass=name=>{checks.push(name);console.log(`PASS ${name}`);};
function ab(...args){try{return execFileSync(binary,['--config',browserConfig,'--session',browserSession,...args],{encoding:'utf8',timeout:45000,env:browserEnv}).trim();}catch{throw Error('Browser command failed (arguments and output withheld to protect credentials)');}}
function event(method,fn){handlers.set(method,[...(handlers.get(method)||[]),fn]);}
function send(method,params={},session=sessionId){return new Promise((resolve,reject)=>{const id=++requestId;const timeout=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout: ${method}`));},25000);pending.set(id,{resolve,reject,timeout});socket.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error('Browser evaluation failed (details withheld)');return r.result.value;}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,label,limit=15000){const end=Date.now()+limit;while(Date.now()<end){if(await fn())return;await pause(100);}throw Error(`Timed out: ${label}`);}
const waitUI=(expression,label)=>waitFor(()=>evaluate(expression),label);
function userFromHeaders(headers){const token=Object.entries(headers||{}).find(([k])=>k.toLowerCase()==='authorization')?.[1]?.replace(/^Bearer /i,'');if(!token)return 'anonymous';try{return names.get(JSON.parse(Buffer.from(token.split('.')[1],'base64url')).sub)||'other-local';}catch{return 'invalid';}}
function bodyContainsMarker(body,marker){return typeof body==='string' && body.includes(marker);}
async function navigate(path){await send('Page.navigate',{url:app+path});await waitUI('document.readyState !== "loading" && !document.body.textContent.includes("Vérification des accès…")','access verification');}
async function login(name,path='/spaces'){
 await navigate(path);await waitUI('!!document.querySelector("input[type=password]")','individual login form');
 const user=users[name];assert.ok(user?.email&&user?.password,'Missing private fictional credentials');
 await evaluate(`(()=>{const values=[${JSON.stringify(user.email)},${JSON.stringify(user.password)}];for(const [i,selector] of ['input[type=email]','input[type=password]'].entries()){const el=document.querySelector(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,values[i]);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}return true})()`);
 await evaluate('document.querySelector("form").requestSubmit();true');
 await waitUI(`!document.querySelector('input[type=password]') && !document.body.textContent.includes('Vérification des accès…') && document.body.textContent.includes(${JSON.stringify(user.email)})`,'authenticated profile');
}
async function logout(){
 await evaluate("window.confirm=()=>true;true");
 await evaluate(`(()=>{const el=[...document.querySelectorAll('button')].find(e=>/déconnexion|se déconnecter/i.test(e.textContent));if(!el)throw Error('logout button unavailable');el.click();return true})()`);
 await waitUI('!!document.querySelector("input[type=password]")','logout completed');
}
const crmCallsSince=i=>traffic.slice(i).filter(r=>r.path.startsWith('/rest/v1/crm_'));
const workspaceWritesSince=i=>traffic.slice(i).filter(r=>r.path==='/rest/v1/crm_workspace_state'&&['POST','PATCH','PUT'].includes(r.method));
async function noCRM(){assert.equal(await evaluate('!!document.querySelector(".nav-list")'),false,'CRM must not mount');}
async function cacheHas(marker){return evaluate(`(()=>{let found=false;window.webpackChunk_N_E.push([[Math.random()],{},require=>{for(const [id,factory]of Object.entries(require.m)){if(!String(factory).includes('oar-cache-lifecycle'))continue;for(const value of Object.values(require(id)||{}))if(value&&typeof value.getItem==='function'&&typeof value.setItem==='function')found=String(value.getItem('oneaddress-riviera-crm-v1')||'').includes(${JSON.stringify(marker)});}}]);return found})()`);}
let editSequence=0;
async function editContact(name){
 name += ` ${++editSequence}`;
 await evaluate(`(()=>{document.querySelector('.nav-list button:nth-child(2)').click();return true})()`);
 await waitUI(`!!document.querySelector('.contact-create-form [name="name"]')`,'business contact form');
 await evaluate(`(()=>{const form=document.querySelector('.contact-create-form'),input=form.querySelector('[name="name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(name)});input.dispatchEvent(new Event('input',{bubbles:true}));form.requestSubmit();return true})()`);
}
async function screenshot(name){ab('screenshot',join(out,name+'.png'));}
async function clickAction(label){await evaluate(`(()=>{const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!el)throw Error('CRM action unavailable');el.click();return true})()`);}
async function backupCount(){return Number((await sql.query('select count(*) count from public.crm_backups')).rows[0].count);}
async function assertNoOldWriteAsNew(mark){assert.equal(workspaceWritesSince(mark).some(r=>r.actor==='oar2'&&r.oldMarker),false,'Old payload must not be written under the new identity');const stored=(await sql.query("select payload,updated_by from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0];assert.equal(stored.updated_by,users.oar2.id);assert.ok(JSON.stringify(stored.payload).includes('OAR NEXT ACCOUNT'));assert.equal(await cacheHas('OAR OLD RESPONSE'),false);}
async function releaseHeld(){const entries=[...held.keys()];held.clear();for(const id of entries){try{await send('Fetch.continueResponse',{requestId:id});}catch{heldCancelled++;}}}
async function seedWorkspace(marker){
 const prior=(await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
 const payload={...prior,contacts:[...(prior.contacts||[]).filter(c=>c.id!=='fictional-contact-browser'),{id:'fictional-contact-browser',name:marker,type:'Particulier',email:'contact@example.invalid'}]};
 await sql.query("update public.crm_workspace_state set payload=$1::jsonb,updated_at=now() where workspace_id='oneaddress-riviera'",[JSON.stringify(payload)]);
}
try {
 // Domain restriction applies before first page request; browser has a fresh isolated profile.
 ab('--allowed-domains','127.0.0.1','open',app+'/spaces');
 const endpoint=ab('get','cdp-url');assert.match(endpoint,/^ws:\/\/127\.0\.0\.1:/,'CDP must also be local');
 socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(Error('Local CDP connection failed')),{once:true});});
 socket.addEventListener('message',message=>{
  const data=JSON.parse(String(message.data));if(data.id){const p=pending.get(data.id);if(p){clearTimeout(p.timeout);pending.delete(data.id);data.error?p.reject(Error('CDP operation rejected')):p.resolve(data.result);}return;}
  if(data.sessionId===sessionId)for(const fn of handlers.get(data.method)||[])Promise.resolve(fn(data.params)).catch(()=>{});
 });
 const targets=await send('Target.getTargets',{},null);const target=targets.targetInfos.find(t=>t.type==='page'&&t.url.startsWith(app));assert.ok(target,'Owned local tab required');
 sessionId=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 event('Runtime.exceptionThrown',()=>{browserErrors++;});
 event('Network.requestWillBeSent',({request})=>{
  const url=new URL(request.url);if(!['http:','https:'].includes(url.protocol))return;
  if(url.hostname!=='127.0.0.1')remoteAttempts++;
  traffic.push({path:url.pathname,method:request.method,actor:userFromHeaders(request.headers),oldMarker:bodyContainsMarker(request.postData,'OAR OLD RESPONSE'),nextMarker:bodyContainsMarker(request.postData,'OAR NEXT ACCOUNT'),time:Date.now()});
 });
 event('Fetch.requestPaused',async e=>{
  if(holdRule&&new URL(e.request.url).pathname===holdRule&&e.responseStatusCode){held.set(e.requestId,{path:holdRule});holdObserved++;holdRule=null;return;}
  await send('Fetch.continueResponse',{requestId:e.requestId});
 });
 await send('Fetch.enable',{patterns:[{urlPattern:api+'/rest/v1/crm_workspace_state*',requestStage:'Response'},{urlPattern:api+'/auth/v1/user*',requestStage:'Response'}]});
 const {Client}=require(process.env.IZORD_PG_MODULE||'pg');sql=new Client({connectionString:status.DB_URL});await sql.connect();
 // Extend only this guarded disposable synthetic baseline for the historical backup UI.
 await sql.query("alter table public.crm_backups add column if not exists contacts_count integer, add column if not exists leads_count integer, add column if not exists properties_count integer, add column if not exists vehicles_count integer, add column if not exists boats_count integer, add column if not exists tasks_count integer, add column if not exists quotes_count integer; notify pgrst, 'reload schema';");
 originalWorkspace=(await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
 let mark=traffic.length;
 await navigate('/');assert.equal(await evaluate('!!document.querySelector("input[type=password]")'),true);await noCRM();assert.equal(crmCallsSince(mark).length,0);pass('Anonymous browser: login only, no OAR or shared payload request');
 await login('none');assert.equal(await evaluate('document.body.textContent.includes("Aucune adhésion active")'),true);await noCRM();assert.equal(crmCallsSince(mark).length,0);pass('Real account without membership: closed UI, no OAR request');await logout();
 await seedWorkspace('OAR LOCAL CONFIDENTIEL');await login('oar');
 assert.equal(await evaluate('[...document.querySelectorAll("nav a")].some(e=>e.href.endsWith("/izord"))'),false);
 await navigate('/');await waitFor(()=>cacheHas('OAR LOCAL CONFIDENTIEL'),'real OAR payload cached');assert.ok(crmCallsSince(mark).some(r=>r.actor==='oar'));

 pass('OAR-only login: real shared payload loaded into account-bound memory');
 await logout();assert.equal(await evaluate(`Object.keys(localStorage).some(k=>k.startsWith(${JSON.stringify('oar:'+users.oar.id+':')}))`),false,'Logout must clear old owner cache');
 mark=traffic.length;await login('b');await navigate('/izord');await waitUI('document.body.textContent.includes("Projet fictif B")','real IZORD project');
 await noCRM();assert.equal(await cacheHas('OAR LOCAL CONFIDENTIEL'),false);assert.equal(await evaluate('/OAR LOCAL CONFIDENTIEL|LEGACY GLOBAL SECRET/.test(document.body.textContent)'),false);
 await send('Page.getNavigationHistory').then(async history=>{if(history.currentIndex>0)await send('Page.navigateToHistoryEntry',{entryId:history.entries[history.currentIndex-1].id});});
 await pause(500);await send('Page.reload');await waitUI('!document.body.textContent.includes("Vérification des accès…")','history reload');
 await navigate('/');await waitUI('document.body.textContent.includes("ne dispose pas d’un accès OAR")','old OAR route denied');await noCRM();assert.equal(crmCallsSince(mark).length,0);
 pass('Same browser OAR logout → IZORD login → back/reload: no old payload, old cache or OAR request');
 await navigate('/izord');await waitUI('document.body.textContent.includes("Projet fictif B")','desktop actual project');await screenshot('live-izord-1440');await logout();
 await login('both');assert.equal(await evaluate(`document.querySelectorAll('nav[aria-label="Espaces autorisés"] a').length`),2);
 await navigate('/');await waitFor(()=>cacheHas('OAR LOCAL CONFIDENTIEL'),'dual account OAR load');await navigate('/izord');await waitUI('document.body.textContent.includes("Projet fictif B")','dual account IZORD access');await navigate('/');await waitUI('!!document.querySelector(".nav-list")','return to CRM');
 pass('Dual membership: actual OAR ↔ IZORD navigation retains the verified account');await logout();
 // Delay a genuine PostgREST response until another account is logged in.
 await seedWorkspace('OAR OLD RESPONSE');await login('oar');holdRule='/rest/v1/crm_workspace_state';mark=traffic.length;const seen=holdObserved;
 await navigate('/');await waitFor(()=>holdObserved>seen,'held real PostgREST response');await logout();await login('b');await releaseHeld();await pause(1300);await noCRM();
 assert.equal(await cacheHas('OAR OLD RESPONSE'),false);assert.equal(workspaceWritesSince(mark).filter(r=>r.actor==='b').length,0);
 pass('Late real OAR REST response across logout/login: cancelled or discarded, no IZORD cache or autosave');await logout();
 // Delay the real Auth response inside a pending autosave, then log in as another OAR user.
 await seedWorkspace('OAR OLD RESPONSE');await login('oar');await navigate('/');await waitFor(()=>cacheHas('OAR OLD RESPONSE'),'old account payload before delayed autosave');
 holdRule='/auth/v1/user';const seenAuth=holdObserved;mark=traffic.length;await editContact('OLD PENDING BUSINESS EDIT');await waitFor(()=>holdObserved>seenAuth,'held real Auth response during OAR autosave');
 await logout();await seedWorkspace('OAR NEXT ACCOUNT');await login('oar2');await navigate('/');await waitFor(()=>cacheHas('OAR NEXT ACCOUNT'),'new account payload');await releaseHeld();await editContact('NEXT VERIFIED BUSINESS EDIT');await pause(1600);
 const writes=workspaceWritesSince(mark);assert.ok(writes.some(r=>r.actor==='oar2'&&r.nextMarker),'New account must actually autosave');assert.equal(writes.some(r=>r.actor==='oar2'&&r.oldMarker),false,'Old callback must never save under the new identity');
 const stored=(await sql.query("select payload,updated_by from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0];assert.equal(stored.updated_by,users.oar2.id);assert.ok(JSON.stringify(stored.payload).includes('OAR NEXT ACCOUNT'));assert.equal(await cacheHas('OAR OLD RESPONSE'),false);
 pass('Late real Auth response during autosave: no old payload persisted with the new OAR identity');
 await logout();await seedWorkspace('OAR OLD RESPONSE');await login('oar');await navigate('/');await waitFor(()=>cacheHas('OAR OLD RESPONSE'),'manual old account load');await pause(1600);
 holdRule='/auth/v1/user';const seenManual=holdObserved;mark=traffic.length;await clickAction('Forcer synchro');await waitFor(()=>holdObserved>seenManual,'held real Auth response during manual sync');
 await logout();await seedWorkspace('OAR NEXT ACCOUNT');await login('oar2');await navigate('/');await waitFor(()=>cacheHas('OAR NEXT ACCOUNT'),'new account after manual sync');await releaseHeld();await editContact('NEXT VERIFIED BUSINESS EDIT');await pause(1600);await assertNoOldWriteAsNew(mark);
 pass('Late manual synchronization Auth response: old data cannot save under the next OAR user');
 await logout();await seedWorkspace('OAR OLD RESPONSE');await login('oar');await navigate('/');await waitFor(()=>cacheHas('OAR OLD RESPONSE'),'backup old account load');await pause(1600);
 const beforePositiveBackup=await backupCount();await evaluate('window.confirm=()=>true;true');await clickAction('Sauvegarde cloud');await waitFor(async()=>await backupCount()===beforePositiveBackup+1,'positive real cloud backup');
 const positiveBackup=(await sql.query('select payload from public.crm_backups where user_id=$1 order by id',[users.oar.id])).rows;assert.ok(positiveBackup.some(r=>JSON.stringify(r.payload).includes('OAR OLD RESPONSE')));
 pass('Cloud backup positive path: real JWT writes one historical backup with the original OAR author');
 const beforeDelayedBackup=await backupCount();holdRule='/rest/v1/crm_workspace_state';const seenBackup=holdObserved;mark=traffic.length;await clickAction('Sauvegarde cloud');await waitFor(()=>holdObserved>seenBackup,'held real first-write response during cloud backup');
 await logout();await seedWorkspace('OAR NEXT ACCOUNT');await login('oar2');await navigate('/');await waitFor(()=>cacheHas('OAR NEXT ACCOUNT'),'new account after staged cloud backup');await releaseHeld();await editContact('NEXT VERIFIED BUSINESS EDIT');await pause(1600);await assertNoOldWriteAsNew(mark);
 assert.equal(await backupCount(),beforeDelayedBackup,'An old first-write continuation must not create a backup after logout');
 assert.equal(traffic.slice(mark).some(r=>r.path==='/rest/v1/crm_backups'&&r.method==='POST'&&r.actor==='oar2'),false);
 pass('Late first-write cloud backup response: second write cancelled across account switch');
 await sql.query("update public.app_memberships set status='revoked' where user_id=$1 and workspace_id='oar'",[users.oar2.id]);revokedByTest=true;mark=traffic.length;
 await evaluate('window.dispatchEvent(new Event("focus"));true');await waitUI('document.body.textContent.includes("ne dispose pas d’un accès OAR")','revoked membership refresh');await noCRM();assert.equal(await cacheHas('OAR NEXT ACCOUNT'),false);
 pass('Browser revocation with existing session: membership refresh removes CRM and its cache');
 await logout();await login('b','/izord');await waitUI('document.body.textContent.includes("Projet fictif B")','mobile actual project');await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await screenshot('live-izord-390');assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 pass('Actual IZORD mobile page: project visible at 390 px without horizontal overflow');
 assert.equal(remoteAttempts,0,'No external request may be attempted by the browser');assert.equal(browserErrors,0,'Browser must have no unhandled runtime errors');pass('Browser traffic restricted to local services, with no unhandled runtime error');
 writeFileSync(join(out,'live-browser-results.json'),JSON.stringify({kind:'real local Auth + REST + browser; artificial latency only',passed:checks.length,checks,heldRealResponses:holdObserved,cancelledOnRelease:heldCancelled,remoteRequests:remoteAttempts,browserErrors,trafficSummary:{auth:traffic.filter(r=>r.path.startsWith('/auth/')).length,crm:traffic.filter(r=>r.path.startsWith('/rest/v1/crm_')).length,izord:traffic.filter(r=>r.path.startsWith('/rest/v1/izord_')).length}},null,2));
} catch(error){
 writeFileSync(join(out,'live-browser-failure.json'),JSON.stringify({passed:checks.length,checks,error:String(error?.message||'Browser test failed').replace(/eyJ[A-Za-z0-9_.-]+/g,'[REDACTED]')},null,2));throw Error('Real browser verification failed; see sanitized live-browser-failure.json');
} finally {
 holdRule=null;try{if(socket?.readyState===WebSocket.OPEN)await releaseHeld();}catch{}
 if(sql){
  if(revokedByTest)await sql.query("update public.app_memberships set status='active' where user_id=$1 and workspace_id='oar'",[users.oar2.id]);
  if(originalWorkspace)await sql.query("update public.crm_workspace_state set payload=$1::jsonb,updated_at=now() where workspace_id='oneaddress-riviera'",[JSON.stringify(originalWorkspace)]);
  await sql.end();
 }
 if(socket)socket.close();try{ab('close');}catch{}
}
