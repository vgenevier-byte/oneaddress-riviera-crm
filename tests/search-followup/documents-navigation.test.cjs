/** Execute the production DocumentsView projection and JSX callbacks on fictional data.
 * These are isolated component regressions, without Auth, Drive, RPCs or server saves. */
require('../i18n/register-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const search = require('../../lib/search.ts');

const source = ts.createSourceFile('CRMApp.tsx', fs.readFileSync(path.join(__dirname, '../../components/CRMApp.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function nodes(root, predicate) {
  const found = [];
  function visit(node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(root);
  return found;
}
const documentsView = nodes(source, node => ts.isFunctionDeclaration(node) && node.name?.text === 'DocumentsView')[0];
assert.ok(documentsView, 'The actual DocumentsView is available');
function evaluate(code, result, bindings) {
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return ${result};`)(...Object.values(bindings));
}
function attribute(element, name) {
  return element.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(source) === name);
}
function expression(element, name) {
  const initializer = attribute(element, name)?.initializer;
  assert.ok(initializer && ts.isJsxExpression(initializer) && initializer.expression, `${name} has a production callback`);
  return initializer.expression.getText(source);
}
function handler(element, name, bindings) {
  return evaluate(`const callback = ${expression(element, name)};`, 'callback', bindings);
}
const openings = nodes(documentsView, node => ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node));
const folderPicker = openings.find(node => node.tagName.getText(source) === 'SearchableSelect' && expression(node, 'value') === 'currentFolderId');
const openButton = openings.find(node => node.tagName.getText(source) === 'button' && attribute(node, 'data-crm-auto-scroll'));
const breadcrumbs = nodes(documentsView, node => ts.isJsxElement(node)
  && attribute(node.openingElement, 'className')?.initializer?.text === 'document-breadcrumbs')[0];
assert.ok(breadcrumbs, 'Use the rendered breadcrumbs');
const breadcrumbButtons = nodes(breadcrumbs, node => ts.isJsxOpeningElement(node) && node.tagName.getText(source) === 'button');
assert.equal(breadcrumbButtons.length, 2, 'Root and each mapped folder have their own rendered callback');

// These are the actual production projection declarations, not a duplicate filter.
const projectionNames = ['documentSearchIndex', 'documentResults', 'folders', 'files', 'currentFolder', 'folderPath', 'visibleFolders', 'visibleDocuments'];
const projectionCode = projectionNames.map(name => {
  const declaration = documentsView.body.statements.flatMap(statement => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])
    .find(item => item.name.getText(source) === name);
  assert.ok(declaration, `Production projection ${name} is present`);
  return `const ${declaration.getText(source)};`;
}).join('\n');
const project = evaluate(`function project(documents, currentFolderId, documentSearch) { ${projectionCode}\n return {folderPath, visibleFolders, visibleDocuments}; }`, 'project', { ...search, useMemo: compute => compute() });

const fixture = Object.freeze([
  { id: 'folder-parent', title: 'Archives fictives', isFolder: true },
  { id: 'folder-target', title: 'Dossier cible fictif', folderId: 'folder-parent', isFolder: true },
  { id: 'folder-child', title: 'Sous-dossier fictif', parentFolderId: 'folder-target', isFolder: true },
  { id: 'file-target', title: 'Contenu cible fictif', folderId: 'folder-target', addedAt: '2026-10-22' },
  { id: 'file-parent', title: 'Contenu parent fictif', parentFolderId: 'folder-parent', addedAt: '2026-10-23' },
  { id: 'file-root', title: 'Contenu racine fictif', addedAt: '2026-10-24' },
].map(Object.freeze));
const ids = rows => rows.map(row => row.id);
function runtime(initialFolderId = '', initialSearch = 'Dossier cible') {
  const state = { folderId: initialFolderId, search: initialSearch };
  const helper = nodes(documentsView, node => ts.isFunctionDeclaration(node) && node.name?.text === 'navigateToFolder')[0];
  const setters = {
    setCurrentFolderId: value => { state.folderId = value; },
    setDocumentSearch: value => { state.search = value; },
  };
  const navigateToFolder = helper ? evaluate(helper.getText(source), 'navigateToFolder', setters) : undefined;
  return { state, ...setters, navigateToFolder, view: () => project(fixture, state.folderId, state.search) };
}

test('all four production folder controls use the central navigation function', () => {
  for (const [element, event] of [[openButton, 'onClick'], ...breadcrumbButtons.map(button => [button, 'onClick']), [folderPicker, 'onChange']]) {
    assert.ok(element, `${event} control exists`);
    assert.match(expression(element, event), /\bnavigateToFolder\(/);
  }
  const writes = nodes(documentsView, node => ts.isCallExpression(node) && node.expression.getText(source) === 'setCurrentFolderId');
  assert.equal(writes.length, 1, 'Folder state changes have a single entrypoint');
  let owner = writes[0];
  while (owner && !ts.isFunctionDeclaration(owner)) owner = owner.parent;
  assert.equal(owner?.name?.text, 'navigateToFolder');
});

test('search a folder, open it, then use parent and root breadcrumbs to show only each folder content', () => {
  const before = structuredClone(fixture);
  const run = runtime();
  assert.deepEqual(ids(run.view().visibleFolders), ['folder-target'], 'Nonempty search finds the nested folder globally');
  handler(openButton, 'onClick', { ...run, folder: fixture[1] })();
  assert.deepEqual(run.state, { folderId: 'folder-target', search: '' });
  assert.deepEqual(ids(run.view().visibleFolders), ['folder-child']);
  assert.deepEqual(ids(run.view().visibleDocuments), ['file-target']);
  assert.deepEqual(ids(run.view().folderPath), ['folder-parent', 'folder-target']);

  run.state.search = 'Contenu racine';
  handler(breadcrumbButtons[1], 'onClick', { ...run, folder: fixture[0] })();
  assert.deepEqual(run.state, { folderId: 'folder-parent', search: '' });
  assert.deepEqual(ids(run.view().visibleFolders), ['folder-target']);
  assert.deepEqual(ids(run.view().visibleDocuments), ['file-parent']);

  run.state.search = 'Contenu cible';
  handler(breadcrumbButtons[0], 'onClick', run)();
  assert.deepEqual(run.state, { folderId: '', search: '' });
  assert.deepEqual(ids(run.view().visibleFolders), ['folder-parent']);
  assert.deepEqual(ids(run.view().visibleDocuments), ['file-root']);
  assert.deepEqual(fixture, before, 'Navigation and search do not alter folder/file records or IDs');
});

test('the production folder selector clears global search for both a folder and the root', () => {
  const run = runtime('folder-parent', 'Contenu racine');
  const change = handler(folderPicker, 'onChange', run);
  change({ target: { value: 'folder-target' } });
  assert.deepEqual(run.state, { folderId: 'folder-target', search: '' });
  assert.deepEqual(ids(run.view().visibleDocuments), ['file-target']);
  run.state.search = 'Dossier cible';
  change({ target: { value: '' } });
  assert.deepEqual(run.state, { folderId: '', search: '' });
  assert.deepEqual(ids(run.view().visibleDocuments), ['file-root']);
});

test('search and navigation stay within the supplied authorized document projection', () => {
  const authorized = fixture.filter(row => row.id === 'folder-parent' || row.id === 'file-parent');
  const before = structuredClone(authorized);
  assert.deepEqual(ids(project(authorized, '', 'cible').visibleFolders), []);
  assert.deepEqual(ids(project(authorized, 'folder-parent', '').visibleDocuments), ['file-parent']);
  assert.deepEqual(ids(project(authorized, 'folder-target', '').visibleDocuments), []);
  assert.deepEqual(authorized, before);
});
