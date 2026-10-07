import test from "node:test";
import assert from "node:assert/strict";
import { matchesTaskContact, taskContactLabel, taskContactOptions, type TaskContactOption } from "../../lib/tasks/contactOptions";

const clement: TaskContactOption = { id: "contact-clement-fictional", firstName: "Clément", name: "Minodier" };

test("first name and surname support partial, case, accents, Unicode and either token order", () => {
  for (const query of ["clement", "CLÉMENT", "clem", "minodier", "clement minodier", "minodier clement", "  MINO\t clem  ", "Cle\u0301ment", "ＣＬÉＭＥＮＴ"]) {
    assert.equal(matchesTaskContact(clement, query), true, query);
  }
  for (const query of ["Clement Dupont", "Minodier Vincent", "unrelated"]) assert.equal(matchesTaskContact(clement, query), false, query);
  assert.equal(taskContactLabel(clement), "Clément Minodier", "Search never changes stored spelling");
});

test("composed first names and surnames are searchable across words without changing their labels", () => {
  const composed = { id: "compound-fictional", firstName: "Anne-Marie", name: "De La Résidence" };
  assert.equal(taskContactLabel(composed), "Anne-Marie De La Résidence");
  for (const query of ["anne", "marie", "resid", "RESIDENCE Anne", "la marie de"]) assert.equal(matchesTaskContact(composed, query), true, query);
  assert.equal(matchesTaskContact(composed, "anne martin"), false);
});

test("missing names and companies have truthful labels with no invented first name", () => {
  const surname = { id: "surname-fictional", name: "Dùpont" };
  const firstName = { id: "first-name-fictional", firstName: "Élodie" };
  const company = { id: "company-fictional", company: "Société Riviera" };
  const unnamed = { id: "unnamed-fictional", email: "existing@example.invalid" };
  assert.equal(taskContactLabel(surname), "Dùpont");
  assert.equal(taskContactLabel(firstName), "Élodie");
  assert.equal(taskContactLabel(company), "Société Riviera");
  assert.equal(taskContactLabel(unnamed), "Contact sans nom");
  assert.equal(matchesTaskContact(surname, "dupont"), true);
  assert.equal(matchesTaskContact(firstName, "elo"), true);
  assert.equal(matchesTaskContact(company, "riviera societe"), true);
  assert.equal(matchesTaskContact(unnamed, "existing"), false, "Email is a distinction, not a name search");
  assert.equal(matchesTaskContact(unnamed, ""), true);
});

test("whitespace-only names are missing fields while recorded nonblank spellings remain intact", () => {
  const company = { id: "company-blanks-fictional", firstName: "   ", name: "\t", company: "Société Riviera" };
  const surname = { id: "surname-blank-first-fictional", firstName: "  ", name: "Dùpont" };
  const unnamed = { id: "all-blanks-fictional", firstName: " ", name: "\t", company: "   " };
  const padded = { id: "spelling-preserved-fictional", firstName: " Élodie ", name: "Dùpont" };
  assert.equal(taskContactLabel(company), "Société Riviera");
  assert.equal(matchesTaskContact(company, "riviera societe"), true);
  assert.equal(taskContactLabel(surname), "Dùpont");
  assert.equal(matchesTaskContact(surname, "dupont"), true);
  assert.equal(taskContactLabel(unnamed), "Contact sans nom");
  assert.equal(matchesTaskContact(unnamed, "contact"), false);
  assert.equal(taskContactLabel(padded), " Élodie  Dùpont");
  assert.equal(matchesTaskContact(padded, " DUPONT   elodie "), true);
});

test("homonyms keep distinct contact IDs and only already authorized distinctions", () => {
  const projected = taskContactOptions([
    { id: "homonym-a-fictional", firstName: "Clément", name: "Minodier", companyName: "Société A" },
    { id: "homonym-b-fictional", firstName: "Clément", name: "Minodier", email: "b@example.invalid" },
  ]);
  assert.equal(projected.length, 2);
  assert.deepEqual(projected.filter(row => matchesTaskContact(row, "clem")).map(row => row.id), ["homonym-a-fictional", "homonym-b-fictional"]);
  assert.equal(taskContactLabel(projected[0]), taskContactLabel(projected[1]));
  assert.equal(projected[0].company, "Société A");
  assert.equal("email" in projected[0], false);
  assert.equal(projected[1].email, "b@example.invalid");
  assert.equal("company" in projected[1], false);
});

