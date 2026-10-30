"use client";

import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { currentGuidedValue, guidedReadableFields, type GuidedKey } from "@/lib/fonciere/guided";
import ProjectFieldEditor, { type ProjectFieldEditorHandle } from "./ProjectFieldEditor";
import GuidedProjectField, { type GuidedFieldSpec } from "./GuidedProjectField";
import styles from "./ProjectsWorkspace.module.css";

type Props = Omit<ComponentProps<typeof GuidedProjectField>, "field"> & { section: string; fields: GuidedFieldSpec[] };
export function primaryPropertyFields(type: unknown): string[] {
  const common = ["askingPrice", "area"];
  switch (type) {
    case "house": case "villa": return [...common, "land", "bedrooms", "condition", "occupancy", "view", "pool"];
    case "apartment": return [...common, "bedrooms", "floor", "condition", "occupancy", "view"];
    case "land": return ["askingPrice", "land", "servicing", "buildability", "view"];
    case "building": case "mixed": return [...common, "lots", "uses", "condition", "occupancy"];
    case "commercial": case "offices": case "industrial": return [...common, "uses", "condition", "occupancy"];
    case "parking": return ["askingPrice", "parkingSpaces", "parkingType", "access"];
    default: return common;
  }
}
function DescriptionEditor({ text, label, lang, children }: { text: string; label: string; lang: "fr" | "en"; children: ReactNode }) {
  const [open, setOpen] = useState(!text);
  return <details className={`${styles.compactDetail} ${styles.wide}`} open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary><strong>{label}</strong>{text && <><span>{text.slice(0, 180)}{text.length > 180 ? "…" : ""}</span><small>{lang === "fr" ? "Lire la suite / modifier" : "Read more / edit"}</small></>}</summary>{children}</details>;
}
/** Every editor stays mounted, including unfinished input, when its details close. */
export default function CompactProjectFields({ section, fields, ...props }: Props) {
  const { data, lang } = props;
  const editors = useRef(new Map<string, ProjectFieldEditorHandle>());
  const picker = useRef<HTMLSelectElement>(null);
  const t = (fr: string, en: string) => lang === "fr" ? fr : en;
  const readable = guidedReadableFields(data, lang);
  const primary = section === "property" ? primaryPropertyFields(currentGuidedValue(data, "propertyType")) : section === "description" ? ["description", "agencyPotential", "pointsToVerify"] : section === "additional" ? ["charges", "constraints"] : [];
  const text = (field: GuidedFieldSpec) => readable[field.key as GuidedKey] ?? (field.key in data && typeof data[field.key as keyof typeof data] === "string" ? String(data[field.key as keyof typeof data]) : "");
  const label = (field: GuidedFieldSpec) => lang === "fr" ? field.fr : field.en;
  const secondary = fields.filter(field => !primary.includes(field.key));
  const field = (spec: GuidedFieldSpec) => <GuidedProjectField {...props} field={spec} compact />;
  return <div className={styles.compactFields} data-compact-section={section}>
    {section === "additional" && <div className={styles.field} data-guided-field="diagnosticsReceived"><label htmlFor="fonciere-diagnosticsReceived">{t("Diagnostics reçus ?", "Diagnostic reports received?")}</label><select id="fonciere-diagnosticsReceived" disabled={props.disabled} value={data.diagnosticsReceived} onChange={event => props.onChange({ ...data, diagnosticsReceived: event.target.value as typeof data.diagnosticsReceived })}><option value="">{t("Sans réponse", "Unanswered")}</option><option value="yes">{t("Oui", "Yes")}</option><option value="no">{t("Non", "No")}</option></select><small>{t("Documents communiqués ; ne certifie ni leur exhaustivité ni l’absence d’anomalie.", "Documents supplied; does not certify completeness or absence of issues.")}</small></div>}
    <div className={styles.fieldGrid}>{fields.filter(spec => primary.includes(spec.key)).map(spec => spec.key === "description" ? <DescriptionEditor key={`description:${props.calendarInputEpoch}`} text={text(spec)} label={label(spec)} lang={lang}>{field(spec)}</DescriptionEditor> : <div key={spec.key} className={spec.wide ? styles.wide : undefined}>{field(spec)}</div>)}</div>
    <div className={styles.compactExtras}>{secondary.map(spec => <ProjectFieldEditor key={spec.key} ref={editor => { if (editor) editors.current.set(spec.key, editor); else editors.current.delete(spec.key); }} data-extra-field={spec.key} className={styles.compactDetail} hasValue={Boolean(text(spec))} onCloseEmpty={() => picker.current?.focus()} summary={<><strong>{label(spec)}</strong>{text(spec) && <span>{text(spec).slice(0, 180)}{text(spec).length > 180 ? "…" : ""}</span>}<small>{t("Modifier", "Edit")}</small></>}>{field(spec)}</ProjectFieldEditor>)}</div>
    {secondary.length > 0 && <label className={styles.addComplement}><span>{t("Ajouter / modifier un complément", "Add / edit a detail")}</span><select ref={picker} value="" disabled={props.disabled} onChange={event => editors.current.get(event.target.value)?.open()}><option value="">{t("Choisir une information…", "Choose information…")}</option>{secondary.map(spec => <option key={spec.key} value={spec.key}>{label(spec)}</option>)}</select></label>}
  </div>;
}
