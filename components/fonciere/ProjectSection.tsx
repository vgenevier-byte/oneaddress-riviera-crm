import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { ProjectSectionId } from "@/lib/fonciere/projectSectionState";
import styles from "./ProjectsWorkspace.module.css";

/** Hiding the panel preserves every field's local draft and running operation. */
export default function ProjectSection({ sectionId, anchor, number, title, note, summary, open, onToggle, children }: {
  sectionId: ProjectSectionId; anchor: string; number: string; title: string;
  note?: string; summary?: string; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return <section id={anchor} data-project-section={sectionId} data-expanded={open} className={`${styles.section} ${styles.collapsibleSection} ${sectionId === "hypotheses" ? styles.assumptions : ""}`}>
    <header className={styles.sectionHeading}><h3><button type="button" id={`fonciere-toggle-${sectionId}`} data-section-toggle aria-expanded={open} aria-controls={`fonciere-panel-${sectionId}`} onClick={onToggle} className={styles.sectionToggle}>
      <span className={styles.sectionNumber}>{number}</span><span className={styles.sectionTitle}>{title}</span>{summary && <span className={styles.sectionSummary}>{summary}</span>}<ChevronRight size={19} aria-hidden="true" className={open ? styles.sectionChevronOpen : undefined} />
    </button></h3></header>
    <div id={`fonciere-panel-${sectionId}`} className={styles.sectionPanel} hidden={!open} inert={!open}>
      {note && <p className={styles.sectionNote}>{note}</p>}{children}
    </div>
  </section>;
}
