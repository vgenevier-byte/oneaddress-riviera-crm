require('./register-typescript.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {translate,translateLabel}=require('../../lib/i18n/engine.ts');

// Deliberately restricted to the five screens named in the targeted review.
// Canonical option values, event handlers and save payloads are outside this
// display-only check; the existing preservation tests cover those boundaries.
const reviewedScreens=[
  'HouseWorkerEditor.tsx',
  'VendorBanking.tsx',
  'monthlyCharges/MonthlyChargesWorkspace.tsx',
  'izord/IzordGenerator.tsx',
  'CRMApp.tsx'
];
const parse=(file,text=fs.readFileSync(path.join(__dirname,'../../components',file),'utf8'))=>ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function nodes(source,predicate){const found=[];function walk(node){if(predicate(node))found.push(node);ts.forEachChild(node,walk);}walk(source);return found;}
const unwrap=node=>ts.isParenthesizedExpression(node)?unwrap(node.expression):node;
function rawDynamicCaptions(source){
  const found=new Map();
  function caption(node,dynamic=false){
    if(!node)return;node=unwrap(node);
    if(ts.isConditionalExpression(node)){caption(node.whenTrue,true);caption(node.whenFalse,true);return;}
    if(ts.isBinaryExpression(node)){
      const operator=node.operatorToken.kind;
      if([ts.SyntaxKind.QuestionQuestionToken,ts.SyntaxKind.BarBarToken,ts.SyntaxKind.AmpersandAmpersandToken,ts.SyntaxKind.PlusToken].includes(operator)){
        const branch=dynamic||operator!==ts.SyntaxKind.PlusToken;
        if(operator!==ts.SyntaxKind.AmpersandAmpersandToken)caption(node.left,branch);
        caption(node.right,branch);
      }
      return;
    }
    if(dynamic&&ts.isStringLiteral(node)&&/\p{L}/u.test(node.text))found.set(node.pos,node.text);
    if(dynamic&&ts.isTemplateExpression(node)){
      for(const literal of [node.head,...node.templateSpans.map(span=>span.literal)])if(/\p{L}/u.test(literal.text))found.set(literal.pos,literal.text);
      for(const span of node.templateSpans)caption(span.expression,true);
    }
  }
  for(const expression of nodes(source,ts.isJsxExpression)){
    const attribute=expression.parent;
    if(ts.isJsxAttribute(attribute)&&!['placeholder','aria-label','title','alt','label'].includes(attribute.name.getText(source)))continue;
    caption(expression.expression);
  }
  return [...found].map(([position,text])=>({line:source.getLineAndCharacterOfPosition(position).line+1,text}));
}
function keyOf(node){assert.ok(ts.isCallExpression(node)&&node.expression.getText()==='t','Rendered branch must call the catalogue');assert.ok(ts.isStringLiteral(node.arguments[0]));return node.arguments[0].text;}

test('focused caption check detects conditional, nested fallback and template literals',()=>{
  const source=parse('review-sample.tsx',`<>
    <span>{saving ? "Enregistrement…" : t("save")}</span>
    <span>{month ?? (rows.length ? rows.join(", ") : "À rattacher")}</span>
    <span>{busy && (retry ? \`Sauvegarde \${count}\` : "En attente")}</span>
    <select value={status || "En cours"} onChange={()=>setError("Erreur canonique")} />
    <span>{status === "En cours" ? t("progress") : t("todo")}</span>
  </>`);
  assert.deepEqual(rawDynamicCaptions(source).map(item=>item.text),['Enregistrement…','À rattacher','Sauvegarde ','En attente']);
});

test('the five reviewed screens have no raw caption in rendered conditional/fallback branches',()=>{
  const found=reviewedScreens.flatMap(file=>rawDynamicCaptions(parse(file)).map(item=>({file,...item})));
  assert.deepEqual(found,[]);
});

test('house-worker and banking pending buttons use the existing FR/EN saving message',()=>{
  for(const [file,condition,ready] of [
    ['HouseWorkerEditor.tsx','confirmation.saving','modules.tasksWorkspace.save'],
    ['VendorBanking.tsx','busy','modules.vendorBanking.saveBankDetails']
  ]){
    const source=parse(file);
    const branches=nodes(source,node=>ts.isConditionalExpression(node)&&node.condition.getText(source)===condition&&ts.isJsxExpression(node.parent));
    assert.equal(branches.length,1,file+' pending display');
    const pending=keyOf(branches[0].whenTrue);
    assert.equal(pending,'charges.enregistrement_e7d5f2');
    assert.equal(keyOf(branches[0].whenFalse),ready);
    assert.equal(translate(pending,'fr'),'Enregistrement…');assert.equal(translate(pending,'en'),'Saving…');
    const buttons=nodes(source,node=>ts.isJsxOpeningElement(node)&&['button','BusinessButton'].includes(node.tagName.getText(source))&&node.attributes.properties.some(attribute=>ts.isJsxAttribute(attribute)&&attribute.name.getText(source)==='disabled'&&attribute.initializer?.getText(source)==='{'+condition+'}'));
    assert.ok(buttons.length>0,file+' keeps the existing pending lock');
  }
});

test('monthly-charge allocation keeps canonical months and translates only the empty fallback',()=>{
  const source=parse('monthlyCharges/MonthlyChargesWorkspace.tsx');
  const branches=nodes(source,node=>ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.QuestionQuestionToken&&node.left.getText(source)==='allocation?.month');
  assert.equal(branches.length,1);
  const fallback=unwrap(branches[0].right);assert.ok(ts.isConditionalExpression(fallback));
  assert.equal(fallback.condition.getText(source),'entry.allocations.length');
  assert.equal(fallback.whenTrue.getText(source),'entry.allocations.map(row => row.month).join(", ")');
  assert.equal(keyOf(fallback.whenFalse),'charges.chooseMonth');
  assert.equal(translate('charges.chooseMonth','fr'),'À rattacher');assert.equal(translate('charges.chooseMonth','en'),'Unallocated');
});

test('IZORD version-history status is a localized enum caption while history identity stays exact',()=>{
  const source=parse('izord/IzordGenerator.tsx');
  const labels=nodes(source,node=>ts.isVariableDeclaration(node)&&node.name.getText(source)==='statusLabels');assert.equal(labels.length,1);
  const canonical=Object.fromEntries(labels[0].initializer.properties.map(property=>[property.name.getText(source),property.initializer.text]));
  assert.deepEqual(canonical,{draft:'Brouillon',review:'En revue',approved:'Approuvé'});
  const history=nodes(source,node=>ts.isElementAccessExpression(node)&&node.expression.getText(source)==='statusLabels'&&node.argumentExpression.getText(source)==='version.status');assert.equal(history.length,1);
  const call=history[0].parent;assert.ok(ts.isCallExpression(call));assert.equal(call.expression.getText(source),'displayLabel');assert.equal(call.arguments[1].text,'izord');
  for(const [status,fr,en] of [['draft','Brouillon','Draft'],['review','En revue','Under review'],['approved','Approuvé','Approved']]){
    assert.equal(translateLabel(canonical[status],'fr','izord'),fr);assert.equal(translateLabel(canonical[status],'en','izord'),en);
  }
  assert.equal(nodes(source,node=>ts.isJsxExpression(node)&&node.expression?.getText(source)==='version.author_id').length,1,'Historical author remains raw business identity');
  assert.equal(nodes(source,node=>ts.isJsxAttribute(node)&&node.name.getText(source)==='key'&&node.initializer?.getText(source)==='{version.revision}').length,1,'Historical revision remains the stable key');
});

test('Contacts list and detail render a complete contextual plural instead of a translated suffix',()=>{
  const source=parse('CRMApp.tsx');
  const calls=nodes(source,node=>ts.isCallExpression(node)&&node.expression.getText(source)==='t'&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text==='crm.contacts.linkedEnquiries');
  assert.equal(calls.length,2,'Both Contacts list and detail use the contextual plural');
  for(const call of calls){const count=call.arguments[1]?.properties.find(property=>property.name.getText(source)==='count');assert.ok(count&&/^getContactLeads\((?:contact|selectedContact)\)\.length$/.test(count.initializer.getText(source)),'Count is the unchanged associated enquiry collection length');}
  const orphanedSuffixes=nodes(source,node=>ts.isCallExpression(node)&&node.expression.getText(source)==='t'&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text==='crm.contacts.e3456bc1f4');
  assert.equal(orphanedSuffixes.length,0,'The old isolated lead caption is not concatenated with a suffix');
  for(const count of [0,1,2])assert.equal(translate('crm.contacts.linkedEnquiries','en',{count}),`${count} linked client ${count===1?'enquiry':'enquiries'}`);
});
