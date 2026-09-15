"use client";
import { useEffect, useRef, useState } from "react";
import type { Contact, VendorBankAccount, VendorInvoice } from "../lib/types";
import { addVendorBankAccount, formatIban, getInvoicePaymentReference, getPrimaryVendorBankAccount, getVerifiedVendorBankAccounts, hasBankAccountChange, maskIban, normalizeBic, normalizeIban, selectInvoiceBankAccount, updateBankAccountStatus } from "../lib/vendorBanking";
import { fetchDriveAPI } from "../lib/driveClient";
import { formatEuroAmount, formatEuroInput } from "../lib/currency";
import { getVendorInvoiceRemaining } from "../lib/vendorFinance";

function BankingDialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="banking-dialog" aria-label={title} onCancel={onClose}>
    <div className="banking-heading"><h3>{title}</h3><button type="button" className="secondary-button" onClick={onClose}>Fermer</button></div>{children}
  </dialog>;
}
function CopyButton({ label, value }: { label: string; value: string }) {
  const [message, setMessage] = useState("");
  return <button type="button" className="secondary-button" onClick={async () => {
    try { await navigator.clipboard.writeText(value); setMessage("Copié ✓"); }
    catch { setMessage("Copie indisponible"); }
  }}>{message || label}</button>;
}
function RibDocument({ account }: { account?: VendorBankAccount }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  async function open(download: boolean) {
    setBusy(true); setError("");
    try {
      const response = await fetchDriveAPI(`/api/drive/file?fileId=${encodeURIComponent(account!.driveFileId!)}${download ? "&download=1" : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      if (download) {
        const a = document.createElement("a"); a.href = blobUrl; a.download = account!.driveFileName || "RIB"; a.click();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      } else setUrl(blobUrl);
    } catch { setError("RIB inaccessible. Vérifiez votre session CRM."); }
    finally { setBusy(false); }
  }
  if (!account?.driveFileId) return <span className="muted-line">Document RIB non joint</span>;
  return <><div className="banking-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void open(false)}>Voir le RIB</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void open(true)}>Télécharger le RIB</button></div>
    {error && <p role="alert">{error}</p>}
    {url && <BankingDialog title="RIB original" onClose={() => setUrl("")}><iframe title="RIB original" src={url} className="banking-preview" /></BankingDialog>}
  </>;
}
export function VendorBankAccounts({ contact, actor, onUpdate }: { contact: Contact; actor: string; onUpdate: (contact: Contact) => void }) {
  const [adding, setAdding] = useState(false);
  const [iban, setIban] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const accounts = contact.supplierBankAccounts || [];
  const changed = hasBankAccountChange(contact, iban);
  function action(id: string, kind: "verify" | "primary" | "archive") {
    if (kind === "verify" && !window.confirm("Confirmez avoir vérifié ce RIB auprès du prestataire par un canal de confiance.")) return;
    try { onUpdate({ ...contact, supplierBankAccounts: updateBankAccountStatus(accounts, id, kind, actor) }); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Action impossible."); }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    const account: VendorBankAccount = { id: crypto.randomUUID(), accountHolder: String(form.get("holder") || "").trim(), iban: normalizeIban(iban), bic: normalizeBic(String(form.get("bic") || "")), bankName: String(form.get("bank") || "").trim(), label: String(form.get("label") || "").trim(), status: "À vérifier", isPrimary: false, createdAt: new Date().toISOString(), createdBy: actor };
    try {
      const next = addVendorBankAccount(accounts, account);
      const file = form.get("file");
      setBusy(true);
      if (file instanceof File && file.size) {
        const upload = new FormData(); upload.append("file", file); upload.append("contactId", contact.id);
        const response = await fetchDriveAPI("/api/drive/vendor-bank-accounts/upload", { method: "POST", body: upload });
        if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || "Upload RIB impossible."); }
        Object.assign(next[next.length - 1], await response.json());
      }
      onUpdate({ ...contact, supplierBankAccounts: next }); setAdding(false); setIban("");
    } catch (e) { setError(e instanceof Error ? e.message : "Ajout impossible."); }
    finally { setBusy(false); }
  }
  return <section className="vendor-banking" aria-label="Coordonnées bancaires">
    <div className="banking-heading"><div><p className="eyebrow">Coordonnées bancaires</p><h3>RIB du prestataire</h3></div><button type="button" className="primary-button" onClick={() => { setAdding(true); setError(""); }}>+ Ajouter un RIB</button></div>
    {error && <p role="alert" className="banking-warning">{error}</p>}
    {!accounts.length && <p className="muted-line">Aucun RIB enregistré pour ce prestataire.</p>}
    {accounts.map(account => <article className="banking-account" key={account.id}>
      <div className="banking-heading"><strong>{account.label || "Compte bancaire"}</strong><span className={`banking-status ${account.status === "Vérifié" ? "verified" : ""}`}>{account.status}{account.isPrimary ? " · Principal" : ""}</span></div>
      <p>{account.accountHolder}</p><p className="banking-iban">{maskIban(account.iban)}</p><p>BIC : {account.bic} {account.bankName && `· ${account.bankName}`}</p>
      {account.verifiedAt && <p className="muted-line">Vérifié le {new Date(account.verifiedAt).toLocaleDateString("fr-FR")} par {account.verifiedBy || "Acteur non renseigné"}</p>}
      {account.status === "À vérifier" && hasBankAccountChange(contact, account.iban) && <p className="banking-warning">Attention — changement de coordonnées bancaires. L’IBAN reçu est différent du RIB actuellement vérifié. Une vérification est obligatoire avant utilisation.</p>}
      <div className="banking-actions"><CopyButton label="Copier IBAN" value={normalizeIban(account.iban)} /><CopyButton label="Copier BIC" value={normalizeBic(account.bic)} />
        {account.status === "À vérifier" && <button type="button" className="primary-button" onClick={() => action(account.id, "verify")}>Vérifier le RIB</button>}
        {account.status === "Vérifié" && !account.isPrimary && <button type="button" className="secondary-button" onClick={() => action(account.id, "primary")}>Définir comme principal</button>}
        {account.status !== "Archivé" && <button type="button" className="secondary-button" onClick={() => action(account.id, "archive")}>Archiver</button>}
      </div><RibDocument account={account} />
    </article>)}
    {adding && <BankingDialog title="Ajouter un RIB" onClose={() => { if (!busy) setAdding(false); }}>
      <form className="banking-form" onSubmit={submit}>
        <label>Titulaire<input name="holder" required maxLength={150} autoComplete="off" /></label>
        <label>IBAN<input name="iban" value={iban} onChange={e => setIban(e.target.value)} required maxLength={48} autoComplete="off" spellCheck={false} /></label>
        {changed && <p className="banking-warning" role="alert">Attention — changement de coordonnées bancaires. L’IBAN reçu est différent du RIB actuellement vérifié. Une vérification est obligatoire avant utilisation.</p>}
        <label>BIC<input name="bic" required maxLength={11} autoComplete="off" /></label><label>Banque<input name="bank" maxLength={150} /></label><label>Libellé<input name="label" placeholder="Compte principal" maxLength={100} /></label>
        <label>Fichier RIB (facultatif)<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" /><span>PDF ou image, maximum 4 Mo.</span></label>
        <p>Le nouveau compte sera « À vérifier ».</p>{error && <p role="alert" className="banking-warning">{error}</p>}
        <button className="primary-button" disabled={busy} type="submit">{busy ? "Enregistrement…" : "Enregistrer le RIB"}</button>
      </form>
    </BankingDialog>}
  </section>;
}
export function VendorInvoicePayment({ invoice, contact, onUpdate, onOpenContact }: { invoice: VendorInvoice; contact?: Contact; onUpdate: (invoice: VendorInvoice) => void; onOpenContact: () => void }) {
  const [preparing, setPreparing] = useState(false);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const verified = getVerifiedVendorBankAccounts(contact);
  const historical = contact?.supplierBankAccounts?.find(a => a.id === invoice.paymentBankAccountId);
  const defaultAccount = invoice.paymentBankAccountId ? verified.find(a => a.id === invoice.paymentBankAccountId) : getPrimaryVendorBankAccount(contact);
  const account = verified.find(a => a.id === selected);
  const reference = getInvoicePaymentReference(invoice);
  if (invoice.status === "Payé") return invoice.paymentMethod?.trim().toLowerCase() === "virement" && historical ? <div className="vendor-banking"><p className="muted-line">Virement effectué vers : •••• {normalizeIban(historical.iban).slice(-4)} · {historical.status}</p><RibDocument account={historical} /></div> : null;
  if (invoice.status === "Annulé" || invoice.status === "En attente de facture" || getVendorInvoiceRemaining(invoice) <= 0) return null;
  return <section className="vendor-banking" aria-label="Paiement"><p className="eyebrow">Paiement</p><p>Bénéficiaire : <strong>{defaultAccount?.accountHolder || contact?.companyName || contact?.name || invoice.contactName}</strong></p>
    <p className="banking-status">{defaultAccount ? (defaultAccount.isPrimary ? "✓ Principal vérifié" : "✓ Compte choisi vérifié") : verified.length ? "Choisir un RIB vérifié" : contact?.supplierBankAccounts?.some(a => a.status === "À vérifier") ? "RIB À VÉRIFIER" : "RIB manquant"}</p>
    <div className="banking-actions">{verified.length > 0 && <button className="primary-button" type="button" onClick={() => { setSelected(defaultAccount?.id || ""); setError(""); setPreparing(true); }}>Préparer le paiement</button>}
      {contact && <button className="secondary-button" type="button" onClick={onOpenContact}>{verified.length ? "Gérer les RIB" : "Ajouter un RIB au prestataire"}</button>}</div>
    {!contact && <p className="muted-line">Reliez cette facture à un contact prestataire pour accéder au RIB.</p>}
    {defaultAccount && <RibDocument account={defaultAccount} />}
    {preparing && <BankingDialog title="Préparer le paiement" onClose={() => setPreparing(false)}><div className="banking-form">
      <p className="banking-amount">{formatEuroAmount(getVendorInvoiceRemaining(invoice))}</p>
      <label>Compte vérifié<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Choisir un compte</option>{verified.map(a => <option key={a.id} value={a.id} disabled={Boolean(invoice.paidAmount > 0 && invoice.paymentBankAccountId && invoice.paymentBankAccountId !== a.id)}>{a.label || a.accountHolder} · {maskIban(a.iban)}{a.isPrimary ? " · Principal" : ""}</option>)}</select></label>
      {account && <><p>Bénéficiaire : <strong>{account.accountHolder}</strong></p><p className="banking-iban">{formatIban(account.iban)}</p><p>BIC : {account.bic}</p><p>Référence : {reference}</p><p>Objet suggéré : FACTURE {reference} - {invoice.contactName}</p>
        <div className="banking-actions"><CopyButton label="Copier montant" value={formatEuroInput(getVendorInvoiceRemaining(invoice))} /><CopyButton label="Copier IBAN" value={normalizeIban(account.iban)} /><CopyButton label="Copier BIC" value={account.bic} /><CopyButton label="Copier référence" value={reference} /></div><RibDocument account={account} />
        <button type="button" className="primary-button" onClick={() => { try { onUpdate(selectInvoiceBankAccount(invoice, contact!, account.id)); setPreparing(false); } catch (e) { setError(e instanceof Error ? e.message : "Sélection impossible."); } }}>Conserver ce compte pour la facture</button></>}
      {error && <p role="alert">{error}</p>}<p className="muted-line">Cette préparation ne déclenche aucun paiement bancaire.</p>
    </div></BankingDialog>}
  </section>;
}
export function VendorBankContactDialog({ contact, actor, onUpdate, onClose }: { contact: Contact; actor: string; onUpdate: (contact: Contact) => void; onClose: () => void }) {
  return <BankingDialog title={contact.companyName || contact.name} onClose={onClose}><VendorBankAccounts contact={contact} actor={actor} onUpdate={onUpdate} /></BankingDialog>;
}
