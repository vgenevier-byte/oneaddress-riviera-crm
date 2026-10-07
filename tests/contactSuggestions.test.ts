import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { matchesContactSearch } from "../lib/contactSearch";
import { createContactSearchIndex, searchContactSuggestions, searchDirectContacts } from "../lib/contactSuggestions";
import type { Contact } from "../lib/types";

const dylan: Contact = {
  id: "dylan-charmillon-fictional",
  firstName: "Dylan",
  name: "Charmillon",
  companyName: "Nettoyage Dylan Charmillon",
  kind: "Prestataire",
  email: "dylan@example.invalid",
  phone: "06 42 00 00 01",
  city: "Nice",
  postalAddress: "12 avenue Fictive\nBâtiment B\n06400 Cannes",
  organizationFunction: "Chargé de coordination",
  supplierCategory: "Nettoyage",
  supplierZone: "Côte fictive",
  supplierReliability: "Très fiable",
  budget: 0,
  source: "Source fictive",
  notes: "Note fictive",
  createdAt: "2026-01-01T00:00:00.000Z",
};
const ids = (contacts: readonly { id: string }[]) => contacts.map(contact => contact.id);

test("Dylan Charmillon direct fragments stay direct; requested typos appear only as close suggestions", () => {
  const index = createContactSearchIndex([dylan]);
  for (const query of ["char", "charmillon", "dylan", "nettoyage", "DYLAN CHARMILLON", "  char   DYLAN  "]) {
    assert.deepEqual(ids(searchContactSuggestions(index, query).direct), [dylan.id], query);
    assert.deepEqual(searchContactSuggestions(index, query).close, [], query);
  }
  for (const query of ["Chamillon", "charmilon", "chramillon", "cham", "dylan chamillon", "CHAMILLoN DYLAN", "nettoyage chamillon", "dlyan chamillon"]) {
    const result = searchContactSuggestions(index, query);
    assert.deepEqual(result.direct, [], query);
    assert.deepEqual(ids(result.close), [dylan.id], query);
    assert.equal(result.close[0], dylan, "Suggestion returns the recorded contact, with no replacement values");
  }
});

test("indexed direct search exactly preserves the established authorized field matcher", () => {
  const contacts = [dylan, { ...dylan, id: "clement-fictional", firstName: "Clément", name: "Minodier", companyName: "Société Àzur" }];
  const index = createContactSearchIndex(contacts);
  for (const query of [
    "", " \t\n ", "clement", "CLÉMENT", "Cle\u0301ment", "CLe\u1AB0ment", "ＣＬÉＭＥＮＴ", "minodier clement",
    "  clement   minodier  ", "azur clement", "FIXTURE", "dylan@example.invalid", "06 42", "NIC", "06400",
    "EXEMPLE avenue", "avenue fictive", "batiment", "prestataire", "coordination charge", "nettoyage",
    "cote", "fiable tres", "coordination 06400", "identifier-secret", "notes", "banking", "unrelated",
  ]) {
    const expected = contacts.filter(contact => matchesContactSearch(contact, query));
    assert.deepEqual(searchDirectContacts(index, query), expected, query);
    assert.deepEqual(searchContactSuggestions(index, query).direct, expected, query);
  }
});

test("insertions, deletions, substitutions and adjacent transpositions are bounded to names and companies", () => {
  const index = createContactSearchIndex([dylan]);
  for (const query of ["charxmillon", "chamillon", "charpillon", "chramillon", "dlyan", "nettoyaqe"]) {
    assert.deepEqual(ids(searchContactSuggestions(index, query).close), [dylan.id], query);
  }
  for (const query of ["karmiyon", "sharmiyon", "zzarmillon", "totallyunrelated"]) {
    assert.deepEqual(searchContactSuggestions(index, query), { direct: [], close: [] }, query);
  }
});

