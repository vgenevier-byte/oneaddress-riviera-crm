import assert from "node:assert/strict";
import test from "node:test";
import {
  getHouseTimeAmount, getHouseTimeExpenseAmount, getHouseTimeHours, getHouseTimeTotalAmount,
  getHouseTrackingWorkerHistorySummary, parseHouseExpenseAmount
} from "../lib/houseTracking";
import type { HousePayment, HouseTimeEntry } from "../lib/types";

function entry(overrides: Partial<HouseTimeEntry> = {}): HouseTimeEntry {
  return {
    id: "hours-fictional", houseId: "house-fictional", houseName: "Maison fictive",
    workerId: "worker-fictional", workerName: "Intervenant fictif", date: "2026-10-23",
    startTime: "09:00", endTime: "13:00", breakMinutes: 0, hourlyRate: 25,
    createdAt: "2026-10-23T08:00:00.000Z", ...overrides
  };
}
function payment(): HousePayment {
  return {
    id: "payment-fictional", houseId: "house-fictional", houseName: "Maison fictive",
    workerId: "worker-fictional", workerName: "Intervenant fictif", date: "2026-10-23",
    amount: 50, method: "Virement", createdAt: "2026-10-23T08:00:00.000Z"
  };
}

test("optional expenses accept comma or point and reject invalid amounts without coercion", () => {
  for (const value of ["", "   ", "0", "0,00", "0.00"]) assert.equal(parseHouseExpenseAmount(value), 0);
  for (const value of ["48,60", "48.60", " 48,60 "]) assert.equal(parseHouseExpenseAmount(value), 48.6);
  assert.equal(parseHouseExpenseAmount("100000000000"), 100000000000);
  for (const value of ["-1", "-0", "+1", "48,601", "48.601", "48,", ".5", "abc", "NaN", "Infinity", "1e3", "1.2.3", "1 000", "100000000000.01"]) {
    assert.equal(parseHouseExpenseAmount(value), null, value);
  }
});

test("4 h × 25 € plus 48,60 € expense creates 148,60 € due and 98,60 € remaining after 50 € paid", () => {
  const intervention = entry({ expenseAmount: 48.6, expenseNote: "Déplacement fictif" });
  const before = structuredClone(intervention);
  assert.equal(getHouseTimeHours(intervention), 4);
  assert.equal(getHouseTimeAmount(intervention), 100);
  assert.equal(getHouseTimeExpenseAmount(intervention), 48.6);
  assert.equal(getHouseTimeTotalAmount(intervention), 148.6);
  assert.deepEqual(getHouseTrackingWorkerHistorySummary(intervention.workerId, [intervention], [payment()]), {
    timeEntries: 1, payments: 1, hours: 4, due: 148.6, paid: 50, balance: 98.6
  });
  assert.deepEqual(intervention, before);
});

test("legacy entries and explicit zero keep the original hours amount, including historical minute precision", () => {
  for (const intervention of [entry(), entry({ expenseAmount: 0 }), entry({ startTime: "08:07", endTime: "12:42", breakMinutes: 15, hourlyRate: 20.333 })]) {
    const before = structuredClone(intervention);
    assert.equal(getHouseTimeExpenseAmount(intervention), 0);
    assert.equal(getHouseTimeTotalAmount(intervention), getHouseTimeAmount(intervention));
    assert.deepEqual(intervention, before);
  }
});

test("changing or clearing an expense changes only the reimbursement and keeps one intervention and its payment", () => {
  const original = entry({ expenseAmount: 48.6, expenseNote: "Déplacement fictif" });
  const payments = [payment()];
  const beforePayments = structuredClone(payments);
  const changed = { ...original, expenseAmount: 20, expenseNote: "Motif corrigé fictif" };
  const cleared = { ...changed, expenseAmount: 0, expenseNote: "" };
  for (const intervention of [changed, cleared]) {
    const { expenseAmount: _amount, expenseNote: _note, ...unchanged } = intervention;
    const { expenseAmount: _beforeAmount, expenseNote: _beforeNote, ...originalFields } = original;
    assert.deepEqual(unchanged, originalFields);
    const summary = getHouseTrackingWorkerHistorySummary(intervention.workerId, [intervention], payments);
    assert.equal(summary.timeEntries, 1);
    assert.equal(summary.hours, 4);
    assert.equal(summary.payments, 1);
    assert.equal(summary.balance, intervention.expenseAmount + 50);
  }
  assert.deepEqual(payments, beforePayments);
});
