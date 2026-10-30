/** Real isolated persistence and browser exports. Fictional accounts only;
 * no production credentials or external requests are used. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import { connect, sql, fixtureFile, output, ok, login, createGeneratorRepository, createFonciereRepository } from '../fonciere-arbitrage/local.mjs';
const require = createRequire(import.meta.url);
const { toPresentationData } = require('../../lib/fonciere/model');
const { prepareBankPresentation } = require('../../lib/fonciere/bankPresentation');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fixture = JSON.parse(readFileSync(fixtureFile, 'utf8')), users = {}, checks = [], errors = [], external = [];
const dir = join(output, 'consistency-presentations'); mkdirSync(dir, { recursive: true });
assert.equal(fixture.app, 'http://127.0.0.1:3197'); assert.equal(fixture.api, 'http://127.0.0.1:56031');
const MARKER = 'PRIVATE_CONSISTENCY_OWNER', CONTACT_MARKER = 'PRIVATE_CONTACT_SENTINEL';
for (const name of ['admin', 'vincent', 'annCharlotte']) users[name] = await login(fixture.users[name]);
await connect();
let browser, context, page, project, manualId, bankId, persisted;
const source = createFonciereRepository(users.admin.client), generator = createGeneratorRepository(users.admin.client);
const read = () => ok(users.admin.client.rpc('fonciere_arbitrage_read', { p_project: project }));
async function vote(who) { const state = await read(); return ok(users[who].client.rpc('fonciere_arbitrage_vote', { p_project: project, p_fingerprint: state.fingerprint, p_choice: 'approved', p_remark: MARKER + ' approval' })); }
async function test(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); writeFileSync(join(dir, 'progress.json'), JSON.stringify(checks, null, 2)); }
function privateAbsent(data) { const text = typeof data === 'string' ? data : JSON.stringify(data); for (const marker of [MARKER, CONTACT_MARKER, 'ownerContext']) assert(!text.includes(marker), 'Private marker leaked: ' + marker); }
async function row(id) { return (await sql.query('select * from public.izord_projects where id=$1', [id])).rows[0]; }
async function openPresentation(id) {
  await page.goto(fixture.app + '/izord?crmTarget=' + encodeURIComponent(JSON.stringify({ type: 'presentation', id })));
  await page.locator('input[type=email], .crm-shell:visible').first().waitFor({ timeout: 90000 });
  if (await page.locator('input[type=email]').count()) {
    await page.locator('input[type=email]').first().fill(fixture.users.admin.email); await page.locator('input[autocomplete=current-password]').fill(fixture.users.admin.password); await page.getByRole('button', { name: /^(Se connecter|Sign in)$/ }).click();
  }
  await page.locator('.crm-shell:visible').waitFor({ timeout: 90000 }); await page.locator('#izord-project').waitFor({ timeout: 90000 });
  await page.waitForFunction(() => document.querySelector('#izord-project')?.value?.includes('Villa fictive'));
}
async function browserExports(name, id) {
  await openPresentation(id);
  const visible = page.locator('[data-izord-generator]:visible');
  let pending = page.waitForEvent('download'); await visible.getByRole('button', { name: /^Exporter le JSON/ }).click(); let download = await pending;
  const json = readFileSync(await download.path(), 'utf8'); privateAbsent(json); const exported=JSON.parse(json);assert.equal(exported.state.acq,'900000');assert.equal(exported.state.monthly,'');assert.equal(exported.importMeta.presentationRentalPlan.scenarios[0].periods[0].rate,5000);await download.saveAs(join(dir,name+'.json'));
  const button = visible.getByRole('button', { name: /Générer le PowerPoint/ }); assert(!await button.isDisabled(), 'PowerPoint available: ' + name);
  pending = page.waitForEvent('download', { timeout: 120000 }); await button.click(); download = await pending;
  const zip = await JSZip.loadAsync(readFileSync(await download.path())); const xml = Object.keys(zip.files).filter(path => /\.(xml|rels)$/.test(path) && !zip.files[path].dir), notes = xml.filter(path => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(path));
  assert(notes.length>=2);const parts=await Promise.all(xml.map(p=>zip.file(p).async('string')));const text=parts.join(' ').replace(/<[^>]+>/g,' ').replace(/[\s\u202f\u00a0]/g,'');for(const n of ['60000','55000','1100000'])assert(text.includes(n),'Missing export value '+n);assert(!text.includes('48000'),'Stale original reference revenue in exported slide/notes');
 for (const path of xml) privateAbsent(await zip.file(path).async('string')); await download.saveAs(join(dir, name + '.pptx'));
  return { xmlParts: xml.length, notesParts: notes.length, markerOccurrences: 0 };
}
const exported = {};
const {rentalResults}=require('../../lib/fonciere/rentals');
try {
 project=fixture.projects.consistencySource;persisted=await source.loadProject(project,{arbitration:true});manualId=fixture.consistencyManual;
 const beforeManual=await generator.loadProject(fixture.consistencyManual);const beforeSource=(await sql.query('select * from fonciere_projects where id=$1',[project])).rows[0],beforeOther=await row(fixture.consistencyOther),beforeOpinions=(await sql.query('select * from app_private.fonciere_arbitrage_opinions order by project_id,slot')).rows;
 const {presentationRentalPlan}=require('../../lib/izord/rental-model');
 browser=await chromium.launch({headless:true,channel:'chrome'});context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
 await context.addInitScript(id=>{localStorage.setItem('oar.ui-language.v1:anonymous','fr');localStorage.setItem('oar.ui-language.v1:account:'+id,'fr');},fixture.users.admin.id);
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&![fixture.app,fixture.api].includes(url.origin)){external.push(url.origin+url.pathname);return route.abort();}return route.continue();});page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await test('Presentation-specific acquisition/rent controls drive live results, save/relogin/preview/JSON/PPTX and notes from one model',async()=>{
  await openPresentation(manualId);const editor=page.locator('[data-presentation-rental-editor]');await editor.waitFor();assert.equal(await page.getByRole('button',{name:'Enregistrer dans Projets',exact:true}).count(),0);assert.equal(await page.locator('#izord-acq').count(),0);assert.equal(await page.locator('#izord-monthly').count(),0);await editor.locator('#rental-cost-acquisition').fill('900000');await editor.locator('input[type=checkbox]').first().check();const scenario=editor.locator('[data-rental-scenario]').first();await scenario.locator(':scope > summary').click();await scenario.locator('input[id$="-rate"]').fill('5000');const live=page.locator('[data-presentation-rental-results]');assert((await live.innerText()).includes('60'));const response=page.waitForResponse(r=>r.url().endsWith('/rpc/izord_save_generator'));await page.locator('[data-izord-generator]').getByRole('button',{name:'Enregistrer',exact:true}).first().click();assert.equal((await response).status(),200);const saved=await generator.loadProject(manualId);assert.equal(saved.data.state.acq,'900000');assert.equal(rentalResults(presentationRentalPlan(saved.data.importMeta))[0].gross,60000);assert.deepEqual(saved.data.importMeta.fonciereSnapshot,beforeManual.data.importMeta.fonciereSnapshot);await page.reload();await page.locator('#rental-cost-acquisition').waitFor();assert.equal((await page.locator('#rental-cost-acquisition').inputValue()).replace(/[\s\u202f,]/g,''),'900000');assert((await page.locator('[data-presentation-rental-results]').innerText()).includes('60'));const preview=(await page.locator('[data-presentation-rentals]').innerText()).replace(/[\s\u202f,]/g,'');for(const n of ['60000','55000','1100000'])assert(preview.includes(n));exported.edited=await browserExports('coherent-edited-presentation',manualId);await editor.screenshot({path:join(dir,'presentation-edit.png')});
 });
 await test('Editing the presentation leaves source project, source opinions and all other saved presentations byte-for-byte unchanged',async()=>{assert.deepEqual((await sql.query('select * from fonciere_projects where id=$1',[project])).rows[0],beforeSource);assert.deepEqual(await row(fixture.consistencyOther),beforeOther);assert.deepEqual((await sql.query('select * from app_private.fonciere_arbitrage_opinions order by project_id,slot')).rows,beforeOpinions);});
 await test('Save in Projects from a snapshot without source ID preserves structured historical assumptions/calendar/notes and creates only a separate project',async()=>{
  await openPresentation(fixture.consistencyDetached);const original=await generator.loadProject(fixture.consistencyDetached);assert(!original.data.importMeta.fonciereSource);const created=page.waitForResponse(r=>r.url().endsWith('/rpc/fonciere_create_project'));await page.getByRole('button',{name:'Enregistrer dans Projets',exact:true}).click();const id=await(await created).json();await page.getByRole('button',{name:'Enregistrer dans Projets',exact:true}).waitFor({state:'hidden',timeout:90000});const fresh=await source.loadProject(id);assert.deepEqual(fresh.data.guided,persisted.data.guided);assert.equal(fresh.data.notes,persisted.data.notes);assert.deepEqual(fresh.data.rentalPlan,persisted.data.rentalPlan);assert.deepEqual((await sql.query('select * from fonciere_projects where id=$1',[project])).rows[0],beforeSource);
 });
 await test('English mobile presentation controls/results and keyboard confirmation stay coherent without page overflow',async()=>{
  await context.close();context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});await context.addInitScript(id=>{localStorage.setItem('oar.ui-language.v1:anonymous','en');localStorage.setItem('oar.ui-language.v1:account:'+id,'en');},fixture.users.admin.id);await context.route('**/*',route=>{const u=new URL(route.request().url());if(['http:','https:'].includes(u.protocol)&&![fixture.app,fixture.api].includes(u.origin))return route.abort();return route.continue();});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await openPresentation(manualId);const editor=page.locator('[data-presentation-rental-editor]');await editor.waitFor();assert.equal((await editor.locator('#rental-cost-acquisition').inputValue()).replace(/[\s\u202f,]/g,''),'900000');const amount=editor.locator('#rental-cost-acquisition');await amount.focus();await page.keyboard.press('Tab');const checkbox=editor.locator('input[type=checkbox]').first();assert(await checkbox.isChecked(),'Focus/blur of grouped English money does not alter the amount or confirmation');assert.equal((await amount.inputValue()).replace(/[\s\u202f,]/g,''),'900000');await checkbox.focus();await page.keyboard.press('Space');assert(!await checkbox.isChecked());await page.keyboard.press('Space');assert(await checkbox.isChecked());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await editor.screenshot({path:join(dir,'presentation-en-mobile.png')});
 });
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);writeFileSync(join(dir,'results.json'),JSON.stringify({checks,exported,errors,external,productionWrites:0},null,2));
}catch(error){if(page){try{await page.screenshot({path:join(dir,'failure.png'),fullPage:true});writeFileSync(join(dir,'failure-body.txt'),await page.locator('body').innerText());}catch{}}throw error;}finally{await context?.close();await browser?.close();await sql.end();}
