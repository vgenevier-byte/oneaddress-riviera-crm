import type { HousePayment, HouseTimeEntry, HouseTrackingWorker } from "./types";

/** Blank/invalid is distinct from an explicitly entered zero. */
export function parseHouseHourlyRate(value: string): number | null {
  const text = value.trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) return null;
  const amount = Number(text.replace(",", "."));
  return Number.isFinite(amount) && amount <= 100000000000 ? amount : null;
}

/** Expenses are optional; a blank input explicitly means no reimbursement. */
export function parseHouseExpenseAmount(value: string): number | null {
  return value.trim() === "" ? 0 : parseHouseHourlyRate(value);
}

export function houseHourlyRateInput(worker?: Pick<HouseTrackingWorker, "hourlyRate">) {
  return worker?.hourlyRate == null ? "" : String(worker.hourlyRate);
}

export type HouseWorkerEdit = { hourlyRate: number; notes?: string };
export type HouseTimeExpenseEdit = { expenseAmount: number; expenseNote?: string };

export const QUARTER_HOUR_TIME_OPTIONS = Array.from({ length: 24 * 4 }, (_, index) => {
  const hours = Math.floor(index / 4).toString().padStart(2, "0");
  const minutes = ((index % 4) * 15).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
});

export function isQuarterHourTime(value: string) {
  return /^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/.test(value);
}

export function isHouseTrackingWorkerActive(worker: Pick<HouseTrackingWorker, "status">) {
  return worker.status !== "Inactif";
}

export function getHouseTimeHours(entry: Pick<HouseTimeEntry, "startTime" | "endTime" | "breakMinutes">) {
  if (!entry.startTime || !entry.endTime) return 0;

  const [startHour, startMinute] = entry.startTime.split(":").map(Number);
  const [endHour, endMinute] = entry.endTime.split(":").map(Number);

  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return 0;

  const startTotal = startHour * 60 + startMinute;
  let endTotal = endHour * 60 + endMinute;

  if (endTotal < startTotal) {
    endTotal += 24 * 60;
  }

  const breakMinutes = Math.max(Number(entry.breakMinutes || 0), 0);
  return Math.max((endTotal - startTotal - breakMinutes) / 60, 0);
}

export function getHouseTimeAmount(entry: Pick<HouseTimeEntry, "startTime" | "endTime" | "breakMinutes" | "hourlyRate" | "billingMode" | "prepaid">) {
  if (entry.billingMode === "prepaid") {
    if (!entry.prepaid || !Number.isSafeInteger(entry.prepaid.amountCents)) return 0;
    return entry.prepaid.amountCents / 100;
  }
  return getHouseTimeHours(entry) * Number(entry.hourlyRate || 0);
}

export function getHouseTimeExpenseAmount(entry: Pick<HouseTimeEntry, "expenseAmount">) {
  return parseHouseExpenseAmount(String(entry.expenseAmount ?? "")) ?? 0;
}

/** Summarize the complete authorised, filtered scope before limiting displayed history. */
export function getHouseTimeExpenseSummary(timeEntries: HouseTimeEntry[]) {
  const entries = timeEntries.filter(entry => getHouseTimeExpenseAmount(entry) > 0);
  const totalCents = entries.reduce((sum, entry) => sum + Math.round(getHouseTimeExpenseAmount(entry) * 100), 0);
  return { entries, total: totalCents / 100 };
}

