"use client";
import { useI18n } from "@/lib/i18n/I18nProvider";

import { useEffect, useRef, type ReactNode } from "react";
import type { VendorQuoteDeletionChoice, VendorInvoiceDuplicate } from "@/lib/vendorFinance";
import styles from "./VendorFinanceDialogs.module.css";
import { getVendorQuoteDeletionPlan } from "@/lib/vendorFinance";

function DecisionDialog({ title, children, onCancel }: { title: string; children: ReactNode; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} aria-label={title} onCancel={event => { event.preventDefault(); onCancel(); }}
    className={styles.dialog} style={{ background: "#fffaf2", color: "#072c3c", borderRadius: 18, boxShadow: "0 24px 80px #00143455", width: "min(560px, calc(100vw - 32px))", maxHeight: "calc(100dvh - 32px)", overflowY: "auto", margin: "auto", border: "1px solid #ddd", padding: 24 }}>
    <h3>{title}</h3>{children}
  </dialog>;
}

export function VendorQuoteDeletionDialog({ plan, onDecide, onCancel }: {
  plan: ReturnType<typeof getVendorQuoteDeletionPlan>;
  onDecide: (choice: VendorQuoteDeletionChoice) => void;
  onCancel: () => void;
}) {
  const {t} = useI18n();

  const empty = plan.canDeleteInvoices;
  return <DecisionDialog title={empty ? t("modules.vendorFinanceDialogs.thisQuoteHasAnAutomaticPendingInvoice") : t("modules.vendorFinanceDialogs.warningThisQuoteHasARealOrUsedInvoice")} onCancel={onCancel}>
    <p>{empty ? t("modules.vendorFinanceDialogs.chooseWhatToDeleteARetainedInvoiceWillIndicateThatItsSource")
      : t("modules.vendorFinanceDialogs.theInvoiceAndItsDataMustBeRetainedDeletingTheQuoteRemoves")}</p>
    {plan.missingLink && <p role="alert">{t("modules.vendorFinanceDialogs.theLinkedInvoiceCannotBeFoundCheckTheLinkBeforeContinuing")}</p>}
    <p className="muted-line">{t("modules.vendorQuotesView.quote")} {plan.quote?.quoteReference || plan.quote?.id} · {t("modules.vendors.linkedInvoices", {count: plan.invoices.length})}</p>
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
      {empty && <button className="secondary-button" type="button" onClick={() => onDecide("delete-both")}>{t("modules.vendorFinanceDialogs.deleteQuoteAndAutomaticInvoice")}</button>}
      <button className="secondary-button" type="button" onClick={() => onDecide("keep-invoice")}>{t("modules.vendorFinanceDialogs.keepInvoiceAndDeleteQuote")}</button>
      <button autoFocus className="primary-button" type="button" onClick={onCancel}>{t("modules.tasksWorkspace.cancel")}</button>
    </div>
  </DecisionDialog>;
}

export function VendorInvoiceDuplicateDialog({ duplicates, reference, editing, onOpen, onConfirm, onCancel }: {
  duplicates: VendorInvoiceDuplicate[]; reference?: string; editing: boolean;
  onOpen: (id: string) => void; onConfirm: () => void; onCancel: () => void;
}) {
  const {t} = useI18n();

  return <DecisionDialog title={t("modules.vendorFinanceDialogs.checkThisInvoice")} onCancel={onCancel}>
    <p>{duplicates.some(item => item.reason === "invoiceReference")
      ? t("modules.vendors.duplicateReference", {reference: reference || ""})
      : t("modules.vendorFinanceDialogs.anInvoiceAlreadyHasThisSourceQuoteOrInvoiceDocument")}</p>
    {duplicates.map(({ invoice, reason }) => <div key={invoice.id} style={{ marginTop: 12 }}>
      <p>{invoice.contactName} · {invoice.invoiceReference || t("modules.vendorFinanceDialogs.noReference")} · {invoice.invoiceDate || t("modules.vendorFinanceDialogs.dateRequired")}</p>
      <p className="muted-line">{reason === "sourceQuoteId" ? t("modules.vendorFinanceDialogs.sameSourceQuote") : reason === "document" ? t("modules.vendorFinanceDialogs.sameRecordedDocument") : t("modules.vendorFinanceDialogs.sameSupplierReference")}</p>
      <button className="secondary-button" type="button" onClick={() => onOpen(invoice.id)}>{t("modules.vendorFinanceDialogs.openExistingInvoice")}</button>
    </div>)}
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
      <button className="secondary-button" type="button" onClick={onConfirm}>{editing ? t("modules.vendorFinanceDialogs.saveAnyway") : t("modules.vendorFinanceDialogs.createAnyway")}</button>
      <button autoFocus className="primary-button" type="button" onClick={onCancel}>{t("modules.tasksWorkspace.cancel")}</button>
    </div>
  </DecisionDialog>;
}
