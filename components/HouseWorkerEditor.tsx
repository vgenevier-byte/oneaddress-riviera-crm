"use client";
import { moduleMessage } from "@/lib/i18n/moduleMessage";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useState } from "react";
import { BusinessForm, BusinessButton, useBusinessPermissions } from "./BusinessPermissions";
import { useConfirmedForm, type FormSaveResult } from "@/lib/access/useConfirmedForm";
import { houseHourlyRateInput, parseHouseHourlyRate, type HouseWorkerEdit } from "@/lib/houseTracking";
import type { HouseTrackingWorker } from "@/lib/types";

export default function HouseWorkerEditor({ worker, onSave, onCancel, onConfirmed }: {
  worker: HouseTrackingWorker;
  onSave: (id: string, patch: HouseWorkerEdit) => Promise<FormSaveResult>;
  onCancel: () => void;
  onConfirmed: (rate: number) => void;
}) {
  const {t} = useI18n();

  const business = useBusinessPermissions();
  const confirmation = useConfirmedForm(business?.markDirty);
  const [rate, setRate] = useState(() => houseHourlyRateInput(worker));
  const [notes, setNotes] = useState(worker.notes ?? "");
  const [error, setError] = useState("");
  const canEditNotes = !business?.hiddenFields.includes("notes") && Object.hasOwn(worker, "notes");

  return <section className="card" aria-label={t("modules.house.editWorker", {name: worker.contactName})}>
    <h4>{t("modules.house.editWorker", {name: worker.contactName})}</h4>
    <p className="muted-line">{t("modules.houseWorkerEditor.theContactsIdentityIsStillManagedInContacts")}</p>
    <BusinessForm className="form-grid house-compact-form" pending={confirmation.saving}
      onChange={confirmation.changed} onSubmit={event => {
        event.preventDefault();
        if (business?.write === false || confirmation.saving) return;
        const hourlyRate = parseHouseHourlyRate(rate);
        if (hourlyRate === null) { setError("Saisissez un taux horaire valide, avec au maximum deux décimales (0 est accepté)."); return; }
        setError("");
        const patch: HouseWorkerEdit = { hourlyRate };
        if (canEditNotes && notes !== worker.notes) patch.notes = notes;
        void confirmation.submit(event.currentTarget, () => onSave(worker.id, patch), newerDraft => {
          if (!newerDraft) onConfirmed(hourlyRate);
        });
      }}>
      <label>{t("modules.houseWorkerEditor.defaultHourlyRate")}
        <input name="hourlyRate" type="text" inputMode="decimal" value={rate} onChange={event => setRate(event.target.value)} autoFocus />
      </label>
      {canEditNotes && <label>{t("modules.tasksWorkspace.notes")}
        <textarea name="notes" value={notes} maxLength={4000} onChange={event => setNotes(event.target.value)} />
      </label>}
      <p className="full">{t("modules.houseWorkerEditor.thisChangeDoesNotAffectHoursAlreadyRecorded")}</p>
      {(error || confirmation.message) && <p className="full" role="alert">{moduleMessage(error || confirmation.message, t)}</p>}
      <div className="form-actions full">
        <BusinessButton permission="write" type="submit" className="primary-button" disabled={confirmation.saving}>
          {confirmation.saving ? t("charges.enregistrement_e7d5f2") : t("modules.tasksWorkspace.save")}
        </BusinessButton>
        <button type="button" className="secondary-button" disabled={confirmation.saving} onClick={onCancel}>{t("modules.tasksWorkspace.cancel")}</button>
      </div>
    </BusinessForm>
  </section>;
}