test("short query and stored words never receive approximate matching", () => {
  const index = createContactSearchIndex([{ id: "jan-fictional", firstName: "Jan", name: "Pau" }]);
  for (const query of ["Jean", "Paau", "Jna", "pua"]) {
    assert.deepEqual(searchContactSuggestions(index, query), { direct: [], close: [] }, query);
  }
  assert.deepEqual(ids(searchContactSuggestions(index, "ja").direct), ["jan-fictional"]);
  assert.deepEqual(searchContactSuggestions(createContactSearchIndex([dylan]), "dln"), { direct: [], close: [] });
});

test("a fragment may approximate only a word's beginning, with at most one edit", () => {
  const index = createContactSearchIndex([dylan]);
  assert.deepEqual(ids(searchContactSuggestions(index, "cham").close), [dylan.id]);
  assert.deepEqual(ids(searchContactSuggestions(index, "charmillx").close), [dylan.id], "One-edit longer prefix");
  for (const query of ["zzam", "mllon", "charmxly"]) {
    assert.deepEqual(searchContactSuggestions(index, query), { direct: [], close: [] }, query);
  }
  assert.deepEqual(ids(searchContactSuggestions(index, "mill").direct), [dylan.id], "Existing exact interior fragments stay direct");
});

test("two-edit whole words require a long stored word, two exact starting letters and at most twenty percent error", () => {
  const long = createContactSearchIndex([{ id: "long-fictional", name: "Charmillon" }]);
  for (const query of ["charmilxox", "chamllon"]) {
    assert.deepEqual(ids(searchContactSuggestions(long, query).close), ["long-fictional"], query);
  }
  for (const query of ["qharmillox", "cgarmillox", "charmixlxy"]) {
    assert.deepEqual(searchContactSuggestions(long, query), { direct: [], close: [] }, query);
  }
  const medium = createContactSearchIndex([{ id: "medium-fictional", name: "Minodiers" }]);
  assert.deepEqual(searchContactSuggestions(medium, "minodiqrx"), { direct: [], close: [] }, "Nine-letter stored word permits only one edit");
});

test("every query term must match the same contact and the total correction budget never exceeds two", () => {
  const index = createContactSearchIndex([dylan]);
  for (const query of ["dlyan chamillon", "chamillon dlyan", "dylan charmilxox", "charmilxox charmilxox", "  DYLAN\t CHAMILLoN  chamillon  "]) {
    assert.deepEqual(ids(searchContactSuggestions(index, query).close), [dylan.id], query);
  }
  for (const query of ["dlyan chamillon nettoyaqe", "dlyan charmilxox", "dylan chamillon unrelated", "chamillon absent"]) {
    assert.deepEqual(searchContactSuggestions(index, query), { direct: [], close: [] }, query);
  }
  const separate = createContactSearchIndex([
    { id: "dylan-only-fictional", firstName: "Dylan", name: "Minodier" },
    { id: "charmillon-only-fictional", firstName: "Alex", name: "Charmillon" },
  ]);
  assert.deepEqual(searchContactSuggestions(separate, "dylan chamillon"), { direct: [], close: [] }, "Terms cannot be combined across two contacts");
});

test("compound-name typos split only letter components separated by name punctuation", () => {
  const compound = createContactSearchIndex([{ id: "compound-fictional", firstName: "Anne-Marie", name: "D’Artagnan" }]);
  for (const query of ["Anne-Mraie", "Anne-Mraie Artagnan", "Anne-Mraie d’artangan", "d'artangan"]) {
    assert.deepEqual(ids(searchContactSuggestions(compound, query).close), ["compound-fictional"], query);
  }
  assert.deepEqual(ids(searchContactSuggestions(compound, "Anne-Marie").direct), ["compound-fictional"]);
  for (const query of ["anne-mraie@example.invalid", "anne/mraie", "anne.mraie", "anne--mraie", "anne-mraie-42", "https://anne-mraie.invalid"]) {
    assert.deepEqual(searchContactSuggestions(compound, query), { direct: [], close: [] }, query);
  }
});

