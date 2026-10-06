import test from "node:test";
import assert from "node:assert/strict";
import { buildTaskPatch, draftForTask, effectiveTaskLeadId, filterAndSortTasks, isCivilDate, parisCivilDate, TASK_NOTE_LIMIT, TaskRequestLedger, taskCapabilities, taskDueLabel, taskDueState, taskManagementLabel } from "../../lib/tasks/domain";
import type { Task, TaskPermissions } from "../../lib/tasks/types";

const permissions: TaskPermissions = { read: true, contribute: true, export: true, delete: true };
const task = (changes: Partial<Task> = {}): Task => ({ id: "fictional-task", title: "Préparer le dossier fictif", status: "À faire", notes: "Ligne 1\nLigne 2", priority: "normal", dueDate: "", createdBy: "creator-fictional", createdByLabel: "Créateur fictif", createdAt: "2026-10-06T10:00:00Z", updatedAt: "2026-10-06T10:00:00Z", revision: 1, assignees: [], ...changes });

test("civil dates reject normalization, wrong months, century non-leaps and impossible values", () => {
  for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-10-00", "2026-2-01", "1900-02-29", "0000-01-01", "bad", ""]) assert.equal(isCivilDate(date), false, date);
  for (const date of ["2024-02-29", "2000-02-29", "2026-12-31", "0001-01-01"]) assert.equal(isCivilDate(date), true, date);
});

test("Paris civil day changes before the UTC day in winter and summer and across DST boundaries", () => {
  assert.equal(parisCivilDate(new Date("2026-10-06T21:59:59Z")), "2026-10-06");
  assert.equal(parisCivilDate(new Date("2026-10-06T22:00:00Z")), "2026-10-07");
  assert.equal(parisCivilDate(new Date("2026-01-06T23:00:00Z")), "2026-01-07");
  assert.equal(parisCivilDate(new Date("2026-03-29T22:00:00Z")), "2026-03-30");
  assert.equal(parisCivilDate(new Date("2026-10-25T23:00:00Z")), "2026-10-26");
});

test("due labels preserve an absent date and importance independently of computed lateness", () => {
  assert.equal(taskDueLabel("", "2026-10-06"), "Sans échéance");
  assert.equal(taskDueState("2026-10-05", "2026-10-06"), "late");
  assert.match(taskDueLabel("2026-10-06", "2026-10-06"), /Aujourd’hui/);
  assert.match(taskDueLabel("2026-10-07", "2026-10-06"), /À venir/);
  const source = task({ priority: "normal", dueDate: "2026-10-05" });
  filterAndSortTasks([source], "creator-fictional", { relation: "related", status: "all", priority: "all" }, "2026-10-06");
  assert.equal(source.priority, "normal");
});

test("defaults are personal, undated and normal with no inferred recipient or timestamp", () => {
  const draft = draftForTask();
  assert.deepEqual(draft.assigneeIds, []); assert.equal(draft.dueDate, ""); assert.equal(draft.priority, "normal");
  const patch = buildTaskPatch({ ...draft, title: "Nouvelle tâche fictive" });
  assert.equal("createdBy" in patch, false); assert.equal("createdAt" in patch, false); assert.equal("completedAt" in patch, false);
  assert.equal(patch.dueDate, ""); assert.deepEqual(patch.assigneeIds, []);
});

test("multiline notes remain plain text and enforce a clear character limit", () => {
  const source = task();
  const draft = { ...draftForTask(source), notes: "<script>fictional()</script>\nDeuxième ligne\n" };
  assert.equal(buildTaskPatch(draft, source).notes, draft.notes);
  assert.doesNotThrow(() => buildTaskPatch({ ...draft, notes: "x".repeat(TASK_NOTE_LIMIT) }, source));
  assert.throws(() => buildTaskPatch({ ...draft, notes: "x".repeat(TASK_NOTE_LIMIT + 1) }, source), /limitées/);
});

