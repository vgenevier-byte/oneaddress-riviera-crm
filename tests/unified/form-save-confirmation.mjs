/** Real reused Contacts/Quotes forms; local Auth/RPC only. No global browser payload. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {connect,sql,user,grant,rpc,dir} from './local.mjs';
const require=createRequire(import.meta.url),{chromium}=require('/tmp/izord-playwright-runtime-20260917/node_modules/playwright');
const observe=process.argv.includes('--observe'),runId=Date.now().toString(36),results=[];
const output=dir+(observe?'/form-save-before':'/form-save-confirmation')+(process.env.FORM_TEST_FILTER?'-'+process.env.FORM_TEST_FILTER.replace(/[^a-z0-9]+/gi,'-'):'')+'.json';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const payload=async()=>(await sql.query("select payload from crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
const ok=r=>{assert.equal(r.status,200,r.data?.message??'Local RPC refused');return r.data;};
const timeout=(p,ms=15000)=>Promise.race([p,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Local scenario deadline')),ms);timer.unref();})]);
await connect();const browser=await chromium.launch({channel:'chrome',headless:true});
const writer=await user('form-writer');await grant(writer,{contacts:{level:'contribute'},quotes:{level:'contribute'}});
async function fixture(mod,key){
 const id='save-'+key,canary=id+'-other';const name='Fictif '+key;
 const row=mod==='contacts'?{id,name,kind:'Client',city:'Nice',email:key+'@example.invalid',phone:'',postalAddress:'Adresse fictive\nSeconde ligne',notes:'PRIVATE-OMITTED',importantNotes:'PRIVATE-OMITTED-2',supplierBankAccounts:[{id:'fictional-bank-'+key,label:'Compte fictif',status:'À vérifier',iban:'FICTIONAL-NOT-IBAN'}]}:{id,title:name,clientName:'Client fictif',categories:['Villa'],items:[{id:'line-'+key,category:'Villa',description:'Prestation fictive',unitPrice:100,billingUnit:'day',deposit:0}],status:'Draft',unitPrice:100,startDate:'2026-10-01',endDate:'2026-10-03',notes:'PRIVATE-OMITTED',paymentNotes:'PRIVATE-PAYMENT',paymentTerms:'Conditions conservées',createdAt:'2026-09-19T00:00:00Z'};
 await sql.query("update crm_workspace_state set payload=jsonb_set(payload,array[$1],coalesce(payload->$1,'[]')||$2::jsonb) where workspace_id='oneaddress-riviera'",[mod,JSON.stringify([row,{...row,id:canary,...(mod==='contacts'?{name:'Canari '+key}:{title:'Canari '+key})}])]);return {id,canary,name,row};
}
async function start(mod,mode,key){
 const u=await user('form-'+key);await grant(u,{contacts:{level:'contribute'},quotes:{level:'contribute'}});
 const target=await fixture(mod,key);const c=await browser.newContext({viewport:{width:1440,height:1000}});
 await c.route('**/*',r=>{const url=new URL(r.request().url());return (url.protocol==='http:'&&url.hostname==='127.0.0.1'&&['3160','55431'].includes(url.port))||['data:','blob:'].includes(url.protocol)?r.continue():r.abort();});
 const p=await c.newPage();p.setDefaultTimeout(10000);p.on('dialog',d=>d.accept());
 const paths=[];p.on('request',r=>{if(r.url().includes('/rest/v1/'))paths.push(r.url());});
 await p.goto('http://127.0.0.1:3160');await p.getByLabel('Email',{exact:true}).fill(u.email);await p.getByLabel('Mot de passe',{exact:true}).fill(u.password);await p.getByRole('button',{name:'Se connecter',exact:true}).click();
 const nav=p.getByRole('navigation',{name:'Navigation principale',exact:true});await nav.getByRole('button',{name:mod==='contacts'?'Contacts':'Devis',exact:true}).click();
 await p.locator(mod==='contacts'?'form.contact-create-form':'form[data-quote-form]').waitFor();
 if(mode==='edit')await p.locator('article').filter({has:p.getByRole('heading',{name:target.name,exact:true})}).getByRole('button',{name:'Modifier',exact:true}).click();
 const form=p.locator(mod==='contacts'?(mode==='edit'?'#contact-edit-panel form':'form.contact-create-form'):'form[data-quote-form]');await form.waitFor();
 const field=mod==='contacts'?'name':'title',value='Saisie '+key;
 await form.locator('[name='+field+']').fill(value);
 if(mod==='quotes'&&mode==='create'){await form.locator('[name=clientName]').fill('Client fictif');await form.locator('[name=startDate]').fill('2026-10-01');await form.locator('[name=endDate]').fill('2026-10-03');await form.locator('[name=categories][value=Villa]').check();await form.locator('[name=priceVilla]').fill('120');await form.locator('[name=descriptionVilla]').fill('Prestation fictive');}
 return {c,p,u,target,form,field,value,paths,mod,mode};
}
async function draft(s){return await s.form.locator('[name='+s.field+']').count()?s.form.locator('[name='+s.field+']').inputValue():null;}
async function submit(s){await s.form.locator('button[type=submit]').click();}
async function failure(mod,mode,kind){
 const key=runId+'-'+mod+'-'+mode+'-'+kind,s=await start(mod,mode,key);let calls=0,status,code,reached;const done=new Promise(r=>reached=r);
 try{
  await s.p.route('**/rest/v1/rpc/crm_mutate_record',async route=>{
   calls++;
   if(kind==='network'){await route.abort('connectionfailed');reached();return;}
   if(calls===1&&kind==='conflict'){const v=ok(await rpc('crm_read_module',writer.token,{p_module:mod}));ok(await rpc('crm_mutate_record',writer.token,{p_module:mod,p_collection:mod,p_id:s.target.canary,p_patch:mod==='contacts'?{city:'Paris fictif'}:{title:'Modification du collaborateur fictif'},p_revision:v.revision}));}
   if(calls===1&&kind==='refusal')await sql.query("update crm_module_grants set level='read' where user_id=$1 and module=$2",[s.u.id,mod]);
   const response=await route.fetch();status=response.status();code=(await response.json()).code;await route.fulfill({response});reached();
  });
  await submit(s);await timeout(done);await s.p.waitForTimeout(450);
  const kept=(await draft(s))===s.value,success=await s.p.getByText('Enregistrement confirmé par le serveur.',{exact:true}).count();
  assert.ok(!s.paths.some(x=>x.includes('crm_workspace_state')),'Restricted browser requested global CRM payload');
  if(kind==='conflict'){assert.ok(status>=400);assert.equal(code,'40001');}
  if(kind==='refusal'){assert.equal(status,403);assert.equal(code,'42501');}
  if(observe)return {draftPreserved:kept,http:status??null,code:code??null,requests:calls,falseSuccess:success>0};
  assert.ok(kept,'Draft lost after '+kind);assert.equal(success,0,'False success');assert.equal(calls,1,'Automatic mutation retry');
  const text=await s.form.getByRole('alert').innerText();assert.match(text,/conflit|refus|autorisation|droits|connexion|réseau|enregistrement.*impossible|enregistrement.*échoué|non confirmé/i,'Understandable error missing');
  if(kind==='conflict'){await s.p.evaluate(()=>window.dispatchEvent(new Event('focus')));await s.p.waitForTimeout(250);await submit(s);await s.p.waitForTimeout(450);assert.equal(calls,2);assert.ok(status>=400,'Revision silently refreshed');assert.equal(code,'40001');assert.equal(await draft(s),s.value);}
  return {http:status??null,code:code??null,draftPreserved:true,automaticRetry:false};
 }finally{await s.c.close();}
}
async function successful(mod,mode,newer=false){
 const key=runId+'-'+mod+'-'+mode+'-'+(newer?'newer':'success'),s=await start(mod,mode,key);let calls=0,captured,reached,release;const reachedPromise=new Promise(r=>reached=r),gate=new Promise(r=>release=r);const before=await payload();
 try{
  await s.p.route('**/rest/v1/rpc/crm_mutate_record',async route=>{calls++;captured=route.request().postDataJSON();const response=await route.fetch();assert.equal(response.status(),200);reached();await gate;try{await route.fulfill({response});}catch{}});
  await submit(s);await timeout(reachedPromise);
  assert.equal(await draft(s),s.value,'Form cleared before response');assert.equal(await s.form.getAttribute('aria-busy'),'true');assert.equal(await s.form.locator('button[type=submit]').isDisabled(),true);
  await s.form.evaluate(f=>{f.requestSubmit();f.requestSubmit();});await s.p.waitForTimeout(150);assert.equal(calls,1,'Double submit reached RPC');
  const fresh=s.value+' plus récente';if(newer)await s.form.locator('[name='+s.field+']').evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},fresh);
  release();await s.p.waitForTimeout(500);
  if(newer){assert.equal(await draft(s),fresh,'Old success cleared newer draft');assert.notEqual(await s.form.getAttribute('aria-busy'),'true');}
  else if(mod==='contacts'&&mode==='edit')assert.equal(await s.form.count(),0,'Edit form still open after confirmed success');else assert.equal(await draft(s),'','Confirmed form was not reset');
  const after=await payload(),saved=after[mod].find(r=>r.id===captured.p_id);assert.equal(saved[s.field],s.value);for(const collection of Object.keys(before))if(collection!==mod)assert.equal(hash(after[collection]),hash(before[collection]),'Other module changed: '+collection);
  assert.equal(hash(after[mod].filter(r=>r.id!==captured.p_id)),hash(before[mod].filter(r=>r.id!==captured.p_id)),'Unrelated rows changed');
  if(mode==='edit'){const old=before[mod].find(r=>r.id===captured.p_id);for(const k of Object.keys(old))if(!Object.hasOwn(captured.p_patch,k)&&!['updatedAt','updatedBy'].includes(k))assert.equal(hash(saved[k]),hash(old[k]),'Omitted field changed: '+k);}
  assert.ok(!s.paths.some(x=>x.includes('crm_workspace_state')),'Restricted browser requested global CRM payload');assert.equal(calls,1);
  if(newer){
   const firstId=captured.p_id,firstCount=after[mod].length;
   await submit(s);
   if(mod==='contacts'&&mode==='edit')await s.form.waitFor({state:'hidden'});else await s.p.waitForFunction(({selector,field})=>document.querySelector(selector)?.querySelector('[name='+field+']')?.value==='',{selector:mod==='contacts'?'form.contact-create-form':'form[data-quote-form]',field:s.field});
   const second=await payload();assert.equal(calls,2);assert.equal(captured.p_id,firstId,'Newer draft created a duplicate');assert.equal(second[mod].length,firstCount,'Newer draft created another row');assert.equal(second[mod].find(r=>r.id===firstId)[s.field],fresh);
   for(const collection of Object.keys(after))if(collection!==mod)assert.equal(hash(second[collection]),hash(after[collection]),'Other module changed on newer draft save: '+collection);
  }
  return {delayedConfirmation:true,duplicateBlocked:true,newerDraftPreserved:newer,newerDraftSavedToSameId:newer,omittedFieldsPreserved:mode==='edit',otherModulesPreserved:true};
 }finally{release?.();await s.c.close();}
}
async function switchAccount(p,u){await p.evaluate(async(credentials)=>{let client;window.webpackChunk_N_E.push([[Math.random()],{},require=>{const modules=require.c?Object.values(require.c):Object.entries(require.m).filter(([,f])=>String(f).includes('http://127.0.0.1:55431')).map(([id])=>({exports:require(id)}));for(const e of modules){for(const v of Object.values(e.exports||{})){if(v&&typeof v==='object'&&v.auth&&typeof v.auth.refreshSession==='function'&&typeof v.from==='function'){client=v;break;}}if(client)break;}}]);if(!client)throw Error('SDK missing');const r=await client.auth.signInWithPassword(credentials);if(r.error)throw Error('Local Auth account switch failed');},{email:u.email,password:u.password});}
async function identityChange(mod,kind){
 const key=runId+'-'+mod+'-'+kind,s=await start(mod,'edit',key),b=await user('form-next-'+runId);await grant(b,{});let calls=0,reached,release;const reachedPromise=new Promise(r=>reached=r),gate=new Promise(r=>release=r);let originalActor;
 try{
  await s.p.route('**/rest/v1/rpc/crm_mutate_record',async route=>{calls++;originalActor=JSON.parse(Buffer.from(route.request().headers().authorization.split('.')[1],'base64url').toString()).sub;const response=await route.fetch();assert.equal(response.status(),200);reached();await gate;try{await route.fulfill({response});}catch{}});
  await submit(s);await timeout(reachedPromise);
  if(kind==='account-switch')await switchAccount(s.p,b);else{await grant(s.u,{});await s.p.evaluate(()=>window.dispatchEvent(new Event('focus')));}
  await s.p.getByRole('heading',{name:'Aucun accès autorisé'}).waitFor();release();await s.p.waitForTimeout(500);
  assert.equal(calls,1);assert.equal(originalActor,s.u.id);assert.ok(!(await s.p.locator('body').innerText()).includes(s.value),'Previous account draft visible after identity/rights change');assert.equal(await s.p.getByText('Enregistrement confirmé par le serveur.',{exact:true}).count(),0);
  return {actorPinned:true,noDraftInNextContext:true,admittedTransactionMayFinish:true};
 }finally{release?.();await s.c.close();}
}
async function test(name,fn){if(process.env.FORM_TEST_FILTER&&!name.includes(process.env.FORM_TEST_FILTER))return;try{results.push({name,status:'passed',...await fn()});console.log('PASS '+name);}catch(e){results.push({name,status:'failed',error:e.message});console.error('FAIL '+name+': '+e.message);}finally{writeFileSync(output,JSON.stringify(results,null,2));}}
try{
 for(const mod of ['contacts','quotes'])for(const mode of ['create','edit'])for(const kind of observe?['conflict','refusal']:['conflict','refusal','network'])await test(mod+' '+mode+' '+kind,()=>failure(mod,mode,kind));
 if(!observe){for(const mod of ['contacts','quotes'])for(const mode of ['create','edit'])for(const newer of [false,true])await test(mod+' '+mode+' '+(newer?'newer-draft':'delayed-success'),()=>successful(mod,mode,newer));for(const mod of ['contacts','quotes'])for(const kind of ['account-switch','revocation'])await test(mod+' '+kind,()=>identityChange(mod,kind));}
}finally{await browser.close();await sql.end();if(results.some(r=>r.status==='failed'))process.exitCode=1;}
