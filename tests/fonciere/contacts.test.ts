import assert from "node:assert/strict";
import test from "node:test";
import { createFonciereData } from "../../lib/fonciere/model";
import { applyProjectContact, contactCompanyMatches, contactReplacementFields, duplicateProjectContacts, matchesProjectContact, searchProjectContacts, type ProjectContact } from "../../lib/fonciere/contacts";
const camille: ProjectContact = { id: "camille", entityType: "person", name: "Génévier", firstName: "Camille", companyName: "Agence Côte Azur", email: "camille@example.invalid", phone: "+33 6 12 34 56 78", city: "Nice", postalAddress: "Domicile personnel fictif" };
const alex: ProjectContact = { ...camille, id: "alex", name: "Martin", firstName: "Alex", email: "alex@example.invalid", phone: "06 98 76 54 32" };
const company: ProjectContact = { ...camille, id: "company", entityType: "company", name: "", firstName: "", email: "agence@example.invalid", phone: "04 93 00 00 00", postalAddress: "Adresse agence fictive" };

test("authorized Contacts matching accepts fragments, reordered combined words, accents, email and phone variants", () => {
  for (const query of ["agence", "COTE", "Cam", "Genevier", "camille gene", "gene camille", "azur cam", "gene azur", "camille@example", "0612345678", "06 12 34 56 78", "06.12.34.56.78", "+33 (0)6 12 34 56 78", "cote 06 12 34 56 78"]) assert.equal(matchesProjectContact(camille, query), true, query);
  assert.equal(matchesProjectContact(camille, "alex"), false);
  assert.equal(matchesProjectContact(alex, "azur"), true);
  assert.notEqual(camille.id, alex.id);
});
test("person selection fills person details and company label, never personal address into agency/property", () => {
  const data = createFonciereData(); data.propertyAddress = "Adresse du bien fictif";
  const selected = applyProjectContact(data, "agent", camille);
  assert.equal(selected.agentContactId, "camille"); assert.equal(selected.agentName, "Camille Génévier"); assert.equal(selected.agentEmail, camille.email); assert.equal(selected.agencyName, company.companyName);
  assert.equal(selected.agencyContactId, ""); assert.equal(selected.agencyAddress, ""); assert.equal(selected.agencyEmail, ""); assert.equal(selected.propertyAddress, data.propertyAddress);
});
test("canonical company selection fills only actual agency coordinates, legacy company labels never invent link", () => {
  let data = applyProjectContact(createFonciereData(), "agency", company);
  assert.equal(data.agencyContactId, "company"); assert.equal(data.agencyAddress, company.postalAddress); assert.equal(data.agencyEmail, company.email); assert.equal(data.agentEmail, "");
  data = applyProjectContact(data, "agency", camille); assert.equal(data.agencyContactId, ""); assert.equal(data.agencyName, camille.companyName); assert.equal(data.agencyAddress, ""); assert.equal(data.agencyEmail, "");
});
test("switch and unlink clear old sourced values; manual corrections require confirmation list", () => {
  let data = applyProjectContact(createFonciereData(), "agent", camille);
  assert.deepEqual(contactReplacementFields(data, "agent", alex), []);
  data.agentPhone = "Correction manuelle"; assert.deepEqual(contactReplacementFields(data, "agent", alex), ["agentPhone"]);
  data = applyProjectContact(data, "agent", { ...alex, phone: "", email: "" }); assert.equal(data.agentPhone, ""); assert.equal(data.agentEmail, ""); assert.equal(data.agentName, "Alex Martin");
  data = applyProjectContact(data, "agent", null); assert.equal(data.agentContactId, ""); assert.equal(data.agentName, ""); assert.equal(data.contactSources.agent, undefined);
});
test("explicit agency identity stays separate and discrepancies are not silently relinked", () => {
  let data = applyProjectContact(createFonciereData(), "agency", company);
  data = applyProjectContact(data, "agent", { ...alex, companyName: "Autre agence" });
  assert.equal(data.agencyContactId, company.id); assert.equal(data.agencyName, company.companyName); assert.equal(data.agentContactId, alex.id); assert.equal(data.agencyEmail, company.email);
});
test("an imported agency label and coordinates cannot mix with a different newly selected agent's company", () => {
  const data = createFonciereData(); Object.assign(data, { agencyName: "Ancienne agence", agencyPhone: "04 00 00 00 00", agencyEmail: "old@example.invalid", agencyAddress: "Ancienne adresse agence" });
  assert.deepEqual(new Set(contactReplacementFields(data, "agent", camille)), new Set(["agencyName", "agencyPhone", "agencyEmail", "agencyAddress"]));
  const selected = applyProjectContact(data, "agent", camille);
  assert.equal(selected.agencyName, camille.companyName); assert.equal(selected.agencyPhone, ""); assert.equal(selected.agencyEmail, ""); assert.equal(selected.agencyAddress, ""); assert.equal(selected.agentPhone, camille.phone);
});
test("creation duplicate checks cover canonical company, person identity, email and national phones", () => {
  assert.deepEqual(duplicateProjectContacts([camille, alex, company], { ...camille, id: undefined, email: "", phone: "" } as unknown as Omit<ProjectContact, "id">).map(row => row.id), [camille.id]);
  assert.equal(duplicateProjectContacts([camille], { ...alex, email: "CAMILLE@example.invalid", phone: "" }).length, 1);
  assert.equal(duplicateProjectContacts([camille], { ...alex, email: "", phone: "06 12 34 56 78" }).length, 1);
  assert.equal(duplicateProjectContacts([company], { ...company, companyName: "agence cote azur", email: "", phone: "" }).length, 1);
});


