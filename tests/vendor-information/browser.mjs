/** Real browser -> local Auth/RPC/Storage/Postgres; source-identical CRM copy. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {connect,sql,directory,status,payload} from './local.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require('/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fixture=JSON.parse(readFileSync(join(directory,'fixtures.private.json'),'utf8'));
const origin='http://127.0.0.1:3207',out='docs/vendor-information/captures';mkdirSync(out,{recursive:true});
const results=[],errors=[],external=[],dialogs=[];
const browser=await chromium.launch({headless:true,channel:'chrome'});
const norm=s=>s.replace(/[\u00a0\u202f]/g,' ');
const check=async(name,fn)=>{await fn();results.push({name,passed:true});console.log('PASS '+name);};
const card=(page,id)=>page.locator('[data-notification-target="vendor-quote-'+id+'"]');
const all=(page)=>page.locator('.vendor-quotes-list-card').getByRole('button',{name:/^(Tous|All)$/i});
const info=(page)=>page.locator('.vendor-quotes-list-card').getByRole('button',{name:/^(Pour information|For information)$/i});
const dbQuote=async reference=>(await payload()).vendorQuotes.find(q=>q.quoteReference===reference);
const poll=async(fn,expected)=>{for(let i=0;i<150;i++){if(await fn()===expected)return;await new Promise(r=>setTimeout(r,100));}assert.equal(await fn(),expected);};
async function launch(who='owner',width=1440,language='fr'){
 const context=await browser.newContext({viewport:{width,height:1050},...(width<500?{isMobile:true,hasTouch:true}:{})});
 const u=fixture.users[who];await context.addInitScript(({id,language})=>{localStorage.setItem('oar.ui-language.v1:anonymous',language);localStorage.setItem('oar.ui-language.v1:account:'+id,language);},{id:u.id,language});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&![origin,status.API_URL].includes(url.origin)){external.push(url.origin+url.pathname);return route.abort('blockedbyclient');}return route.continue();});
 const page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push({type:d.type(),message:d.message()});await d.accept();});
 const calls=[];page.on('request',r=>{if(r.url().startsWith(status.API_URL+'/rest/v1/rpc/'))calls.push({name:new URL(r.url()).pathname.split('/').pop(),body:JSON.parse(r.postData()||'{}')});});
 await page.goto(origin+'/?module=vendorQuotes');await page.locator('input[type=email]').fill(u.email);await page.locator('input[autocomplete=current-password]').fill(u.password);await page.getByRole('button',{name:/^(Se connecter|Sign in)$/}).click();await card(page,'pending').waitFor({timeout:60000});
 return {page,context,calls};
}
async function create(subject,reference,session){const {page}=session;const form=page.locator('.vendor-quotes-form-card form');assert.equal(await form.locator('select[name=status]').inputValue(),'À valider');await form.locator('input[role=combobox]').fill('Camille');await form.getByRole('option').first().click();await form.locator('select[name=status]').selectOption('Pour information');await form.locator('input[name=title]').fill(subject);await form.locator('input[name=quoteReference]').fill(reference);await form.locator('input[name=amount]').fill('1 234,50');await form.locator('textarea[name=notes]').fill('Comparaison des tarifs · données fictives');await form.locator('input[name=quoteFile]').setInputFiles({name:'devis-demonstration.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n% Fictional browser quote\n%%EOF')});await form.getByRole('button',{name:/^(Ajouter le devis|Add quote)$/i}).click();await poll(async()=>(await dbQuote(reference))?.status,'Pour information');const row=await dbQuote(reference);await card(page,row.id).waitFor();assert.ok(row.quoteDocumentStoragePath);assert.equal(row.notes,'Comparaison des tarifs · données fictives');assert.equal(row.amount,1234.5);return row;}
await connect();let full;
try{
 const initialFinance=await sql.query("select payload->'vendorInvoices' invoices,payload->'housePayments' payments from public.crm_workspace_state where workspace_id='oneaddress-riviera'");
 await check('FR complete desktop creates informational quote with actual PDF/notes; neutral badge, ordered filters, excludes pending total',async()=>{
  full=await launch();const {page}=full;const filters=page.locator('.vendor-quotes-list-card > div').nth(1).getByRole('button');assert.deepEqual(await filters.allTextContents(),['Tous','À valider','Validé','Refusé','Pour information']);
  const total=norm(await page.locator('.vendor-quotes-list-card .section-heading > div').nth(1).innerText());const q=await create('Comparaison marché · démonstration complète','DEMO-UI-FULL',full);assert.equal(norm(await page.locator('.vendor-quotes-list-card .section-heading > div').nth(1).innerText()),total);
  await card(page,q.id).locator('.status-pill.semantic-neutral').waitFor();await info(page).click();assert.equal(await page.locator('.vendor-quotes-list-card article').count(),1);await page.locator('.vendor-quotes-view').screenshot({path:join(out,'desktop-fr-complete.png')});
  assert.deepEqual((await sql.query("select payload->'vendorInvoices' invoices,payload->'housePayments' payments from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows,initialFinance.rows);
 });
 await check('FR complete desktop classifies pending/refused and restores same ID; explicit invoice-link blocks and manual task retained',async()=>{
  const {page}=full;await all(page).click();const pending=card(page,'pending');await pending.getByRole('button',{name:'Classer pour information',exact:true}).click();await pending.locator('.status-pill.semantic-neutral').waitFor();await pending.getByRole('button',{name:'Remettre à valider',exact:true}).click();await poll(async()=>(await payload()).vendorQuotes.find(q=>q.id==='pending').status,'À valider');const refused=card(page,'refused');await refused.getByRole('button',{name:'Classer pour information',exact:true}).click();await refused.locator('.status-pill.semantic-neutral').waitFor();
  for(const id of ['linked','reverse','broken','inconsistent']){assert.equal(await card(page,id).getByRole('button',{name:'Classer pour information',exact:true}).isDisabled(),true);await card(page,id).getByRole('note').waitFor();}
  assert.equal((await sql.query("select status from app_private.task_records where id='manual-information-task'")).rows[0].status,'À faire');
 });
 await full.context.close();full=null;
 await check('FR restricted desktop contributor has Notes and creates informational quote with staged PDF upload, without Invoice grants',async()=>{
  const session=await launch('contributor');const q=await create('Comparaison marché · parcours restreint','DEMO-UI-RESTRICTED',session);assert.ok(session.calls.some(c=>c.name==='crm_create_vendor_quote'&&c.body.p_status==='Pour information'));assert.ok(session.calls.some(c=>c.name==='crm_new_document'));assert.equal(await card(session.page,q.id).getByRole('button',{name:'Valider',exact:true}).isDisabled(),true);await info(session.page).click();await session.page.locator('.vendor-quotes-view').screenshot({path:join(out,'desktop-fr-restricted.png')});await session.context.close();
 });
 await check('EN restricted mobile fresh login rereads quote/document/notes; filters, neutral badge, classification and return; no horizontal overflow',async()=>{
  const session=await launch('contributor',390,'en');const {page}=session;await info(page).click();const q=await dbQuote('DEMO-UI-RESTRICTED');const row=card(page,q.id);await row.locator('.status-pill.semantic-neutral').waitFor();assert.match(await row.innerText(),/For information/);assert.match(await row.innerText(),/Comparaison des tarifs/);await page.locator('.vendor-quotes-list-card').screenshot({path:join(out,'mobile-en-information.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');await row.getByRole('button',{name:'Return to awaiting approval',exact:true}).click();await poll(async()=>(await dbQuote('DEMO-UI-RESTRICTED')).status,'À valider');await all(page).click();await card(page,q.id).getByRole('button',{name:'Classify for information',exact:true}).click();await card(page,q.id).locator('.status-pill.semantic-neutral').waitFor();await session.context.close();
 });
 await check('FR quote-only mobile contributor classifies without additional invoice rights; server guard rejects hidden reverse link',async()=>{
  const session=await launch('quoteOnly',390,'fr');const {page}=session;await card(page,'pending').getByRole('button',{name:'Classer pour information',exact:true}).click();await card(page,'pending').locator('.status-pill.semantic-neutral').waitFor();await info(page).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('.vendor-quotes-list-card').screenshot({path:join(out,'mobile-fr-quote-only.png')});await all(page).click();const blockedResponse=page.waitForResponse(r=>r.url().endsWith('/rpc/crm_set_vendor_quote_information'));await card(page,'reverse').getByRole('button',{name:'Classer pour information',exact:true}).click();const blocked=await blockedResponse;assert.ok(blocked.status()>=400);assert.equal((await blocked.json()).message,'vendor_quote_has_linked_invoice');assert.equal((await payload()).vendorQuotes.find(q=>q.id==='reverse').status,'À valider');await session.context.close();
 });
 await check('EN desktop complete and mobile reader show For information; reader cannot mutate through UI',async()=>{
  const desktop=await launch('owner',1440,'en');await info(desktop.page).click();await desktop.page.locator('.vendor-quotes-view').screenshot({path:join(out,'desktop-en-complete.png')});assert.match(await desktop.page.locator('.vendor-quotes-list-card').innerText(),/For information/);await desktop.context.close();
  const reader=await launch('reader',390,'en');await info(reader.page).click();for(const button of await reader.page.locator('.vendor-quotes-list-card article').getByRole('button',{name:/Return to awaiting approval|Approve|Reject|Edit|Classify for information/}).all())assert.equal(await button.isDisabled(),true);await reader.page.locator('.vendor-quotes-list-card').screenshot({path:join(out,'mobile-en-reader.png')});assert.ok(await reader.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await reader.context.close();
 });
 assert.deepEqual(errors,[],'No runtime errors');assert.deepEqual(external,[],'No external network traffic');writeFileSync('docs/vendor-information/browser-results.json',JSON.stringify({passed:results.length,results,runtimeErrors:errors,externalRequests:external,dialogs:dialogs.map(d=>({type:d.type,message:d.message})),evidence:{realUi:true,realAuth:true,realRpc:true,realStorage:true,realPostgres:true,fullAndRestricted:true,frAndEn:true,desktopAndMobile:true,productionWrites:false}},null,2)+'\n');
}finally{await full?.context.close();await browser.close();await sql.end();}
