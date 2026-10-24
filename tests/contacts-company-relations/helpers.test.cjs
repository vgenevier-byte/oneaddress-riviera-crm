require('../i18n/register-typescript.cjs');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {getContactCompany,getCompanyPeople,getCompanyContactStatus,matchesContactWithCompany} = require('../../lib/contactCompany.ts');
const {mergeContactUpdate,getContactFormUpdate} = require('../../lib/contactEditing.ts');
const {taskContactOptions,matchesTaskContact} = require('../../lib/tasks/contactOptions.ts');

const company = {id:'company',entityType:'company',companyName:'Agence Étoile',email:'info@example.invalid'};
const person = {id:'alice',entityType:'person',firstName:'Alice',name:'Martin',companyId:'company',companyName:'Ancienne société',phone:'06 12 34 56 78'};
const other = {id:'bob',entityType:'person',firstName:'Bob',name:'Martin',companyName:'Agence Étoile'};
const alias = {id:'old',entityType:'company',companyName:'Ancien nom',mergedIntoCompanyId:'company'};
const rows = [company,person,other,alias];

test('only canonical IDs attach people, preserving homonyms and raw text',()=>{
  const before = JSON.stringify(rows);
  assert.equal(getContactCompany(person,rows),company);
  assert.equal(getContactCompany(other,rows),undefined);
  assert.deepEqual(getCompanyPeople(company.id,rows),[person]);
  assert.equal(getContactCompany(alias,rows),company);
  assert.equal(getCompanyContactStatus(company,rows),'complete');
  assert.equal(getCompanyContactStatus(company,[company,other]),'needs_contact');
  assert.equal(getCompanyContactStatus(company,[company,{...person,entityType:undefined}]),'needs_contact');
  assert.equal(JSON.stringify(rows),before);
});

test('company search returns its people and company by authorized personal fields',()=>{
  assert.equal(matchesContactWithCompany(person,'etoile alice',rows),true);
  assert.equal(matchesContactWithCompany(company,'Martin Alice',rows),true);
  assert.equal(matchesContactWithCompany(company,'06 12',rows),true);
  assert.equal(matchesContactWithCompany(company,'Bob',rows),false);
  assert.equal(matchesContactWithCompany(person,'info@example.invalid',rows),false);
  assert.equal(matchesContactWithCompany(company,'Alice',[company]),false);
});

test('broken and cyclic aliases do not resolve to a guessed company',()=>{
  assert.equal(getContactCompany({id:'p',companyId:'missing'},rows),undefined);
  const a={id:'a',entityType:'company',mergedIntoCompanyId:'b'},b={id:'b',entityType:'company',mergedIntoCompanyId:'a'};
  assert.equal(getContactCompany(a,[a,b]),undefined);
  assert.equal(getContactCompany({id:'p',companyId:'alice'},rows),undefined);
});

test('partial edits retain relations, explicit detach clears only its link',()=>{
  const original={...person,postalAddress:'Adresse historique',notes:'Note conservée'};
  assert.deepEqual(mergeContactUpdate(original,{phone:'Nouveau',companyId:undefined}),{...original,phone:'Nouveau'});
  assert.deepEqual(mergeContactUpdate(original,{companyId:''}),{...original,companyId:''});
  assert.deepEqual(getContactFormUpdate({...original,companyId:'other'},['companyId']),{companyId:'other'});
});

test('task search derives canonical company only from its authorized projection',()=>{
  const options=taskContactOptions(rows);
  assert.equal(options.find(row=>row.id===person.id).company,company.companyName);
  assert.equal(matchesTaskContact(options.find(row=>row.id===person.id),'alice etoile'),true);
  assert.equal(taskContactOptions([person])[0].company,person.companyName);
  assert.equal(options.filter(row=>row.name==='Martin').length,2);
});
