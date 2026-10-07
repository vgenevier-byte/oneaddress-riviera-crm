import { matchesContactSearchFields } from "../contactSearch";

/** Contact references come from the caller's authorized Contacts projection. */
export type TaskContactOption = {
  id: string;
  firstName?: string;
  name?: string;
  company?: string;
  email?: string;
};

export function taskContactLabel(contact: TaskContactOption): string {
  return [contact.firstName, contact.name].filter(value => value?.trim()).join(" ") || (contact.company?.trim() ? contact.company : "Contact sans nom");
}

export function matchesTaskContact(contact: TaskContactOption, query: string): boolean {
  return matchesContactSearchFields(query, [contact.firstName, contact.name, contact.company]);
}

/** Never complete a restricted reference by reading a global CRM payload. */
export function taskContactOptions(rows: unknown): TaskContactOption[] {
  if (!Array.isArray(rows)) return [];
  const seenIds = new Set<string>();
  return rows.flatMap((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id || seenIds.has(row.id)) return [];
    seenIds.add(row.id);
    const option: TaskContactOption = { id: row.id };
    for (const [field, source] of [["firstName", "firstName"], ["name", "name"], ["company", "companyName"], ["email", "email"]] as const) {
      if (typeof row[source] === "string" && row[source]) option[field] = row[source];
    }
    return [option];
  });
}
