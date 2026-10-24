"use client";

import { useId } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { taskContactLabel, taskContactSearchFields, type TaskContactOption } from "@/lib/tasks/contactOptions";
import { SearchableSelect } from "./search/SearchableSelect";

type Props = { options: TaskContactOption[]; contactId: string; onChange: (contactId: string) => void; disabled?: boolean };

/** A query never changes the existing link. Only a choice or explicit removal does. */
export default function TaskContactPicker({ options, contactId, onChange, disabled = false }: Props) {
  const { t } = useI18n();
  const inputId = useId();
  const contactLabel = (contact: TaskContactOption) => [contact.firstName, contact.name, contact.company].some(value => value?.trim()) ? taskContactLabel(contact) : t("modules.contacts.unnamed");
  return <div className="task-contact-picker" style={{ gridColumn: "1 / -1", minWidth: 0 }}>
    <label htmlFor={inputId}>{t("modules.taskContactPicker.linkedContactOptional")}</label>
    <SearchableSelect id={inputId} value={contactId} disabled={disabled} onChange={event => {
      const id = event.target.value;
      if (!id || options.some(contact => contact.id === id)) onChange(id);
    }}>
      <option value="">{t("modules.taskContactPicker.removeLinkedContact")}</option>
      {contactId && !options.some(contact => contact.id === contactId) && <option value={contactId} disabled>{t("modules.tasksWorkspace.linkRetainedDetailsUnavailable")}</option>}
      {options.map(contact => <option key={contact.id} value={contact.id} data-search={taskContactSearchFields(contact).filter(Boolean).join(" ")} data-secondary={[contact.company, contact.city, contact.organizationFunction || contact.supplierCategory, contact.email, contact.phone].filter(value => value && value !== contactLabel(contact)).join(" · ")}>{contactLabel(contact)}</option>)}
    </SearchableSelect>
  </div>;
}
