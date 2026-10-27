import assert from "node:assert/strict";
import test from "node:test";
import { confirmFonciereDraft, markFonciereDraftAttempted, readFonciereDraftIdentity } from "../../lib/fonciere/creationKey";

test("same-account drafts keep independent keys across another draft's confirmation and reload", () => {
  const values = new Map<string, string>();
  const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const scope = "user-a:projects", draftA = crypto.randomUUID(), draftB = crypto.randomUUID();
  const a = readFonciereDraftIdentity(scope, draftA, store), b = readFonciereDraftIdentity(scope, draftB, store);
  assert.notEqual(a.creationKey, b.creationKey);
  markFonciereDraftAttempted(a, store);
  const uncertainA = structuredClone(a);
  confirmFonciereDraft(b, crypto.randomUUID(), store);
  assert.deepEqual(readFonciereDraftIdentity(scope, draftA, store), uncertainA);
  assert.deepEqual(readFonciereDraftIdentity(scope, draftB, store), b);
  assert.notEqual(readFonciereDraftIdentity("user-b:projects", draftA, store).creationKey, a.creationKey);
  assert.notEqual(readFonciereDraftIdentity("user-a:presentation", draftA, store).creationKey, a.creationKey);
});

test("a draft whose creation identity cannot be persisted fails before any create request", () => {
  const id = crypto.randomUUID();
  assert.throws(() => readFonciereDraftIdentity("draft", id, { getItem: () => null, setItem: () => {}, removeItem: () => {} }), /identité du brouillon/);
  assert.throws(() => readFonciereDraftIdentity("draft", id, { getItem: () => { throw new Error("unavailable"); }, setItem: () => {}, removeItem: () => {} }), /unavailable/);
});

test("a corrupted durable draft identity is never replaced with a new creation key", () => {
  let writes = 0;
  assert.throws(() => readFonciereDraftIdentity("user:projects", crypto.randomUUID(), { getItem: () => '{"creationKey":"invalid"}', setItem: () => { writes++; }, removeItem: () => {} }), /Identité de brouillon conservée invalide/);
  assert.equal(writes, 0);
});
