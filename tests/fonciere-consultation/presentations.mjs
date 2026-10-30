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
const dir = join(output, 'rental-presentations'); mkdirSync(dir, { recursive: true });
assert.equal(fixture.app, 'http://127.0.0.1:3197'); assert.equal(fixture.api, 'http://127.0.0.1:56031');
const MARKER = 'PRIVATE_CONSULT_OWNER_MARKER', CONTACT_MARKER = 'PRIVATE_CONTACT_SENTINEL';
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
  const json = readFileSync(await download.path(), 'utf8'); privateAbsent(json); assert.deepEqual(JSON.parse(json).importMeta.fonciereSnapshot.rentalPlan,persisted.data.rentalPlan); await download.saveAs(join(dir, name + '.json'));
  const button = visible.getByRole('button', { name: /Générer le PowerPoint/ }); assert(!await button.isDisabled(), 'PowerPoint available: ' + name);
  pending = page.waitForEvent('download', { timeout: 120000 }); await button.click(); download = await pending;
  const zip = await JSZip.loadAsync(readFileSync(await download.path())); const xml = Object.keys(zip.files).filter(path => /\.(xml|rels)$/.test(path) && !zip.files[path].dir), notes = xml.filter(path => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(path));
  assert(notes.length >= 2); const slides=await Promise.all(xml.filter(p=>/^ppt\/slides\/slide\d+\.xml$/.test(p)).map(p=>zip.file(p).async('string'))); const slideText=slides.join(' ').replace(/<[^>]+>/g,' ').replace(/&#160;|&nbsp;|[\s\u202f\u00a0]/g,''); for(const amount of ['48000','42000','51000','15000','45000','1000000'])assert(slideText.includes(amount),'Missing PPT result '+amount); for(const scenario of persisted.data.rentalPlan.scenarios)assert(slides.join(' ').includes(scenario.name.replaceAll('&','&amp;')),'Missing alternative '+scenario.name); assert.equal(slides.filter(s=>s.includes('name="Calendar 2"')&&s.includes('Estimation annuelle après mise en location')).length,2); for (const path of xml) privateAbsent(await zip.file(path).async('string')); await download.saveAs(join(dir, name + '.pptx'));
  return { xmlParts: xml.length, notesParts: notes.length, markerOccurrences: 0 };
}
const exported = {};
const {rentalResults}=require('../../lib/fonciere/rentals');
try {
 project=fixture.projects.consultation;persisted=await source.loadProject(project,{arbitration:true});
 const historical=(await sql.query('select id,revision,payload from izord_projects order by id')).rows;
 await test('Manual presentation persists all units, reference and identical annual results without private owner data',async()=>{
  const mapped=toPresentationData(persisted.data,persisted.project),created=await generator.createProject(mapped.state.project);manualId=(await generator.saveProject({project:created,data:mapped,status:'draft'})).project.id;
  const saved=await generator.loadProject(manualId);assert.deepEqual(saved.data.importMeta.fonciereSnapshot.rentalPlan,persisted.data.rentalPlan);assert.deepEqual(rentalResults(saved.data.importMeta.fonciereSnapshot.rentalPlan).map(r=>r.gross),[48000,42000,51000,15000,45000]);assert.equal(saved.data.state.holding,persisted.data.presentationData.state.holding);privateAbsent(await row(manualId));
 });
 await test('Approved bank presentation captures retained rental reference, comparison and calendar with no private fields',async()=>{await vote('vincent');await vote('annCharlotte');await prepareBankPresentation(users.admin.client,project);bankId=(await read()).bank.presentationId;assert(bankId);const bank=await generator.loadProject(bankId);assert.deepEqual(bank.data.importMeta.fonciereSnapshot.rentalPlan,persisted.data.rentalPlan);privateAbsent(bank.data);});
 browser=await chromium.launch({headless:true,channel:'chrome'});context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
 await context.addInitScript(id=>{localStorage.setItem('oar.ui-language.v1:anonymous','fr');localStorage.setItem('oar.ui-language.v1:account:'+id,'fr');},fixture.users.admin.id);
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&![fixture.app,fixture.api].includes(url.origin)){external.push(url.origin+url.pathname);return route.abort();}return route.continue();});page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await test('Actual manual JSON/PPTX exports retain five alternatives, all supplied results and common cost; every XML/notes part excludes private data',async()=>{exported.manual=await browserExports('rentals-manual-fictitious',manualId);});
 await test('Actual bank JSON/PPTX exports match the same reference and comparison',async()=>{exported.bank=await browserExports('rentals-bank-fictitious',bankId);});
 await test('Reference change requires fresh opinions and does not overwrite worked bank or historical presentation snapshots',async()=>{
  const bank=await generator.loadProject(bankId),worked=structuredClone(bank.data);worked.state.decisionNotes='WORKED BANK PRESENTATION TO KEEP';await generator.saveProject({project:bank.project,previous:bank,data:worked,status:'draft'});const beforeBank=await row(bankId),beforeManual=await row(manualId),current=await source.loadProject(project);const next=structuredClone(current.data);next.rentalPlan.referenceId=next.rentalPlan.scenarios.find(s=>s.id!==next.rentalPlan.referenceId).id;await source.saveProject({data:next,previous:current},{arbitration:true});assert.equal((await read()).status,'pending');await vote('vincent');await vote('annCharlotte');await prepareBankPresentation(users.admin.client,project);assert.deepEqual(await row(bankId),beforeBank);assert.deepEqual(await row(manualId),beforeManual);assert.equal((await read()).bank.needsUpdate,true);const after=(await sql.query('select id,revision,payload from izord_projects where id=any($1) order by id',[historical.map(p=>p.id)])).rows;assert.deepEqual(after,historical);
 });
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);writeFileSync(join(dir,'results.json'),JSON.stringify({checks,exported,errors,external,productionWrites:0},null,2));
}catch(error){if(page){try{await page.screenshot({path:join(dir,'failure.png'),fullPage:true});writeFileSync(join(dir,'failure-body.txt'),await page.locator('body').innerText());}catch{}}throw error;}finally{await context?.close();await browser?.close();await sql.end();}
