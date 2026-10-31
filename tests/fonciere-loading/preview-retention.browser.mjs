/** Actual production CRM, real local authorization, instrumented fictional Google provider.
 * No business writes. HTTP proxy supplies real handler responses, no mocked successes.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {previewProvider} from './preview-retention-provider.mjs';
const require=createRequire(import.meta.url),{chromium}=require('/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const f=JSON.parse(readFileSync(process.env.COLLAPSE_FIXTURE,'utf8'));
assert.equal(f.api,'http://127.0.0.1:57031');assert.equal(f.app,'http://127.0.0.1:3197');assert(f.users.admin.email.endsWith('@example.invalid'));
const app='http://127.0.0.1:3199',label=process.env.MEASURE_LABEL||'before',out=process.env.MEASURE_OUTPUT||'/private/tmp/preview-retention-evidence';mkdirSync(out,{recursive:true});
const provider=await previewProvider(f),originalFetch=globalThis.fetch;
let active=null,delay=false;
globalThis.fetch=async(input,init)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(active&&u.origin===f.api&&u.pathname==='/rest/v1/rpc/crm_drive_read')active.admissionChecks++;return originalFetch(input,init);};
const metrics=()=>({previewRequests:0,conditionalRequests:0,statuses:{},jpegBodyBytes:0,browserEncodedBytes:0,admissionChecks:0,providerMetadataRequests:0,providerOriginalReads:0,providerOriginalBytes:0,supabaseOriginalReads:0,supabaseOriginalBytes:0});
const proxy=createServer(async(req,res)=>{
 try {
  if(req.url.startsWith('/api/fonciere/photo-preview')){
   const metric=active,headers=req.headers,controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
   if(metric){metric.previewRequests++;if(headers['if-none-match'])metric.conditionalRequests++;}
   if(delay)await new Promise(r=>setTimeout(r,800));
   const response=await provider.handle(new Request(app+req.url,{headers,signal:controller.signal}));const bytes=Buffer.from(await response.arrayBuffer());
   if(metric){metric.statuses[response.status]=(metric.statuses[response.status]||0)+1;if(response.status===200)metric.jpegBodyBytes+=bytes.length;}
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(bytes);
  } else {
   assert(['GET','HEAD','POST'].includes(req.method));
   const body=[];for await(const chunk of req)body.push(chunk);
   const headers={...req.headers};delete headers.host;delete headers.connection;
   const r=await originalFetch(f.app+req.url,{method:req.method,headers,...(body.length?{body:Buffer.concat(body)}:{}),redirect:'manual'});
   const responseHeaders=Object.fromEntries(r.headers);delete responseHeaders['content-encoding'];delete responseHeaders['content-length'];delete responseHeaders['transfer-encoding'];
   res.writeHead(r.status,responseHeaders);res.end(Buffer.from(await r.arrayBuffer()));
  }
 }catch(error){if(!res.headersSent)res.writeHead(503);res.end('Fictional local test request failed');console.error(error.message);}
});
await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(3199,'127.0.0.1',resolve);});
const browser=await chromium.launch({headless:true,channel:'chrome'}),rows=[],checks=[],errors=[];
const workspace=page=>page.locator('[data-fonciere-projects]:visible');
async function back(page,method){if(method==='button')await page.getByRole('button',{name:'Tous les projets',exact:true}).click();else{const nav=page.locator('.sidebar:visible'),button=nav.locator('[data-navigation-module=fonciere]');if(!await button.isVisible())await nav.locator('[data-navigation-group=fonciere]').click();await button.click();}await page.waitForURL(app+'/fonciere');await workspace(page).getByRole('textbox',{name:'Rechercher un projet',exact:true}).waitFor();}
async function open(page,record){await workspace(page).locator('[role=listitem]').filter({hasText:record.name}).locator('button').first().click();await page.getByRole('heading',{name:record.name,exact:true}).waitFor();const toggle=page.locator('[data-project-section=documents] [data-section-toggle]');if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();}
async function gallery(page,n){await page.waitForFunction(n=>{const images=[...document.querySelectorAll('[data-project-gallery] img')];return images.length===n&&images.every(i=>i.complete&&i.naturalWidth)&&document.querySelector('[data-media-status]')?.dataset.mediaStatus==='complete';},n);await page.waitForTimeout(150);}
async function session(){const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.route('**/*',r=>{const u=new URL(r.request().url());return ['http:','https:'].includes(u.protocol)&&![app,f.api].includes(u.origin)?r.abort():r.continue();});await context.addInitScript(id=>{localStorage.setItem('oar.ui-language.v1:anonymous','fr');localStorage.setItem('oar.ui-language.v1:account:'+id,'fr');},f.users.admin.id);const page=await context.newPage();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(app+'/fonciere');await page.locator('input[type=email]').fill(f.users.admin.email);await page.locator('input[autocomplete=current-password]').fill(f.users.admin.password);await page.getByRole('button',{name:'Se connecter',exact:true}).click();await workspace(page).locator('[role=listitem]').first().waitFor();const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');const requests=new Map();cdp.on('Network.requestWillBeSent',e=>{if(active&&new URL(e.request.url).pathname==='/api/fonciere/photo-preview')requests.set(e.requestId,active);});cdp.on('Network.loadingFinished',e=>{const m=requests.get(e.requestId);if(m){m.browserEncodedBytes+=e.encodedDataLength;requests.delete(e.requestId);}});return{page,context};}
function start(){active=metrics();provider.setActive(active);return active;}function stop(){active=null;provider.setActive(null);}
try{
 for(const record of f.performance.records){for(const method of ['menu','button']){const {page,context}=await session();let m=start();await open(page,record);await gallery(page,record.count);stop();rows.push({record:record.id,repetition:record.repetition,method,phase:'first',...m});await back(page,method);m=start();await open(page,record);await gallery(page,record.count);stop();rows.push({record:record.id,repetition:record.repetition,method,phase:'reopen',...m});assert.equal(m.previewRequests,record.count);assert.equal(m.admissionChecks,record.count*2);assert.equal(m.providerOriginalReads,0);assert.equal(m.supabaseOriginalReads,0);
  if(label==='after'){assert.equal(m.conditionalRequests,record.count);assert.equal(m.statuses[304],record.count);assert.equal(m.jpegBodyBytes,0);}else{assert.equal(m.conditionalRequests,0);assert.equal(m.statuses[200],record.count);assert(m.jpegBodyBytes>0);}
  console.log(label,method,record.repetition,JSON.stringify(m));await context.close();}}
 if(label==='after'){
  const {page,context}=await session(),record=f.performance.records[0];delay=true;let m=start();await open(page,record);await page.waitForFunction(()=>document.querySelector('[data-media-status]')?.dataset.mediaStatus==='pending');await back(page,'menu');await page.waitForTimeout(1200);assert.equal(await workspace(page).locator('[data-project-section]').count(),0);stop();delay=false;await open(page,record);await gallery(page,record.count);checks.push('Return during loading cancels obsolete reads; delayed responses cannot reopen the record');await context.close();
 }
 assert.deepEqual(errors,[]);writeFileSync(out+'/'+label+'.json',JSON.stringify({label,rows,checks,errors,setupStorageBytes:provider.setupBytes,conditions:'Current full production CRM; real local Auth/RPC; fictional Google HTTP metadata and pinned bytes; three identical 24-photo fixtures, menu and All projects; no business writes or real Google calls. CDP encodedDataLength is recorded as reported by Chromium (0 on 304), not total protocol traffic. JPEG body bytes count only image payload. Setup Storage reads excluded from measured windows.'},null,2));
}finally{stop();await browser.close();await new Promise(resolve=>proxy.close(resolve));globalThis.fetch=originalFetch;}
