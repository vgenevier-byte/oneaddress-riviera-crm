/** Real component fixture; local fictional persistence only, no Auth/RPC/database. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH=process.env.PLAYWRIGHT_BROWSERS_PATH||'/private/tmp/oar-search-playwright';
const require=createRequire(import.meta.url),{chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=resolve(process.cwd()),output=join(root,'docs/search'),manifest=JSON.parse(readFileSync(join(output,'fixture-manifest.json'),'utf8'));
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
for(const row of manifest.files){assert.equal(hash(join(root,row.path)),row.sha256,row.path+' source');assert.equal(hash(join(manifest.directory,row.path)),row.sha256,row.path+' fixture');}
for(const row of manifest.fixtureOnlyFiles||[])assert.equal(hash(join(manifest.directory,row.path)),row.sha256,row.path+' fixture harness');
mkdirSync(join(output,'screenshots'),{recursive:true});
const results=[],sessions=[];let failures=0;
const save=()=>writeFileSync(join(output,'browser-results.json'),JSON.stringify({fictionalData:true,actualAuth:false,actualRPC:false,actualDatabase:false,persistence:'Browser-localStorage simulation across reload',physicalDevice:false,fixtureLayout:true,sourceManifest:'fixture-manifest.json',results,sessions},null,2)+'\n');
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
 for(const mobile of [false,true]){
  const width=mobile?390:1360,context=await browser.newContext({viewport:{width,height:mobile?844:1100},isMobile:mobile,hasTouch:mobile});
  const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[],external=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(url.hostname))return route.continue();external.push(url.origin);return route.abort();});
  const label=`${engine}-${mobile?'mobile':'desktop'}`;
  async function check(name,fn){try{await fn();results.push({session:label,name,passed:true});console.log('PASS',label,name);}catch(error){failures++;results.push({session:label,name,passed:false,error:String(error)});console.log('FAIL',label,name,String(error));}save();}
  await page.goto(manifest.url);await page.waitForSelector('[data-contact-company-picker]');
  const companyInput=()=>page.locator('#person-company input[role="combobox"]');
  const companyValue=()=>page.locator('#person-company form').evaluate(form=>new FormData(form).get('companyId'));
  await check('company-multifield-fuzzy-explicit-selection-and-reload',async()=>{
   await companyInput().fill('riviera cannse');await page.locator('#person-company [role="option"]', {hasText:'Agence Riviera'}).waitFor();
   assert.equal(await companyValue(),'');assert.ok((await page.locator('#person-company').innerText()).includes('Correspondance approchée'));
   await companyInput().press('Enter');assert.equal(await companyValue(),'');
   await companyInput().press('ArrowDown');await companyInput().press('Enter');assert.equal(await companyValue(),'company-riviera');
   await companyInput().fill('introuvablezz');assert.equal(await companyValue(),'company-riviera');await companyInput().press('Escape');assert.equal(await companyInput().inputValue(),'Agence Riviera');
   await page.getByRole('button',{name:'Enregistrer le rattachement fictif'}).click();await page.reload();await page.waitForSelector('[data-contact-company-picker]');assert.equal(await companyValue(),'company-riviera');assert.equal(await companyInput().inputValue(),'Agence Riviera');
  });
  await check('bounded-options-show-more-and-last-record-on-full-catalogue',async()=>{
   await companyInput().focus();assert.equal(await page.locator('#person-company [role="option"]').count(),12);await page.locator('#person-company').getByRole('button',{name:/Afficher plus/}).click();assert.equal(await page.locator('#person-company [role="option"]').count(),36);
   await companyInput().fill('démonstration 1399');await page.locator('#person-company [role="option"]',{hasText:'Société de démonstration 1399'}).click();assert.equal(await companyValue(),'company-1399');
   await companyInput().fill('riviera');await page.locator('#person-company [role="option"]',{hasText:'Agence Riviera'}).click();assert.equal(await companyValue(),'company-riviera');
   const associated=page.getByRole('combobox',{name:/Entreprise à laquelle rattacher|Entreprise de rattachement|Entreprise.*facultatif|Company affiliation/});assert.equal(await associated.count(),1);
  });
  await check('existing-person-single-input-reordered-words-and-screenshot',async()=>{
   const input=page.locator('#company-person input[role="combobox"]');await input.fill('martin clemnt');const option=page.locator('#company-person [role="option"]',{hasText:'Clément Martin'});await option.waitFor();assert.equal(await page.locator('#company-person form').evaluate(form=>new FormData(form).get('companyExistingPersonId')),'');
   await page.locator('#company-person').screenshot({path:join(output,'screenshots',`contact-person-${label}.png`)});
   if(mobile)await option.tap();else await option.click();assert.equal(await page.locator('#company-person form').evaluate(form=>new FormData(form).get('companyExistingPersonId')),'person-clement');
  });
  await check('clear-no-result-and-unavailable-retains-form-value',async()=>{
   await companyInput().fill('aucunresultatzz');assert.equal(await page.locator('#person-company [role="option"]').count(),0);assert.ok((await page.locator('#person-company').innerText()).includes('Aucun résultat'));await companyInput().press('Escape');
   await page.getByRole('button',{name:'Basculer les fiches autorisées'}).click();assert.equal(await companyValue(),'company-riviera');await companyInput().fill('riviera');assert.equal(await page.locator('#person-company [role="option"]',{hasText:'Agence Riviera'}).count(),0);await companyInput().press('Escape');
   await page.getByRole('button',{name:'Basculer les fiches autorisées'}).click();await page.locator('#person-company').getByRole('button',{name:'Retirer la sélection'}).click();assert.equal(await companyValue(),'');
  });
  await check('required-native-validation-and-reset',async()=>{
   const form=page.locator('[data-required-form]');assert.equal(await form.evaluate(element=>element.checkValidity()),false);await form.getByRole('button',{name:'Valider',exact:true}).click();assert.equal(await form.locator('input').getAttribute('aria-invalid'),'true');
   await form.locator('input').fill('stable');await form.getByRole('option',{name:'Fiche stable'}).click();assert.equal(await form.evaluate(element=>element.checkValidity()),true);assert.equal(await form.evaluate(element=>new FormData(element).get('requiredRecord')),'stable');await form.getByRole('button',{name:'Réinitialiser'}).click();assert.equal(await form.evaluate(element=>new FormData(element).get('requiredRecord')),'');
  });
  await check('empty-loading-error-disabled-and-stale-keyboard-choice',async()=>{
   const form=page.locator('[data-state-form]'),input=form.locator('input[role="combobox"]'),value=()=>form.evaluate(element=>new FormData(element).get('stateRecord'));
   for(const state of ['loading','error']){await form.getByRole('button',{name:'État '+state,exact:true}).click();await input.fill('Autre');await input.press('ArrowDown');await input.press('Enter');assert.equal(await value(),'stable');assert.equal(await form.locator('[role="option"]').count(),0);await input.press('Escape');}
   await form.getByRole('button',{name:'État empty',exact:true}).click();await input.fill('Autre');assert.equal(await form.locator('[role="option"]').count(),0);assert.ok((await form.innerText()).includes('Aucun résultat'));assert.equal(await value(),'stable');await input.press('Escape');
   await form.getByRole('button',{name:'État disabled',exact:true}).click();assert.equal(await input.isDisabled(),true);await form.getByRole('button',{name:'État ready',exact:true}).click();await input.fill('interdite');assert.equal(await form.locator('[role="option"]').count(),0);await input.press('Escape');
  });
  await check('free-text-and-native-setter-events',async()=>{
   await page.getByRole('button',{name:'Affecter les saisies natives'}).click();assert.equal(await page.locator('[data-controlled-free]').innerText(),'Correction contrôlée');const form=page.locator('[data-free-form]');assert.equal(await form.evaluate(element=>new FormData(element).get('nativeFree')),'Correction native');
   await form.locator('input[name="controlledFree"]').fill('Ville personnelle hors catalogue');await form.locator('input[name="controlledFree"]').press('Tab');assert.equal(await form.evaluate(element=>new FormData(element).get('controlledFree')),'Ville personnelle hors catalogue');
  });
  await check('tasks-search-authorized-company-and-city-join',async()=>{
   const search=page.locator('#tasks input[type="search"]').first();await search.fill('riviera cannse');await page.locator('[data-task-id="task-riviera"]').waitFor();assert.ok((await page.locator('#tasks').innerText()).includes('Correspondance approchée'));await search.fill('zzzzabsent');assert.equal(await page.locator('[data-task-id="task-riviera"]').count(),0);await search.fill('');
  });
  await check('tasks-assignee-homonym-keyboard-escape-dialog-and-screenshot',async()=>{
   await page.locator('#tasks').getByRole('button',{name:/Ajouter une tâche|Add a task/}).click();const dialog=page.locator('dialog[open]');await dialog.waitFor();
   const assignee=dialog.locator('input[role="combobox"]').filter({visible:true}).first();await assignee.fill('clement');assert.equal(await dialog.locator('[role="option"]',{hasText:'Clément Martin'}).count(),2);
   await assignee.fill('riviera cannse');await dialog.locator('[role="option"]',{hasText:'Clément Martin'}).waitFor();await assignee.evaluate(element=>element.scrollIntoView({block:"center"}));await dialog.screenshot({path:join(output,'screenshots',`task-assignee-${label}.png`)});
   await assignee.press('Escape');assert.equal(await dialog.count(),1);assert.equal(await dialog.locator('[role="listbox"]').count(),0);
   await assignee.fill('riviera cannse');await assignee.press('ArrowDown');await assignee.press('Enter');assert.equal(await dialog.locator('[data-task-recipient-id="fixture-clement"]').count(),1);await dialog.getByRole('button',{name:/Annuler|Cancel/,exact:true}).click();
  });
  await check('overflow-hidden-card-keeps-suggestions-visible-and-clickable',async()=>{
   const card=page.locator('#overflow-test');await card.locator('input').fill('visible');const option=card.getByRole('option',{name:'Choix visible dans la fiche'});await option.waitFor();await option.scrollIntoViewIfNeeded();const boxes=await Promise.all([card.boundingBox(),option.boundingBox()]);assert.ok(boxes[1].y+boxes[1].height<=boxes[0].y+boxes[0].height);assert.equal(await option.evaluate(element=>{const rect=element.getBoundingClientRect();return element.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));}),true);await option.click();
  });
  await check('business-picker-retains-new-choice-when-original-default-disappears',async()=>{
   const form=page.locator('#business-retention form'),value=()=>form.evaluate(element=>new FormData(element).get('businessContactId'));assert.equal(await value(),'person-clement');await form.getByRole('button',{name:'Changer le prestataire',exact:true}).click();await form.locator('input[role="combobox"]').fill('Nora');await form.getByRole('option',{name:/Nora Indépendante/}).click();assert.equal(await value(),'person-independent');await form.getByRole('button',{name:'Retirer uniquement le contact initial A'}).click();assert.equal(await value(),'person-independent');await form.getByRole('button',{name:'Changer le prestataire',exact:true}).click();await form.locator('input[role="combobox"]').fill('Claire');assert.equal(await value(),'person-independent');await form.locator('input[role="combobox"]').press('Escape');
  });
  await check('fr-en-search-component-labels-and-layout',async()=>{
   await page.getByRole('button',{name:'FR / EN'}).click();assert.equal(await page.locator('html').getAttribute('lang'),'en-GB');await companyInput().fill('riviera cannse');await page.locator('#person-company [role="option"]',{hasText:'Agence Riviera'}).waitFor();assert.ok((await page.locator('#person-company').innerText()).includes('Approximate match'));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false);await companyInput().press('Escape');
  });
  sessions.push({session:label,width,mobileEmulation:mobile,engine,consoleErrors:errors,externalRequests:external});assert.deepEqual(external,[]);if(errors.length)failures++;save();await context.close();
 }
 await browser.close();
}
console.log(JSON.stringify({passed:results.filter(row=>row.passed).length,failed:failures}));process.exitCode=failures?1:0;
