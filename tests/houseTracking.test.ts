import assert from "node:assert/strict";
import test from "node:test";

import {
  parseHouseHourlyRate,
  houseHourlyRateInput,
  getHouseTrackingWorkerHistorySummary,
  getHouseTimeHours,
  isHouseTrackingWorkerActive,
  isQuarterHourTime,
  permanentlyDeleteHouseTrackingWorker,
  QUARTER_HOUR_TIME_OPTIONS,
  setHouseTrackingWorkerStatus
} from "../lib/houseTracking";
import type { HousePayment, HouseTimeEntry, HouseTrackingWorker } from "../lib/types";

function worker(id: string, status: HouseTrackingWorker["status"] = "Actif"): HouseTrackingWorker {
  return {
    id,
    contactId: `contact-${id}`,
    contactName: `Worker ${id}`,
    role: "Test",
    hourlyRate: 20,
    status,
    createdAt: "2026-01-01T00:00:00.000Z"
  };
}

function timeEntry(workerId: string): HouseTimeEntry {
  return {
    id: `hours-${workerId}`,
    houseId: "house-test",
    houseName: "Maison test",
    workerId,
    workerName: `Worker ${workerId}`,
    date: "2026-01-02",
    startTime: "09:00",
    endTime: "13:00",
    breakMinutes: 0,
    hourlyRate: 20,
    createdAt: "2026-01-02T13:00:00.000Z"
  };
}

function payment(workerId: string): HousePayment {
  return {
    id: `payment-${workerId}`,
    houseId: "house-test",
    houseName: "Maison test",
    workerId,
    workerName: `Worker ${workerId}`,
    date: "2026-01-03",
    amount: 30,
    method: "Virement",
    createdAt: "2026-01-03T12:00:00.000Z"
  };
}

test("archiver conserve strictement les heures et paiements", () => {
  const workers = [worker("with-history")];
  const entries = [timeEntry("with-history")];
  const payments = [payment("with-history")];
  const archivedWorkers = setHouseTrackingWorkerStatus(workers, "with-history", "Inactif");

  assert.equal(archivedWorkers[0].status, "Inactif");
  assert.deepEqual(entries, [timeEntry("with-history")]);
  assert.deepEqual(payments, [payment("with-history")]);
  assert.equal(isHouseTrackingWorkerActive(archivedWorkers[0]), false);
  assert.deepEqual(getHouseTrackingWorkerHistorySummary("with-history", entries, payments), {
    timeEntries: 1,
    payments: 1,
    hours: 4,
    due: 80,
    paid: 30,
    balance: 50
  });
});

test("réactiver rend l’intervenant sélectionnable sans toucher à l’historique", () => {
  const entries = [timeEntry("reactivate")];
  const payments = [payment("reactivate")];
  const reactivated = setHouseTrackingWorkerStatus([worker("reactivate", "Inactif")], "reactivate", "Actif");

  assert.equal(isHouseTrackingWorkerActive(reactivated[0]), true);
  assert.equal(entries.length, 1);
  assert.equal(payments.length, 1);
});

test("supprimer définitivement est autorisé sans historique", () => {
  const workers = [worker("empty"), worker("keep")];
  const result = permanentlyDeleteHouseTrackingWorker(workers, [], [], "empty");

  assert.equal(result.deleted, true);
  assert.equal(result.blocked, false);
  assert.deepEqual(result.workers.map((item) => item.id), ["keep"]);
});

test("supprimer définitivement est bloqué avec une heure ou un paiement", () => {
  const workers = [worker("protected")];
  const withHours = permanentlyDeleteHouseTrackingWorker(workers, [timeEntry("protected")], [], "protected");
  const withPayment = permanentlyDeleteHouseTrackingWorker(workers, [], [payment("protected")], "protected");

  assert.equal(withHours.blocked, true);
  assert.equal(withHours.deleted, false);
  assert.equal(withHours.workers, workers);
  assert.equal(withPayment.blocked, true);
  assert.equal(withPayment.deleted, false);
  assert.equal(withPayment.workers, workers);
});

test("un ancien intervenant sans status est considéré actif", () => {
  const { status: _status, ...legacyWorker } = worker("legacy");

  assert.equal(isHouseTrackingWorkerActive(legacyWorker as HouseTrackingWorker), true);
});

test("les nouvelles saisies acceptent uniquement les quarts d’heure valides", () => {
  ["09:00", "09:15", "09:30", "09:45", "23:45"].forEach((value) => {
    assert.equal(isQuarterHourTime(value), true, `${value} devrait être accepté`);
  });

  ["09:07", "09:59", "24:00"].forEach((value) => {
    assert.equal(isQuarterHourTime(value), false, `${value} devrait être refusé`);
  });
});

test("la liste centralisée contient les 96 quarts d’heure de 00:00 à 23:45", () => {
  assert.equal(QUARTER_HOUR_TIME_OPTIONS.length, 96);
  assert.equal(QUARTER_HOUR_TIME_OPTIONS[0], "00:00");
  assert.equal(QUARTER_HOUR_TIME_OPTIONS.at(-1), "23:45");
  assert.equal(new Set(QUARTER_HOUR_TIME_OPTIONS).size, 96);
});

test("les anciens horaires hors quart d’heure restent lisibles et inchangés", () => {
  const legacyEntry = {
    startTime: "08:07",
    endTime: "12:42",
    breakMinutes: 0
  };
  const originalEntry = { ...legacyEntry };

  assert.equal(getHouseTimeHours(legacyEntry), 4.583333333333333);
  assert.deepEqual(legacyEntry, originalEntry);
  assert.equal(legacyEntry.startTime, "08:07");
  assert.equal(legacyEntry.endTime, "12:42");
});

test("le taux distingue vide/invalide, zéro explicite et décimales françaises", () => {
  for (const value of ["", " ", "abc", "-1", "12,345", "1.2.3", "1e2", "Infinity", "100000000001"])
    assert.equal(parseHouseHourlyRate(value), null, value);
  for (const [value, expected] of [["0", 0], ["0,00", 0], ["18,75", 18.75], ["18.75", 18.75], [" 22,5 ", 22.5]] as const)
    assert.equal(parseHouseHourlyRate(value), expected);
});

test("chaque sélection propose son taux, y compris zéro ou absent", () => {
  assert.equal(houseHourlyRateInput(worker("paid")), "20");
  assert.equal(houseHourlyRateInput({hourlyRate: 0}), "0");
  assert.equal(houseHourlyRateInput(undefined), "");
  assert.equal(houseHourlyRateInput({} as HouseTrackingWorker), "");
});
