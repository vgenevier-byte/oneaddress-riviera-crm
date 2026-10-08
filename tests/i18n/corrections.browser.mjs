import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createFixture,groups} from './fixture.mjs';

const require=createRequire(import.meta.url);
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin=process.env.I18N_ORIGIN||'http://127.0.0.1:3299';
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname),'Local fictional demonstration required');
const out=process.env.I18N_CORRECTIONS_OUT||'/Users/vg/.codex/visualizations/2026/10/08/01a11ab6-cbef-79a0-b529-bcd6a9662224/crm-bilingual/evidence/corrections/browser';
mkdirSync(out,{recursive:true});
const captures=process.env.I18N_CORRECTIONS_CAPTURES||'/Users/vg/.codex/visualizations/2026/10/08/01a11ab6-cbef-79a0-b529-bcd6a9662224/crm-bilingual/captures/corrections';
mkdirSync(captures,{recursive:true});
const results=[];
const secret='TECHNICAL_PRIVATE_DETAIL_DO_NOT_DISPLAY';
const countNames=['Zéro Exemple','Une Exemple','Deux Exemple'];
const countText={fr:['0 demande client liée','1 demande client liée','2 demandes clients liées'],en:['0 linked client enquiries','1 linked client enquiry','2 linked client enquiries']};
const messages={
 refused:{fr:'Enregistrement refusé. Vérifiez les champs et vos droits ; votre saisie est conservée.',en:'Save refused. Check the fields and your permissions; your input is retained.'},
 conflict:{fr:'Conflit : les données ont changé. Rechargez avant de reprendre.',en:'Conflict: the data has changed. Reload before continuing.'},
 hoursConflict:{fr:'Conflit : les données ont changé. Votre saisie est conservée ; rechargez avant de reprendre.',en:'Conflict: the data has changed. Your input is retained; reload before continuing.'},
 hoursUnconfirmed:{fr:'Enregistrement non confirmé. Votre saisie est conservée ; vérifiez la connexion et vos droits.',en:'Save unconfirmed. Your input is retained; check the connection and your permissions.'},
};
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};

/** The real integrated UI runs unchanged. Every Auth, REST and API request is
 * fulfilled locally. Deferred writes are captured, never forwarded or persisted.
 * Ordinary full-CRM Contacts saves are synchronous local edits; failure routing
 * is therefore exercised through the existing limited-account Contacts adapter.
 */
