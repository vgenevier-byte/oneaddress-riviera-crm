/** Actual UI -> local Auth -> prepaid RPC -> PostgreSQL. All identities/sources fictitious. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { assertPrepaidLocalTarget } from './server-local-target.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const status=JSON.parse(readFileSync(process.env.PREPAID_HOURS_STATUS_FILE,'utf8'));
const origin='http://127.0.0.1:3197';
assertPrepaidLocalTarget({api:status.API_URL,database:status.DB_URL,app:origin,mail:'http://127.0.0.1:56034',acknowledgement:process.env.IZORD_TEST_ACK});
const fixture=JSON.parse(readFileSync(join(dirname(process.env.PREPAID_HOURS_STATUS_FILE),'fixtures.private.json'),'utf8'));
const output=join(process.cwd(),'docs/prepaid-hours/captures');mkdirSync(output,{recursive:true});
const results=[],errors=[],external=[];
const browser=await chromium.launch({headless:true,channel:"chrome"});
const normalize=s=>s.replace(/[\u00a0\u202f]/g,' ');
async function launch(who='owner',width=1440,lang='fr',failLedger=false){
 const context=await browser.newContext({viewport:{width,height:1050},...(width<500?{isMobile:true,hasTouch:true}:{})});
 const user=fixture.users[who];
 await context.addInitScript(({lang,id})=>{localStorage.setItem('oar.ui-language.v1:anonymous',lang);localStorage.setItem('oar.ui-language.v1:account:'+id,lang);},{lang,id:user.id});
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(['http:','https:'].includes(url.protocol)&&![origin,status.API_URL].includes(url.origin)){external.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
  if(failLedger&&url.pathname.endsWith('/rpc/crm_house_prepaid_state'))return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'local test unavailable'})});
  return route.continue();
 });
 const page=await context.newPage();page.setDefaultTimeout(18000);
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const requests=[];page.on('request',r=>{if(r.url().startsWith(status.API_URL+'/rest/v1/rpc/'))requests.push({path:new URL(r.url()).pathname,body:r.postData()});});
 await page.goto(origin+'/?module=houseTracking');
 await page.locator('input[type=email]').fill(user.email);await page.locator('input[autocomplete=current-password]').fill(user.password);
 await page.getByRole('button',{name:/^(Se connecter|Sign in)$/}).click();await page.locator('.house-tracking-view').waitFor();
 const panel=page.locator('[data-prepaid-worker="worker-prepaid"]');
 if(!failLedger)await panel.waitFor();
 return {context,page,panel,requests};
}
async function metric(panel,label,value){const found=panel.locator('dl > div').filter({has:panel.page().getByText(label,{exact:true})}).locator('dd');await found.waitFor();for(let i=0;i<100&&normalize(await found.innerText())!==value;i++)await panel.page().waitForTimeout(100);assert.equal(normalize(await found.innerText()),value);}
const test=async(name,fn)=>{await fn();results.push({name,passed:true});console.log('PASS '+name);};
let full;
try{
 await test('FR desktop first paid package:32h completed,30h covered,2h uncovered,500EUR paid',async()=>{
  full=await launch();await metric(full.panel,'Heures réalisées','32 h');await metric(full.panel,'Heures achetées','30 h');await metric(full.panel,'Heures disponibles','0 h');await metric(full.panel,'Heures à couvrir','2 h');await metric(full.panel,'Montant effectivement payé','500,00 €');
  assert.match(normalize(await full.panel.innerText()),/Renouvellement de 30 h à prévoir : 500,00 €/);
  await full.panel.screenshot({path:join(output,'first-32h-2h.png')});
 });
 await test('date and house filters leave the global32h/2h balance intact; quarter-hour editor replaces hourly rate',async()=>{
  const {page,panel}=full;
  await page.locator('.house-control-card input[type=date]').nth(0).fill('2026-10-01');await page.locator('.house-control-card input[type=date]').nth(1).fill('2026-10-31');
  await page.locator('.house-filter-row select').first().selectOption('house-b',{force:true});await page.locator('.house-worker-filter select').selectOption('worker-prepaid',{force:true});
  await metric(panel,'Heures réalisées','32 h');await metric(panel,'Heures à couvrir','2 h');
  await page.locator('.house-tabs').getByRole('button',{name:/^(Heures|Hours)$/}).click();
  const form=page.locator('.house-two-columns > section').first().locator('form');
  await form.locator('select').nth(1).selectOption('worker-prepaid',{force:true});
  assert.match(normalize(await form.innerText()),/Forfait prépayé.*30 h.*500,00.*Crédit global disponible/s);
  assert.equal(await form.locator('input[inputmode=decimal]').count(),1,'Only ancillary expense amount remains; no required hourly rate');
  for(const group of ['Heure de début','Heure de fin']){const minutes=form.getByRole('group',{name:group}).locator('select').nth(1);assert.deepEqual(await minutes.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value)),['00','15','30','45']);}
 });
 await test('EN mobile and restricted reader show the same complete balance without write controls',async()=>{
  const mobile=await launch('reader',390,'en');await metric(mobile.panel,'Hours completed','32 h');await metric(mobile.panel,'Hours to cover','2 h');
  assert.ok(await mobile.panel.getByRole('button',{name:/Renew the package|Record a paid package/}).evaluateAll(nodes=>nodes.every(node=>node.disabled)));
  assert.ok(await mobile.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No mobile horizontal overflow');
  await mobile.panel.screenshot({path:join(output,'first-mobile-en.png')});await mobile.context.close();
 });
 await test('ledger error shows unavailable balance and never a global nothing-to-pay conclusion',async()=>{
  const unavailable=await launch('contributor',1280,'fr',true);
  await unavailable.page.getByRole('alert').filter({hasText:/Lecture complète/}).waitFor();
  assert.match(await unavailable.page.locator('.house-summary-grid').innerText(),/—/);
  assert.doesNotMatch(await unavailable.page.locator('.house-today-grid').innerText(),/Rien à payer/i);
  await unavailable.context.close();
 });
 await test('explicit real-payment confirmation renews once through the actual UI and shows28h available',async()=>{
  const {page,panel,requests}=full;
  await panel.getByRole('button',{name:'Renouveler le forfait',exact:true}).click();
  const form=panel.locator('form').last();await form.locator('select[name=source]').selectOption('new');
  assert.equal(await form.locator('input[name=capacityHours]').inputValue(),'30');assert.equal(await form.locator('input[name=price]').inputValue(),'500');
  await form.locator('input[name=date]').fill('2026-10-26');await form.locator('select[name=houseId]').selectOption('house-a');await form.locator('input[name=confirmed]').check();
  const count=requests.filter(r=>r.path.endsWith('/crm_save_house_prepaid')).length;
  await form.getByRole('button',{name:'Confirmer le forfait payé',exact:true}).dblclick();
  await metric(panel,'Heures disponibles','28 h');await metric(panel,'Heures à couvrir','0 h');await metric(panel,'Heures achetées','60 h');await metric(panel,'Montant effectivement payé','1 000,00 €');
  assert.equal(requests.filter(r=>r.path.endsWith('/crm_save_house_prepaid')).length-count,1,'One pending-aware save despite double-click');
  await panel.screenshot({path:join(output,'renewed-28h.png')});
 });
 await test('fresh Auth restricted contributor persists renewal, history/payment IDs and hourly worker still has its rate',async()=>{
  const fresh=await launch('contributor',390,'en');await metric(fresh.panel,'Hours available','28 h');await metric(fresh.panel,'Hours purchased','60 h');
  await fresh.panel.locator('details summary').click();assert.match(await fresh.panel.innerText(),/Exhausted/);
  await fresh.panel.screenshot({path:join(output,'renewed-mobile-en.png')});
  await fresh.page.locator('.house-tabs').getByRole('button',{name:'Hours',exact:true}).click();
  const form=fresh.page.locator('.house-two-columns > section').first().locator('form');await form.locator('select').nth(1).selectOption('worker-hourly',{force:true});
  assert.equal(await form.locator('input[inputmode=decimal]').count(),2,'Hourly rate plus ancillary expense remain for hourly worker');
  await fresh.context.close();
 });
 assert.deepEqual(errors,[],'No browser runtime errors');assert.deepEqual(external,[],'No external network traffic');
 writeFileSync(join(process.cwd(),'docs/prepaid-hours/browser-results.json'),JSON.stringify({passed:results.length,results,runtimeErrors:errors,externalRequests:external,evidence:'Actual local Auth/RPC with fictitious sources; production not exercised'},null,2));
}finally{await full?.context.close();await browser.close();}
