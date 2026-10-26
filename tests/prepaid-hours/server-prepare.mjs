/** Dedicated loopback Supabase only. Uses real Auth; no repository environment. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, sql, request, directory, status } from './server-local.mjs';

const createdAt = '2026-09-01T00:00:00.000Z';
const worker = (id, name, rate = 16.5) => ({ id, contactId: 'contact-' + id, contactName: name, role: 'Cours fictifs', status: 'Actif', hourlyRate: rate, createdAt });
const entry = (id, workerId, date, startTime, endTime, houseId = 'house-a', extra = {}) => ({ id, workerId, workerName: workerId + ' fictif', houseId, houseName: houseId + ' fictive', date, startTime, endTime, breakMinutes: 0, hourlyRate: 16.5, createdAt, ...extra });
const workers = [worker('worker-prepaid', 'Alex fictif'), worker('worker-hourly', 'Camille fictive', 25), worker('worker-quarters', 'Quarts fictifs'), worker('worker-cross', 'Traversée fictive')];
export const fixtureData = {
 contacts: workers.map(w => ({ id: w.contactId, name: w.contactName, kind: 'Prestataire', email: 'never-send@example.invalid' })),
 houseTrackingHouses: [{ id: 'house-a', name: 'Maison A fictive', address: 'Adresse fictive' }, { id: 'house-b', name: 'Maison B fictive' }],
 houseTrackingWorkers: workers,
 houseTimeEntries: [
  ...Array.from({ length: 16 }, (_, i) => entry('hours-prepaid-' + String(i).padStart(2, '0'), 'worker-prepaid', i < 8 ? '2026-09-' + String(i + 1).padStart(2, '0') : '2026-10-' + String(i - 7).padStart(2, '0'), '17:00', '19:00', i % 2 ? 'house-b' : 'house-a', i === 0 ? { expenseAmount: 10, expenseNote: 'Transport fictif distinct' } : {})),
  entry('hours-hourly', 'worker-hourly', '2026-09-03', '08:00', '10:00', 'house-a', { hourlyRate: 25 }),
  ...Array.from({ length: 120 }, (_, i) => { const start = (i % 80) * 15; const fmt = n => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0'); return entry('hours-quarter-' + String(i).padStart(3, '0'), 'worker-quarters', i < 80 ? '2026-09-01' : '2026-09-02', fmt(start), fmt(start + 15)); }),
  entry('hours-cross-29a', 'worker-cross', '2026-09-01', '00:00', '20:00'),
  entry('hours-cross-29b', 'worker-cross', '2026-09-02', '08:00', '17:00'),
  entry('hours-cross-2', 'worker-cross', '2026-09-03', '08:00', '10:00')
 ],
 housePayments: [
  { id: 'payment-existing', workerId: 'worker-prepaid', workerName: 'Alex fictif', houseId: 'house-a', houseName: 'Maison A fictive', date: '2026-10-05', amount: 500, method: 'Virement', note: 'Premier forfait fictif déjà réglé', createdAt },
  { id: 'payment-hourly', workerId: 'worker-hourly', workerName: 'Camille fictive', houseId: 'house-a', houseName: 'Maison A fictive', date: '2026-09-03', amount: 20, method: 'Espèces', createdAt }
 ],
 vendorInvoices: [{ id: 'invoice-prepaid', contactId: 'contact-worker-quarters', contactName: 'Quarts fictifs', title: 'Forfait fictif', amount: 500, paidAmount: 500, status: 'Payé', invoiceDate: '2026-10-10', createdAt }],
 leads: [], tasks: [], properties: [], vehicles: [], boats: [], quotes: [], vendorQuotes: [], suppliers: [], documents: [], planningEntries: []
};
const modules = ['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats','monthlyCharges'];
const full = Object.fromEntries(modules.map(module => [module, { level: 'contribute', sensitive: { delete: true, export: true, ...(module === 'contacts' ? { bank_read: true, bank_write: true } : {}), ...(module === 'vendorInvoices' ? { payment: true } : {}) } }]));
const profiles = {
 owner: { admin: true, grants: full },
 contributor: { grants: { houseTracking: { level: 'contribute', sensitive: { export: true, delete: true } }, monthlyCharges: { level: 'read', sensitive: { export: true } } } },
 reader: { grants: { houseTracking: { level: 'read' }, monthlyCharges: { level: 'read' } } },
 invoiceOnly: { grants: { vendorInvoices: { level: 'read', sensitive: { export: true } }, monthlyCharges: { level: 'read', sensitive: { export: true } } } },
 none: { grants: {} }
};
await connect();
try {
 assert.equal((await sql.query("select to_regclass('public.crm_workspace_state') n")).rows[0].n, null, 'Fresh dedicated stack required');
 const baseline = readFileSync('tests/izord/sql-fixture.sql', 'utf8');
 await sql.query(baseline.slice(baseline.indexOf('create table public.crm_workspace_state'), baseline.indexOf('create schema storage;')));
 await sql.query("insert into storage.buckets(id,name,public) values('crm-documents','crm-documents',false); create policy crm_docs on storage.objects for all to authenticated using(bucket_id='crm-documents') with check(bucket_id='crm-documents');");
 for (const file of ['20260914210807_drive_folder_registry.sql','20260916170445_module_access_foundation.sql','20260917172412_izord_generator_versions.sql','20260918084849_unified_module_permissions.sql','20260919195633_edit_house_worker.sql','20260928191512_publisher_module_access.sql','20261005092958_monthly_charges.sql','20261023003426_house_intervention_expenses.sql','20261024162509_monthly_charges_period_houses.sql']) await sql.query(readFileSync('supabase/migrations/' + file, 'utf8'));
 const users = {};
 for (const [name, profile] of Object.entries(profiles)) {
  const email = 'prepaid-' + name + '@example.invalid', password = 'Fictitious-Prepaid-2026!';
  const created = await request('/auth/v1/admin/users', status.SERVICE_ROLE_KEY, { email, password, email_confirm: true });
  assert.equal(created.status, 200, 'Create fictitious local Auth identity');
  await sql.query('insert into public.crm_access_profiles(user_id,general_admin) values($1,$2)', [created.data.id, profile.admin ?? false]);
  await sql.query("insert into public.app_memberships(user_id,workspace_id,role) values($1,'oar','member')", [created.data.id]);
  for (const [module, grant] of Object.entries(profile.grants)) await sql.query('insert into public.crm_module_grants(user_id,module,level,sensitive) values($1,$2,$3,$4)', [created.data.id, module, grant.level, grant.sensitive ?? {}]);
  const signed = await request('/auth/v1/token?grant_type=password', null, { email, password }); assert.equal(signed.status, 200);
  users[name] = { id: created.data.id, email, password, token: signed.data.access_token, session: signed.data };
 }
 await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [fixtureData]);
 writeFileSync(join(directory, 'fixtures.private.json'), JSON.stringify({ api: status.API_URL, app: 'http://127.0.0.1:3197', publicKey: status.ANON_KEY, users, integrationComplete: true }), { mode: 0o600 });
 writeFileSync(join(directory, 'baseline.private.json'), JSON.stringify(fixtureData), { mode: 0o600 });
 console.log('Dedicated fictitious sources and real local Auth identities ready; prepaid migration not applied yet.');
} finally { await sql.end(); }