async function transport(context,profile){
 const fixture=createFixture(profile),requests=[],pending=[];
 fixture.payload.contacts.splice(0,0,...countNames.map((name,index)=>({...fixture.payload.contacts[1],id:`correction-contact-${index}`,name,firstName:'',email:`counter-${index}@example.invalid`,phone:'',notes:'Texte libre français conservé'})));
 fixture.payload.contacts.push({...fixture.payload.contacts[1],id:'correction-supplier',name:'Fournisseur Fictif',kind:'Prestataire',firstName:'',email:'supplier@example.invalid',supplierCategory:'Entretien',supplierStatus:'Actif',supplierReliability:'Fiable',supplierBankAccounts:[]});
 fixture.payload.leads=fixture.payload.contacts.filter(row=>countNames.includes(row.name)).flatMap((contact,index)=>Array.from({length:index},(_,leadIndex)=>({id:`correction-lead-${index}-${leadIndex}`,category:'Villa',contactName:contact.name,status:'Nouveau',value:5000,priority:'Moyenne',nextAction:'Rappeler en français',dueDate:'2026-10-15',notes:'Demande métier française'})));
 const project={id:'00000000-0000-4000-8000-000000009999',owner_id:fixture.user.id,title:'Dossier fictif — titre français',revision:3,status:'approved',created_at:'2026-10-08T10:00:00Z',updated_at:'2026-10-08T10:00:00Z',payload:null};
 const versions=['approved','review','draft'].map((status,index)=>({project_id:project.id,revision:3-index,title:project.title,status,author_id:`auteur-français-${3-index}`,created_at:'2026-10-08T10:00:00Z'}));
 async function fulfill(route,reply){return route.fulfill({status:reply.status,headers,contentType:'application/json',body:reply.body===null?'':JSON.stringify(reply.body)});}
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),localAPI=url.origin===origin&&url.pathname.startsWith('/api/');
  if(url.origin==='http://127.0.0.1:4097'||localAPI){
   if(request.method()==='OPTIONS')return fulfill(route,{status:204,body:null});
   let body={};try{body=request.postDataJSON()||{};}catch{/* Multipart fake upload is captured without logging its content. */}
   const rpc=url.pathname.split('/rest/v1/rpc/')[1];
   if(request.method()==='POST'&&(['crm_mutate_record','crm_create_house_time_entry','crm_update_house_worker'].includes(rpc)||url.pathname==='/api/drive/vendor-bank-accounts/upload')){
    const captured={endpoint:rpc||url.pathname,body:rpc?body:{multipart:true},response:null};requests.push(captured);
    const reply=await new Promise(resolve=>pending.push({captured,resolve}));captured.response=reply;
    return fulfill(route,reply);
   }
   if(url.pathname==='/rest/v1/izord_projects')return fulfill(route,{status:200,body:url.searchParams.has('id')?project:[project]});
   if(url.pathname==='/rest/v1/izord_project_versions')return fulfill(route,{status:200,body:versions});
   if(url.pathname==='/rest/v1/izord_assets')return fulfill(route,{status:200,body:[]});
   const reply=fixture.respond(request.method(),url,body);
   if(rpc==='crm_read_monthly_charges'){
    reply.body.sources.invoices.push({id:'correction-unattached',personId:'i18n-supplier',personLabel:'Fournisseur Démonstration',title:'Facture sans date — texte métier français',invoiceDate:'',amount:10,status:'À payer'});
   }
   return fulfill(route,reply);
  }
  if(url.origin===origin||['data:','blob:'].includes(url.protocol))return route.continue();
  fixture.audit.blocked.push(request.method()+' '+url.origin+url.pathname);return route.abort();
 });
 return {fixture,requests,
  async waiting(endpoint,count){const start=Date.now();while(!pending.some(row=>row.captured.endpoint===endpoint)||requests.filter(row=>row.endpoint===endpoint).length<count){if(Date.now()-start>12000)throw new Error('Expected deferred fictional request '+endpoint+' #'+count);await new Promise(resolve=>setTimeout(resolve,20));}return requests.filter(row=>row.endpoint===endpoint).at(-1);},
  release(endpoint,status,body){const index=pending.findIndex(row=>row.captured.endpoint===endpoint);assert.notEqual(index,-1);pending.splice(index,1)[0].resolve({status,body});},
  releaseAll(){for(const row of pending.splice(0))row.resolve({status:403,body:{message:'Fictional transport closed'}});},
 };
}

async function login(page,fixture){
 await page.goto(origin);await page.locator('input[type="email"]').fill(fixture.user.email);
 await page.locator('input[autocomplete="current-password"]').fill('Bilingual-Fictive-2026!');
 await page.locator('form button:not([type="button"])').first().click();
 await page.locator('.sidebar [data-navigation-module="contacts"]').waitFor({state:'attached'});
 await page.locator('.sidebar [data-navigation-group="services"]').waitFor({state:'attached'});
}
async function navigate(page,id){
 const group=groups.find(row=>row.modules.includes(id));
 if(group){const button=page.locator(`.sidebar [data-navigation-group="${group.id}"]`);if(await button.getAttribute('aria-expanded')!=='true')await button.click();}
 await page.locator(`.sidebar [data-navigation-module="${id}"]`).click();
 await page.waitForFunction(id=>document.querySelector(`.sidebar [data-navigation-module="${id}"]`)?.getAttribute('aria-current')==='page',id);
}
async function choose(page,language,evidence){
 const selector=page.locator('.sidebar [data-language-selector]').getByRole('button',{name:language==='en'?'English — EN':'Français — FR',exact:true});
 if(await page.getByRole('dialog').count()){
  // Native modal/inert backdrop prevents a normal sidebar click. Calling this
  // existing handler tests provider reactivity only; never claim clickability.
  await selector.evaluate(button=>button.click());
  evidence.programmaticModalLanguageChanges++;
 }else await selector.click();
 await page.waitForFunction(lang=>document.documentElement.lang===lang,language==='en'?'en-GB':'fr');
}
async function toggleWithoutSend(page,language,simulation,evidence){
 const before=simulation.requests.length,auth=simulation.fixture.audit.auth.length;
 await choose(page,language,evidence);assert.equal(simulation.requests.length,before,'Language switch sends no mutation or upload');assert.equal(simulation.fixture.audit.auth.length,auth,'Language switch performs no Auth operation');
}
function rowFor(page,name){return page.locator('.oar-contact-row').filter({has:page.getByRole('heading',{name,exact:true})});}
async function assertMessage(container,expected){await container.getByRole('alert').filter({hasText:expected}).first().waitFor();assert.ok((await container.textContent()).includes(expected));assert.equal((await container.textContent()).includes(secret),false,'Technical provider details stay hidden');}

