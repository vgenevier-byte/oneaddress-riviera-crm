import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fixtureAccountId,groups,installFixture,sharedTaskId} from './fixture.mjs';

const require=createRequire(import.meta.url);
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin=process.env.I18N_ORIGIN||'http://127.0.0.1:3299';
const out=process.env.I18N_STATE_OUT||'/private/tmp/oar-bilingual-20261008/browser/state';
mkdirSync(out,{recursive:true});
const results=[];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sharedTitle='Préparer la visite bilingue — donnée métier française';
const sharedNotes='Texte libre français partagé entre les deux comptes, jamais traduit.';
const conflictMessages={
  fr:'Conflit : la tâche a été modifiée. Votre saisie est conservée. Relisez la version actuelle avant de reprendre.',
  en:'Conflict: the task has changed. Your input is retained. Review the current version before continuing.'
};

// Every external endpoint is intercepted by installFixture. This additional local
// route fulfils two explicitly simulated mutations and never forwards a write.
async function mutationSimulator(context,fixture){
  const simulatedMutations=[];
  let waiting;
  await context.route('**/rest/v1/rpc/crm_tasks_mutate',async route=>{
    const request=route.request();
    assert.equal(new URL(request.url()).origin,'http://127.0.0.1:4097');
    const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
    assert.equal(request.method(),'POST');
    const body=request.postDataJSON();
    const captured={body,reply:null};
    simulatedMutations.push(captured);
    const reply=await new Promise(resolve=>{waiting={resolve,captured};});
    captured.reply=reply.status;
    await route.fulfill({headers,contentType:'application/json',status:reply.status,body:JSON.stringify(reply.body)});
  });
  return {simulatedMutations,
    async pending(count){
      const started=Date.now();
      while(simulatedMutations.length<count||!waiting){
        if(Date.now()-started>10_000)throw new Error('Expected simulated task mutation '+count);
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(simulatedMutations.length,count,'Exactly one send per explicit submit');
      return waiting.captured.body;
    },
    releaseSuccess(){
      assert.ok(waiting,'A simulated response is pending');
      const {body}=waiting.captured;
      const existing=fixture.tasks.find(task=>task.id===body.p_id);
      const {assigneeIds,...fields}=body.p_patch;
      const stamp='2026-10-08T11:00:00Z';
      const task={...(existing||{title:'',status:'À faire',notes:'',dueDate:'',priority:'normal',createdBy:fixture.user.id,createdByLabel:'Compte fictif FR',createdAt:stamp,assignees:[]}),...fields,id:body.p_id,updatedAt:stamp,updatedBy:fixture.user.id,revision:(existing?.revision||0)+1};
      if(assigneeIds)task.assignees=assigneeIds.map(userId=>({userId,label:userId===fixtureAccountId('limited')?'Compte fictif EN':'Compte fictif FR',email:userId===fixtureAccountId('limited')?'i18n-limited@example.invalid':'i18n-full@example.invalid',access:'contribute',active:true}));
      fixture.tasks.splice(0,fixture.tasks.length,...fixture.tasks.filter(row=>row.id!==task.id),task);
      const current=waiting;waiting=undefined;current.resolve({status:200,body:task});
      return task;
    },
    releaseConflict(){
      assert.ok(waiting,'A simulated response is pending');
      const existing=fixture.tasks.find(task=>task.id===waiting.captured.body.p_id);
      assert.ok(existing);
      existing.revision++;existing.updatedAt='2026-10-08T12:00:00Z';existing.notes='Version serveur française — ne pas écraser le brouillon.';
      const current=waiting;waiting=undefined;current.resolve({status:409,body:{code:'40001',message:'revision_conflict',details:null,hint:null}});
    }
  };
}

async function choose(page,language){
  // Native dialog makes the sidebar inert; invoking its existing click handler
  // exercises the normal provider update without closing or remounting a dialog.
  await page.locator('.sidebar [data-language-selector]').getByRole('button',{name:language==='en'?'English — EN':'Français — FR',exact:true}).evaluate(button=>button.click());
  await page.waitForFunction(lang=>document.documentElement.lang===lang,language==='en'?'en-GB':'fr');
}
async function navigate(page,id){
  const group=groups.find(value=>value.modules.includes(id));
  if(group){const button=page.locator(`.sidebar [data-navigation-group="${group.id}"]`);if(await button.getAttribute('aria-expanded')!=='true')await button.click();}
  await page.locator(`.sidebar [data-navigation-module="${id}"]`).click();
  await page.waitForFunction(id=>document.querySelector(`.sidebar [data-navigation-module="${id}"]`)?.getAttribute('aria-current')==='page',id);
}
async function login(page,fixture){
  await page.goto(origin);
  await page.locator('input[type="email"]').fill(fixture.user.email);
  await page.locator('input[autocomplete="current-password"]').fill('Bilingual-Fictive-2026!');
  await page.locator('form button:not([type="button"])').first().click();
  await page.locator('.sidebar [data-navigation-module="tasks"]').waitFor({state:'attached'});
}
function auditSnapshot(fixture){return {auth:fixture.audit.auth.length,writes:fixture.audit.writes.length,blocked:fixture.audit.blocked.length};}
async function unchangedOnToggle(page,fixture,language,assertState){
  const before=auditSnapshot(fixture);await choose(page,language);await assertState();assert.deepEqual(auditSnapshot(fixture),before,'Language change performs no Auth, business write or external call');
}
async function assertFields(dialog,expected){
  for(const [name,value] of Object.entries(expected))assert.equal(await dialog.locator(`[name="${name}"]`).inputValue(),value,name+' remains canonical or free text');
}
async function noPrivateLeak(page,profile){
  const expected=[...(['full','limited'].includes(profile)?[sharedTaskId]:[]),...Array.from({length:3},(_,index)=>`i18n-task-${profile}-${index}`)].sort();
  const rendered=await page.locator('[data-task-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.taskId).sort());
  assert.deepEqual(rendered,expected,'Only the account fixture projection is rendered');
  await Promise.all([
    page.locator('[data-task-id^="stale-"]').count().then(count=>assert.equal(count,0,'Stale workspace tasks are absent')),
    page.getByText('TÂCHE PRIVÉE HORS PROJECTION',{exact:false}).count().then(count=>assert.equal(count,0,'Stale workspace text is absent')),
    page.locator('[data-task-id^="i18n-task-reader-"]').count().then(count=>assert.equal(count,profile==='reader'?3:0,'Third account private tasks are absent from other projections'))
  ]);
}

for(const engine of process.env.I18N_ENGINE?[process.env.I18N_ENGINE]:['chromium','webkit']){
  const browser=await(engine==='chromium'?chromium.launch({headless:true,channel:'chrome'}):webkit.launch({headless:true,...(process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE}:{})}));
  const contexts=[];const fixtures=[];const pages=[];const errors=[];
  let simulator;
  const evidence={name:engine+'-desktop-state',browserVersion:browser.version(),status:'running',steps:[],proofBoundary:'Actual integrated UI with fictitious Auth/read projections and locally intercepted mutations. No real database, Auth, permission enforcement, Drive upload or external-system proof.'};
  try{
    async function open(profile){
      const context=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(context);
      const fixture=await installFixture(context,profile,origin);fixtures.push(fixture);
      const page=await context.newPage();pages.push(page);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
      await login(page,fixture);return {context,fixture,page};
    }
    const full=await open('full');const {page,fixture}=full;
    simulator=await mutationSimulator(full.context,fixture);
    await choose(page,'fr');await navigate(page,'vendorInvoices');
    const invoice=page.locator('.vendor-invoices-form-card form');
    const file=invoice.locator('[name="invoiceFile"]');
    const fileBuffer=Buffer.from('%PDF-1.4\nFICTITIOUS LOCAL FILE — NO UPLOAD\n');
    await invoice.locator('[name="title"]').fill('Facture en brouillon — français conservé');
    await invoice.locator('[name="notes"]').fill('Note libre française — André & Zoé.');
    await invoice.locator('[name="amount"]').fill('1 023,70');
    await invoice.locator('[name="paidAmount"]').fill('23,70');
    await file.setInputFiles({name:'pièce fictive.pdf',mimeType:'application/pdf',buffer:fileBuffer});
    const fileHandle=await file.elementHandle();const amountHandle=await invoice.locator('[name="amount"]').elementHandle();
    const fileState=()=>file.evaluate(input=>Array.from(input.files,file=>({name:file.name,size:file.size,type:file.type})));
    const expectedFile=[{name:'pièce fictive.pdf',size:fileBuffer.length,type:'application/pdf'}];
    async function invoiceState(){
      assert.deepEqual(await fileState(),expectedFile,'Pending selected file preserved');
      await assertFields(invoice,{title:'Facture en brouillon — français conservé',notes:'Note libre française — André & Zoé.',amount:'1 023,70',paidAmount:'23,70'});
      assert.equal(await fileHandle.evaluate(node=>node.isConnected),true,'File input DOM identity retained');assert.equal(await amountHandle.evaluate(node=>node.isConnected),true,'Money input DOM identity retained');
    }
    await unchangedOnToggle(page,fixture,'en',invoiceState);await unchangedOnToggle(page,fixture,'fr',invoiceState);
    await page.screenshot({path:`${out}/${engine}-pending-file-fr.png`});
    evidence.steps.push({name:'pending invoice file and raw decimal inputs FR → EN → FR',file:expectedFile,amount:'1 023,70',paidAmount:'23,70',sameDOM:true,submitted:false});
    await navigate(page,'tasks');await page.locator(`[data-task-id="${sharedTaskId}"]`).waitFor();await noPrivateLeak(page,'full');
    const fullShared=structuredClone(fixture.tasks.find(task=>task.id===sharedTaskId));assert.equal(await page.locator(`[data-task-id="${sharedTaskId}"] .taskws-title`).textContent(),sharedTitle);
    await page.locator(`[data-task-id="${sharedTaskId}"] .taskws-title`).click();
    assert.equal(await page.locator('.taskws-dialog .taskws-notes').textContent(),sharedNotes);
    await page.locator('.taskws-dialog .taskws-buttons button').first().click();
    const limited=await open('limited');await choose(limited.page,'en');await navigate(limited.page,'tasks');await limited.page.locator(`[data-task-id="${sharedTaskId}"]`).waitFor();await noPrivateLeak(limited.page,'limited');
    const limitedShared=structuredClone(limited.fixture.tasks.find(task=>task.id===sharedTaskId));assert.deepEqual(limitedShared,fullShared);
    assert.equal(await limited.page.locator(`[data-task-id="${sharedTaskId}"] .taskws-title`).textContent(),sharedTitle);
    await limited.page.locator(`[data-task-id="${sharedTaskId}"] .taskws-title`).click();assert.equal(await limited.page.locator('.taskws-dialog .taskws-notes').textContent(),sharedNotes);
    await limited.page.screenshot({path:`${out}/${engine}-limited-en-shared.png`});
    await limited.page.locator('.taskws-dialog .taskws-buttons button').first().click();
    const reader=await open('reader');await navigate(reader.page,'tasks');await reader.page.locator('[data-task-id^="i18n-task-reader-"]').first().waitFor();await noPrivateLeak(reader.page,'reader');assert.equal(await reader.page.locator(`[data-task-id="${sharedTaskId}"]`).count(),0,'Unassigned third account does not receive shared task');
    assert.equal(await page.locator('[data-task-id^="i18n-task-reader-"]').count(),0);assert.equal(await limited.page.locator('[data-task-id^="i18n-task-reader-"]').count(),0);
    evidence.steps.push({name:'full FR / limited EN see identical shared task, third account private tasks isolated',id:sharedTaskId,title:sharedTitle,notes:sharedNotes,fullUserId:fixture.user.id,limitedUserId:limited.fixture.user.id,thirdUserId:reader.fixture.user.id});

    await page.bringToFront();await choose(page,'en');await page.getByRole('button',{name:'Add a task',exact:true}).click();
    let dialog=page.locator('.taskws-dialog');await dialog.waitFor();
    const created={title:'Tâche créée en anglais — titre français libre',notes:'Ne jamais traduire cette note : André, été, € et 1 023,70.',dueDate:'2026-10-15',priority:'urgent',status:'En cours'};
    for(const name of ['title','notes','dueDate'])await dialog.locator(`[name="${name}"]`).fill(created[name]);
    for(const name of ['priority','status'])await dialog.locator(`[name="${name}"]`).selectOption(created[name]);
    assert.equal(await dialog.locator('[name="status"] option:checked').textContent(),'In progress');assert.equal(await dialog.locator('[name="priority"] option:checked').textContent(),'Urgent');
    await dialog.locator('[data-task-directory="ready"]').waitFor();await dialog.locator('[name="recipientToAdd"]').selectOption(fixtureAccountId('limited'));
    const draftHandle=await dialog.locator('[name="notes"]').elementHandle();await dialog.locator('button[type="submit"]').click();
    const creation=await simulator.pending(1);
    assert.match(creation.p_id,uuid);assert.match(creation.p_request_id,uuid);assert.equal(creation.p_revision,null);assert.equal(creation.p_delete,false);
    for(const [name,value] of Object.entries(created))assert.equal(creation.p_patch[name],value,'EN creation payload retains '+name);
    assert.deepEqual(creation.p_patch.assigneeIds,[fixtureAccountId('limited')]);assert.equal('createdBy' in creation.p_patch,false,'Server remains authoritative for creator identity');
    async function pendingState(){await assertFields(dialog,created);assert.equal(await dialog.isVisible(),true);assert.equal(await dialog.locator('button[type="submit"]').isDisabled(),true);assert.equal(await draftHandle.evaluate(node=>node.isConnected),true);assert.equal(simulator.simulatedMutations.length,1);}
    await unchangedOnToggle(page,fixture,'fr',pendingState);await unchangedOnToggle(page,fixture,'en',pendingState);
    await page.screenshot({path:`${out}/${engine}-create-awaiting-en.png`});
    const confirmed=simulator.releaseSuccess();await dialog.waitFor({state:'detached'});await page.locator(`[data-task-id="${confirmed.id}"]`).waitFor();assert.equal(simulator.simulatedMutations.length,1,'One simulated send after confirmation');
    assert.equal(await page.locator(`[data-task-id="${confirmed.id}"] .taskws-title`).textContent(),created.title);
    evidence.steps.push({name:'English task creation with delayed local response and language changes while pending',canonicalRequest:creation,serverConfirmedFixtureTaskId:confirmed.id,sends:1});

    const editTask=fixture.tasks.find(task=>task.id==='i18n-task-full-0');assert.ok(editTask);
    await page.locator(`[data-task-id="${editTask.id}"]`).getByRole('button',{name:'Edit',exact:true}).click();dialog=page.locator('.taskws-dialog');await dialog.waitFor();
    const edited={title:'Brouillon de modification français — conserver',notes:'Brouillon privé français après conflit : 1 023,70 €.',dueDate:'2026-10-16',priority:'important',status:'En cours'};
    for(const name of ['title','notes','dueDate'])await dialog.locator(`[name="${name}"]`).fill(edited[name]);for(const name of ['priority','status'])await dialog.locator(`[name="${name}"]`).selectOption(edited[name]);
    const conflictDraftHandle=await dialog.locator('[name="notes"]').elementHandle();await dialog.locator('button[type="submit"]').click();const edit=await simulator.pending(2);
    assert.equal(edit.p_id,editTask.id);assert.match(edit.p_request_id,uuid);assert.notEqual(edit.p_request_id,creation.p_request_id);assert.equal(edit.p_revision,1);assert.equal(edit.p_delete,false);for(const [name,value] of Object.entries(edited))assert.equal(edit.p_patch[name],value,'EN edit payload retains '+name);
    await unchangedOnToggle(page,fixture,'fr',async()=>{await assertFields(dialog,edited);assert.equal(await dialog.locator('button[type="submit"]').isDisabled(),true);assert.equal(simulator.simulatedMutations.length,2);});
    simulator.releaseConflict();await dialog.locator('.taskws-conflict').waitFor();await dialog.getByRole('alert').filter({hasText:conflictMessages.fr}).waitFor();
    async function conflictState(language){await assertFields(dialog,edited);assert.equal(await dialog.getByRole('alert').textContent(),conflictMessages[language]);assert.equal(await conflictDraftHandle.evaluate(node=>node.isConnected),true);assert.equal(await dialog.locator('button[type="submit"]').isDisabled(),true,'Conflicting draft requires explicit revision adoption');assert.equal(simulator.simulatedMutations.length,2,'Language changes never retry the conflict');assert.equal(await dialog.locator('.taskws-conflict').isVisible(),true);}
    await unchangedOnToggle(page,fixture,'en',()=>conflictState('en'));await page.screenshot({path:`${out}/${engine}-conflict-en.png`});await unchangedOnToggle(page,fixture,'fr',()=>conflictState('fr'));await page.screenshot({path:`${out}/${engine}-conflict-fr.png`});
    evidence.steps.push({name:'English edit payload / delayed 409 / conflict draft and translated message retained',canonicalRequest:edit,response:409,messageFR:conflictMessages.fr,messageEN:conflictMessages.en,sends:1,sameDOM:true});
    await dialog.getByRole('button',{name:'Annuler',exact:true}).click();

    await navigate(page,'monthlyCharges');await page.getByRole('button',{name:'Sélectionner mes charges',exact:true}).click();const charges=page.getByRole('dialog');await charges.waitFor();
    const supplier=charges.locator('label').filter({hasText:'Fournisseur Démonstration'}).locator('input[type="checkbox"]');await supplier.uncheck();const checkboxHandle=await supplier.elementHandle();const chargesSearch=charges.locator('input[type="search"]');await chargesSearch.fill('Fournisseur');const searchHandle=await chargesSearch.elementHandle();
    async function chargesState(){assert.equal(await charges.isVisible(),true);assert.equal(await supplier.isChecked(),false,'Pending unchecked person rule retained');assert.equal(await chargesSearch.inputValue(),'Fournisseur');assert.equal(await checkboxHandle.evaluate(node=>node.isConnected),true,'Translated section retains checkbox DOM identity');assert.equal(await searchHandle.evaluate(node=>node.isConnected),true);}
    await unchangedOnToggle(page,fixture,'en',chargesState);assert.match(await charges.textContent(),/€1,234\.56/,'English euro display has English separators without changing amount');await page.screenshot({path:`${out}/${engine}-charges-selection-en.png`});await unchangedOnToggle(page,fixture,'fr',chargesState);
    evidence.steps.push({name:'charges selection checkbox and search draft FR → EN → FR',checked:false,search:'Fournisseur',sameDOM:true,submitted:false});await charges.getByRole('button',{name:'Annuler',exact:true}).click();
    for(const current of fixtures){assert.deepEqual(current.audit.writes,[],'Default read-only fixture attempted no write');assert.deepEqual(current.audit.blocked,[],'No external or blocked request');}
    assert.deepEqual(errors,[],'No browser exceptions');assert.equal(simulator.simulatedMutations.length,2);evidence.status='passed';console.log('PASS '+evidence.name);
  }catch(error){evidence.status='failed';evidence.error=String(error);for(let index=0;index<pages.length;index++)await pages[index].screenshot({path:`${out}/${engine}-failure-${index}.png`}).catch(()=>{});throw error;}
  finally{evidence.audit=fixtures.map(fixture=>fixture.audit);evidence.simulatedMutations=simulator?.simulatedMutations||[];evidence.errors=errors;results.push(evidence);writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));for(const context of contexts)await context.close();await browser.close();}
}
