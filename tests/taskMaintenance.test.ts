import test from "node:test";
import assert from "node:assert/strict";
import { maintainCompletedTasks } from "../lib/taskMaintenance";
import { WorkspaceSyncGuard } from "../lib/access/workspaceSync";
import type { Task } from "../lib/types";

const now = Date.parse("2026-09-17T12:00:00Z");
const task = (changes: Partial<Task> = {}) => ({ id: "fictional-task", title: "Fixture", status: "À faire", ...changes } as Task);

test("completed tasks without a date get one captured timestamp without mutating the input", () => {
  const input = [task({ status: "Terminé" }), task({ id: "other", status: " terminé " as Task["status"] })];
  const output = maintainCompletedTasks(input, now);
  assert.deepEqual(output.map(value => value.completedAt), [new Date(now).toISOString(), new Date(now).toISOString()]);
  assert.equal(input[0].completedAt, undefined);
  assert.equal(output[0].title, input[0].title);
});

test("a task is retained at exactly three days and removed only after that boundary", () => {
  const input = [task({ status: "Terminé", completedAt: "2026-09-14T12:00:00Z" })];
  assert.equal(maintainCompletedTasks(input, now), input);
  assert.deepEqual(maintainCompletedTasks(input, now + 1), []);
});

test("open, invalid-date and future tasks remain untouched", () => {
  const input = [
    task({ completedAt: "2020-01-01T00:00:00Z" }),
    task({ id: "invalid", status: "Terminé", completedAt: "not-a-date" }),
    task({ id: "future", status: "Terminé", completedAt: "2026-09-18T12:00:00Z" })
  ];
  assert.equal(maintainCompletedTasks(input, now), input);
});

test("mixed maintenance preserves the order and identity of untouched tasks", () => {
  const open = task(), recent = task({ id: "recent", status: "Terminé", completedAt: "2026-09-16T12:00:00Z" });
  const output = maintainCompletedTasks([task({ id: "expired", status: "Terminé", completedAt: "2020-01-01T00:00:00Z" }), open, recent], now);
  assert.deepEqual(output.map(value => value.id), ["fictional-task", "recent"]);
  assert.equal(output[0], open); assert.equal(output[1], recent);
});

test("replaying an updater with the same event clock yields the same payload", () => {
  const input = [task({ status: "Terminé" })];
  assert.deepEqual(maintainCompletedTasks(input, now), maintainCompletedTasks(input, now));
  const maintained = maintainCompletedTasks(input, now);
  assert.equal(maintainCompletedTasks(maintained, now), maintained);
});

test("loading a cloud task that needs maintenance stays dirty against the actual server payload", () => {
  const payload = { tasks: [task({ status: "Terminé" })], leads: [{ status: "Visite" }] };
  const sync = new WorkspaceSyncGuard(); sync.load(payload, "server-revision");
  const local = { ...payload, tasks: maintainCompletedTasks(payload.tasks, now) };
  assert.equal(sync.dirty(local), true);
  assert.equal(local.leads, payload.leads);
  const write = sync.prepare(local)!; assert.equal(write.revision, "server-revision");
  assert.equal(sync.saved(write, "saved-revision"), true);
  assert.equal(sync.dirty(local), false);
});

test("unchanged task collections need neither allocation nor a business write", () => {
  const payload = { tasks: [task()] };
  const sync = new WorkspaceSyncGuard(); sync.load(payload, "server-revision");
  const local = { tasks: maintainCompletedTasks(payload.tasks, now) };
  assert.equal(local.tasks, payload.tasks);
  assert.equal(sync.dirty(local), false);
});

test("an empty collection is retained by identity", () => {
  const input: Task[] = [];
  assert.equal(maintainCompletedTasks(input, now), input);
});
