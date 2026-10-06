import test from "node:test";
import assert from "node:assert/strict";
import { maintainCompletedTasks, isCompletedTaskStatus } from "../lib/taskMaintenance";
import { WorkspaceSyncGuard } from "../lib/access/workspaceSync";
import type { Task } from "../lib/types";

test("legacy maintenance retains old completed tasks and does not invent timestamps", () => {
  const input = [
    { id: "old", status: "Terminé", completedAt: "2020-01-01T00:00:00Z" },
    { id: "unknown", status: "Terminé" },
    { id: "open", status: "À faire" }
  ] as Task[];
  assert.equal(maintainCompletedTasks(input, Date.parse("2026-10-06T12:00:00Z")), input);
  assert.equal(input[1].completedAt, undefined);
  const sync = new WorkspaceSyncGuard(); sync.load({ tasks: input }, "revision");
  assert.equal(sync.dirty({ tasks: maintainCompletedTasks(input) }), false);
});

test("status normalization and empty collections remain compatible", () => {
  assert.equal(isCompletedTaskStatus(" terminé "), true);
  assert.equal(isCompletedTaskStatus("En cours"), false);
  const input: Task[] = [];
  assert.equal(maintainCompletedTasks(input), input);
});
