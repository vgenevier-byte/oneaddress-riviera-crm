import { crmNavigationItems } from "@/components/crmNavigation";
const housePosition = crmNavigationItems.findIndex(item => item.tab === "houseTracking") + 1;
export const moduleItems = [...crmNavigationItems.slice(0, housePosition), { tab: "monthlyCharges", label: "Charges mensuelles", icon: "▥" }, ...crmNavigationItems.slice(housePosition), { tab: "izord", label: "IZORD Invest", icon: "◇" }, { tab: "publisher", label: "Instagram Publisher", icon: "▧" }] as const;
export type ModuleId = typeof moduleItems[number]["tab"];
export type AccessLevel = "none" | "read" | "contribute";
export const sensitiveLabels = { delete: "Suppression", export: "Export et téléchargement", bank_read: "Consultation / copie des coordonnées bancaires", bank_write: "Modification / vérification des RIB", payment: "Préparation du paiement", generate: "Générer / régénérer", mark_published: "Marquer comme publié" };
export type Sensitive = keyof typeof sensitiveLabels;
/** Publisher has no deletion feature. Its sensitive actions do not apply to OAR/IZORD. */
export function moduleSensitivePermissions(module: ModuleId): Sensitive[] {
  if (module === "publisher") return ["generate", "export", "mark_published"];
  if (module === "monthlyCharges") return ["export"];
  return ["delete", "export", ...(module === "contacts" ? ["bank_read", "bank_write"] as const : []), ...(module === "vendorInvoices" ? ["payment"] as const : [])];
}
export function sensitiveNeedsContribution(permission: Sensitive) {
  return ["delete", "bank_write", "payment", "generate", "mark_published"].includes(permission);
}
export type ModuleGrant = { level: AccessLevel; sensitive: Partial<Record<Sensitive, boolean>> };
export type AccessSnapshot = { revision: number; active: boolean; generalAdmin: boolean; fullAccess: boolean; modules: Partial<Record<ModuleId, ModuleGrant>> };
export function emptyGrants(): Record<ModuleId, ModuleGrant> {
  return Object.fromEntries(moduleItems.map(m => [m.tab, { level: "none", sensitive: {} }])) as Record<ModuleId, ModuleGrant>;
}
export function readable(access: AccessSnapshot, module: ModuleId) { return ["read", "contribute"].includes(access.modules[module]?.level ?? "none"); }
