"use client";

import { useMemo, useState } from "react";
import type { Contact } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { getContactLabel } from "@/lib/contactIdentity";
import { getCompanyPeople, getContactCompany } from "@/lib/contactCompany";
import { createContactFieldResolver } from "@/lib/contactSearch";
import { SearchableSelect } from "./search/SearchableSelect";
import { sortSelectOptions } from "@/lib/selectOptions";
import { useConfirmedForm, type FormSave, type FormSaveResult } from "@/lib/access/useConfirmedForm";
import { BusinessButton, BusinessForm, BusinessLabel } from "./BusinessPermissions";
import styles from "./ContactCompanyFields.module.css";

export type ContactBundleSave = (contact: Pick<Contact, "id"> & Partial<Contact>, person?: Pick<Contact, "id"> & Partial<Contact>, existingPersonId?: string) => FormSave;

/** The affiliation is always an existing ID. Historical free text is preserved separately. */
export function ContactCompanyPicker({ contact, contacts, onOpen, active = true }: { contact?: Partial<Contact>; contacts: Contact[]; onOpen?: (contact: Contact) => void; active?: boolean }) {
  const { t, language } = useI18n();
  const searchFields = useMemo(() => createContactFieldResolver(contacts), [contacts]);
  const [companyId, setCompanyId] = useState(contact?.companyId ?? "");
  const company = getContactCompany({ ...contact, companyId } as Contact, contacts);
  const lastPerson = Boolean(contact?.id && contact.companyId && getCompanyPeople(contact.companyId, contacts).length <= 1);
  const companies = sortSelectOptions(contacts.filter(item => item.entityType === "company" && !item.mergedIntoCompanyId), getContactLabel, language);
  return <fieldset className={`full ${styles.section} ${styles.first}`} disabled={!active} data-contact-company-picker>
    {!active && <p className="muted-line">{t("crm.contacts.company.qualifyPerson")}</p>}
    <BusinessLabel>{t("crm.contacts.identity.companyAffiliationOptional")}<SearchableSelect name="companyId" value={companyId} disabled={!active} onChange={event => setCompanyId(event.target.value)}>
      <option value="" disabled={lastPerson}>{t("crm.contacts.company.independent")}</option>
      {companyId && !companies.some(item => item.id === companyId) && <option value={companyId} disabled>{company ? getContactLabel(company) : t("crm.contacts.company.unavailable")}</option>}
      {companies.map(item => <option key={item.id} value={item.id} data-search={searchFields(item).filter(Boolean).join(" ")} data-secondary={[item.city, item.postalAddress, item.email, item.phone].filter(Boolean).join(" · ")} disabled={lastPerson && item.id !== contact?.companyId}>{getContactLabel(item)}</option>)}
    </SearchableSelect></BusinessLabel>
    {lastPerson && <p className="muted-line">{t("crm.contacts.company.lastPerson")}</p>}
    {company && onOpen && <BusinessButton type="button" className="secondary-button" onClick={() => onOpen(company)}>{t("crm.contacts.company.openCompany")}</BusinessButton>}
    {contact?.companyName && <p className="muted-line">{t("crm.contacts.company.historicalAffiliation", { name: contact.companyName })}</p>}
  </fieldset>;
}

