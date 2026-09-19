"use client";

import { BusinessForm, BusinessLabel, BusinessButton, useBusinessPermissions } from "./BusinessPermissions";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import SearchableBusinessContactPicker from "./SearchableBusinessContactPicker";
import type {
  Contact,
  VendorInvoice,
  VendorQuote,
  VendorQuoteStatus
} from "@/lib/types";
import {
  getVendorBusinessName,
  getVendorContactPersonName,
  getVendorContactProfession,
  isEligibleVendorContact
} from "@/lib/vendorContacts";
import {
  formatEuroAmount,
  formatEuroInput,
  parseEuroAmount,
  sumEuroAmounts
} from "@/lib/currency";

import { getVendorQuoteDeletionPlan, type VendorQuoteDeletionChoice } from "@/lib/vendorFinance";
import { VendorQuoteDeletionDialog } from "./VendorFinanceDialogs";

const SHARED_WORKSPACE_ID = "oneaddress-riviera";
const CRM_DOCUMENTS_BUCKET = "crm-documents";

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }

  return `${prefix}-${Date.now()}`;
}

function formatDate(value?: string) {
  if (!value) return "À compléter";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function sanitizeFileName(fileName: string) {
  return fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "devis-prestataire";
}

function statusTone(status: VendorQuoteStatus) {
  if (status === "Validé") return "semantic-success";
  if (status === "Refusé") return "semantic-danger";
  return "semantic-pending";
}

type Props = {
  contacts: Contact[];
  quotes: VendorQuote[];
  invoices: VendorInvoice[];
  onAdd: (quote: VendorQuote) => void;
  onUpdate: (quote: VendorQuote) => void;
  onDelete: (id: string, choice?: VendorQuoteDeletionChoice) => void;
  onValidate: (id: string) => void;
  onReject: (id: string) => void;
  onOpenInvoice: (invoiceId: string) => void;
};

export default function VendorQuotesView({
  contacts,
  quotes,
  invoices,
  onAdd,
  onUpdate,
  onDelete,
  onValidate,
  onReject,
  onOpenInvoice
}: Props) {
  const business=useBusinessPermissions();
  const [statusFilter, setStatusFilter] = useState<VendorQuoteStatus | "Tous">("Tous");
  const [editingQuote, setEditingQuote] = useState<VendorQuote | null>(null);
  const [deletingQuoteId, setDeletingQuoteId] = useState<string | null>(null);
  const deletionPlan = deletingQuoteId ? getVendorQuoteDeletionPlan({ vendorQuotes: quotes, vendorInvoices: invoices }, deletingQuoteId) : null;
  const [uploading, setUploading] = useState(false);

  const selectableContacts = useMemo(
    () =>
      contacts
        .filter(
          (contact) =>
            isEligibleVendorContact(contact) &&
            getVendorBusinessName(contact) !== "Contact sans nom"
        )
        .sort((a, b) =>
          getVendorBusinessName(a).localeCompare(getVendorBusinessName(b), "fr")
        ),
    [contacts]
  );

  const visibleQuotes = useMemo(
    () =>
      statusFilter === "Tous"
        ? quotes
        : quotes.filter((quote) => quote.status === statusFilter),
    [quotes, statusFilter]
  );

  const pendingAmount = sumEuroAmounts(
    quotes
      .filter((quote) => quote.status === "À valider")
      .map((quote) => quote.amount)
  );

  useEffect(() => {
    if (!editingQuote) return;

    window.setTimeout(() => {
      document
        .querySelector(".vendor-quotes-form-card")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, [editingQuote]);

  async function uploadQuoteDocument(file: File, quoteId: string) {
    if(business)return {quoteDocumentStoragePath:await business.upload("vendorQuotes",quoteId,file),quoteDocumentName:file.name};
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      throw new Error("Utilisateur Supabase non connecté.");
    }

    const safeName = sanitizeFileName(file.name);
    const storagePath = `${SHARED_WORKSPACE_ID}/vendor-quotes/${quoteId}/${Date.now()}-${safeName}`;

    const { error } = await supabase.storage
      .from(CRM_DOCUMENTS_BUCKET)
      .upload(storagePath, file, {
        cacheControl: "3600",
        upsert: true
      });

    if (error) throw new Error(error.message);

    return {
      quoteDocumentStoragePath: storagePath,
      quoteDocumentName: file.name
    };
  }

  async function downloadQuoteDocument(quote: VendorQuote) {
    if(business)return business.download(quote.quoteDocumentStoragePath||"",quote.quoteDocumentName||"devis.pdf");
    if (quote.quoteDocumentStoragePath) {
      const { data, error } = await supabase.storage
        .from(CRM_DOCUMENTS_BUCKET)
        .download(quote.quoteDocumentStoragePath);

      if (error || !data) {
        window.alert(`Téléchargement impossible : ${error?.message || "fichier introuvable"}`);
        return;
      }

      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = quote.quoteDocumentName || `${quote.quoteReference || quote.id}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }

    if (quote.quoteDocumentUrl) {
      window.open(quote.quoteDocumentUrl, "_blank", "noopener,noreferrer");
      return;
    }

    window.alert("Aucun devis prestataire n’est importé.");
  }

  async function previewQuoteDocument(quote: VendorQuote) {
    if(business)return business.download(quote.quoteDocumentStoragePath||"",quote.quoteDocumentName||"devis.pdf");
    if (quote.quoteDocumentStoragePath) {
      const { data, error } = await supabase.storage
        .from(CRM_DOCUMENTS_BUCKET)
        .createSignedUrl(quote.quoteDocumentStoragePath, 120);

      if (error || !data?.signedUrl) {
        window.alert(`Ouverture impossible : ${error?.message || "fichier introuvable"}`);
        return;
      }

      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
      return;
    }

    if (quote.quoteDocumentUrl) {
      window.open(quote.quoteDocumentUrl, "_blank", "noopener,noreferrer");
      return;
    }

    window.alert("Aucun devis prestataire n’est importé.");
  }

  async function submitQuote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const contactId = String(form.get("contactId") || "");
    const contact = contacts.find((item) => item.id === contactId);
    const preserveLegacyContact = form.get("preserveLegacyContact") === "true";
    const amount = parseEuroAmount(form.get("amount"));
    const quoteId = editingQuote?.id || makeId("vendor-quote");
    const quoteFile = form.get("quoteFile");

    if (!contact && !preserveLegacyContact && (!business || business.read("contacts") || !editingQuote)) {
      window.alert("Choisissez le prestataire concerné.");
      return;
    }

    if (amount <= 0) {
      window.alert("Renseignez le montant du devis.");
      return;
    }

    let uploadedDocument: Partial<VendorQuote> = {};

    if (quoteFile instanceof File && quoteFile.size > 0) {
      try {
        setUploading(true);
        uploadedDocument = await uploadQuoteDocument(quoteFile, quoteId);
        if(business)await business.check();
      } catch (error) {
        window.alert(`Devis non importé : ${error instanceof Error ? error.message : "erreur inconnue"}`);
        return;
      } finally {
        setUploading(false);
      }
    }

    const referenceInput = String(form.get("quoteReference") || "").trim();
    const generatedReference = `DEV-PREST-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${quoteId.slice(-4).toUpperCase()}`;

    const quote: VendorQuote = {
      ...(editingQuote || {}),
      id: quoteId,
      contactId,
      contactName: contact
        ? getVendorBusinessName(contact)
        : String(editingQuote?.contactName || "").trim(),
      contactPersonName: contact
        ? getVendorContactPersonName(contact)
        : String(editingQuote?.contactPersonName || "").trim(),
      category: contact
        ? getVendorContactProfession(contact) || "Prestataire"
        : String(editingQuote?.category || "Prestataire").trim(),
      title: String(form.get("title") || "").trim() || "Devis prestataire",
      quoteReference: referenceInput || editingQuote?.quoteReference || generatedReference,
      quoteDate: String(form.get("quoteDate") || ""),
      validUntil: String(form.get("validUntil") || ""),
      amount,
      status: editingQuote?.status || "À valider",
      quoteDocumentUrl: editingQuote?.quoteDocumentUrl || "",
      quoteDocumentStoragePath:
        uploadedDocument.quoteDocumentStoragePath ||
        editingQuote?.quoteDocumentStoragePath ||
        "",
      quoteDocumentName:
        uploadedDocument.quoteDocumentName ||
        editingQuote?.quoteDocumentName ||
        "",
      linkedInvoiceId: editingQuote?.linkedInvoiceId || "",
      notes: String(form.get("notes") || "").trim(),
      createdAt: editingQuote?.createdAt || new Date().toISOString(),
      validatedAt: editingQuote?.validatedAt || ""
    };

    if (editingQuote) {
      onUpdate(quote);
      setEditingQuote(null);
    } else {
      onAdd(quote);
    }

    formElement.reset();
  }

  function validateQuote(quote: VendorQuote) {
    if (!quote.quoteDocumentStoragePath && !quote.quoteDocumentUrl) {
      window.alert("Importez d’abord le devis réel du prestataire avant de le valider.");
      setEditingQuote(quote);
      return;
    }

    if (
      window.confirm(
        `Valider le devis ${quote.quoteReference || quote.title} pour ${formatEuroAmount(quote.amount)} ?\n\nLa facture liée sera réutilisée ; une facture en attente sera créée uniquement si nécessaire.`
      )
    ) {
      onValidate(quote.id);
    }
  }

  function rejectQuote(quote: VendorQuote) {
    if (
      window.confirm(
        `Refuser le devis ${quote.quoteReference || quote.title} ?\n\nLa facture automatique encore en attente sera annulée si elle existe.`
      )
    ) {
      onReject(quote.id);
    }
  }

  return (
    <div className="two-columns wide-left vendor-quotes-view">
      {deletionPlan && <VendorQuoteDeletionDialog plan={deletionPlan}
        onCancel={() => setDeletingQuoteId(null)} onDecide={choice => {
          onDelete(deletingQuoteId!, choice);
          if (editingQuote?.id === deletingQuoteId) setEditingQuote(null);
          setDeletingQuoteId(null);
        }} />}
      <section className="card vendor-quotes-list-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Devis prestataires</p>
            <h3>{visibleQuotes.length} devis</h3>
          </div>
          <div>
            <p className="eyebrow">À valider</p>
            <h3>{formatEuroAmount(pendingAmount)}</h3>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
          {(["Tous", "À valider", "Validé", "Refusé"] as Array<VendorQuoteStatus | "Tous">).map((status) => (
            <BusinessButton
              key={status}
              type="button"
              className={statusFilter === status ? "primary-button" : "secondary-button"}
              onClick={() => setStatusFilter(status)}
            >
              {status}
            </BusinessButton>
          ))}
        </div>

        {visibleQuotes.length === 0 ? (
          <p className="muted-line">Aucun devis prestataire pour ce filtre.</p>
        ) : (
          <div className="list-stack oar-contact-list-stack">
            {visibleQuotes.map((quote) => {
              const linkedInvoice = invoices.find(invoice => invoice.id === quote.linkedInvoiceId)
                || invoices.find(invoice => invoice.sourceQuoteId === quote.id);
              const linkedContact = contacts.find((contact) => contact.id === quote.contactId);
              const businessName = linkedContact
                ? getVendorBusinessName(linkedContact)
                : quote.contactName || "Prestataire non défini";
              const contactPersonName = linkedContact
                ? getVendorContactPersonName(linkedContact)
                : quote.contactPersonName || "";
              const profession = linkedContact
                ? getVendorContactProfession(linkedContact) || quote.category
                : quote.category;

              return (
                <article
                  className="item-card vendor-quote-card"
                  key={quote.id}
                  id={`vendor-quote-${quote.id}`}
                  data-notification-target={`vendor-quote-${quote.id}`}
                >
                  <div>
                    <p className="eyebrow">
                      {profession} · {quote.quoteReference || "Référence à compléter"}
                    </p>
                    <h3>{businessName}</h3>
                    {contactPersonName && contactPersonName !== businessName ? (
                      <p className="muted-line">Référent : {contactPersonName}</p>
                    ) : null}
                    <p>{quote.title}</p>
                    <p className="muted-line">
                      Devis : {formatDate(quote.quoteDate)} · Validité : {formatDate(quote.validUntil)}
                    </p>

                    <div className="stats-grid vendor-invoice-stats" style={{ marginTop: 16 }}>
                      <div className="mini-stat">
                        <span>Montant</span>
                        <strong>{formatEuroAmount(quote.amount)}</strong>
                      </div>
                      <div className="mini-stat">
                        <span>Décision</span>
                        <strong>{quote.status}</strong>
                      </div>
                      <div className="mini-stat">
                        <span>Facture liée</span>
                        <strong>{linkedInvoice ? linkedInvoice.status : "Non créée"}</strong>
                      </div>
                    </div>

                    {quote.notes && <p className="muted-line" style={{ marginTop: 12 }}>{quote.notes}</p>}
                  </div>

                  <div className="item-actions contact-row-actions oar-contact-actions">
                    <span className={`status-pill ${statusTone(quote.status)}`}>{quote.status}</span>

                    {(quote.quoteDocumentStoragePath || quote.quoteDocumentUrl) && (
                      <>
                        <BusinessButton className="secondary-button" type="button" permission="export" onClick={() => void previewQuoteDocument(quote)}>
                          Voir devis
                        </BusinessButton>
                        <BusinessButton className="secondary-button" type="button" permission="export" onClick={() => void downloadQuoteDocument(quote)}>
                          Télécharger devis
                        </BusinessButton>
                      </>
                    )}

                    {quote.status !== "Validé" && (
                      <BusinessButton className="primary-button" type="button" permission="write" disabled={Boolean(business&&!business.canWrite("vendorInvoices"))} onClick={() => validateQuote(quote)}>
                        Valider
                      </BusinessButton>
                    )}

                    {quote.status !== "Refusé" && (
                      <BusinessButton className="secondary-button" type="button" permission="write" onClick={() => rejectQuote(quote)}>
                        Refuser
                      </BusinessButton>
                    )}

                    {linkedInvoice && (
                      <BusinessButton className="secondary-button" type="button" onClick={() => onOpenInvoice(linkedInvoice.id)}>
                        Ouvrir facture
                      </BusinessButton>
                    )}

                    <BusinessButton className="secondary-button" type="button" permission="write" onClick={() => setEditingQuote(quote)}>
                      Modifier
                    </BusinessButton>

                    <BusinessButton
                      className="danger-link"
                      type="button"
                      onClick={() => {
                        const plan = getVendorQuoteDeletionPlan({ vendorQuotes: quotes, vendorInvoices: invoices }, quote.id);
                        if (plan.invoices.length || plan.missingLink) setDeletingQuoteId(quote.id);
                        else if (window.confirm("Supprimer ce devis prestataire ?")) {
                          onDelete(quote.id);
                          if (editingQuote?.id === quote.id) setEditingQuote(null);
                        }
                      }}
                    >
                      Supprimer
                    </BusinessButton>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="card form-card vendor-quotes-form-card">
        <p className="eyebrow">{editingQuote ? "Modification" : "Nouveau"}</p>
        <h3>{editingQuote ? "Modifier le devis" : "Ajouter un devis prestataire"}</h3>
        <p className="muted-line">
          Le devis doit être validé avant qu’une facture en attente soit créée.
        </p>

        <BusinessForm key={editingQuote?.id || "new-vendor-quote"} className="form-grid" onSubmit={submitQuote}>
          <SearchableBusinessContactPicker
            contacts={selectableContacts}
            defaultContact={contacts.find((contact) => contact.id === editingQuote?.contactId)}
            defaultContactId={editingQuote?.contactId || ""}
            fallbackContactName={editingQuote?.contactName || ""}
            fallbackContactPersonName={editingQuote?.contactPersonName || ""}
            fallbackProfession={editingQuote?.category || ""}
            required
          />

          <BusinessLabel>Objet du devis
            <input name="title" defaultValue={editingQuote?.title || ""} placeholder="Ex : Entretien jardin juillet" required />
          </BusinessLabel>

          <BusinessLabel>Référence devis
            <input name="quoteReference" defaultValue={editingQuote?.quoteReference || ""} placeholder="Créée automatiquement si vide" />
          </BusinessLabel>

          <BusinessLabel>Date du devis
            <input name="quoteDate" type="date" defaultValue={editingQuote?.quoteDate || new Date().toISOString().slice(0, 10)} />
          </BusinessLabel>

          <BusinessLabel>Valable jusqu’au
            <input name="validUntil" type="date" defaultValue={editingQuote?.validUntil || ""} />
          </BusinessLabel>

          <BusinessLabel>Montant du devis
            <input
              name="amount"
              type="text"
              inputMode="decimal"
              defaultValue={editingQuote ? formatEuroInput(editingQuote.amount) : ""}
              placeholder="Ex : 1 023,70"
              required
            />
          </BusinessLabel>

          <BusinessLabel className="vendor-invoice-file-field">Importer le devis
            <input name="quoteFile" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.doc,.docx,.xls,.xlsx" />
            <span className="field-help">
              {editingQuote?.quoteDocumentName
                ? `Fichier actuel : ${editingQuote.quoteDocumentName}`
                : "Le document sera obligatoire au moment de la validation"}
            </span>
          </BusinessLabel>

          <BusinessLabel className="planning-entry-notes">Notes
            <textarea name="notes" defaultValue={editingQuote?.notes || ""} placeholder="Conditions, acompte, réserve, détail technique..." />
          </BusinessLabel>

          <div className="mobile-form-actions">
            <BusinessButton className="primary-button planning-entry-submit" type="submit" disabled={uploading}>
              {uploading ? "Import en cours..." : editingQuote ? "Enregistrer" : "Ajouter le devis"}
            </BusinessButton>
            {editingQuote && (
              <BusinessButton className="secondary-button" type="button" permission="write" onClick={() => setEditingQuote(null)}>
                Annuler
              </BusinessButton>
            )}
          </div>
        </BusinessForm>
      </section>
    </div>
  );
}
