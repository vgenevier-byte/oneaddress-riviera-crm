import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {groups,installFixture} from './fixture.mjs';
const require=createRequire(import.meta.url);
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin=process.env.I18N_ORIGIN||'http://127.0.0.1:3299';
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const phase=process.env.I18N_STYLE_PHASE||'baseline';assert.ok(['baseline','final'].includes(phase));
const dest='/Users/vg/.codex/visualizations/2026/10/08/01a11ab6-cbef-79a0-b529-bcd6a9662224/crm-bilingual';
const out=`${dest}/evidence/publication/contacts-style/${phase}`,captures=`${dest}/captures/contacts-style-${phase}`;
mkdirSync(out,{recursive:true});mkdirSync(captures,{recursive:true});
const results=[];
const configurations=[{engine:'chromium',viewport:{width:1440,height:1000},mobile:false},{engine:'webkit',viewport:{width:390,height:667},mobile:true}];
function menu(page,mobile){return page.locator(mobile?'.unified-more-panel':'.sidebar');}
async function openMenu(page,mobile){if(mobile&&!await menu(page,mobile).isVisible())await page.locator('#unified-more-trigger').click();}
async function closeMenu(page,mobile){if(mobile&&await menu(page,mobile).isVisible())await menu(page,mobile).locator('.unified-more-close').click();}
async function choose(page,mobile,language,record){
 const name=language==='en'?'English — EN':'Français — FR';
 if(await page.getByRole('dialog').count()){
  // The actual Contacts modal backdrop makes navigation inaccessible. Existing
  // handlers test provider reactivity, never ordinary clickability behind it.
  if(mobile&&!await menu(page,mobile).isVisible())await page.locator('#unified-more-trigger').evaluate(button=>button.click());
  await menu(page,mobile).locator('[data-language-selector]').getByRole('button',{name,exact:true}).evaluate(button=>button.click());
  if(mobile)await menu(page,mobile).locator('.unified-more-close').evaluate(button=>button.click());
  record.programmaticModalLanguageChanges++;
 }else{await openMenu(page,mobile);await menu(page,mobile).locator('[data-language-selector]').getByRole('button',{name,exact:true}).click();await closeMenu(page,mobile);}
 await page.waitForFunction(lang=>document.documentElement.lang===lang,language==='en'?'en-GB':'fr');
}
async function navigate(page,mobile,id){
 await openMenu(page,mobile);const parent=groups.find(group=>group.modules.includes(id));
 if(parent){const group=menu(page,mobile).locator(`[data-navigation-group="${parent.id}"]`);if(await group.getAttribute('aria-expanded')!=='true')await group.click();}
 await menu(page,mobile).locator(`[data-navigation-module="${id}"]`).click();await closeMenu(page,mobile);
}
async function style(locator){return locator.evaluate(element=>{
 const s=getComputedStyle(element),r=element.getBoundingClientRect(),form=element.closest('form'),f=form?getComputedStyle(form):null;
 const properties=['color','backgroundColor','opacity','display','font','fontSize','lineHeight','fontWeight','letterSpacing','textIndent','visibility','padding','border','borderRadius','boxShadow','transform','minHeight'];
 return {text:element.textContent.trim(),...Object.fromEntries(properties.map(key=>[key,s[key]])),width:r.width,height:r.height,formWidth:form?.getBoundingClientRect().width??null,formColumns:f?.gridTemplateColumns??null,disabled:element.matches(':disabled'),after:getComputedStyle(element,'::after').content};
});}
function contrast(value){const rgb=text=>(text.match(/[\d.]+/g)||[]).slice(0,3).map(Number);const luminance=text=>rgb(text).map(x=>{x/=255;return x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4;}).reduce((sum,x,index)=>sum+x*[.2126,.7152,.0722][index],0);const a=luminance(value.color),b=luminance(value.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
async function pendingMetrics(button,value){
 const backdrop=await button.evaluate(element=>{let node=element.parentElement;while(node){const background=getComputedStyle(node).backgroundColor;const numbers=background.match(/[\d.]+/g)?.map(Number)||[];if(numbers.length===3||numbers[3]===1)return background;node=node.parentElement;}return null;});
 value.backdrop=backdrop;value.contrast=contrast(value);
 if(backdrop){const rgb=text=>text.match(/[\d.]+/g).slice(0,3).map(Number),alpha=Number(value.opacity),under=rgb(backdrop),blend=color=>'rgb('+rgb(color).map((part,index)=>part*alpha+under[index]*(1-alpha)).join(', ')+')';value.contrastWithButtonOpacity=contrast({color:blend(value.color),backgroundColor:blend(value.backgroundColor)});}
 if(phase==='final'){assert.ok(Math.abs(Number(value.opacity)-.75)<.005,'Pending Contact submit uses the scoped .75 opacity');assert.ok((value.contrastWithButtonOpacity??value.contrast)>=4.5,'Pending Contact text remains readable');}
 return value;
}
async function states(page,form,record,key,language){
 const button=form.locator('button[type="submit"]');const snapshots={};
 for(const state of ['normal','hover','focus']){
  await page.mouse.move(0,0);if(state==='hover')await button.hover();
  if(state==='focus'){await page.keyboard.press('Tab');await button.focus();assert.equal(await button.evaluate(element=>element===document.activeElement),true);}
  await page.waitForTimeout(220);const value=await style(button);value.contrast=contrast(value);if(state==='focus')value.focusMethod='Native HTMLElement.focus after keyboard input; Tab traversal is not asserted';snapshots[state]=value;
  const path=`${captures}/${record.name}-${key}-${language}-${state}.png`;
  await button.scrollIntoViewIfNeeded();await page.screenshot({path});record.screenshots.push({path,language,view:key,state});
  if(phase==='final'){assert.ok(value.contrast>=4.5,`${key} ${language} ${state} text contrast ${value.contrast}`);assert.notEqual(value.display,'grid','Contact submit remains a button rather than a card');assert.ok(value.height<64,'Contact submit retains compact button height');}
 }
 record.buttons[`${key}-${language}`]=snapshots;
}
async function simulatedMutations(context){
 const captured=[];let waiting;
 await context.route('**/rest/v1/rpc/crm_mutate_record',async route=>{
  const request=route.request();const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
  assert.equal(new URL(request.url()).origin,'http://127.0.0.1:4097');const item={body:request.postDataJSON(),reply:null};captured.push(item);
  const response=await new Promise(resolve=>waiting={item,resolve});item.reply=response;
  await route.fulfill({status:response.status,headers,contentType:'application/json',body:JSON.stringify(response.body)});
 });
 return {captured,async pending(count){const start=Date.now();while(!waiting||captured.length<count){if(Date.now()-start>12000)throw new Error('Expected fictional Contact request '+count);await new Promise(resolve=>setTimeout(resolve,20));}assert.equal(captured.length,count);return waiting.item;},release(){assert.ok(waiting);const next=waiting;waiting=null;next.resolve({status:403,body:{code:'42501',message:'FICTITIOUS_TECHNICAL_DETAIL_NOT_FOR_DISPLAY'}});},close(){if(waiting)this.release();}};
}

for(const config of configurations.filter(config=>!process.env.I18N_STYLE_ENGINE||config.engine===process.env.I18N_STYLE_ENGINE)){
 const browser=await(config.engine==='chromium'?chromium.launch({headless:true,channel:'chrome'}):webkit.launch({headless:true}));
 for(const profile of ['full','limited']){
  const record={name:`${config.engine}-${config.mobile?'mobile':'desktop'}-${profile}`,phase,profile,viewport:config.viewport,browserVersion:browser.version(),status:'running',buttons:{},screenshots:[],preservation:{},programmaticModalLanguageChanges:0,proofBoundary:'Actual integrated UI with locally fictitious Auth/read projections and intercepted writes. Full Contacts handlers complete synchronously; sustained pending is exercised only through the existing limited-account adapter. No pending field is unlocked.'};
  const context=await browser.newContext({viewport:config.viewport}),fixture=await installFixture(context,profile,origin),simulation=await simulatedMutations(context),page=await context.newPage(),errors=[];
  const counterNames=['Zéro Exemple','Une Exemple','Deux Exemple'];const counterContacts=counterNames.map((name,index)=>({...fixture.payload.contacts[1],id:`style-counter-${index}`,name,email:`style-counter-${index}@example.invalid`,phone:''}));fixture.payload.contacts.unshift(...counterContacts);fixture.payload.leads=counterContacts.flatMap((contact,index)=>Array.from({length:index},(_,position)=>({id:`style-lead-${index}-${position}`,category:'Villa',contactName:contact.name,status:'Nouveau',value:100,priority:'Moyenne',nextAction:'Texte métier français',dueDate:'2026-10-15',notes:''})));
  fixture.payload.contacts.push({...fixture.payload.contacts.find(contact=>contact.id==='i18n-contact-2'),id:'style-supplier',name:'Fournisseur Préservation',kind:'Prestataire',supplierCategory:'Entretien',supplierStatus:'Actif',supplierReliability:'Fiable',supplierBankAccounts:[]});
  page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  try{
   await page.goto(origin);await page.locator('input[type="email"]').fill(fixture.user.email);await page.locator('input[autocomplete="current-password"]').fill('Bilingual-Fictive-2026!');await page.locator('form button:not([type="button"])').first().click();await page.locator('.crm-shell').waitFor();await page.locator('.sidebar [data-navigation-group="services"]').waitFor({state:'attached'});
   await navigate(page,config.mobile,'contacts');const creation=page.locator('.contact-create-form');await creation.waitFor();
   if(phase==='final'){
    record.counterCoverage={fullCounts:profile==='full'?[0,1,2]:[0,0,0],limitedLeadsNotAuthorised:profile==='limited'};
    for(const language of ['fr','en']){
     await choose(page,config.mobile,language,record);
     for(let index=0;index<3;index++){const count=profile==='full'?index:0;const expected=language==='fr'?`${count} demande${count>1?'s':''} client${count>1?'s':''} liée${count>1?'s':''}`:`${count} linked client ${count===1?'enquiry':'enquiries'}`;const row=page.locator('.oar-contact-row').filter({has:page.getByRole('heading',{name:counterNames[index],exact:true})});assert.ok((await row.textContent()).includes(expected));}
     let path=`${captures}/${record.name}-contacts-counts-list-${language}.png`;await page.locator('.contacts-list-card').screenshot({path});record.screenshots.push({path,language,view:'contacts-list',state:'normal'});
     await page.locator('.oar-contact-row').filter({has:page.getByRole('heading',{name:counterNames[2],exact:true})}).locator('[data-crm-action="details"]').click();const summary=page.getByRole('dialog').locator('.contact-related-section');await summary.waitFor();path=`${captures}/${record.name}-contacts-counter-detail-${language}.png`;await summary.screenshot({path});record.screenshots.push({path,language,view:'contact-counter-detail',state:'normal'});await page.getByRole('dialog').locator('[data-crm-dismiss="true"]').click();
    }
    await choose(page,config.mobile,'fr',record);
   }
   await creation.locator('[name="firstName"]').fill('Camille');await creation.locator('[name="name"]').fill('Brouillon création français');const creationHandle=await creation.elementHandle(),nameHandle=await creation.locator('[name="name"]').elementHandle();
   for(const language of ['fr','en','fr']){
    const calls=simulation.captured.length,auth=fixture.audit.auth.length;await choose(page,config.mobile,language,record);
    assert.equal(await creationHandle.evaluate(element=>element.isConnected),true);assert.equal(await nameHandle.evaluate(element=>element.isConnected),true);assert.equal(await creation.locator('[name="name"]').inputValue(),'Brouillon création français');assert.equal(await creation.locator('[name="kind"]').inputValue(),'Client');assert.equal(simulation.captured.length,calls);assert.equal(fixture.audit.auth.length,auth);
    if(!record.buttons[`create-${language}`])await states(page,creation,record,'create',language);
   }
   if(profile==='limited'){
    await creation.locator('button[type="submit"]').click();const request=await simulation.pending(1);assert.equal(request.body.p_patch.name,'Brouillon création français');assert.equal(request.body.p_patch.kind,'Client');
    for(const language of ['fr','en','fr']){await choose(page,config.mobile,language,record);assert.equal(await creation.locator('[name="name"]').isDisabled(),true);await page.mouse.move(0,0);await page.waitForTimeout(220);const value=await style(creation.locator('button[type="submit"]'));await pendingMetrics(creation.locator('button[type="submit"]'),value);record.buttons[`create-${language}`].pending=value;assert.equal(value.disabled,true);assert.equal(simulation.captured.length,1);if(language==='en'){const path=`${captures}/${record.name}-create-en-pending.png`;await creation.locator('button[type="submit"]').scrollIntoViewIfNeeded();await page.screenshot({path});record.screenshots.push({path,language,view:'create',state:'pending'});}}
    simulation.release();await creation.getByRole('alert').waitFor();assert.equal((await creation.getByRole('alert').textContent()).includes('FICTITIOUS_TECHNICAL_DETAIL'),false);
    for(const language of ['fr','en','fr']){await choose(page,config.mobile,language,record);assert.equal(await creationHandle.evaluate(element=>element.isConnected),true);assert.equal(await nameHandle.evaluate(element=>element.isConnected),true);assert.equal(await creation.locator('[name="name"]').inputValue(),'Brouillon création français');assert.ok((await creation.getByRole('alert').textContent()).includes(language==='en'?'Save refused.':'Enregistrement refusé.'));assert.equal(simulation.captured.length,1);}
   }
   const contact=page.locator('.oar-contact-row').filter({has:page.getByRole('heading',{name:'Bruno Démonstration',exact:true})});await contact.getByRole('button',{name:'Modifier',exact:true}).click();const editing=page.locator('#contact-edit-panel form');await editing.waitFor();await editing.locator('[name="name"]').fill('Brouillon modification français');const editHandle=await editing.elementHandle(),editNameHandle=await editing.locator('[name="name"]').elementHandle();
   for(const language of ['fr','en','fr']){const calls=simulation.captured.length,auth=fixture.audit.auth.length;await choose(page,config.mobile,language,record);assert.equal(await editHandle.evaluate(element=>element.isConnected),true);assert.equal(await editNameHandle.evaluate(element=>element.isConnected),true);assert.equal(await editing.locator('[name="name"]').inputValue(),'Brouillon modification français');assert.equal(await editing.locator('[name="kind"]').inputValue(),'Client');assert.equal(simulation.captured.length,calls);assert.equal(fixture.audit.auth.length,auth);if(!record.buttons[`edit-${language}`])await states(page,editing,record,'edit',language);}
   if(profile==='limited'){
    await editing.locator('button[type="submit"]').click();const request=await simulation.pending(2);assert.equal(request.body.p_id,'i18n-contact-2');assert.equal(request.body.p_patch.name,'Brouillon modification français');
    for(const language of ['fr','en','fr']){await choose(page,config.mobile,language,record);assert.equal(await editing.locator('[name="name"]').isDisabled(),true);await page.mouse.move(0,0);await page.waitForTimeout(220);const value=await style(editing.locator('button[type="submit"]'));await pendingMetrics(editing.locator('button[type="submit"]'),value);record.buttons[`edit-${language}`].pending=value;assert.equal(value.disabled,true);assert.equal(simulation.captured.length,2);if(language==='en'){const path=`${captures}/${record.name}-edit-en-pending.png`;await editing.locator('button[type="submit"]').scrollIntoViewIfNeeded();await page.screenshot({path});record.screenshots.push({path,language,view:'edit',state:'pending'});}}
    simulation.release();await editing.getByRole('alert').waitFor();for(const language of ['fr','en','fr']){await choose(page,config.mobile,language,record);assert.equal(await editHandle.evaluate(element=>element.isConnected),true);assert.equal(await editNameHandle.evaluate(element=>element.isConnected),true);assert.equal(await editing.locator('[name="name"]').inputValue(),'Brouillon modification français');assert.ok((await editing.getByRole('alert').textContent()).includes(language==='en'?'Save refused.':'Enregistrement refusé.'));assert.equal(simulation.captured.length,2);}
   }
   await page.locator('#contact-edit-panel [data-crm-dismiss="true"]').click();
   // Computed-style samples only: do not capture or redesign unaffected modules.
   await choose(page,config.mobile,'fr',record);await openMenu(page,config.mobile);const nav=menu(page,config.mobile).locator('[data-navigation-module="contacts"]');record.preservation.navigation=await style(nav);await closeMenu(page,config.mobile);
   await navigate(page,config.mobile,'planning');const planning=page.locator('form').filter({has:page.locator('button[type="submit"]')}).first();await planning.waitFor();record.preservation.planning=await style(planning.locator('button[type="submit"]'));await planning.locator('button[type="submit"]').hover();await page.waitForTimeout(220);record.preservation.planningHover=await style(planning.locator('button[type="submit"]'));
   if(profile==='full'){
    await navigate(page,config.mobile,'contacts');await page.locator('.oar-contact-row').filter({has:page.getByRole('heading',{name:'Fournisseur Préservation',exact:true})}).locator('[data-crm-action="details"]').click();
    await page.getByRole('dialog').getByRole('button',{name:'+ Ajouter un RIB',exact:true}).click();const banking=page.locator('dialog.banking-dialog form button[type="submit"]');await banking.waitFor();record.preservation.banking=await style(banking);await banking.hover();await page.waitForTimeout(220);record.preservation.bankingHover=await style(banking);await page.locator('dialog.banking-dialog').getByRole('button',{name:'Fermer',exact:true}).click();await page.getByRole('dialog').locator('[data-crm-dismiss="true"]').click();
   }
   if(phase==='final'){
    const baseline=JSON.parse(readFileSync(`${dest}/evidence/publication/contacts-style/baseline/${record.name}.json`,'utf8'));const cssOnly=value=>JSON.parse(JSON.stringify(value,(key,item)=>['focused','focusVisible'].includes(key)?undefined:item));assert.deepEqual(cssOnly(record.preservation),cssOnly(baseline.preservation),'Unchanged navigation, Planning and banking computed styles');
    for(const key of ['create-fr','create-en','edit-fr','edit-en'])assert.equal(record.buttons[key].normal.formColumns.split(' ').length,record.buttons[key.replace('-en','-fr')].normal.formColumns.split(' ').length,'Language keeps the intended responsive column count');
   }
   assert.deepEqual(errors,[]);assert.equal(fixture.audit.writes.filter(path=>path!=='POST /rest/v1/rpc/crm_contact_documents').length,0,'No uncaptured business write');record.status='passed';record.sameDOMAndDraftFR_EN_FR=true;record.canonicalContactId='i18n-contact-2';
  }catch(error){record.status='failed';record.error=error.stack;const path=`${captures}/${record.name}-failure.png`;await page.screenshot({path}).catch(()=>{});record.screenshots.push({path,language:'unknown',view:'failure'});}
  finally{record.errors=errors;record.capturedFictionalMutations=simulation.captured;record.baseFixtureRefusals=fixture.audit.writes;simulation.close();await context.close();writeFileSync(`${out}/${record.name}.json`,JSON.stringify(record,null,2));results.push(record);console.log(record.name+' '+record.status);if(record.error)console.error(record.error);}
 }
 await browser.close();
}
writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));if(results.some(record=>record.status!=='passed'))process.exitCode=1;
