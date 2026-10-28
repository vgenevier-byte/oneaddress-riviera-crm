import type { OwnerImportProposal } from "@/lib/fonciere/ownerImport";
import styles from "./ProjectsWorkspace.module.css";

export default function OwnerImportReview({ proposals, selected, onChange, lang }: { proposals: OwnerImportProposal[]; selected: Set<string>; onChange: (selected: Set<string>) => void; lang: "fr" | "en" }) {
  if (!proposals.length) return null;
  const t = (fr: string, en: string) => lang === "fr" ? fr : en;
  return <section data-owner-import-review>
    <h3>{t("Propriétaire(s) et contexte de vente — informations internes", "Owners and sale context — internal information")}</h3>
    <p>{t("Chaque proposition doit être cochée explicitement. Les propriétaires annoncés restent à identifier dans les Contacts ; aucun lien CRM n’est créé. Vos appréciations de négociation sont conservées.", "Select each proposal explicitly. Reported owners still require identification in Contacts; no CRM link is created. Your negotiation assessment is retained.")}</p>
    <div className={styles.reviewFields}>{proposals.map(proposal=><div className={styles.proposal} data-owner-proposal={proposal.field} key={proposal.id}>
      <label className={styles.checkLabel}><input type="checkbox" checked={selected.has(proposal.id)} onChange={event=>{const next=new Set(selected);if(event.target.checked)next.add(proposal.id);else next.delete(proposal.id);onChange(next);}}/><strong>{proposal.label[lang === "fr" ? 0 : 1]}</strong></label>
      {proposal.current && <div className={styles.currentValue}><span>{t("Valeur actuelle conservée sans sélection", "Current value retained unless selected")}</span><p>{proposal.current}</p></div>}
      <p>{proposal.display}</p><blockquote>{proposal.evidence.extract}</blockquote><small>{proposal.evidence.filename}{proposal.evidence.page ? ` · p. ${proposal.evidence.page}` : ""} · {t("À confirmer", "To confirm")}</small>
    </div>)}</div>
  </section>;
}
