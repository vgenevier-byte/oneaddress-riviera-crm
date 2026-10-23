import assert from "node:assert/strict";
import { test } from "node:test";
import { importedNotes } from "../../lib/izord/photos";
import type { ImportMeta } from "../../lib/izord/model";

test("document notes omit internal geography while retaining full descriptions, contact details and original snapshots", () => {
  const description = "Description complète de la propriété. ".repeat(160);
  const address = { line1: "8 rue de l’agence", city: "Nice", country: "France", latitude: 43.712345, longitude: 7.265432, source: "ign" };
  const contacts = { agencyAddress: address.line1, agencyPhone: "+33 4 00 00 00 00", agencyEmail: "agence@example.test", agentPhone: "+33 6 00 00 00 00", agentEmail: "agent@example.test" };
  const meta: ImportMeta = {
    filename: "fiche-historique.pdf", agencyFields: { description, ...contacts }, addressDetails: { ...address },
    fonciereSnapshot: {
      fields: { description, ...contacts },
      guided: { version: 1, values: { coordinates: { latitude: 43.712345, longitude: 7.265432 }, rooms: 4 }, details: { coordinates: "Ancienne précision géographique", rooms: "Quatre pièces conservées" }, inactive: ["coordinates", "land"] },
      readableFields: { coordinates: "Latitude : 43,712345 · Longitude : 7,265432", rooms: "4" },
      propertyAddressDetails: { ...address }, agencyAddressDetails: { ...address },
    },
  };
  const original = JSON.stringify(meta);
  const notes = importedNotes(meta);
  assert.doesNotMatch(notes, /latitude|longitude|coordinates|43[.,]712345|7[.,]265432|Ancienne précision géographique/i);
  assert.ok(notes.includes(description));
  for (const value of Object.values(contacts)) assert.ok(notes.includes(value), value);
  assert.match(notes, /Quatre pièces conservées/);
  assert.match(notes, /"rooms": 4/);
  assert.match(notes, /"land"/);
  assert.equal(JSON.stringify(meta), original);
  assert.equal(importedNotes(null), "");
});
