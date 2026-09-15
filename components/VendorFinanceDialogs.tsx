"use client";

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
  const empty = plan.canDeleteInvoices;
  return <DecisionDialog title={empty ? "Ce devis possède une facture automatique en attente." : "Attention : ce devis possède une facture réelle ou utilisée."} onCancel={onCancel}>
    <p>{empty ? "Choisissez ce que vous souhaitez supprimer. La facture conservée signalera que son devis d’origine est introuvable."
      : "La facture et ses données doivent être conservées. Supprimer le devis retirera son document d’origine de la liste des devis."}</p>
    {plan.missingLink && <p role="alert">La facture désignée par le lien est introuvable. Vérifiez ce lien avant de poursuivre.</p>}
    <p className="muted-line">Devis : {plan.quote?.quoteReference || plan.quote?.id} · {plan.invoices.length} facture(s) liée(s)</p>
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
      {empty && <button className="secondary-button" type="button" onClick={() => onDecide("delete-both")}>Supprimer le devis et la facture automatique</button>}
      <button className="secondary-button" type="button" onClick={() => onDecide("keep-invoice")}>Conserver la facture et supprimer le devis</button>
      <button autoFocus className="primary-button" type="button" onClick={onCancel}>Annuler</button>
    </div>
  </DecisionDialog>;
}

export function VendorInvoiceDuplicateDialog({ duplicates, reference, editing, onOpen, onConfirm, onCancel }: {
  duplicates: VendorInvoiceDuplicate[]; reference?: string; editing: boolean;
  onOpen: (id: string) => void; onConfirm: () => void; onCancel: () => void;
}) {
  return <DecisionDialog title="Vérifier cette facture" onCancel={onCancel}>
    <p>{duplicates.some(item => item.reason === "invoiceReference")
      ? `Une facture portant déjà la référence ${reference} existe pour ce prestataire.`
      : "Une facture possède déjà ce devis d’origine ou ce document de facture."}</p>
    {duplicates.map(({ invoice, reason }) => <div key={invoice.id} style={{ marginTop: 12 }}>
      <p>{invoice.contactName} · {invoice.invoiceReference || "Sans référence"} · {invoice.invoiceDate || "Date à compléter"}</p>
      <p className="muted-line">{reason === "sourceQuoteId" ? "Même devis d’origine" : reason === "document" ? "Même document enregistré" : "Même référence fournisseur"}</p>
      <button className="secondary-button" type="button" onClick={() => onOpen(invoice.id)}>Ouvrir la facture existante</button>
    </div>)}
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
      <button className="secondary-button" type="button" onClick={onConfirm}>{editing ? "Enregistrer quand même" : "Créer quand même"}</button>
      <button autoFocus className="primary-button" type="button" onClick={onCancel}>Annuler</button>
    </div>
  </DecisionDialog>;
}