test("project contact suggestions rank all candidates and canonical company context before presentation limits", () => {
  const agency = { ...company, id: "agency-canonical", companyName: "Agence Riviera", city: "Cannes" };
  const agent = { ...camille, id: "agent-canonical", companyId: agency.id, companyName: "Old agency label", city: "Nice" };
  const filler = Array.from({ length: 1100 }, (_, index) => ({ ...alex, id: `filler-${index}`, companyName: "Other agency" }));
  const rows = [...filler, agency, agent];
  for (const query of ["riviera canne", "cannse cam", "genevier riviera", "genevir", "camille@example.invalid", "0612345678"]) assert.ok(searchProjectContacts(rows, query).some(row => row.id === agent.id), query);
  assert.equal(searchProjectContacts([agent], "cannse").length, 0, "Canonical context never comes from inaccessible records");
  assert.equal(searchProjectContacts(rows, "0612345679").some(row => row.id === agent.id), false);
  assert.equal(agent.companyName, "Old agency label", "Search never rewrites the historical company value");
});

test("mixed text and formatted phone query preserves the contiguous number identity", () => {
  const correct = { ...camille, id: "phone-correct", companyName: "Agence Riviera", phone: "06 12 34 56 78" };
  const reordered = { ...correct, id: "phone-reordered", phone: "06 78 56 34 12" };
  assert.deepEqual(searchProjectContacts([correct, reordered], "riviera 06 12 34 56 78").map(row => row.id), [correct.id]);
  assert.deepEqual(searchProjectContacts([correct, reordered], "riviera 06.12.34.56.78").map(row => row.id), [correct.id]);
});


test("flexible punctuation and typos never broaden duplicate identity or agency-name guards", () => {
  const existing = { ...company, companyName: "Agence, Riviera", email: "", phone: "" };
  const input = { ...existing, companyName: "Agence Riviera" };
  assert.equal(duplicateProjectContacts([existing], input).length, 0);
  assert.equal(duplicateProjectContacts([existing], { ...input, companyName: "Agence, Rivirea" }).length, 0);
  assert.equal(contactCompanyMatches(existing, "Agence Riviera"), false);
  assert.equal(matchesProjectContact(existing, "agence riviera"), true);
});
