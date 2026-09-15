import type { VendorInvoice, VendorQuote } from "./types";
import {
  euroAmountToCents,
  getRemainingEuroAmount,
  normalizeEuroAmount,
  sumEuroAmounts
} from "./currency";

export function normalizeVendorQuoteFinancials(quote: VendorQuote): VendorQuote {
  return {
    ...quote,
    amount: normalizeEuroAmount(quote.amount)
  };
}

export function normalizeVendorInvoiceFinancials(invoice: VendorInvoice): VendorInvoice {
  return {
    ...invoice,
    amount: normalizeEuroAmount(invoice.amount),
    paidAmount: normalizeEuroAmount(invoice.paidAmount)
  };
}

export function getVendorInvoiceStatus(
  amount: unknown,
  paidAmount: unknown,
  dueDate?: string,
  today = new Date()
): VendorInvoice["status"] {
  const amountCents = euroAmountToCents(amount);
  const paidAmountCents = euroAmountToCents(paidAmount);

  if (amountCents > 0 && paidAmountCents >= amountCents) return "Payé";
  if (paidAmountCents > 0 && paidAmountCents < amountCents) return "Partiellement payé";

  if (dueDate) {
    const currentDay = new Date(today);
    currentDay.setHours(0, 0, 0, 0);

    const due = new Date(`${dueDate}T00:00:00`);
    due.setHours(0, 0, 0, 0);

    if (!Number.isNaN(due.getTime()) && due.getTime() < currentDay.getTime()) {
      return "En retard";
    }
  }

  return "À payer";
}

export function getVendorInvoiceRemaining(invoice: Pick<VendorInvoice, "amount" | "paidAmount">) {
  return getRemainingEuroAmount(invoice.amount, invoice.paidAmount);
}

export function getVendorInvoiceTotalRemaining(
  invoices: Array<Pick<VendorInvoice, "amount" | "paidAmount">>
) {
  return sumEuroAmounts(invoices.map(getVendorInvoiceRemaining));
}

export function createPendingVendorInvoiceFromQuote(
  quote: VendorQuote,
  invoiceId: string,
  existingInvoice?: VendorInvoice,
  createdAt = new Date().toISOString()
): VendorInvoice {
  const hasInvoiceDocument = Boolean(
    existingInvoice?.invoiceDocumentStoragePath || existingInvoice?.invoiceDocumentUrl
  );
  const amount = normalizeEuroAmount(
    hasInvoiceDocument ? existingInvoice?.amount : quote.amount
  );
  const paidAmount = normalizeEuroAmount(existingInvoice?.paidAmount ?? 0);

  if (existingInvoice) {
    // Revalidation must preserve the actual invoice, including payment/business data.
    if (!isEmptyAutomaticVendorInvoice(existingInvoice)) return existingInvoice;
    return {
      ...existingInvoice,
      contactId: quote.contactId,
      contactName: quote.contactName,
      contactPersonName: quote.contactPersonName,
      category: quote.category,
      title: hasInvoiceDocument
        ? existingInvoice.title
        : `Facture attendue · ${quote.title}`,
      amount,
      paidAmount,
      sourceQuoteId: quote.id,
      sourceQuoteReference: quote.quoteReference,
      status: hasInvoiceDocument
        ? getVendorInvoiceStatus(amount, paidAmount, existingInvoice.dueDate)
        : "En attente de facture"
    };
  }

  return {
    id: invoiceId,
    contactId: quote.contactId,
    contactName: quote.contactName,
    contactPersonName: quote.contactPersonName,
    category: quote.category,
    title: `Facture attendue · ${quote.title}`,
    invoiceDate: "",
    dueDate: "",
    amount,
    paidAmount,
    status: "En attente de facture",
    sourceQuoteId: quote.id,
    sourceQuoteReference: quote.quoteReference,
    invoiceReceivedAt: "",
    linkedDocumentId: "",
    invoiceDocumentUrl: "",
    invoiceDocumentStoragePath: "",
    invoiceDocumentName: "",
    paymentMethod: "",
    notes: `Créée automatiquement depuis le devis ${quote.quoteReference}.${quote.notes ? `\n\n${quote.notes}` : ""}`,
    createdAt
  };
}

/** Positive automatic-origin evidence; never inferred from amount, supplier or category. */
export function isAutomaticVendorInvoice(invoice: VendorInvoice): boolean {
  return Boolean(
    invoice.notes?.startsWith("Créée automatiquement depuis le devis ") ||
    (invoice.sourceQuoteId && invoice.title.startsWith("Facture attendue · "))
  );
}

