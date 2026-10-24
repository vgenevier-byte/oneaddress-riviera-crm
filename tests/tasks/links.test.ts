import test from "node:test";
import assert from "node:assert/strict";
import { buildTaskPatch, draftForTask, filterAndSortTasks, taskTargetKey } from "../../lib/tasks/domain";
import { searchTaskTargets } from "../../lib/tasks/targets";
import type { Task, TaskTarget } from "../../lib/tasks/types";
const task = (changes: Partial<Task> = {}): Task => ({ id: "fictional-linked-task", title: "Vérifier le dossier", status: "À faire", notes: "", priority: "normal", dueDate: "", createdBy: "fictitious-author", createdByLabel: "Compte fictif", createdAt: "2026-10-24T10:00:00Z", updatedAt: "2026-10-24T10:00:00Z", revision: 7, assignees: [], ...changes });

test("unrelated edits preserve opaque hidden relations without submitting a replacement", () => {
  const source = task({ links: [{ id: "opaque-hidden", primary: true, state: "inaccessible" }, { id: "visible", primary: false, state: "available", target: { type: "contact", id: "fictional-contact" }, label: "Contact fictif" }] });
  const patch = buildTaskPatch({ ...draftForTask(source), title: "Titre modifiable", dueDate: "2026-11-15" }, source);
  assert.deepEqual(patch, { title: "Titre modifiable", dueDate: "2026-11-15" });
  assert.equal(source.links?.[0].id, "opaque-hidden");
});

test("link operations are explicit deltas and restricted assignees cannot submit them", () => {
  const source = task(); const ref = { type: "bank_account", id: "account-A", context: { contactId: "contact-A" } };
  const changes = { add: [ref], remove: ["opaque-relation"], primary: { target: ref } };
  assert.deepEqual(buildTaskPatch({ ...draftForTask(source), linkChanges: changes }, source), { linkChanges: changes });
  assert.deepEqual(buildTaskPatch({ ...draftForTask(source), linkChanges: changes, notes: "Note autorisée" }, source, false), { notes: "Note autorisée" });
  assert.deepEqual(buildTaskPatch({ ...draftForTask(source), linkChanges: { primary: null } }, source), { linkChanges: { primary: null } });
});

test("source drafts preserve work period separately from task deadline and true bank identity", () => {
  const ref = { type: "worker_period", id: "historical-worker", context: { startDate: "2026-09-01", endDate: "2026-09-30" } };
  const draft = draftForTask(undefined, { title: "Vérifier ou compléter les heures", dueDate: "2026-11-01", target: ref });
  assert.equal(draft.dueDate, "2026-11-01"); assert.deepEqual(draft.linkChanges?.primary, { target: ref });
  const bankA = { type: "bank_account", id: "account-A", context: { contactId: "contact" } }, bankB = { ...bankA, id: "account-B" };
  assert.notEqual(taskTargetKey(bankA), taskTargetKey(bankB));
  assert.equal(taskTargetKey({ type: "worker_period", id: "worker", context: { endDate: "2026-10-31", startDate: "2026-10-01" } }), taskTargetKey({ type: "worker_period", id: "worker", context: { startDate: "2026-10-01", endDate: "2026-10-31" } }));
});

test("task search and linked filters use only reader-authorized labels", () => {
  const visible = task({ links: [{ id: "link-A", state: "available", primary: true, label: "Société Côte Riviera Nice", target: { type: "vendor_invoice", id: "invoice-A" } }] });
  const hidden = task({ id: "hidden-link-task", links: [{ id: "opaque", state: "inaccessible", primary: false, label: "Private obsolete title" }] });
  const filters = { relation: "related" as const, status: "all" as const, priority: "all" as const };
  assert.deepEqual(filterAndSortTasks([visible, hidden], "fictitious-author", { ...filters, query: "nice cote" }).map(task => task.id), [visible.id]);
  assert.equal(filterAndSortTasks([visible, hidden], "fictitious-author", { ...filters, query: "private obsolete" }).length, 0);
  assert.equal(filterAndSortTasks([visible, hidden], "fictitious-author", { ...filters, targetType: "vendor_invoice" }).length, 1);
  assert.equal(filterAndSortTasks([visible, hidden], "fictitious-author", { ...filters, targetKey: taskTargetKey({ type: "vendor_invoice", id: "invoice-A" }) }).length, 1);
});

test("catalogue searches every page before exact/fuzzy ranking and paginating", async () => {
  const items: TaskTarget[] = Array.from({ length: 205 }, (_, index) => ({ ref: { type: "contact", id: `fictional-${index}` }, label: `Candidat ${index}` }));
  items[0] = { ref: { type: "contact", id: "typo" }, label: "Riviera Generier", searchFields: ["Nice"] };
  items[204] = { ref: { type: "contact", id: "exact" }, label: "Riviera Génévier", searchFields: ["Nice", "Entreprise canonique"] };
  const reads: number[] = [];
  const fetchPage = async (offset: number, limit: number) => { reads.push(offset); return { items: items.slice(offset, offset + limit), hasMore: items.length > offset + limit }; };
  const found = await searchTaskTargets(fetchPage, "genevier nice riviera", 0, 1);
  assert.deepEqual(reads, [0, 200]); assert.equal(found.items[0].ref.id, "exact"); assert.equal(found.items[0].approximate, false); assert.equal(found.hasMore, true);
  const next = await searchTaskTargets(fetchPage, "genevier nice riviera", 1, 1);
  assert.equal(next.items[0].ref.id, "typo"); assert.equal(next.items[0].approximate, true);
  const company = await searchTaskTargets(fetchPage, "canonique entreprise", 0, 40); assert.equal(company.items[0].ref.id, "exact");
});

test("separate authorized catalogues merge before ranking and broken pagination fails visibly", async () => {
  const result = await searchTaskTargets(async () => ({ items: [], hasMore: false }), "revision", 0, 40, async () => [{ ref: { type: "publisher_creation", id: "creation-fictive" }, label: "Révision Publisher fictive" }]);
  assert.equal(result.items[0].ref.type, "publisher_creation");
  await assert.rejects(searchTaskTargets(async () => ({ items: [], hasMore: true }), "", 0, 40), /Catalogue incomplet/);
});
