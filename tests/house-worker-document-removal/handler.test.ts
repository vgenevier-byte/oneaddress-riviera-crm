import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createHouseWorkerDocumentCleanupHandler, type CleanupJob, type CleanupStore } from "../../lib/server/houseWorkerDocumentCleanup";
const operation = randomUUID(), object = randomUUID();
const path = "oneaddress-riviera/house-workers/worker-fixture/123-fixture.pdf";
function fixture(action: "delete" | "keep" = "delete") {
  const calls: string[] = [];
  let missing = false, completed = false, failRemove = false, failComplete = false, failCheck = false;
  const result = () => ({ operation_id: operation, status: completed ? "completed" as const : "pending" as const,
    action, refs_removed: completed ? 1 : 0 });
  const store: CleanupStore = {
    async check(id, lease) {
      assert.equal(id, operation); assert.match(lease, /^[0-9a-f-]{36}$/); calls.push("check");
      if (failCheck) throw new Error("Expired or unapproved reservation");
      return { ...result(), bucket_id: "crm-documents", object_path: path, object_id: object,
        object_version: "fixture-version", object_missing: missing } as CleanupJob;
    },
    async remove(bucket, exactPath) {
      assert.equal(bucket, "crm-documents"); assert.equal(exactPath, path); calls.push("remove");
      if (failRemove) throw new Error("Storage API failure"); missing = true;
    },
    async complete(id) {
      assert.equal(id, operation); calls.push("complete");
      if (failComplete) throw new Error("Database confirmation failure");
      if (action === "delete") assert.equal(missing, true);
      completed = true; return result();
    },
    async release() { calls.push("release"); }
  };
  return { calls, store, get missing() { return missing; }, get completed() { return completed; },
    failRemove(value: boolean) { failRemove = value; }, failComplete(value: boolean) { failComplete = value; },
    failCheck(value: boolean) { failCheck = value; } };
}
const request = (body: unknown) => new Request("http://fixture.invalid/api/house-worker-documents/cleanup", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
});
test("invalid or caller-supplied targets cannot create a job or contact Storage", async () => {
  let calls = 0;
  const handler = createHouseWorkerDocumentCleanupHandler({ createStore() { calls++; throw new Error("must not run"); } });
  for (const body of [null, {}, [], { operationId: "invalid" }, { operationId: operation, path },
    { operationId: operation, bucket: "crm-documents" }, { operationId: operation, expiresAt: "2099-01-01" }]) {
    assert.equal((await handler(request(body))).status, 400);
  }
  assert.equal(calls, 0);
});
test("exact authorized object is removed through Storage before references are detached", async () => {
  const f = fixture(), handler = createHouseWorkerDocumentCleanupHandler({ createStore: () => f.store });
  const response = await handler(request({ operationId: operation }));
  assert.equal(response.status, 200); assert.equal(f.missing, true); assert.equal(f.completed, true);
  assert.deepEqual(f.calls, ["check", "remove", "complete"]);
  const receipt = await response.json();
  assert.deepEqual(receipt, { ok: true, completed: true, disposition: "deleted", referencesRemoved: 1 });
  assert.equal(JSON.stringify(receipt).includes(path), false);
});
test("same physical object used by Contacts is retained and only worker references detach", async () => {
  const f = fixture("keep"), handler = createHouseWorkerDocumentCleanupHandler({ createStore: () => f.store });
  const response = await handler(request({ operationId: operation }));
  assert.equal(response.status, 200); assert.equal(f.missing, false);
  assert.deepEqual(f.calls, ["check", "complete"]);
  assert.equal((await response.json()).disposition, "retained");
});
test("failed Storage call preserves references and releases the lease for retry", async () => {
  const f = fixture(); f.failRemove(true);
  const handler = createHouseWorkerDocumentCleanupHandler({ createStore: () => f.store });
  assert.equal((await handler(request({ operationId: operation }))).status, 503);
  assert.equal(f.completed, false); assert.equal(f.missing, false);
  assert.deepEqual(f.calls, ["check", "remove", "release"]);
  f.failRemove(false);
  assert.equal((await handler(request({ operationId: operation }))).status, 200);
  assert.equal(f.completed, true);
});
test("failure after Storage deletion resumes the same job without a second deletion", async () => {
  const f = fixture(); f.failComplete(true);
  const handler = createHouseWorkerDocumentCleanupHandler({ createStore: () => f.store });
  assert.equal((await handler(request({ operationId: operation }))).status, 503);
  assert.equal(f.missing, true); assert.equal(f.completed, false);
  f.failComplete(false);
  assert.equal((await handler(request({ operationId: operation }))).status, 200);
  assert.equal(f.calls.filter(call => call === "remove").length, 1);
  const previousCalls = [...f.calls];
  assert.equal((await handler(request({ operationId: operation }))).status, 200);
  assert.deepEqual(f.calls, [...previousCalls, "check"]);
});
test("expired, unknown or changed reservation cannot remove or detach anything", async () => {
  const f = fixture(); f.failCheck(true);
  const handler = createHouseWorkerDocumentCleanupHandler({ createStore: () => f.store });
  assert.equal((await handler(request({ operationId: operation }))).status, 503);
  assert.deepEqual(f.calls, ["check"]); assert.equal(f.missing, false); assert.equal(f.completed, false);
});

test("UUID spelling is canonical before reservation and lease checks", async () => {
  const f = fixture(), handler = createHouseWorkerDocumentCleanupHandler({ createStore: () => f.store });
  assert.equal((await handler(request({ operationId: operation.toUpperCase() }))).status, 200);
  assert.deepEqual(f.calls, ["check", "remove", "complete"]);
});
