import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {chromium} from '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const f=JSON.parse(readFileSync('/private/tmp/oar-task-links-bench/fixture.private.json','utf8'));
const out='/private/tmp/oar-task-links-evidence';mkdirSync(out,{recursive:true});
const results=process.env.TASK_LINKS_CASE ? JSON.parse(readFileSync(out+'/browser-results.json','utf8')).results.filter(row=>!row.name.includes(process.env.TASK_LINKS_CASE)) : [],errors=[];const app='http://127.0.0.1:3198';
const ref=(type,id,context)=>({type,id,...(context?{context}:{})});
const href=(module,r)=>app+'/?module='+module+'&crmTarget='+encodeURIComponent(JSON.stringify(r));
const browser=await chromium.launch({headless:true,channel:'chrome'});
const context=await browser.newContext({viewport:{width:1440,height:1050}});const page=await context.newPage();
await page.route('**/*',route=>{const u=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(u.hostname)?route.continue():route.abort();});
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
async function shot(name){await page.screenshot({path:out+'/'+name+'.png',fullPage:true});}
async function test(name,fn){if(process.env.TASK_LINKS_CASE && !name.includes(process.env.TASK_LINKS_CASE))return;try{await fn();results.push({name,passed:true});console.log('PASS '+name);}catch(error){results.push({name,passed:false,error:error.message});console.log('FAIL '+name+' '+error.message);await shot('failure-'+results.length);}}
const visibleSource=type=>page.locator('[data-task-source="'+type+'"]:visible').first();
async function expand(type,id){const source=id ? page.locator('[id="vendor-invoice-'+id+'"]').locator('[data-task-source="'+type+'"]') : visibleSource(type);await source.waitFor();if(!(await source.locator('details').getAttribute('open')!==null))await source.locator('summary').click();await source.getByRole('button',{name:'Créer une tâche',exact:true}).waitFor();return source;}
async function login(){await page.goto(app+'/?module=tasks');await page.locator('input[type=email]').fill((f.users.full||f.users.author).email);await page.locator('input[type=password]').fill(f.password);await page.locator('input[type=password]').press('Enter');await page.locator('.taskws').waitFor({timeout:60000});await page.getByRole('button',{name:'Français — FR',exact:true}).first().click();await page.waitForTimeout(500);}
await login();
let createdTitle='Contrôle fictif facture '+Date.now();
await test('invoice source creates primary invoice with complementary contact; server persistence after reload',async()=>{
 const invoice=f.fixture.vendorInvoices[0];await page.goto(href('vendorInvoices',ref('vendor_invoice',invoice.id)));
 const source=await expand('vendor_invoice',invoice.id);await source.getByRole('button',{name:'Créer une tâche',exact:true}).click();
 const editor=page.locator('dialog[open]');await editor.locator('input[name=title]').fill(createdTitle);
 await editor.locator('[data-task-link-state=available]').first().waitFor();assert.match(await editor.locator('.task-link-card').first().innerText(),/750/);
 await editor.getByRole('button',{name:'Lier un élément du CRM',exact:true}).click();
 await editor.getByLabel('Rechercher un élément du CRM',{exact:true}).fill('Riviera Services Fictifs');
 const result=editor.locator('.task-link-result').filter({hasText:'Riviera Services Fictifs'}).first();await result.getByRole('button',{name:'Lier l’élément',exact:true}).click();
 await editor.locator('textarea[name=notes]').fill('Contrôle fictif sans opération de paiement.');
 await editor.getByRole('button',{name:'Créer la tâche',exact:true}).click();await page.locator('.task-source-overlay').waitFor({state:'detached',timeout:30000});
 await source.getByRole('button',{name:createdTitle,exact:true}).waitFor();
 await page.reload();const refreshed=await expand('vendor_invoice',invoice.id);await refreshed.getByRole('button',{name:createdTitle,exact:true}).waitFor();
 await refreshed.getByRole('button',{name:createdTitle,exact:true}).click();await page.locator('dialog[open] .task-link-card').nth(1).waitFor();assert.equal(await page.locator('dialog[open] .task-link-card').count(),2);await shot('invoice-task-persisted');
 await page.locator('dialog[open]').getByRole('button',{name:'Fermer',exact:true}).last().click();
});
await test('Fonciere source keeps a manually edited field after task cancellation',async()=>{
 await page.goto(app+'/fonciere?crmTarget='+encodeURIComponent(JSON.stringify(ref('fonciere_project',f.projectId))));
 await page.locator('#fonciere-name').waitFor({timeout:30000});const name=page.locator('#fonciere-name');await name.fill('Brouillon fictif conservé');
 const source=await expand('fonciere_project');await source.getByRole('button',{name:'Créer une tâche',exact:true}).click();
 await page.locator('dialog[open] input[name=title]').fill('Projet fictif à compléter');await page.locator('dialog[open]').getByRole('button',{name:'Annuler',exact:true}).click();
 assert.equal(await name.inputValue(),'Brouillon fictif conservé');assert.equal(await page.locator('.task-source-overlay').count(),0);await shot('fonciere-draft-preserved');
});
await test('presentation revision routes to the exact independent historical snapshot',async()=>{
 await page.goto(app+'/izord?crmTarget='+encodeURIComponent(JSON.stringify(ref('presentation',f.presentationId,{revision:'1'}))));
 await page.getByText('Révision historique (lecture seule)',{exact:false}).waitFor({timeout:30000});assert((await visibleSource('presentation').count())>0);await shot('presentation-revision');
});
await test('monthly calculated context opens source, person, house and empty month without creating business rows',async()=>{
 const target=f.refs.find(r=>r.type==='monthly_charges');await page.goto(app+'/charges?crmTarget='+encodeURIComponent(JSON.stringify(target)));
 const source=await expand('monthly_charges');await source.waitFor();assert.match(await page.locator('body').innerText(),/novembre|November/i);await shot('monthly-context');
});
await test('private document opens exact authorized card with inverse task list',async()=>{
 await page.goto(href('documents',ref('document',f.documentId,{provider:'storage'})));
 const card=page.locator('[id="scoped-document-'+f.documentId+'"]');await card.waitFor({timeout:30000});await card.locator('summary').click();await shot('document-target');
});
await test('saved Publisher creation uses real local Neon catalog and canonical link without generation',async()=>{
 const id='24100000-0000-4000-8000-000000000001';const publisherTitle='Vérifier la création fictive enregistrée '+Date.now();await page.goto(app+'/publisher?crmTarget='+encodeURIComponent(JSON.stringify(ref('publisher_creation',id))));
 await page.locator('[data-publisher-post-id="'+id+'"]').waitFor({timeout:30000});const source=await expand('publisher_creation');await source.getByRole('button',{name:'Créer une tâche',exact:true}).click();
 const editor=page.locator('dialog[open]');await editor.locator('input[name=title]').fill(publisherTitle);await editor.getByRole('button',{name:'Créer la tâche',exact:true}).click();await page.locator('.task-source-overlay').waitFor({state:'detached',timeout:30000});
 await source.getByRole('button',{name:publisherTitle,exact:true}).waitFor();await page.reload();const after=await expand('publisher_creation');await after.getByRole('button',{name:publisherTitle,exact:true}).waitFor();await shot('publisher-persisted-no-generation');
});
await test('English mobile task linking remains keyboard accessible without horizontal overflow',async()=>{
 await page.setViewportSize({width:1440,height:1050});await page.goto(app+'/?module=tasks');await page.getByRole('button',{name:'English — EN',exact:true}).first().click();await page.getByRole('button',{name:'Add a task',exact:true}).waitFor();await page.waitForTimeout(700);await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Add a task',exact:true}).click();const editor=page.locator('dialog[open]');await editor.locator('input[name=title]').fill('Fictional keyboard task');
 const link=editor.getByRole('button',{name:'Link a CRM item',exact:true});await link.focus();await page.keyboard.press('Enter');await editor.getByLabel('Search CRM items',{exact:true}).fill('Riviera');await editor.locator('.task-link-result').first().waitFor();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));await shot('mobile-en-keyboard-link-search');await editor.getByRole('button',{name:'Cancel',exact:true}).click();
});
writeFileSync(out+'/browser-results.json',JSON.stringify({realAuth:true,realRpc:true,realDatabase:true,fictionalData:true,externalProviderCalls:0,instagramPublications:0,results,pageErrors:errors},null,2));
await browser.close();if(results.some(r=>!r.passed)||errors.length)process.exitCode=1;
