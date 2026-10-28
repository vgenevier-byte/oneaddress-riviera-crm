import assert from "node:assert/strict";
import test from "node:test";
import { copyProjectSections, PROJECT_SECTION_IDS, readProjectSections, writeProjectSections, type ProjectSectionIdentity } from "../../lib/fonciere/projectSectionState";

function session() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const project: ProjectSectionIdentity = { kind: "project", id: "project-a" };
const draft: ProjectSectionIdentity = { kind: "draft", id: "durable-draft-a" };

test("first existing project starts closed; each new durable draft starts with identification only", () => {
  const storage = session();
  assert.deepEqual([...readProjectSections("alice", project, storage)], []);
  assert.deepEqual([...readProjectSections("alice", draft, storage)], ["identity"]);
  assert.deepEqual([...readProjectSections("alice", { kind: "draft", id: "another-draft" }, storage)], ["identity"]);
  assert.equal(storage.values.size, 0);
});

test("independent choices and both global states round-trip through the same session", () => {
  const storage = session();
  writeProjectSections("alice", project, ["agency", "documents", "arbitrage"], storage);
  assert.deepEqual([...readProjectSections("alice", project, storage)], ["agency", "documents", "arbitrage"]);
  writeProjectSections("alice", project, PROJECT_SECTION_IDS, storage);
  assert.deepEqual([...readProjectSections("alice", project, storage)], [...PROJECT_SECTION_IDS]);
  writeProjectSections("alice", draft, [], storage);
  assert.deepEqual([...readProjectSections("alice", draft, storage)], []);
});

test("preferences are isolated by user, project, durable draft, and identity kind", () => {
  const storage = session();
  writeProjectSections("alice", project, ["property", "hypotheses"], storage);
  writeProjectSections("alice", draft, ["documents"], storage);
  assert.deepEqual([...readProjectSections("alice", project, storage)], ["property", "hypotheses"]);
  assert.deepEqual([...readProjectSections("alice", draft, storage)], ["documents"]);
  assert.deepEqual([...readProjectSections("bob", project, storage)], []);
  assert.deepEqual([...readProjectSections("bob", draft, storage)], ["identity"]);
  assert.deepEqual([...readProjectSections("alice", { kind: "project", id: "project-b" }, storage)], []);
  assert.deepEqual([...readProjectSections("alice", { kind: "draft", id: project.id }, storage)], ["identity"]);
  assert.deepEqual([...readProjectSections("alice", { kind: "draft", id: "durable-draft-b" }, storage)], ["identity"]);
});

test("draft-to-project transition carries current choices and preserves durable draft recovery", () => {
  const storage = session();
  writeProjectSections("alice", draft, ["agency", "description", "arbitrage"], storage);
  writeProjectSections("alice", project, ["identity"], storage);
  assert.deepEqual([...copyProjectSections("alice", draft, project, storage)], ["agency", "description", "arbitrage"]);
  assert.deepEqual([...readProjectSections("alice", project, storage)], ["agency", "description", "arbitrage"]);
  assert.deepEqual([...readProjectSections("alice", draft, storage)], ["agency", "description", "arbitrage"]);
  const nextSession = session();
  assert.deepEqual([...readProjectSections("alice", project, nextSession)], []);
});

test("only known section IDs are retained, with no duplicate or arbitrary project data", () => {
  const storage = session();
  writeProjectSections("alice", project, ["documents", "unknown", "documents", "identity"], storage);
  assert.deepEqual([...readProjectSections("alice", project, storage)], ["identity", "documents"]);
  const [key] = storage.values.keys();
  storage.values.set(key, '["identity", "future-section", "agency"]');
  assert.deepEqual([...readProjectSections("alice", project, storage)], ["identity", "agency"]);
  assert.equal(storage.values.size, 1);
});

test("malformed preferences fall back safely without changing business or draft storage", () => {
  const storage = session();
  writeProjectSections("alice", draft, ["agency"], storage);
  const [key] = storage.values.keys();
  for (const malformed of ["not json", "null", "{}", '["agency",42]']) {
    storage.values.set(key, malformed);
    assert.deepEqual([...readProjectSections("alice", draft, storage)], ["identity"]);
    assert.equal(storage.values.get(key), malformed);
  }
});

test("unavailable session storage cannot block display changes or project editing", () => {
  const unavailable = { getItem: () => { throw new Error("disabled"); }, setItem: () => { throw new Error("quota"); } };
  assert.deepEqual([...readProjectSections("alice", draft, unavailable)], ["identity"]);
  assert.doesNotThrow(() => writeProjectSections("alice", draft, ["agency"], unavailable));
  assert.doesNotThrow(() => copyProjectSections("alice", draft, project, unavailable));
  assert.deepEqual([...readProjectSections("alice", project)], []);
});

test("missing account or durable identity cannot create a shared preference slot", () => {
  const storage = session();
  writeProjectSections("", project, ["agency"], storage);
  writeProjectSections("alice", { kind: "draft", id: "" }, ["agency"], storage);
  assert.equal(storage.values.size, 0);
});
