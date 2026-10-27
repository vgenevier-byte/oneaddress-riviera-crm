/** Existing full validation confirmation on a persisted synthetic informational quote. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {connect,sql,directory,status,payload} from './local.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require('/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fixture=JSON.parse(readFileSync(join(directory,'fixtures.private.json'),'utf8'));
const origin='http://127.0.0.1:3207';const errors=[],external=[],confirms=[];
const browser=await chromium.launch({headless:true,channel:'chrome'});
await connect();try{
 const before=await payload();const quote=before.vendorQuotes.find(q=>q.quoteReference===(process.env.VENDOR_INFORMATION_APPROVAL_REFERENCE||'DEMO-UI-FULL'));assert.equal(quote.status,'Pour information');assert.ok(quote.quoteDocumentStoragePath);assert.equal(before.vendorInvoices.filter(i=>i.sourceQuoteId===quote.id).length,0);
 const context=await browser.newContext({viewport:{width:1440,height:1050}});const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{if(d.type()==='confirm')confirms.push(d.message());await d.accept();});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(['http:','https:'].includes(u.protocol)&&![origin,status.API_URL].includes(u.origin)){external.push(u.origin+u.pathname);return route.abort('blockedbyclient');}return route.continue();});
 await page.goto(origin+'/?module=vendorQuotes');await page.locator('input[type=email]').fill(fixture.users.owner.email);await page.locator('input[autocomplete=current-password]').fill(fixture.users.owner.password);await page.getByRole('button',{name:/^(Se connecter|Sign in)$/}).click();const card=page.locator('[data-notification-target="vendor-quote-'+quote.id+'"]');await card.waitFor({timeout:60000});await card.getByRole('button',{name:/^(Valider|Approve)$/i}).click();await card.locator('.status-pill.semantic-success').waitFor();assert.equal(confirms.length,1);assert.ok(confirms[0].includes(quote.quoteReference));
 for(let i=0;i<150;i++){if((await payload()).vendorQuotes.find(q=>q.id===quote.id).status==='Validé')break;await page.waitForTimeout(100);}
 const after=await payload();assert.equal(after.vendorQuotes.find(q=>q.id===quote.id).status,'Validé');assert.equal(after.vendorInvoices.filter(i=>i.sourceQuoteId===quote.id).length,1);assert.equal(after.vendorInvoices.length,before.vendorInvoices.length+1);for(const invoice of before.vendorInvoices){const saved=after.vendorInvoices.find(i=>i.id===invoice.id);for(const [key,value]of Object.entries(invoice))assert.deepEqual(saved[key],value,'Existing invoice field '+key);}assert.deepEqual(after.housePayments,before.housePayments);assert.equal((await sql.query("select status from app_private.task_records where id='manual-information-task'")).rows[0].status,'À faire');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);const file='docs/vendor-information/browser-results.json';const result=JSON.parse(readFileSync(file,'utf8'));result.results.push({name:'Full existing approval flow requires actual confirmation and creates one invoice for persisted informational quote with document; existing finance/payment/manual task unchanged',passed:true});result.passed=result.results.length;result.confirmations=confirms.map(message=>({message}));writeFileSync(file,JSON.stringify(result,null,2)+'\n');console.log('PASS explicit full UI confirmation validates informational quote and creates one invoice; preserved existing finance/task');await context.close();
}finally{await browser.close();await sql.end();}
