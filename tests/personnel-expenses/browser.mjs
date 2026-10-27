/** Integrated application -> real local Auth/RPC/PostgreSQL, all records fictitious. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { assertPrepaidLocalTarget } from '../prepaid-hours/server-local-target.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const statusFile=process.env.PREPAID_HOURS_STATUS_FILE;assert.ok(statusFile);
const status=JSON.parse(readFileSync(statusFile,'utf8')),origin='http://127.0.0.1:3197';
assertPrepaidLocalTarget({api:status.API_URL,database:status.DB_URL,app:origin,mail:'http://127.0.0.1:56034',acknowledgement:process.env.IZORD_TEST_ACK});
const fixture=JSON.parse(readFileSync(join(dirname(statusFile),'fixtures.private.json'),'utf8'));
const output=process.env.PERSONNEL_EXPENSE_OUTPUT||'/private/tmp/personnel-expenses-checks';mkdirSync(output,{recursive:true});
const results=[],errors=[],external=[],writes=[];const normalize=value=>value.replace(/[\u00a0\u202f]/g,' ');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const summary=page=>page.locator('.house-expense-summary');
const details=page=>page.locator('#house-expense-details');
const test=async(name,fn)=>{await fn();results.push(name);console.log('PASS '+name);writeFileSync(join(output,'browser-progress.json'),JSON.stringify(results,null,2));};
async function start(who='owner',width=1440,lang='fr',projection=null){
 const user=fixture.users[who],context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true,...(width<500?{isMobile:true,hasTouch:true}:{})});
 await context.addInitScript(({id,lang})=>{localStorage.setItem('oar.ui-language.v1:anonymous',lang);localStorage.setItem('oar.ui-language.v1:account:'+id,lang);},{id:user.id,lang});
 await context.route('**/*',async route=>{const request=route.request(),u=new URL(request.url());if(['http:','https:'].includes(u.protocol)&&![origin,status.API_URL].includes(u.origin)){external.push(u.origin+u.pathname);return route.abort();}
  if(projection==='unknown'&&u.pathname.endsWith('/rpc/crm_house_prepaid_state'))return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'local unavailable test'})});
  if(projection&&u.pathname.endsWith('/crm_workspace_state')&&request.method()==='GET'){
   const response=await route.fetch();assert.equal(response.status(),200);const data=await response.json();
   for(const row of Array.isArray(data)?data:[data]){const payload=row.payload;if(projection.startsWith('fraction-')){const original=payload.houseTimeEntries.find(e=>e.id==='personnel-expense-clement-0');payload.houseTimeEntries=payload.houseTimeEntries.filter(e=>e.workerId!=='personnel-expense-clement');payload.houseTimeEntries.push({...original,endTime:'09:30',hourlyRate:10.01,expenseAmount:.02});payload.housePayments=payload.housePayments.map(e=>e.workerId==='personnel-expense-clement'?{...e,amount:projection==='fraction-full'?5.03:2.01}:e);continue;}for(const worker of payload.houseTrackingWorkers||[])if(worker.id==='worker-prepaid')worker.billingMode='prepaid';for(const entry of payload.houseTimeEntries||[])if(entry.workerId==='worker-prepaid'){entry.billingMode='prepaid';if(projection==='canonical')entry.prepaid={minutes:120,coveredMinutes:120,uncoveredMinutes:0,coveredCents:99999,uncoveredCents:0,amountCents:99999};else delete entry.prepaid;}}
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  }
  return route.continue();});
 const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const requests=[];page.on('request',r=>{if(r.url().startsWith(status.API_URL)){requests.push({method:r.method(),path:new URL(r.url()).pathname,body:r.postData()});if(r.method()==='POST'&&r.url().endsWith('/rpc/crm_update_house_time_expenses'))writes.push(r.postDataJSON());}});
 await page.goto(origin+'/?module=houseTracking');await page.locator('input[type=email]').fill(user.email);await page.locator('input[autocomplete=current-password]').fill(user.password);await page.getByRole('button',{name:/^(Se connecter|Sign in)$/}).click();
 if(who==='none'){await page.getByRole('heading',{name:/^(Aucun accès autorisé|No access granted)$/}).waitFor();return {context,page,requests};}
 await summary(page).waitFor({timeout:90000});if(projection!=='unknown')await page.locator('[data-prepaid-worker="worker-prepaid"]').waitFor();return {context,page,requests};
}
async function scope(page,worker='clement',house='Tous',from='2026-10-01',to='2026-10-31'){
 await page.locator('.house-filter-row input[type=date]').nth(0).fill(from);await page.locator('.house-filter-row input[type=date]').nth(1).fill(to);
 await page.locator('.house-filter-row > label select').first().selectOption(house==='Tous'?house:'personnel-expense-house-'+house,{force:true});
 await page.locator('.house-worker-filter select').selectOption(worker==='Tous'?worker:worker.startsWith('worker-')?worker:'personnel-expense-'+worker,{force:true});
}
async function total(page,expected,lang='fr'){
 const value=new Intl.NumberFormat(lang==='fr'?'fr-FR':'en-GB',{style:'currency',currency:'EUR'}).format(expected);
 await page.waitForFunction(({expected})=>document.querySelector('.house-expense-summary strong')?.textContent?.replace(/[\u00a0\u202f]/g,' ')===expected,{expected:normalize(value)});
 assert.equal(normalize(await summary(page).locator('strong').innerText()),normalize(value));
}
const stat=(page,label)=>page.locator('.house-summary-grid > .stat-card').filter({has:page.getByText(label,{exact:true})});
async function statMoney(page,label,amount,lang='fr'){
 let value=amount===null?'—':new Intl.NumberFormat(lang==='fr'?'fr-FR':'en-GB',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(amount);
 if(['Solde','Balance'].includes(label)&&amount!==null)value=amount===0?(lang==='fr'?'À jour':'Up to date'):(lang==='fr'?value+' à payer':value+' due');
 const element=stat(page,label).locator('strong');await element.waitFor();await page.waitForFunction(({label,value})=>[...document.querySelectorAll('.house-summary-grid > .stat-card')].find(card=>card.querySelector('span')?.textContent===label)?.querySelector('strong')?.textContent?.replace(/[\u00a0\u202f]/g,' ')===value,{label,value:normalize(value)});
 assert.equal(normalize(await element.innerText()),normalize(value));
}
async function financial(page,hours,expenses,total,paid,balance,lang='fr'){
 await statMoney(page,lang==='fr'?'Montant des heures':'Hours amount',hours,lang);await statMoney(page,lang==='fr'?'Frais annexes':'Additional expenses',expenses,lang);await statMoney(page,lang==='fr'?'Total heures + frais':'Total hours + expenses',total,lang);await statMoney(page,lang==='fr'?'Payé':'Paid',paid,lang);if(typeof balance==='number'||balance===null)await statMoney(page,lang==='fr'?'Solde':'Balance',balance,lang);
}
async function toggleOpen(page){if(await summary(page).getAttribute('aria-expanded')!=='true')await summary(page).click();await details(page).waitFor();}
async function currentFilters(page){return Promise.all([page.locator('.house-filter-row input[type=date]').nth(0).inputValue(),page.locator('.house-filter-row input[type=date]').nth(1).inputValue(),page.locator('.house-filter-row > label select').first().inputValue(),page.locator('.house-worker-filter select').inputValue()]);}
const csvRows=csv=>csv.split(/\r?\n/).filter(Boolean).map(line=>[...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(m=>m[1].replaceAll('""','"')));
async function exportCheck(page,expected,filename){const event=page.waitForEvent('download');await page.getByRole('button',{name:/^(Export CSV|CSV export)$/}).click();const csv=readFileSync(await(await event).path(),'utf8'),rows=csvRows(csv),index=rows[0].findIndex(c=>['Frais annexes','Additional expenses'].includes(c));assert.ok(index>=0);const actual=rows.slice(1).reduce((sum,row)=>sum+Math.round(Number(row[index]||0)*100),0)/100;assert.equal(actual,expected);writeFileSync(join(output,filename),csv);return rows;}
async function noOverflow(page){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile document fits viewport');for(const element of [summary(page),details(page)]){const box=await element.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=await page.evaluate(()=>innerWidth)+1,'Expense element fits viewport');}}
let owner;
try{
 owner=await start();const {page}=owner;
 await test('FR owner: exact Clément total includes expenses after seventh history row; due and payment remain single-counted',async()=>{
  await scope(page);await total(page,58.9);const stats=page.locator('.house-summary-grid > .stat-card');assert.equal(await stats.count(),6);await financial(page,250,58.9,308.9,50,258.9);assert.equal(await stat(page,'À payer').count(),0);assert.match(await stat(page,'Montant des heures').innerText(),/Hors frais annexes/);assert.match(await stat(page,'Total heures + frais').innerText(),/Avant déduction des paiements/);assert.equal(await page.getByText(/Pour les forfaits sélectionnés/).count(),0);
  await page.locator('.house-tabs').getByRole('button',{name:'Heures',exact:true}).click();assert.equal(await page.locator('.house-time-history-item').count(),7);assert.equal(await page.locator('#house-time-personnel-expense-clement-7').count(),0);
  await summary(page).focus();await page.keyboard.press('Enter');await details(page).waitFor();assert.equal(await details(page).locator('.house-expense-row').count(),3);assert.match(await details(page).innerText(),/Trajet fictif au-delà des sept premières lignes/);assert.match(await details(page).innerText(),/08\/10\/2026/);assert.equal(await details(page).locator('time').first().getAttribute('dateTime'),'2026-10-01');assert.match(await details(page).innerText(),/Clément fictif/);assert.match(await details(page).innerText(),/Maison B des frais fictifs/);
  const before=await currentFilters(page);await summary(page).click();await summary(page).click();assert.deepEqual(await currentFilters(page),before);await page.locator('.house-control-card').screenshot({path:join(output,'owner-summary-fr.png')});
 });
 await test('Worker/date/house filters recompute all expense rows and readable legacy French civil dates',async()=>{
  await scope(page,'clement','a');await total(page,10.1);await financial(page,125,10.1,135.1,35.1,100);assert.equal(await details(page).locator('.house-expense-row').count(),1);
  await scope(page,'clement','b');await total(page,48.8);await financial(page,125,48.8,173.8,14.9,158.9);assert.equal(await details(page).locator('.house-expense-row').count(),2);
  await scope(page,'clement','Tous','2026-10-08','2026-10-10');await total(page,48.8);
  await scope(page,'clement','b','2026-10-10','2026-10-10');await total(page,.2);
  await scope(page,'other');await total(page,8.4);assert.equal(await details(page).locator('time').innerText(),'04/10/2026');assert.equal(await details(page).locator('time').getAttribute('dateTime'),'2026-10-04');
  await scope(page,'empty');await total(page,0);await financial(page,25,0,25,0,25);assert.match(await summary(page).innerText(),/Aucun frais enregistré/);assert.match(await details(page).innerText(),/Aucun frais enregistré/);assert.equal(await details(page).locator('.house-expense-row').count(),0);
  await scope(page,'clement','Tous','2026-11-01','2026-11-30');await financial(page,0,0,0,0,0);assert.equal(await page.getByText(/Pour les forfaits sélectionnés/).count(),0);await scope(page,'other','Tous','2026-09-30','2026-09-30');await total(page,99);await scope(page);await total(page,58.9);
 });
 await test('FR CSV includes all ten filtered interventions; expense column sums exactly to card and excludes previous month',async()=>{
  const rows=await exportCheck(page,58.9,'personnel-fr-before.csv');const interventions=rows.slice(1).filter(r=>r[0]==='Heures');assert.equal(interventions.length,10);assert.equal(interventions.filter(r=>Number(r[11])>0).length,3);assert.equal(rows.flat().includes('Frais fictif hors période'),false);
 });
 await test('Owner summary editor saves an intervention beyond visible seven, keeps filters and updates exact total after real re-read',async()=>{
  const before=await currentFilters(page),row=details(page).locator('.house-expense-row').filter({hasText:'Trajet fictif au-delà des sept premières lignes'});await row.getByRole('button',{name:'Modifier les frais',exact:true}).click();const editor=row.locator('section');await editor.locator('[name=expenseAmount]').fill('60,25');await editor.locator('[name=expenseNote]').fill('Trajet fictif corrigé et confirmé');
  const response=page.waitForResponse(r=>r.url().endsWith('/rpc/crm_update_house_time_expenses')&&r.request().method()==='POST');await editor.locator('button[type=submit]').click();assert.equal((await response).status(),200);await editor.waitFor({state:'detached'});await total(page,70.55);await financial(page,250,70.55,320.55,50,270.55);assert.deepEqual(await currentFilters(page),before);assert.equal(writes.length,1);assert.equal(writes[0].p_id,'personnel-expense-clement-7');assert.deepEqual(writes[0].p_patch,{expenseAmount:60.25,expenseNote:'Trajet fictif corrigé et confirmé'});
  await exportCheck(page,70.55,'personnel-fr-after.csv');await page.reload();await summary(page).waitFor();await scope(page);await total(page,70.55);await financial(page,250,70.55,320.55,50,270.55);await toggleOpen(page);assert.match(await details(page).innerText(),/Trajet fictif corrigé et confirmé/);
 });
 await owner.context.close();owner=null;
 await test('Restricted contributor: actual expense save from detail, no global payload and existing history edit action preserved',async()=>{
  const restricted=await start('contributor');try{const page=restricted.page;await scope(page);await toggleOpen(page);await total(page,70.55);const row=details(page).locator('.house-expense-row').filter({hasText:'Transport fictif initial'});await row.getByRole('button',{name:'Modifier les frais',exact:true}).click();const editor=row.locator('section');await editor.locator('[name=expenseAmount]').fill('10,11');const response=page.waitForResponse(r=>r.url().endsWith('/rpc/crm_update_house_time_expenses')&&r.request().method()==='POST');await editor.locator('button[type=submit]').click();assert.equal((await response).status(),200);await editor.waitFor({state:'detached'});await total(page,70.56);await financial(page,250,70.56,320.56,50,270.56);await page.locator('.house-tabs').getByRole('button',{name:'Heures',exact:true}).click();assert.ok(await page.locator('.house-time-history-item').getByRole('button',{name:'Modifier les frais',exact:true}).count()>0);assert(!restricted.requests.some(r=>r.path==='/rest/v1/crm_workspace_state'));}finally{await restricted.context.close();}
 });
 await test('EN touch mobile reader: all selected expenses readable, no editing or export permission, zero-state clear',async()=>{
  const mobile=await start('reader',390,'en');try{const page=mobile.page;await scope(page);await toggleOpen(page);await total(page,70.56,'en');await financial(page,250,70.56,320.56,50,270.56,'en');assert.equal(await details(page).locator('.house-expense-row').count(),3);assert.match(await details(page).innerText(),/Expense reason/);assert.equal(await page.getByRole('button',{name:'Edit expenses',exact:true}).count(),0);const exportButton=page.getByRole('button',{name:/^(Export CSV|CSV export)$/});if(await exportButton.count())assert.equal(await exportButton.isDisabled(),true);await noOverflow(page);await page.screenshot({path:join(output,'reader-mobile-en.png'),fullPage:true});await scope(page,'empty');await total(page,0,'en');assert.match(await summary(page).innerText(),/No expenses recorded/);assert.match(await details(page).innerText(),/No expenses recorded/);assert(!mobile.requests.some(r=>r.path==='/rest/v1/crm_workspace_state'));}finally{await mobile.context.close();}
 });
 await test('EN mobile contributor: totals and CSV agree; editor retains draft when changing language and stays within viewport',async()=>{
  const mobile=await start('contributor',390,'en');try{const page=mobile.page;await scope(page);await toggleOpen(page);await total(page,70.56,'en');await exportCheck(page,70.56,'personnel-en.csv');const row=details(page).locator('.house-expense-row').filter({hasText:'Transport fictif initial'});await row.getByRole('button',{name:'Edit expenses',exact:true}).click();await row.locator('[name=expenseAmount]').fill('42,10');await row.locator('[name=expenseNote]').fill('Brouillon fictif conservé');await page.locator('#unified-more-trigger').click();await page.locator('[data-language-selector]:visible').getByRole('button',{name:'Français — FR',exact:true}).click();await page.locator('.unified-more-close').click();assert.equal(await row.locator('[name=expenseAmount]').inputValue(),'42,10');assert.equal(await row.locator('[name=expenseNote]').inputValue(),'Brouillon fictif conservé');await row.locator('section').getByRole('button',{name:'Annuler',exact:true}).click();await total(page,70.56);await noOverflow(page);await page.screenshot({path:join(output,'contributor-mobile-fr.png'),fullPage:true});}finally{await mobile.context.close();}
 });
 await test('Actual local prepaid selection: canonical consumption stays separate from debt, reserved payment and filtered uncovered hours',async()=>{
  const run=await start();try{const page=run.page;await scope(page,'worker-prepaid');await statMoney(page,'Montant des heures',266.66);await statMoney(page,'Total heures + frais',266.66);await statMoney(page,'À payer',0);await statMoney(page,'Payé',0);assert.equal(await page.locator('.house-summary-grid > .stat-card').count(),7);assert.match(await stat(page,'Solde').innerText(),/2 h.*à couvrir/);assert.equal(await page.getByText(/Pour les forfaits sélectionnés/).count(),1);
   await scope(page,'worker-prepaid','Tous','2026-10-01','2026-10-01');await statMoney(page,'Montant des heures',33.33);await statMoney(page,'Total heures + frais',33.33);await statMoney(page,'À payer',0);await statMoney(page,'Solde',0);
   await scope(page,'Tous');await statMoney(page,'Montant des heures',591.66);await statMoney(page,'Frais annexes',81.16);await statMoney(page,'Total heures + frais',672.82);await statMoney(page,'À payer',406.16);await statMoney(page,'Payé',50);assert.match(normalize(await stat(page,'Solde').innerText()),/2 h.*356,16/);
  }finally{await run.context.close();}
 });
 await test('Display-only local response projections: canonical server allocation wins over stale embedded snapshot; unavailable prepaid is unknown and hourly selection stays known',async()=>{
  const canonical=await start('owner',1440,'fr','canonical');try{await scope(canonical.page,'worker-prepaid');await statMoney(canonical.page,'Montant des heures',266.66);await statMoney(canonical.page,'Total heures + frais',266.66);}finally{await canonical.context.close();}
  const unknown=await start('owner',1440,'fr','unknown');try{const page=unknown.page;await scope(page,'worker-prepaid');await statMoney(page,'Montant des heures',null);await statMoney(page,'Total heures + frais',null);await statMoney(page,'Frais annexes',0);await statMoney(page,'À payer',0);await statMoney(page,'Solde',null);await scope(page);await financial(page,250,70.56,320.56,50,270.56);assert.equal(await page.getByText(/Pour les forfaits sélectionnés/).count(),0);assert.equal(await stat(page,'À payer').count(),0);}finally{await unknown.context.close();}
 });
 await test('Display-only local half-cent projections keep hours + fees = total = paid + balance for partial and full payment',async()=>{
  for(const [projection,paid,balance] of [['fraction-partial',2.01,3.02],['fraction-full',5.03,0]]){const run=await start('owner',1440,'fr',projection);try{await scope(run.page);await financial(run.page,5.01,.02,5.03,paid,balance);}finally{await run.context.close();}}
 });
 await test('No-access profile cannot see Personnel summary or request house data',async()=>{const none=await start('none');try{assert.equal(await summary(none.page).count(),0);assert(!none.requests.some(r=>r.path==='/rest/v1/crm_workspace_state'||r.path.endsWith('/rpc/crm_read_module')));}finally{await none.context.close();}});
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 writeFileSync(join(output,'browser-results.json'),JSON.stringify({passed:results.length,results,browser:browser.version(),pageErrors:errors,externalRequests:external,evidence:'Integrated application with real disposable local Auth/RPC/PostgreSQL. Mobile is Chromium touch emulation at 390px; production never contacted. Two named allocation/unavailability checks transform actual local read responses in memory only; successful expense saves and reloads use real local Auth/RPC/PostgreSQL.'},null,2));
} catch(error){if(owner){await owner.page.screenshot({path:join(output,'failure.png'),fullPage:true});writeFileSync(join(output,'failure.private.json'),JSON.stringify({error:String(error),text:await owner.page.locator('body').innerText(),errors,external},null,2));}throw error;}
finally{await owner?.context.close();await browser.close();}
