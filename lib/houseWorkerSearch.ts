import { createContactFieldResolver } from "./contactSearch";
import type { Contact, HouseTrackingWorker } from "./types";

type SearchableHouseWorker = Pick<HouseTrackingWorker, "contactId" | "contactName" | "role">;

/** Compare historical worker labels with only the caller's current authorized contact projection. */
export function createHouseWorkerFieldResolver(authorizedContacts: readonly Partial<Contact>[] = []) {
  const contactsById = new Map(authorizedContacts.filter(contact => contact.id).map(contact => [contact.id!, contact]));
  const contactFields = createContactFieldResolver(authorizedContacts);
  return (worker: SearchableHouseWorker): (string | undefined)[] => {
    const contact = contactsById.get(worker.contactId);
    return [worker.contactName, worker.role, ...(contact ? contactFields(contact) : [])];
  };
}
