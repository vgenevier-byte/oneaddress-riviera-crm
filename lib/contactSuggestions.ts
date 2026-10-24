import { createContactFieldResolver } from "./contactSearch";
import { createSearchIndex, searchIndex, type SearchHit, type SearchIndex } from "./search";
import type { Contact } from "./types";

type SearchContact = Partial<Contact> & { id: string };
export type ContactSearchIndex<T extends SearchContact> = SearchIndex<T>;

/** Candidates and optional company joins must both come from the current authorized projection. */
export function createContactSearchIndex<T extends SearchContact>(
  contacts: readonly T[], authorizedContacts: readonly Partial<Contact>[] = contacts
): ContactSearchIndex<T> {
  const fields = createContactFieldResolver(authorizedContacts);
  return createSearchIndex<T>(contacts, fields, { getId: contact => contact.id,
    getLabel: contact => [contact.firstName, contact.name, contact.companyName].filter(Boolean).join(" ") });
}

/** Complete ranked results; callers cap display only after ranking. */
export function searchContacts<T extends SearchContact>(index: ContactSearchIndex<T>, query: string, options: { limit?: number } = {}): SearchHit<T>[] {
  return searchIndex(index, query, options);
}

/** Direct comparisons for category summaries, with no display cap. */
export function searchDirectContacts<T extends SearchContact>(index: ContactSearchIndex<T>, query: string): T[] {
  return searchIndex(index, query, { includeFuzzy: false }).map(hit => hit.item);
}

/** Compatibility API for Contacts' separate direct and close result groups. */
export function searchContactSuggestions<T extends SearchContact>(index: ContactSearchIndex<T>, query: string): { direct: T[]; close: T[] } {
  const results = searchContacts(index, query);
  return { direct: results.filter(hit => !hit.approximate).map(hit => hit.item),
    close: results.filter(hit => hit.approximate).slice(0, 5).map(hit => hit.item) };
}
