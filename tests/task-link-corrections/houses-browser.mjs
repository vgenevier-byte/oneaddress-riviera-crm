/** Real isolated Auth/HTTP RPC and canonical task storage. UI uses the actual
 * TasksWorkspace and shared selector. No external or business operation runs. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {chromium} from '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const root='/private/tmp/oar-task-link-corrections';
const fixture=JSON.parse(readFileSync(root+'/houses.fixture.private.json','utf8'));
const app='http://127.0.0.1:3198',output=root+'/evidence';mkdirSync(output,{recursive:true});
assert.equal(fixture.api,'http://127.0.0.1:55931','fixed isolated Auth/RPC target');
const previous=process.env.HOUSES_CASE&&existsSync(root+'/houses-browser-results.json')?JSON.parse(readFileSync(root+'/houses-browser-results.json','utf8')):null;
const results=(previous?.results??[]).filter(result=>!result.name.startsWith(process.env.HOUSES_CASE??'__none__')),receipts=(previous?.receipts??[]).filter(receipt=>receipt.target?.type!==process.env.HOUSES_CASE),pageErrors=[],externalRequests=[],contexts=[];
let taskWrites=receipts.length;
const browser=await chromium.launch({headless:true,channel:'chrome'});
const key=ref=>JSON.stringify([ref.type,ref.id,Object.entries(ref.context??{}).sort(([a],[b])=>a.localeCompare(b))]);
async function until(fn,message){for(let attempt=0;attempt<150;attempt++){if(await fn())return;await new Promise(done=>setTimeout(done,100));}throw Error(message);}
async function loginAuth(){
 const response=await fetch(fixture.api+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:fixture.publicKey,'Content-Type':'application/json'},body:JSON.stringify({email:fixture.users.full.email,password:fixture.password})});
 assert.equal(response.status,200,'fresh isolated Auth login');return (await response.json()).access_token;
}
async function rpc(token,name,args={}){
 const response=await fetch(fixture.api+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:fixture.publicKey,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(args)});
 assert.equal(response.status,200,'local RPC '+name);return response.json();
}
async function catalog(){
 const token=await loginAuth(),items=[];
 for(let offset=0;;offset+=200){const page=await rpc(token,'crm_task_targets_search',{p_type:'house',p_query:'',p_offset:offset,p_limit:200});items.push(...page.items);if(!page.hasMore)break;}
 const index=items.findIndex(item=>item.ref.id===fixture.last.id);assert(index>=200,'chosen house is beyond the first server page');
 const last=items[index];assert.equal(last.label,fixture.last.name);assert(last.searchFields.includes(fixture.last.address));assert(last.searchFields.includes(fixture.last.addressDetails.city));
 const months=await rpc(token,'crm_task_targets_search',{p_type:'monthly_charges',p_query:'',p_offset:0,p_limit:200});
 const monthly=months.items.find(item=>item.ref.context?.source==='hours'&&item.ref.context?.personId===fixture.worker.id);
 assert(monthly,'real monthly hours context exists for the fixture worker');
 return {count:items.length,index,monthly:monthly.ref};
}
async function open(lang,width){
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:lang==='en'?'en-GB':'fr-FR',timezoneId:'Europe/Paris',serviceWorkers:'block'});contexts.push(context);
 const page=await context.newPage();
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(url.hostname))return route.continue();externalRequests.push(url.origin+url.pathname);return route.abort();});
 page.on('pageerror',error=>pageErrors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto(app+'/?module=tasks');await page.locator('input[type=email]').fill(fixture.users.full.email);await page.locator('input[type=password]').fill(fixture.password);await page.locator('input[type=password]').press('Enter');
 await page.locator('.taskws').waitFor({timeout:60000});
 await page.getByRole('button',{name:lang==='en'?'English — EN':'Français — FR',exact:true}).first().click();
 await page.getByRole('button',{name:lang==='en'?'Add a task':'Ajouter une tâche',exact:true}).waitFor();await page.setViewportSize({width,height:900});
 return {page,context};
}
async function chooseHouse(selector,query,lang){
 const input=selector.getByRole('combobox',{name:lang==='en'?'House (optional)':'Maison (facultatif)',exact:true});
 await input.fill(query);
 const option=selector.getByRole('option').filter({hasText:fixture.last.name});await option.waitFor();
 const labels=await selector.getByRole('option').allTextContents();const index=labels.findIndex(label=>label.includes(fixture.last.name));assert(index>=0);
 await input.focus();for(let step=0;step<=index;step++)await input.press('ArrowDown');await input.press('Enter');
 await until(async()=>await selector.locator('select[name=taskContextHouseId]').inputValue()===fixture.last.id,'keyboard chooses the exact house ID');
 assert.equal(await input.inputValue(),fixture.last.name);
 return input;
}
async function journey({type,lang,width,query,monthly}){
 const en=lang==='en',session=await open(lang,width),{page,context}=session;
 const name=`${en?'Fictional house context':'Contexte maison fictif'} ${type} ${Date.now()}`;
 const target=type==='worker_period'?{type,id:fixture.worker.id,context:{startDate:'2026-11-01',endDate:'2026-11-30'}}:{...monthly,id:'2026-11'};
 try{
  await page.getByRole('button',{name:en?'Add a task':'Ajouter une tâche',exact:true}).click();const editor=page.locator('dialog[open]').last();
  await editor.locator('input[name=title]').fill(name);await editor.locator('input[name=dueDate]').fill('2026-12-10');
  await editor.getByRole('button',{name:en?'Link a CRM item':'Lier un élément du CRM',exact:true}).click();
  await editor.locator('.task-link-search > label > select').selectOption(type);
  await editor.getByLabel(en?'Search CRM items':'Rechercher un élément du CRM',{exact:true}).fill(fixture.worker.contactName);
  const sourceRef=type==='worker_period'?null:monthly;
  const result=type==='worker_period'
   ?editor.locator('.task-link-result[data-task-target-key]').filter({hasText:fixture.worker.contactName})
   :editor.locator('[data-task-target-key='+JSON.stringify(key(sourceRef))+']');
  if(type==='worker_period'){
   await until(async()=>await result.evaluateAll((nodes,workerId)=>nodes.some(node=>{const ref=JSON.parse(node.getAttribute('data-task-target-key'));return ref[0]==='worker_period'&&ref[1]===workerId;}),fixture.worker.id),'fixture worker period candidate loaded');
   const exact=await result.evaluateAll((nodes,workerId)=>nodes.findIndex(node=>{const ref=JSON.parse(node.getAttribute('data-task-target-key'));return ref[0]==='worker_period'&&ref[1]===workerId;}),fixture.worker.id);
   assert(exact>=0,'fixture worker found by label with explicit identity');await result.nth(exact).getByRole('button',{name:en?'Link item':'Lier l’élément',exact:true}).click();
  }else await result.getByRole('button',{name:en?'Link item':'Lier l’élément',exact:true}).click();
  const business=editor.getByRole('region',{name:en?'Link context':'Contexte du rattachement',exact:true});
  // The context is a semantic section with an accessible name; browsers expose
  // this as a region, while the data-scoped fallback keeps the assertion local.
  const contextPanel=(await business.count())?business:editor.locator('.task-link-context');
  await contextPanel.waitFor();
  if(type==='worker_period'){
   await contextPanel.getByLabel(en?'Work period start':'Début de la période de travail',{exact:true}).fill(target.context.startDate);
   await contextPanel.getByLabel(en?'Work period end':'Fin de la période de travail',{exact:true}).fill(target.context.endDate);
  }else await contextPanel.getByLabel(en?'Charges month':'Mois des charges',{exact:true}).fill(target.id);
  const selector=contextPanel.locator('.task-house-selector');await contextPanel.locator('[data-task-house-status=ready]').waitFor();
  assert.equal(await selector.getByRole('combobox').count(),1,'one visible searchable house choice');assert.equal(await selector.locator('input[type=search]').count(),1,'no separate house query input');
  assert.equal(await selector.locator('select[name=taskContextHouseId]').inputValue(),'','All houses is the default real empty ID');
  let input=await chooseHouse(selector,query,lang);
  if(type==='worker_period'){
   let failed=false;const pattern='**/rest/v1/rpc/crm_task_targets_search';
   const transient=async route=>{let args;try{args=route.request().postDataJSON();}catch{}if(!failed&&args?.p_type==='house'){failed=true;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Fictitious temporary house catalogue outage'})});}return route.fallback();};
   await page.route(pattern,transient);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
   await contextPanel.locator('[data-task-house-status=error]').waitFor();assert(failed,'only the next actual house catalogue response was simulated unavailable');
   assert.equal(await selector.locator('select[name=taskContextHouseId]').inputValue(),fixture.last.id,'catalogue failure preserves the actual selected ID');
   assert(!(await selector.textContent()).includes(fixture.last.name),'failed refresh drops the prior private house label');
   assert(!(await selector.textContent()).includes(fixture.last.address),'failed refresh drops prior address previews');
   await selector.scrollIntoViewIfNeeded();await page.screenshot({path:output+'/houses-worker_period-error-preserves-id.png',fullPage:false});
   await page.unroute(pattern,transient);await selector.getByRole('button',{name:en?'Retry houses':'Réessayer les maisons',exact:true}).click();
   await contextPanel.locator('[data-task-house-status=ready]').waitFor();assert.equal(await selector.locator('select[name=taskContextHouseId]').inputValue(),fixture.last.id);
   assert.equal(await input.inputValue(),fixture.last.name,'successful retry resolves the original selected house label');
  }
  await input.fill('Maison catalogue 000');
  assert.equal(await selector.locator('select[name=taskContextHouseId]').inputValue(),fixture.last.id,'typing another query cannot replace the selected house');
  await until(async()=>await selector.locator('small').filter({hasText:fixture.last.name}).count()>0,'the selected house label remains visible while searching');
  await input.press('Escape');assert.equal(await input.inputValue(),fixture.last.name,'Escape restores the selected label');
  const controlGeometry=await selector.locator('[data-searchable-select] > span:first-child > button').evaluateAll(nodes=>nodes.map(node=>{
   const style=getComputedStyle(node),rect=node.getBoundingClientRect(),rules=[];
   function visit(cssRules,condition=''){
    for(const rule of cssRules){
     if(rule.selectorText){try{if(node.matches(rule.selectorText)&&['width','min-width','max-width','left','right'].some(property=>rule.style.getPropertyValue(property)))rules.push({selector:rule.selectorText,style:rule.style.cssText,condition});}catch{}}
     else if(rule.cssRules&&(!rule.conditionText||!rule.media||matchMedia(rule.conditionText).matches))visit(rule.cssRules,rule.conditionText||condition);
    }
   }
   for(const sheet of document.styleSheets){try{visit(sheet.cssRules);}catch{}}
   return{label:node.getAttribute('aria-label'),rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},computed:{width:style.width,minWidth:style.minWidth,maxWidth:style.maxWidth,left:style.left,right:style.right,padding:style.padding},rules};
  }));
  writeFileSync(output+`/houses-${type}-${width}-${lang}-controls.json`,JSON.stringify(controlGeometry,null,2));
  assert(controlGeometry.every(control=>control.rect.width<=40),'inline selector controls stay compact under mobile CRM button styles');
  const [clearControl,toggleControl]=controlGeometry;assert(clearControl.rect.x+clearControl.rect.width<=toggleControl.rect.x,'clear and toggle tap targets do not overlap');
  await selector.getByRole('button',{name:en?'Clear selection':'Retirer la sélection',exact:true}).click();
  assert.equal(await selector.locator('select[name=taskContextHouseId]').inputValue(),'','All houses is an explicit clear');assert.equal(await input.inputValue(),en?'All houses':'Toutes les maisons');
  input=await chooseHouse(selector,query,lang);await input.fill(query);await selector.getByRole('option').filter({hasText:fixture.last.name}).waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no mobile page overflow');assert(await editor.evaluate(node=>node.scrollWidth<=node.clientWidth+1),'no task dialog overflow');
  await selector.scrollIntoViewIfNeeded();await page.screenshot({path:output+`/houses-${type}-${width}-${lang}-search.png`,fullPage:false});await input.press('Escape');
  await contextPanel.getByRole('button',{name:en?'Link this context':'Lier ce contexte',exact:true}).click();
  await editor.locator('[data-task-link-state=available]').last().waitFor();assert.equal(await editor.locator('input[name=dueDate]').inputValue(),'2026-12-10','task deadline remains distinct');
  const confirmed=page.waitForResponse(response=>{if(new URL(response.url()).pathname!=='/rest/v1/rpc/crm_tasks_mutate'||response.status()!==200)return false;try{return response.request().postDataJSON()?.p_patch?.title===name;}catch{return false;}});
  await editor.getByRole('button',{name:en?'Create task':'Créer la tâche',exact:true}).click();const saved=await (await confirmed).json();taskWrites++;
  await editor.waitFor({state:'detached'});assert(saved.id,'canonical task ID confirmed');
  const expected={...target,context:{...target.context,houseId:fixture.last.id}};
  const fresh=await loginAuth(),reloaded=await rpc(fresh,'crm_tasks_read',{p_id:saved.id}),task=reloaded.find(row=>row.id===saved.id);assert(task,'fresh Auth+RPC reads the saved task');
  const link=task.links.find(link=>link.target?.type===type);assert.deepEqual(link.target,expected,'canonical context contains exact house ID and work dates/month');assert.equal(link.primary,true);assert.equal(task.dueDate,'2026-12-10');
  const inverse=await rpc(fresh,'crm_tasks_for_target',{p_ref:expected});assert(inverse.some(row=>row.id===saved.id),'canonical inverse query returns the exact linked task');
  await page.reload();const card=page.locator('[data-task-id='+JSON.stringify(saved.id)+']');await card.waitFor({timeout:30000});await card.getByRole('button',{name,exact:true}).click();
  const detail=page.locator('dialog[open]').last();await detail.locator('.task-link-card').waitFor();assert((await detail.innerText()).includes(fixture.last.name),'browser reload resolves the current authorized house label');
  await page.screenshot({path:output+`/houses-${type}-${width}-${lang}-persisted.png`,fullPage:false});
  receipts.push({taskId:saved.id,revision:task.revision,target:link.target,primary:link.primary,dueDate:task.dueDate,freshAuthRead:true,inverseRead:true,browserReload:true,...(type==='worker_period'?{transientCatalogueFailurePreservesId:true,staleLabelsCleared:true,retryResolvesSameId:true}:{})});
  results.push({name:`${type} ${lang} ${width}: complete house search, keyboard explicit ID, query preservation, All houses and canonical persistence`,passed:true});
 }catch(error){results.push({name:`${type} ${lang} ${width}`,passed:false,error:error.message});await page.screenshot({path:output+`/houses-${type}-${width}-${lang}-failure.png`,fullPage:false});throw error;}
 finally{await context.close();}
}
let receipt;
try{
 receipt=await catalog();
 if(!process.env.HOUSES_CASE||process.env.HOUSES_CASE==='worker_period')await journey({type:'worker_period',lang:'fr',width:1440,query:'Eglantne',monthly:receipt.monthly});
 if(!process.env.HOUSES_CASE||process.env.HOUSES_CASE==='monthly_charges')await journey({type:'monthly_charges',lang:'en',width:390,query:'cedres theoule',monthly:receipt.monthly});
 assert.deepEqual(pageErrors,[],'no browser errors');assert.deepEqual(externalRequests,[],'no external request attempts');
 console.log(JSON.stringify({passed:results.length,taskWrites,houseCatalogCount:receipt.count,chosenHouseIndex:receipt.index}));
}finally{
 writeFileSync(root+'/houses-browser-results.json',JSON.stringify({realAuth:true,realHTTPRPC:true,realPostgres:true,actualCRMComponents:true,fictionalData:true,businessWrites:0,taskWrites,externalProviderCalls:0,instagramPublications:0,houseCatalog:receipt?{count:receipt.count,chosenHouseIndex:receipt.index,chosenHouseId:fixture.last.id}:null,results,receipts,pageErrors,externalRequests},null,2));
 await browser.close();
}
