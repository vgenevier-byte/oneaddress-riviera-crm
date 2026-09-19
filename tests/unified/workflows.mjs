import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {connect,sql,rpc,user,grant,dir} from './local.mjs';
await connect();const u=await user('matrix');const results=[];
const ok=r=>{assert.ok([200,204].includes(r.status),JSON.stringify(r));return r.data;};const deny=r=>assert.ok(r.status>=400,JSON.stringify(r));
const payload=async()=>(await sql.query("select payload from crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
const revision=async(moduleId)=>ok(await rpc('crm_read_module',u.token,{p_module:moduleId})).revision;
const check=async(name,fn)=>{try{await fn();results.push({name,status:'passed'});console.log('PASS '+name);}catch(e){results.push({name,status:'failed',error:e.message});throw e;}finally{writeFileSync(dir+'/workflows.json',JSON.stringify(results,null,2));}};
try{
 await check('Bank read/write/payment require separate grants and preserve verified principal',async()=>{
 await grant(u,{contacts:{level:'contribute'},vendorInvoices:{level:'contribute'}});
 let rev=await revision('contacts');deny(await rpc('crm_bank_action',u.token,{p_contact:'unified-contacts',p_action:'add',p_account:{accountHolder:'Fictif'},p_revision:rev}));
 await grant(u,{contacts:{level:'contribute',sensitive:{bank_read:true,bank_write:true}},vendorInvoices:{level:'contribute',sensitive:{payment:true}}});
 // Only synthetic bank codes, generated checksum, never a real beneficiary.
 const suffix=String(Date.now()).slice(-5);const bban='000000000000000000'+suffix;const iban='FR'+String(98n-BigInt(bban+'152700')%97n).padStart(2,'0')+bban;
 const a=ok(await rpc('crm_bank_action',u.token,{p_contact:'unified-contacts',p_action:'add',p_account:{accountHolder:'Entreprise fictive',iban,bic:'TESTFRP0XXX'},p_revision:rev}));
 const banks=a.collections.contacts.find(c=>c.id==='unified-contacts').supplierBankAccounts;const fresh=banks.find(a=>a.iban===iban);assert.equal(fresh.status,'À vérifier');assert.equal(fresh.isPrimary,false);assert.ok(banks.some(a=>a.id==='bank-fictional'&&a.isPrimary));
 deny(await rpc('crm_prepare_payment',u.token,{p_invoice:'unified-vendorInvoices',p_account:fresh.id,p_revision:await revision('vendorInvoices')}));
 const verified=ok(await rpc('crm_bank_action',u.token,{p_contact:'unified-contacts',p_action:'verify',p_account:{id:fresh.id},p_revision:a.revision}));assert.equal(verified.collections.contacts.find(c=>c.id==='unified-contacts').supplierBankAccounts.find(a=>a.id===fresh.id).verifiedBy,u.id);
 ok(await rpc('crm_prepare_payment',u.token,{p_invoice:'unified-vendorInvoices',p_account:fresh.id,p_revision:await revision('vendorInvoices')}));
 const invoice=(await payload()).vendorInvoices.find(i=>i.id==='unified-vendorInvoices');assert.equal(invoice.paymentBankAccountId,fresh.id);assert.equal(invoice.paidAmount,0);
 await grant(u,{contacts:{level:'read',sensitive:{bank_read:true}},vendorInvoices:{level:'contribute'}});deny(await rpc('crm_prepare_payment',u.token,{p_invoice:'unified-vendorInvoices',p_account:fresh.id,p_revision:await revision('vendorInvoices')}));
 });
 await check('Quote validation checks both modules atomically, keeps linked invoice idempotent and refuses broken link',async()=>{
 await grant(u,{vendorQuotes:{level:'contribute'}});deny(await rpc('crm_validate_vendor_quote',u.token,{p_quote:'unified-vendorQuotes',p_revision:await revision('vendorQuotes')}));
 await grant(u,{vendorQuotes:{level:'contribute'},vendorInvoices:{level:'contribute'}});const before=await payload();ok(await rpc('crm_validate_vendor_quote',u.token,{p_quote:'unified-vendorQuotes',p_revision:await revision('vendorQuotes')}));const after=await payload();const q=after.vendorQuotes.find(q=>q.id==='unified-vendorQuotes');assert.equal(q.status,'Validé');assert.equal(after.vendorInvoices.filter(i=>i.id===q.linkedInvoiceId).length,1);for(const old of before.vendorInvoices)assert.deepEqual(after.vendorInvoices.find(i=>i.id===old.id),old);
 ok(await rpc('crm_validate_vendor_quote',u.token,{p_quote:q.id,p_revision:await revision('vendorQuotes')}));assert.deepEqual((await payload()).vendorInvoices,after.vendorInvoices);
 const testId='unified-broken-quote';await sql.query("update crm_workspace_state set payload=jsonb_set(payload,'{vendorQuotes}',(payload->'vendorQuotes')||$1::jsonb) where workspace_id='oneaddress-riviera'",[JSON.stringify([{...q,id:testId,linkedInvoiceId:'absent-invoice'}])]);deny(await rpc('crm_validate_vendor_quote',u.token,{p_quote:testId,p_revision:await revision('vendorQuotes')}));
 });
 await check('Cross references, protected workflow fields and unknown bank fields are rejected',async()=>{
 await grant(u,{houseTracking:{level:'contribute'},vendorQuotes:{level:'contribute'},contacts:{level:'contribute',sensitive:{bank_read:true,bank_write:true}}});
 deny(await rpc('crm_mutate_record',u.token,{p_module:'houseTracking',p_collection:'houseTimeEntries',p_id:'unified-houseTimeEntries',p_patch:{workerId:'unknown'},p_revision:await revision('houseTracking')}));
 deny(await rpc('crm_mutate_record',u.token,{p_module:'houseTracking',p_collection:'houseTimeEntries',p_id:'unified-houseTimeEntries',p_patch:{startTime:'09:17'},p_revision:await revision('houseTracking')}));
 deny(await rpc('crm_mutate_record',u.token,{p_module:'vendorQuotes',p_collection:'vendorQuotes',p_id:'unified-vendorQuotes',p_patch:{status:'Validé'},p_revision:await revision('vendorQuotes')}));
 deny(await rpc('crm_bank_action',u.token,{p_contact:'unified-contacts',p_action:'add',p_account:{status:'Vérifié',isPrimary:true},p_revision:await revision('contacts')}));
 });
}finally{await sql.end();}
