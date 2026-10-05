/** Fresh owned stack only; never bootstraps or exports real business data. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, sql, request, rpc, directory, status } from './server-local.mjs';

export const fixtureData = {
  contacts: [
    { id: 'vendor-september', name: 'Jardin Riviera fictif', kind: 'Prestataire', email: 'PRIVATE_EMAIL', notes: 'PRIVATE_CONTACT_NOTE', supplierBankAccounts: [{ iban: 'PRIVATE_IBAN' }] },
    { id: 'vendor-options', name: 'Entretien fictif', kind: 'Prestataire', email: 'PRIVATE_EMAIL_2' },
    { id: 'worker-contact', name: 'Camille fictive', kind: 'Prestataire', notes: 'PRIVATE_WORKER_CONTACT' }
  ],
  vendorInvoices: [
    { id: 'invoice-september', contactId: 'vendor-september', contactName: 'Jardin Riviera fictif', title: 'Entretien septembre', amount: 600, paidAmount: 600, status: 'Payé', invoiceDate: '2026-09-15', dueDate: '2026-10-15', notes: 'PRIVATE_INVOICE_NOTE', invoiceDocumentUrl: 'https://PRIVATE_DOCUMENT.invalid', paymentBankAccountId: 'PRIVATE_BANK_ID' },
    { id: 'invoice-manual', contactId: 'vendor-options', contactName: 'Entretien fictif', title: 'Facture à rattacher', amount: 120, paidAmount: 0, status: 'À payer', invoiceDate: '2026-10-02' },
    { id: 'invoice-spread', contactId: 'vendor-options', contactName: 'Entretien fictif', title: 'Facture trimestrielle', amount: 900, paidAmount: 0, status: 'À payer', invoiceDate: '2026-10-03' },
    { id: 'invoice-cents', contactId: 'vendor-options', contactName: 'Entretien fictif', title: 'Répartition de centimes', amount: 100, paidAmount: 0, status: 'À payer', invoiceDate: '2026-10-04' },
    { id: 'invoice-cross-year', contactId: 'vendor-options', contactName: 'Entretien fictif', title: 'Décembre et janvier', amount: 100, paidAmount: 0, status: 'À payer', invoiceDate: '2025-12-10' },
    { id: 'invoice-cancelled', contactId: 'vendor-options', contactName: 'Entretien fictif', title: 'Facture annulée', amount: 70, paidAmount: 0, status: 'Annulé', invoiceDate: '2026-09-15' },
    { id: 'invoice-awaited', contactId: 'vendor-options', contactName: 'Entretien fictif', title: 'Facture attendue', amount: 80, paidAmount: 0, status: 'En attente de facture', invoiceDate: '' },
    { id: 'invoice-no-date', contactId: 'vendor-options', contactName: 'Entretien fictif', title: 'Date manquante', amount: 40, paidAmount: 0, status: 'À payer', invoiceDate: '' },
    { id: 'invoice-identical-oct', contactId: 'vendor-options', contactName: 'Entretien fictif', title: 'Abonnement', amount: 25, paidAmount: 0, status: 'À payer', invoiceDate: '2026-10-10' },
    { id: 'invoice-identical-nov', contactId: 'vendor-options', contactName: 'Entretien fictif', title: 'Abonnement', amount: 25, paidAmount: 0, status: 'À payer', invoiceDate: '2026-11-10' },
    { id: 'invoice-zero', contactId: 'vendor-options', contactName: 'Entretien fictif', title: 'Zéro explicite', amount: 0, paidAmount: 0, status: 'À payer', invoiceDate: '2026-10-10' },
    { id: 'invoice-invalid', contactId: 'vendor-options', contactName: 'Entretien fictif', title: 'Montant manquant', paidAmount: 0, status: 'À payer', invoiceDate: '2026-10-10' }
  ],
  houseTrackingHouses: [{ id: 'house-demo', name: 'Maison de démonstration', address: 'PRIVATE_HOUSE_ADDRESS' }],
  houseTrackingWorkers: [
    { id: 'worker-september', contactId: 'worker-contact', contactName: 'Camille fictive', hourlyRate: 25, role: 'Entretien', status: 'Actif', notes: 'PRIVATE_WORKER_NOTE', documentStoragePath: 'PRIVATE_WORKER_DOC' },
    { id: 'worker-archived', contactName: 'Intervenant archivé fictif', hourlyRate: 25, status: 'Inactif' }
  ],
  houseTimeEntries: [
    { id: 'hours-september', workerId: 'worker-september', workerName: 'Camille fictive', houseId: 'house-demo', houseName: 'Maison de démonstration', date: '2026-09-18', startTime: '08:00', endTime: '18:00', breakMinutes: 0, hourlyRate: 30, note: 'PRIVATE_HOURS_NOTE' },
    { id: 'hours-archived', workerId: 'worker-archived', workerName: 'Intervenant archivé fictif', houseId: 'house-demo', houseName: 'Maison de démonstration', date: '2026-08-18', startTime: '08:00', endTime: '10:00', breakMinutes: 0, hourlyRate: 20 },
    { id: 'hours-midnight', workerId: 'worker-archived', workerName: 'Intervenant archivé fictif', houseId: 'house-demo', houseName: 'Maison de démonstration', date: '2026-09-30', startTime: '23:00', endTime: '01:00', breakMinutes: 30, hourlyRate: 20 }
  ],
  housePayments: [{ id: 'payment-october', workerId: 'worker-september', workerName: 'Camille fictive', houseId: 'house-demo', date: '2026-10-15', amount: 300, method: 'Virement', note: 'PRIVATE_PAYMENT_NOTE' }],
  leads: [], tasks: [], properties: [], vehicles: [], boats: [], quotes: [], vendorQuotes: [], documents: [], planningEntries: []
};

const legacyModules = ['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats'];
const fullGrants = Object.fromEntries(legacyModules.map(module => [module, { level: 'contribute', sensitive: { delete: true, export: true, ...(module === 'contacts' ? { bank_read: true, bank_write: true } : {}), ...(module === 'vendorInvoices' ? { payment: true } : {}) } }]));
const profiles = {
  owner: { admin: true, grants: { ...fullGrants, monthlyCharges: { level: 'contribute', sensitive: { export: true } } } },
  legacyOwner: { admin: true, grants: fullGrants },
  reader: { grants: { monthlyCharges: { level: 'read' }, vendorInvoices: { level: 'read' }, houseTracking: { level: 'read' } } },
  contributor: { grants: { monthlyCharges: { level: 'contribute', sensitive: { export: true } }, vendorInvoices: { level: 'read', sensitive: { export: true } }, houseTracking: { level: 'read' } } },
  invoice: { grants: { monthlyCharges: { level: 'contribute', sensitive: { export: true } }, vendorInvoices: { level: 'read', sensitive: { export: true } } } },
  house: { grants: { monthlyCharges: { level: 'contribute', sensitive: { export: true } }, houseTracking: { level: 'read', sensitive: { export: true } } } },
  empty: { grants: { monthlyCharges: { level: 'read', sensitive: { export: true } } } },
  invoiceOnly: { grants: { vendorInvoices: { level: 'read', sensitive: { export: true } } } },
  none: { grants: {} },
  publisherOnly: { grants: { publisher: { level: 'contribute', sensitive: { export: true, generate: true } } } }
};

await connect();
try {
  assert.equal((await sql.query("select to_regclass('public.crm_workspace_state') n")).rows[0].n, null, 'Fresh owned stack required; do not replay baseline into an existing demo');
  const baseline = readFileSync('tests/izord/sql-fixture.sql', 'utf8');
  await sql.query(baseline.slice(baseline.indexOf('create table public.crm_workspace_state'), baseline.indexOf('create schema storage;')));
  await sql.query("insert into storage.buckets(id,name,public) values('crm-documents','crm-documents',false); create policy crm_docs on storage.objects for all to authenticated using(bucket_id='crm-documents') with check(bucket_id='crm-documents');");
  for (const file of ['20260914210807_drive_folder_registry.sql','20260916170445_module_access_foundation.sql','20260917172412_izord_generator_versions.sql','20260918084849_unified_module_permissions.sql','20260919195633_edit_house_worker.sql','20260928191512_publisher_module_access.sql','20261005092958_monthly_charges.sql']) {
    const before = (await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
    await sql.query(readFileSync('supabase/migrations/' + file, 'utf8'));
    assert.deepEqual((await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload, before, 'Migration preserves every source record');
  }
  const users = {};
  for (const [name, profile] of Object.entries(profiles)) {
    const email = 'monthly-' + name + '@example.invalid', password = 'Local-Charges-2026!';
    const created = await request('/auth/v1/admin/users', status.SERVICE_ROLE_KEY, { email, password, email_confirm: true });
    assert.equal(created.status, 200, 'Fictitious Auth identity created only locally');
    await sql.query('insert into public.crm_access_profiles(user_id,general_admin) values($1,$2)', [created.data.id, profile.admin ?? false]);
    if (Object.keys(profile.grants).some(module => module !== 'publisher')) await sql.query("insert into public.app_memberships(user_id,workspace_id,role) values($1,'oar','member')", [created.data.id]);
    for (const [module, grant] of Object.entries(profile.grants)) await sql.query('insert into public.crm_module_grants(user_id,module,level,sensitive) values($1,$2,$3,$4)', [created.data.id, module, grant.level, grant.sensitive ?? {}]);
    const signed = await request('/auth/v1/token?grant_type=password', null, { email, password });
    assert.equal(signed.status, 200);
    users[name] = { id: created.data.id, email, password, token: signed.data.access_token, session: signed.data };
  }
  await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [fixtureData]);
  const fixture = { api: status.API_URL, app: 'http://127.0.0.1:3183', publicKey: status.ANON_KEY, users, integrationComplete: true };
  writeFileSync(join(directory, 'fixtures.private.json'), JSON.stringify(fixture), { mode: 0o600 });
  // Schema cache propagation may take a moment; bounded polling, no remote retries.
  for (let attempt = 0; attempt < 50; attempt++) {
    const response = await rpc('crm_read_monthly_charges', users.owner.token);
    if (response.status === 200) break;
    if (attempt === 49) throw new Error('Local RPC schema cache unavailable: ' + JSON.stringify(response.data));
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  console.log('Local Auth identities, additive schema and fictitious Charges sources ready.');
} finally { await sql.end(); }
