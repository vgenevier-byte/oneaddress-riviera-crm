const test = require('node:test');
const assert = require('node:assert/strict');
const { getContactLabel, getContactPersonName, getContactSecondaryLabel, validateContactIdentity, getContactIdentityValidationError } = require('../../lib/contactIdentity.ts');
const { mergeContactUpdate, getContactFormUpdate } = require('../../lib/contactEditing.ts');
const { taskContactOptions, taskContactLabel, matchesTaskContact } = require('../../lib/tasks/contactOptions.ts');
const { getVendorBusinessName, getVendorContactPersonName, isEligibleVendorContact, searchVendorContacts } = require('../../lib/vendorContacts.ts');
const { matchesContactSearch } = require('../../lib/contactSearch.ts');
const { createContactSearchIndex, searchContactSuggestions } = require('../../lib/contactSuggestions.ts');
const catalog = require('../../lib/access/collections.json');

const company = { id: 'company-local', entityType: 'company', companyName: 'Établissements Azur', firstName: 'Guillaume', name: '', kind: 'Prestataire', email: '', phone: '', city: '', postalAddress: '', budget: 0, source: '', notes: '', createdAt: '2026-10-08' };

test('person needs a family name even when a company or first name is present', () => {
  for (const extra of [{ firstName: 'Guillaume' }, { companyName: 'Azur' }, {}]) {
    assert.deepEqual(validateContactIdentity({ entityType: 'person', name: '', ...extra }), { field: 'name', code: 'contact_name_required' });
  }
  assert.equal(validateContactIdentity({ entityType: 'person', name: '  Dupont  ' }), null);
});

test('company accepts no contact person or Guillaume alone, and requires its own company name', () => {
  assert.equal(validateContactIdentity(company), null);
  assert.equal(validateContactIdentity({ ...company, firstName: '' }), null);
  for (const companyName of [undefined, null, '', '  \t\n', '\u00a0\u202f\ufeff']) {
    assert.deepEqual(validateContactIdentity({ ...company, companyName, name: 'Dupont' }), { field: 'companyName', code: 'contact_company_name_required' });
  }
  assert.equal(company.name, '');
});

test('strict entity type, matching all ECMAScript boundary whitespace', () => {
  for (const entityType of [null, '', 'Company', ' company ', 'unknown', false, 1, [], {}]) {
    assert.deepEqual(validateContactIdentity({ name: 'Dupont', companyName: 'Azur', entityType }), { field: 'entityType', code: 'contact_entity_type_invalid' });
  }
  for (const whitespace of ['\u0009', '\u000a', '\u000b', '\u000c', '\u000d', '\u0020', '\u00a0', '\u1680', ...Array.from({length:11}, (_, i) => String.fromCharCode(0x2000 + i)), '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff']) {
    assert.equal(validateContactIdentity({ entityType: 'person', name: whitespace }).code, 'contact_name_required');
    assert.equal(validateContactIdentity({ entityType: 'company', companyName: whitespace }).code, 'contact_company_name_required');
  }
});

test('legacy nature is never inferred; unrelated legacy edits retain their compatibility path', () => {
  const legacy = { name: 'Durand', companyName: 'Azur' };
  assert.equal(validateContactIdentity(legacy), null);
  assert.equal(getContactLabel(legacy), 'Durand');
  assert.equal(validateContactIdentity({ name: '', companyName: 'Azur' }).code, 'contact_name_required');
  assert.equal(validateContactIdentity({ name: '', companyName: 'Azur' }, { allowUnqualifiedLegacy: true }), null);
  assert.equal(Object.hasOwn(legacy, 'entityType'), false);
});

test('one company identity across Contacts, task and supplier selectors; optional person stays secondary', () => {
  assert.equal(getContactLabel(company), 'Établissements Azur');
  assert.equal(getContactPersonName(company), 'Guillaume');
  assert.equal(getContactSecondaryLabel(company), 'Guillaume');
  assert.equal(getVendorBusinessName(company), 'Établissements Azur');
  assert.equal(getVendorContactPersonName(company), 'Guillaume');
  const [option] = taskContactOptions([company]);
  assert.equal(option.entityType, 'company');
  assert.equal(taskContactLabel(option), 'Établissements Azur');
  assert.equal(taskContactLabel({ ...option, entityType: 'person', name: 'Durand' }), 'Guillaume Durand');
  assert.equal(getContactLabel({ companyName: 'Ancienne entreprise' }), 'Ancienne entreprise');
});

test('partial updates retain identity, stable ID, bank information and unrelated properties', () => {
  const original = { ...company, supplierBankAccounts: [{ id: 'bank-history', iban: 'fictional', status: 'Archivé' }], historicalLink: { id: 'quote-old' }, createdBy: 'historical-actor' };
  const before = structuredClone(original);
  const next = mergeContactUpdate(original, { id: 'cannot-replace', phone: '01 00 00 00 00', entityType: undefined });
  assert.deepEqual(next, { ...original, phone: '01 00 00 00 00' });
  assert.deepEqual(original, before);
  assert.deepEqual(getContactFormUpdate({ ...original, entityType: 'person', firstName: 'New' }, ['entityType']), { entityType: 'person' });
  assert.equal(Object.hasOwn(mergeContactUpdate({ ...company, entityType: undefined }, {}), 'entityType'), false);
  assert.equal(mergeContactUpdate(original, { firstName: 'Guillaume', name: 'Durand' }).id, original.id);
});

test('empty surnames do not collapse different IDs or narrow accent/fragment search', () => {
  const other = { ...company, id: 'company-other', companyName: 'Établissements Azur', firstName: '' };
  assert.equal(taskContactOptions([company, other, company]).length, 2);
  for (const query of ['AZUR', 'etablissements', 'Guill', 'azur etab']) assert.equal(matchesContactSearch(company, query), true);
  assert.equal(matchesTaskContact(taskContactOptions([company])[0], 'guill azur'), true);
  assert.equal(searchVendorContacts([company, other], 'azur').length, 2);
  const suggestions = searchContactSuggestions(createContactSearchIndex([company, other]), 'azru');
  assert.deepEqual(suggestions.direct, []);
  assert.deepEqual(new Set(suggestions.close.map(row => row.id)), new Set([company.id, other.id]));
});

test('nature is independent of business category and does not grant supplier eligibility', () => {
  for (const kind of ['Client', 'Prestataire', 'Propriétaire', 'Membre de l’organisation']) assert.equal(validateContactIdentity({ ...company, kind }), null);
  assert.equal(isEligibleVendorContact({ ...company, kind: 'Membre de l’organisation' }), false);
  const fields = catalog.find(row => row.collection === 'contacts').fields;
  assert.deepEqual(fields.entityType.enum, ['person', 'company']);
  assert.deepEqual(fields.kind.enum, ['Client', 'Propriétaire', 'Prestataire', 'Membre de l’organisation']);
});

test('only exact known server validation codes are recognised; raw details stay unknown', () => {
  for (const code of ['contact_name_required', 'contact_company_name_required', 'contact_entity_type_invalid']) {
    assert.equal(getContactIdentityValidationError(new Error(code)).code, code);
    assert.equal(getContactIdentityValidationError({ message: code, details: 'not-rendered' }).code, code);
  }
  assert.equal(getContactIdentityValidationError('SQL secret contact_name_required'), null);
  assert.equal(getContactIdentityValidationError({ message: 'unknown' }), null);
});
