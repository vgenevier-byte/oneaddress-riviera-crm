const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),postcss=require('postcss');
const source=fs.readFileSync(path.join(__dirname,'../../components/CRMApp.tsx'),'utf8');
const ast=ts.createSourceFile('CRMApp.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const contacts=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='ContactsView');
const css=fs.readFileSync(path.join(__dirname,'../../app/globals.css'),'utf8');
const start='/* === CONTACTS STABLE READABLE LAYOUT START === */',end='/* === CONTACTS STABLE READABLE LAYOUT END === */';
const block=postcss.parse(css.slice(css.indexOf(start),css.indexOf(end)+end.length));
const stylesheet=postcss.parse(css);
function nodes(root,predicate){const found=[];function walk(node){if(predicate(node))found.push(node);ts.forEachChild(node,walk);}walk(root);return found;}
const attributes=node=>Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(attribute=>[attribute.name.getText(ast),attribute.initializer]));
const literal=value=>value&&ts.isStringLiteral(value)?value.text:undefined;
function rule(selector){const found=[];block.walkRules(candidate=>{if(candidate.selectors.includes(selector))found.push(candidate);});assert.ok(found.length,selector);return Object.fromEntries(found.flatMap(candidate=>candidate.nodes.filter(node=>node.type==='decl').map(node=>[node.prop,{value:node.value,important:Boolean(node.important)}])));}
const scope='main:has(.contacts-workspace[data-crm-module="contacts"])';
const button='[data-crm-module="contacts"] .contact-form-submit';

test('the shared ContactsView root has one mounted module marker without a language key',()=>{
  assert.ok(contacts);
  const marked=nodes(ast,node=>ts.isJsxOpeningElement(node)&&literal(attributes(node)['data-crm-module'])==='contacts');
  assert.equal(marked.length,1);
  assert.ok(marked[0].pos>contacts.pos&&marked[0].end<contacts.end,'Full and limited paths share the marker inside ContactsView');
  assert.equal(literal(attributes(marked[0]).className),'stack contacts-workspace oar-contacts-workspace');
  assert.equal(attributes(marked[0]).key,undefined,'Language changes keep the same mounted module');
});

test('only the two Contacts form submissions use button styling and retain write/pending protections',()=>{
  const buttons=nodes(ast,node=>ts.isJsxOpeningElement(node)&&literal(attributes(node).className)?.split(/\s+/).includes('contact-form-submit'));
  assert.equal(buttons.length,2);
  for(const node of buttons){
    assert.ok(node.pos>contacts.pos&&node.end<contacts.end);
    assert.equal(node.tagName.getText(ast),'BusinessButton');
    assert.equal(literal(attributes(node).className),'primary-button contact-form-submit');
    assert.equal(literal(attributes(node).permission),'write');assert.equal(literal(attributes(node).type),'submit');
  }
  assert.equal(nodes(contacts,node=>ts.isJsxAttribute(node)&&node.name.getText(ast)==='className'&&literal(node.initializer)?.includes('planning-entry-submit')).length,0,'Contacts submissions do not match Planning card rules');
  const forms=nodes(contacts,node=>ts.isJsxOpeningElement(node)&&node.tagName.getText(ast)==='BusinessForm');
  assert.deepEqual(forms.map(node=>[literal(attributes(node).className),attributes(node).pending?.getText(ast)]),[['form-grid contact-create-form','{creation.saving}'],['form-grid contact-edit-form','{edition.saving}']]);
  assert.ok(nodes(ast,node=>ts.isJsxAttribute(node)&&node.name.getText(ast)==='className'&&literal(node.initializer)?.includes('planning-entry-submit')).length>0,'Other modules retain their existing Planning class');
});

test('Contacts selectors use stable module identity and keep the reference form breakpoint',()=>{
  stylesheet.walkRules(candidate=>assert.doesNotMatch(candidate.selector,/placeholder\s*=/,'CSS scope cannot depend on translated text'));
  block.walkRules(candidate=>{for(const selector of candidate.selectors)assert.ok(selector.includes('[data-crm-module="contacts"]'),selector+' remains scoped to Contacts');});
  assert.equal(rule(scope+' form')['min-width'].value,'320px');
  let desktop;
  block.walkAtRules('media',media=>{if(media.params==='(min-width: 1180px)')desktop=media;});assert.ok(desktop,'Existing reference breakpoint retained');
  let form;desktop.walkRules(candidate=>{if(candidate.selector===scope+' form')form=candidate;});assert.ok(form);
  assert.equal(form.nodes.find(node=>node.prop==='max-width').value,'420px');
  assert.equal(rule(scope+' [class*="contact"] button')['min-height'].value,'38px');
});

test('Contacts submit normal/hover/focus/pending styles keep readable primary colors and button layout',()=>{
  const normal=rule(button);assert.equal(normal.display.value,'inline-flex');assert.equal(normal.height.value,'auto');assert.equal(normal['min-height'].value,'38px');assert.equal(normal['box-shadow'].value,'none');
  for(const selector of [button,button+':hover',button+':focus-visible']){
    const state=rule(selector);assert.deepEqual(state.color,{value:'#fffaf2',important:true});assert.deepEqual(state.background,{value:'var(--crm-navy)',important:true});
  }
  const focused=rule(button+':focus-visible');assert.equal(focused.outline.value,'2px solid var(--crm-gold)');assert.equal(focused['outline-offset'].value,'3px');
  const pending=rule(button+':disabled');assert.equal(pending.opacity.value,'.75');assert.equal(pending.cursor.value,'not-allowed');assert.equal(pending.transform.value,'none');assert.equal(pending.filter.value,'none');
});
