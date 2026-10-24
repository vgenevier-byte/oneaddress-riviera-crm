import assert from "node:assert/strict";
import test from "node:test";
import { createHouseWorkerFieldResolver } from "../../lib/houseWorkerSearch";
import { getHouseTrackingWorkerHistorySummary, isHouseTrackingWorkerActive } from "../../lib/houseTracking";
import { createSearchIndex, searchIndex } from "../../lib/search";
import type { Contact, HousePayment, HouseTimeEntry, HouseTrackingWorker } from "../../lib/types";

const company: Partial<Contact> = Object.freeze({
  id: "agency-fixture", entityType: "company", companyName: "Agence Riviera", city: "Cannes",
  postalAddress: "21 boulevard Fictif", phone: "04 93 00 00 01", email: "agence@example.invalid",
});
const person: Partial<Contact> = Object.freeze({
  id: "contact-clement-fixture", entityType: "person", firstName: "Clément", name: "Martin",
  companyId: company.id, companyName: "Ancienne dénomination", phone: "+33 (0)6 42 00 00 01",
  email: "clement@example.invalid", city: "Antibes", postalAddress: "2 allée Fictive",
});
const activeWorker: HouseTrackingWorker = Object.freeze({
  id: "worker-active-fixture", contactId: person.id!, contactName: "Libellé historique", role: "Entretien",
  hourlyRate: 27.5, status: "Actif", createdAt: "2026-01-01T00:00:00.000Z",
});
const archivedWorker: HouseTrackingWorker = Object.freeze({ ...activeWorker, id: "worker-archived-fixture", status: "Inactif" });
const workerIndex = (workers: readonly HouseTrackingWorker[], contacts: readonly Partial<Contact>[] = [person, company]) =>
  createSearchIndex(workers, createHouseWorkerFieldResolver(contacts), { getId: worker => worker.id, getLabel: worker => worker.contactName });
const ids = (hits: readonly { item: HouseTrackingWorker }[]) => hits.map(hit => hit.item.id);

test("linked worker search reuses canonical authorized names, company context, accents and shared approximate matching", () => {
  const index = workerIndex([activeWorker]);
  for (const query of ["Clément", "CLE\u0301MENT", "clemnt", "martin clem", "riviera canne", "cannse", "fictif boulevard"]) {
    assert.deepEqual(ids(searchIndex(index, query)), [activeWorker.id], query);
  }
  assert.equal(searchIndex(index, "clemnt")[0].approximate, true);
  assert.equal(searchIndex(index, "cannse")[0].approximate, true);
  assert.equal(searchIndex(index, "martin clem")[0].approximate, false);
  assert.deepEqual(searchIndex(index, "riviera inconnu"), []);
});

test("active and archived workers are enriched only within the caller's existing eligible list", () => {
  const workers = [activeWorker, archivedWorker];
  const active = workerIndex(workers.filter(isHouseTrackingWorkerActive));
  const archived = workerIndex(workers.filter(worker => !isHouseTrackingWorkerActive(worker)));
  for (const query of ["clemnt", "martin clem", "riviera canne", "cannse"]) {
    assert.deepEqual(ids(searchIndex(active, query)), [activeWorker.id], query);
    assert.deepEqual(ids(searchIndex(archived, query)), [archivedWorker.id], query);
  }
  assert.deepEqual(ids(searchIndex(workerIndex([activeWorker, archivedWorker]), "riviera")), [activeWorker.id, archivedWorker.id]);
  assert.deepEqual(searchIndex(workerIndex([]), "clement"), []);
});

test("search retains the worker identity and historical label when several workers share one contact", () => {
  const hits = searchIndex(workerIndex([activeWorker, archivedWorker]), "clement");
  assert.equal(hits[0].item, activeWorker);
  assert.equal(hits[1].item, archivedWorker);
  assert.notEqual(hits[0].item.id, person.id);
  assert.equal(hits[0].item.contactName, "Libellé historique");
  for (const query of ["historique", "entretien"]) {
    assert.deepEqual(ids(searchIndex(workerIndex([activeWorker]), query)), [activeWorker.id], query);
  }
});

test("coordinates already in the authorized contact or company projection remain searchable without digit or email corrections", () => {
  const index = workerIndex([activeWorker]);
  for (const query of ["antibes", "allée fictive", "clement@example.invalid", "+330642000001", "agence@example.invalid", "0493000001"]) {
    assert.deepEqual(ids(searchIndex(index, query)), [activeWorker.id], query);
  }
  for (const query of ["clemnt@example.invalid", "+330642000002", "0493000002"]) {
    assert.deepEqual(searchIndex(index, query), [], query);
  }
});

