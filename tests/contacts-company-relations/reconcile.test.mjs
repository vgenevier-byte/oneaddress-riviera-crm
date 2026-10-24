import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareReconciliation,reconciliationSQL} from '../../scripts/contact-company-reconcile.mjs';

const company={id:'company',entityType:'company',companyName:'Agence Fictive',name:'Dupont',firstName:'Alice',email:'general@example.invalid',notes:'Information entreprise',budget:123};
const person={id:'person',entityType:'person',name:'Dupont',firstName:'Alice',email:'alice@example.invalid',notes:'Note privée',budget:0};
const other={id:'other',entityType:'person',name:'Dupont',firstName:'Bob',companyName:'Agence Fictive'};
const snapshot={workspace_id:'oneaddress-riviera',updated_at:'2026-10-24T08:00:00Z',payload:{contacts:[company,person,other],quotes:[{id:'q',contactId:company.id,amount:12345}],documents:[{id:'private',contactId:person.id}]}};
const op=(id,before,patch)=>({type:'patch',id,before,patch,evidence:'Exact personal first/last name and direct mobile stored on company and person',reason:'Reuse existing identifiable interlocutor'});
const plan={operations:[op('person',person,{companyId:'company'}),op('company',company,{primaryContactId:'person'})]};

test('explicit reconciliation preserves each identity, values, notes and every original reference',()=>{
  const before=structuredClone(snapshot),a=prepareReconciliation(snapshot,plan),b=prepareReconciliation(snapshot,plan);
  assert.equal(a.planId,b.planId);assert.deepEqual(snapshot,before);
  assert.equal(a.summary.linkedPersons,1);assert.equal(a.summary.mergedPersons,0);
  assert.deepEqual(a.contacts.find(row=>row.id==='other'),other);
  assert.deepEqual(a.contacts.find(row=>row.id==='person'),{...person,companyId:'company'});
  assert.deepEqual(a.contacts.find(row=>row.id==='company'),{...company,primaryContactId:'person'});
  const sql=reconciliationSQL(snapshot,a);
  assert.match(sql,/for update/);assert.match(sql,/reconciliation_source_changed/);assert.match(sql,/before_payload/);assert.match(sql,/where plan_id=/);
  assert.match(sql,/reconciliation_plan_rolled_back/);
  assert.doesNotMatch(sql,/delete from|update public\.fonciere|crm_document_shares/i);
});

test('uncertain names or domains have no operation and never become a relationship',()=>{
  const empty=prepareReconciliation(snapshot,{operations:[]});
  assert.deepEqual(empty.contacts,snapshot.payload.contacts);
  assert.equal(empty.summary.linkedPersons,0);
});

test('conflicting input, silent overwrites, missing evidence and incomplete companies fail before producing SQL',()=>{
  assert.throws(()=>prepareReconciliation({...snapshot,payload:{...snapshot.payload,contacts:[company,{...person,notes:'Concurrent correction'}]}},plan),/source_record_changed/);
  assert.throws(()=>prepareReconciliation(snapshot,{operations:[op('person',person,{notes:'overwrite'})]}),/patch_forbidden/);
  assert.throws(()=>prepareReconciliation(snapshot,{operations:[{...plan.operations[0],evidence:''}]}),/evidence_required/);
  assert.throws(()=>prepareReconciliation(snapshot,{operations:[op('person',person,{companyId:'missing'})]}),/invalid_company_link/);
  const legacy={...person};delete legacy.entityType;
  assert.throws(()=>prepareReconciliation({...snapshot,payload:{...snapshot.payload,contacts:[company,legacy]}},{operations:[op('person',legacy,{companyId:'company'})]}),/invalid_company_link/);
  assert.throws(()=>prepareReconciliation(snapshot,{operations:[op('company',company,{primaryContactId:'person'})]}),/company_person_required/);
});

test('certain company consolidation retains original ID and divergent values for provenance',()=>{
  const second={id:'second',entityType:'company',companyName:'Agence Fictive',name:'',email:'old@example.invalid',notes:'Valeur source divergente'};
  const input={...snapshot,payload:{...snapshot.payload,contacts:[...snapshot.payload.contacts,second]}};
  const p={operations:[...plan.operations,op('second',second,{mergedIntoCompanyId:'company'})]};
  const prepared=prepareReconciliation(input,p),alias=prepared.contacts.find(row=>row.id==='second');
  assert.deepEqual(alias,{...second,mergedIntoCompanyId:'company'});assert.equal(prepared.summary.consolidatedCompanies,1);
  assert.equal(prepared.contacts.length,input.payload.contacts.length);
});

test('repeated explicit creation uses fixed ID and never invents a personal coordinate',()=>{
  const row={id:'new-person',entityType:'person',firstName:'Alice',name:'Dupont',companyId:'company',email:'',phone:'',city:'',postalAddress:'',kind:'Client',budget:0,source:'Reprise entreprise company',notes:'',createdAt:'2026-10-24T08:00:00Z'};
  const p={operations:[{type:'create',id:row.id,contact:row,evidence:'Explicit first and last name in historical company fields',reason:'Separate company and person identities'}]};
  const a=prepareReconciliation(snapshot,p),b=prepareReconciliation(snapshot,p);
  assert.equal(a.planId,b.planId);assert.equal(a.summary.createdPersons,1);assert.equal(a.contacts.find(r=>r.id===row.id).email,'');
  assert.throws(()=>prepareReconciliation({...snapshot,payload:{...snapshot.payload,contacts:a.contacts}},p),/create_invalid/);
});

test('explicitly confirmed legacy business qualification preserves all names, coordinates and original IDs',()=>{
  const company={id:'legacy-company',companyName:'Groupe fictif',name:'',firstName:'Interlocutrice à compléter',email:'general@example.invalid'};
  const person={id:'legacy-person',companyName:'Autre dénomination du groupe',name:'Dupont',firstName:'Alice',phone:'06 00 00 00 00'};
  const input={workspace_id:'oneaddress-riviera',updated_at:snapshot.updated_at,payload:{contacts:[company,person],vendorInvoices:[{id:'q',contactId:company.id,amount:123}]}};
  const operations=[{...op(company.id,company,{entityType:'company',primaryContactId:person.id}),explicitClassification:true},{...op(person.id,person,{entityType:'person',companyId:company.id}),explicitClassification:true}];
  const prepared=prepareReconciliation(input,{operations});
  const reordered={...input,payload:{...input.payload,contacts:input.payload.contacts.map(row=>Object.fromEntries(Object.entries(row).reverse()))}};
  assert.equal(prepareReconciliation(reordered,{operations:operations.map(operation=>({...operation,before:Object.fromEntries(Object.entries(operation.before).reverse())}))}).planId,prepared.planId);
  assert.deepEqual(prepared.contacts,[{...company,entityType:'company',primaryContactId:person.id},{...person,entityType:'person',companyId:company.id}]);
  assert.equal(prepared.summary.createdCompanies,0);assert.equal(prepared.summary.linkedPersons,1);
  assert.throws(()=>prepareReconciliation(input,{operations:operations.map(operation=>({...operation,explicitClassification:false}))}),/explicit_legacy_classification_required/);
  assert.throws(()=>prepareReconciliation(snapshot,{operations:[{...op('person',person,{entityType:'company'}),explicitClassification:true}]}),/source_record_changed|explicit_legacy_classification_required/);
});
