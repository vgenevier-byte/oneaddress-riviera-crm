export type Language = "fr" | "en";
export type PluralMessage = { one: string; other: string };
export type Message = { fr: string | PluralMessage; en: string | PluralMessage };
export type Catalogue = Record<string, Message>;
export type Variables = Record<string, string | number>;
export const isLanguage = (value: unknown): value is Language => value === "fr" || value === "en";
export const localeFor = (language: Language) => language === "en" ? "en-GB" : "fr-FR";