test("impossible dates cannot reach mutations while absent dates remain optional", () => {
  const source = task();
  assert.throws(() => buildTaskPatch({ ...draftForTask(source), dueDate: "2026-02-30" }, source), /date réelle/);
  assert.doesNotThrow(() => buildTaskPatch({ ...draftForTask(source), dueDate: "" }, source));
});

test("assignees edit notes and progress only; creator identity is never writable", () => {
  const source = task({ assignees: [{ userId: "assignee-fictional", label: "Responsable fictif", access: "contribute", active: true }] });
  const capability = taskCapabilities(source, "assignee-fictional", permissions);
  assert.equal(capability.read, true); assert.equal(capability.progress, true); assert.equal(capability.fields, false); assert.equal(capability.delete, false);
  const patch = buildTaskPatch({ ...draftForTask(source), title: "Titre falsifié", dueDate: "bad", notes: "Note autorisée", assigneeIds: ["third-fictional"], status: "Terminé" }, source, capability.fields);
  assert.deepEqual(patch, { notes: "Note autorisée", status: "Terminé" });
  assert.equal("createdBy" in patch, false); assert.equal("completedAt" in patch, false);
});

test("reader assignees can read only; inactive assignments and unrelated full access confer no privilege", () => {
  const source = task({ assignees: [{ userId: "reader-fictional", label: "Lecteur fictif", access: "read", active: true }, { userId: "inactive-fictional", label: "Inactif fictif", access: "contribute", active: false }] });
  assert.deepEqual(taskCapabilities(source, "reader-fictional", { ...permissions, contribute: false }), { read: true, fields: false, progress: false, delete: false });
  assert.equal(taskCapabilities(source, "third-full-access-fictional", permissions).read, false);
  assert.equal(taskCapabilities(source, "inactive-fictional", permissions).read, false);
  assert.equal(taskCapabilities(source, "creator-fictional", { ...permissions, read: false }).read, false);
});

test("historical text author never grants creator capability or personal visibility", () => {
  const source = task({ createdBy: null, createdByLabel: "Auteur historique non confirmé", owner: "Créateur fictif", createdAt: null });
  assert.equal(taskCapabilities(source, "creator-fictional", permissions).read, false);
  assert.equal(filterAndSortTasks([source], "creator-fictional", { relation: "created", status: "all", priority: "all" }).length, 0);
});

test("editing another field retains old inactive assignments without emitting an assignment patch", () => {
  const source = task({ assignees: [{ userId: "old-fictional", label: "Ancien fictif", access: "read", active: false }] });
  const draft = { ...draftForTask(source), notes: "Nouvelle note" };
  assert.deepEqual(buildTaskPatch(draft, source), { notes: "Nouvelle note" });
  assert.deepEqual(buildTaskPatch({ ...draft, assigneeIds: [] }, source), { notes: "Nouvelle note", assigneeIds: [] });
});

test("sorting is stable independent of input order and preserves completed tasks older than three days", () => {
  const sources = [task({ id: "no-due-urgent", priority: "urgent" }), task({ id: "late-normal", dueDate: "2026-10-01" }), task({ id: "today-important", dueDate: "2026-10-06", priority: "important" }), task({ id: "today-urgent", dueDate: "2026-10-06", priority: "urgent" }), task({ id: "old-completed", status: "Terminé", completedAt: "2026-01-01T12:00:00Z" })];
  const filters = { relation: "related", status: "all", priority: "all" } as const;
  const sorted = filterAndSortTasks(sources, "creator-fictional", filters, "2026-10-06").map(value => value.id);
  assert.deepEqual(sorted, ["late-normal", "today-urgent", "today-important", "no-due-urgent", "old-completed"]);
  assert.deepEqual(filterAndSortTasks([...sources].reverse(), "creator-fictional", filters, "2026-10-06").map(value => value.id), sorted);
  assert.equal(sources.length, 5);
});

