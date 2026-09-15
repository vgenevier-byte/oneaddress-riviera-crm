import type { Contact, VendorBankAccount, VendorInvoice } from "../../lib/types";
// Synthetic IBAN: zero bank/branch codes, generated checksum. No real beneficiary.
export function fictionalIban(suffix = "01") {
  const bban = "000000000000000000000" + suffix;
  const remainder = BigInt(bban + "152700") % BigInt(97);
  return "FR" + String(BigInt(98) - remainder).padStart(2, "0") + bban;
}
export const fictionalAccount: VendorBankAccount = { id: "bank-test-1", label: "Compte de démonstration", documentProvider: "google-drive", driveFileId: "fictional-rib-file", driveFileName: "RIB_DEMONSTRATION.pdf", accountHolder: "Prestataire Fictif", iban: fictionalIban(), bic: "TESTFRP0XXX", bankName: "Banque fictive", status: "Vérifié", isPrimary: true, verifiedAt: "2026-09-11T10:00:00Z", verifiedBy: "Acteur test", createdAt: "2026-09-11T09:00:00Z" };
export const fictionalContact: Contact = { id: "vendor-test", name: "Prestataire Fictif", kind: "Prestataire", companyName: "Atelier Démonstration", email: "", phone: "", city: "Nice", postalAddress: "", budget: 0, source: "", notes: "Données fictives de validation", createdAt: "2026-09-11", supplierBankAccounts: [fictionalAccount] };
export const fictionalInvoice: VendorInvoice = { id: "invoice-test", contactId: fictionalContact.id, contactName: "Atelier Démonstration", category: "Entretien", title: "Intervention de démonstration", invoiceReference: "TEST-001", amount: 268, paidAmount: 0, status: "À payer", invoiceDate: "2026-09-11", dueDate: "2026-09-20", createdAt: "2026-09-11" };
