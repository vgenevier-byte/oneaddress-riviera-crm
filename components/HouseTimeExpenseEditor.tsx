"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { moduleMessage } from "@/lib/i18n/moduleMessage";
import { useConfirmedForm, type FormSaveResult } from "@/lib/access/useConfirmedForm";
import { getHouseTimeExpenseAmount, parseHouseExpenseAmount, type HouseTimeExpenseEdit } from "@/lib/houseTracking";
import type { HouseTimeEntry } from "@/lib/types";
import { BusinessButton, BusinessForm, useBusinessPermissions } from "./BusinessPermissions";

export default function HouseTimeExpenseEditor({ entry, onSave, onCancel, onConfirmed }: {
  entry: HouseTimeEntry;
  onSave: (id: string, patch: HouseTimeExpenseEdit) => Promise<FormSaveResult>;
  onCancel: () => void;
  onConfirmed: () => void;
}) {
  const { t } = useI18n();
  const business = useBusinessPermissions();
  const confirmation = useConfirmedForm(business?.markDirty);
  const [amount, setAmount] = useState(() => getHouseTimeExpenseAmount(entry) ? String(getHouseTimeExpenseAmount(entry)) : "");
  const [note, setNote] = useState(entry.expenseNote ?? "");
  const [invalid, setInvalid] = useState(false);
  const headingId = `house-expenses-heading-${entry.id}`;

  return <section className="card" aria-labelledby={headingId}>
    <h4 id={headingId}>{t("crm.house.expenses.editFor", { name: entry.workerName, date: entry.date })}</h4>
    <BusinessForm className="form-grid house-compact-form" pending={confirmation.saving} onChange={confirmation.changed} onSubmit={event => {
      event.preventDefault();
      if (business?.write === false || confirmation.saving) return;
      const expenseAmount = parseHouseExpenseAmount(amount);
      if (expenseAmount === null) { setInvalid(true); return; }
      setInvalid(false);
      void confirmation.submit(event.currentTarget, () => onSave(entry.id, { expenseAmount, expenseNote: note.trim() }), newerDraft => {
        if (!newerDraft) onConfirmed();
      });
    }}>
      <label>{t("crm.house.expenses.amount")}
        <input name="expenseAmount" type="text" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} aria-invalid={invalid} autoFocus />
      </label>
      <label>{t("crm.house.expenses.reason")}
        <input name="expenseNote" value={note} maxLength={4000} onChange={event => setNote(event.target.value)} />
      </label>
      <p className="muted-line full">{t("crm.house.expenses.editHint")}</p>
      {invalid && <p className="full" role="alert">{t("crm.house.expenses.invalid")}</p>}
      {confirmation.message && <p className="full" role="alert">{moduleMessage(confirmation.message, t)}</p>}
      <div className="form-actions full">
        <BusinessButton permission="write" type="submit" className="primary-button" disabled={confirmation.saving}>
          {confirmation.saving ? t("charges.enregistrement_e7d5f2") : t("modules.tasksWorkspace.save")}
        </BusinessButton>
        <button type="button" className="secondary-button" disabled={confirmation.saving} onClick={onCancel}>{t("modules.tasksWorkspace.cancel")}</button>
      </div>
    </BusinessForm>
  </section>;
}
