/** Real local approvals, bank snapshot, repository persistence and Chromium PPTX.
 * Uses fictional accounts only; egress is restricted to the owned local stack. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import JSZip from 'jszip';
import {connect,sql,fixtureFile,output,ok,login,payload,createGeneratorRepository,createFonciereRepository} from '../fonciere-arbitrage/local.mjs';
const require=createRequire(import.meta.url),{prepareBankPresentation}=require('../../lib/fonciere/bankPresentation'),{fromPresentationData}=require('../../lib/fonciere/model'),{importProjectJson}=require('../../lib/izord/model'),{calculateProjectCalendar}=require('../../lib/fonciere/calendar'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fixture=JSON.parse(readFileSync(fixtureFile,'utf8')),users={},checks=[],errors=[],external=[];
assert.equal(fixture.app,'http://127.0.0.1:3197');assert.equal(fixture.api,'http://127.0.0.1:56031');mkdirSync(output,{recursive:true});
for(const name of ['admin','vincent','annCharlotte'])users[name]=await login(fixture.users[name]);
await connect();let browser,context,page,project,presentationId,sourceBefore;
async function test(name,fn){await fn();checks.push(name);console.log('PASS '+name);writeFileSync(join(output,'calendar-presentation-progress.json'),JSON.stringify(checks,null,2));}
const row=async()=> (await sql.query('select * from public.fonciere_projects where id=$1',[project])).rows[0];
const read=who=>ok(users[who].client.rpc('fonciere_arbitrage_read',{p_project:project}));
async function vote(who){const state=await read(who);return ok(users[who].client.rpc('fonciere_arbitrage_vote',{p_project:project,p_fingerprint:state.fingerprint,p_choice:'approved',p_remark:'PRIVATE_CALENDAR_REMARK_9015 fictional approval'}));}
async function openBrowser(id){
 context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
 await context.addInitScript(id=>{localStorage.setItem('oar.ui-language.v1:anonymous','fr');localStorage.setItem('oar.ui-language.v1:account:'+id,'fr');},fixture.users.admin.id);
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&![fixture.app,fixture.api].includes(url.origin)){external.push(url.origin+url.pathname);return route.abort();}return route.continue();});
 page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(fixture.app+'/izord?crmTarget='+encodeURIComponent(JSON.stringify({type:'presentation',id})));
 await page.locator('input[type=email]').first().fill(fixture.users.admin.email);await page.locator('input[autocomplete=current-password]').fill(fixture.users.admin.password);await page.getByRole('button',{name:/^(Se connecter|Sign in)$/}).click();await page.locator('.crm-shell:visible').waitFor({timeout:90000});await page.locator('#izord-project').waitFor({timeout:90000});await page.waitForFunction(()=>document.querySelector('#izord-project')?.value?.includes('Dossier bancaire'));
}
async function calendarPreviewEvidence(name){
 const preview=page.locator('[data-presentation-calendar]');await preview.waitFor();await preview.scrollIntoViewIfNeeded();
 const sizes=await preview.locator('[class*=slidePart]').evaluateAll(elements=>elements.map(el=>({text:el.textContent,w:el.clientWidth,h:el.clientHeight,scrollW:el.scrollWidth,scrollH:el.scrollHeight})));
 const clipped=sizes.filter(box=>box.scrollH>box.h+1||box.scrollW>box.w+1);writeFileSync(join(output,name+'-geometry.json'),JSON.stringify({sizes,clipped},null,2));assert.equal(clipped.length,0,'Calendar text clipping: '+JSON.stringify(clipped));
 await preview.screenshot({path:join(output,name+'.png')});return sizes;
}
try{
 await test('Approved bank snapshot freezes calendar before a later saved source edit',async()=>{
  const source=(await sql.query('select payload from public.fonciere_projects where id=$1',[fixture.projects.calendar])).rows[0].payload,initial=payload('Calendrier bancaire fictif');initial.data=structuredClone(source.data);initial.data.name='Calendrier bancaire fictif';initial.data.presentationData.state.rentalPeriod='18';initial.data.presentationData.state.holding='24';
  project=await ok(users.admin.client.rpc('fonciere_create_project',{p_creation_key:randomUUID(),p_payload:initial,p_contact:'',p_agency_contact:''}));
  for(const who of ['vincent','annCharlotte'])await sql.query('insert into public.fonciere_project_assignments(project_id,user_id) values($1,$2)',[project,users[who].id]);
  await vote('vincent');await vote('annCharlotte');sourceBefore=await row();assert.equal((await read('admin')).status,'approved');
  const actual=users.admin.client.rpc.bind(users.admin.client);let edited=false;
  users.admin.client.rpc=(name,args,...rest)=>{const request=actual(name,args,...rest);if(name!=='fonciere_bank_prepare')return request;return Promise.resolve(request).then(async result=>{if(result.data?.token&&!edited){edited=true;const changed=structuredClone(sourceBefore.payload);changed.data.guided.values.worksHypothesis.durationMonths=5;await ok(actual('fonciere_save_project',{p_id:project,p_expected_revision:sourceBefore.revision,p_payload:changed,p_contact:'',p_agency_contact:''}));}return result;});};
  try{await prepareBankPresentation(users.admin.client,project);}finally{users.admin.client.rpc=actual;}
  assert(edited);const state=await read('admin');assert.equal(state.status,'pending');presentationId=state.bank.presentationId;assert(presentationId);const loaded=await createGeneratorRepository(users.admin.client).loadProject(presentationId),captured=loaded.data.importMeta.fonciereSnapshot.guided;
  assert.deepEqual(captured,sourceBefore.payload.data.guided);assert.equal(captured.values.worksHypothesis.durationMonths,4);assert.equal((await row()).payload.data.guided.values.worksHypothesis.durationMonths,5);
  assert.equal(loaded.data.importMeta.fonciereSource.revision,sourceBefore.revision);assert(!JSON.stringify(loaded.data).includes('PRIVATE_CALENDAR_REMARK_9015'));
  const updated=JSON.parse(readFileSync(fixtureFile,'utf8'));updated.projects.calendarBank=project;updated.calendarBankPresentation=presentationId;writeFileSync(fixtureFile,JSON.stringify(updated),{mode:0o600});
 });
 await test('Presentation reimport persists a new project with the entire structured calendar and legacy timing',async()=>{
  const generator=createGeneratorRepository(users.admin.client),loaded=await generator.loadProject(presentationId),back=fromPresentationData(loaded.data);
  assert.deepEqual(back.guided,sourceBefore.payload.data.guided);assert.equal(back.resaleHypothesis,sourceBefore.payload.data.resaleHypothesis);assert.equal(back.guided.values.resaleHypothesis.timing,'Deuxième semestre, à confirmer');
  back.name='Aller-retour calendrier fictif';const repository=createFonciereRepository(users.admin.client),saved=await repository.saveProject({data:back,creationKey:randomUUID()});
  const reconnected=await login(fixture.users.admin),persisted=await createFonciereRepository(reconnected.client).loadProject(saved.project.id);assert.deepEqual(persisted.data.guided,sourceBefore.payload.data.guided);assert.deepEqual(calculateProjectCalendar(persisted.data),calculateProjectCalendar(back));
 });
 await test('A retried bank preparation keeps a manually edited deck after new calendar approvals',async()=>{
  const generator=createGeneratorRepository(users.admin.client),loaded=await generator.loadProject(presentationId),data=structuredClone(loaded.data);data.state.decisionNotes='Rédaction bancaire retravaillée à conserver';const saved=await generator.saveProject({project:loaded.project,previous:loaded,data,status:'draft'});
  await vote('vincent');await vote('annCharlotte');await prepareBankPresentation(users.admin.client,project);
  const after=await generator.loadProject(presentationId);assert.equal(after.project.revision,saved.project.revision);assert.deepEqual(after.data,saved.data);assert.equal(after.data.importMeta.fonciereSnapshot.guided.values.worksHypothesis.durationMonths,4);assert.equal((await read('admin')).bank.needsUpdate,true);
 });
 browser=await chromium.launch({headless:true,channel:'chrome'});await openBrowser(presentationId);
 await test('Actual browser preview displays the approved calendar with unclipped shared slide geometry',async()=>{
  const preview=page.locator('[data-presentation-calendar]');await preview.getByText('Calendrier prévisionnel du projet',{exact:true}).first().waitFor();const text=await preview.innerText();for(const value of ['31/01/2028','31/05/2028','30/06/2028','30/11/2028','Premiers encaissements prévisionnels'])assert(text.includes(value),value);
  await calendarPreviewEvidence('calendar-bank-preview');
 });
 await test('Actual JSON export retains the captured calendar through JSON reimport',async()=>{
  const generator=page.locator('[data-izord-generator]:visible'),downloadPromise=page.waitForEvent('download');await generator.getByRole('button',{name:/^Exporter le JSON$/}).click();const download=await downloadPromise,path=await download.path(),text=readFileSync(path,'utf8'),data=importProjectJson(text);assert.deepEqual(data.importMeta.fonciereSnapshot.guided,sourceBefore.payload.data.guided);assert(!text.includes('PRIVATE_CALENDAR_REMARK_9015'));await download.saveAs(join(output,'calendar-bank-export-fictitious.json'));
 });
 await test('Actual PowerPoint export includes editable calendar, exact approved dates, speaker notes and valid slide relationships',async()=>{
  const generator=page.locator('[data-izord-generator]:visible'),button=generator.getByRole('button',{name:/Générer le PowerPoint/});assert(!await button.isDisabled());const pending=page.waitForEvent('download',{timeout:120000});await button.click();const download=await pending,zip=await JSZip.loadAsync(readFileSync(await download.path()));
  const slides=Object.keys(zip.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)),notes=Object.keys(zip.files).filter(name=>/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name));assert.equal(slides.length,3);assert.equal(notes.length,3);
  const slide=await zip.file('ppt/slides/slide3.xml').async('string');for(const text of ['Calendrier prévisionnel du projet','31/01/2028','31/05/2028','30/06/2028','30/11/2028'])assert(slide.includes(text),text);
  const note=await zip.file('ppt/notesSlides/notesSlide3.xml').async('string');assert(note.includes('Premiers encaissements prévisionnels'));assert(note.includes('30/06/2028'));
  for(const [name,entry] of Object.entries(zip.files))if(!entry.dir&&/\.(xml|rels)$/.test(name))assert(!(await entry.async('string')).includes('PRIVATE_CALENDAR_REMARK_9015'),name);
  const geometry=await page.evaluate(slide=>{const doc=new DOMParser().parseFromString(slide,'application/xml'),A='http://schemas.openxmlformats.org/drawingml/2006/main';return [...doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main','sp')].map(shape=>{const xfrm=shape.getElementsByTagNameNS(A,'xfrm')[0],off=xfrm?.getElementsByTagNameNS(A,'off')[0],ext=xfrm?.getElementsByTagNameNS(A,'ext')[0];return {x:Number(off?.getAttribute('x'))/12700,y:Number(off?.getAttribute('y'))/12700,w:Number(ext?.getAttribute('cx'))/12700,h:Number(ext?.getAttribute('cy'))/12700,text:[...shape.getElementsByTagNameNS(A,'t')].map(t=>t.textContent).join('\n')};});},slide);
  for(const box of geometry)assert(box.x>=0&&box.y>=0&&box.x+box.w<=960&&box.y+box.h<=540,JSON.stringify(box));
  const pres=await zip.file('ppt/presentation.xml').async('string'),app=await zip.file('docProps/app.xml').async('string'),rels=await zip.file('ppt/slides/_rels/slide3.xml.rels').async('string');assert.equal((pres.match(/<p:sldId\s/g)||[]).length,3);assert(app.includes('<Slides>3</Slides>'));assert(rels.includes('notesSlide3.xml'));assert(rels.includes('slideLayout'));
  await download.saveAs(join(output,'calendar-bank-export-fictitious.pptx'));writeFileSync(join(output,'calendar-pptx-geometry.json'),JSON.stringify({slides:slides.length,notes:notes.length,geometry,privateMarkerOccurrences:0},null,2));
 });
 await test('A real photo appendix and calendar coexist as separate editable slides with correct metadata',async()=>{
  const current=JSON.parse(readFileSync(join(output,'calendar-bank-export-fictitious.json'),'utf8'));
  const jpeg=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=400;const ctx=canvas.getContext('2d');ctx.fillStyle='#427279';ctx.fillRect(0,0,640,400);ctx.fillStyle='#ffffff';ctx.font='32px Arial';ctx.fillText('PHOTO FICTIVE CALENDRIER',36,210);return canvas.toDataURL('image/jpeg',0.85);});
  current.importGallery=[{data:jpeg,label:'Photo fictive de validation',page:null,width:640,height:400,source:'Fixture locale'}];current.state.includePhotoSlide=true;
  await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({name:'calendrier-photo-fictif.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(current))});await page.locator('[data-presentation-calendar]').waitFor();assert.equal(await page.locator('[data-presentation-preview] [class*=previewHost]').count(),4);
  const pending=page.waitForEvent('download',{timeout:120000});await page.locator('[data-izord-generator]:visible').getByRole('button',{name:/Générer le PowerPoint/}).click();const download=await pending,zip=await JSZip.loadAsync(readFileSync(await download.path())),slides=Object.keys(zip.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name));assert.equal(slides.length,4);
  assert((await zip.file('ppt/slides/slide3.xml').async('string')).includes('Photo fictive de validation'));assert(!(await zip.file('ppt/slides/slide3.xml').async('string')).includes('Calendrier prévisionnel du projet'));assert((await zip.file('ppt/slides/slide4.xml').async('string')).includes('Calendrier prévisionnel du projet'));assert((await zip.file('ppt/slides/_rels/slide4.xml.rels').async('string')).includes('notesSlide4.xml'));
  const app=await zip.file('docProps/app.xml').async('string');assert(app.includes('<Slides>4</Slides>'));assert(app.includes('Photothèque du bien'));assert(app.includes('Calendrier prévisionnel du projet'));await download.saveAs(join(output,'calendar-gallery-export-fictitious.pptx'));
 });
 await test('Incomplete calendar preview preserves explicit missing-field messages without clipped text',async()=>{
  const current=JSON.parse(readFileSync(join(output,'calendar-bank-export-fictitious.json'),'utf8')),values=current.importMeta.fonciereSnapshot.guided.values;values.worksHypothesis.startDate=null;values.worksHypothesis.durationMonths=null;values.rentalHypothesis.receiptDelayMonths=null;values.resaleHypothesis.receiptDelayMonths=null;
  await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({name:'calendrier-incomplet-fictif.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(current))});await page.locator('[data-presentation-calendar]').getByText(/Date non calculable/).first().waitFor();await calendarPreviewEvidence('calendar-missing-preview');
 });
 await test('Historical presentation without new calendar fields keeps its original slide preview count',async()=>{
  const current=JSON.parse(readFileSync(join(output,'calendar-bank-export-fictitious.json'),'utf8')),values=current.importMeta.fonciereSnapshot.guided.values;delete values.personalStrategy;delete values.worksHypothesis.startDate;delete values.worksHypothesis.durationMonths;delete values.rentalHypothesis.receiptDelayMonths;delete values.resaleHypothesis.receiptDelayMonths;
  await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({name:'presentation-historique-fictive.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(current))});await page.waitForTimeout(250);assert.equal(await page.locator('[data-presentation-calendar]').count(),0);assert.equal(await page.locator('[data-presentation-preview] [class*=previewHost]').count(),2);const pending=page.waitForEvent('download',{timeout:120000});await page.locator('[data-izord-generator]:visible').getByRole('button',{name:/Générer le PowerPoint/}).click();const download=await pending,zip=await JSZip.loadAsync(readFileSync(await download.path()));assert.equal(Object.keys(zip.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).length,2);for(const name of ['ppt/slides/slide1.xml','ppt/slides/slide2.xml'])assert(!(await zip.file(name).async('string')).includes('Calendrier prévisionnel du projet'));await download.saveAs(join(output,'calendar-historical-export-fictitious.pptx'));
 });
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);writeFileSync(join(output,'calendar-presentation-results.json'),JSON.stringify({passed:checks.length,checks,errors,externalRequests:external,services:'Real local Auth/PostgreSQL/PostgREST/Storage and Chromium browser exports',rendering:'Actual browser preview plus generated editable PPTX XML/relationships/geometry; PowerPoint desktop and LibreOffice not used',productionWrites:0},null,2));
}catch(error){if(page){try{await page.screenshot({path:join(output,'calendar-presentation-failure.png'),fullPage:true});writeFileSync(join(output,'calendar-presentation-failure-body.txt'),await page.locator('body').innerText());}catch{}}writeFileSync(join(output,'calendar-presentation-failure.json'),JSON.stringify({error:error.message,checks,errors,external},null,2));throw error;}finally{try{await context?.close();}catch{}await browser?.close();await sql.end();}
