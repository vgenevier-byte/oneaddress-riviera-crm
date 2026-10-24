/** StrictMode regression: actual Auth and exact production components on the
 * isolated loopback app; creates and cancels a draft without business writes. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {chromium} from '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const fixture=JSON.parse(readFileSync('/private/tmp/oar-task-links-bench/fixture.private.json','utf8'));
const app='http://127.0.0.1:3198',output='/private/tmp/oar-task-links-evidence';mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const results=[],errors=[];
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
  await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(app+'/?module=tasks');
  await page.locator('input[type=email]').fill((fixture.users.full||fixture.users.author).email);
  await page.locator('input[type=password]').fill(fixture.password);await page.locator('input[type=password]').press('Enter');
  await page.locator('.taskws').waitFor({timeout:60000});
  const invoice=fixture.fixture.vendorInvoices[0];
  const target={type:'vendor_invoice',id:invoice.id};
  await page.goto(app+'/?module=vendorInvoices&crmTarget='+encodeURIComponent(JSON.stringify(target)));
  const source=page.locator('[data-task-source="vendor_invoice"]:visible').first();await source.waitFor();
  await source.locator('summary').click();await source.getByRole('button',{name:'Créer une tâche',exact:true}).click();
  const editor=page.locator('dialog[open]').last();
  await editor.locator('input[name=title]').waitFor({timeout:15000});
  assert((await editor.locator('input[name=title]').inputValue()).length>0,'source draft admitted during StrictMode setup/cleanup/setup');
  await editor.locator('.task-link-card[data-task-link-state="available"]').first().waitFor();
  assert.match(await editor.locator('.task-link-card').first().innerText(),/Facture|facture/);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
  const geometry=await editor.boundingBox();assert(geometry&&geometry.x>=0&&geometry.x+geometry.width<=width+1);
  assert.equal(await editor.locator('.task-contact-picker').count(),1,'one legacy contact picker after asynchronous reference resolution');
  assert.equal(await editor.locator('.task-links-editor').count(),1,'one general links editor');
  writeFileSync(output+'/strictmode-editor-'+width+'.html',await editor.innerHTML());
  await editor.locator('textarea[name=notes]').fill('Brouillon fictif annulé, aucune opération métier.');
  await page.screenshot({path:output+'/strictmode-source-editor-'+width+'.png',fullPage:false});
  await editor.locator('.task-links-editor').scrollIntoViewIfNeeded();
  await page.screenshot({path:output+'/strictmode-source-links-'+width+'.png',fullPage:false});
  await editor.getByRole('button',{name:'Annuler',exact:true}).click();
  await page.locator('.task-source-overlay').waitFor({state:'detached'});
  await source.waitFor();assert.equal(await source.locator('details').getAttribute('open'),'');
  results.push({name:'StrictMode source draft admitted once and cancelled to preserved source '+width,passed:true});
  await context.close();
 }
 assert.deepEqual(errors,[]);
 writeFileSync(output+'/source-intent-results.json',JSON.stringify({actualAuth:true,actualComponents:true,isolatedLoopback:true,businessWrites:0,taskWrites:0,results,pageErrors:errors},null,2));
 console.log(JSON.stringify({passed:results.length,pageErrors:errors.length}));
}finally{await browser.close();}
