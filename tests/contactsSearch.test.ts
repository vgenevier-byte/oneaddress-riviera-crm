import test from "node:test";
import assert from "node:assert/strict";
import { matchesContactSearch, matchesContactSearchFields, normalizeContactSearch } from "../lib/contactSearch";
import { matchesTaskContact, taskContactLabel, taskContactOptions } from "../lib/tasks/contactOptions";
import type { Contact } from "../lib/types";

const clement: Contact = {
  id: "contact-clement-fictional",
  firstName: "Clément",
  name: "Minodier",
  companyName: "Société Àzur Services",
  kind: "Client",
  email: "clement.fixture@example.invalid",
  phone: "06 42 00 00 01",
  city: "Nice",
  postalAddress: "12 avenue Fictive\nBâtiment B\n06400 Cannes",
  budget: 0,
  source: "Source privée fictive",
  notes: "Note privée fictive",
  createdAt: "2026-01-01T00:00:00.000Z",
};

test("the Contacts directory accepts all requested fictional Clement searches", () => {
  for (const query of [
    "clement", "CLÉMENT", "clem", "minodier", "clement minodier",
    "minodier clement", "  clement   minodier  ", "MINO\tCLEm\n",
  ]) {
    assert.equal(matchesContactSearch(clement, query), true, query);
  }
  for (const query of ["clement dupont", "minodier vincent", "unrelated"]) {
    assert.equal(matchesContactSearch(clement, query), false, query);
  }
});

test("normalization ignores composed and decomposed accents and all Unicode mark ranges", () => {
  for (const value of ["Clément", "Cle\u0301ment", "CLe\u1AB0ment", "CLe\u1DC0ment", "CLe\uFE20ment", "ＣＬÉＭＥＮＴ"]) {
    assert.equal(normalizeContactSearch(value), "clement", value);
    assert.equal(matchesContactSearch(clement, value), true, value);
    assert.equal(matchesContactSearch({ ...clement, firstName: value }, "clement"), true, value);
  }
  assert.equal(normalizeContactSearch("  Société\t Àzur\nServices\u00A0  "), "societe azur services");
});

test("name and company terms share one searchable haystack in any order", () => {
  for (const query of ["azur", "societe", "services", "azur clement", "minodier services", "SERVI clem SOCI", "Minodier Azur Clément"]) {
    assert.equal(matchesContactSearch(clement, query), true, query);
  }
  assert.equal(matchesContactSearch(clement, "azur clement absent"), false, "Every term must match");
  assert.equal(matchesContactSearch(clement, "societe fictive"), true, "Existing address and company fields can share the search");
});

test("compound names retain punctuation while fragments and reordered words match", () => {
  const compound: Contact = { ...clement, firstName: "Anne-Marie", name: "De La Résidence", email: "compound@example.invalid" };
  for (const query of ["anne", "marie", "resid", "RESIDENCE Anne", "la marie de", "de la residence", "Anne-Marie"]) {
    assert.equal(matchesContactSearch(compound, query), true, query);
  }
  assert.equal(matchesContactSearch(compound, "anne martin"), false);
  assert.equal(matchesContactSearch(compound, "annemarie"), false, "No unrequested punctuation or phonetic transformation");
});

test("authorized projections may omit fields or contain null without invented matches", () => {
  const sparse = { id: "sparse-fictional", firstName: "Élodie" } as Contact;
  const missing = { id: "empty-fictional", firstName: null, name: undefined, companyName: "  " } as unknown as Contact;
  assert.equal(matchesContactSearch(sparse, "elo"), true);
  assert.equal(matchesContactSearch(sparse, "azur"), false);
  for (const query of ["", "  \t\n", "\u00A0\u2003"]) {
    assert.equal(matchesContactSearch(sparse, query), true);
    assert.equal(matchesContactSearch(missing, query), true);
  }
  for (const query of ["null", "undefined", "contact", "empty-fictional"]) {
    assert.equal(matchesContactSearch(missing, query), false, query);
  }
  assert.equal(matchesContactSearchFields("elodie", [null, undefined, "   ", "Élodie"]), true);
  assert.equal(matchesContactSearchFields("null", [null, undefined, "   "]), false);
});

