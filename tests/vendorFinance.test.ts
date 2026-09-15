import assert from "node:assert/strict";
import test from "node:test";
import type { VendorInvoice, VendorQuote } from "../lib/types";
import {
  createPendingVendorInvoiceFromQuote, validateVendorQuoteIdempotently, preserveVendorQuoteIdentity,
  findVendorInvoiceDuplicates, canSaveVendorInvoice, isOrphanAutomaticVendorInvoice,
  isEmptyAutomaticVendorInvoice, getVendorQuoteDeletionPlan, deleteVendorQuoteWithDecision,
  deleteOrphanAutomaticVendorInvoice
} from "../lib/vendorFinance";

const quote = (id = "quote-fictional"): VendorQuote => ({ id, contactId: "vendor-fictional", contactName: "Jardins fictifs",
  category: "Paysagiste", title: "Entretien", quoteReference: "DEV-TEST", quoteDate: "2026-01-01",
  validUntil: "", amount: 500, status: "À valider", createdAt: "2026-01-01T12:00:00Z" });
const automatic = (id = "invoice-fictional", q = quote()) => createPendingVendorInvoiceFromQuote(q, id, undefined, "2026-01-01T12:00:00Z");
const recurring = (id: string, month: string, amount = 500): VendorInvoice => ({ ...automatic(id),
  sourceQuoteId: "", sourceQuoteReference: "", notes: "", title: "Entretien", amount,
  invoiceDate: `2026-${month}-01`, status: "À payer" });

