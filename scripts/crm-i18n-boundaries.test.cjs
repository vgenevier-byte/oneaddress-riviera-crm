const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const ts = require('typescript');
const source = fs.readFileSync('components/CRMApp.tsx', 'utf8');
const ast = ts.createSourceFile('CRMApp.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const catalogSource = fs.readFileSync('lib/i18n/catalogs/crm.ts', 'utf8');
const catalogue = JSON.parse(catalogSource.slice(catalogSource.indexOf('= ') + 2).trim().replace(/;$/, ''));
const baseline = {
  "safeNumber": "376cb995b96800fd641ce0a33db902817dc9538b9a237b4ccb4cc77537b61832",
  "csvEscape": "861a9dd30dbde5a478d23d4c71d4f477a5bb7dad96d2c26902224cbe2bb81808",
  "toCsv": "82fd6e342bd13272e046150813b1d3b4087cca1ad25d7edd430d452b1bb46d52",
  "downloadTextFile": "1f989e34a8b5dfc984f53b049238883bd896e39d18123ac586599a6425f3ce68",
  "exportCRMAsCsv": "a5488cdb3456de69cc03586f91dedbb486337a0368c6094bdccf998ff7b373fd",
  "parseAssetKey": "814b06bc507c2258cd7ca7f4b6665818dc339cf2edbdd5c4ceb326dee08db270",
  "getLeadStatusFromQuoteStatus": "2c6fd71ce03a91da779610edffeaa1a3c28f9cc808c6828e381893f0e4cc0fc3",
  "readQuoteNumber": "0276d2da079b801e4c4ee3149a6113310845341ab3311393945543a57e2d92f8",
  "formatQuoteDate": "bfbd6932913ca98e39875f4ee77ba5cbdbcefa5fb49e5079a561d2d99f470653",
  "formatQuoteLongDate": "05007a23485348f73ff0aed78db286fcafa090c86d8bebe67228dea5992f2574",
  "formatQuotePrice": "a1652d83fe5d39bedea25e71e42235c897257888c89dd9459f12737301135f12",
  "getQuoteBillingQuantity": "382782dbc748ab4682edc3853a63fe002b6adacc90bd81bf65756f7e763b0f3f",
  "getQuoteItems": "1894b1848b5f0756e2d16d9c49e839918bba44e239d44def0d0c3949cc6b9a72",
  "getQuoteLineSubtotal": "c5a488465b1e7026eb3407f37f8938d70a07ebdacfeded9b6f9fe407f15ec8df",
  "getQuoteSubtotal": "98b933b96790fbfc4ec47cb2d30c7fa4ff6135eb1ddc6c56ddba4d521d575be5",
  "getQuoteDepositTotal": "950dc55af61dc91470cb6c0ab69181d0d7295484058f5cb929e1bc775cb993a8",
  "getQuoteTotal": "9281af3eed07db021e170f1532034c84f50a7e8e933761bdbd1efaacc1fbe34d",
  "openQuotePdf": "52f11ea385ca42d3f09039308ffc037376d45edc296386301972da7961134ec3",
  "exportHouseCsv": "f365c47a1b64965e7492e9068a7ecc281e8d718886286604089a0973e6497606"
};
function walk(node, action) { action(node); ts.forEachChild(node, child => walk(child, action)); }
test('existing export generators and canonical calculation helpers match deployed baseline byte for byte', () => {
  const found = new Set();
  walk(ast, node => { if (ts.isFunctionDeclaration(node) && node.name && baseline[node.name.text]) {
    const name = node.name.text; found.add(name);
    assert.equal(crypto.createHash('sha256').update(node.getText(ast)).digest('hex'), baseline[name], name);
  }});
  assert.equal(found.size, Object.keys(baseline).length);
});
test('every native option has an explicit canonical value', () => {
  let count = 0;
  walk(ast, node => { if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === 'option') {
    count++; assert(node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === 'value'), `option at ${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}`);
  }});
  assert(count > 100);
});
test('translated labels never feed native form values or field identities', () => {
  walk(ast, node => { if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ['input', 'select', 'option', 'textarea', 'BusinessSelect'].includes(node.tagName.getText(ast))) {
    for (const attribute of node.attributes.properties) if (ts.isJsxAttribute(attribute) && ['value','defaultValue','name','id'].includes(attribute.name.getText(ast))) {
      walk(attribute, child => { if (ts.isCallExpression(child)) assert(!['t','label','screen.category','screen.enum'].includes(child.expression.getText(ast)), attribute.getText(ast)); });
    }
  }});
});
test('dashboard permission gates and auto-scroll use explicit canonical identities', () => {
  assert(!source.includes('moduleByCaption'));
  assert(!source.includes('modules[eyebrow]'));
  assert(!source.includes('button.textContent'));
  let tiles = 0, cards = 0;
  walk(ast, node => { if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'DashboardQuickTile') { tiles++; assert(node.attributes.properties.some(a => ts.isJsxAttribute(a) && a.name.getText(ast) === 'moduleId')); }
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === 'DashboardCommandCard') { cards++; assert(node.attributes.properties.some(a => ts.isJsxAttribute(a) && a.name.getText(ast) === 'moduleIds')); }
  });
  assert.equal(tiles, 4); assert.equal(cards, 8);
});
test('catalogue is complete in FR and EN with matching interpolation parameters', () => {
  const parameters = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [key, message] of Object.entries(catalogue)) {
    assert(message.fr && message.en, key);
    const fr = typeof message.fr === 'string' ? [message.fr] : [message.fr.one, message.fr.other];
    const en = typeof message.en === 'string' ? [message.en] : [message.en.one, message.en.other];
    assert.equal(fr.length, en.length, key);
    fr.forEach((text, index) => assert.deepEqual(parameters(text), parameters(en[index]), key));
  }
  assert(Object.keys(catalogue).length > 1000);
});
test('canonical application status and category arrays are preserved', () => {
  const expected = {
    leadStatuses: ['Nouveau','Contacté','Devis','Négociation','Gagné','Perdu'],
    propertyStatuses: ['Disponible','Mandat en cours','Loué','Vendu'],
    vehicleStatuses: ['Disponible','En location','En maintenance','Vendu'],
    boatStatuses: ['Disponible','En charter','En maintenance','Vendu'],
    contactKinds: ['Client','Propriétaire','Prestataire','Membre de l’organisation'],
    contactLanguages: ['Français','Anglais','Italien','Autre'],
    planningEntryStatuses: ['Prévu','À confirmer','En cours','Terminé','Annulé']
  };
  walk(ast, node => { if (ts.isVariableDeclaration(node) && expected[node.name.getText(ast)]) { const values=[]; walk(node.initializer, child => { if (ts.isStringLiteral(child)) values.push(child.text); }); assert.deepEqual(values, expected[node.name.getText(ast)]); } });
});
