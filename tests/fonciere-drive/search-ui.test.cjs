require('../i18n/register-typescript.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createSearchIndex, searchIndex } = require('../../lib/search');
const { searchProjects, projectReferenceFields } = require('../../lib/fonciere/projectSearch');
const { searchTaskTargets } = require('../../lib/tasks/targets');
const { createFonciereData } = require('../../lib/fonciere/model');
const project = (number, title, data = {}) => ({ id: `canonical-${number}`, project_number: number, project_reference: `PRJ-${String(number).padStart(6, '0')}`, title, payload: { data: { ...createFonciereData(), name: title, ...data } } });

test('visible empty project list keeps numeric order despite inverse titles and modified times', () => {
  const rows = [project(10, 'A Cannes'), project(2, 'Z Nice'), project(1, 'Villa')];
  const before = JSON.stringify(rows);
  assert.deepEqual(searchProjects(rows, '').map(hit => hit.item.id), ['canonical-1', 'canonical-2', 'canonical-10']);
  assert.deepEqual(searchProjects(rows, '   ').map(hit => hit.item.project_number), [1, 2, 10]);
  assert.equal(JSON.stringify(rows), before, 'ranking never mutates payloads or snapshots');
  const index = createSearchIndex(rows, row => [row.title], { getLabel: row => row.title });
  assert.deepEqual(searchIndex(index, '').map(hit => hit.item.title), ['A Cannes', 'Villa', 'Z Nice'], 'other shared lists keep current default ordering');
});

test('exact full and numeric references lead relevance results while fragments remain searchable', () => {
  const rows = [project(120, 'PRJ-000012'), project(12, 'Z exact'), project(212, 'A fragment')];
  for (const query of ['PRJ-000012', 'prj-000012', '12', '000012']) assert.equal(searchProjects(rows, query)[0].item.project_number, 12, query);
  assert.deepEqual(new Set(searchProjects(rows, '12').map(hit => hit.item.project_number)), new Set([120, 12, 212]));
  assert.deepEqual(projectReferenceFields({ id: 'draft', title: 'Draft' }), [], 'no browser-calculated definitive draft reference');
});

test('project search retains names, city, address, agency reference, agency and contact data', () => {
  const row = project(19, 'Villa des Oliviers', { city: 'Cannes', propertyAddress: '9 rue de la Plage', agencyReference: 'AGENCE-762', agencyName: 'Riviera Immobilier', agentName: 'Clément Martin', agentEmail: 'clement@example.invalid', agentPhone: '0611223344' });
  for (const query of ['oliviers', 'cannes', 'plage', '762', 'riviera', 'clement martin', 'clement@example.invalid', '0611223344']) assert.equal(searchProjects([row], query).length, 1, query);
});

test('same-name projects retain their distinct canonical IDs', () => {
  const rows = [project(91, 'Villa'), project(92, 'Villa')];
  assert.deepEqual(searchProjects(rows, 'villa').map(hit => hit.item.id).sort(), ['canonical-91', 'canonical-92']);
});

test('Task reference search ranks the complete authorized paginated catalogue before its display cap', async () => {
  const rows = Array.from({ length: 251 }, (_, index) => ({ ref: { type: 'fonciere_project', id: `uuid-${index}` }, label: index === 250 ? 'Z match' : 'A PRJ-000251', projectReference: `PRJ-${String(index + 1).padStart(6, '0')}`, projectNumber: index + 1 }));
  const calls = [];
  const page = await searchTaskTargets(async (offset, limit) => { calls.push(offset); return { items: rows.slice(offset, offset + limit), hasMore: offset + limit < rows.length }; }, '251', 0, 1);
  assert.deepEqual(calls, [0, 200]);
  assert.equal(page.items[0].ref.id, 'uuid-250');
  assert.equal(page.items[0].projectReference, 'PRJ-000251');
  assert.equal(page.hasMore, true);
});
