/** Actual production panel/selector callbacks on fictitious records. This is
 * isolated UI-contract evidence; the browser suite owns real DOM/Auth/RPC proof. */
require('./i18n/register-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { createRequire } = require('node:module');
const NativeFormData = global.FormData;
const root = path.resolve(__dirname, '..');

function hookRuntime() {
 const values = []; let cursor = 0;
 const slot = init => { const index=cursor++; if (!(index in values)) values[index]=init(); return index; };
 return {
  begin(){cursor=0;},
  hooks:{
   useState(initial){const index=slot(()=>typeof initial==='function'?initial():initial);return [values[index],next=>{values[index]=typeof next==='function'?next(values[index]):next;}];},
   useRef(initial){return values[slot(()=>({current:initial}))];},
   useMemo(compute){return compute();},useCallback(callback){return callback;},
   useEffect(){},useLayoutEffect(effect){effect();},
   useId(){return values[slot(()=>`selector-${values.length}`)];},
   useImperativeHandle(ref,create){if(ref)ref.current=create();}
  }
 };
}

const i18n = {language:'fr',locale:'fr-FR',formatDate:value=>value};
function loadProduction(relativeFile, runtime, extra = {}) {
 const filename=path.join(root,relativeFile), fromFile=createRequire(filename), exports={};
 const SearchableSelect=function SharedPickerMarker(){}, BusinessForm=function BusinessFormMarker(){}, BusinessButton=function BusinessButtonMarker(){};
 const customRequire=name=>{
  if(name==='react')return {...React,...runtime.hooks};
  if(name.endsWith('.module.css'))return new Proxy({}, {get:(_target,key)=>String(key)});
  if(name==='@/lib/i18n/I18nProvider')return {useI18n:()=>i18n};
  if(name==='./BusinessPermissions')return {BusinessForm,BusinessButton,useBusinessPermissions:()=>null};
  if(name.includes('SearchableSelect'))return {__esModule:true,default:SearchableSelect,SearchableSelect};
  if(name==='./useSearchDismissal')return {useSearchDismissal:()=>()=>{}};
  return fromFile(name);
 };
 const js=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const additions=relativeFile.endsWith('HousePrepaidPanel.tsx')?'\nexports.Purchase=HousePrepaidPurchase;exports.InvoiceLink=HousePrepaidInvoiceLink;exports.Settings=HousePrepaidSettings;':'';
 const FormData=class{constructor(form){return form?.businessData??new NativeFormData();}};
 new Function('require','exports','FormData',...Object.keys(extra),js+additions)(customRequire,exports,FormData,...Object.values(extra));
 return {...exports,SearchableSelect,BusinessForm,BusinessButton};
}

function all(node,predicate){const out=[];React.Children.forEach(node,child=>{if(!React.isValidElement(child))return;if(predicate(child))out.push(child);out.push(...all(child.props.children,predicate));});return out;}
const text=node=>React.Children.toArray(node).map(child=>typeof child==='string'||typeof child==='number'?String(child):React.isValidElement(child)?text(child.props.children):'').join('');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function businessData(values){const data=new NativeFormData();for(const [key,value] of Object.entries(values))data.set(key,value);return {businessData:data};}

function fixture() {
 const worker={id:'worker-example',contactId:'contact-example',contactName:'José Exemple',role:'Cours',status:'Actif',hourlyRate:16.5,billingMode:'prepaid',createdAt:'2026-10-01'};
 return {worker,workers:[worker],contacts:[{id:'contact-example',firstName:'José',name:'Exemple',email:'jose@example.invalid',phone:'0612345678',city:'Cannes',companyName:'École Exemple'}],
  state:{revision:'ledger-example',workspaceRevision:'2026-10-26',complete:true,canContribute:true,settings:[{workerId:worker.id,billingMode:'prepaid',defaultMinutes:1800,defaultPriceCents:50000}],packages:[],allocations:[],summaries:[{workerId:worker.id,purchasedMinutes:0,performedMinutes:0,coveredMinutes:0,availableMinutes:0,uncoveredMinutes:0,paidCents:0}]},
  houses:[{id:'house-a',name:'Villa École',address:'10 chemin des Pins Cannes'},{id:'house-b',name:'Villa École',address:'20 avenue du Port Nice'}],
  payments:[{id:'payment-a',workerId:worker.id,date:'2026-10-05',amount:500,method:'Virement',note:'Premier règlement'},{id:'payment-b',workerId:worker.id,date:'2026-10-06',amount:500,method:'CB',note:'Autre règlement'}],
  invoices:[{id:'invoice-a',contactId:'contact-example',invoiceReference:'FAC-A',title:'Cours exemple',amount:500,status:'À payer'},{id:'invoice-b',contactId:'contact-example',invoiceReference:'FAC-B',title:'Cours exemple',amount:500,status:'À payer'}]};
}

function purchase(save) {
 const runtime=hookRuntime(), production=loadProduction('components/HousePrepaidPanel.tsx',runtime), props={...fixture(),onSave:save};
 const render=()=>{runtime.begin();return production.Purchase(props);};
 let view=render();all(view,element=>element.type===production.BusinessButton&&text(element.props.children)==='Enregistrer un forfait payé')[0].props.onClick();
 view=render();
 const form=()=>all(render(),element=>element.type===production.BusinessForm)[0];
 const source=all(view,element=>element.type==='select'&&element.props.name==='source')[0];
 assert.ok(source,'Payment source remains the existing finite enum');
 source.props.onChange({target:{value:'new'},currentTarget:{value:'new'}});
 const target=businessData({capacityMinutes:'1800',price:'500',source:'new',houseId:'house-a',date:'2026-11-01',method:'Virement',note:'Paiement fictif',confirmed:'on',invoiceId:''});
 return {production,props,render,form,target,submit(){form().props.onSubmit({preventDefault(){},currentTarget:target});},
  query(){form().props.onChange?.({currentTarget:target,target:{type:'search',name:'',value:'vila ecole'}});},
  sameChoice(){form().props.onChange?.({currentTarget:target,target:{tagName:'SELECT',type:'select-one',name:'houseId',value:target.businessData.get('houseId')}});}
 };
}

test('production shared selector typing never changes canonical form value; only explicit result does',()=>{
 const runtime=hookRuntime(), production=loadProduction('components/search/SearchableSelect.tsx',runtime), events=[],changes=[];
 const props={name:'paymentId',defaultValue:'payment-a',onChange:event=>changes.push(event.currentTarget.value),children:[
  React.createElement('option',{key:'a',value:'payment-a','data-search':'José Cannes 500 virement'},'Paiement exemple'),
  React.createElement('option',{key:'b',value:'payment-b','data-search':'José Nice 500 carte'},'Paiement exemple') ]};
 const render=()=>{runtime.begin();return production.default.render(props,null);};
 let view=render(), native=all(view,x=>x.type==='select')[0];
 const nativeValue={value:native.props.value,dispatchEvent:event=>{events.push(event.type);if(event.type==='change')native.props.onChange({currentTarget:nativeValue,target:nativeValue});}};
 native.props.ref.current=nativeValue;
 let query=all(view,x=>x.type==='input'&&x.props.role==='combobox')[0];
 assert.equal(query.props.name,undefined,'The visible query is not a successful business field');
 query.props.onChange({currentTarget:{value:'jose nice'}});view=render();native=all(view,x=>x.type==='select')[0];
 assert.equal(native.props.value,'payment-a');assert.equal(native.props.name,'paymentId');assert.deepEqual(changes,[]);
 query=all(view,x=>x.type==='input'&&x.props.role==='combobox')[0];query.props.onKeyDown({key:'Enter',nativeEvent:{isComposing:false},preventDefault(){},stopPropagation(){}});
 assert.equal(nativeValue.value,'payment-a');assert.deepEqual(changes,[]);
 const option=all(view,x=>x.props.role==='option'&&text(x.props.children).includes('Paiement exemple'))[0];assert.ok(option);
 option.props.onClick();assert.equal(nativeValue.value,'payment-b');assert.deepEqual(events,['input','change']);assert.deepEqual(changes,['payment-b']);
});

test('failed new-payment save retains both retry IDs through query typing and same-ID re-selection',async()=>{
 const calls=[], run=purchase(async(...args)=>{calls.push(args);throw new Error('confirmation_missing');});
 run.submit();await tick();assert.equal(calls.length,1);const first=structuredClone(calls[0]);
 run.target.businessData.set('price','500,00');run.target.businessData.set('note','  Paiement fictif  ');
 run.query();run.sameChoice();run.submit();await tick();assert.equal(calls.length,2);
 assert.equal(calls[1][1],first[1],'Unchanged business payload reuses its idempotency key');
 assert.equal(calls[1][3].payment.id,first[3].payment.id,'Unchanged business payload reuses its canonical new payment ID');
 assert.deepEqual(calls[1][3],first[3]);
 run.target.businessData.set('houseId','house-b');run.submit();await tick();assert.equal(calls.length,3);
 assert.notEqual(calls[2][1],first[1]);assert.notEqual(calls[2][3].payment.id,first[3].payment.id);assert.equal(calls[2][3].payment.houseId,'house-b');
});

test('pending production purchase blocks double submission and preserves the draft after refusal',async()=>{
 const calls=[];let reject;
 const run=purchase((...args)=>{calls.push(args);return new Promise((_resolve,no)=>{reject=no;});});
 const before=[...run.target.businessData.entries()];run.submit();run.submit();assert.equal(calls.length,1);assert.equal(run.form().props.pending,true);
 reject(new Error('server_refused'));await tick();assert.equal(run.form().props.pending,false);assert.deepEqual([...run.target.businessData.entries()],before);
 run.submit();assert.equal(calls.length,2);assert.equal(calls[1][1],calls[0][1]);reject(new Error('server_refused_again'));await tick();
});

test('invoice linking retry ignores typed text and same canonical invoice but changes key for another submitted invoice',async()=>{
 const runtime=hookRuntime(), production=loadProduction('components/HousePrepaidPanel.tsx',runtime), calls=[], f=fixture();
 const props={...f,packageId:'package-example',priceCents:50000,onSave:async(...args)=>{calls.push(args);throw new Error('confirmation_missing');}};
 const render=()=>{runtime.begin();return production.InvoiceLink(props);};
 const target=businessData({invoiceId:'invoice-a'}), form=()=>all(render(),x=>x.type===production.BusinessForm)[0];
 const submit=()=>form().props.onSubmit({preventDefault(){},currentTarget:target});
 submit();await tick();assert.equal(calls.length,1);
 form().props.onChange?.({currentTarget:target,target:{name:'',type:'search',value:'fac'}});
 form().props.onChange?.({currentTarget:target,target:{name:'invoiceId',type:'select-one',value:'invoice-a'}});
 submit();await tick();assert.equal(calls[1][1],calls[0][1]);assert.deepEqual(calls[1][3],calls[0][3]);
 target.businessData.set('invoiceId','invoice-b');submit();await tick();assert.notEqual(calls[2][1],calls[0][1]);assert.equal(calls[2][3].invoiceId,'invoice-b');
});

test('record pickers reuse the shared control while fixed business enums stay native',()=>{
 const source=fs.readFileSync(path.join(root,'components/HousePrepaidPanel.tsx'),'utf8');
 const ast=ts.createSourceFile('HousePrepaidPanel.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX), recordPickers=[], nativeEnums=[];
 function visit(node){if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)){
  const tag=node.tagName.getText(ast), name=node.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText(ast)==='name')?.initializer?.text;
  if(tag==='SearchableSelect')recordPickers.push(name??'worker');if(tag==='select')nativeEnums.push(name);
 }ts.forEachChild(node,visit);}visit(ast);
 assert.equal(recordPickers.length,5,'Only the five requested record selectors change');
 assert.equal(recordPickers.filter(name=>name==='invoiceId').length,2);assert.ok(recordPickers.includes('paymentId'));assert.ok(recordPickers.includes('houseId'));
 assert.deepEqual(nativeEnums.sort(),['billingMode','method','source'].sort());
});

