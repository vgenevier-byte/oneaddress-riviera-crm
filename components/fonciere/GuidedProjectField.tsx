"use client";

import type { FonciereData, FonciereField } from "@/lib/fonciere/model";
import { AddressField } from "@/components/address/AddressField";
import { applyPropertyAddressInput, editPropertyAddress } from "@/lib/fonciere/address";
import {
  GUIDED_FIELD_DEFINITIONS, GUIDED_CHECK_STATUSES, GUIDED_DIAGNOSTIC_STATUSES,
  readGuidedField, setGuidedField, setGuidedFieldDetail, toggleGuidedMulti,
  type GuidedComposite, type GuidedFieldDefinition, type GuidedKey, type GuidedOption, type GuidedRow, type GuidedValue,
} from "@/lib/fonciere/guided";
import GuidedNumberInput from "./GuidedNumberInput";
import styles from "./ProjectsWorkspace.module.css";

export type GuidedFieldSpec = { key: FonciereField | GuidedKey; fr: string; en: string; long?: boolean; wide?: boolean; numeric?: boolean };
export type ProjectDocumentOption = { id: string; label: string };
type Props = { field: GuidedFieldSpec; data: FonciereData; onChange: (next: FonciereData) => void; lang: "fr" | "en"; idPrefix?: string; disabled?: boolean; suggestions?: string[]; documents?: ProjectDocumentOption[] };
const isGuidedKey = (key: string): key is GuidedKey => key in GUIDED_FIELD_DEFINITIONS;
const isComposite = (value: GuidedValue | undefined): value is GuidedComposite => Boolean(value && typeof value === "object" && !Array.isArray(value));
const stringValue = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";
const listValue = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === "string") ? value as string[] : [];

function Choice({ id, options = [], value, onChange, lang, disabled, buttons = false, label }: { id: string; options?: readonly GuidedOption[]; value: string; onChange: (value: string) => void; lang: "fr" | "en"; disabled?: boolean; buttons?: boolean; label: string }) {
  const empty = lang === "fr" ? "Non renseigné" : "Not provided";
  return buttons ? <div id={id} className={styles.choiceButtons} role="group" aria-label={label}>
    {[{ value: "", label: { fr: "Non renseigné", en: "Not provided" } }, ...options].map(option => <button type="button" key={option.value} disabled={disabled} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label[lang]}</button>)}
  </div> : <select id={id} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} aria-label={label}><option value="">{empty}</option>{options.map(option => <option key={option.value} value={option.value}>{option.label[lang]}</option>)}</select>;
}

function Multiple({ id, options = [], values, onChange, lang, disabled, label }: { id: string; options?: readonly GuidedOption[]; values: string[]; onChange: (values: string[]) => void; lang: "fr" | "en"; disabled?: boolean; label: string }) {
  return <div id={id} role="group" aria-label={label} className={styles.multiOptions}>{options.map(option => <label key={option.value} className={styles.multiChoice}><input type="checkbox" checked={values.includes(option.value)} disabled={disabled} onChange={() => onChange(toggleGuidedMulti(values, option.value))} /><span>{option.label[lang]}</span></label>)}</div>;
}

