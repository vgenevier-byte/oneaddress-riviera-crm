import { isLanguage, type Language } from "./types";
export const PREFERENCE_PREFIX = "oar.ui-language.v1:";
const ANONYMOUS_KEY = `${PREFERENCE_PREFIX}anonymous`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const accountPreferenceKey = (id: string) => UUID.test(id) ? `${PREFERENCE_PREFIX}account:${id.toLowerCase()}` : null;
export type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
export type LanguageSnapshot = { language: Language; accountId: string | null };
export const SERVER_SNAPSHOT: LanguageSnapshot = { language: "fr", accountId: null };
/** Only language codes are persisted; account UUIDs are keys, never business data. */
export class LanguagePreference {
  private snapshot: LanguageSnapshot = SERVER_SNAPSHOT;
  private listeners = new Set<() => void>();
  private memory = new Map<string, Language>();
  private pendingLoginChoice: Language | null = null;
  private ready = false;
  constructor(private storage: () => PreferenceStorage | undefined) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private read(key: string): Language | null {
    const session = this.memory.get(key);
    if (session) return session;
    try { const value = this.storage()?.getItem(key); return isLanguage(value) ? value : null; } catch { return null; }
  }
  private write(key: string, language: Language) {
    this.memory.set(key, language);
    try { this.storage()?.setItem(key, language); } catch { /* Session choice remains usable. */ }
  }
  private update(language: Language, accountId: string | null) {
    if (this.snapshot.language === language && this.snapshot.accountId === accountId) return;
    this.snapshot = { language, accountId };
    this.listeners.forEach(listener => listener());
  }
  hydrate = () => {
    if (this.ready) return;
    this.ready = true;
    const account = this.snapshot.accountId && accountPreferenceKey(this.snapshot.accountId);
    this.update(this.read(account || ANONYMOUS_KEY) ?? "fr", this.snapshot.accountId);
  };
  bindAccount = (candidate: string | null) => {
    const id = candidate && accountPreferenceKey(candidate) ? candidate.toLowerCase() : null;
    if (id === this.snapshot.accountId) return;
    const key = id && accountPreferenceKey(id);
    const explicit = this.snapshot.accountId === null ? this.pendingLoginChoice : null;
    this.pendingLoginChoice = null;
    if (!key) { this.update(this.read(ANONYMOUS_KEY) ?? "fr", null); return; }
    const saved = this.read(key);
    const language = saved ?? explicit ?? "fr";
    if (!saved && explicit) this.write(key, language);
    this.update(language, id);
  };
  choose = (candidate: Language) => {
    if (!isLanguage(candidate)) return;
    const key = this.snapshot.accountId && accountPreferenceKey(this.snapshot.accountId);
    if (!key) this.pendingLoginChoice = candidate;
    this.write(key || ANONYMOUS_KEY, candidate);
    this.update(candidate, this.snapshot.accountId);
  };
}