test('production settings pending callback disables the external worker picker until save settles',async()=>{
 const parentRuntime=hookRuntime(), panel=loadProduction('components/HousePrepaidPanel.tsx',parentRuntime), f=fixture();
 let reject;const pendingChanges=[];
 const props={...f,showSettings:true,workerFilter:'Tous',error:'',onRefresh(){},onSave:()=>new Promise((_yes,no)=>{reject=no;})};
 const renderParent=()=>{parentRuntime.begin();return panel.default(props);};
 const childProps=all(renderParent(),x=>typeof x.type==='function'&&x.type.name==='HousePrepaidSettings')[0].props;
 const originalPending=childProps.onPendingChange;
 const runtime=hookRuntime(), settings=loadProduction('components/HousePrepaidPanel.tsx',runtime);
 const renderChild=()=>{runtime.begin();return settings.Settings({...childProps,onPendingChange:value=>{pendingChanges.push(value);originalPending(value);}});};
 const picker=()=>all(renderParent(),x=>x.type===panel.SearchableSelect)[0];
 assert.equal(picker().props.disabled,false);
 all(renderChild(),x=>x.type===settings.BusinessForm)[0].props.onSubmit({preventDefault(){},currentTarget:businessData({})});
 assert.equal(picker().props.disabled,true);assert.deepEqual(pendingChanges,[true]);
 reject(new Error('not_confirmed'));await tick();assert.equal(picker().props.disabled,false);assert.deepEqual(pendingChanges,[true,false]);
});
