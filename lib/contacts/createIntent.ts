import type { Contact } from "@/lib/types";

/** In-memory navigation only: never serialize project files or infer an identity. */
export type ContactCreateIntent = {
  id: string;
  origin: "fonciere";
  role: "agency" | "agent" | "owner" | "representative";
  entityType: "company" | "person";
  prefill: Pick<Partial<Contact>, "name" | "firstName" | "civility" | "companyName" | "companyId" | "email" | "phone" | "postalAddress" | "postalAddressDetails" | "city">;
  identityHint?: string;
};

export type ContactCreateReturn = (intentId: string, contact?: Contact) => void;
