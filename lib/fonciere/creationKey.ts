/** A creation identity belongs to one durable draft, never to its editable title. */
const DRAFT_PREFIX = "oar:fonciere:draft:v2:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type FonciereDraftIdentity = { scope: string; draftId: string; creationKey: string; attempted: boolean; confirmedProjectId?: string };
const ownedLocks = new Map<string, { signal?: AbortSignal; finished: Promise<unknown> }>();
export type FonciereDraftLease = { identity: FonciereDraftIdentity; release: () => void };
export class FonciereDraftInUseError extends Error {
  constructor(readonly draftId: string) { super("Ce brouillon est déjà ouvert dans un autre onglet. Sa tentative d’enregistrement doit être vérifiée avant de le reprendre."); this.name = "FonciereDraftInUseError"; }
}
function validScope(scope: string) { if (!scope || scope.length > 500) throw new Error("Identité de brouillon invalide."); }
function draftName(scope: string, draftId: string) { validScope(scope); if (!UUID.test(draftId)) throw new Error("Identité de brouillon invalide."); return `${DRAFT_PREFIX}${scope}:${draftId}`; }
function persist(identity: FonciereDraftIdentity, storage: DraftStorage) {
  const key = draftName(identity.scope, identity.draftId), value = JSON.stringify(identity);
  storage.setItem(key, value);
  if (storage.getItem(key) !== value) throw new Error("La conservation de l’identité du brouillon est indisponible. Votre saisie est conservée.");
}
export function readFonciereDraftIdentity(scope: string, draftId: string, storage: DraftStorage = window.localStorage): FonciereDraftIdentity {
  const name = draftName(scope, draftId), raw = storage.getItem(name);
  if (raw) {
    const value = JSON.parse(raw) as FonciereDraftIdentity;
    if (value.scope !== scope || value.draftId !== draftId || !UUID.test(value.creationKey) || typeof value.attempted !== "boolean") throw new Error("Identité de brouillon conservée invalide. Aucune nouvelle fiche n’a été créée.");
    return value;
  }
  const identity = { scope, draftId, creationKey: crypto.randomUUID(), attempted: false };
  persist(identity, storage); return identity;
}
export function markFonciereDraftAttempted(identity: FonciereDraftIdentity, storage: DraftStorage = window.localStorage): void {
  // Mutate the captured identity only after the durable write succeeds.
  const next = { ...identity, attempted: true }; persist(next, storage); Object.assign(identity, next);
}
export function confirmFonciereDraft(identity: FonciereDraftIdentity, projectId: string, storage: DraftStorage = window.localStorage): void {
  if (!UUID.test(projectId)) throw new Error("Identité du projet non confirmée.");
  const next = { ...identity, attempted: true, confirmedProjectId: projectId }; persist(next, storage); Object.assign(identity, next);
}

/** A copied tab may clone sessionStorage and its URL. Web Locks arbitrate the
 * actual live documents. An uncertain draft is blocked, never silently forked. */
export async function claimFonciereDraft(scope: string, candidateDraftId?: string, signal?: AbortSignal): Promise<FonciereDraftLease> {
  validScope(scope); signal?.throwIfAborted();
  if (!navigator.locks) throw new Error("La protection des brouillons entre onglets est indisponible dans ce navigateur. Votre saisie est conservée.");
  let draftId = candidateDraftId && UUID.test(candidateDraftId) ? candidateDraftId : crypto.randomUUID();
  for (let attempt = 0; attempt < 4; attempt++) {
    const lockName = `oar:fonciere:edit:${scope}:${draftId}`;
    const previous = ownedLocks.get(lockName);
    // StrictMode may restart recovery while its cancelled acquisition is still
    // releasing. Finish that document’s own cancelled request before arbitration.
    if (previous?.signal?.aborted) { await previous.finished.catch(() => {}); signal?.throwIfAborted(); }
    let release = () => {};
    let admit!: (acquired: boolean) => void;
    const acquired = new Promise<boolean>(resolve => { admit = resolve; });
    const request = navigator.locks.request(lockName, { ifAvailable: true }, lock => {
      if (!lock) { admit(false); return; }
      return new Promise<void>(resolve => { release = resolve; admit(true); });
    });
    const owned = { signal, finished: request }; ownedLocks.set(lockName, owned);
    void request.then(() => { if (ownedLocks.get(lockName) === owned) ownedLocks.delete(lockName); }, () => { if (ownedLocks.get(lockName) === owned) ownedLocks.delete(lockName); admit(false); });
    const held = await acquired;
    if (signal?.aborted) { release(); signal.throwIfAborted(); }
    if (held) {
      let active = true;
      const done = () => { if (!active) return; active = false; release(); signal?.removeEventListener("abort", done); };
      signal?.addEventListener("abort", done, { once: true });
      try { return { identity: readFonciereDraftIdentity(scope, draftId), release: done }; }
      catch (failure) { done(); throw failure; }
    }
    // Re-read attempted only while acquiring a lease; save never rereads a shared slot.
    const record = window.localStorage.getItem(draftName(scope, draftId));
    if (record && (JSON.parse(record) as FonciereDraftIdentity).attempted) throw new FonciereDraftInUseError(draftId);
    draftId = crypto.randomUUID();
  }
  throw new Error("Le brouillon n’a pas pu être isolé. Votre saisie est conservée.");
}
