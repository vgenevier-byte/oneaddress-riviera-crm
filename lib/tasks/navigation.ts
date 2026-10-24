"use client";

import { useEffect, useState } from "react";
import type { TaskTargetRef } from "./types";

export const TASK_TARGET_NAVIGATED = "oar-task-target-navigated";
const targetModules: Record<string, string> = {
  contact: "contacts", bank_account: "contacts", lead: "leads", quote: "quotes", booking: "bookings",
  vendor_quote: "vendorQuotes", vendor_invoice: "vendorInvoices", worker: "houseTracking",
  worker_period: "houseTracking", time_entry: "houseTracking", staff_payment: "houseTracking", house: "houseTracking",
  property: "properties", vehicle: "vehicles", boat: "boats", planning_entry: "planning", fonciere_project: "fonciere",
  presentation: "izord", document: "documents", folder: "documents", monthly_charges: "monthlyCharges", publisher_creation: "publisher"
};

/** URLs carry identity and business context only. The destination always reloads
 * its own authorized catalog; a URL never supplies a title, rights or data. */
export function taskTargetModule(reference: TaskTargetRef): string {
  if (reference.type === "document" && reference.context?.catalog === "fonciere") return "fonciere";
  if (reference.type === "document" && reference.context?.catalog === "presentation") return "izord";
  return targetModules[reference.type] || "";
}
export function taskTargetHref(reference: TaskTargetRef): string {
  const targetModule = taskTargetModule(reference);
  const paths: Record<string, string> = { fonciere: "/fonciere", izord: "/izord", publisher: "/publisher", monthlyCharges: "/charges" };
  const query = new URLSearchParams();
  if (!paths[targetModule]) query.set("module", targetModule);
  query.set("crmTarget", JSON.stringify(reference));
  return `${paths[targetModule] || "/"}?${query.toString()}`;
}
export function readTaskTarget(url?: string): TaskTargetRef | null {
  try {
    const raw = new URL(url || window.location.href, "http://crm.invalid").searchParams.get("crmTarget");
    if (!raw || raw.length > 4000) return null;
    const ref = JSON.parse(raw);
    if (!ref || typeof ref !== "object" || !targetModules[ref.type] || typeof ref.id !== "string" || !ref.id || ref.id.length > 300) return null;
    if (ref.context !== undefined && (!ref.context || typeof ref.context !== "object" || Array.isArray(ref.context))) return null;
    return { type: ref.type, id: ref.id, ...(ref.context ? { context: ref.context } : {}) } as TaskTargetRef;
  } catch { return null; }
}

/** Re-read on browser Back/Forward and in-app navigation. Consumers resolve the
 * identifier in their fresh module projection before opening any record. */
export function useTaskTargetFocus(...types: string[]): TaskTargetRef | null {
  const [target, setTarget] = useState<TaskTargetRef | null>(null);
  useEffect(() => {
    const update = () => setTarget(readTaskTarget());
    const initial = window.setTimeout(update, 0);
    window.addEventListener("popstate", update);
    window.addEventListener(TASK_TARGET_NAVIGATED, update);
    return () => { window.clearTimeout(initial); window.removeEventListener("popstate", update); window.removeEventListener(TASK_TARGET_NAVIGATED, update); };
  }, []);
  return target && (!types.length || types.includes(target.type)) ? target : null;
}

export function scrollTaskTarget(id: string) {
  const node = document.getElementById(id);
  if (!node) return;
  node.scrollIntoView({ block: "center" });
  node.setAttribute("tabindex", "-1"); node.focus({ preventScroll: true });
}
