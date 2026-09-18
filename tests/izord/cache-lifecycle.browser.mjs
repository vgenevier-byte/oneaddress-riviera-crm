/** R2: real local login/portal and raw origin storage, before/after correction.
 * Isolated browser profile only. No real profile, cloud target, or production data.
 * --before records the vulnerability on the frozen baseline, before source edits.
 */
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync,mkdtempSync,readdirSync,statSync,appendFileSync,existsSync } from 'node:fs';
import { createHash,randomUUID } from 'node:crypto';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { assertLocalTarget } from './local-target.mjs';
const before=process.argv.includes('--before');
const status=JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE,'utf8'));
const fixture=JSON.parse(readFileSync(process.env.LOCAL_FIXTURE_FILE,'utf8'));
const app='http://127.0.0.1:3159';
assertLocalTarget({api:status.API_URL,database:status.DB_URL,app,mail:'http://127.0.0.1:55434',acknowledgement:process.env.IZORD_TEST_ACK});
assert.equal(fixture.api,status.API_URL);
const out=resolve(process.env.IZORD_ARTIFACTS||'/tmp/izord-cache-lifecycle');mkdirSync(out,{recursive:true});
const privateDir=mkdtempSync(join(tmpdir(),'izord-cache-browser-private-'));
const browserSession=`izord-cache-${process.pid}-${randomUUID().slice(0,8)}`,config=join(privateDir,'config.json');writeFileSync(config,'{}',{mode:0o600});
const binary=process.env.AGENT_BROWSER_BIN||'/tmp/izord-browser-runtime/node_modules/.bin/agent-browser';
const browserEnv={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR};
const markers={legacy:'FICTIONAL_LEGACY_CACHE_ONLY',scoped:'FICTIONAL_OLD_OWNER_CACHE_ONLY',other:'FICTIONAL_UNRELATED_PREFERENCE'};
const legacy='oneaddress-riviera-crm-v1',scoped=`oar:${fixture.users.both.id}:${legacy}`;
const startedAt=new Date().toISOString(),started=Date.now(),tracePath=join(out,'cache-command-trace.jsonl');
for(const filename of ['cache-command-trace.jsonl','cache-before.json','cache-after.json','cache-before-failure.json','cache-after-failure.json'])assert.equal(existsSync(join(out,filename)),false,'Use a new artifact directory for every attempt; never overwrite an earlier trace');
writeFileSync(tracePath,'',{mode:0o600});
let socket,seq=0,current,remoteRequests=0,recoveryStep='not started',recoveryNumber=0,scenario='startup';
const pending=new Map(),sessions=new Map(),checks=[],browserEvents=[],downloads=new Map(),downloadProofs=[],observations=[],health=[],requests=new Map();
const targetRole=session=>session?sessions.get(session)?.role||'unattached':'browser';
const phase=()=>({scenario,recoveryNumber,recoveryStep});
function trace(event){appendFileSync(tracePath,JSON.stringify({elapsedMs:Date.now()-started,...phase(),...event})+'\n');}
function ab(...args){try{return execFileSync(binary,['--config',config,'--session',browserSession,...args],{encoding:'utf8',timeout:45000,env:browserEnv,stdio:['ignore','pipe','pipe']}).trim();}catch{throw Error('Isolated browser command failed; arguments withheld');}}
function send(method,params={},session=current,label=method){return new Promise((resolve,reject)=>{
 const id=++seq,command={id,method,label,target:targetRole(session)},begin=Date.now();trace({event:'command-start',...command});
 if(socket?.readyState!==WebSocket.OPEN){trace({event:'command-failed',...command,reason:'transport-not-open'});reject(Error('CDP transport is not open'));return;}
 const timer=setTimeout(()=>{pending.delete(id);trace({event:'command-timeout',...command,durationMs:Date.now()-begin});reject(Error(`CDP timeout ${method}: ${label}`));},20000);
 pending.set(id,{resolve,reject,timer,command,begin});socket.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));
});}
async function ev(expression,session=current,label='read browser state'){
 const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},session,label);
 if(r.exceptionDetails){trace({event:'evaluation-exception',label,target:targetRole(session)});throw Error('Browser evaluation failed: '+label);}return r.result.value;
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,label){const deadline=Date.now()+15000;while(Date.now()<deadline){try{if(await fn())return;}catch(error){
 // A document replacement can invalidate a read while navigation is underway.
 // Transport failures, timeouts, detached targets and JS exceptions are fatal.
 if(error.kind!=='navigation-context-changed')throw error;trace({event:'navigation-context-changed',label});
 }await pause(100);}throw Error('Timed out waiting for state: '+label);}