test("inaccessible contacts and companies never supply additional searchable fields", () => {
  assert.deepEqual(searchIndex(workerIndex([activeWorker], []), "clement"), []);
  assert.deepEqual(searchIndex(workerIndex([activeWorker], [company]), "riviera"), [], "A company alone cannot resolve an inaccessible linked person");
  assert.deepEqual(searchIndex(workerIndex([activeWorker], [person]), "riviera"), []);
  assert.deepEqual(searchIndex(workerIndex([activeWorker], [person]), "cannes"), []);
  const maskedPerson = { id: person.id, firstName: "Clément", companyId: company.id };
  const maskedCompany = { id: company.id, entityType: "company" as const };
  const index = workerIndex([activeWorker], [maskedPerson, maskedCompany]);
  assert.deepEqual(ids(searchIndex(index, "clement")), [activeWorker.id]);
  for (const query of ["martin", "cannes", "clement@example.invalid", "0642000001"]) {
    assert.deepEqual(searchIndex(index, query), [], query);
  }
});

test("historical workers remain searchable without a valid contact and never join through labels or missing IDs", () => {
  const stale = { ...activeWorker, contactId: "contact-removed-fixture", contactName: "Intervenant ancien", role: "Jardinage" };
  const missing = { ...activeWorker, id: "worker-missing-link", contactId: "", contactName: "Ancien sans lien", role: "Ménage" };
  const index = workerIndex([stale, missing], [person, company, { firstName: "Fantôme" }]);
  assert.deepEqual(ids(searchIndex(index, "ancien jardinage")), [stale.id]);
  assert.deepEqual(ids(searchIndex(index, "sans lien menage")), [missing.id]);
  for (const query of ["clement", "riviera", "fantome", "contact-removed-fixture", "undefined", "null"]) {
    assert.deepEqual(searchIndex(index, query), [], query);
  }
});

test("canonical company updates and consolidation are resolved by IDs without rewriting historical snapshots", () => {
  const oldCompany = { id: "old-agency", entityType: "company" as const, mergedIntoCompanyId: company.id };
  const movedPerson = { ...person, companyId: oldCompany.id };
  const renamedCompany = { ...company, companyName: "Agence Azur", city: "Menton" };
  const index = workerIndex([activeWorker], [movedPerson, oldCompany, renamedCompany]);
  assert.deepEqual(ids(searchIndex(index, "azur menton")), [activeWorker.id]);
  assert.deepEqual(searchIndex(index, "riviera cannes"), []);
  assert.equal(movedPerson.companyName, "Ancienne dénomination");
  assert.equal(activeWorker.contactName, "Libellé historique");
  assert.equal(activeWorker.contactId, person.id);
});

test("private metadata, notes, banking fields, documents and rates are excluded even when present in the projection", () => {
  const projected = { ...person, notes: "notesconfidentielles", source: "sourceconfidentielle",
    importantNotes: "importantconfidentiel", preferences: "preferencesconfidentielles",
    supplierPriceNotes: "tarifconfidentiel", supplierCommissionNotes: "commissionconfidentielle",
    supplierBankAccounts: [{ iban: "banqueconfidentielle", driveFileName: "ribconfidentiel" }] } as Partial<Contact>;
  const worker = { ...activeWorker, notes: "notesintervenant", documentFileName: "documentconfidentiel" };
  const index = workerIndex([worker], [projected, company]);
  for (const query of ["notesconfidentielles", "sourceconfidentielle", "importantconfidentiel", "preferencesconfidentielles",
    "tarifconfidentiel", "commissionconfidentielle", "banqueconfidentielle", "ribconfidentiel", "notesintervenant",
    "documentconfidentiel", String(worker.hourlyRate), worker.id, worker.contactId]) {
    assert.deepEqual(searchIndex(index, query), [], query);
  }
});

test("search leaves worker status, recorded rates, hours, expenses, payments and source spelling unchanged", () => {
  const worker = Object.freeze({ ...activeWorker, contactName: "  Libellé historique  " });
  const entries: HouseTimeEntry[] = [Object.freeze({ id: "entry-fixture", houseId: "house-fixture", houseName: "Maison fictive",
    workerId: worker.id, workerName: worker.contactName, date: "2026-01-02", startTime: "09:00", endTime: "12:30",
    breakMinutes: 15, hourlyRate: 20, expenseAmount: 8.75, expenseNote: "Achat fictif", createdAt: worker.createdAt })];
  const payments: HousePayment[] = [Object.freeze({ id: "payment-fixture", houseId: "house-fixture", houseName: "Maison fictive",
    workerId: worker.id, workerName: worker.contactName, date: "2026-01-03", amount: 30, method: "Virement", createdAt: worker.createdAt })];
  const before = structuredClone({ worker, person, company, entries, payments });
  const history = getHouseTrackingWorkerHistorySummary(worker.id, entries, payments);
  const index = workerIndex([worker]);
  for (const query of ["clemnt", "martin clem", "riviera canne", "cannse", "historique", "absent"]) searchIndex(index, query);
  assert.deepEqual({ worker, person, company, entries, payments }, before);
  assert.deepEqual(getHouseTrackingWorkerHistorySummary(worker.id, entries, payments), history);
  assert.deepEqual(history, { timeEntries: 1, payments: 1, hours: 3.25, due: 73.75, paid: 30, balance: 43.75 });
  assert.equal(worker.hourlyRate, 27.5, "Current worker rate does not replace the recorded intervention rate");
});