test("filters and search operate only over the authorized server projection and verified participation", () => {
  const source = task({ assignees: [{ userId: "assignee-fictional", label: "Responsable fictif", access: "read", active: true }] });
  assert.equal(filterAndSortTasks([source], "assignee-fictional", { relation: "assigned", status: "all", priority: "normal", query: "LIGNE 2" }).length, 1);
  assert.equal(filterAndSortTasks([source], "assignee-fictional", { relation: "created", status: "all", priority: "all" }).length, 0);
  assert.equal(filterAndSortTasks([source], "third-fictional", { relation: "related", status: "all", priority: "all", query: "Ligne" }).length, 0);
});

test("request IDs survive a lost response and change only after confirmation, a new revision or a changed draft", () => {
  let id = 0;
  const ledger = new TaskRequestLedger(() => `request-fictional-${++id}`);
  const first = ledger.prepare("task-fictional", null, { title: "Titre fictif", notes: "Ligne 1\nLigne 2" });
  assert.equal(ledger.prepare("task-fictional", null, { title: "Titre fictif", notes: "Ligne 1\nLigne 2" }), first);
  const changed = ledger.prepare("task-fictional", null, { title: "Titre fictif modifié" });
  assert.notEqual(changed.requestId, first.requestId);
  const revised = ledger.prepare("task-fictional", 2, { title: "Titre fictif modifié" });
  assert.notEqual(revised.requestId, changed.requestId);
  ledger.confirmed("task-fictional");
  assert.notEqual(ledger.prepare("task-fictional", 2, { title: "Titre fictif modifié" }).requestId, revised.requestId);
  ledger.clear();
  assert.notEqual(ledger.prepare("task-fictional", 2, { title: "Titre fictif modifié" }).requestId, revised.requestId);
});

test("leadId-only and deprecated linkedTo-only both prefill the same canonical field", () => {
  for (const source of [task({ leadId: "lead-fictional-A", linkedTo: "" }), task({ leadId: "", linkedTo: "lead-fictional-A" }), task({ leadId: "lead-fictional-A", linkedTo: "lead-fictional-A" })]) {
    assert.equal(effectiveTaskLeadId(source), "lead-fictional-A");
    assert.equal(draftForTask(source).leadId, "lead-fictional-A");
    assert.deepEqual(buildTaskPatch(draftForTask(source), source), {});
  }
  assert.equal(draftForTask(undefined, { leadId: "lead-fictional-A" }).leadId, "lead-fictional-A");
});

test("A to B and an explicit clear use leadId only and preserve the distinct Contact reference", () => {
  const source = task({ leadId: "lead-fictional-A", linkedTo: "", contactId: "contact-fictional" });
  assert.deepEqual(buildTaskPatch({ ...draftForTask(source), leadId: "lead-fictional-B" }, source), { leadId: "lead-fictional-B" });
  assert.deepEqual(buildTaskPatch({ ...draftForTask(source), leadId: "" }, source), { leadId: "" });
  const reloaded = task({ leadId: "lead-fictional-B", linkedTo: "lead-fictional-B", contactId: "contact-fictional" });
  assert.equal(draftForTask(reloaded).leadId, "lead-fictional-B");
  assert.deepEqual(buildTaskPatch(draftForTask(reloaded), reloaded), {});
  const cleared = task({ leadId: "", linkedTo: "", contactId: "contact-fictional" });
  assert.equal(effectiveTaskLeadId(cleared), "");
  assert.equal(draftForTask(cleared).contactId, "contact-fictional");
});

test("contradictory aliases are refused without choosing a winning private reference", () => {
  const source = task({ leadId: "lead-fictional-A", linkedTo: "lead-fictional-B" });
  assert.throws(() => effectiveTaskLeadId(source), /contradictoires/);
  assert.throws(() => draftForTask(source), /contradictoires/);
  assert.throws(() => buildTaskPatch({ ...draftForTask(), title: source.title, notes: source.notes }, source), /contradictoires/);
});

