"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { HousePrepaidState, HousePrepaidSavePatch } from "@/lib/housePrepaid";
import type { HousePayment, HouseTrackingHouse, HouseTrackingWorker, VendorInvoice } from "@/lib/types";
import { BusinessButton, BusinessForm, useBusinessPermissions } from "./BusinessPermissions";
import styles from "./HousePrepaidPanel.module.css";

export type SaveHousePrepaid = (revision: string, requestId: string, action: "settings" | "package" | "link_invoice", patch: HousePrepaidSavePatch) => Promise<HousePrepaidState>;

export default function HousePrepaidPanel({ state, workers, houses, payments, invoices = [], workerFilter, showSettings, error, onSave, onRefresh }: {
  state: HousePrepaidState | null;
  workers: HouseTrackingWorker[];
  houses: HouseTrackingHouse[];
  payments: HousePayment[];
  invoices?: VendorInvoice[];
  workerFilter: string;
  showSettings: boolean;
  error: string;
  onSave?: SaveHousePrepaid;
  onRefresh: () => void;
}) {
  const { language, locale, formatDate } = useI18n();
  const text = (fr: string, en: string) => language === "en" ? en : fr;
  const money = (cents: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(cents / 100);
  const hours = (minutes: number) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(minutes / 60)} h`;
  const [settingsWorkerId, setSettingsWorkerId] = useState("");
  const modeWorker = workers.find(worker => worker.id === settingsWorkerId) ?? workers.find(worker => worker.id === workerFilter) ?? workers[0];
  const prepaidWorkers = workers.filter(worker => (state?.settings.some(setting => setting.workerId === worker.id && setting.billingMode === "prepaid") || worker.billingMode === "prepaid") && (workerFilter === "Tous" || workerFilter === worker.id));

  if (!state) return <section className="card" aria-label={text("Forfaits prépayés", "Prepaid packages")}>
    <p role={error ? "alert" : "status"}>{error || text("Lecture du suivi global des forfaits…", "Loading global prepaid balances…")}</p>
    {error && <button type="button" className="secondary-button" onClick={onRefresh}>{text("Réessayer", "Retry")}</button>}
  </section>;

  return <div className={styles.panel}>
    {showSettings && modeWorker && <section className="card">
      <h3>{text("Mode de suivi par intervenant", "Worker billing mode")}</h3>
      <label>{text("Intervenant", "Worker")}<select value={modeWorker.id} onChange={event => setSettingsWorkerId(event.target.value)}>{workers.map(worker => <option key={worker.id} value={worker.id}>{worker.contactName}</option>)}</select></label>
      <HousePrepaidSettings key={modeWorker.id} worker={modeWorker} state={state} onSave={onSave} />
    </section>}
    {prepaidWorkers.map(worker => {
      const summary = state.summaries.find(item => item.workerId === worker.id);
      const setting = state.settings.find(item => item.workerId === worker.id);
      const packages = state.packages.filter(item => item.workerId === worker.id);
      if (!summary || !setting) return <section className="card" key={worker.id}><p role="alert">{text("Solde global indisponible pour", "Global balance unavailable for")} {worker.contactName}</p></section>;
      return <section className={`card ${styles.panel}`} key={worker.id} aria-label={`${text("Forfait prépayé", "Prepaid package")} · ${worker.contactName}`} data-prepaid-worker={worker.id}>
        <div className={styles.header}><div><p className="eyebrow">{text("Forfait prépayé", "Prepaid package")}</p><h3>{worker.contactName}</h3></div><span>{text("Solde global · toutes les dates et maisons", "Global balance · all dates and houses")}</span></div>
        <dl className={styles.metrics}>
          <div><dt>{text("Heures achetées", "Hours purchased")}</dt><dd>{hours(summary.purchasedMinutes)}</dd></div>
          <div><dt>{text("Heures réalisées", "Hours completed")}</dt><dd>{hours(summary.performedMinutes)}</dd></div>
          <div><dt>{text("Heures couvertes", "Hours covered")}</dt><dd>{hours(summary.coveredMinutes)}</dd></div>
          <div><dt>{text("Heures disponibles", "Hours available")}</dt><dd>{hours(summary.availableMinutes)}</dd></div>
          <div><dt>{text("Heures à couvrir", "Hours to cover")}</dt><dd>{hours(summary.uncoveredMinutes)}</dd></div>
          <div><dt>{text("Montant effectivement payé", "Amount actually paid")}</dt><dd>{money(summary.paidCents)}</dd></div>
        </dl>
        {summary.uncoveredMinutes > 0 && <p className={styles.notice} role="status">{text("Renouvellement de", "Renewal of")} {hours(setting.defaultMinutes)} {text("à prévoir", "to arrange")} : <strong>{money(setting.defaultPriceCents)}</strong>. {text("Les heures à couvrir ne créent aucun paiement ni facture automatiquement.", "Uncovered hours do not automatically create a payment or invoice.")}</p>}
        <HousePrepaidPurchase key={worker.id} worker={worker} state={state} houses={houses} payments={payments} invoices={invoices} onSave={onSave} />
        <details><summary>{text("Historique des forfaits et paiements", "Package and payment history")} ({packages.length})</summary>
          <div className={styles.history}>{packages.length === 0 ? <p>{text("Aucun forfait payé enregistré.", "No paid package recorded.")}</p> : packages.map(pack => {
            const consumedMinutes = state.allocations.reduce((total, entry) => total + entry.allocations.filter(part => part.packageId === pack.id).reduce((sum, part) => sum + part.minutes, 0), 0);
            const payment = payments.find(item => item.id === pack.paymentId);
            return <article key={pack.id}><div><strong>{hours(pack.capacityMinutes)} · {money(pack.priceCents)}</strong><span>{formatDate(pack.paidDate)} · {payment?.method ?? text("Paiement lié", "Linked payment")}</span><span>{hours(consumedMinutes)} {text("consommées", "used")} · {hours(pack.capacityMinutes - consumedMinutes)} {text("disponibles", "available")}{consumedMinutes === pack.capacityMinutes ? ` · ${text("Épuisé", "Exhausted")}` : ""}</span><span className={styles.reference}>{text("Forfait", "Package")} {pack.id} · {text("Paiement", "Payment")} {pack.paymentId}{pack.invoiceId ? ` · ${text("Facture", "Invoice")} ${pack.invoiceId}` : ""}</span>{!pack.invoiceId && <HousePrepaidInvoiceLink worker={worker} packageId={pack.id} priceCents={pack.priceCents} state={state} invoices={invoices} onSave={onSave} />}</div></article>;
          })}</div>
        </details>
      </section>;
    })}
  </div>;
}

function HousePrepaidSettings({ worker, state, onSave }: { worker: HouseTrackingWorker; state: HousePrepaidState; onSave?: SaveHousePrepaid }) {
  const { language } = useI18n();
  const text = (fr: string, en: string) => language === "en" ? en : fr;
  const setting = state.settings.find(item => item.workerId === worker.id);
  const [mode, setMode] = useState(setting?.billingMode ?? "hourly");
  const [minutes, setMinutes] = useState(String(setting?.defaultMinutes ?? 1800));
  const [price, setPrice] = useState(String((setting?.defaultPriceCents ?? 50000) / 100));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef(false), requestId = useRef<string | null>(null);
  return <BusinessForm className="form-grid house-compact-form" pending={saving} onSubmit={event => {
    event.preventDefault();
    if (!onSave || pending.current || !state.canContribute) return;
    const defaultMinutes = Number(minutes), defaultPriceCents = decimalCents(price);
    if (!Number.isSafeInteger(defaultMinutes) || defaultMinutes <= 0 || defaultPriceCents === null || defaultPriceCents <= 0) { setMessage(text("Volume et prix doivent être strictement positifs.", "Volume and price must be positive.")); return; }
    pending.current = true; setSaving(true); setMessage(""); requestId.current ??= crypto.randomUUID();
    void onSave(state.revision, requestId.current, "settings", { workerId: worker.id, billingMode: mode, defaultMinutes, defaultPriceCents }).then(() => { requestId.current = null; setMessage(text("Mode enregistré côté serveur.", "Mode saved on the server.")); }).catch(() => setMessage(text("Enregistrement non confirmé. Votre saisie est conservée ; réessayez après vérification.", "Save not confirmed. Your draft is preserved; check and retry."))).finally(() => { pending.current = false; setSaving(false); });
  }}>
    <label>{text("Mode de suivi", "Billing mode")}<select name="billingMode" value={mode} onChange={event => { setMode(event.target.value as "hourly" | "prepaid"); requestId.current = null; }}><option value="hourly">{text("Tarif horaire", "Hourly rate")}</option><option value="prepaid">{text("Forfait prépayé", "Prepaid package")}</option></select></label>
    {mode === "prepaid" && <><label>{text("Volume du forfait (minutes)", "Package volume (minutes)")}<input name="defaultMinutes" type="number" min="1" step="1" value={minutes} onChange={event => { setMinutes(event.target.value); requestId.current = null; }} /></label><label>{text("Prix du forfait (€)", "Package price (€)")}<input name="defaultPrice" type="text" inputMode="decimal" value={price} onChange={event => { setPrice(event.target.value); requestId.current = null; }} /></label><p className="full muted-line">{text("Le forfait suit toutes les interventions de cet intervenant, y compris les cours antérieurs. Les anciens taux sont conservés comme provenance.", "The package covers this worker’s complete history, including earlier lessons. Historical hourly rates are retained as provenance.")}</p></>}
    <BusinessButton permission="write" type="submit" className="primary-button" disabled={!state.canContribute || !onSave || saving}>{text("Enregistrer le mode", "Save mode")}</BusinessButton>
    {message && <p className="full" role="status">{message}</p>}
  </BusinessForm>;
}

function decimalCents(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function HousePrepaidPurchase({ worker, state, houses, payments, invoices, onSave }: { worker: HouseTrackingWorker; state: HousePrepaidState; houses: HouseTrackingHouse[]; payments: HousePayment[]; invoices: VendorInvoice[]; onSave?: SaveHousePrepaid }) {
  const { language, locale, formatDate } = useI18n();
  const business = useBusinessPermissions();
  const text = (fr: string, en: string) => language === "en" ? en : fr;
  const setting = state.settings.find(item => item.workerId === worker.id);
  const [open, setOpen] = useState(false), [saving, setSaving] = useState(false), [message, setMessage] = useState("");
  const [source, setSource] = useState("existing");
  const [paymentDate] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10));
  const pending = useRef(false), requestId = useRef<string | null>(null), paymentId = useRef<string | null>(null);
  const usedPayments = new Set(state.packages.map(pack => pack.paymentId));
  const availablePayments = payments.filter(payment => payment.workerId === worker.id && !usedPayments.has(payment.id) && !payment.prepaidPackageId);
  const availableInvoices = invoices.filter(invoice => invoice.contactId === worker.contactId && invoice.status !== "Annulé" && invoice.status !== "En attente de facture" && !state.packages.some(pack => pack.invoiceId === invoice.id));
  const money = (amount: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(amount);
  return <div>
    <div className="form-actions"><BusinessButton permission="write" type="button" className="primary-button" disabled={!state.canContribute || !onSave || saving} onClick={() => setOpen(true)}>{text("Enregistrer un forfait payé", "Record a paid package")}</BusinessButton><BusinessButton permission="write" type="button" className="secondary-button" disabled={!state.canContribute || !onSave || saving} onClick={() => setOpen(true)}>{text("Renouveler le forfait", "Renew the package")}</BusinessButton></div>
    {open && <BusinessForm className={`form-grid house-compact-form ${styles.form}`} pending={saving} onChange={() => { if (!pending.current) { requestId.current = null; paymentId.current = null; } }} onSubmit={event => {
      event.preventDefault();
      if (!onSave || pending.current || !state.canContribute) return;
      const form = new FormData(event.currentTarget), capacityMinutes = Number(form.get("capacityMinutes")), priceCents = decimalCents(String(form.get("price") ?? ""));
      if (!Number.isSafeInteger(capacityMinutes) || capacityMinutes <= 0 || priceCents === null || priceCents <= 0) { setMessage(text("Volume et prix doivent être strictement positifs.", "Volume and price must be positive.")); return; }
      const invoiceId = String(form.get("invoiceId") ?? "");
      const patch: HousePrepaidSavePatch = { workerId: worker.id, capacityMinutes, priceCents, ...(invoiceId ? { invoiceId } : {}) };
      if (source === "existing") {
        const existing = availablePayments.find(payment => payment.id === String(form.get("paymentId")));
        if (!existing || Math.round(existing.amount * 100) !== priceCents) { setMessage(text("Choisissez un paiement existant égal au prix exact du forfait.", "Choose an existing payment matching the exact package price.")); return; }
        patch.paymentId = existing.id;
      } else {
        if (form.get("confirmed") !== "on") { setMessage(text("Confirmez uniquement un paiement réellement effectué.", "Confirm only a payment that has actually been made.")); return; }
        paymentId.current ??= crypto.randomUUID();
        patch.payment = { id: paymentId.current, houseId: String(form.get("houseId") ?? ""), date: String(form.get("date") ?? ""), method: String(form.get("method") ?? "Virement") as HousePayment["method"], note: String(form.get("note") ?? "").trim() };
      }
      pending.current = true; setSaving(true); setMessage(""); requestId.current ??= crypto.randomUUID();
      void onSave(state.revision, requestId.current, "package", patch).then(() => { requestId.current = null; paymentId.current = null; setOpen(false); }).catch(() => setMessage(text("Paiement et forfait non confirmés. Le même essai peut être rejoué sans duplication.", "Payment and package not confirmed. The same attempt can be retried without duplication."))).finally(() => { pending.current = false; setSaving(false); });
    }}>
      <label>{text("Volume (minutes)", "Volume (minutes)")}<input name="capacityMinutes" type="number" min="1" step="1" required defaultValue={setting?.defaultMinutes ?? 1800} /></label>
      <label>{text("Prix exact (€)", "Exact price (€)")}<input name="price" type="text" inputMode="decimal" required defaultValue={String((setting?.defaultPriceCents ?? 50000) / 100)} /></label>
      <label>{text("Règlement", "Payment")}<select name="source" value={source} onChange={event => setSource(event.target.value)}><option value="existing">{text("Rattacher un paiement existant", "Link an existing payment")}</option><option value="new">{text("Confirmer un nouveau paiement effectué", "Confirm a new completed payment")}</option></select></label>
      {source === "existing" ? <label>{text("Paiement existant", "Existing payment")}<select name="paymentId" required defaultValue=""><option value="">{text("Choisir", "Choose")}</option>{availablePayments.map(payment => <option key={payment.id} value={payment.id}>{formatDate(payment.date)} · {money(payment.amount)} · {payment.method} · {payment.id}</option>)}</select></label> : <>
        <label>{text("Date du paiement", "Payment date")}<input name="date" type="date" required defaultValue={paymentDate} /></label>
        <label>{text("Maison du règlement", "Payment house")}<select name="houseId" required defaultValue=""><option value="">{text("Choisir", "Choose")}</option>{houses.map(house => <option key={house.id} value={house.id}>{house.name}</option>)}</select></label>
        <label>{text("Moyen de règlement", "Payment method")}<select name="method" defaultValue="Virement">{["Virement", "Espèces", "CB", "Chèque", "Autre"].map(method => <option key={method} value={method}>{language === "en" ? ({ Virement: "Bank transfer", Espèces: "Cash", CB: "Card", Chèque: "Cheque", Autre: "Other" } as Record<string, string>)[method] : method}</option>)}</select></label>
        {!business?.hiddenFields.includes("notes") && <label>{text("Référence / note", "Reference / note")}<input name="note" maxLength={4000} /></label>}
        <label className={`full ${styles.checkbox}`}><input name="confirmed" type="checkbox" required />{text("Je confirme que ce nouveau paiement a réellement été effectué. Il sera enregistré une seule fois.", "I confirm this new payment has actually been made. It will be recorded once.")}</label>
      </>}
      {availableInvoices.length > 0 && <label className="full">{text("Facture fournisseur du même forfait (facultatif)", "Supplier invoice for this same package (optional)")}<select name="invoiceId" defaultValue=""><option value="">{text("Aucune facture liée", "No linked invoice")}</option>{availableInvoices.map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.invoiceReference || invoice.title} · {money(invoice.amount)} · {invoice.id}</option>)}</select></label>}
      <p className="muted-line full">{text("Les frais annexes restent distincts. Une facture explicitement liée est exclue du double comptage des mêmes cours dans les Charges.", "Additional expenses remain separate. An explicitly linked invoice is excluded from counting those lessons twice in Charges.")}</p>
      {message && <p role="alert" className="full">{message}</p>}
      <div className="form-actions full"><BusinessButton permission="write" type="submit" className="primary-button" disabled={saving}>{saving ? text("Enregistrement…", "Saving…") : text("Confirmer le forfait payé", "Confirm paid package")}</BusinessButton><button type="button" className="secondary-button" disabled={saving} onClick={() => setOpen(false)}>{text("Annuler", "Cancel")}</button></div>
    </BusinessForm>}
  </div>;
}

function HousePrepaidInvoiceLink({ worker, packageId, priceCents, state, invoices, onSave }: { worker: HouseTrackingWorker; packageId: string; priceCents: number; state: HousePrepaidState; invoices: VendorInvoice[]; onSave?: SaveHousePrepaid }) {
  const { language } = useI18n();
  const text = (fr: string, en: string) => language === "en" ? en : fr;
  const [saving, setSaving] = useState(false), [message, setMessage] = useState("");
  const pending = useRef(false), requestId = useRef<string | null>(null);
  const candidates = invoices.filter(invoice => invoice.contactId === worker.contactId && Math.round(invoice.amount * 100) === priceCents && invoice.status !== "Annulé" && invoice.status !== "En attente de facture" && !state.packages.some(pack => pack.invoiceId === invoice.id));
  if (!candidates.length || !state.canContribute || !onSave) return null;
  return <BusinessForm className="form-grid house-compact-form" pending={saving} onChange={() => { requestId.current = null; }} onSubmit={event => {
    event.preventDefault();
    if (pending.current) return;
    const invoiceId = String(new FormData(event.currentTarget).get("invoiceId") ?? "");
    if (!candidates.some(invoice => invoice.id === invoiceId)) return;
    pending.current = true; setSaving(true); requestId.current ??= crypto.randomUUID();
    void onSave(state.revision, requestId.current, "link_invoice", { packageId, invoiceId }).catch(() => setMessage(text("Lien non confirmé. Réessayez après vérification.", "Link not confirmed. Check and retry."))).finally(() => { pending.current = false; setSaving(false); });
  }}><label>{text("Lier la facture du même forfait", "Link the invoice for this package")}<select name="invoiceId" required defaultValue=""><option value="">{text("Choisir", "Choose")}</option>{candidates.map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.invoiceReference || invoice.title} · {invoice.id}</option>)}</select></label><BusinessButton permission="write" type="submit" className="secondary-button" disabled={saving}>{text("Confirmer le lien", "Confirm link")}</BusinessButton>{message && <p role="alert">{message}</p>}</BusinessForm>;
}