test("all formerly searchable Contacts fields keep their existing partial search", () => {
  const existing: Contact = {
    ...clement,
    kind: "Prestataire",
    organizationFunction: "Chargé de coordination",
    supplierCategory: "Électricité",
    supplierZone: "Côte fictive",
    supplierReliability: "Très fiable",
  };
  for (const [field, query] of [
    ["email", "FIXTURE@EXAMPLE.INVALID"], ["phone", "06 42"],
    ["city", "NIC"], ["postalAddress", "avenue fictive"], ["postalAddress", "06400"],
    ["postalAddress", "batiment"], ["kind", "prestataire"],
    ["organizationFunction", "coordination charge"], ["supplierCategory", "electricite"],
    ["supplierZone", "cote"], ["supplierReliability", "fiable tres"],
  ] as const) {
    assert.equal(matchesContactSearch(existing, query), true, `${field}: ${query}`);
  }
  assert.equal(matchesContactSearch(existing, "coordination 06400 clem"), true);
  assert.equal(matchesContactSearch(existing, "coordination 06400 absent"), false);
  assert.equal(matchesContactSearch({ ...existing, kind: "Membre de l’organisation" }, "organisation membre"), true);
});

test("search fields stay explicitly bounded to the caller's authorized contact projection", () => {
  const excluded = {
    id: "identifier-secret-fictional",
    notes: "notes-secret-fictional",
    importantNotes: "important-secret-fictional",
    preferences: "preferences-secret-fictional",
    source: "source-secret-fictional",
    createdBy: "creator-secret-fictional",
    supplierContactName: "supplier-person-secret-fictional",
    supplierPriceNotes: "price-secret-fictional",
    supplierCommissionNotes: "commission-secret-fictional",
    supplierBankAccounts: [{ iban: "banking-secret-fictional", driveFileName: "rib-secret-fictional" }],
    documents: [{ title: "document-secret-fictional" }],
    contactId: "linked-secret-fictional",
    ownerId: "owner-secret-fictional",
  };
  const projected = { firstName: "Clément", name: "Minodier", ...excluded } as unknown as Contact;
  for (const query of [
    "identifier-secret", "notes-secret", "important-secret", "preferences-secret",
    "source-secret", "creator-secret", "supplier-person-secret", "price-secret",
    "commission-secret", "banking-secret", "rib-secret", "document-secret", "linked-secret", "owner-secret",
  ]) {
    assert.equal(matchesContactSearch(projected, query), false, query);
  }
  assert.equal(matchesContactSearch(projected, "clement minodier"), true);
  assert.equal(matchesContactSearch(projected, "azur"), false, "Missing fields are never completed from another record");
});

test("field matching uses conjunction across all tokens and normalizes both sides", () => {
  const fields = ["  Cle\u0301ment  ", "MiNoDiEr", "\tSociété\u00A0Àzur   Services "];
  for (const query of ["  MINODIER\nCLEMent azur ", "services societe clem", ""]) {
    assert.equal(matchesContactSearchFields(query, fields), true, query);
  }
  assert.equal(matchesContactSearchFields("azur unknown clement", fields), false);
  assert.equal(matchesContactSearchFields("", []), true);
  assert.equal(matchesContactSearchFields("clement", []), false);
  assert.equal(matchesContactSearch({ ...clement, firstName: "Clément", name: "Minodier", email: "fiction@example.invalid" }, "klement"), false, "No phonetic search");
});

test("search only compares values and leaves spelling, whitespace, IDs and hidden values intact", () => {
  const original = { ...clement, firstName: " Cle\u0301ment ", name: " Minodier ", companyName: " Société Àzur " };
  const snapshot = structuredClone(original);
  Object.freeze(original);
  for (const query of ["clement", "minodier clement", "AZUR", "", "unknown"]) matchesContactSearch(original, query);
  assert.deepEqual(original, snapshot);
  assert.equal(original.firstName, " Cle\u0301ment ");
  assert.equal(original.name, " Minodier ");
  assert.equal(original.id, "contact-clement-fictional");
});

test("task linked-contact search still uses first name, surname and authorized company together", () => {
  const projected = taskContactOptions([clement]);
  assert.equal(projected.length, 1);
  const option = Object.freeze(projected[0]);
  const before = structuredClone(option);
  for (const query of ["clement", "CLÉMENT", "clem", "minodier", "clement minodier", "minodier clement", "  clement   minodier  ", "azur minodier", "services clement", "Cle\u0301ment", "CLe\u1AB0ment"]) {
    assert.equal(matchesTaskContact(option, query), true, query);
  }
  assert.equal(matchesTaskContact(option, "azur dupont"), false);
  assert.equal(matchesTaskContact(option, "fixture@example.invalid"), false, "Task name search keeps its original field boundary");
  assert.equal(taskContactLabel(option), "Clément Minodier");
  assert.deepEqual(option, before);
});