test("1 même devis validé deux fois : une facture, mêmes données", () => {
  const first = validateVendorQuoteIdempotently({ vendorQuotes: [quote()], vendorInvoices: [] }, quote().id, "one", "2026-01-01");
  const second = validateVendorQuoteIdempotently(first, quote().id, "two", "2026-01-02");
  assert.deepEqual(second, first);
  assert.equal(second.vendorInvoices.length, 1);
});
test("2 linkedInvoiceId prioritaire même si sourceQuoteId concurrent est placé avant", () => {
  const q = { ...quote(), linkedInvoiceId: "preferred" };
  const invoices = [automatic("other"), { ...recurring("preferred", "01"), paymentBankAccountId: "fictional-bank" }];
  const next = validateVendorQuoteIdempotently({ vendorQuotes: [q], vendorInvoices: invoices }, q.id, "unused");
  assert.equal(next.vendorQuotes[0].linkedInvoiceId, "preferred");
  assert.deepEqual(next.vendorInvoices, invoices);
});
test("3 sourceQuoteId réutilisé et lien restauré", () => {
  const invoice = automatic();
  const next = validateVendorQuoteIdempotently({ vendorQuotes: [quote()], vendorInvoices: [invoice] }, quote().id, "unused");
  assert.equal(next.vendorInvoices.length, 1);
  assert.equal(next.vendorQuotes[0].linkedInvoiceId, invoice.id);
});
test("lien explicite absent : refus, aucune nouvelle facture silencieuse", () => {
  assert.throws(() => validateVendorQuoteIdempotently({ vendorQuotes: [{ ...quote(), linkedInvoiceId: "missing" }] }, quote().id, "new"), /introuvable/);
});
test("4 même prestataire montant titre, mois différents : autorisés", () => {
  assert.equal(canSaveVendorInvoice(recurring("feb", "02"), [recurring("jan", "01")]), true);
});
test("5 trois mensualités identiques de 500 : toutes autorisées", () => {
  const invoices: VendorInvoice[] = [];
  for (const month of ["01", "02", "03"]) {
    const invoice = recurring(month, month);
    assert.equal(canSaveVendorInvoice(invoice, invoices), true);
    invoices.push(invoice);
  }
  assert.equal(invoices.length, 3);
});
test("6 deux factures trimestrielles de 268 : autorisées", () => {
  assert.deepEqual(findVendorInvoiceDuplicates(recurring("jun", "06", 268), [recurring("mar", "03", 268)]), []);
});
test("7 même fournisseur même référence non vide : avertissement", () => {
  const candidate = { ...recurring("two", "02"), invoiceReference: " 001 " };
  const old = { ...recurring("one", "01"), invoiceReference: "001" };
  assert.equal(findVendorInvoiceDuplicates(candidate, [old])[0].reason, "invoiceReference");
  assert.equal(canSaveVendorInvoice(candidate, [old]), false);
});
test("8 créer quand même reste autorisé", () => {
  const a = { ...recurring("a", "01"), invoiceReference: "001" };
  assert.equal(canSaveVendorInvoice({ ...a, id: "b" }, [a], true), true);
});
test("9 devis avec facture auto vide : décision exigée", () => {
  const state = { vendorQuotes: [quote()], vendorInvoices: [automatic()] };
  assert.equal(getVendorQuoteDeletionPlan(state, quote().id).canDeleteInvoices, true);
  assert.throws(() => deleteVendorQuoteWithDecision(state, quote().id), /explicitement/);
});
test("10 suppression conjointe ne laisse aucun orphelin et préserve le reste", () => {
  const other = recurring("other", "01");
  const state = { contacts: [{ id: "unrelated" }], vendorQuotes: [quote()], vendorInvoices: [automatic(), other] };
  const next = deleteVendorQuoteWithDecision(state, quote().id, "delete-both");
  assert.deepEqual(next.vendorQuotes, []);
  assert.deepEqual(next.vendorInvoices, [other]);
  assert.equal(next.contacts, state.contacts);
});
test("conserver facture : décision explicite, données et provenance intactes", () => {
  const invoice = automatic();
  const next = deleteVendorQuoteWithDecision({ vendorQuotes: [quote()], vendorInvoices: [invoice] }, quote().id, "keep-invoice");
  assert.equal(next.vendorInvoices[0], invoice);
  assert.equal(isOrphanAutomaticVendorInvoice(invoice, next.vendorQuotes), true);
});
test("11 facture réelle : jamais supprimée automatiquement", () => {
  const invoice = { ...automatic(), invoiceDocumentStoragePath: "fictional/invoice.pdf" };
  const state = { vendorQuotes: [quote()], vendorInvoices: [invoice] };
  assert.equal(getVendorQuoteDeletionPlan(state, quote().id).canDeleteInvoices, false);
  assert.throws(() => deleteVendorQuoteWithDecision(state, quote().id, "delete-both"), /refusée/);
  assert.equal(deleteVendorQuoteWithDecision(state, quote().id, "keep-invoice").vendorInvoices[0], invoice);
});
test("12 modifier devis conserve ID, création et lien actuel malgré un formulaire périmé", () => {
  const current = { ...quote(), linkedInvoiceId: "current-invoice" };
  const edited = { ...quote("other-id"), title: "Entretien modifié", linkedInvoiceId: "" };
  const saved = preserveVendorQuoteIdentity(current, edited);
  assert.equal(saved.id, current.id); assert.equal(saved.linkedInvoiceId, current.linkedInvoiceId);
  assert.equal(saved.createdAt, current.createdAt); assert.equal(saved.title, edited.title);
});
test("13 automatique sans devis : orpheline, même avec ancien sourceQuoteId effacé", () => {
  assert.equal(isOrphanAutomaticVendorInvoice(automatic(), []), true);
  assert.equal(isOrphanAutomaticVendorInvoice({ ...automatic(), sourceQuoteId: "", status: "À payer" }, []), true);
  assert.equal(isOrphanAutomaticVendorInvoice(automatic(), [quote()]), false);
  assert.equal(isOrphanAutomaticVendorInvoice(automatic(), [{ ...quote("other"), linkedInvoiceId: automatic().id }]), false);
});
for (const [label, patch] of Object.entries({
  "14 paiement": { paidAmount: 0.01 }, "15 PDF": { invoiceDocumentStoragePath: "fictional.pdf" },
  "compte bancaire": { paymentBankAccountId: "fictional-bank" }, "date facture": { invoiceDate: "2026-01-01" },
  "référence": { invoiceReference: "001" }, "document lié": { linkedDocumentId: "fictional-doc" },
  "nom document sans chemin": { invoiceDocumentName: "fictional.pdf" }, "moyen paiement": { paymentMethod: "CB" },
  "date paiement": { dueDate: "2026-01-01" }, "paiement historique": { payments: [{ amount: 1 }] },
  "document historique": { documents: [{ id: "fictional-doc" }] }, "réception": { invoiceReceivedAt: "2026-01-01" }
})) test(`suppression orpheline refusée : ${label}`, () => {
  const invoice = { ...automatic(), ...patch };
  assert.equal(isEmptyAutomaticVendorInvoice(invoice), false);
  assert.throws(() => deleteOrphanAutomaticVendorInvoice({ vendorInvoices: [invoice], vendorQuotes: [] }, invoice.id), /refusée/);
});
test("16 aucun matching montant, titre, catégorie, dates proches ou identiques", () => {
  const a = recurring("a", "01");
  for (const patch of [{}, { title: "Entretien proche" }, { amount: 500.01 }, { category: "Autre" }, { invoiceDate: "2026-01-02" }])
    assert.deepEqual(findVendorInvoiceDuplicates({ ...a, ...patch, id: "b" }, [a]), []);
});
test("références vides ou fournisseurs distincts : aucun avertissement", () => {
  const a = { ...recurring("a", "01"), invoiceReference: "  " };
  assert.deepEqual(findVendorInvoiceDuplicates({ ...a, id: "b" }, [a]), []);
  assert.deepEqual(findVendorInvoiceDuplicates({ ...a, invoiceReference: "001", id: "b", contactId: "other" }, [{ ...a, invoiceReference: "001" }]), []);
});
test("même document par ID Drive, document lié ou chemin : avertissement", () => {
  for (const patch of [{ linkedDocumentId: "fictional-doc" }, { invoiceDocumentStoragePath: "fictional/path.pdf" }]) {
    const a = { ...recurring("a", "01"), ...patch };
    assert.equal(findVendorInvoiceDuplicates({ ...a, id: "b" }, [a])[0].reason, "document");
  }
  const a = { ...recurring("a", "01"), invoiceDocumentUrl: "https://drive.google.com/file/d/fictional-drive-id/view" };
  const b = { ...recurring("b", "02"), invoiceDocumentUrl: "https://drive.google.com/open?id=fictional-drive-id" };
  assert.equal(findVendorInvoiceDuplicates(b, [a])[0].reason, "document");
});
test("réédition de la même facture ne se signale pas elle-même", () => {
  const a = { ...automatic(), invoiceReference: "001" };
  assert.deepEqual(findVendorInvoiceDuplicates(a, [a]), []);
});
test("sourceQuoteId identique est un signal fort même à des dates différentes", () => {
  assert.equal(findVendorInvoiceDuplicates({ ...automatic("b"), invoiceDate: "2026-02-01" }, [automatic("a")])[0].reason, "sourceQuoteId");
});
test("référence externe ou autre devis : suppression conjointe et nettoyage refusés", () => {
  const invoice = automatic();
  const state = { vendorQuotes: [quote()], vendorInvoices: [invoice], documents: [{ invoiceId: invoice.id }] };
  assert.equal(getVendorQuoteDeletionPlan(state, quote().id).canDeleteInvoices, false);
  assert.throws(() => deleteVendorQuoteWithDecision(state, quote().id, "delete-both"), /refusée/);
  assert.throws(() => deleteOrphanAutomaticVendorInvoice({ ...state, vendorQuotes: [] }, invoice.id), /refusée/);
  const shared = { ...state, documents: [], vendorQuotes: [quote(), { ...quote("second"), linkedInvoiceId: invoice.id }] };
  assert.equal(getVendorQuoteDeletionPlan(shared, quote().id).canDeleteInvoices, false);
});
test("suppression réévalue les données après la confirmation", () => {
  const invoice = automatic();
  const initial = { vendorQuotes: [quote()], vendorInvoices: [invoice] };
  assert.equal(getVendorQuoteDeletionPlan(initial, quote().id).canDeleteInvoices, true);
  const changed = { ...initial, vendorInvoices: [{ ...invoice, paidAmount: 10 }] };
  assert.throws(() => deleteVendorQuoteWithDecision(changed, quote().id, "delete-both"), /refusée/);
});
test("nettoyage orphelin retire une seule facture", () => {
  const state = { vendorQuotes: [], vendorInvoices: [automatic(), recurring("other", "01")] };
  assert.deepEqual(deleteOrphanAutomaticVendorInvoice(state, automatic().id).vendorInvoices, [state.vendorInvoices[1]]);
});
test("revalidation préserve intégralement une facture réelle ou déjà préparée au paiement", () => {
  for (const patch of [{ invoiceDate: "2026-01-01" }, { paymentBankAccountId: "fictional-bank" }, { paidAmount: 10 }, { linkedDocumentId: "fictional-doc" }]) {
    const invoice = { ...automatic(), ...patch };
    assert.deepEqual(createPendingVendorInvoiceFromQuote({ ...quote(), amount: 999 }, invoice.id, invoice), invoice);
  }
});

test("refus puis revalidation : réactive uniquement la facture automatique vide, même ID", () => {
  const invoice = { ...automatic(), status: "Annulé" as const };
  const state = { vendorQuotes: [{ ...quote(), status: "Refusé" as const, linkedInvoiceId: invoice.id }], vendorInvoices: [invoice] };
  const next = validateVendorQuoteIdempotently(state, quote().id, "unused");
  assert.deepEqual(next.vendorInvoices, [{ ...invoice, status: "En attente de facture" }]);
  const used = { ...invoice, invoiceDate: "2026-01-01" };
  assert.deepEqual(validateVendorQuoteIdempotently({ ...state, vendorInvoices: [used] }, quote().id, "unused").vendorInvoices, [used]);
});
