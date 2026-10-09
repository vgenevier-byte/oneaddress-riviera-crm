/** Isolated production handlers and rendered JSX. These stubs are not server/Auth proof. */
require('../i18n/register-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { WorkspaceSyncGuard, workspaceFingerprint } = require('../../lib/access/workspaceSync.ts');
const identity = require('../../lib/contactIdentity.ts');
const { mergeContactUpdate } = require('../../lib/contactEditing.ts');
const { translate } = require('../../lib/i18n/engine.ts');
const source = fs.readFileSync('components/CRMApp.tsx', 'utf8');
const ast = ts.createSourceFile('CRMApp.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  let found;
  function walk(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, walk); }
  walk(ast); assert(found, name); return found.getText(ast);
}
function compile(name, bindings = {}) {
  const js = ts.transpileModule(declaration(name), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  return new Function('require', 'exports', ...Object.keys(bindings), `${js}; return ${name};`)(require, {}, ...Object.values(bindings));
}
const normalize = compile('normalizeSharedCRMData', {
  mergeContactsWithLegacySuppliers: compile('mergeContactsWithLegacySuppliers', {supplierToContact: compile('supplierToContact')}),
  ...Object.fromEntries(['normalizeQuoteRequest','normalizeCRMDocument','normalizeVendorQuoteFinancials','normalizeVendorInvoice','normalizeHouseTrackingHouse','normalizeHouseTrackingWorker','normalizeHouseTimeEntry','normalizeHousePayment'].map(name => [name, value => value])),
});
const company = { id: 'company-fictional', entityType: 'company', companyName: 'Entreprise Exemple', name: '', firstName: 'Guillaume', kind: 'Client', email: '', phone: '', notes: 'Private note', createdAt: 'historic', historicalField: {id: 'retained'} };
const fields = new Set([...Object.keys(require('../../lib/access/collections.json').find(row => row.collection === 'contacts').fields), 'notes','preferences','importantNotes','supplierPriceNotes','supplierCommissionNotes']);
function bed(records = [company]) {
  let state = normalize({ contacts: structuredClone(records) }), database = structuredClone(state), revision = 'workspace-1', moduleRevision = 'module-1';
  const currentBusinessData = { current: state }, workspaceSync = { current: new WorkspaceSyncGuard() }, workspaceBusy = { current: false }, unconfirmedContact = { current: null };
  workspaceSync.current.load(state, revision);
  const calls = [], notices = [];
  let gate, fault, expectedReadError;
  const client = {
    async rpc(name, args) {
      calls.push({name,args:structuredClone(args)});
      if (name === 'crm_read_module') return {data:{revision:moduleRevision,collections:{contacts:structuredClone(database.contacts)}},error:null};
      assert.equal(name,'crm_mutate_record');
      if (gate) await gate;
      if (fault?.when === 'before') return {data:null,error:fault.error};
      const old = database.contacts.find(c => c.id === args.p_id);
      const row = {...old,...args.p_patch,id:args.p_id,updatedAt:'server-time',updatedBy:'server-actor'};
      database = {...database,contacts:args.p_delete ? database.contacts.filter(c => c.id !== args.p_id)
        : old ? database.contacts.map(c => c.id === args.p_id ? row : c) : [...database.contacts,row]};
      revision = 'workspace-2'; moduleRevision = 'module-2';
      if (fault?.when === 'after') throw fault.error;
      return {data:{revision:moduleRevision,collections:{contacts:structuredClone(database.contacts)}},error:null};
    },
    from(table) {
      assert.equal(table,'crm_workspace_state');
      let columns;
      const query = {select(value){columns=value;return query;},eq(){return query;},async single(){
        calls.push({name:'workspace-read',columns});
        if (expectedReadError && columns === 'updated_at') return {data:null,error:expectedReadError};
        return {data:columns === 'updated_at' ? {updated_at:revision} : {payload:structuredClone(database),updated_at:revision},error:null};
      }};
      return query;
    },
  };
  const bindings = {
    currentBusinessData, workspaceSync, workspaceBusy, unconfirmedContact, workspaceFingerprint,
    sharedWorkspaceReady:true, beginContactOperation:async()=>({client,run:async fn=>await fn(),check:async()=>{},signal:new AbortController().signal,token:'fictional'}),
    contactMutationFields:fields, normalizeSharedCRMData:normalize, SHARED_WORKSPACE_ID:'fictional-workspace',
    setData(fn){state=fn(state);currentBusinessData.current=state;},
    setAcceptedWorkspaceFingerprint(){},setSharedWorkspaceUpdatedAt(){},failedSaveFingerprint:{current:null},
    setSharedWorkspaceStatus(){},setSharedWorkspaceMessage(){},screenNotice:(key)=>({key}),
    showWorkspaceConflict(){workspaceSync.current.conflict();},setWorkspaceSyncEpoch(){},identityLifetime:{current:new AbortController()},
    isCancelled:e=>e?.name==='AbortError',...identity,mergeContactUpdate,notify:notice=>notices.push(notice),
  };
  const persist = compile('persistContactRecord',bindings);
  const update = compile('updateContact',{...bindings,persistContactRecord:persist});
  function add(form) {
    return compile('addContact',{...bindings,persistContactRecord:persist,FormData:class{constructor(){return form;}},
      makeId:()=>`draft-${calls.filter(c=>c.name==='crm_mutate_record').length}`,stampCreated:value=>({...value,createdBy:'client-actor'}),activeActor:'fictional-actor',
      readPostalAddress:()=>'',safeNumber:value=>Number(value)||0,getSupplierCategoryFromForm:()=>'',confirmDuplicateContact:()=>true,
    });
  }
  return {persist,update,add,calls,notices,workspaceSync,workspaceBusy,unconfirmedContact,
    get state(){return state;},get database(){return database;},
    stale(){revision='external-workspace-change';},gate(value){gate=value;},fault(value){fault=value;},
    editOther(){state={...state,leads:[{id:'draft-lead',notes:'newer business edit'}]};currentBusinessData.current=state;},
    expectedReadError(value){expectedReadError=value;},
  };
}

test('owner waits for confirmed RPC + global reread; sends module MD5, strips audit fields, retains private scalar', async()=>{
  const h=bed();let release;h.gate(new Promise(resolve=>{release=resolve;}));
  const initial=structuredClone(h.state), pending=h.update({id:company.id,notes:'New private note',createdBy:'must-not-send'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(h.state,initial);assert.equal(h.notices.length,0);assert.equal(h.workspaceBusy.current,true);
  const mutation=h.calls.find(c=>c.name==='crm_mutate_record');
  assert.equal(mutation.args.p_revision,'module-1');assert.equal(mutation.args.p_expected_revision,undefined);
  assert.deepEqual(mutation.args.p_patch,{notes:'New private note'});
  release();assert.equal((await pending).ok,true);
  assert.equal(h.state.contacts[0].name,'');assert.equal(h.state.contacts[0].entityType,'company');
  assert.equal(h.state.contacts[0].notes,'New private note');assert.deepEqual(h.state.contacts[0].historicalField,company.historicalField);
  assert.equal(h.notices.length,1);assert.equal(h.workspaceSync.current.dirty(h.state),false);
  assert.deepEqual(h.calls.filter(c=>c.name==='workspace-read').map(c=>c.columns),['updated_at','payload, updated_at']);
});

test('obsolete owner workspace conflicts before any mutation; original draft and record are retained',async()=>{
  const h=bed(),before=structuredClone(h.state);h.stale();
  const result=await h.update({id:company.id,companyName:'Obsolete edited title'});
  assert.equal(result.ok,false);assert.match(result.message,/Conflit/);assert.deepEqual(h.state,before);
  assert.equal(h.calls.filter(c=>c.name==='crm_mutate_record').length,0);assert.equal(h.notices.length,0);assert.equal(h.workspaceSync.current.conflicted,true);
});

test('unconfirmed committed creation retains draft ID; retry cannot make a second record or adopt a fresh CAS',async()=>{
  const h=bed([]),form=new FormData();form.set('entityType','company');form.set('companyName','Company with Guillaume');form.set('firstName','Guillaume');
  const element={dataset:{}},event={preventDefault(){},currentTarget:element},add=h.add(form);
  h.fault({when:'after',error:new Error('lost response secret=hidden')});
  const result=await add(event);assert.equal(result.ok,false);assert.doesNotMatch(result.message,/secret|lost response/);
  assert.equal(element.dataset.contactDraftId,'draft-0');assert.equal(h.state.contacts.length,0);assert.equal(h.database.contacts.length,1);
  assert.equal(h.database.contacts[0].name,'');assert.equal(h.database.contacts[0].firstName,'Guillaume');
  h.fault(null);const retry=await add(event);assert.equal(retry.ok,false);assert.match(retry.message,/Conflit/);
  assert.equal(element.dataset.contactDraftId,'draft-0');assert.equal(h.database.contacts.length,1);
  assert.equal(h.calls.filter(c=>c.name==='crm_mutate_record').length,1);assert.equal(h.notices.length,0);
});

test('server identity reasons remain exact known codes; permission rejection and unknown interruption stay distinct and safe',async()=>{
  for(const code of ['contact_name_required','contact_company_name_required','contact_entity_type_invalid']){
    const h=bed(),before=structuredClone(h.state);h.fault({when:'before',error:{code:'22023',message:code}});
    const result=await h.persist(company.id,{phone:'fictional'});assert.equal(result.message,code);assert.equal(result.ok,false);assert.deepEqual(h.state,before);assert.equal(h.workspaceSync.current.conflicted,false);
  }
  const denied=bed();denied.fault({when:'before',error:{code:'42501',message:'private permission details'}});
  assert.match((await denied.persist(company.id,{phone:'fictional'})).message,/Enregistrement refusé/);assert.equal(denied.workspaceSync.current.conflicted,false);
  const unknown=bed();unknown.fault({when:'after',error:new Error('token-private@example.invalid')});
  const result=await unknown.persist(company.id,{phone:'fictional'});assert.match(result.message,/non confirmé/);assert.doesNotMatch(result.message,/token|private@/);
  assert.equal(unknown.workspaceSync.current.conflicted,true);
});

test('parallel submission is refused; unrelated newer business data survives the confirmed contact result',async()=>{
  const h=bed();let release;h.gate(new Promise(resolve=>{release=resolve;}));
  const first=h.persist(company.id,{companyName:'Confirmed company'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await h.persist(company.id,{companyName:'Must not send'})).ok,false);
  h.editOther();release();assert.equal((await first).ok,true);
  assert.equal(h.calls.filter(c=>c.name==='crm_mutate_record').length,1);assert.equal(h.state.contacts[0].companyName,'Confirmed company');
  assert.equal(h.state.leads[0].notes,'newer business edit');assert.equal(h.workspaceSync.current.dirty(h.state),true);
});

test('company deletion uses guarded Contacts RPC and only removes the confirmed ID',async()=>{
  const h=bed([company,{...company,id:'other-company',companyName:'Other company'}]);
  assert.equal((await h.persist(company.id,{},true)).ok,true);
  const request=h.calls.find(c=>c.name==='crm_mutate_record').args;
  assert.equal(request.p_delete,true);assert.equal(request.p_id,company.id);assert.deepEqual(request.p_patch,{});
  assert.deepEqual(h.state.contacts.map(c=>c.id),['other-company']);
});

test('actual identity JSX renders all fields, localized required identity and safe field errors in both languages',()=>{
  for(const language of ['fr','en']){
    const t=(key,vars)=>translate(key,language,vars);
    const Component=compile('ContactIdentityFields',{useI18n:()=>({t}),BusinessLabel:({children,...props})=>React.createElement('label',props,children)});
    for(const entityType of ['person','company','']){
      const markup=renderToStaticMarkup(React.createElement(Component,{contact:{...company,entityType:entityType||undefined},entityType,onEntityTypeChange(){},issue:null,onIssue(){},prefix:'contact-edit'}));
      for(const field of ['entityType','companyName','civility','firstName','name'])assert.equal((markup.match(new RegExp(`name="${field}"`,'g'))||[]).length,1);
      assert.equal(/required=""/.test((markup.match(/<input[^>]*name="name"[^>]*>/)||[])[0]||''),entityType==='person');
      assert.equal(/required=""/.test((markup.match(/<input[^>]*name="companyName"[^>]*>/)||[])[0]||''),entityType==='company');
      assert(markup.includes(t(entityType==='company'?'crm.contacts.identity.companyNameRequired':'crm.contacts.identity.companyAffiliationOptional')));
    }
    for(const code of ['contact_name_required','contact_company_name_required','contact_entity_type_invalid']){
      const issue=identity.getContactIdentityValidationError(code);
      const markup=renderToStaticMarkup(React.createElement(Component,{entityType:'company',onEntityTypeChange(){},issue,onIssue(){},prefix:'contact-create'}));
      assert(markup.includes(t(`crm.contacts.validation.${code}`)));assert.match(markup,/role="alert"/);assert.match(markup,/aria-invalid="true"/);
      assert(markup.includes(`aria-describedby="contact-create-${issue.field}-error"`));assert(!markup.includes(`>${code}<`));
    }
  }
});

test('active generic CSV identity column displays explicit company; legacy/person and raw family name stay unchanged',()=>{
  let csv;
  const exported=compile('exportCRMAsCsv',{getContactLabel:identity.getContactLabel,getContactClientLevel:()=>'',getContactPreferredLanguage:()=>'',getContactRelationshipStatus:()=>'',
    toCsv:compile('toCsv',{csvEscape:compile('csvEscape')}),downloadTextFile:(_name,text)=>{csv=text;}});
  const person={...company,id:'person',entityType:'person',name:'Raw family name',companyName:'Person affiliation'};
  const legacy={...company,id:'legacy',entityType:undefined,name:'Legacy family',companyName:'Legacy affiliation'};
  const before=structuredClone([company,person,legacy]);exported({contacts:before,leads:[],properties:[],vehicles:[],boats:[],tasks:[],planningEntries:[]});
  assert.match(csv,/Nom,Type,Niveau client,Langue,Relation,Email/);assert.match(csv,/\nEntreprise Exemple,Client,/);
  assert.match(csv,/\nRaw family name,Client,/);assert.match(csv,/\nLegacy family,Client,/);
  assert.deepEqual(before,[company,person,legacy]);assert.equal(before[0].name,'');
});


test('distinct empty-surname companies do not trigger a false duplicate confirmation',()=>{
  let confirmations=0;
  const confirm=compile('confirmDuplicateContactIn',{normalizeDuplicateKey:compile('normalizeDuplicateKey'),defaultCRMTranslate:()=>'',displayValue:String,getContactLabel:identity.getContactLabel,window:{confirm(){confirmations++;return false;}}});
  const first={...company,id:'first-company',email:'',name:''},second={...company,id:'second-company',email:'',name:'',companyName:'Distinct company'};
  assert.equal(confirm([first],second),true);assert.equal(confirmations,0);
});

function compileBank(name,bindings){
  const bankSource=fs.readFileSync('components/VendorBanking.tsx','utf8');
  const bankAst=ts.createSourceFile('VendorBanking.tsx',bankSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let component,fn;
  function walk(node,visit){visit(node);ts.forEachChild(node,child=>walk(child,visit));}
  walk(bankAst,node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text==='VendorBankAccounts')component=node;});
  walk(component,node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text===name)fn=node;});
  const js=ts.transpileModule(fn.getText(bankAst),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return new Function(...Object.keys(bindings),`${js}; return ${name};`)(...Object.values(bindings));
}

test('owner banking callback waits for confirmation; rejection retains the actual existing dialog draft',async()=>{
  const bank=require('../../lib/vendorBanking.ts');
  const account=require('../fixtures/vendorBanking.ts').fictionalAccount;
  const form=new FormData();form.set('holder',account.accountHolder);form.set('bic',account.bic);form.set('bank',account.bankName||'');
  let closed=0,cleared=0,error='',sends=0,release;
  const saving={current:false};
  const submit=compileBank('submit',{
    saving,setError:value=>{error=value;},setBusy(){},FormData:class{constructor(){return form;}},
    crypto:{randomUUID:()=> 'bank-draft-fictional'},iban:account.iban,normalizeIban:bank.normalizeIban,normalizeBic:bank.normalizeBic,
    actor:'fictional actor',accounts:[],contact:company,addVendorBankAccount:bank.addVendorBankAccount,File:class{},fetchDriveAPI(){throw Error('No external IO authorised in isolated test');},
    onUpdate:async()=>{sends++;return new Promise(resolve=>{release=resolve;});},setAdding:()=>{closed++;},setIban:()=>{cleared++;},
  });
  const event={preventDefault(){},currentTarget:{}};
  const pending=submit(event);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(saving.current,true);assert.equal(closed,0);assert.equal(cleared,0);
  await submit(event);assert.equal(sends,1);
  release({ok:false,message:'Enregistrement non confirmé. Votre saisie est conservée ; vérifiez la connexion et vos droits.'});await pending;
  assert.equal(closed,0);assert.equal(cleared,0);assert.match(error,/non confirmé/);assert.equal(saving.current,false);
  const successful=submit(event);await new Promise(resolve=>setImmediate(resolve));release({ok:true});await successful;
  assert.equal(closed,1);assert.equal(cleared,1);assert.equal(sends,2);
});


test('banking operation cannot send a stale captured payload after a delayed identity check and newer confirmed autosave',async()=>{
  const original=normalize({contacts:[company],leads:[{id:'existing-lead',notes:'before'}]}),currentBusinessData={current:original};
  const guard=new WorkspaceSyncGuard();guard.load(original,'revision-before');
  let release,writes=0;
  const persist=compile('persistOwnerContactBankAccounts',{
    currentBusinessData,sharedWorkspaceReady:true,workspaceBusy:{current:false},workspaceSync:{current:guard},workspaceFingerprint,
    beginContactOperation:()=>new Promise(resolve=>{release=()=>resolve({signal:new AbortController().signal,token:'fictional',check:async()=>{}});}),
    writeSharedWorkspace:async()=>{writes++;return true;},stampUpdated:value=>value,mergeContactUpdate,activeActor:'fictional',setData(){},
    isCancelled:()=>false,identityLifetime:{current:new AbortController()},showWorkspaceConflict(){},setWorkspaceSyncEpoch(){},
  });
  const pending=persist(company.id,[]);await new Promise(resolve=>setImmediate(resolve));
  const newer={...original,leads:[{id:'existing-lead',notes:'newer confirmed edit'}]};
  currentBusinessData.current=newer;guard.load(newer,'revision-newer');release();
  const result=await pending;assert.equal(result.ok,false);assert.match(result.message,/Conflit/);assert.equal(writes,0);
  assert.deepEqual(currentBusinessData.current,newer);assert.equal(guard.prepare(newer).revision,'revision-newer');
});

function contactsNode() {
  return ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='ContactsView');
}
function compileContactsText(text,bindings) {
  const js=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return new Function(...Object.keys(bindings),`${js}; return handler;`)(...Object.values(bindings));
}
function contactSubmitText(mode){
  const scope=contactsNode();let found;
  function walk(node){
    if(mode==='edit'&&ts.isFunctionDeclaration(node)&&node.name?.text==='submitEdit')found=`${node.getText(ast)}; const handler=submitEdit;`;
    if(mode==='create'&&ts.isJsxOpeningElement(node)&&node.tagName.getText(ast)==='BusinessForm'){
      const props=node.attributes.properties;
      if(props.some(p=>ts.isJsxAttribute(p)&&p.name.text==='className'&&p.initializer?.text==='form-grid contact-create-form')){
        const submit=props.find(p=>ts.isJsxAttribute(p)&&p.name.text==='onSubmit');found=`const handler=${submit.initializer.expression.getText(ast)};`;
      }
    }
    ts.forEachChild(node,walk);
  }
  walk(scope);assert(found,mode);return found;
}

