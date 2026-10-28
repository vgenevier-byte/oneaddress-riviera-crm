import assert from "node:assert/strict";
import { test } from "node:test";
import { createOwnerContext, createOwnerPerson, ownerContextWarnings, validateOwnerContext } from "../../lib/fonciere/owners";
import { createFonciereData, validateFonciereData } from "../../lib/fonciere/model";

test("empty and legacy projects get separate optional ownership defaults", () => {
  const first = createFonciereData(), second = createFonciereData(); first.name = "Fictif";
  first.ownerContext.sale.reasons.push("inheritance"); assert.deepEqual(second.ownerContext.sale.reasons, []);
  const legacy = { ...first }; delete (legacy as Partial<typeof first>).ownerContext;
  assert.deepEqual(validateFonciereData(legacy).ownerContext, createOwnerContext());
});
test("indivision and full ownership coexist with declared count independent of identified contacts", () => {
  const value = createOwnerContext(); value.organization = "indivision"; value.rights = "full"; value.declaredCount = 4;
  value.owners = [{ contactId: "one", entityType: "person", note: "", person: createOwnerPerson() }, { contactId: "two", entityType: "person", note: "" }];
  assert.deepEqual(validateOwnerContext(value), value); assert.deepEqual(ownerContextWarnings(value), []);
});
test("company ownership stays separate from its representative and split rights", () => {
  const value = createOwnerContext(); value.rights = "split"; value.owners = [{ contactId: "company", entityType: "company", note: "" }];
  value.representatives = [{ contactId: "person", ownerContactId: "company", role: "Gérant" }]; value.primaryContactId = "person"; value.primaryRole = "Gérant";
  assert.equal(validateOwnerContext(value).owners.length, 1); assert.equal(value.representatives.length, 1);
  assert.throws(() => validateOwnerContext({ ...value, owners: [{ ...value.owners[0], person: createOwnerPerson() }] }));
});
test("strict validation refuses duplicate contacts, invalid count, countries, civil dates and unexpected fields", () => {
  const value = createOwnerContext(); value.owners = [{ contactId: "one", entityType: "person", note: "", person: createOwnerPerson() }];
  for (const bad of [-1, 1.5, 10001, "4"]) assert.throws(() => validateOwnerContext({ ...value, declaredCount: bad }));
  assert.throws(() => validateOwnerContext({ ...value, owners: [...value.owners, value.owners[0]] }));
  assert.throws(() => validateOwnerContext({ ...value, score: 0.8 }));
  for (const bad of [-1, 130.2, 131]) assert.throws(() => validateOwnerContext({ ...value, owners: [{ ...value.owners[0], person: { ...createOwnerPerson(), age: bad } }] }));
  for (const bad of ["2026-02-30", "2026-13-01", "2026-1-01"]) assert.throws(() => validateOwnerContext({ ...value, sale: { ...value.sale, listedOn: bad } }));
  assert.throws(() => validateOwnerContext({ ...value, owners: [{ ...value.owners[0], person: { ...createOwnerPerson(), residenceCountry: "France" } }] }));
});
test("contradictory entries are retained and explained in both languages", () => {
  const value = createOwnerContext(); value.organization = "sole"; value.declaredCount = 4; value.primaryContactId = "orphan";
  value.representatives = [{ contactId: "representative", ownerContactId: "unlinked", role: "À confirmer" }]; value.sale.reasons = ["inheritance", "undisclosed"];
  assert.deepEqual(validateOwnerContext(value), value);
  assert(ownerContextWarnings(value, "fr").length >= 4); assert(ownerContextWarnings(value, "en").some(text => text.includes("Sole ownership")));
});
test("residence, nationality, age date and information source are independent optional claims", () => {
  const value = createOwnerContext(), person = createOwnerPerson(); person.age = 65; person.ageApproximate = true; person.ageAsOf = "2026-10-28"; person.residenceCountry = "FR"; person.nationalities = ["GB", "IE"];
  person.information = { source: "owner", contactId: "", documentId: "", detail: "Communiqué oralement", date: "2026-10-28", confirmation: "confirm" };
  value.owners = [{ contactId: "person", entityType: "person", note: "", person }];
  assert.deepEqual(validateOwnerContext(value).owners[0].person, person);
});
