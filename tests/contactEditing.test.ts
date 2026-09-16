import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { getContactFormUpdate, mergeContactUpdate, readPostalAddress } from "../lib/contactEditing";
import { fictionalContact, fictionalAccount } from "./fixtures/vendorBanking";
import { isEligibleVendorContact } from "../lib/vendorContacts";
import type { Contact } from "../lib/types";

const address = "12 avenue Exemple\nBâtiment B, chez l’amie Élodie\n06400 Cannes\nFrance";
const source = readFileSync("components/CRMApp.tsx", "utf8");
// Exercise the actual handlers without mounting the CRM or connecting services.
function handler(name: string, bindings: Record<string, unknown> = {}) {
  const ast = ts.createSourceFile("CRMApp.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(declaration, name);
  const js = ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return ${name};`)(...Object.values(bindings));
}

for (const kind of ["Client", "Prestataire", "Propriétaire"] as const) {
  for (const postalAddress of [address, ""]) {
    test(`création réelle du handler : ${kind}, adresse ${postalAddress ? "multiligne" : "absente"}`, () => {
      const form = new FormData(); form.set("kind", kind); form.set("name", "Contact Fictif");
      if (postalAddress) form.set("postalAddress", postalAddress);
      let state = { contacts: [] as Contact[] };
      const add = handler("addContact", {
        FormData: class { constructor() { return form; } }, readPostalAddress,
        makeId: () => "contact-test", stampCreated: (c: Contact) => c, activeActor: "Test",
        safeNumber: (v: unknown) => Number(v) || 0, getSupplierCategoryFromForm: () => "Entretien",
        confirmDuplicateContact: () => true, setData: (fn: (s: typeof state) => typeof state) => { state = fn(state); },
        notify: () => {}, window: { setTimeout: () => {} }
      });
      add({ preventDefault() {}, currentTarget: { reset() {} } });
      assert.equal(state.contacts[0].postalAddress, postalAddress);
      assert.equal(state.contacts[0].kind, kind);
    });
  }
}

test("champ absent préservé, effacement explicite, adresse étrangère et ancienne fiche", () => {
  const form = new FormData();
  assert.equal(readPostalAddress(form, address), address);
  assert.equal(readPostalAddress(form), "");
  form.set("postalAddress", ""); assert.equal(readPostalAddress(form, address), "");
  const foreign = "  7 Fictional Straße\nWohnung É\nSW1A 0ZZ London\n日本 — 東京  ";
  form.set("postalAddress", foreign); assert.equal(readPostalAddress(form), foreign);
  assert.equal(mergeContactUpdate(fictionalContact, { notes: "Autre note" }).postalAddress, "");
});

test("modification réelle : RIB, identité, propriétés et liens conservés, traçabilité habituelle", () => {
  const original = { ...fictionalContact, postalAddress: address, supplierZone: "Zone fictive", budget: 999,
    preferences: "Préférences historiques", importantNotes: "À conserver", unknownProperty: { quoteId: "q-fictif" },
    supplierBankAccounts: [fictionalAccount, { ...fictionalAccount, id: "archive", status: "Archivé" as const, isPrimary: false }] };
  const invoice = { contactId: original.id, paymentBankAccountId: fictionalAccount.id };
  let state = { contacts: [original], invoices: [invoice], quotes: [{ contactId: original.id }] };
  const initial = structuredClone(state);
  const update = handler("updateContact", { mergeContactUpdate, activeActor: "Test",
    stampUpdated: (c: Contact, actor: string) => ({ ...c, updatedBy: actor, updatedAt: "test-time" }),
    setData: (fn: (s: typeof state) => typeof state) => { state = fn(state); }, notify: () => {} });
  update({ id: original.id, postalAddress: "新しい住所\nÉtage 2" });
  assert.deepEqual(state.contacts[0], { ...original, postalAddress: "新しい住所\nÉtage 2", updatedBy: "Test", updatedAt: "test-time" });
  assert.deepEqual(state.invoices, initial.invoices); assert.deepEqual(state.quotes, initial.quotes);
  update({ id: original.id, notes: "Notes modifiées" });
  assert.equal(state.contacts[0].postalAddress, "新しい住所\nÉtage 2");
  update({ id: original.id, postalAddress: undefined });
  assert.equal(state.contacts[0].postalAddress, "新しい住所\nÉtage 2");
  update({ id: original.id, postalAddress: "" }); assert.equal(state.contacts[0].postalAddress, "");
});

test("seuls les champs modifiés sont transmis, même si le formulaire propose des valeurs par défaut", () => {
  const proposed = { ...fictionalContact, budget: 0, supplierZone: "", preferences: "", postalAddress: address };
  assert.deepEqual(getContactFormUpdate(proposed, ["postalAddress"]), { postalAddress: address });
  assert.deepEqual(getContactFormUpdate(proposed, []), {});
  assert.deepEqual(getContactFormUpdate({ ...proposed, supplierCategory: "Entretien" }, ["supplierCategoryCustom"]), { supplierCategory: "Entretien" });
  assert.deepEqual(getContactFormUpdate({ ...proposed, kind: "Prestataire", relationshipStatus: "Prestataire" }, ["kind"]), { kind: "Prestataire", relationshipStatus: "Prestataire" });
});

test("recherche existante par rue et code postal, conversion historique sans altération", () => {
  const match = handler("searchMatch");
  for (const query of ["avenue Exemple", "06400", "bâtiment"]) assert.equal(match(query, [address]), true);
  const toRow = handler("contactToSupabaseRow");
  const fromRow = handler("contactFromSupabaseRow");
  assert.equal(fromRow(toRow({ ...fictionalContact, postalAddress: address }, "user-test")).postalAddress, address);
  assert.match(source, /contact\.city, contact\.postalAddress \?\? ""/);
});

for (const nextKind of ["Client", "Propriétaire"] as const) {
  test(`changement de type Prestataire → ${nextKind} : classification corrigée, autres champs conservés`, () => {
    const original: Contact = {
      ...fictionalContact, postalAddress: address, supplierCategory: "Entretien",
      relationshipStatus: "Prestataire", supplierZone: "Zone fictive conservée",
      supplierStatus: "Actif", supplierReliability: "Très fiable",
      supplierPriceNotes: "Notes prix fictives", supplierCommissionNotes: "Marge fictive",
      importantNotes: "À conserver"
    };
    // These are the values produced by ContactsView.submitEdit after changing type.
    const proposed: Contact = {
      ...original, kind: nextKind, relationshipStatus: "Prospect", supplierCategory: ""
    };
    const update = getContactFormUpdate(proposed, ["kind"]);
    assert.deepEqual(update, { kind: nextKind, relationshipStatus: "Prospect", supplierCategory: "" });
    const result = mergeContactUpdate(original, update);
    assert.equal(handler("isSupplierContact")(result), false);
    // Existing invoice eligibility deliberately includes owners; keep that rule.
    assert.equal(isEligibleVendorContact(result), nextKind === "Propriétaire");
    assert.deepEqual(result, { ...original, kind: nextKind, relationshipStatus: "Prospect", supplierCategory: "" });
    // An address-only edit must continue preserving the original supplier category.
    const addressOnly = mergeContactUpdate(original,
      getContactFormUpdate({ ...proposed, postalAddress: "Nouvelle adresse fictive" }, ["postalAddress"]));
    assert.deepEqual(addressOnly, { ...original, postalAddress: "Nouvelle adresse fictive" });
    assert.equal(handler("isSupplierContact")(addressOnly), true);
    assert.equal(isEligibleVendorContact(addressOnly), true);
    assert.deepEqual(mergeContactUpdate(original, { notes: "Note modifiée" }), { ...original, notes: "Note modifiée" });
    assert.deepEqual(mergeContactUpdate(result, { postalAddress: "" }), { ...result, postalAddress: "" });
  });
}
