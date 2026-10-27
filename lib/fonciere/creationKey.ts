/** A creation identity belongs to a local draft, never to its editable title. */
const PREFIX = "oar:fonciere:creation:v1:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function getFonciereCreationKey(scope: string, storage: DraftStorage = window.localStorage): string {
  if (!scope || scope.length > 500) throw new Error("Identité de brouillon invalide.");
  const name = PREFIX + scope;
  const existing = storage.getItem(name);
  if (existing && UUID.test(existing)) return existing;
  const key = crypto.randomUUID();
  // Persist before making the first RPC. An unavailable store must never turn a
  // lost response or page reload into a second property record.
  storage.setItem(name, key);
  if (storage.getItem(name) !== key) throw new Error("La conservation de l’identité du brouillon est indisponible. Votre saisie est conservée.");
  return key;
}

export function clearFonciereCreationKey(scope: string, storage: DraftStorage = window.localStorage): void {
  storage.removeItem(PREFIX + scope);
}
