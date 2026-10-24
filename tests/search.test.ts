import test from "node:test";
import assert from "node:assert/strict";
import { createSearchIndex, matchesSearchFields, searchIndex } from "../lib/search";
import { createContactSearchIndex, searchContacts } from "../lib/contactSuggestions";
import { matchesContactWithCompany } from "../lib/contactCompany";

const ids = (hits: readonly { item: { id: string } }[]) => hits.map(hit => hit.item.id);
const company = Object.freeze({ id: "agency", entityType: "company" as const, companyName: "Agence Riviera", city: "Cannes", postalAddress: "21 boulevard Fictif" });
const person = Object.freeze({ id: "clement", entityType: "person" as const, firstName: "Clément", name: "Martin", companyId: company.id,
  companyName: "Ancienne dénomination", email: "clement@example.invalid", phone: "+33 (0)6 42 00 00 01", organizationFunction: "Gestionnaire" });

test("canonical companyId joins support reordered cross-field terms and typos in all authorized words", () => {
  const index = createContactSearchIndex([person], [person, company]);
  for (const query of ["clement", "martin clem", "riviera canne", "cannse riviera", "clemnt", "boulevrad gestinnaire"]) {
    assert.deepEqual(ids(searchContacts(index, query)), [person.id], query);
  }
  assert.equal(searchContacts(index, "cannse")[0].approximate, true);
  assert.equal(searchContacts(index, "canne")[0].approximate, false);
  assert.equal(searchContacts(index, "clemnt")[0].item, person, "Returns the unchanged recorded object");
  assert.deepEqual(searchContacts(index, "absent"), []);
});

test("only authorized company/person projections contribute fields and canonical merge chains are bounded", () => {
  assert.deepEqual(searchContacts(createContactSearchIndex([person], [person]), "riviera"), []);
  const maskedCompany = { id: company.id, entityType: "company" as const };
  assert.deepEqual(searchContacts(createContactSearchIndex([person], [person, maskedCompany]), "cannes"), []);
  assert.equal(matchesContactWithCompany(company, "clement", [company, person]), true);
  assert.deepEqual(ids(searchContacts(createContactSearchIndex([company], [company, person]), "martin")), [company.id]);
  const previous = { id: "previous", entityType: "company" as const, mergedIntoCompanyId: company.id };
  assert.deepEqual(ids(searchContacts(createContactSearchIndex([{ ...person, companyId: previous.id }], [previous, company]), "riviera")), [person.id]);
  const cycle = [{ id: "a", entityType: "company" as const, mergedIntoCompanyId: "b" }, { id: "b", entityType: "company" as const, mergedIntoCompanyId: "a" }];
  assert.deepEqual(searchContacts(createContactSearchIndex([{ ...person, companyId: "a" }], cycle), "riviera"), []);
});

test("complete direct words rank above direct prefixes, interiors and approximate matches", () => {
  const items = [{ id: "fuzzy", name: "Clémant" }, { id: "prefix", name: "Clémentine" }, { id: "interior", name: "Auclement" }, { id: "whole", name: "Clément" }];
  const index = createSearchIndex(items, item => [item.name], { getId: item => item.id, getLabel: item => item.name });
  const hits = searchIndex(index, "clement");
  assert.deepEqual(ids(hits), ["whole", "prefix", "interior", "fuzzy"]);
  assert.equal(hits[3].approximate, true);
  assert.equal(hits[0].approximate, false);
});

test("sensitive formatted references, emails and phones accept no arbitrary corrections", () => {
  const row = { id: "invoice", title: "Facture Villa Fictive", reference: "DEV-2026/000137", phone: "+33 (0)6 42 00 00 01", email: "clement@example.invalid" };
  const index = createSearchIndex([row], item => [item.title, item.reference, item.phone, item.email]);
  for (const query of ["DEV2026000137", "2026/000137", "+330642000001", "+33 (0)6 42 00 00 01", "clement@example.invalid"]) {
    assert.deepEqual(ids(searchIndex(index, query)), [row.id], query);
    assert.equal(searchIndex(index, query)[0].approximate, false);
  }
  for (const query of ["DEV2026000138", "+330642000002", "clemnt@example.invalid", "clemnt@", "DEV-2026/00013O"]) {
    assert.deepEqual(searchIndex(index, query), [], query);
  }
  assert.deepEqual(searchIndex(index, "clemnt"), [], "Email usernames are not fuzzy word sources");
  const phones = [{ id: "wrong-order", name: "Jean Riviera", phone: "06 78 56 34 12" }, { id: "correct", name: "Jean Riviera", phone: "06 12 34 56 78" }];
  const phoneIndex = createSearchIndex(phones, item => [item.name, item.phone]);
  assert.deepEqual(ids(searchIndex(phoneIndex, "riviera 06 12 34 56 78")), ["correct"], "Mixed text queries preserve the complete phone digit order");
});

test("ranking precedes the display cap; homonyms and authorized business filters remain independent", () => {
  const items = Array.from({ length: 3000 }, (_, number) => ({ id: `fixture-${number}`, title: `Projet fictif ${number}`, category: "A" }));
  const target = { id: "last-candidate", title: "Résidence Azur Cannes", category: "B" };
  const index = createSearchIndex([...items, target], item => [item.title], { getId: item => item.id, getLabel: item => item.title });
  assert.deepEqual(ids(searchIndex(index, "azur cannse", { limit: 1 })), [target.id]);
  assert.deepEqual(searchIndex(createSearchIndex(items.filter(item => item.category === "B"), item => [item.title]), "azur"), []);
  const homonyms = createSearchIndex([{ id: "2", name: "Martin" }, { id: "1", name: "Martin" }], item => [item.name], { getId: item => item.id });
  assert.deepEqual(ids(searchIndex(homonyms, "martin")), ["1", "2"]);
});

test("empty lists, short queries and punctuation are conservative and preserve arbitrary source strings", () => {
  assert.deepEqual(searchIndex(createSearchIndex([], () => []), ""), []);
  assert.equal(matchesSearchFields("marie anne", ["Anne-Marie"]), true);
  assert.equal(matchesSearchFields("d artagnan", ["D’Artagnan"]), true);
  assert.equal(matchesSearchFields("cna", ["Cannes"]), false);
  assert.equal(matchesSearchFields("jan", ["Jean"]), false);
  assert.equal(matchesSearchFields("cannse", [undefined, null, "Cannes"]), true);
  assert.equal(matchesSearchFields("1235", [1234]), false);
});
