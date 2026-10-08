/** Actual candidate UI, fictitious intercepted local Auth/RPC only. No Production proof. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createFixture,profiles,groups,modules} from './fixture.mjs';
const require=createRequire(import.meta.url);
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin=process.env.I18N_URL||'http://127.0.0.1:3299',out=process.env.I18N_ARTIFACTS||'/private/tmp/oar-bilingual-20261008/browser-access';
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname),'Local target only');mkdirSync(out,{recursive:true});
const results=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const menu=page=>page.locator(page.viewportSize().width<1024?'.unified-more-panel':'.sidebar');
const nav=page=>page.locator('nav.mobile-crm-navigation');
const moduleButton=(page,id)=>menu(page).locator(`[data-navigation-module="${id}"]`);
const groupButton=(page,id)=>menu(page).locator(`[data-navigation-group="${id}"]`);
async function openMore(page){if(page.viewportSize().width>=1024)return;const panel=page.locator('.unified-more-panel');if(!await panel.isVisible()){await page.locator('#unified-more-trigger').click();await panel.waitFor();}}
function languageButton(page,language){return page.getByRole('button',{name:language==='en'?'English — EN':'Français — FR',exact:true}).filter({visible:true}).first();}
async function switchLanguage(page,language){await languageButton(page,language).click();await page.waitForFunction(lang=>document.documentElement.lang===lang,language==='en'?'en-GB':'fr');}
async function waitIdle(state){let stable=0,previous=state.requests;for(let i=0;i<30&&stable<3;i++){await delay(70);stable=previous===state.requests?stable+1:0;previous=state.requests;}}
async function setup(browser,profile,mobile){
 const context=await browser.newContext({viewport:mobile?{width:390,height:760}:{width:1440,height:900},locale:'fr-FR',timezoneId:'Europe/Paris',isMobile:mobile,hasTouch:mobile});
 const fixture=createFixture(profile),state={requests:0,writes:0,signIns:0,failSignIn:false,delaySignIn:0,delayAdmin:0,adminReads:0,failVerification:false,updates:0};
 await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
  if(url.origin==='http://127.0.0.1:4097'||url.origin===origin&&url.pathname.startsWith('/api/')){
   state.requests++;let body={};try{body=request.postDataJSON()||{};}catch{}
   const reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'},body:JSON.stringify(data)});
   if(url.pathname==='/auth/v1/token'&&request.method()==='POST'){state.signIns++;if(state.delaySignIn)await delay(state.delaySignIn);if(state.failSignIn)return reply({msg:'Fictitious credential error',code:'invalid_credentials'},400);}
   if(url.pathname==='/auth/v1/user'&&request.method()==='GET'&&state.failVerification)return reply({msg:'Fictitious session denied',code:'bad_jwt'},401);
   if(url.pathname==='/auth/v1/user'&&request.method()==='PUT'){state.updates++;return reply(fixture.user);}
   if(url.pathname==='/rest/v1/rpc/crm_admin_users'){state.adminReads++;if(state.delayAdmin)await delay(state.delayAdmin);}
   if(url.pathname==='/rest/v1/rpc/crm_invite_accept'){state.writes++;return reply({accepted:true});}
   const response=fixture.respond(request.method(),url,body);if(fixture.audit.writes.length)state.writes=fixture.audit.writes.length;
   return route.fulfill({status:response.status,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'},contentType:'application/json',body:response.body===null?'':JSON.stringify(response.body)});
  }
  if(url.origin===origin||['blob:','data:'].includes(url.protocol))return route.continue();
  fixture.audit.blocked.push(request.method()+' '+url.origin+url.pathname);return route.abort();
 });
 const page=await context.newPage(),errors=[],missing=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.text().includes('[i18n] Missing'))missing.push(m.text());});
 return {context,page,fixture,state,errors,missing};
}
async function login(page,fixture,path='/'){
 await page.goto(origin+path);await page.getByLabel('Email',{exact:true}).fill(fixture.user.email);await page.getByLabel('Mot de passe',{exact:true}).fill('Bilingual-Fictive-2026!');await page.getByRole('button',{name:'Se connecter',exact:true}).click();
 await page.locator('.crm-shell').waitFor({timeout:90000});await page.locator('.sidebar').waitFor({state:'attached'});const expectedGroup=groups.find(group=>group.modules.some(module=>profiles[fixture.profile].allowed.includes(module)));if(expectedGroup)await page.locator(`.sidebar [data-navigation-group="${expectedGroup.id}"]`).waitFor({state:'attached'});await openMore(page);
}
async function capture(page,name){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'No page overflow for '+name);await page.screenshot({path:`${out}/${name}.png`,fullPage:false});}
async function mark(locator){await locator.evaluate(el=>el.__bilingualIdentity=true);}
async function retained(locator){return locator.evaluate(el=>el.__bilingualIdentity===true);}
async function verifyNav(page,fixture){
 const allowed=profiles[fixture.profile].allowed;
 assert.deepEqual(await menu(page).locator('[data-navigation-group]').evaluateAll(ns=>ns.map(n=>n.dataset.navigationGroup)),groups.filter(g=>g.modules.some(m=>allowed.includes(m))).map(g=>g.id));
 const collected=[];
 for(const group of groups.filter(g=>g.modules.some(m=>allowed.includes(m)))){
  const button=groupButton(page,group.id);if(await button.getAttribute('aria-expanded')!=='true')await button.click();
  const panelId=await button.getAttribute('aria-controls');collected.push(...await page.locator(`[id="${panelId}"] [data-navigation-module]`).evaluateAll(ns=>ns.map(n=>n.dataset.navigationModule)));
  await button.click();
 }
 const direct=await menu(page).locator('[data-navigation-module]').evaluateAll(ns=>ns.map(n=>n.dataset.navigationModule));
 assert.deepEqual(new Set([...direct.filter(m=>m!=='admin'),...collected]),new Set(allowed),'Exact module projection and destinations');
 assert.deepEqual(await nav(page).locator('[data-navigation-module]').evaluateAll(ns=>ns.map(n=>n.dataset.navigationModule)),fixture.expectedShortcuts(),'Shortcut destinations and order unchanged');
 assert.equal(await nav(page).locator('[data-language-selector]').count(),0,'Language adds no shortcut');
}
async function sdkEvent(page,event,fixture){await page.evaluate(async({event,user,token})=>{
 let client;window.webpackChunk_N_E.push([[Math.random()],{},req=>{const entries=req.c?Object.values(req.c):Object.entries(req.m).filter(([,factory])=>String(factory).includes('http://127.0.0.1:4097')).map(([id])=>({exports:req(id)}));for(const entry of entries){for(const value of Object.values(entry.exports||{})){if(value&&typeof value==='object'&&value.auth&&typeof value.auth.refreshSession==='function'&&typeof value.from==='function'){client=value;break;}}if(client)break;}}]);
 if(!client)throw new Error('Fictional SDK not found');const session={user,access_token:token,refresh_token:'fictional-refresh',token_type:'bearer',expires_at:4102444800,expires_in:31536000};await client.auth._saveSession(session);await client.auth._notifyAllSubscribers(event,session,false);
 },{event,user:fixture.user,token:fixture.token});}
async function anonymousCase(browser,engine,mobile){
 const test=await setup(browser,'none',mobile),{context,page,state,errors,missing}=test;try{
  await page.goto(origin+'/');await page.getByRole('heading',{name:'Connexion au CRM',exact:true}).waitFor();await page.locator('input[autocomplete="username"]').waitFor({timeout:90000});const selectorBoxes=await page.locator('[data-language-selector] button').evaluateAll(buttons=>buttons.map(button=>{const r=button.getBoundingClientRect();return{x:r.x,right:r.right};}));assert.equal(selectorBoxes.every((box,index)=>box.right<=page.viewportSize().width+1&&(!index||selectorBoxes[index-1].right<=box.x)),true,'Auth selector buttons fit and never overlap');await capture(page,`${engine}-${mobile?'mobile':'desktop'}-auth-fr`);await switchLanguage(page,'en');await page.getByRole('heading',{name:'Sign in to the CRM',exact:true}).waitFor();await capture(page,`${engine}-${mobile?'mobile':'desktop'}-auth-en`);
  const email=page.getByLabel('Email',{exact:true}),password=page.locator('input[autocomplete="current-password"]');await email.fill('typed@example.invalid');await password.fill('  Fictional-Caret-2026!  ');await mark(email);await mark(password);
  await password.evaluate(input=>{input.focus();input.setSelectionRange(2,9,'backward');});const eye=page.getByRole('button',{name:'Show password',exact:true});if(mobile)await eye.tap();else await eye.click();
  assert.equal(await password.getAttribute('type'),'text');assert.equal(await password.evaluate(input=>input.selectionStart===2&&input.selectionEnd===9&&input.selectionDirection==='backward'&&document.activeElement===input),true,'Eye preserves focus/selection');
  await waitIdle(state);let before=state.requests;await switchLanguage(page,'fr');assert.equal(await password.getAttribute('type'),'text','Language switch preserves visibility');assert.equal(await password.inputValue(),'  Fictional-Caret-2026!  ');assert.equal(await email.inputValue(),'typed@example.invalid');assert.equal(await retained(password)&&await retained(email),true,'Language switch retains DOM fields');await delay(150);assert.equal(state.requests,before,'Language switch creates no Auth/RPC request');
  await page.getByRole('button',{name:'Masquer le mot de passe',exact:true}).click();state.failSignIn=true;state.delaySignIn=450;await page.getByRole('button',{name:'Se connecter',exact:true}).click();await switchLanguage(page,'en');await page.getByRole('status').filter({hasText:'Unable to sign in. Check your credentials.'}).waitFor();assert.equal(state.signIns,1);await switchLanguage(page,'fr');await page.getByRole('status').filter({hasText:'Connexion impossible. Vérifiez vos identifiants.'}).waitFor();assert.equal(state.signIns,1,'Changing language never retries sign-in');
  assert.equal(await retained(password),true);assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);assert.deepEqual(test.fixture.audit.blocked,[]);assert.equal(state.updates+state.writes,0);results.push({name:`${engine}-${mobile?'mobile':'desktop'}-anonymous`,status:'passed',requests:state.requests,signIns:state.signIns,errors,missing});
 }finally{await context.close();}}
async function navigationCase(browser,engine,mobile,profile){
 const test=await setup(browser,profile,mobile),{context,page,fixture,state,errors,missing}=test;try{
  await login(page,fixture,profile==='admin'?'/admin':'/');await verifyNav(page,fixture);await waitIdle(state);
  if(profile==='none'){await page.getByRole('heading',{name:'Aucun accès autorisé',exact:true}).waitFor();await switchLanguage(page,'en');await page.getByRole('heading',{name:'No access available',exact:true}).waitFor();}
  else{
   const group=groups.find(g=>g.modules.some(m=>profiles[profile].allowed.includes(m)));if(group){await groupButton(page,group.id).click();await mark(groupButton(page,group.id));}
   const route=page.url();await capture(page,`${engine}-${mobile?'mobile':'desktop'}-${profile}-nav-fr`);await waitIdle(state);const before=state.requests;const beforeAudit=fixture.audit.reads.length;await switchLanguage(page,'en');await delay(150);assert.equal(page.url(),route);assert.equal(state.requests,before,'Switching navigation language creates no data operation: '+JSON.stringify(fixture.audit.reads.slice(beforeAudit)));
   if(group){assert.equal(await groupButton(page,group.id).getAttribute('aria-expanded'),'true');assert.equal(await retained(groupButton(page,group.id)),true);}
   if(mobile)assert.equal(await menu(page).isVisible(),true,'Plus stays open on switch');
   await capture(page,`${engine}-${mobile?'mobile':'desktop'}-${profile}-nav-en`);await verifyNav(page,fixture);
  }
  if(profile==='full'&&mobile){
   await menu(page).getByRole('button',{name:'Close',exact:true}).click();
   await page.locator('.mobile-crm-header .mobile-action-button').click();
   const dialog=page.locator('.mobile-actions-sheet');await dialog.waitFor();await mark(dialog);
   await dialog.locator('button').evaluateAll(nodes=>nodes.forEach(node=>{node.__bilingualIdentity=true;}));
   await waitIdle(state);const before=state.requests;
   // Exercise a language update while the modal remains mounted, without clicking its backdrop.
   await page.locator('#unified-more-trigger').evaluate(button=>button.click());
   await menu(page).getByRole('button',{name:'Français — FR',exact:true}).evaluate(button=>button.click());
   await page.waitForFunction(()=>document.documentElement.lang==='fr');
   await menu(page).locator('.unified-more-close').evaluate(button=>button.click());
   assert.equal(await dialog.isVisible(),true,'Actions dialog stays open on language change');
   assert.equal(await retained(dialog),true,'Actions dialog DOM identity retained');
   assert.equal(await dialog.locator('button').evaluateAll(nodes=>nodes.every(node=>node.__bilingualIdentity===true)),true,'Stable system action ids retain every button');
   await delay(100);assert.equal(state.requests,before,'Changing open Actions language triggers no operation');
   await capture(page,`${engine}-mobile-actions-fr`);
   await dialog.locator('.mobile-sheet-header button').click();
   await openMore(page);await switchLanguage(page,'en');
  }
  if(profile==='admin'){
   if(mobile)await menu(page).getByRole('button',{name:'Close',exact:true}).click();
   await page.getByRole('heading',{name:'Users and access',exact:true}).waitFor();const user=page.getByRole('button').filter({hasText:fixture.user.email}).first();await user.click();const level=page.locator('select[aria-label*="Contacts"]');await level.selectOption('read');await mark(level);
   const history=page.locator('[data-admin-history]');await history.getByRole('button',{name:'View all history',exact:true}).click();await mark(history);await openMore(page);await waitIdle(state);const before=state.requests;
   await switchLanguage(page,'fr');assert.equal(await level.inputValue(),'read');assert.equal(await retained(level),true,'Admin edit retains value and DOM');assert.equal(await history.getByRole('button',{name:'Réduire l’historique',exact:true}).getAttribute('aria-expanded'),'true');assert.equal(await retained(history),true,'History stays mounted and expanded');await delay(100);assert.equal(state.requests,before,'Switching admin language does not reload/revoke/save');if(mobile)await menu(page).getByRole('button',{name:'Fermer',exact:true}).click();
   await capture(page,`${engine}-${mobile?'mobile':'desktop'}-admin-fr`);await openMore(page);await switchLanguage(page,'en');if(mobile)await menu(page).getByRole('button',{name:'Close',exact:true}).click();await capture(page,`${engine}-${mobile?'mobile':'desktop'}-admin-en`);await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await capture(page,`${engine}-${mobile?'mobile':'desktop'}-admin-en-top`);
   assert.equal(await history.getByText('Permissions saved',{exact:false}).count()>0,true,'Known audit action localized');assert.equal(await page.getByText('Dossier fictif',{exact:true}).count(),1,'Project title preserved');
  }
  assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);assert.deepEqual(fixture.audit.blocked,[]);assert.equal(state.writes+state.updates,0);results.push({name:`${engine}-${mobile?'mobile':'desktop'}-${profile}`,status:'passed',authRequests:fixture.audit.auth.length,reads:fixture.audit.reads.length,errors,missing});
 }finally{await context.close();}}
async function firstPasswordRecoveryCase(browser,engine,mobile){
 const test=await setup(browser,'none',mobile),{context,page,fixture,state,errors,missing}=test;try{
  await login(page,fixture);await page.goto(origin+'/?setup=1');const password=page.locator('input[autocomplete="new-password"]');await password.waitFor();await password.fill(' Fictional-New-2026! ');await mark(password);await switchLanguage(page,'en');assert.equal(await page.getByLabel('Choose a password',{exact:true}).inputValue(),' Fictional-New-2026! ');assert.equal(await retained(password),true);assert.equal(state.updates+state.writes,0);
  await sdkEvent(page,'PASSWORD_RECOVERY',fixture);await page.getByRole('heading',{name:'Reset password',exact:true}).waitFor();const recovery=page.locator('input[autocomplete="new-password"]');await recovery.fill(' Recovery-Fictional-2026! ');await mark(recovery);await switchLanguage(page,'fr');assert.equal(await recovery.inputValue(),' Recovery-Fictional-2026! ');assert.equal(await retained(recovery),true);assert.equal(state.updates+state.writes,0);await page.getByRole('button',{name:'Enregistrer le mot de passe',exact:true}).click();await page.getByRole('status').filter({hasText:'Mot de passe enregistré.'}).waitFor();assert.equal(state.updates,1,'Exactly one fictional password update');if(await page.locator('#unified-more-trigger').count())await openMore(page);await switchLanguage(page,'en');await page.getByRole('status').filter({hasText:'Password saved.'}).waitFor();assert.equal(state.updates,1);assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);assert.deepEqual(fixture.audit.blocked,[]);results.push({name:`${engine}-${mobile?'mobile':'desktop'}-first-password-recovery`,status:'passed',updates:state.updates,errors,missing});
 }finally{await context.close();}}
for(const engine of process.env.I18N_ENGINE?[process.env.I18N_ENGINE]:['chromium','webkit']){
 const browser=await(engine==='chromium'?chromium.launch({headless:true,channel:'chrome'}):webkit.launch({headless:true}));
 try{
  const cases=process.env.I18N_CASE?process.env.I18N_CASE.split(','):['anonymous-desktop','anonymous-mobile','full-desktop','full-mobile','limited-mobile','reader-desktop','none-mobile','admin-desktop','admin-mobile','password-mobile'];
  for(const name of cases){const before=results.length;try{if(name.startsWith('anonymous'))await anonymousCase(browser,engine,name.endsWith('mobile'));else if(name==='password-mobile')await firstPasswordRecoveryCase(browser,engine,true);else{const [profile,surface]=name.split('-');await navigationCase(browser,engine,surface==='mobile',profile);}console.log('PASS '+engine+' '+name);}catch(error){results.push({name:engine+'-'+name,status:'failed',error:String(error)});throw error;}finally{writeFileSync(`${out}/${engine}-results.json`,JSON.stringify(results.filter(result=>result.name.startsWith(engine+'-')),null,2));}}
 }finally{await browser.close();}
}
