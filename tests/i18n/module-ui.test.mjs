import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {modulesMessages} from '../../lib/i18n/catalogs/modules.ts';
import {moduleMessage} from '../../lib/i18n/moduleMessage.ts';

const files=['ModuleWorkspace','TasksWorkspace','TaskContactPicker','ContactDocuments','ContactPostalAddress','GoogleDriveDiagnostic','HouseWorkerEditor','SearchableBusinessContactPicker','QuickRepliesView','VendorQuotesView','VendorBanking','VendorFinanceDialogs','ScopedBanking','ScopedDocuments','ScopedInvoicePayments','BusinessPermissions'];
const translate=(language)=>(key,vars={})=>{
  const message=modulesMessages[key]?.[language];
  assert.ok(message,`Missing ${language}:${key}`);
  const selected=typeof message==='string'?message:message[new Intl.PluralRules(language==='fr'?'fr-FR':'en-GB').select(Number(vars.count))==='one'?'one':'other'];
  return selected.replace(/\{(\w+)\}/g,(_,name)=>String(vars[name]));
};
const parse=(file)=>{const filename=new URL('../../components/'+file+'.tsx',import.meta.url);return ts.createSourceFile(file,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);};

test('module messages have paired languages, identical parameters and valid plurals',()=>{
  const variables=(text)=>[...text.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
  for(const[key,message]of Object.entries(modulesMessages)){
    assert.ok(message.fr&&message.en,key);
    for(const count of [0,1,2,15]){
      const pick=(language)=>typeof message[language]==='string'?message[language]:message[language][new Intl.PluralRules(language==='fr'?'fr-FR':'en-GB').select(count)==='one'?'one':'other'];
      assert.deepEqual(variables(pick('fr')),variables(pick('en')),key);
    }
  }
});

test('known errors and operation counts re-render in the chosen language and unknown payloads stay hidden',()=>{
  const fr=translate('fr'),en=translate('en');
  assert.equal(moduleMessage('Indiquez un titre.',en),'Enter a title.');
  assert.equal(moduleMessage('Indiquez un titre.',fr),'Indiquez un titre.');
  assert.equal(moduleMessage('2 fichiers confirmés · 1 échec à reprendre.',en),'2 files confirmed · 1 failure to retry.');
  assert.equal(moduleMessage('1 fichier confirmé.',en),'1 file confirmed.');
  for(const raw of ['secret_token=do-not-show', 'Enregistrement non confirmé. Votre saisie est conservée. secret_token=do-not-show','Export non confirmé. private-user@example.invalid']){
    assert.doesNotMatch(moduleMessage(raw,en),/do-not-show|private-user|secret_token/);
    assert.notEqual(moduleMessage(raw,fr),moduleMessage(raw,en));
  }
});

test('every translated module option explicitly preserves its canonical value',()=>{
  let count=0;
  for(const file of files){const source=parse(file);const visit=(node)=>{
    if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(source)==='option'){
      const displayed=node.children.map(child=>child.getText(source)).join('');
      if(/\b(t|uiLabel)\(/.test(displayed)){
        count++;
        assert.ok(node.openingElement.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(source)==='value'),`${file}: ${displayed}`);
      }
    }
    ts.forEachChild(node,visit);
  };visit(source);}
  assert.ok(count>=15,`Expected translated options, found ${count}`);
});

test('literal module catalogue references resolve and raw visible captions are exhausted',()=>{
  const missed=[];
  for(const file of files){const source=parse(file);const visit=(node)=>{
    if(ts.isCallExpression(node)&&node.expression.getText(source)==='t'&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text.startsWith('modules.'))assert.ok(modulesMessages[node.arguments[0].text],`${file}: ${node.arguments[0].text}`);
    if(ts.isJsxText(node)&&/\p{L}/u.test(node.text))missed.push(`${file}: ${node.text.trim()}`);
    if(ts.isJsxAttribute(node)&&["placeholder","aria-label","title","label"].includes(node.name.getText(source))&&node.initializer&&ts.isJsxExpression(node.initializer)&&node.initializer.expression&&ts.isStringLiteral(node.initializer.expression)&&/\p{L}/u.test(node.initializer.expression.text))missed.push(`${file}: ${node.getText(source)}`);
    ts.forEachChild(node,visit);
  };visit(source);}
  assert.deepEqual(missed,[]);
});
