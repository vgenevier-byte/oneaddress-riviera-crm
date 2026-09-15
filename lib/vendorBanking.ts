import type { Contact, VendorBankAccount, VendorInvoice } from "./types";

export const normalizeIban = (value: string) => value.replace(/\s/g, "").toUpperCase();
export const formatIban = (value: string) => normalizeIban(value).match(/.{1,4}/g)?.join(" ") || "";
export function maskIban(value: string) {
  const iban = normalizeIban(value);
  return iban.length < 9 ? "••••" : `${iban.slice(0, 4)} •••• •••• •••• ${iban.slice(-4)}`;
}
// Country lengths fail closed for unsupported countries rather than accepting arbitrary lengths.
const lengths: Record<string, number> = {
  AD:24, AE:23, AL:28, AT:20, AZ:28, BA:20, BE:16, BG:22, BH:22, BR:29,
  BY:28, CH:21, CR:22, CY:28, CZ:24, DE:22, DK:18, DO:28, EE:20, EG:29,
  ES:24, FI:18, FO:18, FR:27, GB:22, GE:22, GI:23, GL:18, GR:27, GT:28,
  HR:21, HU:28, IE:22, IL:23, IQ:23, IS:26, IT:27, JO:30, KW:30, KZ:20,
  LB:28, LC:32, LI:21, LT:20, LU:20, LV:21, MC:27, MD:24, ME:22, MK:19,
  MR:27, MT:31, MU:30, NL:18, NO:15, PK:24, PL:28, PS:29, PT:25, QA:29,
  RO:24, RS:22, SA:24, SC:31, SE:24, SI:19, SK:24, SM:27, ST:25, SV:28,
  TL:23, TN:24, TR:26, UA:29, VA:22, VG:24, XK:20
};
export function validateIban(value: string) {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban) || lengths[iban.slice(0, 2)] !== iban.length) return false;
  let remainder = 0;
  for (const char of iban.slice(4) + iban.slice(0, 4)) {
    for (const digit of /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}
export const normalizeBic = (value: string) => value.trim().toUpperCase();
export const validateBic = (value: string) => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(normalizeBic(value));
export const getVerifiedVendorBankAccounts = (contact?: Pick<Contact, "supplierBankAccounts"> | null) =>
  (contact?.supplierBankAccounts || []).filter(a => a.status === "Vérifié" && validateIban(a.iban) && validateBic(a.bic));
export const getPrimaryVendorBankAccount = (contact?: Pick<Contact, "supplierBankAccounts"> | null) =>
  getVerifiedVendorBankAccounts(contact).find(a => a.isPrimary);
export function hasBankAccountChange(contact: Pick<Contact, "supplierBankAccounts">, iban: string) {
  const primary = getPrimaryVendorBankAccount(contact);
  return Boolean(primary && normalizeIban(primary.iban) !== normalizeIban(iban));
}
export function addVendorBankAccount(accounts: VendorBankAccount[], account: VendorBankAccount) {
  if (!account.accountHolder.trim() || !validateIban(account.iban) || !validateBic(account.bic)) throw new Error("Coordonnées bancaires invalides.");
  if (accounts.some(a => a.id === account.id || (a.status !== "Archivé" && normalizeIban(a.iban) === normalizeIban(account.iban)))) throw new Error("Ce compte existe déjà.");
  return [...accounts, { ...account, iban: normalizeIban(account.iban), bic: normalizeBic(account.bic), status: "À vérifier" as const, isPrimary: false, verifiedAt: undefined, verifiedBy: undefined }];
}
export function updateBankAccountStatus(accounts: VendorBankAccount[], id: string, action: "verify" | "primary" | "archive", actor: string, now = new Date().toISOString()) {
  const account = accounts.find(a => a.id === id);
  if (!account || !actor.trim()) throw new Error("Compte ou acteur indisponible.");
  if (action !== "archive" && (account.status === "Archivé" || !validateIban(account.iban) || !validateBic(account.bic))) throw new Error("Compte non utilisable.");
  if (action === "primary" && account.status !== "Vérifié") throw new Error("Vérifiez le RIB avant utilisation.");
  const primary = action === "primary" || (action === "verify" && !getPrimaryVendorBankAccount({ supplierBankAccounts: accounts }));
  return accounts.map(a => a.id === id ? {
    ...a, status: action === "archive" ? "Archivé" as const : "Vérifié" as const,
    isPrimary: action === "archive" ? false : primary || a.isPrimary,
    ...(action === "verify" ? { verifiedAt: now, verifiedBy: actor } : {}), updatedAt: now, updatedBy: actor
  } : primary && a.isPrimary ? { ...a, isPrimary: false, updatedAt: now, updatedBy: actor } : a);
}
export const getInvoicePaymentReference = (invoice: Pick<VendorInvoice, "invoiceReference" | "title">) => invoice.invoiceReference?.trim() || invoice.title;
export function selectInvoiceBankAccount(invoice: VendorInvoice, contact: Contact, id: string): VendorInvoice {
  if (invoice.contactId !== contact.id || !getVerifiedVendorBankAccounts(contact).some(a => a.id === id)) throw new Error("Compte vérifié requis.");
  if (invoice.paidAmount > 0 && invoice.paymentBankAccountId && invoice.paymentBankAccountId !== id) throw new Error("Le compte d’un paiement enregistré ne peut plus être remplacé.");
  return { ...invoice, paymentBankAccountId: id };
}
