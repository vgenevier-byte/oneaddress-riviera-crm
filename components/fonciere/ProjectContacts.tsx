"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import SearchableBusinessContactPicker from "@/components/SearchableBusinessContactPicker";
import { isCancelled, useScopedOperations } from "@/lib/access/operations";
import { createFonciereRepository } from "@/lib/fonciere/repository";
import { applyProjectContact, contactCompanyMatches, contactReplacementFields, isAgencyOption, projectContactLabel, type ContactCreateInput, type ContactRole, type ProjectContact } from "@/lib/fonciere/contacts";
import type { FonciereData } from "@/lib/fonciere/model";
import type { Contact } from "@/lib/types";
import { useFonciereLocale } from "@/lib/fonciere/locale";
import styles from "./ProjectContacts.module.css";

type Props = { data: FonciereData; onChange: (data: FonciereData) => void; canReadContacts: boolean; canWriteContacts: boolean; disabled?: boolean; accessSignal?: AbortSignal; onOpenContact?: (id: string) => void; onPendingChange?: (pending: boolean) => void };
type SearchState = { query: string; rows: ProjectContact[]; loading: boolean; error: string };
const asPickerContact = (row: ProjectContact): Contact => ({ ...row, kind: "Client", budget: 0, source: "", notes: "", createdAt: "" });
const asProjectContact = (row: Contact): ProjectContact => ({ id: row.id, entityType: row.entityType, name: row.name, firstName: row.firstName || "", companyName: row.companyName || "", email: row.email, phone: row.phone, city: row.city, postalAddress: row.postalAddress });
const blankSearch = (query = ""): SearchState => ({ query, rows: [], loading: false, error: "" });

