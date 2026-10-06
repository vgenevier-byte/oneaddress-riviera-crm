import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { getContactFormUpdate, mergeContactUpdate, readPostalAddress } from "../lib/contactEditing";
import { isEligibleVendorContact, isEligibleVendorBankContact } from "../lib/vendorContacts";
import { getHouseTrackingWorkerHistorySummary } from "../lib/houseTracking";
import { buildMonthlyCharges } from "../lib/monthlyCharges/calculations";
import { fictionalContact, fictionalAccount, fictionalInvoice } from "./fixtures/vendorBanking";
import type { Contact, HousePayment, HouseTimeEntry, HouseTrackingWorker } from "../lib/types";
import type { MonthlyChargesSnapshot } from "../lib/monthlyCharges/types";

const memberKind = "Membre de l’organisation";
const source = readFileSync("components/CRMApp.tsx", "utf8");
function handler(name: string, bindings: Record<string, unknown> = {}, file = source, scope?: string) {
  const ast = ts.createSourceFile("handler.tsx", file, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let parent: ts.Node = ast;
  function find(root: ts.Node, target: string): ts.FunctionDeclaration | undefined {
    let found: ts.FunctionDeclaration | undefined;
    function visit(node: ts.Node) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === target) found = node;
      ts.forEachChild(node, visit);
    }
    visit(root); return found;
  }
  if (scope) { const node = find(ast, scope); assert.ok(node, scope); parent = node; }
  const declaration = find(parent, name); assert.ok(declaration, name);
  const js = ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return ${name};`)(...Object.values(bindings));
}

const historical: Contact = { ...fictionalContact, supplierCategory: "Entretien", relationshipStatus: "Prestataire", supplierZone: "Zone fictive", supplierPriceNotes: "Tarif historique", supplierStatus: "Actif", budget: 1234, preferences: "Anciennes préférences", importantNotes: "Historique conservé", supplierBankAccounts: [fictionalAccount] };

for (const organizationFunction of ["Responsable fictif", ""]) {
  test(`création membre par le handler existant, fonction ${organizationFunction ? "renseignée" : "facultative"}`, () => {
    const form = new FormData(); form.set("kind", memberKind); form.set("name", "Membre Fictif"); form.set("organizationFunction", organizationFunction);
    let state = { contacts: [] as Contact[] };
    const add = handler("addContact", {
      FormData: class { constructor() { return form; } }, readPostalAddress, makeId: () => "member-test", stampCreated: (c: Contact) => c,
      activeActor: "Acteur fictif", safeNumber: (v: unknown) => Number(v) || 0, getSupplierCategoryFromForm: () => { throw new Error("Aucun champ fournisseur requis"); },
      confirmDuplicateContact: () => true, setData: (fn: (s: typeof state) => typeof state) => { state = fn(state); }, notify: () => {}, window: { setTimeout: () => {} }
    });
    add({ preventDefault() {}, currentTarget: { reset() {} } });
    assert.equal(state.contacts[0].kind, memberKind); assert.equal(state.contacts[0].organizationFunction, organizationFunction);
    assert.equal(state.contacts[0].budget, 0); assert.equal(state.contacts[0].supplierCategory, "");
    assert.equal(isEligibleVendorContact(state.contacts[0]), false);
    const row = handler("contactToSupabaseRow")(state.contacts[0], "owner-test");
    const reloaded = handler("contactFromSupabaseRow")(row);
    assert.equal(reloaded.kind, memberKind); assert.equal(reloaded.organizationFunction, organizationFunction);
  });
}

test("reclassement réel du formulaire conserve historique et modifications concurrentes sans reclassification fournisseur", () => {
  const form = new FormData(); form.set("kind", memberKind); form.set("organizationFunction", "  Coordination fictive  ");
  const latest = { ...historical, notes: "Note concurrente" };
  let captured: (Pick<Contact, "id"> & Partial<Contact>) | undefined;
  let selected: Contact | undefined;
  const submit = handler("submitEdit", {
    FormData: class { constructor() { return form; } }, editingContact: historical, contacts: [latest], normalizeKind: handler("normalizeKind", {}, source, "ContactsView"),
    readPostalAddress, safeNumber: (v: unknown) => Number(v) || 0, getContactClientLevel: handler("getContactClientLevel"), getContactPreferredLanguage: handler("getContactPreferredLanguage"),
    getContactRelationshipStatus: handler("getContactRelationshipStatus"), getSupplierCategoryFromForm: () => { throw Error("Supplier form not mounted"); }, getContactFormUpdate, mergeContactUpdate,
    changedContactFields: { current: new Set(["kind", "organizationFunction"]) }, onUpdate: (patch: Pick<Contact, "id"> & Partial<Contact>) => { captured = patch; },
    edition: { submit: (_form: unknown, save: () => void, after: (newer: boolean) => void) => { save(); after(false); } },
    setEditingContact: () => {}, setSelectedContact: (c: Contact) => { selected = c; }
  }, source, "ContactsView");
  submit({ preventDefault() {}, currentTarget: {} });
  assert.deepEqual(captured, { id: historical.id, kind: memberKind, organizationFunction: "Coordination fictive" });
  assert.deepEqual(selected, { ...latest, kind: memberKind, organizationFunction: "Coordination fictive" });
  assert.equal(handler("isSupplierContact")(selected), false); assert.equal(isEligibleVendorContact(selected!), false);
  assert.equal(isEligibleVendorBankContact(selected!), true);
  assert.equal(isEligibleVendorBankContact({ ...selected!, supplierBankAccounts: [] }), false);
  assert.deepEqual(selected!.supplierBankAccounts, historical.supplierBankAccounts);
  assert.equal(selected!.supplierCategory, "Entretien"); assert.equal(selected!.relationshipStatus, "Prestataire");
  assert.deepEqual(getContactFormUpdate({ ...selected!, organizationFunction: "" }, ["organizationFunction"]), { organizationFunction: "" });
  assert.deepEqual(getContactFormUpdate({ ...selected!, notes: "Note" }, ["notes"]), { notes: "Note" });
});

test("handler contributeur accepte le nouveau type sans effacer les données fournisseur du même identifiant", () => {
  const form = new FormData(); form.set("kind", memberKind); form.set("name", "Membre Fictif"); form.set("organizationFunction", "Coordination");
  const catalog = JSON.parse(readFileSync("lib/access/collections.json", "utf8"));
  const schema = catalog.find((item: {collection:string}) => item.collection === "contacts");
  assert.ok(schema.fields.kind.enum.includes(memberKind));
  let saved: Record<string, unknown> | undefined;
  const save = handler("form", {
    FormData: class { constructor() { return form; } }, schema: () => schema, save: (_collection: string, row: Record<string, unknown>) => { saved = row; },
    parseEuroAmount: Number, parseAssetKey: () => ({}), crypto: { randomUUID: () => "unused-new-id" }, setMessage: () => {}, isValidPlanningDate: () => true
  }, readFileSync("components/ModuleWorkspace.tsx", "utf8"), "ModuleWorkspace");
  save("contacts", { preventDefault() {}, currentTarget: { dataset: { savedRecordId: historical.id } } });
  assert.deepEqual(saved, { id: historical.id, name: "Membre Fictif", kind: memberKind, organizationFunction: "Coordination" });
  assert.deepEqual(mergeContactUpdate(historical, saved as Partial<Contact>), { ...historical, name: "Membre Fictif", kind: memberKind, organizationFunction: "Coordination" });
});

test("reclassement du même contact conserve liens, montants historiques et Charges mensuelles", () => {
  const worker: HouseTrackingWorker = { id: "worker-test", contactId: historical.id, contactName: historical.name, role: "Entretien", hourlyRate: 30, status: "Actif", createdAt: "2026-09-01" };
  const entry: HouseTimeEntry = { id: "entry-test", houseId: "house-test", houseName: "Maison fictive", workerId: worker.id, workerName: historical.name, date: "2026-09-15", startTime: "08:07", endTime: "12:42", breakMinutes: 0, hourlyRate: 20, createdAt: "2026-09-15" };
  const payment: HousePayment = { id: "payment-test", houseId: "house-test", houseName: "Maison fictive", workerId: worker.id, workerName: historical.name, date: "2026-09-16", amount: 30, method: "Virement", createdAt: "2026-09-16" };
  let state = { contacts: [historical], houseTrackingWorkers: [worker], houseTimeEntries: [entry], housePayments: [payment], vendorInvoices: [fictionalInvoice], documents: [{ id: "document-test", contactId: historical.id }], tasks: [{ id: "task-test", contactId: historical.id }] };
  const before = structuredClone(state), summary = getHouseTrackingWorkerHistorySummary(worker.id, state.houseTimeEntries, state.housePayments);
  const snapshot: MonthlyChargesSnapshot = { revision: "0", sourceRevision: "0", config: { personRules: [{ source: "invoice", personId: historical.id, included: true }, { source: "hours", personId: worker.id, included: true }], exceptions: [], attachments: [] }, sources: { invoices: [{ id: fictionalInvoice.id, personId: historical.id, personLabel: historical.name, title: fictionalInvoice.title, invoiceDate: fictionalInvoice.invoiceDate, amount: fictionalInvoice.amount, status: fictionalInvoice.status }], timeEntries: [{ ...entry, personId: worker.id, personLabel: historical.name }], suppliers: [{ id: historical.id, label: historical.name }], workers: [{ id: worker.id, label: historical.name, status: "Actif" }], houses: [{ id: "house-test", name: "Maison fictive" }] }, permissions: { canContribute: true, readableSources: ["invoice", "hours"], exportableSources: ["invoice", "hours"], contactsVisible: true } };
  const total = buildMonthlyCharges(snapshot, 2026, { now: "2026-10-06" }).totalCents;
  handler("updateContact", { mergeContactUpdate, activeActor: "Fictif", stampUpdated: (c: Contact) => c, setData: (fn: (s: typeof state) => typeof state) => { state = fn(state); }, notify: () => {} })({ id: historical.id, kind: memberKind, organizationFunction: "Équipe fictive" });
  assert.deepEqual(state, { ...before, contacts: [{ ...historical, kind: memberKind, organizationFunction: "Équipe fictive" }] });
  assert.deepEqual(getHouseTrackingWorkerHistorySummary(worker.id, state.houseTimeEntries, state.housePayments), summary);
  assert.equal(buildMonthlyCharges(snapshot, 2026, { now: "2026-10-06" }).totalCents, total); assert.equal(total, 35967);
});

test("export Contacts conserve le type et Fonction dans des colonnes alignées", () => {
  const contact = { ...historical, kind: memberKind, organizationFunction: 'Coordination, "Équipe"' };
  let csv = "";
  handler("exportCRMAsCsv", { getContactClientLevel: handler("getContactClientLevel"), getContactPreferredLanguage: handler("getContactPreferredLanguage"), getContactRelationshipStatus: handler("getContactRelationshipStatus"), toCsv: handler("toCsv", { csvEscape: handler("csvEscape") }), downloadTextFile: (_name: string, content: string) => { csv = content; } })({ contacts: [contact], leads: [], properties: [], vehicles: [], boats: [], tasks: [], planningEntries: [] });
  assert.match(csv, /Notes,Fonction\n/); assert.ok(csv.includes(memberKind)); assert.ok(csv.includes('"Coordination, ""Équipe"""'));
});

test("rechargement du workspace JSON conserve le membre et ne réimporte pas son ancien prestataire", () => {
  const member = { ...historical, kind: memberKind, organizationFunction: "Coordination fictive" };
  const normalize = handler("normalizeSharedCRMData", {
    mergeContactsWithLegacySuppliers: handler("mergeContactsWithLegacySuppliers", { supplierToContact: handler("supplierToContact") })
  });
  const payload = JSON.parse(JSON.stringify({ contacts: [member], suppliers: [{ id: "old-supplier", name: member.name, category: member.supplierCategory }] }));
  const before = structuredClone(payload);
  const reloaded = normalize(payload);
  assert.deepEqual(reloaded.contacts, [member]); assert.deepEqual(payload, before);
  assert.equal(handler("isSupplierContact")(reloaded.contacts[0]), false);
  assert.equal(isEligibleVendorContact(reloaded.contacts[0]), false);
});
