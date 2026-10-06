import test from "node:test";
import assert from "node:assert/strict";
import { mergeDocumentTrashCompletion } from "../lib/documentTrashClient";
import { WorkspaceSyncGuard } from "../lib/access/workspaceSync";

const target = { id: "target-doc", title: "Homonyme", driveFileId: "drive-one", folderId: "folder-one" };
const other = { id: "other-doc", title: "Homonyme", driveFileId: "drive-two", folderId: "folder-two" };
const base = { documents: [target, other], contacts: [{ id: "contact", name: "Fictif", notes: "" }], tasks: [] as { id: string; title: string }[] };

test("confirmed trash accepts concurrent server data and removes only the exact CRM target", () => {
  const server = { ...base, documents: [other], contacts: [{ ...base.contacts[0], name: "Cloud concurrent" }] };
  const result = mergeDocumentTrashCompletion(base, base, server, target.id);
  assert.deepEqual(result.data, server);
  assert.equal(result.conflicted, false);
  assert.equal(base.documents.length, 2);
});

test("a local edit during trash is rebased field by field onto concurrent cloud changes", () => {
  const local = { ...base, contacts: [{ ...base.contacts[0], notes: "Brouillon local" }], tasks: [{ id: "new-task", title: "Saisie conservée" }] };
  const server = { ...base, documents: [other], contacts: [{ ...base.contacts[0], name: "Cloud concurrent" }] };
  const result = mergeDocumentTrashCompletion(base, local, server, target.id);
  assert.deepEqual(result.data.contacts, [{ id: "contact", name: "Cloud concurrent", notes: "Brouillon local" }]);
  assert.deepEqual(result.data.tasks, local.tasks);
  assert.deepEqual(result.data.documents, [other]);
  assert.equal(result.conflicted, false);
  const sync = new WorkspaceSyncGuard();
  sync.load(server, "confirmed-revision");
  assert.equal(sync.dirty(result.data), true, "Only the rebased local edit still needs saving");
});

test("same-field concurrency keeps the local draft and blocks autosave", () => {
  const local = { ...base, contacts: [{ ...base.contacts[0], notes: "Brouillon local" }] };
  const server = { ...base, documents: [other], contacts: [{ ...base.contacts[0], notes: "Cloud concurrent" }] };
  const result = mergeDocumentTrashCompletion(base, local, server, target.id);
  assert.equal(result.data.contacts[0].notes, "Brouillon local");
  assert.equal(result.conflicted, true);
  const sync = new WorkspaceSyncGuard();
  sync.load(server, "confirmed-revision");
  if (result.conflicted) sync.conflict();
  assert.equal(sync.prepare(result.data), null);
});

test("a local draft of the trashed document never resurrects it", () => {
  const local = { ...base, documents: [{ ...target, title: "Saisie locale" }, other] };
  const server = { ...base, documents: [other] };
  const result = mergeDocumentTrashCompletion(base, local, server, target.id);
  assert.deepEqual(result.data.documents, [other]);
  assert.equal(result.conflicted, true);
});

test("unrelated concurrent insertion and local deletion both survive completion", () => {
  const local = { ...base, documents: [target], tasks: [{ id: "local", title: "Local" }] };
  const added = { id: "cloud-doc", title: "Concurrent", driveFileId: "cloud-drive", folderId: "folder-two" };
  const server = { ...base, documents: [other, added], tasks: [{ id: "cloud", title: "Cloud" }] };
  const result = mergeDocumentTrashCompletion(base, local, server, target.id);
  assert.deepEqual(result.data.documents, [added]);
  assert.deepEqual(result.data.tasks.map(row => row.id), ["cloud", "local"]);
  assert.equal(result.conflicted, false);
});
