/** Actual multi-page PDF -> review -> Auth/RPC/Storage -> fresh Auth regressions.
 * Uses the final owned loopback app only; no production or external requests.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {fixtureFile,output,login,createFonciereRepository} from '../fonciere-arbitrage/local.mjs';
assert.equal(process.env.OWNERS_IMPORT_PAGES_FINAL_APP,'1','Final application must be ready before this browser campaign');
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fixture=JSON.parse(readFileSync(fixtureFile,'utf8'));assert.equal(fixture.api,'http://127.0.0.1:56031');assert.equal(fixture.app,'http://127.0.0.1:3197');
const directory=join(output,'import-pages-browser'),checks=[],results=[],errors=[],external=[],contexts=[];mkdirSync(directory,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'}),run=Date.now();let phase='startup';
const p=page=>page.locator('[data-fonciere-projects]:visible'),o=page=>page.locator('[data-project-owners]:visible');
function pdf(pages){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids ['+pages.map((_,i)=>(4+i*2)+' 0 R').join(' ')+'] /Count '+pages.length+' >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
 for(const [index,lines] of pages.entries()){
  const text='BT /F1 12 Tf 50 780 Td '+lines.map((line,at)=>(at?'0 -20 Td ':'')+'('+line.replaceAll('\\','\\\\').replaceAll('(','\\(').replaceAll(')','\\)')+') Tj').join('\n')+' ET',pageId=4+index*2;
  objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents '+(pageId+1)+' 0 R >>','<< /Length '+Buffer.byteLength(text,'latin1')+' >>\nstream\n'+text+'\nendstream');
 }
 let body='%PDF-1.4\n',offsets=[0];for(const [index,object] of objects.entries()){offsets.push(Buffer.byteLength(body,'latin1'));body+=(index+1)+' 0 obj\n'+object+'\nendobj\n';}
 const start=Buffer.byteLength(body,'latin1');body+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF';return Buffer.from(body,'latin1');
}
async function session(lang,path='/fonciere'){
 const user=fixture.users.admin,context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});contexts.push(context);
 await context.addInitScript(({id,lang})=>{localStorage.setItem('oar.ui-language.v1:anonymous',lang);localStorage.setItem('oar.ui-language.v1:account:'+id,lang);},{id:user.id,lang});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&![fixture.app,fixture.api].includes(url.origin)){external.push(url.origin+url.pathname);return route.abort();}return route.continue();});
 const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto(fixture.app+path);await page.locator('input[type=email]').first().fill(user.email);await page.locator('input[autocomplete=current-password]').fill(user.password);await page.getByRole('button',{name:/^(Se connecter|Sign in)$/}).click();await p(page).waitFor({timeout:90000});return {page,context};
}
async function save(page){
 const response=page.waitForResponse(row=>row.url().endsWith('/rpc/fonciere_save_project')&&row.request().method()==='POST');await p(page).getByRole('button',{name:/^(Enregistrer|Save project)$/}).first().click();const result=await response;assert.equal(result.status(),200,await result.text());await p(page).getByText(/^(Projet enregistré\. Copie Google Drive en attente\.|Project saved\. Google Drive copy pending\.)/).waitFor();const id=new URL(page.url()).searchParams.get('project');assert(id);return id;
}
function publicSafe(data,marker){
 const exposed={presentationData:data.presentationData,provenance:data.provenance,guided:data.guided};if(marker)assert(!JSON.stringify(exposed).includes(marker),'Private source marker must stay out of public facts, evidence and presentation source');
 assert(!data.provenance.some(source=>source.fields.askingPrice?.extract.includes('80000')),'A reduction source cannot become asking-price evidence');
}
const cases=[
 {key:'fr-two-pages',lang:'fr',marker:'',asking:'',pages:[['Nom du bien : Villa fictive','Baisses de prix annoncées :'],['80000 EUR','Surface habitable : 120 m2']]},
 {key:'en-two-pages',lang:'en',marker:'PRIVATE_EN_PAGES_IMPORT_4321',asking:'',pages:[['Project : Fictional villa','Reported price reductions :'],['80000 EUR','PRIVATE_EN_PAGES_IMPORT_4321','Living area : 120 m2']]},
 {key:'en-three-pages-public-resume',lang:'en',marker:'PRIVATE_THREE_PAGES_IMPORT_4321',asking:'900000',pages:[['Project : Fictional villa','Reported price reductions :'],['80000 EUR','PRIVATE_THREE_PAGES_IMPORT_4321 first continuation'],['PRIVATE_THREE_PAGES_IMPORT_4321 final continuation','Asking price : 900000 EUR','Living area : 120 m2']]},
];
try{
 for(const item of cases){
  phase=item.key;const {page,context}=await session(item.lang),filename='agency-'+item.key+'-fictitious.pdf';
  await p(page).getByRole('button',{name:/^(Nouveau projet|New project)$/}).click();await page.locator('#fonciere-name').fill('Import multi-pages fictif '+item.key+' '+run);
  const bytes=pdf(item.pages);writeFileSync(join(directory,filename),bytes);await p(page).getByLabel(/^(Importer une fiche d’agence|Import an agency brochure)$/).setInputFiles({name:filename,mimeType:'application/pdf',buffer:bytes});
  const review=page.getByRole('dialog',{name:/^(Vérifiez les informations extraites|Review extracted information)$/});await review.waitFor({timeout:90000});
  const ownerReview=review.locator('[data-owner-import-review]'),proposal=review.locator('[data-owner-proposal="sale.priceReductions"]');await proposal.waitFor();
  for(const checkbox of await ownerReview.locator('input[type=checkbox]').all())assert.equal(await checkbox.isChecked(),false,'All private proposals require an explicit choice');
  assert.equal(await review.locator('[data-project-proposal="askingPrice"]').count(),item.asking?1:0);assert.equal(await review.locator('#fonciere-import-area').inputValue(),'120');
  if(item.asking)assert.equal((await review.locator('#fonciere-import-askingPrice').inputValue()).replace(/[\s,]/g,''),item.asking);
  const extract=await proposal.locator('blockquote').textContent();assert.match(extract,/PAGE 1\n/);assert.match(extract,/PAGE 2\n80000 EUR/);if(item.pages.length===3)assert.match(extract,/PAGE 3\nPRIVATE_THREE_PAGES_IMPORT_4321/);assert(!extract.includes('Living area'));assert(!extract.includes('Surface habitable'));assert(!extract.includes('Asking price'));
  assert.match(await proposal.locator('small').innerText(),/p\. 1/);if(item.marker)assert(extract.includes(item.marker));
  const publicReview=await review.locator('[data-project-proposal]').allTextContents();if(item.marker)assert(!publicReview.join('\n').includes(item.marker));
  await review.screenshot({path:join(directory,item.key+'-review.png')});
  // Keep the actual PDF; page screenshots are optional and outside this text-import regression.
  const photos=review.getByLabel(/^(Ajouter les visuels extraits|Add extracted visuals)/);if(await photos.count())await photos.uncheck();
  await proposal.locator('input[type=checkbox]').check();for(const other of await ownerReview.locator('[data-owner-proposal]:not([data-owner-proposal="sale.priceReductions"]) input[type=checkbox]').all())assert.equal(await other.isChecked(),false);
  await review.getByRole('button',{name:/^(Appliquer les propositions cochées|Apply selected proposals)$/}).click();await review.waitFor({state:'hidden'});const projectId=await save(page);
  // Fresh Auth and real repository hydration verify durable project context.
  const reconnect=await login(fixture.users.admin),loaded=await createFonciereRepository(reconnect.client).loadProject(projectId),data=loaded.data;
  assert.equal(data.askingPrice,item.asking);assert.equal(data.area,'120');assert(data.ownerContext.sale.priceReductions.startsWith('80000 EUR'));if(item.marker)assert(data.ownerContext.sale.priceReductions.includes(item.marker));assert.equal(data.ownerContext.owners.length,0);assert.equal(data.ownerContext.representatives.length,0);assert.equal(data.ownerContext.negotiation.potential,'unevaluated');
  const evidence=data.ownerContext.provenance.find(value=>value.field==='ownerContext.sale.priceReductions');assert(evidence);assert.equal(evidence.filename,filename);assert.equal(evidence.page,1);assert.equal(evidence.extract,extract);assert.equal(loaded.sourceDocuments.length,1);publicSafe(data,item.marker);
  const doc=loaded.assets.find(asset=>asset.id===loaded.sourceDocuments[0]);assert(doc);const savedFile=await createFonciereRepository(reconnect.client).downloadAsset(doc);assert.equal(Buffer.compare(Buffer.from(await savedFile.arrayBuffer()),bytes),0,'Original PDF retained exactly');
  await context.close();
  const reopened=await session(item.lang,'/fonciere?project='+projectId);await reopened.page.locator('#fonciere-name').waitFor();await o(reopened.page).locator('[data-owner-sale-details] summary').click();assert.equal(await reopened.page.locator('#fonciere-owner-price-reductions').inputValue(),data.ownerContext.sale.priceReductions);await o(reopened.page).locator('[data-owner-import-provenance] summary').click();assert.equal(await o(reopened.page).locator('[data-owner-import-provenance] blockquote').textContent(),extract);await o(reopened.page).screenshot({path:join(directory,item.key+'-reconnected.png')});await reopened.context.close();
  checks.push(item.key);results.push({key:item.key,id:projectId,lang:item.lang,pages:item.pages.length,asking:data.askingPrice,area:data.area,privateMarker:item.marker,filename,sourceDocuments:loaded.sourceDocuments.length,provenance:{page:evidence.page,extract:evidence.extract}});console.log('PASS '+item.key);writeFileSync(join(directory,'progress.json'),JSON.stringify(checks,null,2));
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);const latest=JSON.parse(readFileSync(fixtureFile,'utf8'));latest.importPages=Object.fromEntries(results.map(item=>[item.key,item]));writeFileSync(fixtureFile,JSON.stringify(latest),{mode:0o600});
 for(const stale of ['failure.json','failure.txt','failure.png'])rmSync(join(directory,stale),{force:true});
 writeFileSync(join(directory,'results.json'),JSON.stringify({passed:checks.length,checks,cases:results,errors,externalRequests:external,services:'Actual final browser PDF extraction/review, local Auth/RPC/PostgreSQL/Storage and fresh Auth',productionWrites:0},null,2));
}catch(error){for(const context of contexts)for(const page of context.pages())try{await page.screenshot({path:join(directory,'failure.png'),fullPage:true});writeFileSync(join(directory,'failure.txt'),await page.locator('body').innerText());}catch{}writeFileSync(join(directory,'failure.json'),JSON.stringify({phase,error:error.message,errors,external},null,2));throw error;}finally{for(const context of contexts)try{await context.close();}catch{}await browser.close();}
