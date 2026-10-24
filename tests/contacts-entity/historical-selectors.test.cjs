/** Isolated production functions/JSX only; no Auth, database, or server-save proof. */
require('../i18n/register-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const {renderToStaticMarkup} = require('react-dom/server');
const identity = require('../../lib/contactIdentity.ts');
const vendor = require('../../lib/vendorContacts.ts');

function tree(path) {
  return ts.createSourceFile(path, fs.readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
const crm = tree('components/CRMApp.tsx');
const quotes = tree('components/VendorQuotesView.tsx');
function find(root, predicate) {
  let found;
  function walk(node) { if (!found && predicate(node)) found = node; if (!found) ts.forEachChild(node, walk); }
  walk(root); assert(found); return found;
}
function declaration(ast, name) { return find(ast, node => ts.isFunctionDeclaration(node) && node.name?.text === name); }
function evaluate(code, result, bindings = {}) {
  const js = ts.transpileModule(code, {compilerOptions: {target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  return new Function('require', 'exports', ...Object.keys(bindings), `${js}; return ${result};`)(require, {}, ...Object.values(bindings));
}
function compile(ast, name, bindings) { return evaluate(declaration(ast, name).getText(ast), name, bindings); }
function house(contacts) {
  const bindings = {...identity, contacts};
  for (const name of ['getHouseContactDisplayName']) {
    bindings[name] = compile(crm, name, bindings);
  }
  return bindings;
}
const alice = {id:'fictional-alice',entityType:'person',firstName:'Alice',name:'Dupont',companyName:'Azur Exemple',kind:'Prestataire',email:''};
const company = {id:'fictional-company',entityType:'company',firstName:'Guillaume',name:'',companyName:'Entreprise Exemple',kind:'Prestataire',email:''};

test('house picker keeps historical civility, exposes explicit IDs, and never resolves typed text', async () => {
  const contacts = [{...alice,id:'fictional-m',entityType:undefined,civility:'M'}, {...alice,id:'fictional-mme',entityType:undefined,civility:'MME'}];
  const bindings = house(contacts);
  const picker = find(declaration(crm,'HouseTrackingView'), node => ts.isJsxElement(node) && node.openingElement.tagName.getText(crm) === 'SearchableSelect'
    && node.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.text === 'name' && attribute.initializer?.text === 'contactId'));
  const render = evaluate(`const render = () => (${picker.getText(crm)});`, 'render', {...bindings, sortedHouseContacts:contacts, t:key=>key,
    houseContactSearchOptions:new Map(),SearchableSelect:({children,...props})=>require('react').createElement('select',props,children)});
  const html = renderToStaticMarkup(render());
  for (const contact of contacts) assert(html.includes(`value="${contact.id}"`));
  assert(html.includes('M Alice Dupont'));assert(html.includes('MME Alice Dupont'));
  async function submit(values) {
    const form = new FormData();for(const [key,value] of Object.entries(values))form.set(key,value);form.set('hourlyRate','20');
    let saved;const alerts=[];
    await compile(crm,'submitWorker',{...bindings,FormData:class {constructor(){return form;}},parseHouseHourlyRate:Number,makeId:()=> 'worker-fictional',
      dialogT:key=>key,window:{alert:value=>alerts.push(value)},onAddWorker:row=>{saved=row;}})({preventDefault(){},currentTarget:{reset(){}}});
    return {saved,alerts};
  }
  const selected=await submit({contactId:contacts[1].id});assert.equal(selected.saved.contactId,contacts[1].id);assert.equal(selected.saved.contactName,'MME Alice Dupont');
  for(const values of [{contactSearch:'Alice'},{contactSearch:'MME Alice Dupont'},{contactId:'revoked-id'}]){
    const rejected=await submit(values);assert.equal(rejected.saved,undefined);assert.equal(rejected.alerts.length,1);
  }
});

test('house company title keeps the recorded company identity without inventing a surname', () => {
  const contacts = [{...company,firstName:''}, {...company,id:'fictional-company-guillaume'}];
  const bindings = house(contacts);
  for(const contact of contacts)assert.equal(bindings.getHouseContactDisplayName(contact),'Entreprise Exemple');
  assert.equal(company.name,'');assert.notEqual(contacts[0].id,contacts[1].id);
});

test('house update handler and actual editor submit never rebuild contact identity', async () => {
  const calls = [];
  const update = compile(crm,'updateHouseTrackingWorker',{persistHouseRecord:async(...args)=>{calls.push(args);return {ok:true};}});
  const editor = tree('components/HouseWorkerEditor.tsx');
  const submitAttribute = find(editor,node=>ts.isJsxAttribute(node)&&node.name.text==='onSubmit');
  const submit = evaluate(`const submit = ${submitAttribute.initializer.expression.getText(editor)};`,'submit',{
    business:null,confirmation:{saving:false,submit:async(_form,save,after)=>{await save();after(false);}},rate:'30',notes:'new notes',
    parseHouseHourlyRate:Number,setError(){},canEditNotes:true,worker:{id:'worker-fictional',contactId:alice.id,contactName:'  M Alice Dupont  ',notes:'old notes'},
    onSave:update,onConfirmed(){},
  });
  submit({preventDefault(){},currentTarget:{}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[['worker','worker-fictional',{hourlyRate:30,notes:'new notes'}]]);
});

function submitBed(kind, editing, contactId, contacts, limited = false, amount = '120') {
  const form = new FormData();
  for (const [key,value] of Object.entries({contactId,amount,paidAmount:'0',title:'Unrelated title edit',preserveLegacyContact:'true'})) form.set(key,value);
  const saved = [], alerts = [];
  const bindings = {
    ...vendor,FormData:class {constructor(){return form;}},File:class {},contacts,
    business:limited?{read:()=>true}:null,parseEuroAmount:Number,makeId:()=> 'new-fictional',
    editingQuote:editing,editingInvoice:editing,invoices:[],getContactProfessionForInvoice:()=> 'Prestataire',
    findVendorInvoiceDuplicates:()=>[],canSaveVendorInvoice:()=>true,getVendorInvoiceStatus:()=> 'À payer',
    getHistoricalVendorInvoiceContactName:()=>{throw new Error('Historical name must remain exact without lookup');},
    onUpdate:row=>saved.push(row),onAdd:row=>saved.push(row),setEditingQuote(){},setEditingInvoice(){},
    dialogT:key=>key,liveT:{current:key=>key},window:{alert:value=>alerts.push(value)},
  };
  const handler = kind === 'quote' ? compile(quotes,'submitQuote',bindings) : compile(crm,'submitInvoiceForm',bindings);
  return {saved,alerts,async run(){const element={reset(){}};await handler(kind === 'quote'?{preventDefault(){},currentTarget:element}:element);}};
}

test('invoice opening retains the exact historical label before any submit', () => {
  const invoice = {id:'invoice-fictional',contactId:alice.id,contactName:'  Azur Exemple historique  '};
  let edited;
  compile(crm,'startEditInvoice',{findContactForVendorInvoice:()=>alice,setEditingInvoice:row=>{edited=row;},getVendorContactPersonName:vendor.getVendorContactPersonName,
    getContactProfessionForInvoice:()=> 'Prestataire',window:{setTimeout(){}}})(invoice);
  assert.equal(edited.contactName,invoice.contactName);
  assert.equal(edited.contactId,invoice.contactId);
});

for (const kind of ['quote','invoice']) {
  test(`${kind} real submit keeps historical labels exactly when the ID is unchanged, full and scoped callers`, async () => {
    for (const limited of [false,true]) for (const contactName of ['Dupont','M Alice Dupont','  Azur Exemple historique  ','Ancienne référence absente']) {
      const original = {id:`${kind}-fictional`,contactId:alice.id,contactName,amount:100};
      const h = submitBed(kind,original,alice.id,[alice],limited);
      await h.run();
      assert.equal(h.alerts.length,0);
      assert.equal(h.saved.length,1);
      assert.equal(h.saved[0].contactName,contactName);
      assert.equal(h.saved[0].contactId,original.contactId);
      assert.equal(h.saved[0].title,'Unrelated title edit');
      assert.equal(original.contactName,contactName);
    }
  });
  test(`${kind} real submit retains an absent reference and uses a new company label only for another explicit ID or creation`, async () => {
    for (const contactId of ['unreadable-fictional','']) {
      const original = {id:`${kind}-absent`,...(contactId?{contactId}:{}),contactName:'  Valeur historique inconnue  ',amount:100};
      const h = submitBed(kind,original,contactId,[],true); await h.run();
      assert.equal(h.saved[0].contactName,original.contactName);
      assert.equal(h.saved[0].contactId,contactId);
    }
    for (const firstName of ['', 'Guillaume']) {
      const target = {...company,firstName};
      for (const original of [null,{id:`${kind}-change`,contactId:alice.id,contactName:'Dupont',amount:100}]) {
        const h = submitBed(kind,original,target.id,[alice,target],true); await h.run();
        assert.equal(h.saved[0].contactName,'Entreprise Exemple');
        assert.equal(h.saved[0].contactId,target.id);
        assert.equal(h.saved[0].contactPersonName,firstName);
      }
    }
    const homonym = {...alice,id:'fictional-homonym'};
    const h = submitBed(kind,{id:`${kind}-homonym`,contactId:alice.id,contactName:'Original'},homonym.id,[alice,homonym]); await h.run();
    assert.equal(h.saved[0].contactId,homonym.id);
    assert.equal(h.saved[0].contactName,'Alice Dupont');
  });
  test(`${kind} validation refusal leaves historical record untouched and emits no save`, async () => {
    const original = {id:`${kind}-refused`,contactId:alice.id,contactName:'  Historique exact  ',amount:100};
    const before = structuredClone(original),h = submitBed(kind,original,alice.id,[alice],true,'0');
    await h.run();assert.deepEqual(original,before);assert.equal(h.saved.length,0);assert.equal(h.alerts.length,1);
  });
}
