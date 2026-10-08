import { moduleItems, readable, type AccessSnapshot, type ModuleId } from "@/lib/access/modules";

// Presentation only: these category IDs are never permission keys or destinations.
export const navigationGroups = [
  { id: "commercial", label: "Commercial", modules: ["leads", "quotes"] },
  { id: "operations", label: "Opérations", modules: ["bookings", "planning"] },
  { id: "assets", label: "Biens & flotte", modules: ["properties", "vehicles", "boats"] },
  { id: "services", label: "Maison & services", modules: ["houseTracking", "vendorQuotes", "vendorInvoices", "monthlyCharges"] },
  { id: "resources", label: "Marketing & ressources", modules: ["publisher", "documents"] }
] as const satisfies readonly { id: string; label: string; modules: readonly ModuleId[] }[];

export type NavigationGroupId = typeof navigationGroups[number]["id"];
export type NavigationModule = typeof moduleItems[number];
export type NavigationEntry =
  | { kind: "module"; item: NavigationModule }
  | { kind: "group"; id: NavigationGroupId; label: string; items: NavigationModule[] };

export function groupForModule(module: ModuleId | "admin"): NavigationGroupId | null {
  return navigationGroups.find(group => (group.modules as readonly string[]).includes(module))?.id ?? null;
}

export function allowedNavigation(access: AccessSnapshot): NavigationEntry[] {
  const entries: NavigationEntry[] = [];
  const itemFor = (module: ModuleId) => moduleItems.find(item => item.tab === module)!;
  for (const moduleId of ["dashboard", "contacts", "tasks"] as const) {
    if (readable(access, moduleId)) entries.push({ kind: "module", item: itemFor(moduleId) });
  }
  for (const group of navigationGroups) {
    const items = group.modules.filter(module => readable(access, module)).map(itemFor);
    if (items.length) entries.push({ kind: "group", id: group.id, label: group.label, items });
  }
  if (readable(access, "izord")) entries.push({ kind: "module", item: itemFor("izord") });
  return entries;
}

export const administrationItem = { tab: "admin", label: "Administration", icon: "⚙" } as const;

export function mobileShortcutItems(access: AccessSnapshot) {
  // Keep each profile's existing shortcuts and order, independent of the new tree.
  return [...moduleItems.filter(item => readable(access, item.tab)), ...(access.generalAdmin ? [administrationItem] : [])].slice(0, 4);
}
