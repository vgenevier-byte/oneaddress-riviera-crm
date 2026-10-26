/** Fictitious long selector lists on the owned loopback Supabase stack only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, sql, rpc, login, directory } from '../prepaid-hours/server-local.mjs';
const fixture = JSON.parse(readFileSync(join(directory, 'fixtures.private.json'), 'utf8'));
await connect();
try {
 const existing = (await sql.query('select count(*) n from app_private.house_prepaid_packages')).rows[0].n;
 assert.equal(Number(existing), 0, 'Run owned server-reset before preparing search fixtures');
 const data = JSON.parse(readFileSync(join(directory, 'baseline.private.json'), 'utf8'));
 const createdAt = '2026-09-01T00:00:00.000Z';
 for (let i = 0; i < 132; i++) {
  const suffix = String(i).padStart(3, '0');
  data.contacts.push({ id: 'contact-search-' + suffix, name: 'Témoin ' + suffix, firstName: 'Exemple', kind: 'Prestataire', city: 'Nice', entityType: 'person' });
  data.houseTrackingWorkers.push({ id: 'worker-search-' + suffix, contactId: 'contact-search-' + suffix, contactName: 'Intervenant témoin ' + suffix, role: 'Cours fictifs', hourlyRate: 16.5, status: 'Actif', createdAt });
  data.houseTrackingHouses.push({ id: 'house-search-' + suffix, name: 'Maison témoin ' + suffix, address: suffix + ' rue fictive', addressDetails: { city: 'Nice', postalCode: '06000' }, createdAt });
  data.housePayments.push({ id: 'payment-search-' + suffix, workerId: 'worker-search-target', workerName: 'Libellé historique professeur', houseId: 'house-a', houseName: 'Maison A fictive', date: '2026-09-01', amount: 500, method: 'Virement', note: 'Paiement témoin ' + suffix, createdAt });
  data.vendorInvoices.push({ id: 'invoice-search-' + suffix, contactId: 'contact-search-target', contactName: 'Éléonore D’Aubigny', title: 'Cours fictifs ' + suffix, invoiceReference: 'FA-SEARCH-' + suffix, invoiceDate: '2026-10-01', amount: 500, paidAmount: 500, status: 'Payé', createdAt });
 }
 data.contacts.push({ id: 'company-search-canonical', name: 'AZUR MÉDITERRANÉE', companyName: 'AZUR MÉDITERRANÉE', kind: 'Prestataire', entityType: 'company', city: 'Cagnes-sur-Mer' });
 data.contacts.push({ id: 'contact-search-target', firstName: 'Éléonore', name: 'D’Aubigny', companyId: 'company-search-canonical', companyName: 'Ancienne étiquette société', kind: 'Prestataire', entityType: 'person', city: 'Cagnes-sur-Mer' });
 data.contacts.push({ id: 'contact-search-sibling', firstName: 'Camille', name: 'Rossi', companyId: 'company-search-canonical', companyName: 'Autre ancienne étiquette', kind: 'Prestataire', entityType: 'person', city: 'Cagnes-sur-Mer' });
 data.houseTrackingWorkers.push({ id: 'worker-search-sibling', contactId: 'contact-search-sibling', contactName: 'Autre professeur historique', role: 'Cours fictifs', hourlyRate: 16.5, status: 'Actif', createdAt });
 data.houseTrackingWorkers.push({ id: 'worker-search-target', contactId: 'contact-search-target', contactName: 'Libellé historique professeur', role: 'Cours individuels fictifs', hourlyRate: 16.5, status: 'Actif', createdAt });
 data.houseTrackingHouses.push({ id: 'house-search-target', name: 'Villa des Écureuils', address: '12 Allée des Écureuils', addressDetails: { houseNumber: '12', street: 'Allée des Écureuils', line1: '12 Allée des Écureuils', complement: '', city: 'Cagnes-sur-Mer', postalCode: '06800', country: 'France', countryCode: 'FR', formattedAddress: '12 Allée des Écureuils', source: 'manual', precision: 'manual', fingerprint: '12 allée des écureuils' }, createdAt });
 data.housePayments.push({ id: 'payment-search-target', workerId: 'worker-search-target', workerName: 'Libellé historique professeur', houseId: 'house-search-target', houseName: 'Villa des Écureuils', date: '2026-09-27', amount: 500, method: 'Virement', note: 'Versement première session Boréale', createdAt });
 data.vendorInvoices.push({ id: 'invoice-search-target', contactId: 'contact-search-target', contactName: 'Éléonore D’Aubigny', title: 'Session automne Éléonore', invoiceReference: 'ÉCOLE-2026-ARCHIPEL-119', invoiceDate: '2026-10-27', amount: 500, paidAmount: 500, status: 'Payé', createdAt });
 data.vendorInvoices.push({ id: 'invoice-search-history-target', contactId: 'contact-search-target', contactName: 'Éléonore D’Aubigny', title: 'Historique jasmin fictif', invoiceReference: 'HIST-2026-JASMIN-119', invoiceDate: '2026-10-28', amount: 500, paidAmount: 500, status: 'Payé', createdAt });
 for (let i = 0; i < 16; i++) data.houseTimeEntries.push({ id: 'hours-search-' + String(i).padStart(2, '0'), workerId: 'worker-search-target', workerName: 'Libellé historique professeur', houseId: 'house-search-target', houseName: 'Villa des Écureuils', date: '2026-09-' + String(i + 1).padStart(2, '0'), startTime: '17:00', endTime: '19:00', breakMinutes: 0, hourlyRate: 16.5, createdAt });
 await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [data]);
 fixture.users.owner.token = await login(fixture.users.owner);
 const allowed = async promise => { const result = await promise; assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; };
 let state = await allowed(rpc('crm_house_prepaid_state', fixture.users.owner.token));
 for (const [action, patch] of [['settings', { workerId: 'worker-prepaid', billingMode: 'prepaid', defaultMinutes: 1800, defaultPriceCents: 50000 }], ['package', { workerId: 'worker-prepaid', capacityMinutes: 1800, priceCents: 50000, paymentId: 'payment-existing' }]]) state = await allowed(rpc('crm_save_house_prepaid', fixture.users.owner.token, { p_revision: state.revision, p_request_id: randomUUID(), p_action: action, p_patch: patch }));
 const targetIndices = { worker: data.houseTrackingWorkers.findIndex(x => x.id === 'worker-search-target'), house: data.houseTrackingHouses.findIndex(x => x.id === 'house-search-target'), paymentWithinWorker: data.housePayments.filter(x => x.workerId === 'worker-search-target').findIndex(x => x.id === 'payment-search-target'), invoiceWithinWorker: data.vendorInvoices.filter(x => x.contactId === 'contact-search-target').findIndex(x => x.id === 'invoice-search-target'), historyInvoiceWithinWorker: data.vendorInvoices.filter(x => x.contactId === 'contact-search-target').findIndex(x => x.id === 'invoice-search-history-target') };
 assert.ok(Object.values(targetIndices).every(index => index >= 132));
 const manifest = { api: 'http://127.0.0.1:56031', app: 'http://127.0.0.1:3197', fictitious: true, longListPadding: 132, targetIndices, target: { workerId: 'worker-search-target', contactId: 'contact-search-target', companyId: 'company-search-canonical', siblingWorkerId: 'worker-search-sibling', paymentId: 'payment-search-target', houseId: 'house-search-target', invoiceId: 'invoice-search-target', historyInvoiceId: 'invoice-search-history-target' }, counts: { workers: data.houseTrackingWorkers.length, houses: data.houseTrackingHouses.length, targetPayments: data.housePayments.filter(x => x.workerId === 'worker-search-target').length, targetInvoices: data.vendorInvoices.filter(x => x.contactId === 'contact-search-target').length } };
 writeFileSync(join(directory, 'fixtures.private.json'), JSON.stringify(fixture), { mode: 0o600 });
 writeFileSync(join(directory, 'search-fixture.private.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
 console.log(JSON.stringify(manifest));
} finally { await sql.end(); }
