// Business payloads stay in this page's memory. An origin's browser storage is not
// an authorization boundary, even when its keys contain a Supabase user UUID.
let owner: string | null = null;
const values = new Map<string, string>();
const legacyKeys = new Set([
  "oneaddress-riviera-crm-v1",
  "oneaddress-riviera-crm-quotes-v1",
  "oneaddress-riviera-crm-active-actor-v1"
]);
export const CRM_CACHE_CHANGED = "oar-cache-lifecycle";
export const CRM_CACHE_RESET_KEY = "oar-access-reset-v1";
export const CRM_CACHE_CHANNEL = "oar-access-lifecycle";
export function isPersistentCRMCacheKey(key: string) {
  const scopedName = /^oar:[^:]+:(.+)$/.exec(key)?.[1];
  return legacyKeys.has(key) || Boolean(scopedName && legacyKeys.has(scopedName));
}
export type PersistentCRMCacheState = { available: boolean; count: number };
export type CRMCacheRecovery = { format: "oar-browser-recovery-v1"; createdAt: string; entries: Record<string, string> };
function persistentEntries() {
  if (typeof window === "undefined") throw new Error("Browser storage unavailable");
  const entries: Record<string, string> = {};
  for (const key of Object.keys(window.localStorage).filter(isPersistentCRMCacheKey).sort()) {
    const value = window.localStorage.getItem(key);
    if (value !== null) entries[key] = value;
  }
  return entries;
}
export function inspectPersistentCRMCache(): PersistentCRMCacheState {
  try { return { available: true, count: Object.keys(persistentEntries()).length }; }
  catch { return { available: false, count: 0 }; }
}
export function createCRMCacheRecovery(): CRMCacheRecovery {
  const entries = persistentEntries();
  if (!Object.keys(entries).length) throw new Error("No historical CRM cache to recover");
  return { format: "oar-browser-recovery-v1", createdAt: new Date().toISOString(), entries };
}
export function purgeRecoveredCRMCache(recovery: CRMCacheRecovery) {
  if (recovery.format !== "oar-browser-recovery-v1" || !Object.keys(recovery.entries).length) throw new Error("Recovery required before purge");
  // No automatic migration: the owner must have saved and checked this exact copy.
  // Old CRM tabs must be closed; they do not participate in any modern locking protocol.
  const current = persistentEntries();
  if (JSON.stringify(current) !== JSON.stringify(recovery.entries)) throw new Error("Cache changed; recover a fresh copy before purging");
  for (const [key, value] of Object.entries(recovery.entries)) {
    if (!isPersistentCRMCacheKey(key) || window.localStorage.getItem(key) !== value) throw new Error("Cache changed during purge");
    window.localStorage.removeItem(key);
  }
  if (Object.keys(persistentEntries()).length) throw new Error("Another tab wrote a cache; recovery is required again");
  clearCRMCache();
}
export function bindCRMCache(userId: string) {
  const historical = inspectPersistentCRMCache();
  if (!historical.available || historical.count) throw new Error("Historical cache recovery is required");
  if (owner && owner !== userId) throw new Error("Account change requires a new page");
  owner = userId;
}
export function clearCRMCache() {
  owner = null;
  values.clear();
  // Existing real caches are deliberately not deleted here. The transition gate
  // requires explicit recovery outside the origin before its dedicated purge.
}
export function broadcastCRMCacheReset() {
  const nonce = `${Date.now()}-${Math.random()}`;
  try { window.localStorage.setItem(CRM_CACHE_RESET_KEY, nonce); } catch { /* Metadata only. */ }
  try { const channel = new BroadcastChannel(CRM_CACHE_CHANNEL); channel.postMessage({ type: "reset" }); channel.close(); } catch { /* Storage/Auth events are also observed. */ }
}
export const crmCache = {
  getItem(key: string) { return owner ? values.get(key) ?? null : null; },
  setItem(key: string, value: string) { if (owner) values.set(key, value); }
};
