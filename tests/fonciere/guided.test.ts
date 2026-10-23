import assert from "node:assert/strict";
import { test } from "node:test";
import { createFonciereData, validateFonciereData, toPresentationData, fromPresentationData, FONCIERE_FIELDS } from "../../lib/fonciere/model";
import { changeGuidedPropertyType, currentGuidedValue, deriveGuidedProperty, readGuidedField, setGuidedField, reconfirmGuidedField, parseGuidedNumber, toggleGuidedMulti, validateGuidedProperty, guidedReadableFields, formatGuidedValue, isGuidedFieldApplicable } from "../../lib/fonciere/guided";
import { applyAgencyImport, proposeAgencyImport } from "../../lib/fonciere/import";
import { calculate } from "../../lib/izord/finance";

const property = () => { const d=createFonciereData(); d.name="Projet fictif"; return d; };
test("guided French numbers retain empty, explicit zero and reject narratives",()=>{
  assert.equal(parseGuidedNumber("1 250 000 €"),1250000); assert.equal(parseGuidedNumber("1\u202f250,75 €"),1250.75); assert.equal(parseGuidedNumber(""),null); assert.equal(parseGuidedNumber("0"),0); assert.throws(()=>parseGuidedNumber("environ 1M"));
  let d=property(); d.area="12"; d=setGuidedField(d,"area",null); assert.equal(readGuidedField(d,"area"),null); d=setGuidedField(d,"area",0); assert.equal(readGuidedField(d,"area"),0); assert.equal(d.area,"12");
});
test("historical geographic values remain valid but never become active or readable business fields",()=>{
  const d=property(); d.guided.values.coordinates={latitude:43.7,longitude:7.26}; d.guided.details.coordinates="Position historique";
  const original=structuredClone(d.guided);
  assert.deepEqual(validateFonciereData(JSON.parse(JSON.stringify(d))).guided,original);
  assert.deepEqual(readGuidedField(d,"coordinates"),original.values.coordinates);
  assert.equal(currentGuidedValue(d,"coordinates"),undefined);
  assert.equal(isGuidedFieldApplicable("coordinates","villa"),false);
  for (const lang of ["fr","en"] as const) {
    assert.equal(formatGuidedValue("coordinates",original.values.coordinates,lang),"");
    assert.equal(guidedReadableFields(d,lang).coordinates,"");
  }
  const changed=changeGuidedPropertyType(d,"apartment");
  assert.deepEqual(changed.guided.values.coordinates,original.values.coordinates);
  assert.deepEqual(changed.guided.inactive,original.inactive);
  d.guided.inactive=["coordinates"];
  assert.deepEqual(validateFonciereData(d).guided.inactive,["coordinates"]);
  assert.throws(()=>setGuidedField(d,"coordinates",{latitude:91}),/Nombre/);
});
test("only exact reliable source text is adapted; unknown, negated and hypothetical claims stay unchanged",()=>{
  const d=property(); Object.assign(d,{propertyType:"Villa",rooms:"35",bedrooms:"12",area:"130,5 m²",pool:"Piscine possible sous réserve d’autorisation",view:"Vue mer à confirmer",equipment:"Sans climatisation ; ascenseur envisagé",diagnostics:"DPE : C; GES : B",fees:"Honoraires inclus, charge vendeur 5%"});
  const g=deriveGuidedProperty(d); assert.equal(g.values.propertyType,"villa"); assert.equal(g.values.rooms,35); assert.equal(g.values.bedrooms,12); assert.equal(g.values.area,130.5); assert.equal(g.values.pool,undefined); assert.equal(g.values.view,undefined); assert.equal(g.values.equipment,undefined); assert.deepEqual(g.values.diagnostics,[{code:"dpe",status:"available",grade:"C"},{code:"ges",status:"available",grade:"B"}]); assert.equal((g.values.fees as {inclusion:string}).inclusion,"included");
  const p=toPresentationData(d); assert.equal(p.state.sea,"À confirmer"); assert.match(String(p.state.features),/Piscine possible/);
});
test("negative pool, no selection and not applicable remain distinct",()=>{
  const d=property(); d.pool="Non"; assert.equal(readGuidedField(d,"pool"),"absent"); assert.equal(readGuidedField(property(),"pool"),undefined);
  assert.deepEqual(toggleGuidedMulti(["heating"],"none"),["none"]); assert.deepEqual(toggleGuidedMulti(["none"],"heating"),["heating"]);
  assert.throws(()=>setGuidedField(d,"equipment",["none","heating"]),/exclusif/); assert.doesNotThrow(()=>setGuidedField(d,"equipment",["not_applicable"]));
});
test("type transitions preserve incompatible values and require revalidation before export",()=>{
  let d=property(); d=setGuidedField(d,"propertyType","villa"); d=setGuidedField(d,"bedrooms",8); d=setGuidedField(d,"land",1700); d=setGuidedField(d,"pool","planned");
  d=changeGuidedPropertyType(d,"land"); assert.equal(readGuidedField(d,"bedrooms"),8); assert.equal(currentGuidedValue(d,"bedrooms"),undefined); assert.equal(toPresentationData(d).state.features.includes("chambres"),false);
  d=changeGuidedPropertyType(d,"villa"); assert.equal(currentGuidedValue(d,"bedrooms"),undefined); d=reconfirmGuidedField(d,"bedrooms"); assert.equal(currentGuidedValue(d,"bedrooms"),8);
  assert.match(String(toPresentationData(d).state.features),/8 chambres/); assert.ok(d.guided.inactive.includes("pool"));
});
test("legacy odd strings and long content survive a plain save and presentation round trip",()=>{
  const d=property(); for (const key of FONCIERE_FIELDS) if (!["agentContactId","agencyContactId","name"].includes(key)) d[key]=`  Ancien ${key} : peut-être NON ; € 0 / texte atypique\n🧾  `;
  const saved=validateFonciereData(JSON.parse(JSON.stringify(d))); for (const key of FONCIERE_FIELDS) assert.equal(saved[key],d[key]);
  const snapshot=toPresentationData(saved); const back=fromPresentationData(snapshot); for (const key of FONCIERE_FIELDS) assert.equal(back[key],d[key]);
});
test("structured fees never add a second acquisition cost or alter the asking price",()=>{
  let d=property(); d=setGuidedField(d,"askingPrice",1250000); d=setGuidedField(d,"fees",{inclusion:"included",payer:"seller",amount:62500,percent:5});
  const p=toPresentationData(d); assert.equal(p.state.asking,"1250000"); assert.match(String(p.state.agencyFee),/Inclus dans le prix/); assert.match(String(p.state.agencyFee),/62[\s\u202f]500/); assert.equal(p.state.otherCosts,""); assert.equal(p.state.acq,"");
  const finance=calculate({...p.state,acq:"1250000",works:"0",resale:"1500000",notaryQuote:"",notaryRate:"0"}); assert.equal(finance.total,1250000);
});
test("rental units never silently become monthly or imply an occupancy count",()=>{
  for (const [period,monthly,weekly] of [["night","",""],["week","","3400"],["month","3400",""],["year","",""]] as const) {
    let d=property(); d=setGuidedField(d,"rentalHypothesis",{mode:"seasonal",amount:3400,period,comment:"Hypothèse personnelle"}); const p=toPresentationData(d); assert.equal(p.state.monthly,monthly); assert.equal(p.state.weekly,weekly); assert.equal(p.state.weeks,""); assert.equal(p.state.rentedMonths,""); assert.match(String(p.state.decisionNotes),/Hypothèse personnelle/);
  }
  const legacy=property(); legacy.rentalHypothesis="3 400 €/semaine"; assert.equal(toPresentationData(legacy).state.weekly,"3400"); legacy.rentalHypothesis="3400"; assert.equal(toPresentationData(legacy).state.monthly,"");
});
test("checklists never become verified by import and diagnostics validate rating/state/source",()=>{
  const d=property(); d.pointsToVerify="Urbanisme vérifié d’après vendeur ?"; assert.equal(readGuidedField(d,"pointsToVerify"),undefined);
  assert.throws(()=>setGuidedField(d,"diagnostics",[{code:"dpe",status:"in_progress",grade:"A"}]),/Classe/);
  assert.throws(()=>setGuidedField(d,"pointsToVerify",[{code:"planning",status:"unknown"}]),/État/);
  const checked=setGuidedField(d,"pointsToVerify",[{code:"planning",status:"to_verify",detail:"Vérifier le PLU"}]); assert.match(guidedReadableFields(checked).pointsToVerify,/À vérifier/);
});
test("only selected reimport fields change, preserving guided manual corrections, hypotheses and raw evidence",()=>{
  let d=property(); d.area="130 m²"; d=setGuidedField(d,"area",133); d=setGuidedField(d,"rentalHypothesis",{amount:1800,period:"month"});
  let incoming=property(); incoming.area="130 m²"; incoming.askingPrice="1 400 000 €"; incoming.guided=deriveGuidedProperty(incoming); incoming=setGuidedField(incoming,"area",135);
  assert.ok(proposeAgencyImport(d,incoming).some(x=>x.key==="area")); let result=applyAgencyImport(d,incoming,["askingPrice"]); assert.equal(readGuidedField(result,"area"),133); assert.equal(readGuidedField(result,"askingPrice"),1400000); assert.equal((readGuidedField(result,"rentalHypothesis") as {amount:number}).amount,1800);
  result=applyAgencyImport(result,incoming,["area"]); assert.equal(readGuidedField(result,"area"),135); assert.equal(result.area,"130 m²");
});
test("schema rejects forged identities, unknown fields, invalid counts and prototype keys",()=>{
  assert.throws(()=>validateGuidedProperty({version:1,values:{agentContactId:"secret"}}),/inconnu/); assert.throws(()=>setGuidedField(property(),"rooms",2.5),/Nombre/); assert.throws(()=>setGuidedField(property(),"area",-1),/Nombre/);
  const d=property(); (d.contactSources as unknown)={agent:{baseline:{agentContactId:"secret"}}}; assert.throws(()=>validateFonciereData(d),/Coordonnée/);
});
test("structured snapshot is independent, readable and excludes both contact identities",()=>{
  let d=property(); d.agentContactId="private-person-id"; d.agencyContactId="private-company-id"; d=setGuidedField(d,"propertyType","apartment"); d=setGuidedField(d,"floor",6); d=setGuidedField(d,"equipment",["lift"]);
  const p=toPresentationData(d,{id:"12345678-1234-4234-8234-123456789012",revision:1}); const snapshot=JSON.stringify(p.importMeta?.fonciereSnapshot); assert.ok(!snapshot.includes("private-person-id")); assert.ok(!snapshot.includes("private-company-id")); assert.match(String(p.state.features),/Ascenseur/);
  d=setGuidedField(d,"floor",8); assert.equal((fromPresentationData(p).guided.values).floor,6); assert.equal(p.importMeta?.fonciereSource && (p.importMeta.fonciereSource as {revision:number}).revision,1);
});