test('both actual Contacts submissions reaffirm owner navigation draft synchronously and clear it only after ordinary confirmation',async()=>{
  for(const mode of ['create','edit'])for(const outcome of ['clientValidation','serverValidation','unconfirmed','confirmed','newerDraft']){
    const form=new FormData();form.set('entityType','company');form.set('companyName',outcome==='clientValidation'?' \t ':'Company draft');form.set('kind','Client');form.set('notes','New note');
    const dirty=[],resets=[],saved=[],errors=[];let pending;
    const result=outcome==='serverValidation'?{ok:false,message:'contact_company_name_required'}:outcome==='unconfirmed'?{ok:false,message:'Enregistrement non confirmé. Votre saisie est conservée ; vérifiez la connexion et vos droits.'}:{ok:true,recordId:company.id};
    const confirmation={submit(_element,save,confirmed){pending=(async()=>{const answer=await save();if(answer?.ok)confirmed(outcome==='newerDraft',answer);})();return pending;}};
    const element={dataset:{contactDraftId:'same-draft'},reset(){resets.push('reset');},querySelector(){return {focus(){}};}};
    const handler=compileContactsText(contactSubmitText(mode),{
      onDraftStateChange:value=>dirty.push(value),FormData:class{constructor(){return form;}},...identity,
      setCreationIdentityError:value=>errors.push(value),setEditingIdentityError:value=>errors.push(value),
      creation:confirmation,edition:confirmation,onAdd:async()=>result,onUpdate:async()=>result,
      setCreationRecordId(){},setNewContactKind(){},editingContact:company,contacts:[company],
      normalizeKind:()=> 'Client',safeNumber:()=>0,readPostalAddress:()=>'',getContactClientLevel:()=> 'Standard',getContactPreferredLanguage:()=> 'Français',getContactRelationshipStatus:()=> 'Prospect',
      getSupplierCategoryFromForm:()=>'',changedContactFields:{current:new Set(outcome==='clientValidation'?['companyName']:['notes'])},
      getContactFormUpdate:require('../../lib/contactEditing.ts').getContactFormUpdate,mergeContactUpdate,
      setEditingContact:value=>saved.push(value),setSelectedContact(){},
    });
    handler({preventDefault(){},currentTarget:element});
    assert.equal(dirty[0],true,`${mode}/${outcome}: dirty restored immediately after parent capture`);
    if(pending)await pending;
    assert.deepEqual(dirty,outcome==='confirmed'?[true,false]:outcome==='newerDraft'?[true,true]:[true],`${mode}/${outcome}`);
    assert.equal(resets.length,mode==='create'&&outcome==='confirmed'?1:0);
    assert.equal(saved.length,mode==='edit'&&outcome==='confirmed'?1:0);
    if(outcome==='clientValidation')assert.equal(errors.at(-1).code,'contact_company_name_required');
  }
  const owner=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='CRMApp');
  // This prop belongs only to the full owner instance, leaving other views' navigation contract intact.
  assert.equal((source.match(/<ContactsView onDraftStateChange=\{setFormDirty\}/g)||[]).length,1);
  assert(owner,'Owner shell exists');
});

test('both Contacts confirmation hooks retain the owner draft and the existing limited dirty callback',()=>{
  const scope=contactsNode();let retain;
  function walk(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='retainContactDraft')retain=node.getText(ast);ts.forEachChild(node,walk);}
  walk(scope);let ownerDirty=0,limitedDirty=0;
  const handler=compileContactsText(`${retain}; const handler=retainContactDraft;`,{business:{markDirty(){limitedDirty++;}},onDraftStateChange(value){assert.equal(value,true);ownerDirty++;}});
  handler();assert.equal(ownerDirty,1);assert.equal(limitedDirty,1);
  assert.equal((scope.getText(ast).match(/useConfirmedForm\(retainContactDraft\)/g)||[]).length,2);
});
