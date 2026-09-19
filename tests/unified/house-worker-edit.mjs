/** Fictitious local Auth/RPC/browser regression. No remote requests are allowed. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import {connect,sql,user,grant,rpc,dir,fullGrants} from './local.mjs';
const require=createRequire(import.meta.url),{chromium}=require('/tmp/izord-playwright-runtime-20260917/node_modules/playwright');
const deadline=p=>Promise.race([p,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Local confirmation deadline')),15000);t.unref();})]);
const base='http://127.0.0.1:3161',run=Date.now().toString(36),results=[];
const ok=r=>{assert.equal(r.status,200,r.data?.message);return r.data;};
const payload=async()=>(await sql.query("select payload from crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
const revision=async(u)=>ok(await rpc('crm_read_module',u.token,{p_module:'houseTracking'})).revision;
const globalRevision=async()=>(await sql.query("select updated_at::text revision from crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].revision;
async function fixture(key){
 const id='house-edit-'+run+'-'+key,house=id+'-house';
 const worker={id,contactId:id+'-contact',contactName:'Intervenant fictif '+key,role:'Entretien',hourlyRate:20,status:'Actif',createdAt:'2026-01-01T00:00:00Z',notes:'PRIVATE-NOTE',documentStoragePath:'fictional/document.pdf',documentFileName:'document-fictif.pdf',documentUploadedAt:'2026-01-01',extra:{keep:true}};
 const p=await payload();p.houseTrackingWorkers??=[];p.houseTrackingHouses??=[];p.houseTimeEntries??=[];p.housePayments??=[];
 p.houseTrackingWorkers.push(worker,{...worker,id:id+'-zero',contactName:'Zéro fictif '+key,hourlyRate:0},{...worker,id:id+'-blank',contactName:'Sans tarif fictif '+key,hourlyRate:undefined});
 p.houseTrackingHouses.push({id:house,name:'Maison fictive '+key,address:'',createdAt:worker.createdAt});
 p.houseTimeEntries.push({id:id+'-history',houseId:house,houseName:'Maison fictive',workerId:id,workerName:worker.contactName,date:'2026-09-01',startTime:'08:07',endTime:'12:42',breakMinutes:0,hourlyRate:20,createdAt:worker.createdAt});
 p.housePayments.push({id:id+'-payment',houseId:house,houseName:'Maison fictive',workerId:id,workerName:worker.contactName,date:'2026-09-01',amount:30,method:'Virement',createdAt:worker.createdAt});
 await sql.query("update crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[p]);return {id,house,worker};
}
function preserved(before,after,id,fields=['hourlyRate']){
 for(const key of Object.keys(before))if(key!=='houseTrackingWorkers')assert.deepEqual(after[key],before[key],key+' changed');
 assert.equal(after.houseTrackingWorkers.length,before.houseTrackingWorkers.length);
 assert.deepEqual(after.houseTrackingWorkers.filter(w=>w.id!==id),before.houseTrackingWorkers.filter(w=>w.id!==id));
 const old=before.houseTrackingWorkers.find(w=>w.id===id),saved=after.houseTrackingWorkers.find(w=>w.id===id);
 for(const key of Object.keys(old))if(![...fields,'updatedAt','updatedBy'].includes(key))assert.deepEqual(saved[key],old[key],key+' changed');
}
async function test(name,fn){if(process.env.HOUSE_TEST_FILTER&&!name.includes(process.env.HOUSE_TEST_FILTER))return;try{await fn();results.push({name,passed:true});console.log('PASS '+name);}catch(e){results.push({name,passed:false,error:e.message});console.error('FAIL '+name+': '+e.stack);}writeFileSync(dir+'/house-worker-edit-results.json',JSON.stringify(results,null,2));}
await connect();const browser=await chromium.launch({channel:'chrome',headless:true});
async function actor(key,mode){const u=await user('house-edit-'+run+'-'+key);await grant(u,mode==='owner'?fullGrants:{houseTracking:{level:mode==='read'?'read':'contribute'}},mode==='owner');return u;}
async function start(key,mode='contribute',width=1440){
 const u=await actor(key,mode),f=await fixture(key),c=await browser.newContext({viewport:{width,height:1000}});
 await c.route('**/*',r=>{const url=new URL(r.request().url());return (url.protocol==='http:'&&url.hostname==='127.0.0.1'&&['3161','55431'].includes(url.port))||['data:','blob:'].includes(url.protocol)?r.continue():r.abort();});
 const p=await c.newPage(),requests=[],errors=[];p.setDefaultTimeout(12000);p.on('dialog',d=>d.accept());p.on('pageerror',e=>errors.push(e.message));
 p.on('request',r=>{if(r.url().includes('/rest/v1/'))requests.push({url:r.url(),body:r.postData()});});
 await p.goto(base);await p.getByLabel('Email',{exact:true}).fill(u.email);await p.getByLabel('Mot de passe',{exact:true}).fill(u.password);await p.getByRole('button',{name:'Se connecter',exact:true}).click();
 await p.getByRole('navigation',{name:width<600?'Navigation mobile principale':'Navigation principale',exact:true}).getByRole('button',{name:'Suivi maison',exact:true}).click();
 await p.locator('.house-tab').filter({hasText:'Réglages'}).click();
 const row=p.locator(`[data-notification-target="house-worker-${f.id}"]`);await row.waitFor();
 return {u,f,c,p,row,requests,errors,mode};
}
async function edit(s){await s.row.getByRole('button',{name:'Modifier',exact:true}).click();return s.p.getByRole('region',{name:'Modifier '+s.f.worker.contactName,exact:true});}
function noGlobal(s){if(s.mode!=='owner'){assert.ok(!s.requests.some(r=>r.url.includes('crm_workspace_state')));assert.ok(!s.requests.some(r=>(r.body??'').includes('PRIVATE-NOTE')));}}
async function switchAccount(p,u){await p.evaluate(async(credentials)=>{let client;window.webpackChunk_N_E.push([[Math.random()],{},require=>{const modules=require.c?Object.values(require.c):Object.entries(require.m).filter(([,f])=>String(f).includes('http://127.0.0.1:55431')).map(([id])=>({exports:require(id)}));for(const e of modules){for(const v of Object.values(e.exports||{})){if(v&&typeof v==='object'&&v.auth&&typeof v.auth.refreshSession==='function'&&typeof v.from==='function'){client=v;break;}}if(client)break;}}]);if(!client)throw Error('Local SDK missing');const r=await client.auth.signInWithPassword(credentials);if(r.error)throw Error('Local Auth switch failed');},{email:u.email,password:u.password});}
try{
 await test('server authorization, revisions, projection and preservation',async()=>{
  const u=await actor('api','contribute'),reader=await actor('api-read','read'),owner=await actor('api-owner','owner'),f=await fixture('api');
  const before=await payload(),rev=await revision(u);
  const denied=await rpc('crm_update_house_worker',reader.token,{p_id:f.id,p_patch:{hourlyRate:30},p_revision:rev});assert.equal(denied.status,403);
  for(const patch of [{hourlyRate:30,notes:'forbidden'},{hourlyRate:''},{hourlyRate:null},{hourlyRate:-1},{hourlyRate:12.345},{hourlyRate:30,contactId:'changed'},{hourlyRate:30,status:'Inactif'}])assert.notEqual((await rpc('crm_update_house_worker',u.token,{p_id:f.id,p_patch:patch,p_revision:rev})).status,200);
  assert.deepEqual(await payload(),before);
  const saved=ok(await rpc('crm_update_house_worker',u.token,{p_id:f.id,p_patch:{hourlyRate:22.75},p_revision:rev}));
  assert.ok(saved.collections);assert.equal(saved.worker,undefined);assert.ok(!JSON.stringify(saved).includes('PRIVATE-NOTE'));assert.ok(!('notes' in saved.collections.houseTrackingWorkers.find(w=>w.id===f.id)));
  preserved(before,await payload(),f.id);
  assert.notEqual((await rpc('crm_update_house_worker',u.token,{p_id:f.id,p_patch:{hourlyRate:0},p_revision:rev})).status,200);
  assert.notEqual((await rpc('crm_update_house_worker',u.token,{p_id:'nonexistent',p_patch:{hourlyRate:0},p_revision:await revision(u)})).status,200);
  const ownerBefore=await payload();const result=ok(await rpc('crm_update_house_worker',owner.token,{p_id:f.id,p_patch:{hourlyRate:0,notes:'Nouvelle note fictive'},p_revision:await globalRevision()}));
  assert.equal(result.worker.id,f.id);assert.equal(result.worker.hourlyRate,0);assert.equal(result.worker.notes,'Nouvelle note fictive');assert.ok(result.workspaceRevision);assert.equal(result.payload,undefined);
  preserved(ownerBefore,await payload(),f.id,['hourlyRate','notes']);
 });
 for(const mode of ['contribute','owner'])await test(mode+' delayed confirmation, reload, history and new hours',async()=>{
  const s=await start(mode,mode);let release;try{
   const form=await edit(s);assert.equal(await form.getByLabel('Taux horaire par défaut').inputValue(),'20');assert.equal(await form.getByLabel(/^Notes/).count(),mode==='owner'?1:0);
   await form.getByLabel('Taux horaire par défaut').fill('24,75');if(mode==='owner')await form.getByLabel(/^Notes/).fill('Note propriétaire fictive');
   const before=await payload();let calls=0,arrive;const gate=new Promise(r=>release=r),reached=new Promise(r=>arrive=r);
   await s.p.route('**/rest/v1/rpc/crm_update_house_worker',async route=>{calls++;const response=await route.fetch();assert.equal(response.status(),200);arrive();await gate;await route.fulfill({response});});
   await form.getByRole('button',{name:'Enregistrer',exact:true}).click();await deadline(reached);
   assert.equal(await form.count(),1);assert.equal(await form.getByRole('button',{name:'Annuler'}).isDisabled(),true);
   await form.locator('form').evaluate(f=>{f.requestSubmit();f.requestSubmit();});assert.equal(calls,1);release();await form.waitFor({state:'hidden'});
   const after=await payload();preserved(before,after,s.f.id,mode==='owner'?['hourlyRate','notes']:['hourlyRate']);assert.equal(after.houseTrackingWorkers.find(w=>w.id===s.f.id).hourlyRate,24.75);
   await s.p.reload();if(mode==='owner')await s.p.getByRole('navigation',{name:'Navigation principale',exact:true}).getByRole('button',{name:'Suivi maison',exact:true}).click();await s.p.locator('.house-tab').filter({hasText:'Réglages'}).click();const again=await edit(s);assert.equal(await again.getByLabel('Taux horaire par défaut').inputValue(),'24.75');await again.getByRole('button',{name:'Annuler'}).click();
   await s.p.locator('.house-tab').filter({hasText:'Heures'}).click();const hours=s.p.locator('form').filter({has:s.p.getByRole('button',{name:'Ajouter les heures',exact:true})});
   await hours.getByLabel(/^Intervenant/).selectOption(s.f.id);assert.equal(await hours.getByLabel('Taux horaire',{exact:true}).inputValue(),'24.75');
   await hours.getByLabel(/^Intervenant/).selectOption(s.f.id+'-zero');assert.equal(await hours.getByLabel('Taux horaire',{exact:true}).inputValue(),'0');
   await hours.getByLabel(/^Intervenant/).selectOption(s.f.id+'-blank');assert.equal(await hours.getByLabel('Taux horaire',{exact:true}).inputValue(),'');
   await hours.getByLabel(/^Intervenant/).selectOption('');assert.equal(await hours.getByLabel('Taux horaire',{exact:true}).inputValue(),'');
   await hours.getByLabel(/^Intervenant/).selectOption(s.f.id);await hours.getByLabel(/^Maison/).selectOption(s.f.house);
   assert.equal(await hours.getByLabel(/^Début/).locator('option').count(),96);assert.equal(await hours.getByLabel(/^Fin/).locator('option').count(),96);
   await hours.getByLabel('Taux horaire',{exact:true}).fill('');await hours.getByRole('button',{name:'Ajouter les heures',exact:true}).click();await hours.getByRole('alert').waitFor();assert.deepEqual((await payload()).houseTimeEntries,after.houseTimeEntries);
   await hours.getByLabel('Taux horaire',{exact:true}).fill('24,75');await hours.getByRole('button',{name:'Ajouter les heures',exact:true}).click();
   await s.p.waitForTimeout(1800);const final=await payload(),added=final.houseTimeEntries.filter(e=>!after.houseTimeEntries.some(old=>old.id===e.id));assert.equal(added.length,1);assert.equal(added[0].hourlyRate,24.75);assert.deepEqual(final.houseTimeEntries.filter(e=>e.id!==added[0].id),after.houseTimeEntries);assert.deepEqual(final.housePayments,after.housePayments);noGlobal(s);assert.deepEqual(s.errors,[]);
  }finally{release?.();await s.c.close();}
 });
 for(const kind of ['conflict','refusal','network'])await test('form retains draft after '+kind,async()=>{
  const s=await start(kind);try{const form=await edit(s);await form.getByLabel('Taux horaire par défaut').fill('19,35');const before=await payload();
   if(kind==='conflict')await rpc('crm_update_house_worker',s.u.token,{p_id:s.f.id+'-zero',p_patch:{hourlyRate:1},p_revision:await revision(s.u)});
   else await s.p.route('**/rest/v1/rpc/crm_update_house_worker',r=>kind==='network'?r.abort('failed'):r.fulfill({status:403,contentType:'application/json',body:JSON.stringify({message:'module_forbidden'})}));
   await form.getByRole('button',{name:'Enregistrer',exact:true}).click();await form.getByRole('alert').waitFor();assert.equal(await form.getByLabel('Taux horaire par défaut').inputValue(),'19,35');assert.equal((await payload()).houseTrackingWorkers.find(w=>w.id===s.f.id).hourlyRate,20);if(kind!=='conflict')assert.deepEqual(await payload(),before);noGlobal(s);
  }finally{await s.c.close();}
 });
 for(const mode of ['contribute','owner'])await test(mode+' empty, invalid and explicit zero',async()=>{
  const s=await start('zero-'+mode,mode);try{
   await s.p.locator('.house-tab').filter({hasText:'Heures'}).click();
   await s.p.locator('form').filter({has:s.p.getByRole('button',{name:'Ajouter les heures',exact:true})}).getByLabel(/^Intervenant/).selectOption(s.f.id);
   await s.p.locator('.house-tab').filter({hasText:'Réglages'}).click();const form=await edit(s),before=await payload();
   for(const value of ['', 'invalide', '12,345']){
    await form.getByLabel('Taux horaire par défaut').fill(value);await form.getByRole('button',{name:'Enregistrer',exact:true}).click();await form.getByRole('alert').waitFor();
    assert.equal(await form.getByLabel('Taux horaire par défaut').inputValue(),value);assert.deepEqual(await payload(),before);
   }
   assert.ok(!s.requests.some(r=>r.url.includes('crm_update_house_worker')));
   await form.getByLabel('Taux horaire par défaut').fill('0');await form.getByRole('button',{name:'Enregistrer',exact:true}).click();await form.waitFor({state:'hidden'});
   const after=await payload();assert.equal(after.houseTrackingWorkers.find(w=>w.id===s.f.id).hourlyRate,0);preserved(before,after,s.f.id);
   await s.p.locator('.house-tab').filter({hasText:'Heures'}).click();const hours=s.p.locator('form').filter({has:s.p.getByRole('button',{name:'Ajouter les heures',exact:true})});
   assert.equal(await hours.getByLabel(/^Intervenant/).inputValue(),s.f.id);assert.equal(await hours.getByLabel('Taux horaire',{exact:true}).inputValue(),'0');noGlobal(s);
  }finally{await s.c.close();}
 });
 await test('read-only UI',async()=>{const s=await start('reader','read');try{assert.equal(await s.row.getByRole('button',{name:'Modifier',exact:true}).isDisabled(),true);noGlobal(s);}finally{await s.c.close();}});
 for(const width of [1440,390])await test('usable editor '+width,async()=>{const s=await start('viewport-'+width,'contribute',width);try{const form=await edit(s);await form.scrollIntoViewIfNeeded();assert.equal(await form.getByText('Ce changement ne modifie pas les heures déjà enregistrées.',{exact:true}).count(),1);for(const element of [form.getByLabel('Taux horaire par défaut'),form.getByRole('button',{name:'Enregistrer',exact:true}),form.getByRole('button',{name:'Annuler'})]){const b=await element.boundingBox();assert.ok(b&&b.x>=0&&b.x+b.width<=width+1);}await form.screenshot({path:dir+'/house-worker-'+width+'.png'});assert.deepEqual(s.errors,[]);}finally{await s.c.close();}});
 for(const mode of ['contribute','owner'])await test(mode+' late response after account switch',async()=>{const s=await start('switch-'+mode,mode);let release;try{const next=await actor('next-'+mode,'read');await grant(next,{});const form=await edit(s);await form.getByLabel('Taux horaire par défaut').fill('37,25');let arrive;const gate=new Promise(r=>release=r),reached=new Promise(r=>arrive=r);await s.p.route('**/rest/v1/rpc/crm_update_house_worker',async r=>{const response=await r.fetch();assert.equal(response.status(),200);arrive();await gate;try{await r.fulfill({response});}catch{}});await form.getByRole('button',{name:'Enregistrer',exact:true}).click();await deadline(reached);await switchAccount(s.p,next);await s.p.getByRole('heading',{name:'Aucun accès autorisé'}).waitFor();release();await s.p.waitForTimeout(300);assert.equal(await s.p.getByRole('region',{name:'Modifier '+s.f.worker.contactName}).count(),0);assert.ok(!(await s.p.locator('body').innerText()).includes('37,25'));noGlobal(s);}finally{release?.();await s.c.close();}});
}finally{await browser.close();await sql.end();if(results.some(r=>!r.passed))process.exitCode=1;}