/** Always mounted during a nature toggle, so entering company details never loses a person draft. */
export function FirstCompanyContactFields({ contacts, companyId, required = true, initialMode = "existing", active = true }: { contacts: Contact[]; companyId?: string; required?: boolean; initialMode?: string; active?: boolean }) {
  const { t, language } = useI18n();
  const [mode, setMode] = useState(initialMode);
  const searchFields = useMemo(() => createContactFieldResolver(contacts), [contacts]);
  const [personId, setPersonId] = useState("");
  const people = sortSelectOptions(contacts.filter(person => person.entityType !== "company" && Boolean(person.name?.trim()) && (!person.companyId || person.companyId === companyId)), getContactLabel, language);
  return <fieldset className={`full ${styles.section} ${styles.first}`} disabled={!active} style={active ? undefined : { display: "none" }} data-first-company-contact>
    <h4>{t(companyId && getCompanyPeople(companyId, contacts).length ? "crm.contacts.company.newPerson" : "crm.contacts.company.firstPerson")}</h4>
    <p className="muted-line">{t("crm.contacts.company.atomicHint")}</p>
    <BusinessLabel>{t("crm.contacts.company.firstPersonChoice")}<select name="companyPersonMode" value={mode} onChange={event => setMode(event.target.value)}>
      <option value="existing">{t("crm.contacts.company.attachExisting")}</option>
      <option value="new">{t("crm.contacts.company.createPerson")}</option>
    </select></BusinessLabel>
    <div hidden={mode !== "existing"} className={styles.section}>
      <BusinessLabel>{t("crm.contacts.company.personRequired")}<SearchableSelect name="companyExistingPersonId" value={personId} onChange={event => setPersonId(event.target.value)} required={required && mode === "existing"} disabled={!active || mode !== "existing"}>
        <option value="">{t("crm.contacts.company.choosePerson")}</option>
        {people.map(person => <option key={person.id} value={person.id} data-search={searchFields(person).filter(Boolean).join(" ")} data-secondary={[getContactCompany(person, contacts)?.companyName || person.companyName, person.city, person.email, person.phone, person.entityType === undefined ? t("crm.contacts.company.legacyPerson") : ""].filter(Boolean).join(" · ")}>{getContactLabel(person)}</option>)}
      </SearchableSelect></BusinessLabel>
    </div>
    <div hidden={mode !== "new"} className={styles.grid}>
      <BusinessLabel>{t("crm.contacts.e325bf8f90")}<input name="companyPersonFirstName" disabled={mode !== "new"} /></BusinessLabel>
      <BusinessLabel>{t("crm.contacts.identity.lastNameRequired")}<input name="companyPersonName" required={required && mode === "new"} disabled={mode !== "new"} onChange={event => event.currentTarget.setCustomValidity(event.currentTarget.value.trim() ? "" : t("crm.contacts.validation.contact_name_required"))} /></BusinessLabel>
      <BusinessLabel>{t("crm.contacts.969ccbd3cf")}<input name="companyPersonEmail" type="email" disabled={mode !== "new"} /></BusinessLabel>
      <BusinessLabel>{t("crm.contacts.cc4c424b57")}<input name="companyPersonPhone" type="tel" disabled={mode !== "new"} /></BusinessLabel>
      <BusinessLabel>{t("crm.contacts.company.function")}<input name="companyPersonFunction" disabled={mode !== "new"} /></BusinessLabel>
    </div>
  </fieldset>;
}

/** One stable ID per draft makes a response loss safe to retry. */
export function readFirstCompanyContact(form: HTMLFormElement, contact: Pick<Contact, "id"> & Partial<Contact>) {
  const values = new FormData(form);
  if (contact.entityType !== "company" || !values.has("companyPersonMode")) return {};
  if (values.get("companyPersonMode") === "existing") return { existingPersonId: String(values.get("companyExistingPersonId") ?? "") || undefined };
  const id = form.dataset.companyPersonDraftId || crypto.randomUUID();
  form.dataset.companyPersonDraftId = id;
  const person: Pick<Contact, "id"> & Partial<Contact> = {
    id, entityType: "person", name: String(values.get("companyPersonName") ?? "").trim(), firstName: String(values.get("companyPersonFirstName") ?? "").trim(),
    email: String(values.get("companyPersonEmail") ?? "").trim(), phone: String(values.get("companyPersonPhone") ?? "").trim(),
    organizationFunction: String(values.get("companyPersonFunction") ?? "").trim(), kind: contact.kind || "Client", city: "", postalAddress: "", budget: 0, source: "Direct", notes: "", createdAt: new Date().toISOString().slice(0, 10)
  };
  return { person };
}