test("hidden dependent details never become current after clearing the parent selection",()=>{
  let d=property(); d=setGuidedField(d,"annexes",["garage"]); d=setGuidedField(d,"annexCount",3); d=setGuidedField(d,"pool","private"); d=setGuidedField(d,"poolDetails",{heating:"yes"});
  d=setGuidedField(d,"annexes",["none"]); d=setGuidedField(d,"pool","absent"); assert.equal(currentGuidedValue(d,"annexCount"),undefined); assert.equal(currentGuidedValue(d,"poolDetails"),undefined); assert.equal(readGuidedField(d,"annexCount"),3); assert.equal(guidedReadableFields(d).poolDetails,"");
});
test("a selected import type transition also retains prior fields inactive",()=>{
  let current=property(); current=setGuidedField(current,"propertyType","villa"); current=setGuidedField(current,"bedrooms",9); const incoming=property(); incoming.propertyType="Terrain"; const next=applyAgencyImport(current,incoming,["propertyType"]); assert.equal(readGuidedField(next,"propertyType"),"land"); assert.equal(readGuidedField(next,"bedrooms"),9); assert.ok(next.guided.inactive.includes("bedrooms"));
});
test("edited presentation assumptions update structured amounts and preserve unrelated source text",()=>{
  let d=property(); d.description="Texte source intact"; d.resaleHypothesis="1 900 000 €"; d=setGuidedField(d,"area",120); const p=toPresentationData(d); p.state.resale="2100000"; const back=fromPresentationData(p); assert.equal((readGuidedField(back,"resaleHypothesis") as {amount:number}).amount,2100000); assert.equal(back.description,d.description); assert.equal(readGuidedField(back,"area"),120);
});

test("explicit source periods fill charges controls without inferring a period from an unknown amount",()=>{
  const d=property(); d.charges="1 200 €"; assert.equal(readGuidedField(d,"charges"),undefined); d.provenance=[{id:"known",importedAt:"2026-10-23",filename:"fictif.pdf",method:"text",warnings:[],fields:{charges:{page:1,extract:"Charges annuelles : 1 200 €"}}}]; assert.deepEqual(readGuidedField(d,"charges"),{amount:1200,period:"year"}); assert.equal(d.charges,"1 200 €");
  d.view="Vue mer : Partielle"; assert.deepEqual(readGuidedField(d,"view"),["sea"]); assert.equal(readGuidedField(d,"seaExtent"),"partial"); assert.equal(toPresentationData(d).state.sea,"Partielle"); d.pool="Piscine envisagée"; assert.equal(readGuidedField(d,"pool"),"planned"); assert.match(String(toPresentationData(d).state.features),/Envisagée dans le projet/);
});
