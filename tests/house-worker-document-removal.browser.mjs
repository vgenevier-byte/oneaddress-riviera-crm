/** Targeted local UI test only: simulated Auth/REST, fictional records, no database or provider calls. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import ts from 'typescript';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin=process.env.HOUSE_REMOVAL_URL||'http://127.0.0.1:3193',out=process.env.HOUSE_REMOVAL_ARTIFACTS||'/private/tmp/oar-house-worker-document-removal-ui';
assert(['127.0.0.1','localhost'].includes(new URL(origin).hostname),'Only loopback UI allowed');mkdirSync(out,{recursive:true,mode:0o700});
const clone=value=>JSON.parse(JSON.stringify(value)),results=[];
const source=readFileSync(resolve('components/CRMApp.tsx'),'utf8');
const start=source.indexOf('function normalizeHouseTrackingWorker('),end=source.indexOf('\nfunction normalizeHouseTimeEntry(',start);
assert(start>0&&end>start);const normalize=new Function('makeId',ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText+';return normalizeHouseTrackingWorker;')(()=>{throw Error('Known identities must remain');});
const original={id:'worker-active',contactId:'contact-a',contactName:'Clément fictif',role:'Entretien',hourlyRate:20,status:'Actif',notes:'Notes fictives',createdAt:'2026-01-01T00:00:00Z',createdBy:'historical-actor',updatedAt:'2026-02-01T00:00:00Z',updatedBy:'historical-editor',documentUrl:'https://example.invalid/fictional-old.pdf',documentStoragePath:'oneaddress-riviera/house-workers/worker-active/old.pdf',documentFileName:'FICTIONAL_OLD_WORKER.pdf',documentUploadedAt:'2026-01-01',storagePath:'fictional-alias-path',fileName:'FICTIONAL_ALIAS.pdf',uploadedAt:'2025-01-01',documentOldReference:{preserve:true}};
const docKey=key=>key.startsWith('document')||['storagePath','fileName','uploadedAt'].includes(key);
assert.deepEqual(clone(normalize(original)),original,'Existing references and ordinary worker fields remain exact before confirmed cleanup');
const cleaned=Object.fromEntries(Object.entries(original).filter(([key])=>!docKey(key)));assert.deepEqual(clone(normalize(cleaned)),cleaned,'Cleaned rows never recreate blank or aliased document references');
for(const [input,expected]of [[0,0],['18,75',18.75],['',undefined],[null,undefined],['invalid',undefined]])assert.equal(normalize({...cleaned,hourlyRate:input}).hourlyRate,expected);
results.push({name:'normalizer preserves present references, cleared rows and hourly-rate distinctions',passed:true});
const modules=['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats','izord','publisher','monthlyCharges'];
const initial=()=>{
 const payload=Object.fromEntries(['contacts','leads','tasks','suppliers','properties','vehicles','boats','planningEntries','quotes','documents','vendorQuotes','vendorInvoices','houseTrackingHouses','houseTrackingWorkers','houseTimeEntries','housePayments'].map(key=>[key,[]]));
 payload.contacts=['b','a'].map(key=>({id:'contact-'+key,firstName:'Clément',name:'fictif',kind:'Membre de l’organisation',organizationFunction:'Entretien',email:'contact-'+key+'@example.invalid',phone:'',city:'',notes:'Contact fictif '+key}));
 payload.houseTrackingHouses=[{id:'house-fictional',name:'Maison fictive',address:'Adresse fictive',notes:'',createdAt:original.createdAt}];
 payload.houseTrackingWorkers=[clone(original),{...clone(original),id:'worker-archived',contactId:'contact-b',status:'Inactif',hourlyRate:0,documentFileName:'FICTIONAL_ARCHIVED_WORKER.pdf'}];
 for(const id of ['active','archived']){
  payload.houseTimeEntries.push({id:'hours-'+id,houseId:'house-fictional',houseName:'Maison fictive',workerId:'worker-'+id,workerName:'Clément fictif',date:'2026-10-05',startTime:'08:07',endTime:'12:42',breakMinutes:15,hourlyRate:19.25,note:'Historique fictif',createdAt:original.createdAt});
  payload.housePayments.push({id:'payment-'+id,houseId:'house-fictional',houseName:'Maison fictive',workerId:'worker-'+id,workerName:'Clément fictif',date:'2026-10-05',amount:20,method:'Virement',note:'Paiement fictif',createdAt:original.createdAt});
 }
 return payload;
};
async function setup(browser,profile,width){
 const owner=profile==='owner',hasContacts=profile!=='house-only',context=await browser.newContext({viewport:{width,height:1000},locale:'fr-FR'});
 const state={payload:initial(),revision:'2026-10-06T00:00:00.000Z',blocked:[],requests:[],mutations:[]};
 const grants=Object.fromEntries(modules.map(module=>[module,{level:owner?'contribute':module==='houseTracking'||(hasContacts&&module==='contacts')?'contribute':'none',sensitive:owner?{delete:true,export:true}:{}}]));
 const access={revision:1,active:true,generalAdmin:owner,fullAccess:owner,modules:grants};
 const user={id:owner?'00000000-0000-4000-8000-000000000001':'00000000-0000-4000-8000-000000000002',aud:'authenticated',role:'authenticated',email:owner?'vg@oneaddressriviera.com':profile+'@example.invalid',email_confirmed_at:original.createdAt,app_metadata:{},user_metadata:{},identities:[],created_at:original.createdAt};
 const token=[Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,role:'authenticated',aud:'authenticated',email:user.email,exp:4102444800})).toString('base64url'),'fictional-ui-signature'].join('.');
 const nextRevision=()=>state.revision=new Date(Date.parse(state.revision)+1000).toISOString();
 const projected=(module)=>({revision:state.revision,collections:module==='contacts'?{contacts:clone(state.payload.contacts)}:Object.fromEntries(['houseTrackingHouses','houseTrackingWorkers','houseTimeEntries','housePayments'].map(key=>[key,clone(state.payload[key]).map(row=>{if(!owner)delete row.notes;if(!hasContacts)delete row.contactId;return row;})]))});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  const respond=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)});
  if(url.origin==='http://127.0.0.1:3997'){
   if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
   state.requests.push({path,method:request.method(),body:request.postDataJSON()});
   if(path==='/auth/v1/token')return respond({access_token:token,refresh_token:'fictional-ui-refresh',token_type:'bearer',expires_in:31536000,user});
   if(path==='/auth/v1/user')return respond(user);
   if(path==='/auth/v1/logout')return respond({});
   if(path==='/rest/v1/app_memberships')return respond([{workspace_id:'oar',role:'member'}]);
   if(path==='/rest/v1/crm_workspace_state'){
    assert(owner,'Restricted profile must never request a global payload');
    if(request.method()==='GET')return respond({payload:state.payload,updated_at:state.revision});
    assert.equal(request.method(),'PATCH');const body=request.postDataJSON();state.mutations.push({kind:'global-save',payload:clone(body.payload)});state.payload=body.payload;return respond({updated_at:nextRevision()});
   }
   const name=path.split('/rest/v1/rpc/')[1],body=request.postDataJSON()||{};
   if(name==='crm_access_snapshot')return respond(access);
   if(name==='crm_read_module')return respond(projected(body.p_module));
   if(name==='crm_reference_options'){assert(hasContacts,'No Contact reference payload without rights');return respond(body.p_module==='contacts'?{contacts:clone(state.payload.contacts)}:{});}
   if(name==='crm_contact_documents')return respond({revision:'2',documents:[]});
   if(name==='crm_update_house_worker'){
    const worker=state.payload.houseTrackingWorkers.find(row=>row.id===body.p_id);assert(worker);assert.deepEqual(Object.keys(body.p_patch).sort(),owner?['hourlyRate','notes']:['hourlyRate']);state.mutations.push({kind:name,body:clone(body)});Object.assign(worker,body.p_patch,{updatedAt:nextRevision(),updatedBy:user.id});return respond(owner?{worker:clone(worker),workspaceRevision:state.revision}:projected('houseTracking'));
   }
   if(name==='crm_mutate_record'){
    assert.equal(body.p_module,'houseTracking');assert.equal(body.p_collection,'houseTrackingWorkers');assert(!Object.keys(body.p_patch).some(docKey),'Creation must not carry document metadata');state.mutations.push({kind:name,body:clone(body)});const row=state.payload.houseTrackingWorkers.find(row=>row.id===body.p_id);if(row)Object.assign(row,body.p_patch);else state.payload.houseTrackingWorkers.unshift({id:body.p_id,...body.p_patch});nextRevision();return respond(projected('houseTracking'));
   }
   state.blocked.push(request.method()+' '+path);return route.abort();
  }
  if(url.origin===origin&&!path.startsWith('/api/'))return route.continue();
  if(['data:','blob:'].includes(url.protocol))return route.continue();
  state.blocked.push(request.method()+' '+url.origin+path);return route.abort();
 });
 if(context.routeWebSocket)await context.routeWebSocket('**',socket=>{const url=new URL(socket.url()),app=new URL(origin);if(url.hostname===app.hostname&&url.port===app.port)socket.connectToServer();else socket.close();});
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 try{await page.goto(origin+'/?module=houseTracking');await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Mot de passe',{exact:true}).fill('Fictional-UI-only!');await page.getByRole('button',{name:'Se connecter',exact:true}).click();await page.getByRole('navigation',{name:'Navigation suivi maison',exact:true}).waitFor({timeout:90000});}
 catch(error){await page.screenshot({path:join(out,profile+'-'+width+'-startup-failure.png')});writeFileSync(join(out,'startup-failure.json'),JSON.stringify({profile,width,error:String(error),errors,blocked:state.blocked,requests:state.requests,text:await page.locator('body').innerText()},null,2));throw error;}
 return {context,page,state,errors,owner,hasContacts,profile,width};
}
const settings=async page=>{await page.getByRole('navigation',{name:'Navigation suivi maison',exact:true}).getByRole('button',{name:'Réglages',exact:true}).click();await page.getByRole('heading',{name:'Intervenants actifs',exact:true}).waitFor();};
const activeRow=page=>page.locator('[data-notification-target="house-worker-worker-active"]');
const archivedRow=page=>page.locator('[data-notification-target="house-worker-worker-archived"]');
async function assertNoDocument(page){assert.equal(await page.locator('input[type="file"],input[name="documentFile"]').count(),0);assert.equal(await page.getByText(/FICTIONAL_(OLD|ARCHIVED|ALIAS)_WORKER?\.pdf|FICTIONAL_ALIAS\.pdf|Télécharger document|Document :/).count(),0);assert.equal(await page.getByLabel('Document',{exact:true}).count(),0);}
async function reopen(f){await f.page.goto(origin+'/?module=houseTracking');await f.page.getByRole('navigation',{name:'Navigation suivi maison',exact:true}).waitFor();await settings(f.page);}
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 for(const [profile,width]of [['owner',1440],['contacts',1440],['house-only',1440],['owner',390],['contacts',390]]){
  const f=await setup(browser,profile,width),{page,state}=f;
  try{
   await settings(page);await page.locator('details.house-archived-workers').getByText('Intervenants archivés (1)',{exact:true}).click();await archivedRow(page).waitFor();await assertNoDocument(page);
   if(!f.hasContacts){assert.equal(await page.getByRole('button',{name:'Ouvrir la fiche contact',exact:true}).count(),0);assert(!state.requests.some(request=>request.path.endsWith('crm_reference_options')));}
   else{
    await activeRow(page).getByRole('button',{name:'Ouvrir la fiche contact',exact:true}).click();await page.locator('#contact-detail-panel').waitFor();assert.equal(await page.locator('#contact-detail-panel').getByText('contact-a@example.invalid',{exact:true}).count(),1);assert.equal(await page.locator('#contact-detail-panel').getByText('contact-b@example.invalid',{exact:true}).count(),0);
    await reopen(f);await page.locator('details.house-archived-workers').getByText('Intervenants archivés (1)',{exact:true}).click();await archivedRow(page).getByRole('button',{name:'Ouvrir la fiche contact',exact:true}).click();await page.locator('#contact-detail-panel').waitFor();assert.equal(await page.locator('#contact-detail-panel').getByText('contact-b@example.invalid',{exact:true}).count(),1);
    await reopen(f);await activeRow(page).getByRole('button',{name:'Modifier',exact:true}).click();const editor=page.getByRole('region',{name:'Modifier Clément fictif',exact:true});await editor.waitFor();await assertNoDocument(page);await editor.getByLabel('Taux horaire par défaut').fill('24,75');if(f.owner)await editor.getByLabel(/^Notes/).fill('Nouvelle note fictive');
    const before=clone(state.payload),historic=clone({hours:before.houseTimeEntries,payments:before.housePayments,houses:before.houseTrackingHouses});await editor.getByRole('button',{name:'Enregistrer',exact:true}).click();await editor.waitFor({state:'hidden'});assert.equal(state.payload.houseTrackingWorkers.find(row=>row.id==='worker-active').hourlyRate,24.75);assert.deepEqual({hours:state.payload.houseTimeEntries,payments:state.payload.housePayments,houses:state.payload.houseTrackingHouses},historic);
    const after=state.payload.houseTrackingWorkers.find(row=>row.id==='worker-active'),old=before.houseTrackingWorkers.find(row=>row.id==='worker-active');for(const key of Object.keys(old))if(!['hourlyRate','notes','updatedAt','updatedBy'].includes(key))assert.deepEqual(after[key],old[key],key+' preserved during ordinary edit');
    await page.reload();await page.getByRole('navigation',{name:'Navigation suivi maison',exact:true}).waitFor();await settings(page);await assertNoDocument(page);await activeRow(page).getByRole('button',{name:'Modifier',exact:true}).click();const reloaded=page.getByRole('region',{name:'Modifier Clément fictif',exact:true});assert.equal(await reloaded.getByLabel('Taux horaire par défaut').inputValue(),'24.75');await reloaded.getByRole('button',{name:'Annuler',exact:true}).click();
    const form=page.locator('form').filter({has:page.getByRole('button',{name:'Ajouter l’intervenant',exact:true})}),option=await page.locator('#house-contact-options option').evaluateAll(options=>options.find(option=>option.value.includes('contact-a@example.invalid')).value);await form.getByLabel('Contact CRM',{exact:true}).fill(option);await form.getByLabel('Taux horaire',{exact:true}).fill('0');if(f.owner)await form.getByLabel('Notes',{exact:true}).fill('Création fictive');const count=state.payload.houseTrackingWorkers.length;await form.getByRole('button',{name:'Ajouter l’intervenant',exact:true}).click();await page.waitForFunction(count=>document.querySelectorAll('[data-notification-target^="house-worker-"]').length>=count,count+1);
    await page.waitForTimeout(f.owner?1900:300);assert.equal(state.payload.houseTrackingWorkers.length,count+1);const created=state.payload.houseTrackingWorkers.find(row=>!before.houseTrackingWorkers.some(old=>old.id===row.id));assert(created);assert.equal(created.contactId,'contact-a');assert.equal(created.hourlyRate,0);assert(!Object.keys(created).some(docKey));assert.deepEqual({hours:state.payload.houseTimeEntries,payments:state.payload.housePayments,houses:state.payload.houseTrackingHouses},historic);
   }
   // Simulate only the response of an already-confirmed cleanup; no purge request is made.
   state.payload.houseTrackingWorkers=state.payload.houseTrackingWorkers.map(worker=>Object.fromEntries(Object.entries(worker).filter(([key])=>!docKey(key))));await page.reload();await page.getByRole('navigation',{name:'Navigation suivi maison',exact:true}).waitFor();await settings(page);await assertNoDocument(page);assert(state.payload.houseTrackingWorkers.every(worker=>!Object.keys(worker).some(docKey)));
   await page.locator('details.house-archived-workers').getByText('Intervenants archivés (1)',{exact:true}).click();await archivedRow(page).waitFor();await page.screenshot({path:join(out,profile+'-'+width+'.png'),fullPage:false});await archivedRow(page).screenshot({path:join(out,profile+'-'+width+'-archived.png')});
   assert.deepEqual(state.blocked,[],'No remote/provider/Storage request');assert.deepEqual(f.errors,[],'No browser runtime error');assert(!state.requests.some(request=>request.path.includes('/storage/')||request.path.endsWith('crm_new_document')));if(!f.owner)assert(!state.requests.some(request=>request.path==='/rest/v1/crm_workspace_state'));
   results.push({name:profile+' '+width+' creation/edit/reload/archived/contact-rights/history',passed:true,browserVersion:browser.version(),simulatedAuthentication:true,simulatedREST:true,realAuth:false,remoteRequests:0});console.log('PASS '+profile+' '+width);
  }catch(error){await page.screenshot({path:join(out,profile+'-'+width+'-failure.png'),fullPage:false});writeFileSync(join(out,'failure.json'),JSON.stringify({profile,width,error:String(error),blocked:state.blocked,errors:f.errors,requests:state.requests},null,2));throw error;}
  finally{await f.context.close();}
 }
}finally{await browser.close();writeFileSync(join(out,'results.json'),JSON.stringify({passed:results.length===6,groups:results.length,results,boundary:'simulated Auth/REST; fictional local records; no database or provider calls'},null,2));}
console.log(JSON.stringify({groups:results.length,passed:results.length===6,artifacts:out}));