test("email, telephone, URLs and punctuation retain literal direct matching without fuzzy corrections", () => {
  const index = createContactSearchIndex([dylan]);
  for (const query of ["dylan@example.invalie", "dlyan@example.invalid", "06 42 00 00 02", "dlyan@", "cham.illon", "cham/illon", "chamillon42", "https://chamillon.invalid"]) {
    assert.deepEqual(searchContactSuggestions(index, query), { direct: [], close: [] }, query);
  }
  for (const query of ["dylan@example.invalid", "06 42 00 00 01"]) {
    assert.deepEqual(ids(searchContactSuggestions(index, query).direct), [dylan.id], query);
  }
  for (const query of ["chamillon dylan@example.invalid", "chamillon 06 42 00 00 01"]) {
    assert.deepEqual(ids(searchContactSuggestions(index, query).close), [dylan.id], "Only the name is approximate; the coordinate must match literally");
  }
  for (const query of ["chamillon dylan@example.invalie", "chamillon 06 42 00 00 02"]) {
    assert.deepEqual(searchContactSuggestions(index, query), { direct: [], close: [] }, query);
  }
  const emailOnly = createContactSearchIndex([{ id: "email-only-fictional", email: "charmillon@example.invalid", city: "Charmillon" }]);
  assert.deepEqual(searchContactSuggestions(emailOnly, "chamillon"), { direct: [], close: [] }, "Email username and city never supply approximate name words");
});

test("ranking prefers fewer edits, then relative error, then whole words over equal-scoring prefixes", () => {
  const sameCost = createContactSearchIndex([
    { id: "marie-fictional", name: "Marie" },
    { id: "prefix-fictional", name: "Mariano" },
    { id: "whole-fictional", name: "Martin" },
  ]);
  assert.deepEqual(ids(searchContactSuggestions(sameCost, "marin").close), ["whole-fictional", "prefix-fictional", "marie-fictional"]);
  const differentCost = createContactSearchIndex([
    { id: "two-edits-fictional", name: "Charmillon" },
    { id: "one-edit-fictional", name: "Charmilxon" },
  ]);
  assert.deepEqual(ids(searchContactSuggestions(differentCost, "charmilxox").close), ["one-edit-fictional", "two-edits-fictional"]);
});

test("direct results stay first, preserve every homonym, and never reappear in at most five stable suggestions", () => {
  const closeContacts = Array.from({ length: 8 }, (_, index) => ({ ...dylan, id: `homonym-fictional-${index}` }));
  const direct = { ...dylan, id: "direct-fictional", name: "Chamillon", companyName: "Entreprise fictive" };
  const contacts = [...[...closeContacts].reverse(), direct, closeContacts[0]];
  const result = searchContactSuggestions(createContactSearchIndex(contacts), "chamillon");
  assert.deepEqual(ids(result.direct), [direct.id]);
  assert.deepEqual(ids(result.close), closeContacts.slice(0, 5).map(contact => contact.id));
  assert.equal(new Set(ids([...result.direct, ...result.close])).size, 6);
  assert.deepEqual(searchContactSuggestions(createContactSearchIndex([...contacts].reverse()), "chamillon").close, result.close);
  assert.equal(searchContactSuggestions(createContactSearchIndex(closeContacts), "charmillon").direct.length, 8, "Direct results have no suggestion cap");
});

test("normalization, absent fields and authorized scope are preserved without modifying recorded names or hidden values", () => {
  const contact = Object.freeze({ ...dylan, firstName: " Dy\u0301lan ", name: " Chármillon ", companyName: "Nettoyage \t Dylan Chármillon", notes: "Private secretname", supplierBankAccounts: [{ id: "bank-fictional", accountHolder: "BankSecret", iban: "BankSecret", bic: "BankSecret", status: "À vérifier" as const, isPrimary: false, createdAt: "2026-01-01T00:00:00.000Z" }], documents: [{ title: "DocumentSecret" }] });
  const snapshot = structuredClone(contact);
  const index = createContactSearchIndex(Object.freeze([contact]));
  for (const query of ["chamillon", "CHÁMILLON", "cha\u1AB0millon", "ＤＹＬＡＮ ＣＨＡＭＩＬＬＯＮ"]) {
    assert.deepEqual(ids(searchContactSuggestions(index, query).close), [contact.id], query);
  }
  for (const query of ["secretnamq", "banksecrex", "documentsecrex", contact.id]) {
    assert.deepEqual(searchContactSuggestions(index, query), { direct: [], close: [] }, query);
  }
  assert.deepEqual(contact, snapshot);
  assert.equal(searchContactSuggestions(index, "chamillon").close[0], contact);
  const missing = { id: "missing-fictional", name: null, firstName: undefined, companyName: " " } as unknown as Contact;
  assert.deepEqual(searchContactSuggestions(createContactSearchIndex([missing]), "chamillon"), { direct: [], close: [] });
  assert.deepEqual(searchContactSuggestions(createContactSearchIndex([missing]), " "), { direct: [missing], close: [] });
  assert.deepEqual(searchContactSuggestions(createContactSearchIndex([]), "chamillon"), { direct: [], close: [] });
  assert.deepEqual(ids(searchContactSuggestions(createContactSearchIndex([{ ...dylan, id: "only-authorized-fictional" }]), "chamillon").close), ["only-authorized-fictional"], "No contact outside the caller's projection can appear");
});