function LinkedDocument({ id, value, onChange, lang, documents = [] }: { id: string; value: string; onChange: (value: string) => void; lang: "fr" | "en"; documents?: ProjectDocumentOption[] }) {
  const known = !value || documents.some(item => item.id === value);
  return <select id={id} value={value} onChange={event => onChange(event.target.value)}><option value="">{lang === "fr" ? "Aucun document associé" : "No document linked"}</option>{!known && <option value={value}>{lang === "fr" ? "Document conservé" : "Retained document"} · {value}</option>}{documents.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>;
}

export default function GuidedProjectField({ field, data, onChange, lang, idPrefix = "fonciere", disabled, suggestions = [], documents = [] }: Props) {
  const t = (fr: string, en: string) => lang === "fr" ? fr : en;
  const key = field.key, id = `${idPrefix}-${key}`;
  const def: GuidedFieldDefinition | undefined = isGuidedKey(key) ? GUIDED_FIELD_DEFINITIONS[key] : undefined;
  const label = def?.label[lang] || t(field.fr, field.en);
  const value = isGuidedKey(key) ? readGuidedField(data, key) : data[key as FonciereField];
  const raw = key in data && typeof data[key as FonciereField] === "string" ? data[key as FonciereField] : "";
  const editText = (next: string) => onChange(["propertyAddress", "postalCode", "city"].includes(key) ? editPropertyAddress(data, key as "propertyAddress" | "postalCode" | "city", next) : { ...data, [key]: next });
  const detail = isGuidedKey(key) ? data.guided.details[key] || "" : "";
  const put = (next: GuidedValue) => { if (isGuidedKey(key)) onChange(setGuidedField(data, key, next)); };
  const putDetail = (next: string) => { if (isGuidedKey(key)) onChange(setGuidedFieldDetail(data, key, next)); };
  const scalar = stringValue(value);
  const selected = listValue(value);
  const composite = isComposite(value) ? value : {};
  const rows = Array.isArray(value) && value.every(row => row && typeof row === "object" && "code" in row) ? value as GuidedRow[] : [];
  const rowOptions = def?.kind === "diagnostics" ? GUIDED_DIAGNOSTIC_STATUSES : GUIDED_CHECK_STATUSES;
  const updateRow = (code: string, patch: Partial<GuidedRow>) => put(rows.map(row => {
    if (row.code !== code) return row;
    const next = { ...row, ...patch };
    if (next.status !== "available") delete next.grade;
    return next;
  }));
  const detailPrompt = key === "annexes" ? t("Précisions sur les annexes", "Outbuilding details") : key === "exterior" ? t("Précisions sur les extérieurs", "Outdoor space details") : key === "pool" ? t("Chauffée, intérieur / extérieur, état…", "Heated, indoor / outdoor, condition…") : key === "equipment" ? t("Type de chauffage, accessibilité, autres précisions…", "Heating, accessibility, other details…") : t("Précision / autre — préciser", "Detail / other — specify");
  const showDetail = !!def && !["number", "composite", "checklist", "diagnostics"].includes(def.kind) && (detail || def.kind === "multi" && selected.length > 0 && !selected.some(item => ["none", "not_applicable", "to_confirm"].includes(item)) || def.kind === "choice" && ["other"].includes(scalar));
  if (key === "propertyAddress" || key === "agencyAddress") return <div className={`${styles.field} ${field.wide ? styles.wide : ""}`} data-guided-field={key}>
    <AddressField multiline id={id} name={key} value={raw} label={label} lang={lang} disabled={disabled} maxLength={12000} metadata={key === "propertyAddress" ? data.propertyAddressDetails : data.agencyAddressDetails} textMode={key === "propertyAddress" ? "line1" : "full"} city={key === "propertyAddress" ? data.city : undefined}
      onChange={next => key === "propertyAddress" ? editText(next) : onChange({ ...data, agencyAddress: next, agencyAddressDetails: undefined })}
      onMetadataChange={next => { if (!next) return; onChange(key === "propertyAddress" ? applyPropertyAddressInput(data, next) : { ...data, agencyAddress: next.formattedAddress, agencyAddressDetails: next }); }} />
    {key === "propertyAddress" && <p className={styles.fieldDescription}>{t("Adresse du bien uniquement. Une ville ou un secteur peut rester approximatif. Les compléments et les instructions d’accès restent modifiables.", "Property address only. A town or area can remain approximate. Address details and access instructions remain editable.")}</p>}
  </div>;
  return <div className={`${styles.field} ${field.wide ? styles.wide : ""}`} data-guided-field={key}>
    {def && ["multi", "composite", "checklist", "diagnostics"].includes(def.kind) ? <span id={`${id}-label`} className={styles.fieldLabel}>{label}</span> : <label htmlFor={id} className={styles.fieldLabel}>{label}{key === "name" && <span className={styles.required}> *</span>}</label>}
    {!def ? field.long ? <textarea id={id} value={raw} disabled={disabled} rows={field.wide ? 4 : 3} maxLength={10000} onChange={event => editText(event.target.value)} placeholder={t("À compléter / à confirmer", "To complete / to confirm")} /> : <input id={id} value={raw} disabled={disabled} type={/Email$/.test(key) ? "email" : /Phone$/.test(key) ? "tel" : "text"} maxLength={key === "name" ? 200 : 1000} required={key === "name"} autoComplete={key === "city" ? "address-level2" : key === "postalCode" ? "postal-code" : "off"} list={suggestions.length ? `${id}-suggestions` : undefined} onChange={event => editText(event.target.value)} placeholder={key === "name" ? t("Ex. Villa des Oliviers", "E.g. Villa des Oliviers") : t("À compléter", "To complete")} /> : def.kind === "choice" ? <Choice id={id} value={scalar} options={def.options} lang={lang} disabled={disabled} label={label} buttons={key === "pool" || key === "locationPrecision"} onChange={next => put(next || null)} /> : def.kind === "number" ? <GuidedNumberInput id={id} value={scalar} onInvalidDraft={() => onChange(data)} unit={def.unit} integer={def.integer} min={def.min} max={def.max} disabled={disabled} lang={lang} label={label} onChange={next => put(next === "" ? null : Number(next))} /> : def.kind === "multi" ? <Multiple id={id} values={selected} options={def.options} disabled={disabled} lang={lang} label={label} onChange={put} /> : def.kind === "composite" ? <div className={styles.composite} role="group" aria-labelledby={`${id}-label`}>{def.subfields?.filter(subfield => !["detail", "documentId"].includes(subfield.key) || !!composite[subfield.key] || !["renovation", "division", "extension", "buildability"].includes(key) || !!composite.stage && !["not_planned", "not_applicable"].includes(String(composite.stage))).map(subfield => {
      const subId = `${id}-${subfield.key}`, current = composite[subfield.key];
      const change = (next: string | number | string[] | null) => put({ ...composite, [subfield.key]: next });
      return <div key={subfield.key} className={`${styles.subfield} ${subfield.kind === "text" ? styles.subfieldWide : ""}`}><label htmlFor={subId}>{subfield.label[lang]}</label>{subfield.key === "documentId" ? <LinkedDocument id={subId} value={stringValue(current)} lang={lang} documents={documents} onChange={change} /> : subfield.kind === "choice" ? <Choice id={subId} value={stringValue(current)} options={subfield.options} lang={lang} disabled={disabled} label={subfield.label[lang]} onChange={next => change(next || null)} /> : subfield.kind === "number" ? <GuidedNumberInput id={subId} value={stringValue(current)} onInvalidDraft={() => onChange(data)} unit={subfield.unit} integer={subfield.integer} min={subfield.min} max={subfield.max} lang={lang} disabled={disabled} label={subfield.label[lang]} onChange={next => change(next === "" ? null : Number(next))} /> : subfield.kind === "multi" ? <Multiple id={subId} values={listValue(current)} options={subfield.options} lang={lang} disabled={disabled} label={subfield.label[lang]} onChange={change} /> : <textarea id={subId} rows={2} maxLength={12000} value={stringValue(current)} disabled={disabled} onChange={event => change(event.target.value)} placeholder={t("Facultatif", "Optional")} />}</div>;
    })}</div> : <div className={styles.checklist} role="group" aria-labelledby={`${id}-label`}>{def.options?.map(option => {
      const row = rows.find(item => item.code === option.value), rowId = `${id}-${option.value}`;
      return <div key={option.value} className={styles.checklistRow}><label className={styles.checkLabel}><input type="checkbox" checked={!!row} disabled={disabled} onChange={event => put(event.target.checked ? [...rows, { code: option.value, status: def.kind === "diagnostics" ? "not_provided" : "to_verify" }] : rows.filter(item => item.code !== option.value))} /><span>{option.label[lang]}</span></label>{row && <div className={styles.composite}>
        <label htmlFor={`${rowId}-status`}><span>{t("État", "Status")}</span><Choice id={`${rowId}-status`} value={row.status} options={rowOptions} lang={lang} disabled={disabled} label={`${option.label[lang]} — ${t("État", "Status")}`} onChange={next => { if (next) updateRow(option.value, { status: next }); }} /></label>
        {["dpe", "ges"].includes(option.value) && row.status === "available" && <label htmlFor={`${rowId}-grade`}><span>{t("Classe", "Rating")}</span><select id={`${rowId}-grade`} value={row.grade || ""} onChange={event => updateRow(option.value, { grade: event.target.value || undefined })}><option value="">{t("À confirmer", "To confirm")}</option>{"ABCDEFG".split("").map(grade => <option key={grade}>{grade}</option>)}</select></label>}
        <label className={styles.subfieldWide} htmlFor={`${rowId}-detail`}><span>{t("Précision / source", "Detail / source")}</span><textarea id={`${rowId}-detail`} value={row.detail || ""} rows={2} maxLength={12000} onChange={event => updateRow(option.value, { detail: event.target.value })} /></label>
        <label className={styles.subfieldWide} htmlFor={`${rowId}-document`}><span>{t("Document associé", "Linked document")}</span><LinkedDocument id={`${rowId}-document`} value={row.documentId || ""} lang={lang} documents={documents} onChange={next => updateRow(option.value, { documentId: next })} /></label>
      </div>}</div>;
    })}</div>}
    {suggestions.length > 0 && <datalist id={`${id}-suggestions`}>{suggestions.map(suggestion => <option key={suggestion} value={suggestion} />)}</datalist>}
    {def?.kind === "multi" && selected.length === 0 && <p className={styles.fieldDescription}>{t("Non renseigné — aucune caractéristique supposée.", "Not provided — no characteristic is assumed.")}</p>}
    {showDetail && <label htmlFor={`${id}-detail`} className={styles.fieldDescription}>{detailPrompt}<textarea id={`${id}-detail`} value={detail} disabled={disabled} maxLength={12000} rows={2} onChange={event => putDetail(event.target.value)} placeholder={t("Précision facultative ; aucune information ne sera supposée", "Optional detail; no information will be assumed")} /></label>}
    {!!def && raw && <details className={styles.legacyValue} open={value === undefined || undefined}><summary>{value === undefined ? t("Information conservée — à confirmer", "Retained information — to confirm") : t("Texte d’origine conservé", "Original text retained")}</summary><p>{raw}</p></details>}
    {key === "fees" && <p className={styles.fieldDescription}>{t("Le prix demandé reste le montant saisi. Les honoraires inclus ne sont pas ajoutés une seconde fois ; montant et pourcentage décrivent les mêmes honoraires.", "The asking price remains as entered. Included fees are not added again; amount and percentage describe the same fees.")}</p>}
    {["renovation", "division", "extension", "buildability"].includes(key) && <p className={styles.fieldDescription}>{t("Ce choix décrit l’état de l’étude. Il ne vaut pas autorisation obtenue.", "This records the assessment stage. It does not establish planning approval.")}</p>}
    {key === "pointsToVerify" && <p className={styles.fieldDescription}>{t("Chaque point ajouté commence « À vérifier ». Le passage à « Vérifié » est une action explicite.", "New checks begin as “To verify”. Marking one “Verified” requires an explicit action.")}</p>}
    {key === "rentalHypothesis" && <p className={styles.fieldDescription}>{t("Indiquez l’unité du loyer : un prix à la nuit ou à la semaine reste distinct d’un loyer mensuel.", "Specify the rent period: nightly and weekly prices remain separate from monthly rent.")}</p>}
  </div>;
}
