import type { HousePayment, HouseTimeEntry, HouseTrackingWorker } from "./types";

/** Blank/invalid is distinct from an explicitly entered zero. */
export function parseHouseHourlyRate(value: string): number | null {
  const text = value.trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) return null;
  const amount = Number(text.replace(",", "."));
  return Number.isFinite(amount) && amount <= 100000000000 ? amount : null;
}

export function houseHourlyRateInput(worker?: Pick<HouseTrackingWorker, "hourlyRate">) {
  return worker?.hourlyRate == null ? "" : String(worker.hourlyRate);
}

export type HouseWorkerEdit = { hourlyRate: number; notes?: string };

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

export function getHouseTimeAmount(entry: Pick<HouseTimeEntry, "startTime" | "endTime" | "breakMinutes" | "hourlyRate">) {
  return getHouseTimeHours(entry) * Number(entry.hourlyRate || 0);
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
  const due = workerEntries.reduce((sum, entry) => sum + getHouseTimeAmount(entry), 0);
  const paid = workerPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  return {
    timeEntries: workerEntries.length,
    payments: workerPayments.length,
    hours,
    due,
    paid,
    balance: due - paid
  };
}
