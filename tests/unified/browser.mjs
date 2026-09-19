import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {chromium}=require('/tmp/izord-playwright-runtime-20260917/node_modules/playwright');
const dir='/tmp/crm-unified-review',users=JSON.parse(readFileSync(dir+'/users.private.json','utf8'));
const browser=await chromium.launch({headless:true,channel:'chrome'});
const results=[];
try{
 for(const name of (process.argv.includes('--capture')?['admin','izord','house','invoices']:['admin','izord','house','invoices','tasks','none','izord-admin'])){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('**/*',route=>{const u=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(u.hostname)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort();});
  const page=await context.newPage(),requests=[],errors=[];
  page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/rest/v1'))requests.push(u.pathname);});page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3160');
  await page.getByLabel('Email',{exact:true}).fill(users[name].email);await page.getByLabel('Mot de passe',{exact:true}).fill(users[name].password);await page.getByRole('button',{name:'Se connecter',exact:true}).click();
  await page.locator('.crm-shell').waitFor({timeout:20000});
  await page.waitForTimeout(1300);
  const nav=await page.getByRole('navigation',{name:'Navigation principale',exact:true}).innerText();
  assert.deepEqual(errors,[],name);
  if(name==='admin'){assert.match(nav,/Dashboard/i);assert.match(nav,/IZORD Invest/i);assert.match(nav,/Administration/i);await page.screenshot({path:dir+'/menu-complet.png'});await page.getByRole('navigation',{name:'Navigation principale',exact:true}).getByRole('button',{name:'Administration'}).click();await page.getByRole('heading',{name:'Utilisateurs et accès'}).waitFor();await page.getByRole('button',{name:/unified-tasks@example.invalid/}).click();await page.getByLabel('Droit Tâches',{exact:true}).waitFor();await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('.content-panel')?.scrollTo(0,0);});await page.screenshot({path:dir+'/matrice.png'});}
  if(name==='izord'||name==='izord-admin'){assert.ok(!/Contacts/i.test(nav));assert.ok(!requests.some(p=>p.includes('crm_workspace_state')||p.includes('crm_read_module')));await page.getByRole('heading',{name:'IZORD Invest',exact:true}).waitFor();if(name==='izord')await page.screenshot({path:dir+'/izord-integre.png'});}
  if(name==='invoices'){assert.ok(!requests.some(p=>p.includes('crm_workspace_state')));assert.ok(!(await page.locator('body').innerText()).includes('FICTIONAL-NOT'));await page.screenshot({path:dir+'/menu-restreint.png'});}
  if(name==='none')await page.getByRole('heading',{name:'Aucun accès autorisé'}).waitFor();
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);assert.ok(await page.getByRole('navigation',{name:'Navigation mobile principale',exact:true}).isVisible());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'horizontal overflow '+name);
  if(name==='house')await page.screenshot({path:dir+'/mobile-restreint.png'});
  results.push({name,status:'passed',requests:[...new Set(requests)],consoleErrors:errors});writeFileSync(dir+(process.argv.includes('--capture')?'/captures.json':'/browser.json'),JSON.stringify(results,null,2));console.log('PASS browser '+name);await context.close();
 }
} catch(e){console.error(e);throw e;} finally{await browser.close();}
