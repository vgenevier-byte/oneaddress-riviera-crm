import { commonMessages } from "./catalogs/common";
import { accessMessages } from "./catalogs/access";
import { crmMessages } from "./catalogs/crm";
import { modulesMessages } from "./catalogs/modules";
import { specialistMessages } from "./catalogs/specialist";
import { localeFor, type Catalogue, type Language, type Variables } from "./types";
export const messages: Catalogue = { ...commonMessages, ...accessMessages, ...crmMessages, ...modulesMessages, ...specialistMessages };
const reported = new Set<string>();
export const missingTranslations = () => [...reported];
export function translate(key: string, language: Language, variables: Variables = {}) {
  const entry = messages[key];
  if (!entry || !entry[language]) {
    reported.add(`${language}:${key}`);
    if (process.env.NODE_ENV !== "production") console.warn(`[i18n] Missing ${language}:${key}`);
  }
  const source = entry?.[language] || entry?.fr;
  if (!source) return key;
  const text = typeof source === "string" ? source : source[new Intl.PluralRules(localeFor(language)).select(Number(variables.count)) === "one" ? "one" : "other"];
  return text.replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, name: string) => {
    if (!(name in variables)) { reported.add(`parameter:${key}:${name}`); return placeholder; }
    return String(variables[name]);
  });
}
// Build display indexes once; table rendering must not scan every catalogue entry.
const labelIndex = new Map<string, Map<string, string>>();
for (const [key, entry] of Object.entries(messages)) {
  if (typeof entry.fr !== "string") continue;
  const scopes = ["", ...key.split(".").slice(0,-1).map((_,index)=>key.split(".").slice(0,index+1).join("."))];
  for (const scope of scopes) { const index = labelIndex.get(scope) ?? new Map<string,string>(); if (!index.has(entry.fr)) index.set(entry.fr,key); labelIndex.set(scope,index); }
}
/** Use only for application-defined labels; never apply to arbitrary record text. */
export function translateLabel(canonical: string, language: Language, namespace?: string) {
  const key = labelIndex.get(namespace ?? "")?.get(canonical);
  return key ? translate(key,language) : canonical;
}