test("masked references are not sent when another field changes", () => {
  const masked = task({ leadId: "", linkedTo: "", contactId: "" });
  assert.deepEqual(buildTaskPatch({ ...draftForTask(masked), notes: "Note modifiée" }, masked), { notes: "Note modifiée" });
});

test("a recovered task manager gains management only as an active explicit participant with current contribution", () => {
  const source = task({ createdBy: null, createdAt: null, createdByLabel: "Auteur historique non confirmé", managerId: "manager-fictional", managerLabel: "Gestionnaire fictif", managerActive: true, assignees: [{ userId: "manager-fictional", label: "Gestionnaire fictif", access: "contribute", active: true }, { userId: "responsible-fictional", label: "Responsable fictif", access: "contribute", active: true }] });
  assert.deepEqual(taskCapabilities(source, "manager-fictional", permissions), { read: true, fields: true, progress: true, delete: true });
  assert.deepEqual(taskCapabilities(source, "manager-fictional", { ...permissions, delete: false }), { read: true, fields: true, progress: true, delete: false });
  assert.deepEqual(taskCapabilities(source, "manager-fictional", { ...permissions, contribute: false }), { read: true, fields: false, progress: false, delete: false });
  assert.deepEqual(taskCapabilities(source, "responsible-fictional", permissions), { read: true, fields: false, progress: true, delete: false });
  assert.deepEqual(taskCapabilities(source, "full-third-fictional", permissions), { read: false, fields: false, progress: false, delete: false });
  const patch = buildTaskPatch({ ...draftForTask(source), dueDate: "2026-12-10", priority: "urgent" }, source, taskCapabilities(source, "manager-fictional", permissions).fields);
  assert.deepEqual(patch, { dueDate: "2026-12-10", priority: "urgent" });
  assert.equal(source.createdBy, null); assert.equal(source.createdAt, null);
  assert.match(taskManagementLabel(source), /Gestionnaire : Gestionnaire fictif/);
});

test("an inactive or missing manager never causes implicit reassignment or changes the historical author", () => {
  const source = task({ createdBy: null, createdAt: null, managerId: "manager-fictional", managerLabel: "Gestionnaire fictif", managerActive: false, assignees: [{ userId: "manager-fictional", label: "Gestionnaire fictif", access: "contribute", active: true }] });
  assert.equal(taskCapabilities(source, "manager-fictional", permissions).fields, false);
  assert.equal(taskCapabilities(source, "manager-fictional", permissions).delete, false);
  assert.match(taskManagementLabel(source), /accès de gestion inactif/);
  const withoutAssignment = { ...source, managerActive: true, assignees: [] };
  assert.equal(taskCapabilities(withoutAssignment, "manager-fictional", permissions).read, false);
  assert.equal(taskCapabilities(withoutAssignment, "manager-fictional", permissions).fields, false);
  assert.match(taskManagementLabel({ ...source, managerId: null }), /Gestion non désignée/);
  assert.equal(source.managerId, "manager-fictional"); assert.equal(source.createdBy, null); assert.equal(source.createdAt, null);
});

test("known creators retain their original rules and a stray manager field grants no extra authority", () => {
  const source = task({ managerId: "manager-fictional", managerActive: true, assignees: [{ userId: "manager-fictional", label: "Responsable fictif", access: "contribute", active: true }] });
  assert.equal(taskCapabilities(source, "creator-fictional", permissions).fields, true);
  assert.equal(taskCapabilities(source, "creator-fictional", permissions).delete, true);
  assert.equal(taskCapabilities(source, "manager-fictional", permissions).fields, false);
  assert.equal(taskCapabilities(source, "manager-fictional", permissions).delete, false);
  assert.equal(taskManagementLabel(source), "");
});
