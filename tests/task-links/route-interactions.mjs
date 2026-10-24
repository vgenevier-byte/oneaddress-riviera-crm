/** Authenticated UI-only navigation, keyboard and retained-draft checks.
 * No task or business mutation is submitted. Outbound requests are loopback-only. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import assert from 'node:assert/strict';
const {chromium}=await import('/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const f=JSON.parse(readFileSync('/private/tmp/oar-task-links-bench/fixture.private.json','utf8'));
const account=process.argv.includes('--author')?'author':'full', taskIdentity=account==='author'?f.task.id:f.fullTask.id;
const evidence='/private/tmp/oar-task-links-evidence';mkdirSync(evidence,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'}),results=[],errors=[];
const context=await browser.newContext({viewport:{width:390,height:844}});await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
async function test(name,fn){try{await fn();results.push({name,passed:true});console.log('PASS '+name);}catch(e){results.push({name,passed:false,error:e.message});console.log('FAIL '+name+' '+e.message);await page.screenshot({path:evidence+'/interaction-failure-'+results.length+'.png',fullPage:false});}}
const url=(tab,ref)=>'http://127.0.0.1:3198/?module='+tab+(ref?'&crmTarget='+encodeURIComponent(JSON.stringify(ref)):'');
try{
 await page.goto(url('tasks'));await page.locator('input[type=email]').fill(f.users[account].email);await page.locator('input[type=password]').fill(f.password);await page.locator('input[type=password]').press('Enter');await page.locator('.taskws').waitFor({timeout:60000});assert.equal(await page.locator('#unified-more-trigger:visible').count(),1,'one visible navigation host');
 await test('mobile keyboard task detail opens exact invoice and browser Back restores tasks without a blocking dialog',async()=>{
  const task=page.locator('[data-task-id="'+taskIdentity+'"]');await task.locator('.taskws-title').focus();await page.keyboard.press('Enter');const detail=page.locator('dialog[open]');await detail.waitFor();
  const invoice=detail.locator('.task-link-card').filter({hasText:/Facture prestataire|Vendor invoice/});await invoice.getByRole('button',{name:/^(Ouvrir l’élément|Open item)$/}).click();await page.waitForURL('**/*module=vendorInvoices*');await page.locator('#vendor-invoice-'+f.fixture.vendorInvoices[0].id).waitFor({state:'visible'});
  assert.equal(await page.locator('dialog[open]').count(),0);await page.goBack();await page.locator('.taskws:visible').waitFor();assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.locator('#unified-more-trigger:visible').count(),1,'one visible navigation after Back');
 });
 await test('mobile EN local task editor retains unsaved title when opening exact archived RIB in a new tab',async()=>{
  await page.locator('[data-retained-crm-host] #unified-more-trigger').click();await page.locator('#unified-more-panel').getByRole('button',{name:'English — EN',exact:true}).click();await page.locator('#unified-more-panel .unified-more-close').click();const task=page.locator('[data-task-id="'+taskIdentity+'"]');await task.locator('.taskws-card-actions button').nth(1).click();const editor=page.locator('dialog[open]');await editor.locator('input[name=title]').fill('Unsaved fictitious title');
  assert.match(await editor.innerText(),/Linked items/);const rib=editor.locator('.task-link-card').filter({hasText:'Bank account'});const popupPromise=context.waitForEvent('page');await rib.getByRole('button',{name:'Open item in a new tab',exact:true}).click();const popup=await popupPromise;await popup.waitForLoadState('domcontentloaded');assert(popup.url().includes('bank_account'));
  assert.equal(await editor.locator('input[name=title]').inputValue(),'Unsaved fictitious title');await page.screenshot({path:evidence+'/mobile-en-unsaved-task-preserved.png',fullPage:false});await popup.close();await editor.locator('.taskws-dialog-heading button').click();
 });
 await test('contact form draft survives keyboard-created task draft and cancellation',async()=>{
  await page.goto(url('contacts',f.refs.find(r=>r.type==='contact')));await page.locator('#contact-detail-panel').waitFor({state:'visible'});await page.locator('#contact-detail-panel .confirm-actions .primary-button').click();const source=page.locator('#contact-edit-panel');await source.waitFor({state:'visible'});
  const notes=source.locator('textarea[name=notes]');await notes.fill('Unsaved fictitious contact notes');const links=source.locator('[data-task-source=contact]');await links.locator('summary').focus();await page.keyboard.press('Enter');const create=links.getByRole('button',{name:/^(Create a task|Créer une tâche)$/});await create.focus();await page.keyboard.press('Enter');const taskEditor=page.locator('dialog[open]');await taskEditor.locator('input[name=title]').waitFor();await taskEditor.getByRole('button',{name:/^(Cancel|Annuler)$/}).click();await page.locator('.task-source-overlay').waitFor({state:'detached'});assert.equal(await notes.inputValue(),'Unsaved fictitious contact notes');await page.screenshot({path:evidence+'/mobile-contact-draft-preserved.png',fullPage:false});
 });
 await test('real workspace folder opens exact contents with inverse task section without fabricated records',async()=>{
  await page.goto(url('documents',{type:'folder',id:f.fixture.documents[0].id}));await page.locator('#document-current-task-folder [data-task-source=folder]').waitFor({state:'visible'});assert.match(await page.locator('.document-current-folder-note').innerText(),/Dossier fictif/);await page.screenshot({path:evidence+'/workspace-folder-exact-mobile.png',fullPage:false});
 });
 assert.deepEqual(errors,[]);
}finally{writeFileSync(evidence+'/route-interactions-results.json',JSON.stringify({account,appMode:process.argv.includes('--production')?'production-local':'dev-local',results,pageErrors:errors,loopbackOnly:true,businessWrites:0,taskWrites:0},null,2));await browser.close();}
if(results.some(r=>!r.passed)||errors.length)process.exitCode=1;
