/** One bounded 25,000,000-byte PDF transfer through the real UI/repository XHR.
 * No retries, transport replacement, CDP or real profile. Interruption is not
 * synthesized: this supplement proves a completed transfer and observed events.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {assertLocalTarget} from './local-target.mjs';
const require=createRequire(import.meta.url),{createClient}=require('@supabase/supabase-js');
const runtime=process.env.IZORD_PLAYWRIGHT_RUNTIME,{chromium}=require(join(runtime,'node_modules/playwright'));
const status=JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE,'utf8')),fixture=JSON.parse(readFileSync(process.env.LOCAL_FIXTURE_FILE,'utf8'));
const api=status.API_URL,app='http://127.0.0.1:3159',out=resolve(process.env.IZORD_ARTIFACTS);
assertLocalTarget({api,database:status.DB_URL,app,mail:'http://127.0.0.1:55434',acknowledgement:process.env.IZORD_TEST_ACK});assert.equal(fixture.api,api);
assert.equal(existsSync(join(out,'results.json')),false,'Fresh evidence directory; never retry or overwrite an execution');
mkdirSync(out,{recursive:true});
const owned=mkdtempSync(join(tmpdir(),'izord-large-transfer-')),opts={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(api,status.ANON_KEY,opts),authAdmin=createClient(api,status.SERVICE_ROLE_KEY,opts),writer=createClient(api,status.ANON_KEY,opts);
const email=`large-transfer-${randomUUID()}@example.invalid`,password=randomBytes(24).toString('hex');
const secrets=[password,status.ANON_KEY,status.SERVICE_ROLE_KEY,fixture.users.admin.password];
const sanitize=value=>secrets.filter(Boolean).reduce((text,secret)=>text.split(secret).join('[REDACTED]'),String(value)).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[JWT REDACTED]').replace(/token=[^\s"'&]+/g,'token=[REDACTED]');
async function ok(p){const result=await p;if(result.error)throw Object.assign(Error('Local API operation rejected'),{code:result.error.code});return result.data;}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fictionalPdf(){
 const content='BT /F1 12 Tf 40 700 Td (FICHE FICTIVE - TRANSFERT LOCAL 25 MO) Tj 0 -20 Td (Maison a vendre - Ville Fictive) Tj 0 -20 Td (Surface: 100 m2) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
 let pdf='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
 const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n% FICTIONAL TEST PADDING ONLY\n`;
 const bytes=Buffer.alloc(25_000_000,32);Buffer.from(pdf).copy(bytes);return bytes;
}
const result={startedAt:new Date().toISOString(),checks:[],progress:[],requests:[],failure:null,interruption:{executed:false,reason:'Completed transfer only; no artificial throttling, network replacement or timing-dependent cancellation.'}};
let browser,page,expectedClose=false;
const input=fictionalPdf(),pdfFile=join(owned,'fiche-fictive-25Mo.pdf');writeFileSync(pdfFile,input,{mode:0o600});
result.fixture={bytes:input.length,sha256:hash(input),description:'One simple fictional PDF page plus whitespace padding; no real document.'};
try{
 await ok(admin.auth.signInWithPassword({email:fixture.users.admin.email,password:fixture.users.admin.password}));
 const created=await ok(authAdmin.auth.admin.createUser({email,password,email_confirm:true}));
 await ok(writer.auth.signInWithPassword({email,password}));const invitation=await ok(admin.rpc('izord_invite_izord',{p_email:email,p_role:'contributor'}));await ok(writer.rpc('izord_accept_invitation',{p_token:invitation.token}));
 browser=await chromium.launch({headless:true,executablePath:join(runtime,'browsers/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'),env:{PATH:process.env.PATH,HOME:owned,TMPDIR:owned},args:['--disable-background-networking']});
 result.browser=browser.version();result.playwright=require(join(runtime,'node_modules/playwright/package.json')).version;
 browser.on('disconnected',()=>{if(!expectedClose)result.requests.push({event:'unexpected-close'});});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(['data:','blob:','about:'].includes(url.protocol)||[api,app].includes(url.origin))return route.continue();result.requests.push({event:'remote-blocked',origin:url.origin});return route.abort();});
 await context.routeWebSocket(/.*/,socket=>socket.close());
 // Read-only observers on native XHR: neither headers, bytes nor events are replaced.
 await context.addInitScript(()=>{
  window.__largeTransferProgress=[];window.__largeTransferNotices=[];
  const originalOpen=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(...args){const parsed=new URL(String(args[1]),location.href);if(args[0]==='PUT'&&parsed.pathname.startsWith('/storage/v1/object/upload/sign/')){const record=event=>window.__largeTransferProgress.push({event:event.type,loaded:event.loaded,total:event.total,lengthComputable:event.lengthComputable,at:performance.now()});this.upload.addEventListener('progress',record);this.upload.addEventListener('load',record);this.upload.addEventListener('abort',record);}return originalOpen.apply(this,args);};
  addEventListener('DOMContentLoaded',()=>{new MutationObserver(()=>{const text=document.querySelector('[data-izord-generator] > [role=status]')?.textContent;if(text&&window.__largeTransferNotices.at(-1)!==text)window.__largeTransferNotices.push(text);}).observe(document.body,{childList:true,subtree:true,characterData:true});});
 });
 page=await context.newPage();page.on('dialog',dialog=>dialog.accept());page.on('pageerror',error=>result.requests.push({event:'pageerror',message:sanitize(error.message)}));
 page.on('request',request=>{const url=new URL(request.url());if(['PUT','POST'].includes(request.method()))result.requests.push({event:'request',method:request.method(),path:url.pathname,at:new Date().toISOString()});});
 page.on('response',response=>{const url=new URL(response.url());if(url.pathname.startsWith('/storage/v1/object/upload/sign/')&&response.request().method()==='PUT')result.requests.push({event:'upload-response',status:response.status(),at:new Date().toISOString()});});
 await page.goto(app+'/izord');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Mot de passe',{exact:true}).fill(password);await page.getByRole('button',{name:'Se connecter',exact:true}).click();await page.locator('[data-izord-generator]').waitFor({timeout:30000});
 await page.getByLabel('Importer une fiche PDF',{exact:true}).setInputFiles(pdfFile);const dialog=page.getByRole('dialog',{name:'Vérification de la fiche PDF'});await dialog.waitFor({timeout:60000});await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Valider et créer la fiche projet'}).click();await dialog.waitFor({state:'hidden'});
 const title='Transfert fictif 25 Mo '+randomUUID().slice(0,8);await page.locator('#izord-project').fill(title);result.checks.push({name:'25,000,000-byte fictional PDF parsed and manually reviewed in actual UI',result:'passed'});
 const started=Date.now();await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await page.locator('[data-izord-generator] > [role=status]').filter({hasText:/^Enregistré · révision/}).waitFor({timeout:120000});result.transferAndSaveMs=Date.now()-started;
 const project=await ok(writer.from('izord_projects').select('*').eq('title',title).single());assert.equal(project.revision,2);assert.equal(project.payload.sourceDocuments.length,1);
 const asset=await ok(writer.from('izord_assets').select('*').eq('id',project.payload.sourceDocuments[0]).single());assert.equal(asset.lifecycle,'finalized');assert.equal(asset.expected_size,25_000_000);assert.equal(asset.expected_mime,'application/pdf');assert.equal(asset.project_revision,1);assert.ok(asset.storage_object_id&&asset.storage_object_version);
 const refs=await ok(writer.from('izord_generator_asset_refs').select('asset_id,project_revision,slot').eq('project_id',project.id));assert.deepEqual(refs,[{asset_id:asset.id,project_revision:2,slot:'source:0'}]);
 const version=await ok(writer.from('izord_project_versions').select('author_id,payload').eq('project_id',project.id).eq('revision',2).single());assert.equal(version.author_id,created.user.id);assert.deepEqual(version.payload,project.payload);
 const downloaded=await ok(writer.storage.from('izord-documents').download(asset.object_path));assert.equal(downloaded.size,25_000_000);assert.equal(hash(Buffer.from(await downloaded.arrayBuffer())),hash(input));
 result.checks.push({name:'Actual repository XHR direct upload, finalization, exact received bytes/hash and revision reference',result:'passed'});
 result.progress=await page.evaluate(()=>window.__largeTransferProgress);result.notices=await page.evaluate(()=>window.__largeTransferNotices);assert.ok(result.progress.some(event=>event.event==='progress'&&event.loaded>0&&event.lengthComputable));assert.ok(result.requests.some(event=>event.event==='upload-response'&&event.status===200));
 result.checks.push({name:'Native browser upload progression observed without synthetic events or throttling',result:'passed'});
 result.database={projectRevision:project.revision,assetRegisteredRevision:asset.project_revision,referenceRevision:2,finalized:true,expectedBytes:asset.expected_size,receivedBytes:downloaded.size,receivedSha256:hash(Buffer.from(await downloaded.arrayBuffer())),authorVerified:true};
 await page.screenshot({path:join(out,'large-transfer-saved.png'),fullPage:true,mask:[page.locator('[class*="identity"]')]});
 assert.equal(result.requests.some(event=>['remote-blocked','pageerror','unexpected-close'].includes(event.event)),false);
}catch(error){result.failure=sanitize(error?.stack||error);if(page&&!page.isClosed())result.pageState=sanitize(await page.locator('body').innerText()).slice(0,5000);process.exitCode=1;}
finally{result.finishedAt=new Date().toISOString();writeFileSync(join(out,'result-before-cleanup.json'),JSON.stringify(result,null,2));expectedClose=true;if(browser)await browser.close();for(const client of [admin,authAdmin,writer])client.auth.stopAutoRefresh();writeFileSync(join(out,'results.json'),JSON.stringify({...result,cleanup:'Only this isolated browser closed. Fictional project/account/assets and private PDF fixture retained; no volume deletion.'},null,2));console.log(JSON.stringify({checks:result.checks.length,failure:result.failure,progressEvents:result.progress.length,output:join(out,'results.json')}));}
