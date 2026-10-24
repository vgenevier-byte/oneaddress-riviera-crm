/** Focused touch smoke on the final local production build. No save occurs. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {chromium} from '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const root='/private/tmp/oar-task-link-corrections',fixture=JSON.parse(readFileSync(root+'/houses.fixture.private.json','utf8')),out=root+'/evidence';mkdirSync(out,{recursive:true});
assert.equal(fixture.api,'http://127.0.0.1:55931');
const browser=await chromium.launch({headless:true,channel:'chrome'}),errors=[],external=[],mutations=[];
const context=await browser.newContext({viewport:{width:1440,height:1000},isMobile:true,hasTouch:true,locale:'en-GB',timezoneId:'Europe/Paris',serviceWorkers:'block'});
const page=await context.newPage();
await page.route('**/*',route=>{const url=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(url.hostname))return route.continue();external.push(url.origin+url.pathname);return route.abort();});
page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).pathname==='/rest/v1/rpc/crm_tasks_mutate')mutations.push(request.url());});
const receipt={actualCRMComponents:true,actualLocalAuth:true,physicalDevice:false,emulatedTouch:true,isMobile:true,hasTouch:true,viewport:{width:390,height:844},taskWrites:0,businessWrites:0,results:[]};
try{
 await page.goto('http://127.0.0.1:3198/?module=tasks');await page.locator('input[type=email]').fill(fixture.users.full.email);await page.locator('input[type=password]').fill(fixture.password);await page.locator('input[type=password]').press('Enter');await page.locator('.taskws').waitFor({timeout:60000});
 await page.getByRole('button',{name:'English — EN',exact:true}).first().tap();await page.getByRole('button',{name:'Add a task',exact:true}).waitFor();await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>navigator.maxTouchPoints>0&&matchMedia('(pointer:coarse)').matches),'touch input emulation enabled');
 await page.getByRole('button',{name:'Add a task',exact:true}).tap();const editor=page.locator('dialog[open]').last();await editor.locator('input[name=title]').fill('Fictional touch draft cancelled');await editor.getByRole('button',{name:'Link a CRM item',exact:true}).tap();
 await editor.locator('.task-link-search > label > select').selectOption('worker_period');await editor.getByLabel('Search CRM items',{exact:true}).fill(fixture.worker.contactName);
 let exact=-1;for(let attempt=0;attempt<100;attempt++){exact=await editor.locator('.task-link-result').evaluateAll((nodes,id)=>nodes.findIndex(node=>{const value=JSON.parse(node.getAttribute('data-task-target-key'));return value[0]==='worker_period'&&value[1]===id;}),fixture.worker.id);if(exact>=0)break;await page.waitForTimeout(100);}assert(exact>=0);
 await editor.locator('.task-link-result').nth(exact).getByRole('button',{name:'Link item',exact:true}).tap();const business=editor.locator('.task-link-context');await business.locator('[data-task-house-status=ready]').waitFor();const selector=business.locator('.task-house-selector'),input=selector.getByRole('combobox',{name:'House (optional)',exact:true});
 await input.fill('cedres theoule');const option=selector.getByRole('option').filter({hasText:fixture.last.name});await option.waitFor();await option.tap();assert.equal(await selector.locator('select[name=taskContextHouseId]').inputValue(),fixture.last.id,'touch selects exact house ID');
 await input.fill('Maison catalogue 000');assert.equal(await selector.locator('select[name=taskContextHouseId]').inputValue(),fixture.last.id,'typing preserves the touch-selected ID');await selector.scrollIntoViewIfNeeded();await page.screenshot({path:out+'/houses-touch-selected.png',fullPage:false});
 await selector.getByRole('button',{name:'Clear selection',exact:true}).tap();assert.equal(await selector.locator('select[name=taskContextHouseId]').inputValue(),'','touch clears only the explicit house selection');assert.equal(await input.inputValue(),'All houses');
 await selector.getByRole('button',{name:'Show suggestions',exact:true}).tap();await selector.getByRole('listbox').waitFor();await selector.getByRole('option',{name:/^All houses/}).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:out+'/houses-touch-all-houses.png',fullPage:false});
 await editor.getByRole('button',{name:'Cancel',exact:true}).tap();await editor.waitFor({state:'detached'});assert.deepEqual(mutations,[]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 receipt.results.push({name:'390 px coarse-pointer touch: option tap, typing preserves ID, clear tap, All houses, toggle tap, cancel without save',passed:true});console.log('PASS houses emulated touch smoke');
}catch(error){receipt.results.push({name:'houses emulated touch smoke',passed:false,error:error.message});await page.screenshot({path:out+'/houses-touch-failure.png',fullPage:false});throw error;}
finally{writeFileSync(root+'/houses-touch-results.json',JSON.stringify({...receipt,pageErrors:errors,externalRequests:external,taskMutations:mutations.length},null,2));await browser.close();}
