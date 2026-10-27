import assert from "node:assert/strict";
import test from "node:test";
import { clearFonciereCreationKey, getFonciereCreationKey } from "../../lib/fonciere/creationKey";

test("a saved creation identity survives a reload and scopes drafts independently", () => {
  const values = new Map<string, string>();
  const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const key = getFonciereCreationKey("user-a:projects:new", store);
  assert.equal(getFonciereCreationKey("user-a:projects:new", store), key);
  assert.notEqual(getFonciereCreationKey("user-b:projects:new", store), key);
  assert.notEqual(getFonciereCreationKey("user-a:presentation:draft-b", store), key);
  clearFonciereCreationKey("user-a:projects:new", store);
  assert.notEqual(getFonciereCreationKey("user-a:projects:new", store), key);
});

test("a draft whose creation identity cannot be persisted fails before any create request", () => {
  assert.throws(() => getFonciereCreationKey("draft", { getItem: () => null, setItem: () => {}, removeItem: () => {} }), /identité du brouillon/);
  assert.throws(() => getFonciereCreationKey("draft", { getItem: () => { throw new Error("unavailable"); }, setItem: () => {}, removeItem: () => {} }), /unavailable/);
});
