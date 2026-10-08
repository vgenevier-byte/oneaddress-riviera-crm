/** Focused review proof: production JSX rendered by ReactDOMServer, isolated real hook.
 * The hook/DOM harness is simulated; it never unlocks pending fields or saves remotely.
 */
require('./register-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const {translate} = require('../../lib/i18n/engine.ts');
const {crmMessages} = require('../../lib/i18n/catalogs/crm.ts');
const {modulesMessages} = require('../../lib/i18n/catalogs/modules.ts');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'components/CRMApp.tsx'), 'utf8');
const ast = ts.createSourceFile('CRMApp.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function walk(node, visit) { visit(node); ts.forEachChild(node, child => walk(child, visit)); }
function declaration(name, tree = ast) {
  let found;
  walk(tree, node => {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(tree) === name) found = node;
  });
  assert(found, `Production declaration ${name} exists`);
  return ts.isVariableDeclaration(found) ? `const ${found.getText(tree)};` : found.getText(tree);
}
function compile(text, globals) {
  const testModule = {exports: {}};
  const output = ts.transpileModule(text, {compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  vm.runInNewContext(output, {module: testModule, exports: testModule.exports, require, ...globals});
  return testModule.exports;
}
let language = 'fr';
const t = (key, variables) => translate(key, language, variables);
const production = compile([
  ...['screenNotice', 'knownCRMErrors', 'knownConfirmedFormMessages', 'confirmedFormNotice', 'ConfirmedFormMessage'].map(name => declaration(name)),
  'module.exports = {confirmedFormNotice, ConfirmedFormMessage};',
].join('\n'), {crmMessages, modulesMessages, useI18n: () => ({t})});
const newerDraft = modulesMessages['modules.common.newerDraftRetained'].fr;
const unconfirmed = modulesMessages['modules.common.saveUnconfirmedReview'].fr;
const renderNotice = (message, inline = false) => renderToStaticMarkup(React.createElement(production.ConfirmedFormMessage, {message, inline}));

test('known form outcomes retain success, validation, conflict and unconfirmed meanings in FR and EN', () => {
  const cases = [
    [newerDraft, 'modules.common.newerDraftRetained'],
    [unconfirmed, 'modules.common.saveUnconfirmedReview'],
    ['Indiquez un titre.', 'modules.common.enterATitle'],
    ['Saisissez un taux horaire valide, avec au maximum deux décimales (0 est accepté).', 'modules.houseWorkerEditor.enterAValidHourlyRateWithNoMoreThanTwoDecimalPlaces'],
    ['Enregistrement refusé. Vérifiez les champs et vos droits ; votre saisie est conservée.', 'modules.moduleWorkspace.saveRefusedCheckTheFieldsAndYourPermissionsYourInputIsRetained'],
    ['Conflit de révision. Votre saisie est conservée ; rechargez les données avant de reprendre.', 'crm.errors.revisionConflict'],
    ['Conflit : les données ont changé. Votre saisie est conservée ; rechargez avant de reprendre.', 'modules.moduleWorkspace.conflictTheDataHasChangedYourInputIsRetainedReloadBeforeContinuing'],
    ['Enregistrement interrompu : le compte ou les droits ont changé.', 'modules.moduleWorkspace.savingInterruptedTheAccountOrPermissionsHaveChanged'],
    ['Enregistrement non confirmé. Votre saisie est conservée ; vérifiez la connexion et vos droits.', 'modules.moduleWorkspace.saveUnconfirmedYourInputIsRetainedCheckTheConnectionAndYourPermissions'],
  ];
  for (const [message, key] of cases) {
    assert.equal(production.confirmedFormNotice(message).key, key);
    for (language of ['fr', 'en']) {
      const markup = renderNotice(message);
      assert(markup.includes(translate(key, language)), `${language}: ${key}`);
      assert.equal(markup.includes('role="status"'), message === newerDraft);
      assert.equal(markup.includes('role="alert"'), message !== newerDraft);
    }
  }
});

test('actual production message component reacts FR → EN → FR and hides arbitrary server content', () => {
  language = 'fr';
  assert.equal(renderNotice(newerDraft), `<p role="status">${newerDraft}</p>`);
  language = 'en';
  assert.equal(renderNotice(newerDraft), '<p role="status">The submitted version has been saved. Your newer input still needs to be saved.</p>');
  assert.equal(renderNotice(unconfirmed, true), '<span role="alert">Save unconfirmed. Your input is retained; review the data before retrying.</span>');
  language = 'fr';
  assert.equal(renderNotice(newerDraft), `<p role="status">${newerDraft}</p>`);
  assert.equal(renderNotice(''), '');
  for (const raw of ['secret_token=do-not-show private@example.invalid', `${newerDraft} secret_token=do-not-show`, `${unconfirmed} private@example.invalid`]) {
    assert.equal(production.confirmedFormNotice(raw).key, 'crm.errors.unknown');
    for (language of ['fr', 'en']) {
      const markup = renderNotice(raw);
      assert(markup.includes(translate('crm.errors.unknown', language)));
      assert.doesNotMatch(markup, /secret_token|do-not-show|private@example/);
    }
  }
});

test('all four real form renderers use the outcome component, preserving the inline house message', () => {
  const callers = [];
  walk(ast, node => {
    if (!ts.isJsxSelfClosingElement(node) || node.tagName.getText(ast) !== 'ConfirmedFormMessage') return;
    const message = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.text === 'message');
    callers.push({message: message.initializer.expression.getText(ast), inline: node.attributes.properties.some(attribute => attribute.name?.text === 'inline')});
  });
  assert.deepEqual(callers, [
    {message: 'confirmation.message', inline: false},
    {message: 'hourConfirmation.message', inline: true},
    {message: 'creation.message', inline: false},
    {message: 'edition.message', inline: false},
  ]);
  assert.doesNotMatch(source, /safeCRMError\((?:creation|edition|confirmation|hourConfirmation)\.message\)/);
});

test('the actual Contacts list and detail counter JSX render contextual 0/1/many plurals', () => {
  const counters = [];
  walk(ast, node => {
    if (!ts.isCallExpression(node) || node.expression.getText(ast) !== 't' || node.arguments[0]?.text !== 'crm.contacts.linkedEnquiries') return;
    let element = node.parent;
    while (element && !ts.isJsxElement(element)) element = element.parent;
    assert(element, 'Counter is inside rendered JSX');
    const Counter = compile(`function Counter({count}) {
      const contact = {}, selectedContact = contact;
      const getContactLeads = () => Array.from({length: count});
      const getContactClientLevel = () => 'Standard', getContactRelationshipStatus = () => 'Prospect';
      const label = value => value;
      return (${element.getText(ast)});
    } module.exports = Counter;`, {t});
    counters.push(Counter);
  });
  assert.equal(counters.length, 2, 'List and detail are both tested');
  const expected = {
    fr: ['0 demande client liée', '1 demande client liée', '2 demandes clients liées'],
    en: ['0 linked client enquiries', '1 linked client enquiry', '2 linked client enquiries'],
  };
  for (const Counter of counters) for (language of ['fr', 'en']) for (const count of [0, 1, 2]) {
    const markup = renderToStaticMarkup(React.createElement(Counter, {count}));
    assert(markup.includes(expected[language][count]), `${language} count=${count}: ${markup}`);
    assert.doesNotMatch(markup, /leades|\blead(?:s)?\b/);
  }
});

function isolatedHook() {
  let cursor = 0;
  const cells = [];
  const hooks = {
    useRef(value) { const index = cursor++; return cells[index] ||= {current: value}; },
    useState(value) { const index = cursor++; if (!(index in cells)) cells[index] = typeof value === 'function' ? value() : value; return [cells[index], next => { cells[index] = typeof next === 'function' ? next(cells[index]) : next; }]; },
    useEffect(effect) { cursor++; effect(); },
  };
  class Input { constructor() { this.name = 'name'; this.value = 'French draft — André'; this.checked = false; } }
  class TextArea {}
  class Select {}
  const hookSource = fs.readFileSync(path.join(root, 'lib/access/useConfirmedForm.ts'), 'utf8');
  const {useConfirmedForm} = compile(hookSource, {
    require: request => { assert.equal(request, 'react', 'Hook has no external dependency'); return hooks; },
    HTMLInputElement: Input, HTMLTextAreaElement: TextArea, HTMLSelectElement: Select,
  });
  const form = {elements: [new Input()], isConnected: true};
  const retained = [];
  const render = () => { cursor = 0; return useConfirmedForm(() => retained.push('retained')); };
  return {render, form, retained};
}

test('isolated production hook confirms the submitted version once; real pending fieldset stays locked', async () => {
  const harness = isolatedHook(), confirmed = [];
  let hook = harness.render(), finish, sends = 0;
  const submittedValue = harness.form.elements[0].value;
  const promise = hook.submit(harness.form, () => { sends++; return new Promise(resolve => { finish = resolve; }); }, (...args) => confirmed.push(args));
  hook = harness.render();
  assert.equal(hook.saving, true);

  const businessSource = fs.readFileSync(path.join(root, 'components/BusinessPermissions.tsx'), 'utf8');
  const businessAst = ts.createSourceFile('BusinessPermissions.tsx', businessSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const BusinessForm = compile(`${declaration('BusinessForm', businessAst)}; module.exports = BusinessForm;`, {useI18n: () => ({t}), useBusinessPermissions: () => ({write: true})});
  const pendingMarkup = renderToStaticMarkup(React.createElement(BusinessForm, {pending: hook.saving}, React.createElement('input', {name: 'name', defaultValue: submittedValue})));
  assert.match(pendingMarkup, /<fieldset[^>]*disabled=""/);

  // Programmatic version invalidation reproduces the hook branch in isolation.
  // No user edit is simulated, and no product or test fieldset is unlocked.
  hook.changed();
  finish({ok: true, recordId: 'fictional-record'});
  await promise;
  hook = harness.render();
  assert.equal(hook.saving, false);
  assert.equal(hook.message, newerDraft);
  assert.equal(confirmed.length, 1);
  assert.equal(confirmed[0][0], true);
  assert.equal(confirmed[0][1].recordId, 'fictional-record');
  assert.equal(harness.retained.length, 1);
  assert.equal(harness.form.elements[0].value, submittedValue);
  for (language of ['fr', 'en', 'fr']) assert.match(renderNotice(hook.message), /role="status"/);
  assert.equal(sends, 1, 'Rendering and language changes cause no new submission');
});

test('isolated production hook preserves known validation/conflict and safely reports a thrown error', async () => {
  for (const failure of [
    {ok: false, message: 'Indiquez un titre.'},
    {ok: false, message: 'Conflit : les données ont changé. Votre saisie est conservée ; rechargez avant de reprendre.'},
    {ok: false, message: 'Untrusted server payload: secret_token=do-not-show'},
    new Error('secret_token=do-not-show'),
  ]) {
    const harness = isolatedHook();
    let hook = harness.render(), sends = 0, confirmations = 0;
    await hook.submit(harness.form, () => { sends++; if (failure instanceof Error) throw failure; return failure; }, () => confirmations++);
    hook = harness.render();
    assert.equal(hook.message, failure instanceof Error ? unconfirmed : failure.message);
    assert.equal(hook.saving, false);
    assert.equal(confirmations, 0);
    for (language of ['fr', 'en', 'fr']) {
      const markup = renderNotice(hook.message);
      assert.match(markup, /role="alert"/);
      assert.doesNotMatch(markup, /secret_token|do-not-show|Untrusted/);
    }
    assert.equal(sends, 1);
  }
});
