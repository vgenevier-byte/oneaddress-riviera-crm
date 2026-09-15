import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addVendorBankAccount, formatIban, getInvoicePaymentReference, getPrimaryVendorBankAccount, getVerifiedVendorBankAccounts, hasBankAccountChange, maskIban, normalizeBic, normalizeIban, selectInvoiceBankAccount, updateBankAccountStatus, validateBic, validateIban } from "../lib/vendorBanking";
import { normalizeVendorInvoiceFinancials } from "../lib/vendorFinance";
import { fictionalAccount as a, fictionalContact as c, fictionalInvoice as invoice, fictionalIban } from "./fixtures/vendorBanking";

test("IBAN fictif : normalisation, espaces, modulo 97, format", () => {
 assert.equal(normalizeIban(formatIban(a.iban).toLowerCase()), a.iban);
 assert.equal(validateIban(formatIban(a.iban)), true);
 assert.equal(validateIban(a.iban.slice(0, -1) + "9"), false);
 assert.equal(validateIban("FR00invalid"), false);
 assert.equal(validateIban("ZZ00" + "0".repeat(23)), false);
 assert.equal(validateIban(a.iban + "0"), false);
});
test("BIC standard 8 ou 11 caractères", () => {
 assert.equal(normalizeBic(" testfrp0xxx "), "TESTFRP0XXX");
 for (const value of ["TESTFRP0", "TESTFRP0XXX"]) assert.equal(validateBic(value), true);
 for (const value of ["TESTFR", "TEST12P0", "TESTFRP0XX", "TEST FRP0"]) assert.equal(validateBic(value), false);
});
test("masquage n’expose pas l’IBAN", () => { assert.equal(maskIban(a.iban).includes(a.iban), false); assert.ok(maskIban(a.iban).endsWith("0001")); assert.equal(maskIban("FR1"), "••••"); });
test("ancien contact et ancienne facture sans champs bancaires", () => {
 assert.equal(getPrimaryVendorBankAccount({}), undefined); assert.deepEqual(getVerifiedVendorBankAccounts({}), []);
 assert.equal(getInvoicePaymentReference({ title: "Titre ancien" }), "Titre ancien");
 assert.equal(normalizeVendorInvoiceFinancials({ ...invoice, invoiceReference: undefined, paymentBankAccountId: undefined }).paymentBankAccountId, undefined);
});
test("nouveau compte toujours à vérifier, sans remplacement du principal", () => {
 const accounts = addVendorBankAccount([a], { ...a, id: "b", iban: fictionalIban("02") });
 assert.equal(accounts[1].status, "À vérifier"); assert.equal(accounts[1].isPrimary, false); assert.equal(accounts[1].verifiedAt, undefined);
 assert.equal(getPrimaryVendorBankAccount({ supplierBankAccounts: accounts })?.id, a.id);
 assert.equal(getVerifiedVendorBankAccounts({ supplierBankAccounts: accounts }).length, 1);
 assert.equal(hasBankAccountChange(c, accounts[1].iban), true);
 assert.throws(() => selectInvoiceBankAccount(invoice, { ...c, supplierBankAccounts: accounts }, "b"));
 assert.throws(() => addVendorBankAccount(accounts, { ...a, id: "dup" }));
});
test("vérification explicite et plusieurs comptes, principal explicite", () => {
 const added = addVendorBankAccount([a], { ...a, id: "b", iban: fictionalIban("02") });
 const verified = updateBankAccountStatus(added, "b", "verify", "Acteur test", "2026-09-11T10:00:00Z");
 assert.equal(verified[1].verifiedBy, "Acteur test"); assert.equal(verified[1].isPrimary, false);
 assert.equal(getVerifiedVendorBankAccounts({ supplierBankAccounts: verified }).length, 2);
 const primary = updateBankAccountStatus(verified, "b", "primary", "Acteur test");
 assert.equal(primary[0].isPrimary, false); assert.equal(primary[0].status, "Vérifié"); assert.equal(primary[1].isPrimary, true);
});
test("première vérification peut devenir principale, archivage sans suppression", () => {
 const first = updateBankAccountStatus(addVendorBankAccount([], a), a.id, "verify", "Acteur test");
 assert.equal(first[0].isPrimary, true);
 const archived = updateBankAccountStatus(first, a.id, "archive", "Acteur test");
 assert.equal(archived.length, 1); assert.equal(archived[0].status, "Archivé"); assert.equal(archived[0].isPrimary, false);
 assert.equal(getPrimaryVendorBankAccount({ supplierBankAccounts: archived }), undefined);
 assert.throws(() => updateBankAccountStatus(archived, a.id, "primary", "Acteur test"));
});
test("virement et compte archivé restent traçables, changement interdit après paiement", () => {
 const chosen = selectInvoiceBankAccount(invoice, c, a.id);
 const paid = normalizeVendorInvoiceFinancials({ ...chosen, paymentMethod: "Virement", status: "Payé", paidAmount: 268 });
 const accounts = updateBankAccountStatus([a], a.id, "archive", "Acteur test");
 assert.equal(accounts.find(x => x.id === paid.paymentBankAccountId)?.id, a.id);
 assert.throws(() => selectInvoiceBankAccount(paid, { ...c, supplierBankAccounts: [{ ...a, id: "other", iban: fictionalIban("02") }] }, "other"));
 assert.throws(() => selectInvoiceBankAccount(invoice, { ...c, id: "different" }, a.id));
});
test("référence facultative, explicite conservée", () => {
 assert.equal(getInvoicePaymentReference({ title: "Titre", invoiceReference: "  " }), "Titre");
 assert.equal(getInvoicePaymentReference(invoice), "TEST-001");
});
test("aucun log bancaire ou coordonnée dans les URLs / noms du transport", () => {
 const ui = readFileSync("components/VendorBanking.tsx", "utf8");
 const route = readFileSync("app/api/drive/vendor-bank-accounts/upload/handler.ts", "utf8");
 for (const source of [ui, route, readFileSync("lib/vendorBanking.ts", "utf8")]) assert.doesNotMatch(source, /console\.(log|error|warn)/);
 assert.doesNotMatch(ui, /(?:\?|&)(?:iban|bic)=/i);
 assert.match(route, /multipart\.append\("file", file, fileName\)/);
 assert.doesNotMatch(route, /account\.iban|form\.get\("iban"\)/);
});
