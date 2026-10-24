import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import('/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const fixture=JSON.parse(readFileSync('/private/tmp/oar-task-links-bench/fixture.private.json','utf8'));
const evidence='/private/tmp/oar-task-links-evidence';mkdirSync(evidence,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const results=[],errors=[];
const modules={contact:'contacts',bank_account:'contacts',lead:'leads',quote:'quotes',booking:'bookings',vendor_quote:'vendorQuotes',vendor_invoice:'vendorInvoices',worker:'houseTracking',worker_period:'houseTracking',time_entry:'houseTracking',staff_payment:'houseTracking',house:'houseTracking',property:'properties',vehicle:'vehicles',boat:'boats',planning_entry:'planning'};
const href=ref=>'http://127.0.0.1:3198/?module='+modules[ref.type]+'&crmTarget='+encodeURIComponent(JSON.stringify(ref));
async function guard(page){await page.route('**/*',route=>{const u=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(u.hostname)?route.continue():route.abort();});page.on('pageerror',e=>errors.push(e.message));}
async function login(page,key){await page.goto('http://127.0.0.1:3198/?module=tasks');await page.locator('input[type=email]').fill(fixture.users[key].email);await page.locator('input[type=password]').fill(fixture.password);await page.locator('form button:not([type])').click();await page.locator('.taskws').waitFor({timeout:60000});}
async function check(name,fn){try{await fn();results.push({name,passed:true});console.log('PASS '+name);}catch(e){results.push({name,passed:false,error:e.message});console.log('FAIL '+name+': '+e.message);}}
for(const key of (process.argv.includes('--restricted')?['assignee']:['full','assignee'])){
 const page=await browser.newPage({viewport:{width:key==='full'?1440:390,height:key==='full'?1000:844}});await guard(page);await login(page,key);
 const restricted=await page.locator('.business-workspace').count()>0; console.log('ACCOUNT '+key+' restrictedDOM='+restricted);
 const refs=fixture.refs.filter(ref=>modules[ref.type]&&ref.type!=='vehicle'&&(!process.argv.includes('--bank-only')||ref.type==='bank_account'));
 for(const ref of refs){await check(key+' exact '+ref.type,async()=>{
   await page.goto(href(ref));await page.waitForTimeout(450);await (ref.type==='bank_account'?page.locator('#'+(restricted?'scoped-bank-account-':'bank-account-')+ref.id+' [data-task-source="bank_account"]'):page.locator('[data-task-source="'+ref.type+'"]').first()).waitFor({state:'visible',timeout:30000});
   let exact;
   if(ref.type==='bank_account')exact=page.locator('#'+(restricted?'scoped-bank-account-':'bank-account-')+ref.id);
   else if(ref.type==='time_entry')exact=page.locator('#house-time-'+ref.id);
   else if(ref.type==='staff_payment')exact=page.locator('#house-payment-'+ref.id);
   else if(ref.type==='house')exact=page.locator('#house-'+ref.id);
   else if(['quote','booking','vendor_quote','vendor_invoice','planning_entry'].includes(ref.type))exact=page.locator('#'+({vendor_quote:'vendor-quote-',vendor_invoice:'vendor-invoice-',planning_entry:'planning-'}[ref.type]||ref.type+'-')+ref.id);
   if(exact)assert(await exact.isVisible(),'exact record not visible');
   if(key==='assignee')assert.equal(await page.locator('#unified-more-trigger:visible').count(),1,'one visible mobile navigation host');
   if(ref.type==='worker_period'){
    const dateValues=await page.locator('input[type=date]').evaluateAll(nodes=>nodes.map(node=>node.value));
    assert(dateValues.includes('2026-11-01')&&dateValues.includes('2026-11-30'),'period filters absent '+dateValues.join(','));
    assert.match(await page.locator('body').innerText(),/Aucune|No |aucune|Pas d’/);
   }
   if(['bank_account','worker_period','property','boat','planning_entry'].includes(ref.type))await page.screenshot({path:evidence+'/'+key+'-'+ref.type+'.png',fullPage:true});
 });}
 await page.close();
}
writeFileSync(evidence+(process.argv.includes('--restricted')?'/routes-restricted-results.json':'/routes-results.json'),JSON.stringify({appMode:process.argv.includes('--production')?'production-local':'dev-local',actualAuth:true,loopbackOnly:true,taskWrites:0,businessWrites:0,results,errors},null,2));await browser.close();if(results.some(r=>!r.passed)||errors.length)process.exitCode=1;