async function mobileContacts(page,simulation,evidence,engine){
   const mobileRequestCount=simulation.requests.length;
   await navigate(page,'contacts');await page.setViewportSize({width:390,height:667});
   for(const language of ['fr','en']){
    await page.locator('#unified-more-trigger').click();const more=page.locator('.unified-more-panel');
    await more.locator('[data-language-selector]').getByRole('button',{name:language==='en'?'English — EN':'Français — FR',exact:true}).click();
    await page.waitForFunction(lang=>document.documentElement.lang===lang,language==='en'?'en-GB':'fr');
    await more.locator('.unified-more-close').click();
    for(let index=0;index<3;index++)assert.ok((await rowFor(page,countNames[index]).textContent()).includes(countText[language][index]),'Mobile list '+language+' count '+index);
    await page.locator('.contacts-list-card').screenshot({path:`${captures}/${engine}-mobile-contacts-counts-list-${language}.png`});
    for(let index=0;index<3;index++){
     await rowFor(page,countNames[index]).locator('[data-crm-action="details"]').click();const detail=page.getByRole('dialog');await detail.waitFor();
     assert.ok((await detail.textContent()).includes(countText[language][index]),'Mobile detail '+language+' count '+index);
     if(index===2)await detail.locator('.contact-related-section').screenshot({path:`${captures}/${engine}-mobile-contacts-two-detail-${language}.png`});
     await detail.locator('[data-crm-dismiss="true"]').click();
    }
   }
   assert.equal(simulation.requests.length,mobileRequestCount,'Mobile language changes and detail reads perform no business mutation');
   evidence.steps.push({name:'WebKit mobile Contacts list and detail plural verification',viewport:{width:390,height:667},counts:[0,1,2],languages:['fr','en'],normalMoreLanguageClicks:true,mutations:0});
}

