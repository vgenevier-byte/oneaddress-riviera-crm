/** Actual LeadsView JSX/handler; isolated rendering is separate from real local browser/RPC proof. */
require('../i18n/register-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { getContactLabel } = require('../../lib/contactIdentity.ts');
const source = fs.readFileSync('components/CRMApp.tsx', 'utf8');
const ast = ts.createSourceFile('CRMApp.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const view = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'LeadsView');
assert(view);
function compile(code, name, bindings) {
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  return new Function('require', 'exports', ...Object.keys(bindings), `${js}; return ${name};`)(require, {}, ...Object.values(bindings));
}
let selector;
function findSelector(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'SearchableInput' && node.attributes.properties.some(p => p.name?.text === 'defaultValue' && p.initializer?.getText(ast) === '{editingLead.contactName}')) selector = node;
  ts.forEachChild(node, findSelector);
}
findSelector(view); assert(selector);
const handler = view.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'submitEdit');
assert(handler);
const alice = {id:'alice', firstName:'Alice', name:'Dupont', companyName:'Azur Exemple'};
function selectorProps(contactName, contacts = [alice]) {
  const fn = compile(`function renderSelector() { return (${selector.getText(ast)}); }`, 'renderSelector', {
    editingLead:{contactName},contacts,leadContactOptions:contacts.map(contact=>({value:getContactLabel(contact),secondary:contact.companyName})),SearchableInput:()=>null,
  });
  return fn().props;
}
for (const language of ['fr','en']) {
  test(`historical contact text remains exact, independent of current suggestions (${language})`,()=>{
    for(const name of ['Dupont','Mme Alice Dupont','Ancien contact hors annuaire','  Dupont\u00a0','Ancien <contact> & privé']) {
      const props=selectorProps(name,[]);assert.equal(props.defaultValue,name);assert.equal(props.name,'contactName');assert.equal(props.required,true);assert.deepEqual(props.options,[]);
    }
  });
}
test('free-text snapshot suggestions do not infer canonical links from homonyms or company titles',()=>{
  const contacts=[alice,{...alice,id:'alice-homonym'},{id:'business',entityType:'company',companyName:'Entreprise seule',name:''},{id:'guillaume',entityType:'company',companyName:'Entreprise Guillaume',firstName:'Guillaume',name:''}];
  const props=selectorProps('Guillaume',contacts);
  assert.equal(props.defaultValue,'Guillaume');assert.deepEqual(props.options.map(option=>option.value),['Alice Dupont','Alice Dupont','Entreprise seule','Entreprise Guillaume']);
  assert(!('contactId' in props));assert.equal(contacts[2].name,'');assert.equal(contacts[3].name,'');
});
function submit(contactName, values = {}, omitContact = false, result) {
  const original = {id:'historical-lead',contactName,category:'Villa',status:'Nouveau',priority:'Moyenne',dueDate:'2026-11-01',nextAction:'Rappeler',value:123,history:[{id:'retained'}]};
  const form = new Map(Object.entries({...original,...values}));
  if (omitContact) form.delete('contactName');
  const writes=[], states=[], alerts=[];
  const fn=compile(handler.getText(ast),'submitEdit',{
    editingLead:original,FormData:class{constructor(){return form;}},parseAssetKey:()=>({}),safeNumber:value=>Number(value)||0,
    isOpenLead:lead=>lead.status!=='Gagné',window:{alert:message=>alerts.push(message)},dialogT:key=>key,
    onUpdate:lead=>{writes.push(lead);return result?.(lead);},setEditingLead:value=>states.push(value),
  });
  const pending=fn({preventDefault(){},currentTarget:{}});
  return {original,writes,states,alerts,pending};
}
test('unrelated edits preserve the exact stored contact, including whitespace and historical fields',async()=>{
  for (const name of ['Dupont','Alice Dupont','Mme Alice Dupont','  Dupont\u00a0','Hors annuaire','Entreprise Guillaume']) {
    const h=submit(name,{value:456,nextAction:'Autre action'});
    await h.pending;
    assert.equal(h.writes.length,1);assert.equal(h.writes[0].contactName,name);assert.equal(h.writes[0].value,456);
    assert.equal(h.writes[0].id,h.original.id);assert.deepEqual(h.writes[0].history,h.original.history);
    assert.equal(h.original.value,123);assert.deepEqual(h.states,[null]);
  }
});
test('an omitted/disabled contact control retains the original value, while an explicit choice replaces it',async()=>{
  const omitted=submit('  Dupont\u00a0',{value:456},true), explicit=submit('Dupont',{contactName:'Entreprise Guillaume'}), empty=submit('Dupont',{contactName:''});
  await Promise.all([omitted.pending,explicit.pending,empty.pending]);
  assert.equal(omitted.writes[0].contactName,'  Dupont\u00a0');
  assert.equal(explicit.writes[0].contactName,'Entreprise Guillaume');
  assert.equal(empty.writes.length,0);
});
test('validation refusal keeps the original contact and draft open with no update',async()=>{
  const h=submit('Dupont',{nextAction:'',value:456});
  await h.pending;
  assert.equal(h.alerts.length,1);assert.equal(h.writes.length,0);assert.equal(h.states.length,0);
  assert.equal(h.original.contactName,'Dupont');
});
test('scoped confirmation keeps the edit open while pending or refused and closes only after acceptance',async()=>{
  for (const response of [{ok:false,message:'Conflit'}, {ok:false,cancelled:true}, {ok:true}]) {
    let release;
    const h=submit('Dupont',{value:456},false,()=>new Promise(resolve=>{release=resolve;}));
    assert.equal(h.writes[0].value,456);assert.equal(h.writes[0].contactName,'Dupont');
    assert.deepEqual(h.states,[]);
    release(response);await h.pending;
    assert.deepEqual(h.states,response.ok?[null]:[]);
    assert.equal(h.original.contactName,'Dupont');assert.equal(h.original.value,123);
  }
});
test('ModuleWorkspace passes the actual Leads save promise back to its edit handler',async()=>{
  const moduleAst=ts.createSourceFile('ModuleWorkspace.tsx',fs.readFileSync('components/ModuleWorkspace.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let callback;
  function find(node) {
    if (ts.isJsxSelfClosingElement(node)&&node.tagName.getText(moduleAst)==='LeadsView') callback=node.attributes.properties.find(attribute=>attribute.name?.text==='onUpdate').initializer.expression;
    ts.forEachChild(node,find);
  }
  find(moduleAst);assert(callback);
  const response=Promise.resolve({ok:false,message:'Conflit'}),calls=[];
  const relay=compile(`const relay=${callback.getText(moduleAst)};`,'relay',{save:(...args)=>{calls.push(args);return response;}});
  const h=submit('Dupont',{value:456},false,relay);await h.pending;
  assert.equal(calls.length,1);assert.equal(calls[0][0],'leads');assert.equal(calls[0][1].contactName,'Dupont');
  assert.equal(calls[0][1].value,456);assert.deepEqual(h.states,[]);
});