export default function ProjectContacts({ data, onChange, canReadContacts, canWriteContacts, disabled = false, accessSignal, onOpenContact, onPendingChange }: Props) {
  const [lang] = useFonciereLocale(), begin = useScopedOperations("izord");
  const t = (fr: string, en: string) => lang === "fr" ? fr : en;
  const [agencySearch, setAgencySearch] = useState(() => blankSearch(data.agencyContactId ? "" : data.agencyName));
  const [agentSearch, setAgentSearch] = useState(() => blankSearch(data.agentContactId ? "" : data.agentName));
  const [linked, setLinked] = useState<Record<string, ProjectContact>>({});
  const [linkError, setLinkError] = useState("");
  const [createRole, setCreateRole] = useState<ContactRole | null>(null), [draft, setDraft] = useState<ContactCreateInput | null>(null);
  const [creating, setCreating] = useState(false), [creationError, setCreationError] = useState("");
  const [filterAgency, setFilterAgency] = useState(false), [opened, setOpened] = useState<ProjectContact | null>(null);
  const alive = useRef(true), createController = useRef<AbortController | null>(null);
  const latest = useRef({ data, onChange, disabled, canReadContacts, accessSignal });
  useLayoutEffect(() => { latest.current = { data, onChange, disabled, canReadContacts, accessSignal }; }, [data, onChange, disabled, canReadContacts, accessSignal]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; createController.current?.abort(); }; }, []);
  useEffect(() => { onPendingChange?.(Boolean(createRole)); return () => onPendingChange?.(false); }, [createRole, onPendingChange]);
  useEffect(() => {
    // A newly accepted import proposes matching CRM contacts, without selecting
    // any record or replacing a search that the user has already typed.
    const timer = window.setTimeout(() => {
      if (!data.agencyContactId && data.agencyName) setAgencySearch(previous => previous.query ? previous : blankSearch(data.agencyName));
      if (!data.agentContactId && data.agentName) setAgentSearch(previous => previous.query ? previous : blankSearch(data.agentName));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [data.agencyName, data.agentName, data.agencyContactId, data.agentContactId, data.provenance.length]);

  useEffect(() => {
    const local = new AbortController();
    const ids = [data.agentContactId, data.agencyContactId].filter(Boolean);
    if (!canReadContacts || !ids.length || accessSignal?.aborted) return () => local.abort();
    void (async () => {
      const op = await begin(), signal = AbortSignal.any([op.signal, local.signal, ...(accessSignal ? [accessSignal] : [])]), repository = createFonciereRepository(op.client);
      const rows = await op.run(() => Promise.all(ids.map(id => repository.readContact(id, { signal })))); signal.throwIfAborted();
      setLinked(Object.fromEntries(rows.filter((row): row is ProjectContact => Boolean(row)).map(row => [row.id, row])));
      setLinkError(rows.some(row => !row) ? t("Un contact lié est indisponible. Les informations locales sont conservées.", "A linked contact is unavailable. Local information is retained.") : "");
    })().catch(error => { if (!local.signal.aborted && !isCancelled(error)) setLinkError(t("Impossible de charger les contacts liés. Le brouillon est conservé.", "Linked contacts could not be loaded. The draft is retained.")); });
    return () => local.abort();
    // The source values remain local; loading a fresh contact never overwrites them.
  }, [data.agentContactId, data.agencyContactId, canReadContacts, begin, accessSignal, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const local = new AbortController();
    const tasks = ([['agency', agencySearch.query], ['agent', agentSearch.query]] as const).map(([role, query]) => {
      const setter = role === "agency" ? setAgencySearch : setAgentSearch;
      if (!canReadContacts || query.trim().length < 2 || accessSignal?.aborted) return;
      return window.setTimeout(() => { setter(previous => ({ ...previous, loading: true, error: "" })); void (async () => {
        const op = await begin(), signal = AbortSignal.any([op.signal, local.signal, ...(accessSignal ? [accessSignal] : [])]);
        const rows = await op.run(() => createFonciereRepository(op.client).searchContacts(query, { signal })); signal.throwIfAborted();
        setter(previous => ({ ...previous, loading: false, rows: rows.filter(row => role === "agency" ? isAgencyOption(row) : row.entityType !== "company") }));
      })().catch(error => { if (!local.signal.aborted && !isCancelled(error)) setter(previous => ({ ...previous, loading: false, rows: [], error: t("Recherche indisponible. Vos valeurs restent conservées.", "Search unavailable. Your values are retained.") })); }); }, 220);
    });
    return () => { local.abort(); tasks.forEach(timer => { if (timer !== undefined) window.clearTimeout(timer); }); };
  }, [agencySearch.query, agentSearch.query, canReadContacts, accessSignal, begin, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedAgent = canReadContacts ? linked[data.agentContactId] : undefined;
  const inconsistent = selectedAgent && data.agencyName && !contactCompanyMatches(selectedAgent, data.agencyName);
  function select(role: ContactRole, contact: ProjectContact | null) {
    const current = latest.current;
    if (current.disabled || !current.canReadContacts || current.accessSignal?.aborted) return false;
    const replaced = contactReplacementFields(current.data, role, contact);
    if (replaced.length && !window.confirm(t("Remplacer les coordonnées corrigées manuellement ou importées dans ce projet ? La fiche CRM restera inchangée.", "Replace the manually corrected or imported details in this project? The CRM contact record will remain unchanged."))) return false;
    if (contact) setLinked(previous => ({ ...previous, [contact.id]: contact }));
    current.onChange(applyProjectContact(current.data, role, contact));
    return true;
  }
  function prepareCreate(role: ContactRole) {
    const names = data.agentName.trim().split(/\s+/);
    setCreateRole(role); setCreationError(""); setDraft({ entityType: role === "agency" ? "company" : "person", name: role === "agent" ? names.pop() || "" : "", firstName: role === "agent" ? names.join(" ") : "", companyName: data.agencyName, email: role === "agent" ? data.agentEmail : data.agencyEmail, phone: role === "agent" ? data.agentPhone : data.agencyPhone, city: "", postalAddress: role === "agency" ? data.agencyAddress : "" });
  }
  async function create() {
    if (!draft || !createRole || !canWriteContacts || creating || disabled) return;
    const role = createRole, local = new AbortController(); createController.current = local; setCreating(true); setCreationError("");
    try {
      const op = await begin(), signal = AbortSignal.any([op.signal, local.signal, ...(accessSignal ? [accessSignal] : [])]);
      const row = await op.run(() => createFonciereRepository(op.client).createContact(draft, { signal })); signal.throwIfAborted();
      setLinked(previous => ({ ...previous, [row.id]: row }));
      // Creating a record does not itself overwrite corrected project values.
      setDraft(null); setCreateRole(null);
      if (!select(role, row)) {
        const setter = role === "agency" ? setAgencySearch : setAgentSearch;
        setter({ query: row.companyName || [row.firstName, row.name].filter(Boolean).join(" "), rows: [row], loading: false, error: "" });
      }
    } catch (error) { if (alive.current && !local.signal.aborted && !isCancelled(error)) setCreationError(error instanceof Error ? error.message : t("Création non confirmée. Votre saisie est conservée.", "Creation not confirmed. Your input is retained.")); }
    finally { if (alive.current && !local.signal.aborted) setCreating(false); }
  }
  function openContact(id: string) { if (onOpenContact) onOpenContact(id); else if (linked[id]) setOpened(linked[id]); }
  function renderPicker(role: ContactRole) {
    const search = role === "agency" ? agencySearch : agentSearch, setter = role === "agency" ? setAgencySearch : setAgentSearch;
    const id = data[role === "agency" ? "agencyContactId" : "agentContactId"];
    const rows = search.rows.filter(row => role !== "agent" || !filterAgency || contactCompanyMatches(row, data.agencyName));
    return <div className={styles.picker} key={role}>
      <SearchableBusinessContactPicker contacts={rows.map(asPickerContact)} value={id} queryValue={search.query} fallbackContactName={id ? role === "agency" ? data.agencyName : data.agentName : ""} selectedRecord={canReadContacts && linked[id] ? asPickerContact(linked[id]) : null} onSelect={row => select(role, row ? asProjectContact(row) : null)} searchMode="all" name={`${role}ContactId`} disabled={disabled || !canReadContacts || creating} loading={search.loading} onQueryChange={query => setter(previous => ({ ...previous, query, rows: [], error: "", loading: false }))} onOpenContact={openContact} resultLabel={row => projectContactLabel(asProjectContact(row))} label={role === "agency" ? t("Agence / entreprise du CRM", "CRM agency / company") : t("Agent immobilier / interlocuteur du CRM", "CRM estate agent / contact")} labels={{ placeholder: t("Entreprise, prénom, nom, email ou téléphone…", "Company, first or last name, email or phone…"), empty: t("Aucun contact correspondant", "No matching contacts"), change: t("Changer", "Change"), clear: t("Retirer le lien", "Unlink"), open: t("Ouvrir le contact", "Open contact"), loading: t("Recherche des contacts autorisés…", "Searching authorized contacts…"), unavailable: t("Contact lié — chargement indisponible", "Linked contact — loading unavailable") }} />
      {search.loading && <p role="status">{t("Recherche des contacts autorisés…", "Searching authorized contacts…")}</p>}
      {search.error && <p className={styles.error} role="alert">{search.error}</p>}
      {role === "agency" && !id && data.agencyName && <p className={styles.note}>{t("Nom d’entreprise conservé dans le projet. Un nom seul ne crée pas de relation CRM.", "Company name retained in the project. A name alone does not create a CRM link.")}</p>}
      {canWriteContacts && !disabled && <button type="button" className={styles.textButton} onClick={() => prepareCreate(role)}>{role === "agency" ? t("Créer une fiche entreprise", "Create a company contact") : t("Créer un contact", "Create a contact")}</button>}
    </div>;
  }
  const fields = [['agencyName', 'Nom de l’agence / entreprise', 'Agency / company name'], ['agencyAddress', 'Adresse de l’agence', 'Agency address'], ['agencyPhone', 'Téléphone de l’agence', 'Agency phone'], ['agencyEmail', 'Email de l’agence', 'Agency email'], ['agentName', 'Prénom et nom de l’agent', 'Agent first and last name'], ['agentPhone', 'Téléphone personnel de l’agent', 'Agent direct phone'], ['agentEmail', 'Email personnel de l’agent', 'Agent direct email']] as const;
  return <div className={styles.panel} data-project-contacts>
    <p className={styles.note}>{t("Choisissez des fiches CRM existantes. Les corrections ci-dessous s’appliquent uniquement à ce projet. L’adresse du bien reste indépendante.", "Choose existing CRM contacts. Corrections below apply only to this project. The property address stays separate.")}</p>
    {canReadContacts ? <div className={styles.selectors}>{renderPicker("agency")}{renderPicker("agent")}</div> : <p>{t("Les liens Contacts sont protégés. Les liens existants restent conservés lors de l’enregistrement.", "Contact links are protected. Existing links are preserved when saving.")}</p>}
    {canReadContacts && data.agencyName && <label className={styles.filter}><input type="checkbox" checked={filterAgency} disabled={disabled} onChange={event => setFilterAgency(event.target.checked)} />{t("Limiter la recherche de personnes à cette entreprise", "Limit people search to this company")}</label>}
    {inconsistent && <p className={styles.warning} role="status">{t("L’entreprise de l’agent ne correspond pas à l’agence renseignée. Vérifiez les deux choix ; aucune relation n’a été déduite automatiquement.", "The agent’s company differs from the entered agency. Review both choices; no relationship was inferred automatically.")}</p>}
    {linkError && <p className={styles.error} role="alert">{linkError}</p>}
    <div className={styles.fields}>{fields.map(([key, fr, en]) => {
      const role = key.startsWith("agent") ? "agent" : "agency";
      const baseline = data.contactSources?.[role]?.baseline as Partial<Record<string, string>> | undefined;
      const agentCompanyBaseline = key === "agencyName" ? data.contactSources?.agent?.baseline?.agencyName : undefined;
      const sourceValue = baseline?.[key] ?? agentCompanyBaseline;
      const localCorrection = sourceValue !== undefined && sourceValue !== data[key];
      return <label key={key}><span>{t(fr, en)}</span><input id={`fonciere-${key}`} type={key.toLowerCase().includes("email") ? "email" : key.toLowerCase().includes("phone") ? "tel" : "text"} value={data[key]} maxLength={12000} disabled={disabled || creating} onChange={event => onChange({ ...data, [key]: event.target.value })} />{sourceValue !== undefined && <small className={localCorrection ? styles.local : styles.note}>{localCorrection ? t("Correction locale au projet", "Project-local correction") : t("Repris du contact CRM", "Copied from CRM contact")}</small>}</label>;
    })}</div>
    {draft && createRole && <section className={styles.creation} aria-label={t("Création de contact CRM", "Create CRM contact")}><h4>{createRole === "agency" ? t("Nouvelle entreprise CRM", "New CRM company") : t("Nouveau contact CRM", "New CRM contact")}</h4><p>{t("Vérifiez le préremplissage. Les identités et coordonnées existantes sont contrôlées avant création ; les droits Contacts s’appliquent côté serveur.", "Review these prefilled details. Existing identities and contact details are checked before creation; Contacts permissions apply on the server.")}</p><div className={styles.fields}>{(['name', 'firstName', 'companyName', 'email', 'phone', 'city', 'postalAddress'] as const).map(key => <label key={key}><span>{{ name: t("Nom", "Last name"), firstName: t("Prénom", "First name"), companyName: t("Entreprise / agence", "Company / agency"), email: "Email", phone: t("Téléphone", "Phone"), city: t("Ville du contact", "Contact city"), postalAddress: t("Adresse du contact", "Contact address") }[key]}</span><input type={key === "email" ? "email" : key === "phone" ? "tel" : "text"} value={draft[key]} maxLength={500} disabled={creating} onChange={event => setDraft({ ...draft, [key]: event.target.value })} /></label>)}</div>{creationError && <p className={styles.error} role="alert">{creationError}</p>}<div className={styles.actions}><button type="button" onClick={() => { setDraft(null); setCreateRole(null); }} disabled={creating}>{t("Annuler", "Cancel")}</button><button type="button" onClick={() => void create()} disabled={disabled || !canWriteContacts || creating || (createRole === "agency" ? !draft.companyName.trim() : !draft.name.trim())}>{creating ? t("Création…", "Creating…") : t("Créer et sélectionner", "Create and select")}</button></div></section>}
    {canReadContacts && opened && <section className={styles.creation} aria-label={t("Fiche CRM", "CRM contact")}><h4>{projectContactLabel(opened)}</h4><p>{[opened.email, opened.phone, opened.postalAddress].filter(Boolean).join(" · ")}</p><button type="button" onClick={() => setOpened(null)}>{t("Fermer", "Close")}</button></section>}
  </div>;
}
