import type { HouseTimeEntry } from "./types";

export type HouseBillingMode = "hourly" | "prepaid";
export type HousePrepaidSetting = {
  workerId: string; billingMode: HouseBillingMode; defaultMinutes: number; defaultPriceCents: number;
};
export type HousePrepaidPackage = {
  id: string; workerId: string; paymentId: string; capacityMinutes: number; priceCents: number;
  paidDate: string; invoiceId?: string | null; createdAt: string;
};
export type HousePrepaidPart = { packageId: string; minutes: number; amountCents: number };
export type HousePrepaidValue = {
  minutes: number; coveredMinutes: number; uncoveredMinutes: number;
  coveredCents: number; uncoveredCents: number; amountCents: number;
};
export type HousePrepaidAllocation = HousePrepaidValue & {
  entryId: string; workerId: string; allocations: HousePrepaidPart[];
};
export type HousePrepaidSummary = {
  workerId: string; purchasedMinutes: number; performedMinutes: number; coveredMinutes: number;
  availableMinutes: number; uncoveredMinutes: number; paidCents: number;
};
export type HousePrepaidState = {
  revision: string; workspaceRevision: string | null; complete?: boolean; settings: HousePrepaidSetting[];
  packages: HousePrepaidPackage[]; allocations: HousePrepaidAllocation[];
  summaries: HousePrepaidSummary[]; canContribute: boolean;
};
export type HousePrepaidSavePatch = Partial<HousePrepaidSetting> & {
  workerId?: string; capacityMinutes?: number; priceCents?: number; paymentId?: string; invoiceId?: string;
  packageId?: string;
  payment?: { id: string; houseId: string; date: string; method: string; note?: string };
};

function integer(value: number, name: string, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) throw new Error(`Invalid ${name}`);
  return value;
}

/** Whole minutes only. Legacy non-quarter times remain valid; overnight shifts keep their civil date. */
export function getHouseTimeMinutes(entry: Pick<HouseTimeEntry, "startTime" | "endTime" | "breakMinutes">): number {
  const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!clock.test(entry.startTime) || !clock.test(entry.endTime)) throw new Error("Invalid lesson times");
  const read = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const start = read(entry.startTime);
  let end = read(entry.endTime);
  if (end < start) end += 1440;
  const pause = integer(entry.breakMinutes, "break minutes");
  if (pause > end - start) throw new Error("Break exceeds lesson duration");
  return end - start - pause;
}

/** Round once at each cumulative boundary, using integer arithmetic rather than a rounded unit price. */
export function cumulativeHousePrepaidCents(minutes: number, capacityMinutes: number, priceCents: number): number {
  integer(minutes, "minutes"); integer(capacityMinutes, "capacity", true); integer(priceCents, "price", true);
  const denominator = BigInt(capacityMinutes);
  const cents = (BigInt(2) * BigInt(minutes) * BigInt(priceCents) + denominator) / (BigInt(2) * denominator);
  const result = Number(cents);
  return integer(result, "amount");
}

/** Reference allocator. The live UI reads the equivalent complete, permission-checked server ledger. */
export function buildHousePrepaidLedger(
  settings: HousePrepaidSetting[], packages: HousePrepaidPackage[], entries: HouseTimeEntry[]
): Pick<HousePrepaidState, "allocations" | "summaries"> {
  const allocations: HousePrepaidAllocation[] = [], summaries: HousePrepaidSummary[] = [];
  const packageIds = new Set<string>(), paymentIds = new Set<string>(), entryIds = new Set<string>();
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  for (const plan of packages) {
    integer(plan.capacityMinutes, "capacity", true); integer(plan.priceCents, "price", true);
    if (packageIds.has(plan.id) || paymentIds.has(plan.paymentId)) throw new Error("Duplicate package or reserved payment");
    packageIds.add(plan.id); paymentIds.add(plan.paymentId);
  }
  for (const entry of entries) {
    if (entryIds.has(entry.id)) throw new Error("Duplicate intervention");
    entryIds.add(entry.id);
  }
  for (const setting of settings.filter(item => item.billingMode === "prepaid")) {
    integer(setting.defaultMinutes, "default capacity", true); integer(setting.defaultPriceCents, "default price", true);
    const plans = packages.filter(item => item.workerId === setting.workerId).sort((a,b) =>
      compare(a.paidDate,b.paidDate) || compare(a.createdAt,b.createdAt) || compare(a.id,b.id));
    const lessons = entries.filter(item => item.workerId === setting.workerId).sort((a,b) =>
      compare(a.date,b.date) || compare(a.startTime,b.startTime) || compare(a.createdAt,b.createdAt) || compare(a.id,b.id));
    let planIndex = 0, used = 0, uncovered = 0, performed = 0;
    for (const entry of lessons) {
      const minutes = getHouseTimeMinutes(entry), parts: HousePrepaidPart[] = [];
      let remaining = minutes, coveredCents = 0, coveredMinutes = 0;
      performed += minutes;
      while (remaining && planIndex < plans.length) {
        const plan = plans[planIndex], take = Math.min(remaining, plan.capacityMinutes - used);
        const amountCents = cumulativeHousePrepaidCents(used + take, plan.capacityMinutes, plan.priceCents)
          - cumulativeHousePrepaidCents(used, plan.capacityMinutes, plan.priceCents);
        parts.push({ packageId: plan.id, minutes: take, amountCents });
        coveredCents += amountCents; coveredMinutes += take; remaining -= take; used += take;
        if (used === plan.capacityMinutes) { planIndex++; used = 0; }
      }
      const uncoveredCents = cumulativeHousePrepaidCents(uncovered + remaining, setting.defaultMinutes, setting.defaultPriceCents)
        - cumulativeHousePrepaidCents(uncovered, setting.defaultMinutes, setting.defaultPriceCents);
      uncovered += remaining;
      allocations.push({ entryId: entry.id, workerId: setting.workerId, minutes, coveredMinutes,
        uncoveredMinutes: remaining, coveredCents, uncoveredCents, amountCents: coveredCents + uncoveredCents, allocations: parts });
    }
    const purchasedMinutes = plans.reduce((sum,item) => sum + item.capacityMinutes, 0);
    summaries.push({ workerId: setting.workerId, purchasedMinutes, performedMinutes: performed,
      coveredMinutes: performed - uncovered, availableMinutes: Math.max(purchasedMinutes-performed,0),
      uncoveredMinutes: uncovered, paidCents: plans.reduce((sum,item) => sum + item.priceCents,0) });
  }
  return { allocations, summaries };
}