test("reference mapping copies only authorized contact display fields and preserves ID/spelling", () => {
  const input = { id: "safe-contact-fictional", firstName: "Clément", name: "Minodier", companyName: "Déjà autorisée", email: "fixture@example.invalid", phone: "excluded", bankAccounts: ["excluded"], ownerId: "excluded", label: "Surname-only legacy label" };
  assert.deepEqual(taskContactOptions([input]), [{ id: input.id, firstName: input.firstName, name: input.name, company: input.companyName, email: input.email }]);
  assert.equal(input.label, "Surname-only legacy label");
  assert.deepEqual(taskContactOptions([{ id: "limited-fictional", firstName: "Clément", name: "Minodier", companyName: "Autorisée" }]), [{ id: "limited-fictional", firstName: "Clément", name: "Minodier", company: "Autorisée" }]);
  assert.deepEqual(taskContactOptions([]), [], "No Contacts permission produces no options");
});

test("malformed projections cannot become invented contacts or labels", () => {
  for (const rows of [undefined, null, {}, "contacts"]) assert.deepEqual(taskContactOptions(rows), []);
  assert.deepEqual(taskContactOptions([null, {}, { id: 7 }, { id: "" }, { id: "valid-fictional", firstName: 42, name: { secret: "invalid" }, companyName: [], email: false }]), [{ id: "valid-fictional" }]);
});

test("named contacts match their company simultaneously and tokens may span fields in either order", () => {
  const person = { id: "julien-company-fictional", firstName: "Julien", name: "Martin", company: "Àzur Sérvices" };
  for (const query of ["julien", "martin", "azur", "services", "azur julien", "MARTIN AZUR", "ser ju", "  SERVICES\t Martin azur  ", "A\u0300zur Se\u0301rvices", "ＡＺＵＲ ＪＵＬＩＥＮ"]) {
    assert.equal(matchesTaskContact(person, query), true, query);
  }
  assert.equal(matchesTaskContact(person, "azur dupont"), false);
  assert.equal(taskContactLabel(person), "Julien Martin", "Company is additional authorized information, not the person label");
});

test("deduplicate only the same contact ID while retaining every interlocutor of the same company", () => {
  const first = { id: "azur-julien-fictional", firstName: "Julien", name: "Martin", companyName: "Azur Services" };
  const second = { id: "azur-laure-fictional", firstName: "Laure", name: "Durand", companyName: "Azur Services" };
  const company = { id: "azur-company-fictional", companyName: "Azur Services" };
  const projected = taskContactOptions([first, second, { ...first, firstName: "Duplicate ignored" }, company, second]);
  assert.deepEqual(projected.map(contact => contact.id), [first.id, second.id, company.id]);
  assert.deepEqual(projected.filter(contact => matchesTaskContact(contact, "azur")).map(contact => contact.id), [first.id, second.id, company.id]);
  assert.deepEqual(projected.filter(contact => matchesTaskContact(contact, "azur julien")).map(contact => contact.id), [first.id]);
  assert.equal(taskContactLabel(projected[0]), "Julien Martin", "First authorized occurrence stays unchanged");
  assert.equal(taskContactLabel(projected[2]), "Azur Services", "Company-only contact has no invented interlocutor");
});

test("company search uses only companyName already present in the authorized projection", () => {
  const projected = taskContactOptions([
    { id: "limited-company-fictional", firstName: "Julien", name: "Martin", companyName: "Azur Services" },
    { id: "limited-no-company-fictional", firstName: "Julien", name: "Martin", company: "Must not be completed" },
  ]);
  assert.equal(matchesTaskContact(projected[0], "azur martin"), true);
  assert.equal(matchesTaskContact(projected[1], "julien"), true);
  assert.equal(matchesTaskContact(projected[1], "azur"), false);
  assert.equal(matchesTaskContact(projected[1], "completed"), false);
  assert.equal("company" in projected[1], false);
  assert.deepEqual(taskContactOptions([]), [], "No Contacts permission creates no company option");
});
