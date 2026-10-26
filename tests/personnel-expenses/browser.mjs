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
async function start(who='owner',width=1440,lang='fr'){
 const user=fixture.users[who],context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true,...(width<500?{isMobile:true,hasTouch:true}:{})});
 await context.addInitScript(({id,lang})=>{localStorage.setItem('oar.ui-language.v1:anonymous',lang);localStorage.setItem('oar.ui-language.v1:account:'+id,lang);},{id:user.id,lang});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(['http:','https:'].includes(u.protocol)&&![origin,status.API_URL].includes(u.origin)){external.push(u.origin+u.pathname);return route.abort();}return route.continue();});
 const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const requests=[];page.on('request',r=>{if(r.url().startsWith(status.API_URL)){requests.push({method:r.method(),path:new URL(r.url()).pathname,body:r.postData()});if(r.method()==='POST'&&r.url().endsWith('/rpc/crm_update_house_time_expenses'))writes.push(r.postDataJSON());}});
 await page.goto(origin+'/?module=houseTracking');await page.locator('input[type=email]').fill(user.email);await page.locator('input[autocomplete=current-password]').fill(user.password);await page.getByRole('button',{name:/^(Se connecter|Sign in)$/}).click();
 if(who==='none'){await page.getByRole('heading',{name:/^(Aucun accès autorisé|No access granted)$/}).waitFor();return {context,page,requests};}
 await summary(page).waitFor({timeout:90000});await page.locator('[data-prepaid-worker="worker-prepaid"]').waitFor();return {context,page,requests};
}
async function scope(page,worker='clement',house='Tous',from='2026-10-01',to='2026-10-31'){
 await page.locator('.house-filter-row input[type=date]').nth(0).fill(from);await page.locator('.house-filter-row input[type=date]').nth(1).fill(to);
 await page.locator('.house-filter-row > label select').first().selectOption(house==='Tous'?house:'personnel-expense-house-'+house,{force:true});
 await page.locator('.house-worker-filter select').selectOption(worker==='Tous'?worker:'personnel-expense-'+worker,{force:true});
}
async function total(page,expected,lang='fr'){
 const value=new Intl.NumberFormat(lang==='fr'?'fr-FR':'en-GB',{style:'currency',currency:'EUR'}).format(expected);
 await page.waitForFunction(({expected})=>document.querySelector('.house-expense-summary strong')?.textContent?.replace(/[\u00a0\u202f]/g,' ')===expected,{expected:normalize(value)});
 assert.equal(normalize(await summary(page).locator('strong').innerText()),normalize(value));
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
  await scope(page);await total(page,58.9);const stats=page.locator('.house-summary-grid > .stat-card');assert.equal(await stats.count(),5);assert.match(normalize(await stats.nth(1).innerText()),/308,90/);assert.match(normalize(await stats.nth(2).innerText()),/50,00/);assert.match(normalize(await stats.nth(3).innerText()),/258,90/);
  await page.locator('.house-tabs').getByRole('button',{name:'Heures',exact:true}).click();assert.equal(await page.locator('.house-time-history-item').count(),7);assert.equal(await page.locator('#house-time-personnel-expense-clement-7').count(),0);
  await summary(page).focus();await page.keyboard.press('Enter');await details(page).waitFor();assert.equal(await details(page).locator('.house-expense-row').count(),3);assert.match(await details(page).innerText(),/Trajet fictif au-delà des sept premières lignes/);assert.match(await details(page).innerText(),/08\/10\/2026/);assert.equal(await details(page).locator('time').first().getAttribute('dateTime'),'2026-10-01');assert.match(await details(page).innerText(),/Clément fictif/);assert.match(await details(page).innerText(),/Maison B des frais fictifs/);
  const before=await currentFilters(page);await summary(page).click();await summary(page).click();assert.deepEqual(await currentFilters(page),before);await page.locator('.house-control-card').screenshot({path:join(output,'owner-summary-fr.png')});
 });
 await test('Worker/date/house filters recompute all expense rows and readable legacy French civil dates',async()=>{
  await scope(page,'clement','a');await total(page,10.1);assert.equal(await details(page).locator('.house-expense-row').count(),1);
  await scope(page,'clement','b');await total(page,48.8);assert.equal(await details(page).locator('.house-expense-row').count(),2);
  await scope(page,'clement','Tous','2026-10-08','2026-10-10');await total(page,48.8);
  await scope(page,'clement','b','2026-10-10','2026-10-10');await total(page,.2);
  await scope(page,'other');await total(page,8.4);assert.equal(await details(page).locator('time').innerText(),'04/10/2026');assert.equal(await details(page).locator('time').getAttribute('dateTime'),'2026-10-04');
  await scope(page,'empty');await total(page,0);assert.match(await summary(page).innerText(),/Aucun frais enregistré/);assert.match(await details(page).innerText(),/Aucun frais enregistré/);assert.equal(await details(page).locator('.house-expense-row').count(),0);
  await scope(page,'other','Tous','2026-09-30','2026-09-30');await total(page,99);await scope(page);await total(page,58.9);
 });
 await test('FR CSV includes all ten filtered interventions; expense column sums exactly to card and excludes previous month',async()=>{
  const rows=await exportCheck(page,58.9,'personnel-fr-before.csv');const interventions=rows.slice(1).filter(r=>r[0]==='Heures');assert.equal(interventions.length,10);assert.equal(interventions.filter(r=>Number(r[11])>0).length,3);assert.equal(rows.flat().includes('Frais fictif hors période'),false);
 });
 await test('Owner summary editor saves an intervention beyond visible seven, keeps filters and updates exact total after real re-read',async()=>{
  const before=await currentFilters(page),row=details(page).locator('.house-expense-row').filter({hasText:'Trajet fictif au-delà des sept premières lignes'});await row.getByRole('button',{name:'Modifier les frais',exact:true}).click();const editor=row.locator('section');await editor.locator('[name=expenseAmount]').fill('60,25');await editor.locator('[name=expenseNote]').fill('Trajet fictif corrigé et confirmé');
  const response=page.waitForResponse(r=>r.url().endsWith('/rpc/crm_update_house_time_expenses')&&r.request().method()==='POST');await editor.locator('button[type=submit]').click();assert.equal((await response).status(),200);await editor.waitFor({state:'detached'});await total(page,70.55);assert.deepEqual(await currentFilters(page),before);assert.equal(writes.length,1);assert.equal(writes[0].p_id,'personnel-expense-clement-7');assert.deepEqual(writes[0].p_patch,{expenseAmount:60.25,expenseNote:'Trajet fictif corrigé et confirmé'});
  await exportCheck(page,70.55,'personnel-fr-after.csv');await page.reload();await summary(page).waitFor();await scope(page);await total(page,70.55);await toggleOpen(page);assert.match(await details(page).innerText(),/Trajet fictif corrigé et confirmé/);
 });
 await owner.context.close();owner=null;
 await test('Restricted contributor: actual expense save from detail, no global payload and existing history edit action preserved',async()=>{
  const restricted=await start('contributor');try{const page=restricted.page;await scope(page);await toggleOpen(page);await total(page,70.55);const row=details(page).locator('.house-expense-row').filter({hasText:'Transport fictif initial'});await row.getByRole('button',{name:'Modifier les frais',exact:true}).click();const editor=row.locator('section');await editor.locator('[name=expenseAmount]').fill('10,11');const response=page.waitForResponse(r=>r.url().endsWith('/rpc/crm_update_house_time_expenses')&&r.request().method()==='POST');await editor.locator('button[type=submit]').click();assert.equal((await response).status(),200);await editor.waitFor({state:'detached'});await total(page,70.56);await page.locator('.house-tabs').getByRole('button',{name:'Heures',exact:true}).click();assert.ok(await page.locator('.house-time-history-item').getByRole('button',{name:'Modifier les frais',exact:true}).count()>0);assert(!restricted.requests.some(r=>r.path==='/rest/v1/crm_workspace_state'));}finally{await restricted.context.close();}
 });
 await test('EN touch mobile reader: all selected expenses readable, no editing or export permission, zero-state clear',async()=>{
  const mobile=await start('reader',390,'en');try{const page=mobile.page;await scope(page);await toggleOpen(page);await total(page,70.56,'en');assert.equal(await details(page).locator('.house-expense-row').count(),3);assert.match(await details(page).innerText(),/Expense reason/);assert.equal(await page.getByRole('button',{name:'Edit expenses',exact:true}).count(),0);const exportButton=page.getByRole('button',{name:/^(Export CSV|CSV export)$/});if(await exportButton.count())assert.equal(await exportButton.isDisabled(),true);await noOverflow(page);await page.screenshot({path:join(output,'reader-mobile-en.png'),fullPage:true});await scope(page,'empty');await total(page,0,'en');assert.match(await summary(page).innerText(),/No expenses recorded/);assert.match(await details(page).innerText(),/No expenses recorded/);assert(!mobile.requests.some(r=>r.path==='/rest/v1/crm_workspace_state'));}finally{await mobile.context.close();}
 });
 await test('EN mobile contributor: totals and CSV agree; editor retains draft when changing language and stays within viewport',async()=>{
  const mobile=await start('contributor',390,'en');try{const page=mobile.page;await scope(page);await toggleOpen(page);await total(page,70.56,'en');await exportCheck(page,70.56,'personnel-en.csv');const row=details(page).locator('.house-expense-row').filter({hasText:'Transport fictif initial'});await row.getByRole('button',{name:'Edit expenses',exact:true}).click();await row.locator('[name=expenseAmount]').fill('42,10');await row.locator('[name=expenseNote]').fill('Brouillon fictif conservé');await page.locator('#unified-more-trigger').click();await page.locator('[data-language-selector]:visible').getByRole('button',{name:'Français — FR',exact:true}).click();await page.locator('.unified-more-close').click();assert.equal(await row.locator('[name=expenseAmount]').inputValue(),'42,10');assert.equal(await row.locator('[name=expenseNote]').inputValue(),'Brouillon fictif conservé');await row.locator('section').getByRole('button',{name:'Annuler',exact:true}).click();await total(page,70.56);await noOverflow(page);await page.screenshot({path:join(output,'contributor-mobile-fr.png'),fullPage:true});}finally{await mobile.context.close();}
 });
 await test('No-access profile cannot see Personnel summary or request house data',async()=>{const none=await start('none');try{assert.equal(await summary(none.page).count(),0);assert(!none.requests.some(r=>r.path==='/rest/v1/crm_workspace_state'||r.path.endsWith('/rpc/crm_read_module')));}finally{await none.context.close();}});
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 writeFileSync(join(output,'browser-results.json'),JSON.stringify({passed:results.length,results,browser:browser.version(),pageErrors:errors,externalRequests:external,evidence:'Integrated application with real disposable local Auth/RPC/PostgreSQL. Mobile is Chromium touch emulation at 390px; production never contacted.'},null,2));
} catch(error){if(owner){await owner.page.screenshot({path:join(output,'failure.png'),fullPage:true});writeFileSync(join(output,'failure.private.json'),JSON.stringify({error:String(error),text:await owner.page.locator('body').innerText(),errors,external},null,2));}throw error;}
finally{await owner?.context.close();await browser.close();}