export function CompanyPeople({ company, contacts, onOpen, onEdit, onUpdate, onBundle, onDirty }: { company: Contact; contacts: Contact[]; onOpen: (contact: Contact) => void; onEdit: (contact: Contact) => void; onUpdate: (contact: Pick<Contact, "id"> & Partial<Contact>) => FormSave; onBundle: ContactBundleSave; onDirty?: () => void }) {
  const { t, language } = useI18n();
  const [adding, setAdding] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirmation = useConfirmedForm(onDirty);
  const people = sortSelectOptions(getCompanyPeople(company.id, contacts), getContactLabel, language);
  async function update(patch: Pick<Contact, "id"> & Partial<Contact>) {
    if (busy) return;
    setBusy(true); setFailed(false);
    try { const result = await onUpdate(patch); if (!result || !result.ok) setFailed(true); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  }
  return <section className={styles.section} data-company-people>
    <h4>{t("crm.contacts.company.people")}</h4>
    {!people.length && <p role="status">{t("crm.contacts.company.needsContact")}</p>}
    {people.map(person => <article className={`item-card ${styles.person}`} key={person.id}>
      <div><strong>{getContactLabel(person)}</strong>{company.primaryContactId === person.id && <span className={styles.primary}> · {t("crm.contacts.company.primary")}</span>}<p className="muted-line">{[person.organizationFunction, person.email, person.phone].filter(Boolean).join(" · ")}</p></div>
      <div className="item-actions">
        <BusinessButton type="button" className="secondary-button" onClick={() => onOpen(person)}>{t("crm.contacts.17eaee489b")}</BusinessButton>
        <BusinessButton permission="write" type="button" className="secondary-button" onClick={() => onEdit(person)}>{t("crm.contacts.42e37604b6")}</BusinessButton>
        {company.primaryContactId !== person.id && <BusinessButton permission="write" type="button" className="secondary-button" disabled={busy} onClick={() => void update({ id: company.id, primaryContactId: person.id })}>{t("crm.contacts.company.makePrimary")}</BusinessButton>}
        <BusinessButton permission="write" type="button" className="secondary-button" disabled={busy || people.length <= 1} title={people.length <= 1 ? t("crm.contacts.company.lastPerson") : undefined} onClick={() => void update({ id: person.id, companyId: "" })}>{t("crm.contacts.company.detach")}</BusinessButton>
      </div>
    </article>)}
    {people.length === 1 && <p className="muted-line">{t("crm.contacts.company.lastPerson")}</p>}
    {failed && <p role="alert">{t("crm.contacts.company.saveRefused")}</p>}
    {!adding ? <div className="item-actions"><BusinessButton permission="write" type="button" className="secondary-button" onClick={() => setAdding("existing")}>{t("crm.contacts.company.attachExisting")}</BusinessButton><BusinessButton permission="write" type="button" className="secondary-button" onClick={() => setAdding("new")}>{t("crm.contacts.company.createPerson")}</BusinessButton></div> : <BusinessForm className={styles.section} pending={confirmation.saving} onChangeCapture={confirmation.changed} onSubmit={event => {
      event.preventDefault(); const form = event.currentTarget;
      const first = readFirstCompanyContact(form, company);
      void confirmation.submit(form, async () => {
        const result = await onBundle({ id: company.id, entityType: "company" }, first.person, first.existingPersonId);
        return result || { ok: false, message: "contact_confirmation_missing" } satisfies FormSaveResult;
      }, newer => { if (!newer) setAdding(null); });
    }}>
      <FirstCompanyContactFields contacts={contacts} companyId={company.id} initialMode={adding} />
      {confirmation.message && <p role="alert">{t("crm.contacts.company.saveRefused")}</p>}
      <div className="item-actions"><BusinessButton type="button" className="secondary-button" disabled={confirmation.saving} onClick={() => setAdding(null)}>{t("crm.contacts.46ad3916f6")}</BusinessButton><BusinessButton permission="write" type="submit" className="primary-button">{t("crm.contacts.company.savePerson")}</BusinessButton></div>
    </BusinessForm>}
  </section>;
}