function houseSummaryMoneyAmount(amount: number) {
  return Number(new Intl.NumberFormat("en", {
    useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(amount));
}

/** Presentation totals for the complete filtered scope. Keep historical hourly
 * fractions until the aggregate is formatted, exactly as the existing money
 * cards do; rounding each intervention would change historical totals. */
export function getHouseTimeFinancialSummary(
  timeEntries: HouseTimeEntry[],
  resolveHoursAmount: (entry: HouseTimeEntry) => number | null = entry =>
    entry.billingMode === "prepaid" && !Number.isSafeInteger(entry.prepaid?.amountCents) ? null : getHouseTimeAmount(entry)
) {
  const expenseAmount = getHouseTimeExpenseSummary(timeEntries).total;
  let hours = 0;
  for (const entry of timeEntries) {
    const amount = resolveHoursAmount(entry);
    if (amount === null || !Number.isFinite(amount)) {
      return { hoursAmount: null, expenseAmount, totalAmount: null };
    }
    hours += amount;
  }
  // Match Intl's existing two-decimal screen rounding, including half cents.
  const hoursAmount = houseSummaryMoneyAmount(hours);
  const totalAmount = (Math.round(hoursAmount * 100) + Math.round(expenseAmount * 100)) / 100;
  return { hoursAmount, expenseAmount, totalAmount };
}

/** Present already-allocated payments against the displayed aggregate debt.
 * This does not allocate payments or alter the underlying historical amounts. */
export function getHouseTimeSettlementSummary(dueAmount: number, rawDue: number, rawPaid: number) {
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(rawDue)) * 8;
  const paidAmount = rawPaid >= rawDue - tolerance ? dueAmount : houseSummaryMoneyAmount(rawPaid);
  const balanceAmount = (Math.round(dueAmount * 100) - Math.round(paidAmount * 100)) / 100;
  return { paidAmount, balanceAmount };
}

/** Keep the historical hours calculation unchanged, then add the intervention's expense once. */
export function getHouseTimeTotalAmount(entry: Pick<HouseTimeEntry, "startTime" | "endTime" | "breakMinutes" | "hourlyRate" | "expenseAmount" | "billingMode" | "prepaid">) {
  return getHouseTimeAmount(entry) + getHouseTimeExpenseAmount(entry);
}

export function houseTrackingWorkerHasHistory(
  workerId: string,
  timeEntries: HouseTimeEntry[],
  payments: HousePayment[]
) {
  return timeEntries.some((entry) => entry.workerId === workerId) || payments.some((payment) => payment.workerId === workerId);
}

export function setHouseTrackingWorkerStatus(
  workers: HouseTrackingWorker[],
  workerId: string,
  status: HouseTrackingWorker["status"]
) {
  return workers.map((worker) => worker.id === workerId ? { ...worker, status } : worker);
}

export function permanentlyDeleteHouseTrackingWorker(
  workers: HouseTrackingWorker[],
  timeEntries: HouseTimeEntry[],
  payments: HousePayment[],
  workerId: string
) {
  if (houseTrackingWorkerHasHistory(workerId, timeEntries, payments)) {
    return { workers, deleted: false, blocked: true };
  }

  const nextWorkers = workers.filter((worker) => worker.id !== workerId);
  return {
    workers: nextWorkers,
    deleted: nextWorkers.length !== workers.length,
    blocked: false
  };
}

export function getHouseTrackingWorkerHistorySummary(
  workerId: string,
  timeEntries: HouseTimeEntry[],
  payments: HousePayment[]
) {
  const workerEntries = timeEntries.filter((entry) => entry.workerId === workerId);
  const workerPayments = payments.filter((payment) => payment.workerId === workerId);
  const hours = workerEntries.reduce((sum, entry) => sum + getHouseTimeHours(entry), 0);
  const due = workerEntries.reduce((sum, entry) => sum + getHouseTimeTotalAmount(entry), 0);
  const paid = workerPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const prepaid = workerEntries.some(entry => entry.billingMode === "prepaid") || workerPayments.some(payment => payment.prepaidPackageId);
  const billableDue = prepaid ? workerEntries.reduce((sum, entry) => sum +
    (entry.billingMode === "prepaid" ? getHouseTimeExpenseAmount(entry) : getHouseTimeTotalAmount(entry)), 0) : due;
  const billablePaid = prepaid ? workerPayments.filter(payment => !payment.prepaidPackageId).reduce((sum, payment) => sum + Number(payment.amount || 0), 0) : paid;

  return {
    timeEntries: workerEntries.length,
    payments: workerPayments.length,
    hours,
    due,
    paid,
    balance: billableDue - billablePaid,
    ...(prepaid ? { prepaid: true, uncoveredMinutes: workerEntries.reduce((sum, entry) => sum + (entry.prepaid?.uncoveredMinutes ?? 0), 0) } : {})
  };
}
