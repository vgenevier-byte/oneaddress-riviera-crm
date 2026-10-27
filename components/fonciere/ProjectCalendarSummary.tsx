"use client";

import type { FonciereData } from "@/lib/fonciere/model";
import { calculateProjectCalendar, projectCalendarRows, projectCalendarRule, PROJECT_CALENDAR_CHRONOLOGY_WARNING } from "@/lib/fonciere/calendar";
import styles from "./ProjectsWorkspace.module.css";

/** A derived preview only: displaying the calendar never changes the project. */
export default function ProjectCalendarSummary({ data, lang }: { data: FonciereData; lang: "fr" | "en" }) {
  const calendar = calculateProjectCalendar(data);
  return <div role="region" className={styles.projectCalendar} aria-labelledby="fonciere-calendar-title" data-project-calendar>
    <h4 id="fonciere-calendar-title">{lang === "fr" ? "Calendrier prévisionnel du projet" : "Projected project calendar"}</h4>
    <dl>{projectCalendarRows(data, lang).map(row => <div key={row.key} data-calendar-row={row.key}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
    {calendar.inconsistentChronology && <p role="alert" className={styles.calendarWarning}>{PROJECT_CALENDAR_CHRONOLOGY_WARNING[lang]}</p>}
    <p className={styles.calendarRule}>{projectCalendarRule(lang)}</p>
  </div>;
}