export function isEmptyAutomaticVendorInvoice(invoice: VendorInvoice): boolean {
  if (!isAutomaticVendorInvoice(invoice) || Number(invoice.paidAmount) !== 0) return false;
  if (["Payé", "Partiellement payé"].includes(invoice.status)) return false;
  if ([invoice.invoiceDate, invoice.dueDate, invoice.invoiceReference, invoice.invoiceReceivedAt,
    invoice.linkedDocumentId, invoice.invoiceDocumentUrl, invoice.invoiceDocumentStoragePath,
    invoice.invoiceDocumentName, invoice.paymentBankAccountId, invoice.paymentMethod].some(Boolean)) return false;
  if (invoice.notes && !invoice.notes.startsWith("Créée automatiquement depuis le devis ")) return false;
  // Unknown populated fields are protected too (legacy payment/document metadata).
  const known = new Set(["id", "contactId", "contactName", "contactPersonName", "category", "title",
    "amount", "paidAmount", "status", "sourceQuoteId", "sourceQuoteReference", "notes", "createdAt",
    "createdBy", "updatedBy", "updatedAt"]);
  return Object.entries(invoice).every(([key, value]) => known.has(key) ||
    value === undefined || value === null || value === "" ||
    (Array.isArray(value) && value.length === 0));
}

export function isOrphanAutomaticVendorInvoice(invoice: VendorInvoice, quotes: VendorQuote[]): boolean {
  return isEmptyAutomaticVendorInvoice(invoice) && !quotes.some(quote =>
    quote.id === invoice.sourceQuoteId || quote.linkedInvoiceId === invoice.id);
}

export type VendorFinanceState = { vendorQuotes?: VendorQuote[]; vendorInvoices?: VendorInvoice[] };
export type VendorQuoteDeletionChoice = "delete-both" | "keep-invoice";

/** Find references in all current payload objects, including document/payment records. */
export function hasVendorInvoiceReference(value: unknown, invoiceId: string): boolean {
  if (typeof value === "string") return value.includes(invoiceId);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => key.includes(invoiceId) || hasVendorInvoiceReference(child, invoiceId));
}

function hasOtherInvoiceReference(state: VendorFinanceState, invoiceId: string, deletingQuoteId?: string) {
  return hasVendorInvoiceReference({
    ...state,
    vendorInvoices: (state.vendorInvoices || []).filter(invoice => invoice.id !== invoiceId),
    vendorQuotes: (state.vendorQuotes || []).filter(quote => quote.id !== deletingQuoteId)
  }, invoiceId);
}

export function getVendorQuoteDeletionPlan(state: VendorFinanceState, quoteId: string) {
  const quote = state.vendorQuotes?.find(item => item.id === quoteId);
  const invoices = (state.vendorInvoices || []).filter(invoice =>
    invoice.id === quote?.linkedInvoiceId || invoice.sourceQuoteId === quoteId);
  const missingLink = Boolean(quote?.linkedInvoiceId && !invoices.some(invoice => invoice.id === quote.linkedInvoiceId));
  const canDeleteInvoices = invoices.length > 0 && !missingLink && invoices.every(invoice =>
    isEmptyAutomaticVendorInvoice(invoice) && !hasOtherInvoiceReference(state, invoice.id, quoteId));
  return { quote, invoices, missingLink, canDeleteInvoices };
}

export function deleteVendorQuoteWithDecision<T extends VendorFinanceState>(
  state: T, quoteId: string, choice?: VendorQuoteDeletionChoice
): T {
  const plan = getVendorQuoteDeletionPlan(state, quoteId);
  if (!plan.quote) return state;
  if ((plan.invoices.length || plan.missingLink) && !choice) {
    throw new Error("Ce devis possède une facture liée. Choisissez explicitement quoi conserver.");
  }
  if (choice === "delete-both" && !plan.canDeleteInvoices) {
    throw new Error("Suppression refusée : la facture contient des données métier ou une autre référence.");
  }
  return { ...state,
    vendorQuotes: (state.vendorQuotes || []).filter(quote => quote.id !== quoteId),
    // Keep sourceQuoteId as historical provenance when the user retains the invoice.
    vendorInvoices: choice === "delete-both"
      ? (state.vendorInvoices || []).filter(invoice => !plan.invoices.some(item => item.id === invoice.id))
      : state.vendorInvoices
  };
}

