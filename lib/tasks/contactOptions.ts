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

function normalizedContactSearch(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}+/gu, "").toLocaleLowerCase("fr").trim().replace(/\s+/gu, " ");
}

export function matchesTaskContact(contact: TaskContactOption, query: string): boolean {
  const names = [contact.firstName, contact.name].filter(value => value?.trim()).join(" ");
  const searchable = normalizedContactSearch(names || contact.company || "");
  return normalizedContactSearch(query).split(" ").filter(Boolean).every(token => searchable.includes(token));
}

/** Never complete a restricted reference by reading a global CRM payload. */
export function taskContactOptions(rows: unknown): TaskContactOption[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id) return [];
    const option: TaskContactOption = { id: row.id };
    for (const [field, source] of [["firstName", "firstName"], ["name", "name"], ["company", "companyName"], ["email", "email"]] as const) {
      if (typeof row[source] === "string" && row[source]) option[field] = row[source];
    }
    return [option];
  });
}
