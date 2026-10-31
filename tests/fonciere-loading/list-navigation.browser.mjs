/** Full CRM, real owned local Auth/RPC/Storage. No successful response mocks. */
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const f = JSON.parse(readFileSync(process.env.COLLAPSE_FIXTURE, 'utf8'));
assert.equal(f.api, 'http://127.0.0.1:56031'); assert.equal(f.app, 'http://127.0.0.1:3197');
const out = process.env.LIST_NAVIGATION_OUTPUT || '/private/tmp/project-list-evidence'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const checks = [], errors = [];
const pass = message => { checks.push(message); console.log("PASS "+message); };
const record = f.performance.records.find(r => r.count === 24);
const workspace = page => page.locator('[data-fonciere-projects]:visible');
async function menu(page, tab) {
 const mobile = page.viewportSize().width < 1024;
 if (mobile && !await page.locator('#unified-more-panel:visible').count()) await page.locator('#unified-more-trigger:visible').click();
 const nav = page.locator(mobile ? '#unified-more-panel:visible' : '.sidebar:visible');
 const button = nav.locator(`[data-navigation-module="${tab}"]`);
 if (!await button.isVisible()) await nav.locator(`[data-navigation-group="${tab === 'fonciere' ? 'fonciere' : 'crm'}"]`).click();
 await button.click();
}
async function section(page, id) {
 const node = workspace(page).locator(`[data-project-section="${id}"]`);
 if (await node.locator('[data-section-toggle]').getAttribute('aria-expanded') !== 'true') await node.locator('[data-section-toggle]').click();
 return node;
}
async function login(mobile, lang, profile = 'admin', target = record.id) {
 const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 900 } : { width: 1440, height: 1000 } });
 await context.addInitScript(({id,lang}) => { localStorage.setItem('oar.ui-language.v1:anonymous',lang); localStorage.setItem('oar.ui-language.v1:account:'+id,lang); }, { id:f.users[profile].id, lang });
 await context.route('**/*', async route => {
  const u = new URL(route.request().url());
  if (['http:','https:'].includes(u.protocol) && ![f.api,f.app].includes(u.origin)) return route.abort();
  if (u.pathname === '/api/fonciere/photo-preview') await new Promise(r => setTimeout(r, 1200));
  return route.continue();
 });
 const page = await context.newPage(); page.setDefaultTimeout(45000); page.on('pageerror',e=>errors.push(e.message));
 let accept = true, dialogs = [];
 page.on('dialog', async d => { dialogs.push(d.message()); if (accept) await d.accept(); else await d.dismiss(); });
 await page.goto(f.app+'/fonciere?project='+target);
 await page.locator('input[type=email]').fill(f.users[profile].email);
 await page.locator('input[autocomplete=current-password]').fill(f.users[profile].password);
 await page.getByRole('button',{name:/^(Se connecter|Sign in)$/}).click();
 await page.locator('[data-project-section=identity]').waitFor();
 dialogs.length = 0; // Authentication can replace the login document.
 return {page,context,dialogs,setAccept:v=>accept=v};
}
async function list(page) {
 await page.waitForURL(f.app+"/fonciere");
 await workspace(page).locator('[data-project-section]').first().waitFor({state:'detached'});
 assert.equal(page.url(), f.app+'/fonciere');
 assert.equal(await workspace(page).locator('[data-project-section]').count(),0);
}
try {
 for (const [mobile,lang] of (process.env.LIST_CASE ? [] : [[false,'fr'],[true,'en']])) {
  const run=await login(mobile,lang),{page}=run;
  await section(page,'documents');
  await menu(page,'fonciere'); await list(page);
  assert.deepEqual(run.dialogs,[]);
  await page.waitForTimeout(1800); await list(page);
  if(mobile) assert.equal(await page.locator('#unified-more-panel:visible').count(),0);
  pass(`${lang}/${mobile?'mobile':'desktop'}: direct record to menu list without confirmation; late previews cannot reopen`);
  const search=workspace(page).getByRole('textbox').first(); await search.fill('Mesure fictive');
  await workspace(page).getByRole('combobox',{name:/^(Arbitrage|Arbitration)$/}).selectOption('pending');
  const order=await workspace(page).locator('[role=listitem]').allTextContents();
  const item=workspace(page).locator('[role=listitem]').filter({hasText:record.name}); await item.locator('button').first().click();
  await page.getByRole('heading',{name:record.name,exact:true}).waitFor();
  await menu(page,'fonciere');await list(page);assert.equal(await search.inputValue(),'Mesure fictive');
  assert.equal(await workspace(page).getByRole('combobox',{name:/^(Arbitrage|Arbitration)$/}).inputValue(),'pending');
  assert.deepEqual(await workspace(page).locator('[role=listitem]').allTextContents(),order);
  pass(`${lang}: list search, decision filter and ordering preserved after opening from list and returning from menu`);
  await item.locator('button').first().click();await page.getByRole('heading',{name:record.name,exact:true}).waitFor();
  const hypotheses=await section(page,'hypotheses');await hypotheses.locator('header').getByRole('button',{name:/^(Modifier|Edit)$/}).click();
  const notes=page.locator('#fonciere-notes');await notes.fill('Navigation fictional unsaved '+lang);
  const url=page.url();run.setAccept(false);await menu(page,'fonciere');
  assert.equal(run.dialogs.length,1);assert.equal(page.url(),url);assert.equal(await notes.inputValue(),'Navigation fictional unsaved '+lang);
  run.setAccept(true);await menu(page,'fonciere');await list(page);assert.equal(run.dialogs.length,2);
  pass(`${lang}: one confirmation, cancel preserves URL and text, accepted return retains recoverable local draft`);
  await page.screenshot({path:out+`/list-${lang}.png`});await run.context.close();
 }
 // A new recoverable draft exercises the exact File object and local recovery.
 if (!process.env.LIST_CASE || process.env.LIST_CASE === 'file') {
  const run=await login(false,'fr'),{page}=run;
  await menu(page,'fonciere');await list(page);
  await workspace(page).getByRole('button',{name:'Nouveau projet',exact:true}).click();
  const name=page.locator('#fonciere-name');await name.fill('Brouillon fictif retour liste');
  await section(page,'documents');
  const bytes=Buffer.from('%PDF-1.4\n% Fichier fictif navigation\n%%EOF');
  await page.getByLabel('Ajouter des documents',{exact:true}).setInputFiles({name:'navigation-fictive.pdf',mimeType:'application/pdf',buffer:bytes});
  await workspace(page).getByText('navigation-fictive.pdf',{exact:true}).waitFor();
  const draftUrl=page.url();run.setAccept(false);await menu(page,'fonciere');
  assert.equal(page.url(),draftUrl);assert.equal(await name.inputValue(),'Brouillon fictif retour liste');
  assert.equal(await workspace(page).getByText('navigation-fictive.pdf',{exact:true}).count(),1);
  assert.equal(run.dialogs.length,1);
  run.setAccept(true);await menu(page,'fonciere');await list(page);assert.equal(run.dialogs.length,2);
  const resume=workspace(page).getByRole('link',{name:/Reprendre le brouillon/});await resume.click();
  await page.waitForURL(draftUrl);assert.equal(await name.inputValue(),'Brouillon fictif retour liste');
  await section(page,'documents');await workspace(page).getByText('navigation-fictive.pdf',{exact:true}).waitFor();
  // Contacts creation/cancellation returns to this draft rather than the list.
  await section(page,'agency');
  await page.locator('[data-owner-link-details] summary').click();
  await page.locator('[data-project-owners]').getByRole('button',{name:'Créer un propriétaire personne',exact:true}).click();
  await page.locator('.contact-create-form:visible').waitFor();
  await page.getByRole('button',{name:'Annuler et revenir au projet',exact:true}).click();
  await page.locator('[data-project-owners]:visible').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('draft'),new URL(draftUrl).searchParams.get('draft'));
  assert.equal(await name.inputValue(),'Brouillon fictif retour liste');
  pass('Pending file and text survive cancellation, accepted list return, local draft recovery and Contacts cancellation return');
  // Delay the real local create request, then let the write finish normally.
  await page.route('**/rest/v1/rpc/fonciere_create_project',async route=>{await new Promise(resolve=>setTimeout(resolve,1800));await route.continue();});
  const writing=page.waitForRequest(request=>request.url().endsWith('/rpc/fonciere_create_project'));
  await workspace(page).getByRole('button',{name:'Enregistrer',exact:true}).first().click();
  await writing;const writingUrl=page.url(),count=run.dialogs.length;
  await menu(page,'fonciere');assert.equal(page.url(),writingUrl);
  assert.equal(run.dialogs.length,count+1);assert.match(run.dialogs.at(-1),/opération est en cours/);
  await page.waitForURL(url=>url.searchParams.has('project'));await workspace(page).getByText('Mode lecture',{exact:true}).waitFor();
  await menu(page,'fonciere');await list(page);
  pass('Menu explains temporary block during real save/upload; write finishes normally before list return');
  await run.context.close();
 }
 if (!process.env.LIST_CASE || process.env.LIST_CASE === 'arbitrage') {
  const run=await login(false,'fr','vincent',f.projects.assigned),{page}=run;
  await menu(page,'fonciere');await list(page);assert.equal(run.dialogs.length,0);
  pass('Read-only account returns to its authorized list without confirmation');
  await run.context.close();
 }
 if (!process.env.LIST_CASE || process.env.LIST_CASE === 'arbitrage') {
  const run=await login(false,'fr','annCharlotte',f.projects.consultation),{page}=run;
  const arb=await section(page,'arbitrage');const own=arb.locator('[data-opinion=ann_charlotte]');
  await arb.locator('[data-status]').waitFor();
  await own.getByRole('button',{name:'Modifier mon avis',exact:true}).click();
  await own.getByRole('radio',{name:'À approfondir',exact:true}).check();
  await own.locator('textarea').fill('Remarque fictive navigation non enregistrée');
  const url=page.url();run.dialogs.length=0;run.setAccept(false);await menu(page,'fonciere');
  assert.equal(run.dialogs.length,1);assert.equal(page.url(),url);
  assert.equal(await own.locator('textarea').inputValue(),'Remarque fictive navigation non enregistrée');
  assert(await own.getByRole('radio',{name:'À approfondir',exact:true}).isChecked());
  run.setAccept(true);await menu(page,'fonciere');await list(page);assert.equal(run.dialogs.length,2);
  pass('Unsaved arbitration choice and remark have one confirmation and survive cancellation');
  await run.context.close();
 }
 if (!process.env.LIST_CASE || process.env.LIST_CASE === 'task') {
  const run=await login(false,'fr'),{page}=run;
  const target={type:'fonciere_project',id:record.id};
  // Incoming task route keeps the record, even after a deliberate list return.
  await menu(page,'fonciere');await list(page);
  await page.evaluate(({target})=>{history.pushState(null,'','/fonciere?crmTarget='+encodeURIComponent(JSON.stringify(target))+'#fonciere-documents');window.dispatchEvent(new Event('oar-task-target-navigated'));},{target});
  await page.getByRole('heading',{name:record.name,exact:true}).waitFor();
  assert(new URL(page.url()).searchParams.has('crmTarget'));
  await menu(page,'fonciere');await list(page);await page.waitForTimeout(1800);await list(page);
  await page.evaluate(({target})=>{history.pushState(null,'','/fonciere?crmTarget='+encodeURIComponent(JSON.stringify(target)));window.dispatchEvent(new Event('oar-task-target-navigated'));},{target});
  await page.getByRole('heading',{name:record.name,exact:true}).waitFor();
  pass('Task target opens its record; deliberate menu return removes task target and anchor and cannot reopen it');
  await run.context.close();
 }
 assert.deepEqual(errors,[]);writeFileSync(out+'/'+(process.env.LIST_CASE||'all')+'-results.json',JSON.stringify({checks,errors},null,2)); console.log(checks.join('\n'));
} catch (failure) {
 for (const context of browser.contexts()) for (const page of context.pages()) {
  console.log('DIAGNOSTIC',new URL(page.url()).pathname, await page.locator('[data-project-arbitrage]').innerText().catch(()=>''));
  await page.screenshot({path:out+'/failure.png'}).catch(()=>{});
 }
 throw failure;
} finally { await browser.close(); }
