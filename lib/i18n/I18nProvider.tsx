"use client";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { LanguagePreference, SERVER_SNAPSHOT } from "./preference";
import { translate, translateLabel } from "./engine";
import { formatScreenDate, formatScreenMoney } from "./format";
import { localeFor, type Language, type Variables } from "./types";
const Context = createContext<LanguagePreference | null>(null);
export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference] = useState(() => new LanguagePreference(() => typeof window === "undefined" ? undefined : window.localStorage));
  useEffect(() => { preference.hydrate(); }, [preference]);
  return <Context.Provider value={preference}><DocumentLanguage />{children}</Context.Provider>;
}
function usePreference() {
  const preference = useContext(Context);
  if (!preference) throw new Error("I18nProvider is required");
  return preference;
}
export function useAccountLanguage(accountId: string | null) {
  const preference = usePreference();
  useLayoutEffect(() => { preference.bindAccount(accountId); }, [preference, accountId]);
}
export function useI18n() {
  const preference = usePreference();
  const { language } = useSyncExternalStore(preference.subscribe, preference.getSnapshot, () => SERVER_SNAPSHOT);
  const t = useCallback((key: string, variables?: Variables) => translate(key, language, variables), [language]);
  const label = useCallback((canonical: string, namespace?: string) => translateLabel(canonical, language, namespace), [language]);
  const formatDate = useCallback((value: string | Date | number, options?: Intl.DateTimeFormatOptions) => formatScreenDate(value, language, options), [language]);
  const formatMoney = useCallback((value: number) => formatScreenMoney(value, language), [language]);
  return useMemo(() => ({ language, locale: localeFor(language), t, label, formatDate, formatMoney, setLanguage: preference.choose }), [language, t, label, formatDate, formatMoney, preference]);
}
function DocumentLanguage() {
  const { language } = useI18n();
  useLayoutEffect(() => { document.documentElement.lang = language === "en" ? "en-GB" : "fr"; }, [language]);
  return null;
}
export function UI({ id, values }: { id: string; values?: Variables }) { const { t } = useI18n(); return <>{t(id, values)}</>; }
export type { Language, Variables };
