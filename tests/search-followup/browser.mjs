/** Actual integrated views, frozen exact source, fictional projected records and simulated saves only. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH=process.env.PLAYWRIGHT_BROWSERS_PATH||'/private/tmp/oar-search-playwright';
const require=createRequire(import.meta.url),{chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=resolve(process.cwd()),output=join(root,'docs/search-followup'),manifest=JSON.parse(readFileSync(join(output,'fixture-manifest.json'),'utf8'));
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
function assertSources(){for(const row of manifest.files){assert.equal(hash(join(root,row.path)),row.sha256,row.path+' current source');assert.equal(hash(join(manifest.directory,row.path)),row.sha256,row.path+' frozen fixture');}for(const row of manifest.fixtureOnlyFiles)assert.equal(hash(join(manifest.directory,row.path)),row.sha256,row.path+' harness');}
assertSources();mkdirSync(join(output,'screenshots'),{recursive:true});
const results=[],sessions=[];let failures=0;
const save=()=>writeFileSync(join(output,'browser-results.json'),JSON.stringify({fictionalData:true,actualAuth:false,actualRPC:false,actualDatabase:false,persistence:'React callbacks + localStorage simulation, verified across reload',physicalDevice:false,actualBusinessViews:manifest.actualBusinessViews,globalStyles:'app/globals.css exact source',sourceManifest:'fixture-manifest.json',results,sessions},null,2)+'\n');
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
 for(const mobile of [false,true])for(const language of ['fr','en']){
  const label=`${engine}-${mobile?'mobile':'desktop'}-${language}`,context=await browser.newContext({viewport:{width:mobile?390:1360,height:mobile?844:1100},isMobile:mobile,hasTouch:mobile});
  await context.addInitScript(language=>localStorage.setItem('oar.ui-language.v1:anonymous',language),language);
  const page=await context.newPage();page.setDefaultTimeout(6000);await page.clock.setFixedTime(new Date('2026-10-24T10:30:00Z'));
  const errors=[],blockedExternal=[],businessRequests=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.pathname.startsWith('/api/')||url.port==='9'){businessRequests.push({url:url.href,method:route.request().method()});return route.abort();}if(!['127.0.0.1','localhost'].includes(url.hostname)){blockedExternal.push(url.origin);return route.fulfill({status:200,contentType:'text/css',body:''});}return route.continue();});
  await page.goto(manifest.url);await page.locator('.documents-view').waitFor();
  const documents=page.locator('#integrated-documents'),house=page.locator('#integrated-house'),query=documents.locator('input[type="search"]').first(),filter=house.locator('.house-worker-filter input[role="combobox"]');
  const state=()=>page.locator('[data-fixture-state]').textContent().then(JSON.parse);
  const initialState=await state();
  const valueOf=input=>input.locator('xpath=ancestor::span[@data-searchable-select="true"]').locator('select').inputValue();
  const control=input=>input.locator('xpath=ancestor::span[@data-searchable-select="true"]');
  const cardIds=()=>documents.locator('.documents-grid article').evaluateAll(rows=>rows.map(row=>row.id).sort());
  const expectFolder=async(ids)=>{assert.equal(await query.inputValue(),'');assert.deepEqual(await cardIds(),ids.map(id=>'document-'+id).sort());};
  const tabs=house.locator('nav.house-tabs button');
  async function check(name,fn){try{await fn();results.push({session:label,name,passed:true});console.log('PASS',label,name);}catch(error){failures++;results.push({session:label,name,passed:false,error:String(error)});console.log('FAIL',label,name,String(error));await page.screenshot({path:join(output,'screenshots',`failure-${label}-${results.length}.png`)}).catch(()=>{});}save();}
  async function choose(input,queryText,id){const before=await valueOf(input);await input.fill(queryText);const option=control(input).getByRole('option').filter({has:page.locator('strong',{hasText:id==='worker-clement'?/^Clément Martin$/:/^Intervenant historique$/})});await option.waitFor();assert.equal(await valueOf(input),before,'typing keeps selection ID');await option.click();assert.equal(await valueOf(input),id);}
  await check('documents-global-folder-open-parent-root-and-picker-clear-search',async()=>{
   await query.fill('Contrats Riviera');assert.equal(await documents.locator('#document-folder-child').count(),1);
   await documents.locator('#document-folder-child button').first().click();await expectFolder(['folder-grandchild','file-child']);
   if(language==='fr')await documents.screenshot({path:join(output,'screenshots',`documents-open-${label}.png`)});
   await query.fill('Pièce voisine');assert.equal(await documents.locator('#document-file-sibling').count(),1);
   await documents.locator('.document-breadcrumbs').getByRole('button',{name:'Dossier parent',exact:true}).click();await expectFolder(['folder-child','folder-sibling','file-parent']);
   await query.fill('Contenu unique');assert.equal(await documents.locator('#document-file-child').count(),1);
   await documents.locator('.document-breadcrumbs button').first().click();await expectFolder(['folder-parent','file-root']);
   await query.fill('Pièce voisine');const picker=documents.locator('input[role="combobox"]');await picker.fill('Contrats Riviera');await control(picker).getByRole('option',{name:'Contrats Riviera',exact:true}).click();await expectFolder(['folder-grandchild','file-child']);
  });
  for(const q of ['clemnt','martin clem','riviera canne','cannse'])await check('general-worker-filter-linked-contact-'+q,async()=>{
   await choose(filter,q,'worker-clement');await filter.fill(q);assert.equal(await control(filter).getByRole('option').filter({hasText:'archivé'}).count(),0);await filter.press('Escape');
  });
  await check('general-historical-contact-missing-selectable-with-worker-id',async()=>{await choose(filter,'historique','worker-orphan');assert.equal(await valueOf(filter),'worker-orphan');await filter.fill(language==='en'?'All':'Tous');await control(filter).getByRole('option').filter({has:page.locator('strong',{hasText:language==='en'?/^All$/:/^Tous$/})}).click();});
  await tabs.nth(1).click();
  const hoursForm=()=>house.locator('.house-two-columns .house-tab-panel').first().locator('form'),hoursWorker=()=>hoursForm().locator('input[role="combobox"]').nth(1);
  for(const q of ['clemnt','martin clem','riviera canne','cannse'])await check('hours-worker-linked-contact-'+q,async()=>{await choose(hoursWorker(),q,'worker-clement');assert.equal(await hoursForm().locator('input[inputmode="decimal"]').first().inputValue(),'25.5');});
  await check('hours-and-filter-keep-financial-data-and-archive-eligibility',async()=>{
   await hoursWorker().fill('');assert.equal(await control(hoursWorker()).getByRole('option').filter({hasText:'archivé'}).count(),0);await hoursWorker().press('Escape');
   const current=await state();assert.deepEqual(current,initialState);assert.match(await house.locator('#house-time-time-original').innerText(),/114[,.]75/);assert.match(await house.locator('#house-time-time-original').innerText(),/12[,.]75/);
   if(language==='fr'){await hoursWorker().fill('riviera canne');await hoursForm().screenshot({path:join(output,'screenshots',`hours-linked-contact-${label}.png`)});await hoursWorker().press('Escape');}
  });
  await check('hours-save-simulation-keeps-worker-id-rate-expenses-and-existing-ledger',async()=>{
   await hoursForm().locator('[name="expenseAmount"]').fill('7.25');await hoursForm().locator('[name="expenseNote"]').fill('Frais fictifs conservés');await hoursForm().locator('button[type="submit"]').click();
   await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-fixture-state]').textContent).saves.length===1);const next=await state(),entry=next.saves[0].record;
   assert.equal(entry.workerId,'worker-clement');assert.notEqual(entry.workerId,'contact-clement');assert.equal(entry.workerName,'Clément Martin');assert.equal(entry.hourlyRate,25.5);assert.equal(entry.expenseAmount,7.25);assert.equal(entry.expenseNote,'Frais fictifs conservés');assert.equal(entry.startTime,'09:00');assert.equal(entry.endTime,'13:00');assert.equal(entry.breakMinutes,0);assert.equal(entry.hourlyRate*4+entry.expenseAmount,109.25);assert.deepEqual(next.entries.slice(0,2),initialState.entries);assert.deepEqual(next.workers,initialState.workers);assert.deepEqual(next.payments,initialState.payments);
  });
  await tabs.nth(2).click();const paymentForm=()=>house.locator('.house-two-columns .house-tab-panel').first().locator('form'),paymentWorker=()=>paymentForm().locator('input[role="combobox"]').nth(1);
  for(const q of ['clemnt','martin clem','riviera canne','cannse'])await check('payments-worker-linked-contact-'+q,async()=>{await choose(paymentWorker(),q,'worker-clement');assert.equal(await paymentForm().evaluate(form=>new FormData(form).get('workerId')),'worker-clement');});
  await check('payment-save-simulation-worker-id-exact-amount-and-reload',async()=>{
   await paymentWorker().fill('');assert.equal(await control(paymentWorker()).getByRole('option').filter({hasText:'archivé'}).count(),0);await paymentWorker().press('Escape');
   await paymentForm().locator('[name="amount"]').fill('17.40');await paymentForm().locator('button[type="submit"]').click();await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-fixture-state]').textContent).saves.length===2);
   const before=await state(),payment=before.saves[1].record;assert.equal(payment.workerId,'worker-clement');assert.notEqual(payment.workerId,'contact-clement');assert.equal(payment.amount,17.4);assert.equal(payment.method,'Virement');assert.deepEqual(before.payments.slice(0,2),initialState.payments);assert.deepEqual(before.entries.slice(0,2),initialState.entries);await page.reload();await house.locator('.house-tracking-view').waitFor();assert.deepEqual(await state(),before);await tabs.nth(1).click();
  });
  await house.locator('.house-archive-trigger').click();const archive=house.locator('[role="dialog"]');
  for(const q of ['clemnt','martin clem','riviera canne','cannse'])await check('archived-search-linked-contact-'+q,async()=>{await archive.locator('input[type="search"]').fill(q);assert.equal(await archive.locator('.house-archive-worker-button').count(),1);assert.match(await archive.locator('.house-archive-worker-button').innerText(),/Clément Martin archivé/);});
  await check('archive-choice-keeps-worker-id-eligible-history-and-today-reset',async()=>{
   if(language==='fr')await archive.screenshot({path:join(output,'screenshots',`archive-linked-contact-${label}.png`)});await archive.locator('.house-archive-worker-button').click();assert.equal(await valueOf(filter),'worker-archived');assert.equal(await house.locator('#house-time-time-archived').count(),1);assert.equal(await house.locator('#house-time-time-original').count(),0);assert.match(await house.locator('#house-time-time-archived').innerText(),/50[,.]50/);
   await filter.fill('riviera canne');assert.equal(await control(filter).getByRole('option').filter({hasText:'Clément Martin archivé'}).count(),1);await filter.press('Escape');await tabs.nth(0).click();assert.equal(await valueOf(filter),'Tous');await filter.fill('riviera canne');assert.equal(await control(filter).getByRole('option').filter({hasText:'archivé'}).count(),0);await filter.press('Escape');
  });
  await check('restricted-company-projection-no-unavailable-company-or-api-expansion',async()=>{
   await page.locator('[data-fixture-projection]').selectOption('company-hidden');await filter.fill('riviera');assert.equal(await control(filter).getByRole('option').count(),0);await filter.fill('cannse');await control(filter).getByRole('option').filter({hasText:'Clément Martin'}).waitFor();await filter.press('Escape');await tabs.nth(1).click();await house.locator('.house-archive-trigger').click();await archive.locator('input').fill('riviera');assert.equal(await archive.locator('.house-archive-worker-button').count(),0);await archive.locator('input').fill('clemnt');assert.equal(await archive.locator('.house-archive-worker-button').count(),1);await archive.locator('.house-archive-picker-close').click();
  });
  await check('restricted-contacts-projection-legacy-fallback-no-contact-company-city-leak',async()=>{
   await page.locator('[data-fixture-projection]').selectOption('contacts-hidden');for(const q of ['riviera','cannse','example.invalid','0611223344']){await filter.fill(q);assert.equal(await control(filter).getByRole('option').count(),0,q);}await choose(filter,'clemnt','worker-clement');await choose(filter,'historique','worker-orphan');
  });
  await check('read-only-business-context-blocks-hour-and-payment-writes',async()=>{
   const before=await state();await page.locator('[data-fixture-projection]').selectOption('read-only');await tabs.nth(1).click();assert.equal(await hoursForm().locator('button[type="submit"]').isDisabled(),true);assert.equal(await hoursWorker().isDisabled(),true);await tabs.nth(2).click();assert.equal(await paymentForm().locator('button[type="submit"]').isDisabled(),true);const after=await state();assert.deepEqual(after.saves,before.saves);assert.deepEqual(after.entries,before.entries);assert.deepEqual(after.payments,before.payments);assert.deepEqual(after.workers,before.workers);
  });
  await check('localized-integrated-view-no-runtime-errors-or-business-network-requests',async()=>{assert.equal(await page.locator('html').getAttribute('lang'),language==='en'?'en-GB':'fr');assert.deepEqual(errors,[]);assert.deepEqual(businessRequests,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false);});
  sessions.push({session:label,engine,language,mobileEmulation:mobile,width:mobile?390:1360,consoleErrors:errors,businessRequests,blockedExternalResources:[...new Set(blockedExternal)],simulatedSaves:(await state()).saves});save();await context.close();
 }
 await browser.close();
}
assertSources();console.log(JSON.stringify({passed:results.filter(row=>row.passed).length,failed:failures,sessions:sessions.length}));process.exitCode=failures?1:0;