async function ready(session=current,path,navigation){
 // Auth can legitimately reload the newly committed document. Accept that newer
 // document at the expected path, but never the pre-navigation document.
 if(navigation)await wait(async()=>{const frame=(await send('Page.getFrameTree',{},session,'expected navigation committed')).frameTree.frame;return frame.loaderId!==navigation.previousLoader&&new URL(frame.url).pathname===path;},'expected navigation committed');
 await wait(()=>ev(`document.readyState!=="loading"&&!!document.body&&!document.body.textContent.includes("Vérification des accès…")${path?`&&location.pathname===${JSON.stringify(path)}`:''}`,session,'expected document and portal ready'),'expected document and portal ready');
}
async function nav(path,session=current){const previousLoader=(await send('Page.getFrameTree',{},session,'record pre-navigation document')).frameTree.frame.loaderId;const navigation=await send('Page.navigate',{url:app+path},session,'navigate to expected local path');assert.equal(navigation.errorText,undefined,'Local navigation must commit');await ready(session,path,navigation.loaderId?{previousLoader}:null);}
async function serverHealth(label){const begin=Date.now();let observation;try{const response=await fetch(app+'/api/drive/diagnostic',{redirect:'error',signal:AbortSignal.timeout(2000)});observation={label,status:response.status,durationMs:Date.now()-begin};}catch{observation={label,status:null,durationMs:Date.now()-begin,error:'local-health-unavailable'};}health.push(observation);trace({event:'server-health',...observation});return observation;}
async function observeRecovery(label){
 const state=await ev(`(()=>{const buttons=[...document.querySelectorAll('button')];return {path:location.pathname,readyState:document.readyState,visibility:document.visibilityState,focused:document.hasFocus(),gate:!!document.querySelector('[data-cache-transition]'),loginPresent:!!document.querySelector('input[type=password]'),ownerChecked:!!document.querySelector('[data-cache-owner]')?.checked,recoveredChecked:!!document.querySelector('[data-cache-recovered]')?.checked,downloadEnabled:buttons.some(b=>b.textContent.trim()==='Télécharger la copie de récupération'&&!b.disabled),purgeEnabled:buttons.some(b=>b.textContent.trim()==='Effacer les anciennes copies du navigateur'&&!b.disabled)}})()`,current,label);
 observations.push({label,...phase(),...state});trace({event:'observed-state',label,target:targetRole(current),...state});return state;
}
async function login(name,path='/spaces'){
 scenario='login-'+name;
 await nav(path);await wait(()=>ev('!!document.querySelector("input[type=password]")'),'login form');const u=fixture.users[name];assert.ok(u?.password);
 await ev(`(()=>{for(const [selector,value]of ${JSON.stringify([['input[type=email]',u.email],['input[type=password]',u.password]])}){const el=document.querySelector(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));}return true})()`);
 await ev('document.querySelector("form").requestSubmit();true');await wait(()=>ev(`!document.querySelector('input[type=password]')&&!document.body.textContent.includes('Vérification des accès…')&&document.body.textContent.includes(${JSON.stringify(u.email)})`),'real local login');
}
async function clickLabel(label){await ev(`(()=>{const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!el||el.disabled)throw Error('button unavailable');el.click();return true})()`,current,'click '+label);}
async function logout(){await ev("(()=>{const b=[...document.querySelectorAll('button')].find(e=>/déconnexion|se déconnecter/i.test(e.textContent));if(!b)throw Error('missing logout');b.click();return true})()");await wait(()=>ev('!!document.querySelector("input[type=password]")'),'logged out');}
async function cacheKeys(session=current){return ev("Object.keys(localStorage).filter(k=>k.startsWith('oneaddress-riviera-crm-')||/^oar:[^:]+:/.test(k))",session);}
async function rawHas(marker,session=current){return ev(`Object.values(localStorage).some(value=>value.includes(${JSON.stringify(marker)}))`,session);}
async function seedLegacy(){await ev(`localStorage.setItem(${JSON.stringify(legacy)},${JSON.stringify(markers.legacy)});localStorage.setItem(${JSON.stringify(scoped)},${JSON.stringify(markers.scoped)});localStorage.setItem('fictional-ui-preference',${JSON.stringify(markers.other)});true`);}
function pass(name,details={}){checks.push({name,...details});trace({event:'assertion-passed',name});console.log('PASS '+name);}
async function attach(targetId,role){const session=(await send('Target.attachToTarget',{targetId,flatten:true},null)).sessionId;sessions.set(session,{targetId,role});await send('Runtime.enable',{},session);await send('Page.enable',{},session);await send('Network.enable',{},session);await send('Log.enable',{},session);return session;}
async function newTab(path,role){const target=(await send('Target.createTarget',{url:app+path},null)).targetId;const session=await attach(target,role);await ready(session,path);return session;}
async function expireBrowserSessionAfterClose(){
 const old=current;current=await newTab('/favicon.ico','reopened-profile');await send('Target.closeTarget',{targetId:sessions.get(old).targetId},null);sessions.delete(old);
 // Emulates an expired/removed local Auth session while the old CRM page is closed.
 // The next identity still signs in through the real local Auth form.
 await ev("Object.keys(localStorage).filter(k=>k.startsWith('sb-')&&k.endsWith('-auth-token')).forEach(k=>localStorage.removeItem(k));true");
}
async function recoverAndPurge(){
 recoveryNumber++;
 recoveryStep='activate owned recovery tab';
 assert.ok(sessions.has(current),'Recovery must target an owned page');
 await send('Target.activateTarget',{targetId:sessions.get(current).targetId},null,'activate owned recovery tab');
 await send('Page.bringToFront',{},current,'bring owned recovery page to front');
 await wait(()=>ev('document.visibilityState==="visible"&&document.hasFocus()',current,'recovery page visible and focused'),'recovery page visible and focused');
 recoveryStep='wait for gate';
 await wait(()=>ev('!!document.querySelector("[data-cache-transition]")',current,'recovery gate present'),'cache transition gate');
 await observeRecovery('recovery gate ready');
 recoveryStep='verify no login form';
 assert.equal(await ev('!!document.querySelector("input[type=password]")',current,'no login form before recovery'),false,'No next-account form before cache recovery');
 recoveryStep='acknowledge private owner';
 await ev("document.querySelector('[data-cache-owner]').click();true",current,'check owner acknowledgement');
 await wait(()=>ev("document.querySelector('[data-cache-owner]')?.checked&&[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Télécharger la copie de récupération'&&!b.disabled)",current,'owner acknowledged and download enabled'),'owner acknowledged and download enabled');
 await observeRecovery('download control ready');
 recoveryStep='click recovery download';
 const previousFiles=new Map(readdirSync(privateDir).map(f=>[f,statSync(join(privateDir,f)).mtimeMs])),previousDownloads=new Set(downloads.keys());
 await clickLabel('Télécharger la copie de récupération');
 recoveryStep='wait for completed browser download';
 const download=()=>{const candidates=[...downloads.values()].filter(value=>!previousDownloads.has(value.guid));assert.ok(candidates.length<=1,'One recovery click must produce one unambiguous download');return candidates[0];};
 await wait(()=>{const currentDownload=download();if(currentDownload?.state==='canceled')throw Error('Recovery download canceled');return currentDownload?.state==='completed';},'browser recovery download completed');
 recoveryStep='wait for download on disk';
 const completedFile=()=>readdirSync(privateDir).find(f=>f.endsWith('.json')&&(!previousFiles.has(f)||statSync(join(privateDir,f)).mtimeMs>previousFiles.get(f)));
 await wait(()=>Boolean(completedFile()),'recovery file saved outside origin');
 const name=completedFile();const payload=readFileSync(join(privateDir,name),'utf8');
 assert.ok(payload.includes(markers.legacy)&&payload.includes(markers.scoped),'Export must preserve both old cache families');assert.ok(!payload.includes(markers.other),'Unrelated keys must not be exported');assert.ok(!payload.includes('access_token'),'Auth sessions must not be exported');
 assert.equal(JSON.parse(payload).format,'oar-browser-recovery-v1','Completed download must be a valid recovery file');
 const proof={recoveryNumber,completed:true,fileChanged:!previousFiles.has(name)||statSync(join(privateDir,name)).mtimeMs>previousFiles.get(name),mtimeMs:statSync(join(privateDir,name)).mtimeMs,bytes:Buffer.byteLength(payload),sha256:createHash('sha256').update(payload).digest('hex')};
 downloadProofs.push(proof);trace({event:'verified-recovery-file',...proof});
 recoveryStep='acknowledge verified recovery';
 await wait(()=>ev('!!document.querySelector("[data-cache-recovered]")',current,'recovery acknowledgement rendered'),'recovery acknowledgement rendered');
 await ev("document.querySelector('[data-cache-recovered]').click();true",current,'check verified recovery acknowledgement');
 await wait(()=>ev("document.querySelector('[data-cache-recovered]')?.checked&&[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Effacer les anciennes copies du navigateur'&&!b.disabled)",current,'recovery acknowledged and purge enabled'),'recovery acknowledged and purge enabled');
 await observeRecovery('purge control ready');
 recoveryStep='click explicit purge';await clickLabel('Effacer les anciennes copies du navigateur');
 recoveryStep='wait for purge';
 await wait(async()=>!(await ev('!!document.querySelector("[data-cache-transition]")',current,'recovery gate gone after purge')),'explicit purge completed');
 assert.deepEqual(await cacheKeys(),[]);assert.equal(await rawHas(markers.other),true);await observeRecovery('recovery purge completed');pass('Explicit recovery file verified outside origin, then scoped purge; unrelated preferences preserved');recoveryStep='complete';
}
try{
 const initialHealth=await serverHealth('before browser startup');assert.equal(initialHealth.status,401,'Actual local app must be ready before browser startup');
 const browserStart=Date.now();
 ab('--allowed-domains','127.0.0.1','--download-path',privateDir,'open',app+'/spaces');const endpoint=ab('get','cdp-url');assert.match(endpoint,/^ws:\/\/127\.0\.0\.1:/);
 trace({event:'browser-started',durationMs:Date.now()-browserStart,profile:'new isolated session'});
 socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(Error('Local CDP connection failed')),{once:true});});
 socket.addEventListener('message',e=>{
  const m=JSON.parse(String(e.data));
  if(m.id){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);trace({event:m.error?'command-rejected':'command-completed',...p.command,durationMs:Date.now()-p.begin,...(m.error?{code:m.error.code}:{})});if(m.error){const error=Error(`CDP request rejected ${p.command.method}: ${p.command.label}`);if(/Execution context was destroyed|Cannot find context with specified id/.test(m.error.message||''))error.kind='navigation-context-changed';p.reject(error);}else p.resolve(m.result);}return;}
  const params=m.params||{},target=targetRole(m.sessionId);
  if(m.method==='Network.requestWillBeSent'&&sessions.has(m.sessionId)){const url=new URL(params.request.url);if(['http:','https:'].includes(url.protocol)&&url.hostname!=='127.0.0.1')remoteRequests++;requests.set(m.sessionId+':'+params.requestId,{path:url.pathname,method:params.request.method});}
  let event;
  if(m.method==='Network.responseReceived'&&params.response.status>=400)event={event:m.method,target,path:new URL(params.response.url).pathname,status:params.response.status};
  if(m.method==='Network.loadingFailed')event={event:m.method,target,...requests.get(m.sessionId+':'+params.requestId),canceled:Boolean(params.canceled),reason:/^(net::)?[A-Z_:0-9]+$/.test(params.errorText||'')?params.errorText:'network-error'};
  if(m.method==='Runtime.consoleAPICalled'&&params.type==='error'){
   const text=params.args.map(arg=>String(arg.value??arg.description??'')).join(' ');
   event={event:m.method,target,type:params.type,category:/hydrat|server rendered HTML/i.test(text)?'hydration':/auth|token/i.test(text)?'auth':/network|fetch/i.test(text)?'network':'other',messageSHA256:createHash('sha256').update(text).digest('hex')};
  }
  if(m.method==='Log.entryAdded'&&params.entry.level==='error')event={event:m.method,target,level:'error',messageSHA256:createHash('sha256').update(params.entry.text||'').digest('hex')};
  if(m.method==='Page.javascriptDialogOpening'||m.method==='Page.javascriptDialogClosed')event={event:m.method,target,type:params.type,handled:params.result};
  if(m.method==='Runtime.exceptionThrown')event={event:m.method,target,exception:true};
  if(m.method==='Target.targetDestroyed'||m.method==='Target.detachedFromTarget')event={event:m.method,target:targetRole(params.sessionId)};
  if(m.method==='Browser.downloadWillBegin')downloads.set(params.guid,{guid:params.guid,state:'started'});
  if(m.method==='Browser.downloadProgress'){const item=downloads.get(params.guid)||{guid:params.guid};downloads.set(params.guid,{...item,state:params.state});}
  if(m.method==='Browser.downloadWillBegin'||m.method==='Browser.downloadProgress')event={event:m.method,state:params.state,guid:params.guid};
  if(event){const safe={...phase(),...event};browserEvents.push(safe);trace(safe);}
 });
 socket.addEventListener('close',()=>{trace({event:'cdp-transport-closed'});for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('CDP transport closed'));}pending.clear();});
 socket.addEventListener('error',()=>trace({event:'cdp-transport-error'}));
 const targets=(await send('Target.getTargets',{},null)).targetInfos;const owned=targets.find(t=>t.type==='page'&&t.url.startsWith(app));assert.ok(owned,'Owned local tab required');current=await attach(owned.targetId,'initial-portal');
 const browserVersion=await send('Browser.getVersion',{},null);trace({event:'browser-version',product:browserVersion.product,protocolVersion:browserVersion.protocolVersion});
 assert.equal(await ev("!Object.keys(localStorage).some(k=>k.startsWith('oneaddress-riviera-crm-')||/^oar:[^:]+:/.test(k)||(k.startsWith('sb-')&&k.endsWith('-auth-token')))",current,'fresh profile has no prior Auth or CRM storage'),true,'Each run must start with a fresh fictitious browser profile');
 await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:privateDir,eventsEnabled:true},null);
 // Old-CRM migration: insert fictional remnants while no identity is authenticated.
 scenario='initial-legacy-recovery';
 await seedLegacy();await nav('/spaces');
 if(before){assert.equal(await rawHas(markers.legacy),true);assert.equal(await rawHas(markers.scoped),true);assert.equal(await ev('!!document.querySelector("input[type=password]")'),true);pass('BEFORE: old global and scoped payloads remain raw-readable while next login is available');}
 else{await wait(()=>ev('!!document.querySelector("[data-cache-transition]")'),'old-cache gate');assert.equal(await rawHas(markers.legacy),true,'No blind deletion before recovery');await recoverAndPurge();}
 await login('both');await nav('/');await wait(()=>ev('!!document.querySelector(".nav-list")'),'real OAR module');await pause(1800);
 if(before){assert.ok((await cacheKeys()).includes(scoped),'Baseline must really create its scoped CRM cache');}
 else{assert.deepEqual(await cacheKeys(),[]);pass('AFTER: real OAR payload never persisted in localStorage or sessionStorage');assert.equal(await ev("Object.values(sessionStorage).some(v=>v.includes('OAR LOCAL CONFIDENTIEL'))"),false);}
 // The legacy key persists across a normal logout in the baseline.
 if(before)await ev(`localStorage.setItem(${JSON.stringify(legacy)},${JSON.stringify(markers.legacy)});true`);
 await logout();await login('b','/izord');
 if(before){assert.equal(await rawHas(markers.legacy),true);pass('BEFORE: normal OAR logout then real IZORD-only login leaves legacy payload raw-readable');}
 else{assert.deepEqual(await cacheKeys(),[]);pass('AFTER: normal OAR logout → real IZORD-only login leaves no persisted CRM payload');}
 await logout();await login('both');await nav('/');await pause(1800);await expireBrowserSessionAfterClose();await login('b','/izord');
 if(before){assert.ok((await cacheKeys()).includes(scoped));pass('BEFORE: page closed without logout, new module owner=null; old scoped CRM payload remains readable by the next session');}
 else{assert.deepEqual(await cacheKeys(),[]);pass('AFTER: close without logout, local session expires, then real IZORD login: no old persisted payload');}
 await nav('/izord');
 if(before){assert.ok((await cacheKeys()).includes(scoped));pass('BEFORE: direct /izord still exposes old-account raw storage despite no CRM component');}
 else{assert.deepEqual(await cacheKeys(),[]);pass('AFTER: direct /izord has no raw cache of the previous OAR account');}
 if(!before){
  await logout();await login('both');await nav('/');await wait(()=>ev('!!document.querySelector(".nav-list")'),'first OAR tab');
  const original=current,otherOAR=await newTab('/','other-oar');await wait(()=>ev('!!document.querySelector(".nav-list")',otherOAR),'second OAR tab');
  await logout();await login('b','/izord');await wait(()=>ev('!document.querySelector(".nav-list")&&!document.body.textContent.includes("OAR LOCAL CONFIDENTIEL")',otherOAR),'other tab leaves prior identity');
  assert.deepEqual(await cacheKeys(otherOAR),[]);pass('AFTER: logout and next identity propagate to the other OAR tab without a persisted payload');
  await send('Target.closeTarget',{targetId:sessions.get(otherOAR).targetId},null);sessions.delete(otherOAR);current=original;
 }
 scenario='multitab-legacy-recovery';
 const first=current,second=await newTab('/izord','other-izord');
 if(before){await ev(`localStorage.setItem(${JSON.stringify(scoped)},${JSON.stringify(markers.scoped)});true`,first);assert.equal(await rawHas(markers.scoped,second),true);pass('BEFORE: a second tab reads the old-account cache through shared-origin localStorage');}
 else{
  // An already-open legacy tab writing again must block both current portals.
  const legacyTab=await newTab('/favicon.ico','legacy-writer');await ev(`localStorage.setItem(${JSON.stringify(legacy)},${JSON.stringify(markers.legacy)});localStorage.setItem(${JSON.stringify(scoped)},${JSON.stringify(markers.scoped)});true`,legacyTab);
  await wait(()=>ev('!!document.querySelector("[data-cache-transition]")',first),'first tab transition');await wait(()=>ev('!!document.querySelector("[data-cache-transition]")',second),'second tab transition');
  assert.equal(await ev('!!document.querySelector(".nav-list")',first),false);assert.equal(await ev('!!document.querySelector(".nav-list")',second),false);
  pass('AFTER: an old tab writes a cache → all open portals block and drop in-memory CRM access');
  await send('Target.closeTarget',{targetId:sessions.get(legacyTab).targetId},null,'close obsolete cache writer');sessions.delete(legacyTab);current=first;await recoverAndPurge();
  await wait(async()=>(await cacheKeys(second)).length===0,'all-tab raw purge');pass('AFTER: explicit purge removes shared-origin caches in every tab');
 }
 assert.equal(remoteRequests,0);await serverHealth('after successful suite');writeFileSync(join(out,before?'cache-before.json':'cache-after.json'),JSON.stringify({mode:before?'real baseline reproduction':'real corrected lifecycle',startedAt,durationMs:Date.now()-started,passed:checks.length,checks,remoteRequests,browserEvents,observations,downloadProofs,health,profile:'new isolated disposable browser per execution',auth:'real local Supabase login; session-expiry simulation only for closed-tab case',realProfileTouched:false},null,2));
}catch(error){
 await serverHealth('after failure');
 let screenshot='not captured';try{if(await ev('!!document.querySelector("[data-cache-transition]")&&!document.querySelector("input[type=email],input[type=password]")',current,'failure screenshot contains no credential form')){const shot=await send('Page.captureScreenshot',{format:'png'},current,'capture fictional recovery gate');writeFileSync(join(out,'cache-failure.png'),Buffer.from(shot.data,'base64'));screenshot='fictional recovery gate captured';}}catch{screenshot='unavailable; renderer or transport did not respond';}
 writeFileSync(join(out,before?'cache-before-failure.json':'cache-after-failure.json'),JSON.stringify({startedAt,durationMs:Date.now()-started,passed:checks.length,checks,...phase(),browserEvents,observations,downloadProofs,health,screenshot,error:String(error.message).replace(/eyJ[A-Za-z0-9_.-]+/g,'[REDACTED]')},null,2));throw Error('Cache lifecycle browser test failed; sanitized artifact written');
}
finally{if(socket?.readyState===WebSocket.OPEN){try{await send('Browser.close',{},null);}catch{}}if(socket)socket.close();for(const p of pending.values())clearTimeout(p.timer);pending.clear();try{ab('close');}catch{}}
