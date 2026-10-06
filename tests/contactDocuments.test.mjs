import test from "node:test";
import assert from "node:assert/strict";
import { sendContactDocument, validateContactDocumentFile, contactDocumentError, ContactDocumentReadSequence } from "../lib/contactDocuments.ts";
const file = () => new File(["fictional-contact-document"], "identical.pdf", { type: "application/pdf" });
const draft = (operationId = "operation-one") => ({ operationId, contactId: "fictional-contact", file: file(), title: "Pièce fictive", type: "Passeport", expiry: "" });
function server() {
    const rows = new Map();
    const objects = new Set();
    const calls = [];
    let uploads = 0, completeLost = false, uploadFailed = false, conflict = false;
    const transport = { check: async () => { }, rpc: async (name, args) => {
            calls.push({ name, args });
            if (name === "crm_contact_document_begin") {
                const id = String(args.p_operation);
                let row = rows.get(id);
                if (!row) {
                    if (conflict)
                        return { data: null, error: { message: "revision_conflict" } };
                    row = { provider: "storage", resource_id: "classified/" + id, record_id: String(args.p_contact), lifecycle: "pending" };
                    rows.set(id, row);
                }
                return { data: { ...row }, error: null };
            }
            if (name === "crm_contact_document_complete") {
                const row = rows.get(String(args.p_operation));
                assert.ok(objects.has(row.resource_id));
                row.lifecycle = "active";
                if (completeLost) {
                    completeLost = false;
                    throw new Error("Network interruption after server commit");
                }
                return { data: { ...row }, error: null };
            }
            if (name === "crm_contact_document_replace")
                return { data: null, error: { message: "revision_conflict" } };
            throw Error("Unexpected RPC " + name);
        }, upload: async (path) => { uploads++; if (uploadFailed) {
            uploadFailed = false;
            return { data: null, error: { message: "Network failed" } };
        } if (objects.has(path))
            return { data: null, error: { message: "The resource already exists", statusCode: "409", error: "Duplicate" } }; objects.add(path); return { data: { path }, error: null }; } };
    return { transport, rows, objects, calls, get uploads() { return uploads; }, loseConfirmation() { completeLost = true; }, failUpload() { uploadFailed = true; }, conflict() { conflict = true; } };
}
test("two identical names reserve two UUID paths and never update the Contact record", async () => {
    const fake = server();
    const first = await sendContactDocument(fake.transport, draft("uuid-one"), "revision");
    const second = await sendContactDocument(fake.transport, draft("uuid-two"), "revision");
    assert.notEqual(first.resource_id, second.resource_id);
    assert.equal(fake.objects.size, 2);
    assert.ok(fake.calls.every(call => !call.name.includes("mutate_record")));
    assert.ok(fake.calls.filter(call => call.name === "crm_contact_document_begin").every(call => !Object.hasOwn(call.args, "p_bank")));
});
test("a lost confirmation retries the same operation without duplicating its confirmed binary", async () => {
    const fake = server();
    const item = draft();
    fake.loseConfirmation();
    await assert.rejects(() => sendContactDocument(fake.transport, item, "before"), /Network/);
    const confirmed = await sendContactDocument(fake.transport, item, "after");
    assert.equal(confirmed.lifecycle, "active");
    assert.equal(fake.uploads, 1);
    assert.equal(fake.rows.size, 1);
});
test("a failed upload retries the same pending path; existing-object recovery needs server confirmation", async () => {
    const fake = server();
    const item = draft();
    fake.failUpload();
    await assert.rejects(() => sendContactDocument(fake.transport, item, "revision"), /Network/);
    fake.objects.add("classified/" + item.operationId);
    const confirmed = await sendContactDocument(fake.transport, item, "revision");
    assert.equal(confirmed.lifecycle, "active");
    assert.equal(fake.rows.size, 1);
    assert.equal(fake.uploads, 2);
});
test("an explicit replacement uses the original revision and leaves its conflict visible", async () => {
    const fake = server();
    const item = { ...draft(), previous: { resource_id: "classified/older", revision: 8 } };
    await assert.rejects(() => sendContactDocument(fake.transport, item, "catalogue"), /revision_conflict/);
    assert.deepEqual(fake.calls.at(-1), { name: "crm_contact_document_replace", args: { p_previous: "classified/older", p_next: "classified/operation-one", p_revision: 8 } });
    assert.match(contactDocumentError(new Error("revision_conflict")), /vos fichiers restent sélectionnés/);
});
test("cancellation after the upload admits no late complete or replacement", async () => {
    const fake = server(), controller = new AbortController();
    const original = fake.transport.upload;
    fake.transport.upload = async (path, value) => { const result = await original(path, value); controller.abort(); return result; };
    await assert.rejects(() => sendContactDocument(fake.transport, draft(), "revision", controller.signal), { name: "AbortError" });
    assert.equal(fake.calls.filter(call => call.name === "crm_contact_document_complete").length, 0);
    assert.equal(fake.rows.get("operation-one")?.lifecycle, "pending");
});
test("account or rights invalidation halts before metadata reservation", async () => {
    const fake = server();
    fake.transport.check = async () => { throw new DOMException("Compte changé", "AbortError"); };
    await assert.rejects(() => sendContactDocument(fake.transport, draft(), "revision"), { name: "AbortError" });
    assert.equal(fake.calls.length, 0);
});
test("size and format limits are enforced before an API or binary request", async () => {
    assert.ok(validateContactDocumentFile({ size: 0, type: "application/pdf" }));
    assert.ok(validateContactDocumentFile({ size: 25_000_001, type: "application/pdf" }));
    assert.ok(validateContactDocumentFile({ size: 100, type: "text/html" }));
    assert.equal(validateContactDocumentFile({ size: 25_000_000, type: "image/png" }), null);
    const fake = server();
    await assert.rejects(() => sendContactDocument(fake.transport, { ...draft(), file: new File(["bad"], "bad.html", { type: "text/html" }) }, "revision"), /PDF/);
    assert.equal(fake.calls.length, 0);
});
test("a rejected file never locks its draft and remains locally removable without server cancellation", async () => {
    const fake = server();
    const item = { ...draft(), file: new File(["bad"], "bad.html", { type: "text/html" }), locked: false };
    fake.transport.onReserved = () => { item.locked = true; };
    await assert.rejects(() => sendContactDocument(fake.transport, item, "revision"), /PDF/);
    assert.equal(item.locked, false);
    assert.equal(fake.calls.length, 0);
    assert.deepEqual([item].filter(row => row.operationId !== item.operationId), []);
});
test("reservation conflicts keep a new draft editable while a confirmed reservation locks it", async () => {
    const rejected = server();
    rejected.conflict();
    let locked = false;
    rejected.transport.onReserved = () => { locked = true; };
    await assert.rejects(() => sendContactDocument(rejected.transport, draft(), "stale"), /revision_conflict/);
    assert.equal(locked, false);
    assert.equal(rejected.uploads, 0);
    const admitted = server();
    admitted.failUpload();
    admitted.transport.onReserved = () => { locked = true; };
    await assert.rejects(() => sendContactDocument(admitted.transport, draft(), "revision"), /Network/);
    assert.equal(locked, true);
});
test("a late read cannot restore metadata removed by a newer read or an account lifetime change", async () => {
    const reads = new ContactDocumentReadSequence();
    let visible = ["private document"], revision = "old";
    const slow = reads.start();
    const fresh = reads.start();
    const accept = (request, documents, nextRevision) => {
        if (reads.current(request)) { visible = documents; revision = nextRevision; }
    };
    accept(fresh, [], "revoked");
    accept(slow, ["private document"], "old");
    assert.deepEqual(visible, []);
    assert.equal(revision, "revoked");
    const previousAccount = reads.start();
    reads.invalidate();
    accept(previousAccount, ["other account file"], "wrong-account");
    assert.deepEqual(visible, []);
    assert.equal(revision, "revoked");
});
