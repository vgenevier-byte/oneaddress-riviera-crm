/** Real local Auth/HTTP RPC/PostgreSQL/Storage. All sources fictitious. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {connect,sql,request,status,directory,rpc,login,allow,deny,read,payload} from './local.mjs';
const fixture=JSON.parse(readFileSync(join(directory,'fixtures.private.json'),'utf8'));
const users=fixture.users,results=[];
const check=async(name,fn)=>{await fn();results.push({name,passed:true});console.log('PASS '+name);};
const revision=async token=>(await read(token)).revision;
const set=async(token,id,status,rev)=>rpc('crm_set_vendor_quote_information',token,{p_quote:id,p_status:status,p_revision:rev??await revision(token)});
const mutate=async(token,id,patch)=>rpc('crm_mutate_record',token,{p_module:'vendorQuotes',p_collection:'vendorQuotes',p_id:id,p_patch:patch,p_revision:await revision(token)});
const tasks=async()=>(await sql.query("select jsonb_build_object('records',(select coalesce(jsonb_agg(t),'[]') from app_private.task_records t),'links',(select coalesce(jsonb_agg(t),'[]') from app_private.task_links t),'events',(select coalesce(jsonb_agg(t),'[]') from app_private.task_events t)) data")).rows[0].data;
const finances=async()=>{const p=await payload();return {invoices:p.vendorInvoices,payments:p.housePayments,hours:p.houseTimeEntries};};
await connect();
try{
 if(process.argv.includes('--reset'))await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[fixture.fixture]);
 for(const u of Object.values(users))u.token=await login(u);
 const quoteToken=users.quoteOnly.token,contributor=users.contributor.token,owner=users.owner.token,reader=users.reader.token;
 await sql.query("insert into app_private.task_records(id,title,status,creator_id,creator_label,created_at) values('manual-information-task','Comparer les prix · tâche manuelle fictive','À faire',$1,'Camille fictif',clock_timestamp()) on conflict(id) do nothing",[users.owner.id]);
 await sql.query("insert into app_private.task_links(task_id,target,is_primary) values('manual-information-task','{\"type\":\"vendor_quote\",\"id\":\"pending\"}',true) on conflict(task_id,target) do nothing");
 const beforeFinance=await finances(),beforeTasks=await tasks();
 let createdId='created-info';let documentPath;
 await check('Creation informational through guarded RPC; actual PDF upload and optional notes persist after new Auth session',async()=>{
  const q=allow(await rpc('crm_create_vendor_quote',contributor,{p_quote:createdId,p_patch:{title:'Étude du marché · fictif',contactId:'vendor-fictional',contactName:'Camille Démo',category:'Paysagiste',quoteReference:'DEMO-CREATION',quoteDate:'2026-10-27',validUntil:'2026-12-31',amount:750.5,notes:'Nouveau partenaire potentiel · fictif'},p_status:'Pour information',p_revision:await revision(contributor)}));
  assert.equal(q.collections.vendorQuotes.find(q=>q.id===createdId).status,'Pour information');
  documentPath=allow(await rpc('crm_new_document',contributor,{p_collection:'vendorQuotes',p_record:createdId,p_title:'devis-fictif.pdf'}));
  const bytes=Buffer.from('%PDF-1.4\n% Fictitious local quote\n%%EOF');
  const up=await fetch(status.API_URL+'/storage/v1/object/crm-documents/'+documentPath,{method:'POST',headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+contributor,'Content-Type':'application/pdf','x-upsert':'false'},body:bytes});assert.equal(up.status,200,await up.text());
  allow(await mutate(contributor,createdId,{quoteDocumentStoragePath:documentPath,quoteDocumentName:'devis-fictif.pdf'}));
  allow(await request('/auth/v1/logout',contributor,{},'POST'));users.contributor.token=await login(users.contributor);
  const fresh=(await read(users.contributor.token)).collections.vendorQuotes.find(q=>q.id===createdId);
  assert.equal(fresh.status,'Pour information');assert.equal(fresh.notes,'Nouveau partenaire potentiel · fictif');assert.equal(fresh.amount,750.5);assert.equal(fresh.quoteDocumentStoragePath,documentPath);assert.equal(fresh.quoteDocumentName,'devis-fictif.pdf');
  const download=await fetch(status.API_URL+'/storage/v1/object/authenticated/crm-documents/'+documentPath,{headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+owner}});if(download.status!==200)throw new Error('Local document download '+download.status+' '+await download.text());assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
  assert.deepEqual(await finances(),beforeFinance);assert.deepEqual(await tasks(),beforeTasks);
 });
 await check('Complete access legacy PDF uploaded before creation is adopted atomically; missing/wrong prefix and restricted adoption refused',async()=>{
  const fullId='full-info-upload',path='oneaddress-riviera/vendor-quotes/'+fullId+'/devis.pdf';
  const bytes=Buffer.from('%PDF-1.4\n% Complete-access fictional quote\n%%EOF');
  const up=await fetch(status.API_URL+'/storage/v1/object/crm-documents/'+path,{method:'POST',headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+owner,'Content-Type':'application/pdf','x-upsert':'true'},body:bytes});assert.equal(up.status,200,await up.text());
  allow(await rpc('crm_create_vendor_quote',owner,{p_quote:fullId,p_patch:{title:'Devis complet fictif',contactId:'vendor-fictional',amount:220.5,notes:'Comparaison des tarifs · fictif',quoteDocumentStoragePath:path,quoteDocumentName:'devis.pdf'},p_status:'Pour information',p_revision:await revision(owner)}));
  const fresh=await login(users.owner);const q=(await read(fresh)).collections.vendorQuotes.find(q=>q.id===fullId);assert.equal(q.status,'Pour information');assert.equal(q.quoteDocumentStoragePath,path);assert.equal(q.notes,'Comparaison des tarifs · fictif');
  assert.equal((await sql.query('select count(*)::int n from public.crm_document_scopes where resource_id=$1 and record_id=$2',[path,fullId])).rows[0].n,1);
  for(const [who,id,objectPath]of [[owner,'wrong-prefix',path],[owner,'missing-object','oneaddress-riviera/vendor-quotes/missing-object/absent.pdf'],[users.contributor.token,'restricted-adoption',path]]){const before=await payload();deny(await rpc('crm_create_vendor_quote',who,{p_quote:id,p_patch:{title:'Fictif refusé',quoteDocumentStoragePath:objectPath},p_status:'Pour information',p_revision:await revision(who)}),'document_reference_forbidden');assert.deepEqual(await payload(),before);}
  assert.deepEqual(await finances(),beforeFinance);assert.deepEqual(await tasks(),beforeTasks);
 });
 await check('Quote-only contributor without invoice permissions classifies pending/refused and restores same ID; finance and manual task unchanged',async()=>{
  for(const id of ['pending','refused']){const old=(await payload()).vendorQuotes.find(q=>q.id===id);allow(await set(quoteToken,id,'Pour information'));let next=(await payload()).vendorQuotes.find(q=>q.id===id);assert.deepEqual({...next,status:old.status,updatedAt:old.updatedAt,updatedBy:old.updatedBy},{...old,updatedAt:old.updatedAt,updatedBy:old.updatedBy});assert.equal(next.status,'Pour information');allow(await set(quoteToken,id,'À valider'));next=(await payload()).vendorQuotes.find(q=>q.id===id);assert.equal(next.id,old.id);assert.equal(next.status,'À valider');}
  assert.deepEqual(await finances(),beforeFinance);assert.deepEqual(await tasks(),beforeTasks);
  assert.equal((await rpc('crm_read_module',quoteToken,{p_module:'vendorInvoices'})).status,403);
 });
 await check('Reader and anonymous denied; generic status edits and forged create status cannot bypass validation',async()=>{
  deny(await set(reader,'pending','Pour information'),'module_forbidden');
  deny(await rpc('crm_create_vendor_quote',reader,{p_quote:'reader-create',p_patch:{title:'Fictif'},p_status:'Pour information',p_revision:await revision(reader)}),'module_forbidden');
  deny(await set(null,'pending','Pour information','fake'));
  for(const state of ['Validé','Pour information'])deny(await mutate(quoteToken,'pending',{status:state}));
  deny(await rpc('crm_create_vendor_quote',quoteToken,{p_quote:'forged-status',p_patch:{title:'Fictif'},p_status:'Validé',p_revision:await revision(quoteToken)}),'invalid_vendor_quote_status');
  deny(await rpc('crm_create_vendor_quote',quoteToken,{p_quote:'forged-patch',p_patch:{title:'Fictif',status:'Validé'},p_status:'Pour information',p_revision:await revision(quoteToken)}));
  assert.ok(!(await payload()).vendorQuotes.some(q=>['reader-create','forged-status','forged-patch'].includes(q.id)));
 });
 await check('Stale revision denied and simultaneous quote writes serialize with exactly one conflict',async()=>{
  const rev=await revision(quoteToken);allow(await set(quoteToken,'pending','Pour information',rev));deny(await set(quoteToken,'refused','Pour information',rev),'revision_conflict');allow(await set(quoteToken,'pending','À valider'));
  const concurrentRev=await revision(quoteToken);const pair=await Promise.all([set(quoteToken,'pending','Pour information',concurrentRev),set(quoteToken,'refused','Pour information',concurrentRev)]);assert.equal(pair.filter(r=>r.status===200).length,1);assert.equal(pair.filter(r=>r.data.message==='revision_conflict').length,1);
  for(const id of ['pending','refused'])if((await payload()).vendorQuotes.find(q=>q.id===id).status==='Pour information')allow(await set(quoteToken,id,'À valider'));
 });
 await check('Both invoice directions, missing and incoherent links block classification with explicit error and no changes',async()=>{
  for(const [id,error] of [['linked','vendor_quote_has_linked_invoice'],['reverse','vendor_quote_has_linked_invoice'],['broken','broken_explicit_invoice_link'],['inconsistent','vendor_quote_invoice_link_inconsistent']]){const before=await payload();deny(await set(quoteToken,id,'Pour information'),error);assert.deepEqual(await payload(),before);}
  assert.deepEqual(await tasks(),beforeTasks);
 });
 await check('Validation requires document and both module grants; later explicit validation creates/reuses exactly one invoice across retries',async()=>{
  deny(await rpc('crm_validate_vendor_quote',users.contributor.token,{p_quote:createdId,p_revision:await revision(users.contributor.token)}),'both_finance_modules_required');
  deny(await rpc('crm_validate_vendor_quote',owner,{p_quote:'no-doc',p_revision:await revision(owner)}),'quote_document_required');
  const original=(await payload()).vendorInvoices;allow(await rpc('crm_validate_vendor_quote',owner,{p_quote:createdId,p_revision:await revision(owner)}));const first=await payload();const q=first.vendorQuotes.find(q=>q.id===createdId);assert.equal(q.status,'Validé');assert.equal(first.vendorInvoices.filter(i=>i.sourceQuoteId===createdId).length,1);assert.equal(first.vendorInvoices.length,original.length+1);for(const invoice of original)assert.deepEqual(first.vendorInvoices.find(i=>i.id===invoice.id),invoice);
  allow(await rpc('crm_validate_vendor_quote',owner,{p_quote:createdId,p_revision:await revision(owner)}));assert.deepEqual((await payload()).vendorInvoices,first.vendorInvoices);deny(await set(quoteToken,createdId,'Pour information'),'vendor_quote_information_transition_forbidden');assert.deepEqual(await tasks(),beforeTasks);
 });
 // Reset only the owned fictitious fixture for UI coverage; retain uploaded file.
 await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[fixture.fixture]);
 writeFileSync('docs/vendor-information/server-results.json',JSON.stringify({passed:results.length,results,evidence:{realAuth:true,realSessions:true,realHttpRpc:true,realPostgres:true,realStorageUploadDownload:true,loopback:status.API_URL,fictitiousDataOnly:true,productionWrites:false}},null,2)+'\n');
 console.log('Server checks complete; fictitious UI baseline restored.');
}finally{await sql.end();}
