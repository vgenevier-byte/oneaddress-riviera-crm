export const fixtureData = {
  contacts: [{ id: 'expense-contact', name: 'Intervenant frais fictif', entityType: 'person', kind: 'Prestataire', firstName: 'Camille', email: 'fictional@example.invalid', phone: '', notes: 'PRIVATE_CONTACT_NOTE' }],
  houseTrackingHouses: [{ id: 'expense-house', name: 'Maison des frais fictifs', address: 'Adresse fictive' }],
  houseTrackingWorkers: [
    { id: 'expense-worker', contactId: 'expense-contact', contactName: 'Intervenant frais fictif', hourlyRate: 25, role: 'Entretien', status: 'Actif', notes: 'PRIVATE_WORKER_NOTE' },
    { id: 'expense-legacy-worker', contactName: 'Historique sans frais fictif', hourlyRate: 20, role: 'Entretien', status: 'Actif' },
    { id: 'expense-archived-worker', contactName: 'Intervenant archivé fictif', hourlyRate: 25, role: 'Entretien', status: 'Inactif' }
  ],
  houseTimeEntries: [
    { id: 'expense-main', workerId: 'expense-worker', workerName: 'Intervenant frais fictif', houseId: 'expense-house', houseName: 'Maison des frais fictifs', date: '2026-10-23', startTime: '08:00', endTime: '12:00', breakMinutes: 0, hourlyRate: 25, note: 'Intervention fictive de contrôle' },
    { id: 'expense-legacy', workerId: 'expense-legacy-worker', workerName: 'Historique sans frais fictif', houseId: 'expense-house', houseName: 'Maison des frais fictifs', date: '2026-09-23', startTime: '09:00', endTime: '10:00', breakMinutes: 0, hourlyRate: 20, note: 'Historique fictif sans frais' },
    { id: 'expense-archived', workerId: 'expense-archived-worker', workerName: 'Intervenant archivé fictif', houseId: 'expense-house', houseName: 'Maison des frais fictifs', date: '2026-10-21', startTime: '08:00', endTime: '09:00', breakMinutes: 0, hourlyRate: 25, note: 'Intervenant archivé fictif' }
  ],
  housePayments: [{ id: 'expense-payment', workerId: 'expense-worker', workerName: 'Intervenant frais fictif', houseId: 'expense-house', date: '2026-10-23', amount: 50, method: 'Virement', note: 'Paiement fictif conservé' }],
  leads: [], tasks: [], properties: [], vehicles: [], boats: [], quotes: [], vendorQuotes: [], vendorInvoices: [], documents: [], planningEntries: [],
  retained: { sentinel: 'Payload fictif hors Personnel conservé' }
};