for(const engine of process.env.I18N_ENGINE?[process.env.I18N_ENGINE]:['chromium','webkit']){
 const browser=await(engine==='chromium'?chromium.launch({headless:true,channel:'chrome'}):webkit.launch({headless:true}));
 const contexts=[],simulations=[],errors=[];
 const evidence={name:engine+'-focused-corrections',status:'running',browserVersion:browser.version(),viewport:{width:1440,height:1000},programmaticModalLanguageChanges:0,steps:[],proofBoundary:'Integrated browser UI with fictional Auth, reads and locally intercepted delayed failures/uploads. No real server/RLS/Auth/Drive or database proof. Newer-draft hook simulations are separate tests; pending controls are never unlocked.'};
 try{
  async function open(profile){const context=await browser.newContext({viewport:evidence.viewport});contexts.push(context);const simulation=await transport(context,profile);simulations.push(simulation);const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());await login(page,simulation.fixture);return {page,simulation};}
  const full=await open('full');const {page,simulation}=full;
  await navigate(page,'contacts');
  for(const language of ['fr','en']){
   await choose(page,language,evidence);
   for(let index=0;index<3;index++)assert.ok((await rowFor(page,countNames[index]).textContent()).includes(countText[language][index]),'List '+language+' count '+index);
   await page.locator('.contacts-list-card').screenshot({path:`${captures}/${engine}-contacts-counts-list-${language}.png`});
   for(let index=0;index<3;index++){
    await rowFor(page,countNames[index]).locator('[data-crm-action="details"]').click();
    const dialog=page.getByRole('dialog');await dialog.waitFor();
    assert.ok((await dialog.textContent()).includes(countText[language][index]),'Detail '+language+' count '+index);
    assert.equal((await dialog.textContent()).includes('leades'),false);
    if(index===2)await dialog.locator('.contact-related-section').screenshot({path:`${captures}/${engine}-contacts-two-detail-${language}.png`});
    await dialog.locator('[data-crm-dismiss="true"]').click();
   }
  }
  evidence.steps.push({name:'Contacts list and detail complete contextual plurals',counts:[0,1,2],languages:['fr','en'],businessNamesUnchanged:countNames,mutations:0});

  if(process.env.I18N_CONTACTS_ONLY==='1'){
   if(engine==='webkit')await mobileContacts(page,simulation,evidence,engine);
   assert.deepEqual(errors,[]);evidence.status='passed';continue;
  }

  await navigate(page,'houseTracking');await page.locator('.house-tabs button').nth(1).click();
  const hours=page.locator('.house-two-columns form').first();
  await hours.locator('select').nth(0).selectOption('i18n-house');await hours.locator('select').nth(1).selectOption('i18n-worker');
  await hours.locator('select').nth(2).selectOption('09:15');await hours.locator('select').nth(3).selectOption('11:30');
  const hourRate=hours.locator('input[inputmode="decimal"]'),note=hours.locator('input').last();
  await hourRate.fill('25');await note.fill('Brouillon français conservé après refus');
  const rateHandle=await hourRate.elementHandle(),noteHandle=await note.elementHandle();
  for(const [index,kind,backend]of [[1,'hoursConflict','revision_conflict'],[2,'hoursUnconfirmed',secret]]){
   await hours.locator('button[type="submit"]').click();const captured=await simulation.waiting('crm_create_house_time_entry',index);
   assert.equal(captured.body.p_patch.note,'Brouillon français conservé après refus');assert.equal(captured.body.p_patch.hourlyRate,25);
   assert.equal(await hourRate.isDisabled(),true,'Original pending fieldset locks rate');assert.equal(await note.isDisabled(),true,'Original pending fieldset locks note');
   await toggleWithoutSend(page,'fr',simulation,evidence);await toggleWithoutSend(page,'en',simulation,evidence);
   simulation.release('crm_create_house_time_entry',409,{code:kind==='hoursConflict'?'40001':'XX000',message:backend});
   await assertMessage(hours,messages[kind].en);
   for(const language of ['fr','en']){await toggleWithoutSend(page,language,simulation,evidence);await assertMessage(hours,messages[kind][language]);if(language==='fr')await hours.screenshot({path:`${captures}/${engine}-${kind}-fr.png`});assert.equal(await note.inputValue(),'Brouillon français conservé après refus');assert.equal(await rateHandle.evaluate(node=>node.isConnected),true);assert.equal(await noteHandle.evaluate(node=>node.isConnected),true);}
   await hours.screenshot({path:`${captures}/${engine}-${kind}-en.png`});
  }
  evidence.steps.push({name:'Real CRMApp hourConfirmation conflict and unconfirmed rendering FR/EN',delayedCalls:2,normalSubmit:true,pendingFieldsLocked:true,sameDOM:true,rawErrorHidden:true});
  await page.locator('.house-tabs button').nth(3).click();
  await page.locator('[data-notification-target="house-worker-i18n-worker"] .house-worker-actions').getByRole('button',{name:'Edit',exact:true}).click();
  const worker=page.locator('section').filter({has:page.getByRole('heading',{level:4,name:/Camille Fictive/})}).last();
  const workerRate=worker.locator('[name="hourlyRate"]');await workerRate.fill('not-a-rate');await worker.locator('button[type="submit"]').click();
  assert.equal(simulation.requests.filter(row=>row.endpoint==='crm_update_house_worker').length,0,'Client validation refuses without a request');
  await worker.getByRole('alert').waitFor();assert.match(await worker.getByRole('alert').textContent(),/valid hourly rate/);
  await workerRate.fill('27,50');await worker.locator('button[type="submit"]').click();
  const workerRequest=await simulation.waiting('crm_update_house_worker',1);assert.equal(workerRequest.body.p_patch.hourlyRate,27.5);
  assert.equal(await workerRate.isDisabled(),true);
  await worker.getByRole('button',{name:'Saving…',exact:true}).waitFor();
  await worker.screenshot({path:`${captures}/${engine}-worker-saving-en.png`});
  await toggleWithoutSend(page,'fr',simulation,evidence);await worker.getByRole('button',{name:'Enregistrement…',exact:true}).waitFor();await worker.screenshot({path:`${captures}/${engine}-worker-saving-fr.png`});
  await toggleWithoutSend(page,'en',simulation,evidence);assert.equal(await workerRate.inputValue(),'27,50');
  simulation.release('crm_update_house_worker',403,{message:secret});await worker.getByRole('alert').waitFor();
  evidence.steps.push({name:'HouseWorkerEditor real validation and delayed pending branch',rawRate:'27,50',canonicalRate:27.5,savingFR:'Enregistrement…',savingEN:'Saving…',pendingLocked:true,requests:1});

  await navigate(page,'contacts');await rowFor(page,'Fournisseur Fictif').locator('[data-crm-action="details"]').click();
  const contact=page.getByRole('dialog');await contact.waitFor();await contact.getByRole('button',{name:'+ Add bank details',exact:true}).click();
  const bank=page.locator('dialog.banking-dialog'),bankForm=bank.locator('form');await bank.waitFor();
  await bankForm.locator('[name="holder"]').fill('Fournisseur Fictif');await bankForm.locator('[name="iban"]').fill('FR1420041010050500013M02606');await bankForm.locator('[name="bic"]').fill('PSSTFRPPMON');
  await bankForm.locator('[name="file"]').setInputFiles({name:'RIB fictif.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nFICTITIOUS LOCAL FILE\n')});
  await bankForm.locator('button[type="submit"]').click();await simulation.waiting('/api/drive/vendor-bank-accounts/upload',1);
  await bankForm.getByRole('button',{name:'Saving…',exact:true}).waitFor();assert.equal(await bankForm.locator('button[type="submit"]').isDisabled(),true);
  await bank.screenshot({path:`${captures}/${engine}-bank-saving-en.png`});
  await toggleWithoutSend(page,'fr',simulation,evidence);await bankForm.getByRole('button',{name:'Enregistrement…',exact:true}).waitFor();await bank.screenshot({path:`${captures}/${engine}-bank-saving-fr.png`});await toggleWithoutSend(page,'en',simulation,evidence);await bankForm.getByRole('button',{name:'Saving…',exact:true}).waitFor();
  simulation.release('/api/drive/vendor-bank-accounts/upload',403,{error:secret});await bank.getByRole('alert').waitFor();assert.equal((await bank.textContent()).includes(secret),false);await bank.getByRole('button',{name:'Close',exact:true}).click();await contact.locator('[data-crm-dismiss="true"]').click();
  evidence.steps.push({name:'VendorBanking actual busy branch from delayed fictional file upload',savingFR:'Enregistrement…',savingEN:'Saving…',uploadsIntercepted:1,fileContentForwarded:false,normalSidebarClickWhileModal:false});

  await navigate(page,'monthlyCharges');
  const unattached=page.locator('details').filter({has:page.locator('summary').filter({hasText:/Unallocated/})});
  await unattached.locator('summary').click();const invoice=page.locator('details[open] article').filter({hasText:'Facture sans date — texte métier français'});await invoice.waitFor();
  assert.ok((await invoice.textContent()).includes('Unallocated'));assert.equal((await invoice.textContent()).includes('À rattacher'),false);
  await invoice.screenshot({path:`${captures}/${engine}-charges-unattached-en.png`});
  await toggleWithoutSend(page,'fr',simulation,evidence);assert.ok((await invoice.textContent()).includes('À rattacher'));await invoice.screenshot({path:`${captures}/${engine}-charges-unattached-fr.png`});
  evidence.steps.push({name:'Monthly charges missing retainedMonth fallback FR/EN',sourceDate:'',businessTitle:'Facture sans date — texte métier français',mutations:0});

  await choose(page,'en',evidence);await navigate(page,'izord');
  await page.getByRole('button',{name:'Open Dossier fictif — titre français',exact:true}).click();
  const history=page.locator('[data-izord-generator] details').filter({hasText:'auteur-français-1'});await history.locator('summary').click();
  const english=await history.textContent();assert.match(english,/Approved/);assert.match(english,/Under review/);assert.match(english,/Draft/);for(let revision=1;revision<=3;revision++)assert.ok(english.includes(`auteur-français-${revision}`));
  await history.screenshot({path:`${captures}/${engine}-izord-history-en.png`});await toggleWithoutSend(page,'fr',simulation,evidence);const french=await history.textContent();assert.match(french,/Approuvé/);assert.match(french,/En revue/);assert.match(french,/Brouillon/);await history.screenshot({path:`${captures}/${engine}-izord-history-fr.png`});
  evidence.steps.push({name:'IZORD actual version history statuses FR/EN',statuses:['draft','review','approved'],authorFreeTextUnchanged:true,writeRequests:0});

  const limited=await open('limited');await choose(limited.page,'en',evidence);await navigate(limited.page,'contacts');
  const creation=limited.page.locator('.contact-create-form');await creation.locator('[name="name"]').fill('Création fictive — saisie française conservée');
  await creation.locator('button[type="submit"]').click();await limited.simulation.waiting('crm_mutate_record',1);assert.equal(await creation.locator('[name="name"]').isDisabled(),true);
  await toggleWithoutSend(limited.page,'fr',limited.simulation,evidence);limited.simulation.release('crm_mutate_record',403,{code:'42501',message:secret});await assertMessage(creation,messages.refused.fr);await creation.screenshot({path:`${captures}/${engine}-contact-create-refused-fr.png`});await toggleWithoutSend(limited.page,'en',limited.simulation,evidence);await assertMessage(creation,messages.refused.en);assert.equal(await creation.locator('[name="name"]').inputValue(),'Création fictive — saisie française conservée');
  await creation.screenshot({path:`${captures}/${engine}-contact-create-refused-en.png`});
  await rowFor(limited.page,'Une Exemple').getByRole('button',{name:'Edit',exact:true}).click();const editing=limited.page.locator('#contact-edit-panel');await editing.waitFor();await editing.locator('[name="name"]').fill('Modification française conservée');
  await editing.locator('button[type="submit"]').click();await limited.simulation.waiting('crm_mutate_record',2);assert.equal(await editing.locator('[name="name"]').isDisabled(),true);
  limited.simulation.release('crm_mutate_record',409,{code:'40001',message:'revision_conflict'});await assertMessage(editing,messages.conflict.en);await toggleWithoutSend(limited.page,'fr',limited.simulation,evidence);await assertMessage(editing,messages.conflict.fr);await editing.screenshot({path:`${captures}/${engine}-contact-edit-conflict-fr.png`});await toggleWithoutSend(limited.page,'en',limited.simulation,evidence);await assertMessage(editing,messages.conflict.en);assert.equal(await editing.locator('[name="name"]').inputValue(),'Modification française conservée');
  await editing.screenshot({path:`${captures}/${engine}-contact-edit-conflict-en.png`});
  evidence.steps.push({name:'Actual limited-account Contact creation refusal and edition conflict, translated inline',calls:2,pendingFieldsLocked:true,draftsRetained:true,technicalDetailHidden:true,usesExistingAdapter:true});
  if(engine==='webkit')await mobileContacts(page,simulation,evidence,engine);
  assert.deepEqual(errors,[],'No unhandled browser errors');
  // The unchanged base fixture classifies every non-whitelisted POST as a write.
  // crm_contact_documents is a read RPC used by the ordinary detail view; its
  // blocked attempts remain visible verbatim, never zeroed or called writes.
  for(const item of simulations)assert.deepEqual(item.fixture.audit.writes.filter(path=>path!=='POST /rest/v1/rpc/crm_contact_documents'),[],'Only the known contact-document read RPC may reach the base fixture POST refusal');
  evidence.status='passed';evidence.pageErrors=errors;
 }catch(error){evidence.status='failed';evidence.error=error.stack;evidence.pageErrors=errors;for(const context of contexts){const page=context.pages()[0];if(page)await page.screenshot({path:`${captures}/${engine}-failure-${contexts.indexOf(context)}.png`}).catch(()=>{});}}
 finally{evidence.audit=simulations.map(item=>({profile:item.fixture.profile,capturedFictionalRequests:item.requests,baseFixtureBlockedAttempts:item.fixture.audit.blocked,baseFixturePostRefusals:item.fixture.audit.writes,knownBlockedReadRpc:'POST /rest/v1/rpc/crm_contact_documents',writesForwardedToRealServer:0}));for(const item of simulations)item.releaseAll();for(const context of contexts)await context.close();await browser.close();evidence.screenshots=readdirSync(captures).filter(name=>name.startsWith(engine+'-')&&name.endsWith('.png')&&!name.includes('-failure-')).map(name=>({path:`${captures}/${name}`,language:/-(fr|en)\.png$/.exec(name)?.[1]??'undetermined',description:name.replace(engine+'-','').replace(/\.png$/,'').replaceAll('-',' ')}));results.push(evidence);writeFileSync(`${out}/${engine}-results.json`,JSON.stringify(evidence,null,2));}
 console.log(engine+' '+evidence.status);if(evidence.status==='failed')console.error(evidence.error);
}
writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));
if(results.some(row=>row.status!=='passed'))process.exitCode=1;