test("the five-suggestion cap is applied to the caller's filtered projection", () => {
  const contacts = Array.from({ length: 12 }, (_, index) => ({ ...dylan, id: `filtered-fictional-${index.toString().padStart(2, "0")}`, kind: index < 8 ? "Client" as const : "Prestataire" as const }));
  const filtered = contacts.filter(contact => contact.kind === "Prestataire");
  assert.deepEqual(ids(searchContactSuggestions(createContactSearchIndex(filtered), "chamillon").close), ids(filtered));
  assert.equal(searchContactSuggestions(createContactSearchIndex(contacts), "chamillon").close.length, 5);
});

test("an indexed fictional directory of ten thousand contacts remains responsive across repeated varied queries", context => {
  const firstNames = ["Dylan", "Clément", "Élodie", "Julien", "Anne-Marie", "Sophie", "Alexandre", "Laure"];
  const surnames = ["Charmillon", "Minodier", "Martin", "Durand", "De La Résidence", "Dupont", "Chevalier", "Bernard"];
  const fictionalCode = (value: number) => Array.from({ length: 4 }, (_, place) => String.fromCharCode(97 + Math.floor(value / 26 ** place) % 26)).join("");
  const contacts = Array.from({ length: 10000 }, (_, index) => ({
    ...dylan, id: `performance-fictional-${index}`, firstName: firstNames[index % firstNames.length],
    name: surnames[Math.floor(index / firstNames.length) % surnames.length],
    companyName: `Société Services ${fictionalCode(index)}`,
    email: `fictional-${index}@example.invalid`, phone: `06 42 ${index.toString().padStart(6, "0")}`,
  }));
  const buildStarted = performance.now();
  const index = createContactSearchIndex(contacts);
  const indexMs = performance.now() - buildStarted;
  const queries = ["char", "cham", "chamillon", "chramillon", "dlyan chamillon", "charmilxox", "clement minodier", "minodiex", "laure durnad", "societe servixes", "fictional-42@example.invalid", "06 42", "unrelated"];
  const durations: number[] = [];
  const repeatedResults = new Map<string, string>();
  for (let repetition = 0; repetition < 4; repetition += 1) {
    for (const query of queries) {
      const started = performance.now();
      const result = searchContactSuggestions(index, query);
      durations.push(performance.now() - started);
      assert.ok(result.close.length <= 5);
      const signature = JSON.stringify({ direct: ids(result.direct), close: ids(result.close) });
      if (repeatedResults.has(query)) assert.equal(signature, repeatedResults.get(query), query);
      else repeatedResults.set(query, signature);
    }
  }
  const sorted = [...durations].sort((left, right) => left - right);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  const maximum = sorted[sorted.length - 1];
  context.diagnostic(JSON.stringify({ contacts: contacts.length, queries: durations.length, indexMs: Math.round(indexMs), p95Ms: Math.round(p95), maximumMs: Math.round(maximum) }));
  assert.ok(indexMs < 5000 && maximum < 1500, "Conservative hang guard; report actual timings rather than treating this as a machine-independent benchmark");
});
