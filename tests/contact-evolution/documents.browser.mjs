/** Actual local Auth/Storage/browser; only a failed upload response is injected. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Client} from 'pg';
import {assertLocalTarget} from '../izord/local-target.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const status=JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE,'utf8'));
const fixture=JSON.parse(readFileSync(process.env.CONTACT_EVOLUTION_FIXTURE||'/private/tmp/oar-contact-evolution-fixture.private.json','utf8'));
const manifest=JSON.parse(readFileSync(process.env.CONTACT_EVOLUTION_MANIFEST,'utf8'));
assertLocalTarget({api:status.API_URL,database:status.DB_URL,app:'http://127.0.0.1:3159',mail:'http://127.0.0.1:55434',acknowledgement:process.env.IZORD_TEST_ACK});
assert.equal(manifest.app,'http://127.0.0.1:3190');assert.equal(manifest.status,'ready');
for(const source of manifest.sourceFiles)assert.equal(createHash('sha256').update(readFileSync(source.path)).digest('hex'),source.sha256,'Current source must match the review server: '+source.path);
for(const user of Object.values(fixture.users))assert.ok(user.email.endsWith('@example.invalid'));
const api=new URL(status.API_URL).origin,app=manifest.app;
const output=process.env.CONTACT_EVOLUTION_OUTPUT||'docs/contact-evolution';
mkdirSync(join(output,'captures'),{recursive:true});
const sql=new Client({connectionString:status.DB_URL});await sql.connect();
assert.equal((await sql.query("select count(*)::int n from auth.users where email not like '%@example.invalid'")).rows[0].n,0);
const owner=fixture.users.owner,depositor=fixture.users.depositor,other=fixture.users.other;
const results=[],contexts=[];const browser=await chromium.launch({headless:true,channel:'chrome'});
const run=randomUUID(),contactId='browser-docs-'+run,title='Contact pièces fictives '+run.slice(0,8);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
async function rpc(user,name,args={}){
 const response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+user.token,'Content-Type':'application/json'},body:JSON.stringify(args)});
 const data=await response.json().catch(()=>null);assert.ok(response.ok,name+': '+JSON.stringify(data));return data;
}
const list=user=>rpc(user,'crm_contact_documents',{p_contact:contactId});
async function payloadContact(){return (await sql.query("select r from crm_workspace_state w cross join lateral jsonb_array_elements(w.payload->'contacts') r where w.workspace_id='oneaddress-riviera' and r->>'id'=$1",[contactId])).rows[0].r;}
async function open(user,width=1440){
 const context=await browser.newContext({viewport:{width,height:1000},locale:'fr-FR',timezoneId:'Europe/Paris'});contexts.push(context);
 const audit={blocked:[],errors:[],globalReads:[],uploads:0};
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(![app,api].includes(url.origin)&&!['data:','blob:'].includes(url.protocol)){audit.blocked.push(url.origin+url.pathname);return route.abort();}if(url.pathname==='/rest/v1/crm_workspace_state')audit.globalReads.push(route.request().method());return route.continue();});
 const page=await context.newPage();page.on('pageerror',error=>audit.errors.push(error.message));
 await page.goto(app+'/?module=contacts');await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Mot de passe',{exact:true}).fill(user.password);await page.getByRole('button',{name:'Se connecter',exact:true}).click();
 await page.locator('.oar-contact-row').filter({has:page.getByRole('heading',{name:title,exact:true})}).getByRole('button',{name:'Détails',exact:true}).click({timeout:30000});
 const panel=page.locator('#contact-detail-panel'),section=panel.locator('[data-contact-documents]');
 await section.getByRole('button',{name:'Recharger la liste',exact:true}).waitFor();
 await section.getByText(/Aucun document accessible|Privé · propriétaire/).first().waitFor();
 return {context,page,panel,section,audit};
}
async function pass(name,fn){await fn();results.push({name,passed:true});console.log('PASS '+name);}
const card=(f,name)=>f.section.locator('[data-contact-document]').filter({has:f.page.getByRole('heading',{name,exact:true})});
async function clean(f,restricted=false){assert.deepEqual(f.audit.blocked,[]);assert.deepEqual(f.audit.errors,[]);if(restricted)assert.deepEqual(f.audit.globalReads,[],'Restricted user must never receive the global workspace');}
async function deniedFile(user,resource,download=false){const response=await fetch(app+'/api/contact-documents/file?resource='+encodeURIComponent(resource)+(download?'&download=1':''),{headers:{Authorization:'Bearer '+user.token}});assert.ok(response.status>=400);const text=await response.text();assert.ok(!text.includes('piece.png'));}

try{
 const projection=await rpc(owner,'crm_read_module',{p_module:'contacts'});
 await rpc(owner,'crm_mutate_record',{p_module:'contacts',p_collection:'contacts',p_id:contactId,p_patch:{name:title,kind:'Membre de l’organisation',organizationFunction:'Équipe fictive'},p_revision:projection.revision});
 const f=await open(depositor);let inject=true,uploadNumber=0;
 await f.context.route('**/storage/v1/object/crm-documents/**',route=>{if(route.request().method()==='POST'&&++uploadNumber===2&&inject){inject=false;return route.abort('failed');}return route.continue();});
 const before=await payloadContact();
 await pass('Multiple homonymous personal imports distinguish confirmation and failure; retry does not duplicate successes',async()=>{
  await f.section.getByLabel('Choisir plusieurs fichiers',{exact:true}).setInputFiles([{name:'piece.png',mimeType:'image/png',buffer:png},{name:'piece.png',mimeType:'image/png',buffer:png}]);
  const fields=f.section.locator('fieldset');await fields.nth(0).getByRole('combobox').selectOption('Carte d’identité');await fields.nth(1).getByRole('combobox').selectOption('Carte d’identité');
  await fields.nth(0).getByLabel('Intitulé piece.png',{exact:true}).fill('Recto fictif');await fields.nth(1).getByLabel('Intitulé piece.png',{exact:true}).fill('Verso fictif');
  await fields.nth(0).locator('input[type=date]').fill('2030-10-06');
  await f.section.getByRole('button',{name:'Ajouter les fichiers sélectionnés',exact:true}).click();
  await f.section.getByText('1 fichier confirmé · 1 échec à reprendre.',{exact:true}).waitFor({timeout:30000});
  assert.equal((await list(depositor)).documents.length,1);
  await f.section.getByRole('button',{name:'Reprendre les fichiers non confirmés',exact:true}).click();
  await card(f,'Verso fictif').waitFor({timeout:30000});
  const documents=(await list(depositor)).documents;assert.equal(documents.length,2);assert.equal(new Set(documents.map(d=>d.resource_id)).size,2);
  assert.ok(documents.every(d=>d.file_name==='piece.png'&&!d.bank&&d.created_by===depositor.id&&d.created_at));
  assert.equal(documents.find(d=>d.title==='Recto fictif').expires_on,'2030-10-06');
  assert.deepEqual(await payloadContact(),before,'Document additions must not write the contact record');
 });
 await pass('Later addition, reload, cancellation of selection, and desktop preview/download use real bytes',async()=>{
  await f.section.getByLabel('Choisir plusieurs fichiers',{exact:true}).setInputFiles({name:'piece.png',mimeType:'image/png',buffer:png});
  await f.section.getByLabel('Intitulé piece.png',{exact:true}).last().fill('Ajout ultérieur fictif');
  await f.section.getByRole('button',{name:'Ajouter les fichiers sélectionnés',exact:true}).click();
  await card(f,'Ajout ultérieur fictif').waitFor({timeout:30000});
  await f.page.reload();
  await f.page.locator('.oar-contact-row').filter({has:f.page.getByRole('heading',{name:title,exact:true})}).getByRole('button',{name:'Détails',exact:true}).click();
  await card(f,'Recto fictif').getByRole('button',{name:'Aperçu',exact:true}).click();
  const dialog=f.page.getByRole('dialog',{name:'Recto fictif',exact:true});await dialog.waitFor();assert.equal(await dialog.locator('iframe').count(),1);await dialog.getByRole('button',{name:'Fermer l’aperçu',exact:true}).click();
  const download=f.page.waitForEvent('download');await card(f,'Recto fictif').getByRole('button',{name:'Télécharger',exact:true}).click();const file=await download;assert.equal(file.suggestedFilename(),'piece.png');
  const path=await file.path();assert.deepEqual(readFileSync(path),png);
  await f.section.getByLabel('Choisir plusieurs fichiers',{exact:true}).setInputFiles({name:'annule.png',mimeType:'image/png',buffer:png});
  await f.section.getByRole('button',{name:'Retirer la sélection : annule.png',exact:true}).click();assert.equal((await list(depositor)).documents.length,3);
  await f.page.screenshot({path:join(output,'captures','documents-desktop-1440.png'),fullPage:true});
 });
 await pass('Explicit replacement preserves the previous bytes; individual retirement retains the file',async()=>{
  f.page.once('dialog',dialog=>dialog.accept());await card(f,'Recto fictif').getByLabel('Remplacer Recto fictif',{exact:true}).setInputFiles({name:'version.png',mimeType:'image/png',buffer:png});
  await f.section.getByRole('button',{name:'Ajouter les fichiers sélectionnés',exact:true}).click();
  await card(f,'Recto fictif').getByText(/Ancienne version/).waitFor({timeout:30000});
  let documents=(await list(depositor)).documents;const previous=documents.find(d=>d.title==='Recto fictif'&&d.lifecycle==='superseded');assert.ok(previous?.superseded_by);assert.equal(documents.length,4);
  assert.equal((await sql.query("select count(*)::int n from storage.objects where bucket_id='crm-documents' and name=any($1::text[])",[documents.map(d=>d.resource_id)])).rows[0].n,4);
  f.page.once('dialog',dialog=>dialog.accept());await card(f,'Ajout ultérieur fictif').getByRole('button',{name:'Mettre à la corbeille',exact:true}).click();
  await f.section.getByText('Document retiré et conservé dans la corbeille privée.',{exact:true}).waitFor();documents=(await list(depositor)).documents;assert.equal(documents.length,3);
  const retained=(await sql.query("select lifecycle from crm_document_scopes where personal_contact and record_id=$1 and title='Ajout ultérieur fictif'",[contactId])).rows[0];assert.equal(retained.lifecycle,'withdrawn');
 });
 const hidden=await open(other);
 await pass('Unauthorized collaborators see no personal file names, metadata, counters or direct bytes',async()=>{
  assert.equal((await list(other)).documents.length,0);assert.equal(await hidden.section.locator('[data-contact-document]').count(),0);
  const resource=(await list(depositor)).documents[0].resource_id;await deniedFile(other,resource);await deniedFile(other,resource,true);
  const docs=await rpc(other,'crm_read_module',{p_module:'documents'});assert.ok(!JSON.stringify(docs).includes('Recto fictif'));await clean(hidden,true);
 });
 await pass('Explicit sharing is read only; preview closes after revocation and new direct calls fail',async()=>{
  const resource=(await list(depositor)).documents.find(d=>d.title==='Verso fictif').resource_id;
  const manager=await open(owner);
  await card(manager,'Verso fictif').getByRole('button',{name:'Autorisations',exact:true}).click();
  const shareDialog=manager.page.getByRole('dialog',{name:'Autorisations · Verso fictif',exact:true});
  await shareDialog.getByRole('combobox').selectOption(other.id);await shareDialog.getByRole('button',{name:'Autoriser cette pièce',exact:true}).click();
  await manager.section.getByText('Autorisation explicite confirmée.',{exact:true}).waitFor();
  await hidden.section.getByRole('button',{name:'Recharger la liste',exact:true}).click();await card(hidden,'Verso fictif').waitFor();
  assert.equal(await card(hidden,'Verso fictif').getByRole('button',{name:'Mettre à la corbeille',exact:true}).count(),0);assert.equal(await card(hidden,'Verso fictif').locator('input[type=file]').count(),0);
  await card(hidden,'Verso fictif').getByRole('button',{name:'Aperçu',exact:true}).click();await hidden.page.getByRole('dialog',{name:'Verso fictif',exact:true}).waitFor();
  await card(manager,'Verso fictif').getByRole('button',{name:'Autorisations',exact:true}).click();await shareDialog.getByRole('button',{name:'Retirer l’autorisation',exact:true}).click();
  await manager.section.getByText('Autorisation retirée.',{exact:true}).waitFor();await clean(manager);
  await hidden.page.getByRole('dialog',{name:'Verso fictif',exact:true}).waitFor({state:'hidden',timeout:10000});await deniedFile(other,resource);assert.equal((await list(other)).documents.length,0);
 });
 await pass('Mobile contact documents render without horizontal overflow and retain the same private catalogue',async()=>{
  await f.page.setViewportSize({width:390,height:844});await f.section.getByRole('button',{name:'Recharger la liste',exact:true}).click();
  await card(f,'Verso fictif').waitFor();
  const dimensions=await f.page.evaluate(()=>({viewport:innerWidth,page:document.documentElement.scrollWidth,panel:document.querySelector('#contact-detail-panel').scrollWidth,width:document.querySelector('#contact-detail-panel').clientWidth}));
  assert.ok(dimensions.page<=dimensions.viewport,JSON.stringify(dimensions));assert.ok(dimensions.panel<=dimensions.width+1,JSON.stringify(dimensions));
  const metrics=await f.page.locator('.contacts-toolbar-stable-metrics').evaluate(node=>({display:getComputedStyle(node).display,labels:[...node.querySelectorAll('span')].map(label=>({text:label.textContent,width:label.clientWidth,content:label.scrollWidth}))}));
  assert.equal(metrics.display,'grid');assert.equal(metrics.labels.length,4);assert.ok(metrics.labels.every(label=>label.content<=label.width+1),JSON.stringify(metrics));
  await f.page.screenshot({path:join(output,'captures','documents-mobile-390.png'),fullPage:true});await clean(f,true);
 });
 await pass('Cancellation during a real upload retains confirmed documents and permits explicit resumption',async()=>{
  const countBefore=(await list(depositor)).documents.length;
  let release,observed;const gate=new Promise(resolve=>{release=resolve;}),reached=new Promise(resolve=>{observed=resolve;});let hold=true;
  await f.context.route('**/storage/v1/object/crm-documents/**',async route=>{if(hold&&route.request().method()==='POST'){hold=false;observed();await gate;}return route.continue();});
  await f.section.getByLabel('Choisir plusieurs fichiers',{exact:true}).setInputFiles({name:'annulation-en-cours.png',mimeType:'image/png',buffer:png});
  await f.section.getByLabel('Intitulé annulation-en-cours.png',{exact:true}).fill('Reprise après annulation fictive');
  await f.section.getByRole('button',{name:'Ajouter les fichiers sélectionnés',exact:true}).click();
  await Promise.race([reached,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Expected local upload')),10000))]);
  await f.section.getByRole('button',{name:'Annuler l’import',exact:true}).click();release();
  await f.section.getByText('Import interrompu. Les fichiers déjà confirmés sont conservés. Vérifiez la liste avant de reprendre.',{exact:true}).waitFor({timeout:30000});
  assert.equal((await list(depositor)).documents.length,countBefore);
  await f.section.getByRole('button',{name:'Ajouter les fichiers sélectionnés',exact:true}).click();await card(f,'Reprise après annulation fictive').waitFor({timeout:30000});
  assert.equal((await list(depositor)).documents.length,countBefore+1);await clean(f,true);
 });
 await pass('A concurrent catalogue addition yields a visible conflict and the same draft can be retried once',async()=>{
  const countBefore=(await list(depositor)).documents.length;
  await f.section.getByLabel('Choisir plusieurs fichiers',{exact:true}).setInputFiles({name:'conflit.png',mimeType:'image/png',buffer:png});
  await f.section.getByLabel('Intitulé conflit.png',{exact:true}).fill('Reprise conflit fictive');
  const current=await list(depositor),operation=randomUUID();
  const reserved=await rpc(depositor,'crm_contact_document_begin',{p_operation:operation,p_contact:contactId,p_title:'Ajout concurrent fictif',p_type:'Autre',p_filename:'concurrent.png',p_mime:'image/png',p_size:png.length,p_expiry:null,p_revision:current.revision});
  const upload=await fetch(api+'/storage/v1/object/crm-documents/'+reserved.resource_id,{method:'POST',headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+depositor.token,'Content-Type':'image/png'},body:png});assert.ok(upload.ok);
  await rpc(depositor,'crm_contact_document_complete',{p_operation:operation});
  await f.section.getByRole('button',{name:'Ajouter les fichiers sélectionnés',exact:true}).click();
  await f.section.getByText(/Conflit : le catalogue a changé/).waitFor({timeout:30000});assert.equal((await list(depositor)).documents.length,countBefore+1);
  await f.section.getByRole('button',{name:'Reprendre les fichiers non confirmés',exact:true}).click();await card(f,'Reprise conflit fictive').waitFor({timeout:30000});
  assert.equal((await list(depositor)).documents.length,countBefore+2);await clean(f,true);
 });
 await clean(hidden,true);
 writeFileSync(join(output,'documents-browser-results.json'),JSON.stringify({passed:true,environment:'real fictional local Auth/RPC/Storage/browser',results},null,2));
}finally{for(const context of contexts)await context.close();await browser.close();await sql.end();}
