"use client";
import { moduleMessage } from "@/lib/i18n/moduleMessage";
import { useI18n } from "@/lib/i18n/I18nProvider";

import { BusinessForm, BusinessLabel, BusinessButton, useBusinessPermissions } from "./BusinessPermissions";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  const {t, label: uiLabel, formatDate: uiDate, formatMoney} = useI18n();
  const liveT = useRef(t);
  useLayoutEffect(() => { liveT.current = t; }, [t]);

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
        window.alert(liveT.current("modules.vendors.downloadFailed"));
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

    window.alert(liveT.current("modules.vendorQuotesView.noSupplierQuoteHasBeenUploaded"));
  }

  async function previewQuoteDocument(quote: VendorQuote) {
    if(business)return business.download(quote.quoteDocumentStoragePath||"",quote.quoteDocumentName||"devis.pdf");
    if (quote.quoteDocumentStoragePath) {
      const { data, error } = await supabase.storage
        .from(CRM_DOCUMENTS_BUCKET)
        .createSignedUrl(quote.quoteDocumentStoragePath, 120);

      if (error || !data?.signedUrl) {
        window.alert(liveT.current("modules.vendors.openFailed"));
        return;
      }

      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
      return;
    }

    if (quote.quoteDocumentUrl) {
      window.open(quote.quoteDocumentUrl, "_blank", "noopener,noreferrer");
      return;
    }

    window.alert(liveT.current("modules.vendorQuotesView.noSupplierQuoteHasBeenUploaded"));
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
      window.alert(liveT.current("modules.vendorQuotesView.chooseTheRelevantSupplier"));
      return;
    }

    if (amount <= 0) {
      window.alert(liveT.current("modules.vendorQuotesView.enterTheQuoteAmount"));
      return;
    }

    let uploadedDocument: Partial<VendorQuote> = {};

    if (quoteFile instanceof File && quoteFile.size > 0) {
      try {
        setUploading(true);
        uploadedDocument = await uploadQuoteDocument(quoteFile, quoteId);
        if(business)await business.check();
      } catch (error) {
        window.alert(moduleMessage(error instanceof Error ? error.message : "", liveT.current));
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
      window.alert(liveT.current("modules.vendorQuotesView.uploadTheSuppliersActualQuoteBeforeApprovingIt"));
      setEditingQuote(quote);
      return;
    }

    if (
      window.confirm(
        t("modules.vendors.approveQuote", {reference: quote.quoteReference || quote.title, amount: formatMoney(quote.amount)})
      )
    ) {
      onValidate(quote.id);
    }
  }

  function rejectQuote(quote: VendorQuote) {
    if (
      window.confirm(
        t("modules.vendors.rejectQuote", {reference: quote.quoteReference || quote.title})
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
            <p className="eyebrow">{t("modules.vendorQuotesView.supplierQuotes")}</p>
            <h3>{t("modules.vendors.quoteCount", {count: visibleQuotes.length})}</h3>
          </div>
          <div>
            <p className="eyebrow">{t("modules.vendorQuotesView.awaitingApproval")}</p>
            <h3>{formatMoney(pendingAmount)}</h3>
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
              {uiLabel(status, "modules")}
            </BusinessButton>
          ))}
        </div>

        {visibleQuotes.length === 0 ? (
          <p className="muted-line">{t("modules.vendorQuotesView.noSupplierQuotesMatchThisFilter")}</p>
        ) : (
          <div className="list-stack oar-contact-list-stack">
            {visibleQuotes.map((quote) => {
              const linkedInvoice = invoices.find(invoice => invoice.id === quote.linkedInvoiceId)
                || invoices.find(invoice => invoice.sourceQuoteId === quote.id);
              const linkedContact = contacts.find((contact) => contact.id === quote.contactId);
              const businessName = linkedContact
                ? getVendorBusinessName(linkedContact)
                : quote.contactName || t("modules.vendorQuotesView.supplierNotSpecified");
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
                      {profession} · {quote.quoteReference || t("modules.vendorQuotesView.referenceRequired")}
                    </p>
                    <h3>{businessName}</h3>
                    {contactPersonName && contactPersonName !== businessName ? (
                      <p className="muted-line">{t("modules.searchableBusinessContactPicker.contactPerson")} {contactPersonName}</p>
                    ) : null}
                    <p>{quote.title}</p>
                    <p className="muted-line">

                      {t("modules.vendorQuotesView.quote")} {quote.quoteDate ? uiDate(quote.quoteDate) : t("modules.vendorQuotesView.required")}  {t("modules.vendorQuotesView.validUntil")} {quote.validUntil ? uiDate(quote.validUntil) : t("modules.vendorQuotesView.required")}
                    </p>

                    <div className="stats-grid vendor-invoice-stats" style={{ marginTop: 16 }}>
                      <div className="mini-stat">
                        <span>{t("modules.vendorQuotesView.amount")}</span>
                        <strong>{formatMoney(quote.amount)}</strong>
                      </div>
                      <div className="mini-stat">
                        <span>{t("modules.vendorQuotesView.decision")}</span>
                        <strong>{uiLabel(quote.status, "modules")}</strong>
                      </div>
                      <div className="mini-stat">
                        <span>{t("modules.vendorQuotesView.linkedInvoice")}</span>
                        <strong>{linkedInvoice ? uiLabel(linkedInvoice.status) : t("modules.vendorQuotesView.notCreated")}</strong>
                      </div>
                    </div>

                    {quote.notes && <p className="muted-line" style={{ marginTop: 12 }}>{quote.notes}</p>}
                  </div>

                  <div className="item-actions contact-row-actions oar-contact-actions">
                    <span className={`status-pill ${statusTone(quote.status)}`}>{uiLabel(quote.status, "modules")}</span>

                    {(quote.quoteDocumentStoragePath || quote.quoteDocumentUrl) && (
                      <>
                        <BusinessButton className="secondary-button" type="button" permission="export" onClick={() => void previewQuoteDocument(quote)}>

                          {t("modules.vendorQuotesView.viewQuote")}
                        </BusinessButton>
                        <BusinessButton className="secondary-button" type="button" permission="export" onClick={() => void downloadQuoteDocument(quote)}>

                          {t("modules.vendorQuotesView.downloadQuote")}
                        </BusinessButton>
                      </>
                    )}

                    {quote.status !== "Validé" && (
                      <BusinessButton className="primary-button" type="button" permission="write" disabled={Boolean(business&&!business.canWrite("vendorInvoices"))} onClick={() => validateQuote(quote)}>

                        {t("modules.vendorQuotesView.approve")}
                      </BusinessButton>
                    )}

                    {quote.status !== "Refusé" && (
                      <BusinessButton className="secondary-button" type="button" permission="write" onClick={() => rejectQuote(quote)}>

                        {t("modules.vendorQuotesView.reject")}
                      </BusinessButton>
                    )}

                    {linkedInvoice && (
                      <BusinessButton className="secondary-button" type="button" onClick={() => onOpenInvoice(linkedInvoice.id)}>

                        {t("modules.vendorQuotesView.openInvoice")}
                      </BusinessButton>
                    )}

                    <BusinessButton className="secondary-button" type="button" permission="write" onClick={() => setEditingQuote(quote)}>

                      {t("modules.tasksWorkspace.edit")}
                    </BusinessButton>

                    <BusinessButton
                      className="danger-link"
                      type="button"
                      onClick={() => {
                        const plan = getVendorQuoteDeletionPlan({ vendorQuotes: quotes, vendorInvoices: invoices }, quote.id);
                        if (plan.invoices.length || plan.missingLink) setDeletingQuoteId(quote.id);
                        else if (window.confirm(t("modules.vendorQuotesView.deleteThisSupplierQuote"))) {
                          onDelete(quote.id);
                          if (editingQuote?.id === quote.id) setEditingQuote(null);
                        }
                      }}
                    >

                      {t("modules.tasksWorkspace.delete")}
                    </BusinessButton>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="card form-card vendor-quotes-form-card">
        <p className="eyebrow">{editingQuote ? t("modules.vendorQuotesView.editing") : t("modules.vendorQuotesView.new")}</p>
        <h3>{editingQuote ? t("modules.vendorQuotesView.editQuote") : t("modules.vendorQuotesView.addSupplierQuote")}</h3>
        <p className="muted-line">

          {t("modules.vendorQuotesView.theQuoteMustBeApprovedBeforeAPendingInvoiceIsCreated")}
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

          <BusinessLabel>{t("modules.vendorQuotesView.quoteSubject")}
            <input name="title" defaultValue={editingQuote?.title || ""} placeholder={t("modules.vendorQuotesView.egJulyGardenMaintenance")} required />
          </BusinessLabel>

          <BusinessLabel>{t("modules.vendorQuotesView.quoteReference")}
            <input name="quoteReference" defaultValue={editingQuote?.quoteReference || ""} placeholder={t("modules.vendorQuotesView.createdAutomaticallyIfBlank")} />
          </BusinessLabel>

          <BusinessLabel>{t("modules.vendorQuotesView.quoteDate")}
            <input name="quoteDate" type="date" defaultValue={editingQuote?.quoteDate || new Date().toISOString().slice(0, 10)} />
          </BusinessLabel>

          <BusinessLabel>{t("modules.vendorQuotesView.validUntil_c0bec1")}
            <input name="validUntil" type="date" defaultValue={editingQuote?.validUntil || ""} />
          </BusinessLabel>

          <BusinessLabel>{t("modules.vendorQuotesView.quoteAmount")}
            <input
              name="amount"
              type="text"
              inputMode="decimal"
              defaultValue={editingQuote ? formatEuroInput(editingQuote.amount) : ""}
              placeholder={t("modules.vendors.amountExample")}
              required
            />
          </BusinessLabel>

          <BusinessLabel className="vendor-invoice-file-field">{t("modules.vendorQuotesView.uploadQuote")}
            <input name="quoteFile" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.doc,.docx,.xls,.xlsx" />
            <span className="field-help">
              {editingQuote?.quoteDocumentName
                ? t("modules.vendors.currentFile", {name: editingQuote.quoteDocumentName || ""})
                : t("modules.vendorQuotesView.theDocumentWillBeRequiredForApproval")}
            </span>
          </BusinessLabel>

          <BusinessLabel className="planning-entry-notes">{t("modules.tasksWorkspace.notes")}
            <textarea name="notes" defaultValue={editingQuote?.notes || ""} placeholder={t("modules.vendorQuotesView.termsDepositConditionsTechnicalDetails")} />
          </BusinessLabel>

          <div className="mobile-form-actions">
            <BusinessButton className="primary-button planning-entry-submit" type="submit" disabled={uploading}>
              {uploading ? t("modules.vendorQuotesView.uploading") : editingQuote ? t("modules.tasksWorkspace.save") : t("modules.vendorQuotesView.addQuote")}
            </BusinessButton>
            {editingQuote && (
              <BusinessButton className="secondary-button" type="button" permission="write" onClick={() => setEditingQuote(null)}>

                {t("modules.tasksWorkspace.cancel")}
              </BusinessButton>
            )}
          </div>
        </BusinessForm>
      </section>
    </div>
  );
}
