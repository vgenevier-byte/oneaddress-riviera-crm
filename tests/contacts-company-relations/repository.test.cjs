const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
// Transpile the actual repository and its local dependencies; only transport is fake.
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
const { createFonciereRepository } = require('../../lib/fonciere/repository.ts');
const blank = { name: '', firstName: '', companyName: '', email: '', phone: '', city: '', postalAddress: '' };
function fixture(rows = [], error = null) {
  const calls = [];
  const repository = createFonciereRepository({ storage: { from: () => ({}) }, async rpc(name, args) {
    calls.push({ name, args });
    if (name === 'crm_read_module') return { data: { revision: 'approved-revision', collections: { contacts: rows } }, error: null };
    assert.equal(name, 'crm_save_contact_bundle');
    if (error) return { data: null, error };
    return { data: { collections: { contacts: [{ ...args.p_contact }, ...(args.p_person ? [{ ...args.p_person, companyId: args.p_contact.id }] : [])] } }, error: null };
  } });
  return { repository, calls };
}
test('Foncière creates company and first person through one atomic RPC with independent coordinates', async () => {
  const { repository, calls } = fixture();
  const company = await repository.createContact({ ...blank, entityType: 'company', companyName: 'Agence fictive', email: 'agency@example.invalid', phone: '04 00 00 00 00', city: 'Cannes', postalAddress: 'Adresse générale', firstPerson: { name: 'Durand', firstName: 'Camille', email: 'camille@example.invalid' } });
  const mutation = calls.find(call => call.name === 'crm_save_contact_bundle');assert(mutation);
  assert.equal(calls.length, 2);assert.equal(mutation.args.p_contact.id, company.id);assert.equal(mutation.args.p_revision, 'approved-revision');
  assert.equal(mutation.args.p_person.name, 'Durand');assert.equal(mutation.args.p_person.email, 'camille@example.invalid');
  for (const field of ['phone', 'city', 'postalAddress']) assert.equal(mutation.args.p_person[field], '');
  assert.equal(mutation.args.p_person.postalAddressDetails, undefined);assert.equal(mutation.args.p_existing_person_id, null);assert.notEqual(mutation.args.p_person.id, company.id);
});
test('Foncière attaches existing person by ID without a second person payload', async () => {
  const { repository, calls } = fixture([{ ...blank, id: 'existing-person', entityType: 'person', name: 'Durand' }]);
  await repository.createContact({ ...blank, entityType: 'company', companyName: 'Agence nouvelle', existingPersonId: 'existing-person' });
  const { args } = calls[1];assert.equal(args.p_existing_person_id, 'existing-person');assert.equal(args.p_person, null);
});
test('Foncière rejects missing or conflicting first-person choices before writing', async () => {
  for (const choice of [{}, { firstPerson: { name: 'Camille' }, existingPersonId: 'existing-person' }, { firstPerson: { name: '  ' } }]) {
    const { repository, calls } = fixture();
    await assert.rejects(repository.createContact({ ...blank, entityType: 'company', companyName: 'Agence nouvelle', ...choice }));
    assert.equal(calls.length, 0);
  }
});
test('Foncière person creation preserves optional canonical companyId', async () => {
  const { repository, calls } = fixture();
  await repository.createContact({ ...blank, entityType: 'person', name: 'Durand', companyId: 'canonical-company' });
  assert.equal(calls[1].args.p_contact.companyId, 'canonical-company');assert.equal(calls[1].args.p_person, null);
});
test('Foncière surfaces atomic server failure without a fallback or partial retry', async () => {
  const { repository, calls } = fixture([], { code: '23514', message: 'contact_company_person_required' });
  await assert.rejects(repository.createContact({ ...blank, entityType: 'company', companyName: 'Agence nouvelle', firstPerson: { name: 'Durand' } }));
  assert.equal(calls.filter(call => call.name === 'crm_save_contact_bundle').length, 1);assert(!calls.some(call => call.name === 'crm_mutate_record'));
});
