/** Real source-identical local application with real disposable Auth/RPC/Storage. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fixture=JSON.parse(readFileSync(process.env.FONCIERE_ACCESS_FIXTURE,'utf8')),output=process.env.FONCIERE_ACCESS_OUTPUT||'/private/tmp/fonciere-access-evidence';
for(const url of [fixture.api,fixture.app])assert.equal(new URL(url).hostname,'127.0.0.1');
mkdirSync(output,{recursive:true});const checks=[],errors=[],external=[],contexts=[];let phase='startup';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const native=page=>page.locator('[data-fonciere-projects]:visible');
const test=async(name,run)=>{if(process.env.FONCIERE_ACCESS_BROWSER_ONLY&&!new RegExp(process.env.FONCIERE_ACCESS_BROWSER_ONLY).test(name))return;phase=name;await run();checks.push(name);console.log('PASS '+name);writeFileSync(join(output,'browser-progress.json'),JSON.stringify(checks,null,2));};
async function api(name,args,who='admin'){
 const credentials=fixture.users[who];const signed=await fetch(fixture.api+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:fixture.publicKey,'Content-Type':'application/json'},body:JSON.stringify({email:credentials.email,password:credentials.password})});assert(signed.ok);const auth=await signed.json();
 const response=await fetch(fixture.api+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:fixture.publicKey,Authorization:'Bearer '+auth.access_token,'Content-Type':'application/json'},body:JSON.stringify(args)});assert(response.ok,name+' '+response.status);return response.status===204?null:response.json();
}
async function change(name,overrides,extra={}){
 const data=await api('crm_admin_users',{}),user=data.users.find(row=>row.id===fixture.users[name].id);assert(user);
 return api('crm_admin_save',{p_user:user.id,p_revision:user.revision,p_active:user.active,p_general_admin:user.generalAdmin,p_grants:{...user.modules,...overrides},p_izord_role:user.izordRole,p_assignments:user.assignments,p_fonciere_assignments:user.fonciereAssignments,...extra});
}
async function session(name='admin',route='/admin',language='fr',mobile=false){
 const user=fixture.users[name],context=await browser.newContext({viewport:{width:mobile?390:1440,height:1000},...(mobile?{isMobile:true,hasTouch:true}:{}),acceptDownloads:true});contexts.push(context);
 await context.addInitScript(({id,language})=>{localStorage.setItem('oar.ui-language.v1:anonymous',language);localStorage.setItem('oar.ui-language.v1:account:'+id,language);},{id:user.id,language});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&![fixture.app,fixture.api].includes(url.origin)){external.push(url.origin+url.pathname);return route.abort();}return route.continue();});
 const page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto(fixture.app+route);await page.locator('input[type=email]').first().fill(user.email);await page.locator('input[autocomplete=current-password]').fill(user.password);await page.getByRole('button',{name:/^(Se connecter|Sign in)$/}).click();await page.locator('.crm-shell:visible').waitFor({timeout:90000});
 return {context,page};
}
async function selectUser(page,name='clement'){
 await page.locator('.unified-admin').waitFor();const search=page.locator('.unified-admin > section').first().locator('input[type=search]');await search.fill(fixture.users[name].email);await page.locator('.unified-user').filter({hasText:fixture.users[name].email}).click();await page.locator('[data-admin-module=fonciere] select').waitFor();
}
async function openFonciereGroup(page){
 if(page.viewportSize().width<1024){const menu=page.locator('#unified-more-panel:visible');if(!await menu.count())await page.locator('#unified-more-trigger').click();}
 const group=page.locator('[data-navigation-group=fonciere]:visible');if(await group.count()&&await group.getAttribute('aria-expanded')==='false')await group.click();
}
async function noOverflow(page){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');}
try{
 await test('FR Administration: distinct independent module levels, native navigation groups and two assignment searches',async()=>{
  await change('clement',{fonciere:{level:'none',sensitive:{}},izord:{level:'none',sensitive:{}}},{p_fonciere_assignments:[]});
  const run=await session();try{const page=run.page;await selectUser(page);const group=page.locator('[data-admin-group=fonciere]');assert.match(await group.innerText(),/Projets/);assert.match(await group.innerText(),/Présentations Projets/);assert.equal(await group.locator('[data-admin-module]').count(),2);assert.equal(await group.locator('[data-admin-module=fonciere] input[type=checkbox]').count(),0,'No invented deletion/export permissions for Projects');
   await page.locator('[data-admin-module=fonciere] select').selectOption('contribute');await page.locator('[data-admin-module=izord] select').selectOption('none');
   const projectSection=page.locator('section[aria-labelledby=admin-fonciere-assignments-title]');await projectSection.locator('input[type=search]').fill('Villa affectée');await page.locator(`[data-fonciere-assignment="${fixture.projects.assigned}"]`).check();
   const presentationSection=page.locator('section[aria-labelledby=admin-presentation-assignments-title]');await presentationSection.locator('input[type=search]').fill('historique');assert(await page.locator(`[data-presentation-assignment="${fixture.presentations.assigned}"]`).isChecked());
   const saved=page.waitForResponse(response=>response.url().endsWith('/rpc/crm_admin_save')&&response.request().method()==='POST');await page.locator('.unified-admin > section').nth(1).getByRole('button',{name:'Enregistrer',exact:true}).click();assert.equal((await saved).status(),200);await page.getByText('Droits enregistrés et confirmés par le serveur.',{exact:true}).waitFor();
   await noOverflow(page);await group.screenshot({path:join(output,'administration-fonciere-fr.png')});await page.locator('section[aria-labelledby=admin-fonciere-assignments-title]').screenshot({path:join(output,'administration-affectation-fr.png')});
   await page.reload();await selectUser(page);assert.equal(await page.locator('[data-admin-module=fonciere] select').inputValue(),'contribute');assert.equal(await page.locator('[data-admin-module=izord] select').inputValue(),'none');assert(await page.locator(`[data-fonciere-assignment="${fixture.projects.assigned}"]`).isChecked());
  }finally{await run.context.close();}
 });
 await test('Fictional assigned account reconnects to native Projets alone, keeps Contacts/Presentations inaccessible and unassigned project hidden',async()=>{
  const run=await session('clement','/fonciere?project='+fixture.projects.assigned);try{const page=run.page;await native(page).waitFor();await page.locator('#fonciere-name').waitFor();assert.equal(await page.locator('#fonciere-name').inputValue(),'Villa affectée fictive');assert.equal(await page.locator('#fonciere-name').isDisabled(),false);assert.equal(await page.getByRole('button',{name:'Créer un contact',exact:true}).count(),0);await openFonciereGroup(page);assert.equal(await page.locator('[data-navigation-module=fonciere]:visible').count(),1);assert.equal(await page.locator('[data-navigation-module=izord]').count(),0);assert.equal(await page.locator('[data-navigation-module=contacts]').count(),0);
   await page.goto(fixture.app+'/fonciere?project='+fixture.projects.foreign);await page.getByText('Ce projet est inaccessible ou n’existe plus.',{exact:true}).waitFor();assert.equal(await page.locator('#fonciere-name').count(),0);
  }finally{await run.context.close();}
 });
 await test('Four combinations stay independent in real navigation/direct routes and presentation source picker requires Projets permission',async()=>{
  for(const [name,projects,presentations] of [['projectsOnly',true,false],['presentationsOnly',false,true],['both',true,true],['neither',false,false]]){
   const run=await session(name,presentations?'/izord':'/fonciere');try{const page=run.page;if(projects&&!presentations)await native(page).waitFor();if(presentations)await page.locator('[data-izord-generator]:visible').waitFor();await openFonciereGroup(page);assert.equal(await page.locator('[data-navigation-module=fonciere]:visible').count(),projects?1:0,name+' Projects');assert.equal(await page.locator('[data-navigation-module=izord]:visible').count(),presentations?1:0,name+' Presentations');
    if(presentations){const source=page.locator('[data-project-source]:visible');assert.equal(await source.count(),1);assert.equal(await source.getByRole('button',{name:'Choisir un projet enregistré',exact:true}).isDisabled(),!projects,'Saved source selection requires independent project permission');if(projects){await page.waitForFunction(id=>{const select=document.querySelector('#fonciere-source-project-native');return select&&!select.disabled&&[...select.options].some(option=>option.value===id);},fixture.projects.assigned);await page.locator('#fonciere-source-project').fill('Villa affectée');await page.getByRole('option',{name:/Villa affectée fictive/}).click();await page.waitForFunction(()=>document.querySelector('#izord-project')?.value==='Villa affectée fictive');}}
    if(!projects)assert.equal(await native(page).count(),0);if(!presentations)assert.equal(await page.locator('[data-izord-generator]:visible').count(),0);
   }finally{await run.context.close();}
  }
 });
 await test('Read and insufficient business-role profiles keep real project fields read-only',async()=>{
  for(const name of ['projectReader','roleReader']){const run=await session(name,'/fonciere?project='+fixture.projects.assigned);try{const page=run.page;await page.locator('#fonciere-name').waitFor();assert(await page.locator('#fonciere-name').isDisabled());assert.equal(await native(page).getByRole('button',{name:'Enregistrer',exact:true}).count(),0);}finally{await run.context.close();}}
 });
 await test('Revocation removes an already-open project view and its navigation on actual access refresh, stale direct routes remain denied',async()=>{
  const run=await session('clement','/fonciere?project='+fixture.projects.assigned);try{const page=run.page;await page.locator('#fonciere-name').waitFor();
   await api('fonciere_assign_project',{p_project:fixture.projects.assigned,p_user:fixture.users.clement.id,p_assigned:false});await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});await page.locator('#fonciere-name').waitFor({state:'detached',timeout:30000});await page.getByText('Ce projet est inaccessible ou n’existe plus.',{exact:true}).waitFor();await openFonciereGroup(page);assert.equal(await page.locator('[data-navigation-module=fonciere]:visible').count(),1,'Assignment revocation clears cached dossier while module navigation remains authorized');
   await api('fonciere_assign_project',{p_project:fixture.projects.assigned,p_user:fixture.users.clement.id,p_assigned:true});await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});await page.locator('#fonciere-name').waitFor({timeout:30000});
   await change('clement',{fonciere:{level:'none',sensitive:{}}});
   await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});await native(page).waitFor({state:'detached',timeout:30000});await openFonciereGroup(page);assert.equal(await page.locator('[data-navigation-module=fonciere]').count(),0);await page.goto(fixture.app+'/fonciere?project='+fixture.projects.assigned);await page.locator('.crm-shell:visible').waitFor();assert.equal(await native(page).count(),0);
  }finally{await api('fonciere_assign_project',{p_project:fixture.projects.assigned,p_user:fixture.users.clement.id,p_assigned:true});await change('clement',{fonciere:{level:'contribute',sensitive:{}}});await run.context.close();}
 });
 await test('Contacts creation and return works for independently permitted Contacts + Projets without Presentations',async()=>{
  const run=await session('contactsWriter','/fonciere?project='+fixture.projects.assigned);try{const page=run.page;await page.locator('#fonciere-name').waitFor();const draft='Projet retour '+randomUUID();await page.locator('#fonciere-name').fill(draft);await native(page).getByRole('button',{name:'Créer un contact',exact:true}).click();const form=page.locator('.contact-create-form:visible');await form.waitFor();await form.locator('[name=name]').fill('Retour '+randomUUID());await form.locator('[name=firstName]').fill('Test');await form.locator('[name=email]').fill('retour-ui-'+randomUUID()+'@example.invalid');const saved=page.waitForResponse(response=>response.url().endsWith('/rpc/crm_save_contact_bundle')&&response.request().method()==='POST');await form.getByRole('button',{name:'Enregistrer et revenir au projet',exact:true}).click();assert.equal((await saved).status(),200);await native(page).waitFor();assert.equal(await page.locator('#fonciere-name').inputValue(),draft);assert(await native(page).locator('input[name=agentContactId]').inputValue());assert.equal(await page.locator('[data-izord-generator]:visible').count(),0);
   await page.reload();
  }finally{await run.context.close();}
 });
 await test('EN mobile Administration: same independent controls, complete searches and no horizontal overflow',async()=>{
  const run=await session('admin','/admin','en',true);try{const page=run.page;await selectUser(page);const group=page.locator('[data-admin-group=fonciere]');assert.match(await group.innerText(),/Projects/);assert.match(await group.innerText(),/Project Presentations/);assert.equal(await page.locator('[data-admin-module=fonciere] select').inputValue(),'contribute');assert.equal(await page.locator('[data-admin-module=izord] select').inputValue(),'none');await noOverflow(page);await group.screenshot({path:join(output,'administration-fonciere-mobile-en.png')});await page.locator('section[aria-labelledby=admin-fonciere-assignments-title]').screenshot({path:join(output,'administration-affectation-mobile-en.png')});
  }finally{await run.context.close();}
 });
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 writeFileSync(join(output,process.env.FONCIERE_ACCESS_BROWSER_REPORT||'browser-results.json'),JSON.stringify({passed:checks.length,checks,browser:browser.version(),pageErrors:errors,externalRequests:external,evidence:'Source-identical local production build; actual Auth/RPC/Storage and fictional users only; Chromium touch emulation390px; no mocked success, mail or paid AI'},null,2));
}catch(error){const pages=contexts.flatMap(context=>context.pages());const page=pages.at(-1);if(page&&!page.isClosed())await page.screenshot({path:join(output,'browser-failure.png'),fullPage:true});writeFileSync(join(output,'browser-failure.json'),JSON.stringify({phase,error:String(error),errors,external},null,2));throw error;}
finally{for(const context of contexts)await context.close();await browser.close();}
