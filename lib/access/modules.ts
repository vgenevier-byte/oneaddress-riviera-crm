import { crmNavigationItems } from "@/components/crmNavigation";
export const moduleItems = [...crmNavigationItems, { tab: "izord", label: "IZORD Invest", icon: "◇" }] as const;
export type ModuleId = typeof moduleItems[number]["tab"];
export type AccessLevel = "none" | "read" | "contribute";
export const sensitiveLabels = { delete: "Suppression", export: "Export et téléchargement", bank_read: "Consultation / copie des coordonnées bancaires", bank_write: "Modification / vérification des RIB", payment: "Préparation du paiement" };
export type Sensitive = keyof typeof sensitiveLabels;
export type ModuleGrant = { level: AccessLevel; sensitive: Partial<Record<Sensitive, boolean>> };
export type AccessSnapshot = { revision: number; active: boolean; generalAdmin: boolean; fullAccess: boolean; modules: Partial<Record<ModuleId, ModuleGrant>> };
export function emptyGrants(): Record<ModuleId, ModuleGrant> {
  return Object.fromEntries(moduleItems.map(m => [m.tab, { level: "none", sensitive: {} }])) as Record<ModuleId, ModuleGrant>;
}
export function readable(access: AccessSnapshot, module: ModuleId) { return ["read", "contribute"].includes(access.modules[module]?.level ?? "none"); }
