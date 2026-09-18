import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceSyncGuard } from "../lib/access/workspaceSync";

test("hydrating the same business data needs no write, including after token rotation", () => {
  const sync = new WorkspaceSyncGuard();
  const payload = { contacts: [{ id: "a", name: "Fictional" }], quotes: [] };
  sync.load(payload, "server-1");
  assert.equal(sync.dirty({ quotes: [], contacts: [{ name: "Fictional", id: "a" }] }), false);
  // Rendering a different Auth token does not mutate or reset the business baseline.
  assert.equal(sync.dirty(payload), false);
});

test("acknowledging one save does not mark edits made during that request as saved", () => {
  const sync = new WorkspaceSyncGuard();
  sync.load({ value: 0 }, "server-1");
  const first = sync.prepare({ value: 1 })!;
  assert.equal(first.revision, "server-1");
  assert.equal(sync.saved(first, "server-2"), true);
  assert.equal(sync.dirty({ value: 1 }), false);
  assert.equal(sync.dirty({ value: 2 }), true);
  assert.equal(sync.prepare({ value: 2 })?.revision, "server-2");
});

test("a conflict blocks every further write until an explicit reload; local edits remain dirty", () => {
  const sync = new WorkspaceSyncGuard();
  sync.load({ value: 0 }, "server-1");
  const stale = sync.prepare({ value: 1 })!;
  sync.conflict();
  assert.equal(sync.prepare({ value: 1 }), null);
  assert.equal(sync.prepare({ value: 2 }), null);
  assert.equal(sync.saved(stale, "server-2"), false);
  assert.equal(sync.dirty({ value: 1 }), true);
  sync.load({ value: 3 }, "server-3");
  assert.equal(sync.dirty({ value: 3 }), false);
  assert.equal(sync.prepare({ value: 4 })?.revision, "server-3");
});

test("missing server revision fails closed, including an empty workspace seed", () => {
  const sync = new WorkspaceSyncGuard();
  assert.equal(sync.prepare({ value: 1 }), null);
  sync.load({}, "");
  assert.equal(sync.prepare({ value: 1 }), null);
});

test("an obsolete response cannot replace a more recently loaded revision", () => {
  const sync = new WorkspaceSyncGuard();
  sync.load({ value: 0 }, "server-1");
  const old = sync.prepare({ value: 1 })!;
  sync.load({ value: 3 }, "server-3");
  assert.equal(sync.saved(old, "server-2"), false);
  assert.equal(sync.dirty({ value: 3 }), false);
  assert.equal(sync.prepare({ value: 4 })?.revision, "server-3");
});