export function deleteOrphanAutomaticVendorInvoice<T extends VendorFinanceState>(state: T, invoiceId: string): T {
  const invoice = state.vendorInvoices?.find(item => item.id === invoiceId);
  if (!invoice || !isOrphanAutomaticVendorInvoice(invoice, state.vendorQuotes || []) || hasOtherInvoiceReference(state, invoiceId)) {
    throw new Error("Suppression refusée : facture utilisée, document, paiement, compte bancaire ou devis lié.");
  }
  return { ...state, vendorInvoices: state.vendorInvoices!.filter(item => item.id !== invoiceId) };
}

export function validateVendorQuoteIdempotently<T extends VendorFinanceState>(
  state: T, quoteId: string, newInvoiceId: string, now = new Date().toISOString()
): T {
  const quote = state.vendorQuotes?.find(item => item.id === quoteId);
  if (!quote) return state;
  const invoices = state.vendorInvoices || [];
  // Explicit link takes priority regardless of invoice array order.
  const linked = quote.linkedInvoiceId ? invoices.find(invoice => invoice.id === quote.linkedInvoiceId) : undefined;
  if (quote.linkedInvoiceId && !linked) throw new Error("La facture liée est introuvable. Vérifiez le lien avant de valider ce devis.");
  const existing = linked || invoices.find(invoice => invoice.sourceQuoteId === quote.id);
  const invoice = existing
    ? existing.status === "Annulé" && isEmptyAutomaticVendorInvoice(existing)
      ? { ...existing, status: "En attente de facture" as const }
      : existing
    : createPendingVendorInvoiceFromQuote(quote, newInvoiceId, undefined, now);
  const validated: VendorQuote = { ...quote, status: "Validé", validatedAt: quote.validatedAt || now, linkedInvoiceId: invoice.id };
  return { ...state,
    vendorQuotes: state.vendorQuotes!.map(item => item.id === quoteId ? validated : item),
    vendorInvoices: existing
      ? invoices.map(item => item.id === existing.id ? invoice : item)
      : [invoice, ...invoices]
  };
}

export function preserveVendorQuoteIdentity(current: VendorQuote, edited: VendorQuote): VendorQuote {
  return { ...current, ...edited, id: current.id, createdAt: current.createdAt,
    linkedInvoiceId: current.linkedInvoiceId || edited.linkedInvoiceId };
}

export type VendorInvoiceDuplicate = { invoice: VendorInvoice; reason: "sourceQuoteId" | "invoiceReference" | "document" };

function invoiceDocumentKeys(invoice: VendorInvoice): string[] {
  const keys = [invoice.linkedDocumentId && `document:${invoice.linkedDocumentId}`,
    invoice.invoiceDocumentStoragePath && `storage:${invoice.invoiceDocumentStoragePath}`];
  if (invoice.invoiceDocumentUrl) {
    try {
      const url = new URL(invoice.invoiceDocumentUrl);
      const driveId = url.hostname === "drive.google.com"
        ? url.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || url.searchParams.get("id") : null;
      keys.push(driveId ? `drive:${driveId}` : `url:${url.href}`);
    } catch { /* Unparseable URLs are not reliable document identities. */ }
  }
  return keys.filter((key): key is string => Boolean(key));
}

export function findVendorInvoiceDuplicates(candidate: VendorInvoice, invoices: VendorInvoice[]): VendorInvoiceDuplicate[] {
  const reference = candidate.invoiceReference?.trim();
  const documentKeys = invoiceDocumentKeys(candidate);
  return invoices.filter(invoice => invoice.id !== candidate.id).flatMap(invoice => {
    let reason: VendorInvoiceDuplicate["reason"] | undefined;
    if (candidate.sourceQuoteId && invoice.sourceQuoteId === candidate.sourceQuoteId) reason = "sourceQuoteId";
    else if (documentKeys.some(key => invoiceDocumentKeys(invoice).includes(key))) reason = "document";
    else if (candidate.contactId && invoice.contactId === candidate.contactId && reference && invoice.invoiceReference?.trim() === reference) reason = "invoiceReference";
    return reason ? [{ invoice, reason }] : [];
  });
}

export function canSaveVendorInvoice(candidate: VendorInvoice, invoices: VendorInvoice[], override = false) {
  return override || findVendorInvoiceDuplicates(candidate, invoices).length === 0;
}
