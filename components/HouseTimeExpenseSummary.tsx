"use client";

import type { FormSaveResult } from "@/lib/access/useConfirmedForm";
import { getHouseTimeExpenseAmount, type HouseTimeExpenseEdit } from "@/lib/houseTracking";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { HouseTimeEntry } from "@/lib/types";
import { BusinessButton } from "./BusinessPermissions";
import HouseTimeExpenseEditor from "./HouseTimeExpenseEditor";
import styles from "./HouseTimeExpenseSummary.module.css";

function expenseCivilDate(value: string) {
  const frenchDate = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return frenchDate ? `${frenchDate[3]}-${frenchDate[2].padStart(2, "0")}-${frenchDate[1].padStart(2, "0")}` : value;
}

export function HouseTimeExpenseSummaryCard({ total, empty, expanded, onToggle }: {
  total: number;
  empty: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t, formatMoney } = useI18n();
  return <button type="button" className={`stat-card house-expense-summary ${styles.summaryCard}`} aria-expanded={expanded} aria-controls="house-expense-details" onClick={onToggle}>
    <span>{t("crm.house.expenses.expenseAmount")}</span>
    <strong>{formatMoney(total)}</strong>
    <p>{empty ? t("crm.house.expenses.none") : t("crm.house.expenses.includedInDue")}</p>
    <p className={styles.toggleLabel}>{t(expanded ? "crm.house.expenses.hideDetails" : "crm.house.expenses.showDetails")}</p>
  </button>;
}

export function HouseTimeExpenseDetails({ entries, editingId, onEdit, onClose, onSave }: {
  entries: HouseTimeEntry[];
  editingId: string | null;
  onEdit: (id: string) => void;
  onClose: () => void;
  onSave?: (id: string, patch: HouseTimeExpenseEdit) => Promise<FormSaveResult>;
}) {
  const { t, formatDate, formatMoney } = useI18n();
  return <section id="house-expense-details" className={`card ${styles.details}`} aria-label={t("crm.house.expenses.details")}>
    <h4>{t("crm.house.expenses.details")}</h4>
    <p className="muted-line">{t("crm.house.expenses.includedInDue")}</p>
    {entries.length === 0 ? <p className="muted-line">{t("crm.house.expenses.none")}</p> : <div className="list-stack">
      {entries.map(entry => {
        const date = expenseCivilDate(entry.date);
        return <article key={entry.id} className={`house-expense-row ${styles.row}`}>
        <dl className={styles.fields}>
          <div><dt>{t("crm.house.expenses.csv.date")}</dt><dd><time dateTime={/^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined}>{formatDate(date, { day: "2-digit", month: "2-digit", year: "numeric" })}</time></dd></div>
          <div><dt>{t("crm.house.expenses.csv.worker")}</dt><dd>{entry.workerName}</dd></div>
          <div><dt>{t("crm.house.expenses.csv.house")}</dt><dd>{entry.houseName}</dd></div>
          <div className={styles.reason}><dt>{t("crm.house.expenses.reason")}</dt><dd>{entry.expenseNote || t("crm.house.expenses.reasonMissing")}</dd></div>
          <div><dt>{t("crm.house.expenses.amount")}</dt><dd><strong>{formatMoney(getHouseTimeExpenseAmount(entry))}</strong></dd></div>
        </dl>
        {onSave && <BusinessButton permission="write" className="secondary-button" type="button" onClick={() => onEdit(entry.id)}>{t("crm.house.expenses.edit")}</BusinessButton>}
        {editingId === entry.id && onSave && <div className={styles.editor}><HouseTimeExpenseEditor key={entry.id} entry={entry} onSave={onSave} onCancel={onClose} onConfirmed={onClose} /></div>}
      </article>;
      })}
    </div>}
  </section>;
}
