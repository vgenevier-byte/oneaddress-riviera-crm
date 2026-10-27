/** UI contract evidence only: real components, fictional projections, mocked API responses. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require('/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output='/private/tmp/fonciere-number-ui-evidence',manifest=JSON.parse(readFileSync(join(output,'fixture-manifest.json'),'utf8'));
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
for(const row of manifest.files)assert.equal(hash(join(manifest.directory,row.path)),row.sha256,row.path+' frozen source');
for(const file of ['components/fonciere/ProjectsWorkspace.tsx','components/fonciere/ProjectSourcePicker.tsx','components/fonciere/ProjectDriveSync.tsx','components/AccessAdministration.tsx','components/TaskLinks.tsx','components/search/SearchableSelect.tsx','lib/fonciere/projectSearch.ts','lib/search.ts']){const row=manifest.files.find(row=>row.path===file);assert(row,file);assert.equal(hash(join(process.cwd(),file)),row.sha256,file+' exact source');}
mkdirSync(join(output,'screenshots'),{recursive:true});const checks=[],sessions=[];const browser=await chromium.launch({headless:true,channel:'chrome'});
const save=()=>writeFileSync(join(output,'browser-results.json'),JSON.stringify({passed:checks.length,checks,sessions,actualAuth:false,actualRPC:false,actualDatabase:false,actualDrive:false,fictionalData:true,physicalDevice:false,evidence:'Source-identical UI components with explicit scoped-client doubles and intercepted Drive API responses'},null,2));
try{for(const mobile of [false,true])for(const lang of ['fr','en']){
 const name=`${mobile?'mobile':'desktop'}-${lang}`,context=await browser.newContext({viewport:{width:mobile?390:1440,height:mobile?844:1100},isMobile:mobile,hasTouch:mobile});
 await context.addInitScript(lang=>localStorage.setItem('oar.ui-language.v1:anonymous',lang),lang);
 const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[],unexpected=[];let driveState='pending',canOpen=true,canRetry=true,apiFailure=false,retries=0;
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.pathname==='/api/fonciere/drive'){
  if(apiFailure)return route.fulfill({status:503,json:{error:'Fixture unavailable'}});
  if(route.request().method()==='POST'){retries++;return route.fulfill({status:200,json:{ok:true}});}
  return route.fulfill({status:200,json:{configured:true,projectId:url.searchParams.get('project'),status:driveState,canOpen,canRetry,files:[{assetId:'fictional-original',name:'original-fictif.pdf',category:'agency',status:driveState}],...(driveState==='retry'?{error:lang==='en'?'Managed folder moved. Verification required.':'Dossier géré déplacé. Vérification requise.'}:{})}});
 }if(url.pathname.startsWith('/api/')||url.port==='9'){unexpected.push(url.origin+url.pathname);return route.abort();}if(['http:','https:'].includes(url.protocol)&&url.origin!==manifest.url){unexpected.push(url.origin+url.pathname);return route.abort();}return route.continue();});
 const check=async(label,run)=>{try{await run();checks.push({session:name,name:label});console.log('PASS',name,label);save();}catch(error){await page.screenshot({path:join(output,'screenshots','failure-'+name+'.png'),fullPage:true});throw new Error(name+' '+label+': '+error.message,{cause:error});}};
 await page.goto(manifest.url);const workspace=page.locator('[data-fonciere-projects]');const cards=()=>workspace.locator('button[class*=projectCard]');const query=()=>workspace.locator('input[placeholder]').first();
 await check('visible numeric ascending list and exact full/numeric reference priority',async()=>{
  await cards().first().waitFor();assert.deepEqual(await cards().locator('[class*=projectReference]').allTextContents(),['PRJ-000001','PRJ-000002','PRJ-000010']);
  for(const term of ['2','000002','PRJ-000002']){await query().fill(term);await page.waitForTimeout(50);assert.equal(await cards().first().locator('[class*=projectReference]').innerText(),'PRJ-000002');}
  await query().fill('clement');assert.equal(await cards().count(),3);await query().fill('');
 });
 await check('read-only canonical reference and all durable copy states with controlled retry',async()=>{
  await cards().filter({hasText:'PRJ-000002'}).first().click();const reference=workspace.getByLabel(lang==='en'?'Project reference':'Référence projet',{exact:true});await reference.waitFor();assert.equal(await reference.inputValue(),'PRJ-000002');assert(await reference.evaluate(input=>input.readOnly));
  const sync=page.locator('[data-project-drive]');const label={pending:lang==='en'?'Waiting to copy':'En attente de copie',copying:lang==='en'?'Copying':'Copie en cours',synced:lang==='en'?'Synced with Google Drive':'Synchronisé avec Google Drive',retry:lang==='en'?'Copy needs attention':'Copie à reprendre'};
  for(const value of ['pending','copying','synced','retry']){driveState=value;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await sync.getByRole('status').filter({hasText:label[value]}).waitFor();}
  await sync.getByRole('button',{name:lang==='en'?'Retry copy':'Réessayer la copie',exact:true}).click();assert.equal(retries,1);
  await sync.locator('summary').click();assert.match(await sync.innerText(),/original-fictif.pdf/);assert.match(await sync.innerText(),lang==='en'?/Managed folder moved/:/Dossier géré déplacé/);
  await sync.scrollIntoViewIfNeeded();await page.screenshot({path:join(output,'screenshots',name+'-copy-status.png')});
 });
 await check('download and retry gates hide controls and outage preserves saved project',async()=>{
  canOpen=false;canRetry=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelector('[data-project-drive]')?.querySelectorAll('button').length===0);assert.equal(await page.locator('[data-project-drive] button').count(),0);
  apiFailure=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.locator('[data-project-drive]').getByRole('alert').waitFor();assert.equal(await workspace.locator('#fonciere-name').inputValue(),'Z Oliviers');apiFailure=false;
  await workspace.getByRole('button',{name:lang==='en'?'New project':'Nouveau projet',exact:true}).click();assert.equal(await workspace.getByLabel(lang==='en'?'Project reference':'Référence projet',{exact:true}).inputValue(),lang==='en'?'Number assigned on save':'Numéro attribué à l’enregistrement');
 });
 await check('unsaved source categories preserve original image and document without starting copy',async()=>{
  await workspace.locator('input[type=file][aria-label="'+(lang==='en'?'Add documents':'Ajouter des documents')+'"]').setInputFiles({name:'plan-original-fictif.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nFictional original source bytes only.\n%%EOF')});
  const documentCategory=workspace.getByRole('combobox',{name:(lang==='en'?'Category':'Classement')+' · plan-original-fictif.pdf',exact:true});assert.equal(await documentCategory.inputValue(),'other');await documentCategory.selectOption('plans');assert.equal(await documentCategory.inputValue(),'plans');
  const originalPng=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;const context=canvas.getContext('2d');context.fillStyle='#168344';context.fillRect(0,0,8,8);return canvas.toDataURL('image/png').split(',')[1];});
  await workspace.locator('input[type=file][aria-label="'+(lang==='en'?'Add photos':'Ajouter des photos')+'"]').setInputFiles({name:'photo-originale-fictive.png',mimeType:'image/png',buffer:Buffer.from(originalPng,'base64')});
  const photoCategory=workspace.getByRole('combobox',{name:(lang==='en'?'Category':'Classement')+' · photo-originale-fictive.png',exact:true});await photoCategory.waitFor();assert.equal(await photoCategory.inputValue(),'photos');assert.equal(await workspace.locator('[data-project-gallery] img').count(),1);assert.equal(await page.locator('[data-project-drive]').count(),0,'unsaved files do not launch Drive UI or export');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 });
 await check('source selector keeps numeric order, exact reference first and canonical value until choice',async()=>{
  await page.locator('[data-mode=presentations]').click();const selector=page.locator('[data-project-source]'),input=selector.locator('input[role=combobox]');await input.waitFor();await input.focus();assert.deepEqual(await selector.getByRole('option').locator('small').allTextContents().then(values=>values.filter(value=>/^PRJ-/.test(value))),['PRJ-000001','PRJ-000002','PRJ-000010']);await input.fill('000002');await page.waitForTimeout(50);assert.match(await selector.getByRole('option').first().innerText(),/^PRJ-000002/);assert.equal(await selector.locator('select').inputValue(),'');await input.press('Escape');
 });
 await check('Administration assignments expose and search canonical reference',async()=>{
  await page.locator('[data-mode=admin]').click();const admin=page.locator('.unified-admin');await admin.locator('.unified-user').filter({hasText:'fictional@example.invalid'}).click();const projectQuery=admin.locator('section[aria-labelledby=admin-fonciere-assignments-title] input[type=search]');await projectQuery.fill('000002');const assignment=admin.locator('[data-fonciere-assignment]').locator('..');await assignment.first().waitFor();assert.match(await assignment.first().innerText(),/PRJ-000002/);assert.equal(await assignment.first().locator('input').getAttribute('data-fonciere-assignment'),'00000000-0000-4000-8000-000000000002');
 });
 await check('Task results show exact project reference separately from title',async()=>{
  await page.locator('[data-mode=tasks]').click();await page.getByRole('button',{name:lang==='en'?'Link a CRM item':'Lier un élément du CRM',exact:true}).click();await page.getByRole('searchbox',{name:lang==='en'?'Search CRM items':'Rechercher un élément du CRM',exact:true}).fill('000002');const result=page.locator('[data-task-target-key]');await result.first().waitFor();assert.match(await result.first().innerText(),/^PRJ-000002/);assert.equal(await result.first().locator('strong').innerText(),'Z Oliviers');
 });
 await check('no horizontal overflow or console errors',async()=>{assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);});
 sessions.push({name,browser:browser.version(),errors,unexpected});save();await context.close();
}}finally{save();await browser.close();}
