import assert from "node:assert/strict";
import test from "node:test";
import { sortSelectOptions } from "../../lib/selectOptions";

test("presentation sorting uses visible translated labels and preserves canonical identities", () => {
  const options = Object.freeze([
    Object.freeze({ value: "Chauffeur", fr: "Chauffeur", en: "Driver" }),
    Object.freeze({ value: "Électricité", fr: "Électricité", en: "Electricity" }),
    Object.freeze({ value: "Artisan rénovation", fr: "Artisan rénovation", en: "Renovation contractor" }),
    Object.freeze({ value: "Chef", fr: "Chef", en: "Chef" }),
  ]);
  const fr = sortSelectOptions(options, option => option.fr, "fr");
  const en = sortSelectOptions(options, option => option.en, "en");
  assert.deepEqual(fr.map(option => option.value), ["Artisan rénovation", "Chauffeur", "Chef", "Électricité"]);
  assert.deepEqual(en.map(option => option.value), ["Chef", "Chauffeur", "Électricité", "Artisan rénovation"]);
  assert.equal(fr[1], options[0]);
  assert.deepEqual(sortSelectOptions(options, option => option.fr, "fr"), fr);
  assert.deepEqual(options.map(option => option.value), ["Chauffeur", "Électricité", "Artisan rénovation", "Chef"]);
});

test("explicit placeholder/complement roles preserve all values; an other ID alone has no role", () => {
  const options = [
    { value: "complement", label: "Autre" },
    { value: "other", label: "Autre régime professionnel" },
    { value: "z", label: "Zingueur" },
    { value: "", label: "Sélectionner…" },
    { value: "custom", label: "Ébéniste sur mesure" },
  ];
  const sorted = sortSelectOptions(options, option => option.label, "fr", {
    first: option => option.value === "",
    last: option => option.value === "complement",
  });
  assert.deepEqual(sorted.map(option => option.value), ["", "other", "custom", "z", "complement"]);
  assert.equal(sorted.length, options.length);
  assert.equal(sorted.at(-1), options[0]);
});

test("case/accent equivalents remain stable and custom historical whitespace is verbatim", () => {
  const options = [{ label: "Ébéniste", id: 1 }, { label: "ebeniste", id: 2 }, { label: "e\u0301BE\u0301NISTE", id: 3 }];
  assert.deepEqual(sortSelectOptions(options, option => option.label, "fr"), options);
  const historical = "  Électricité historique  ";
  assert.equal(sortSelectOptions([historical], value => value, "fr")[0], historical);
});

test("numbered names use natural order without changing disabled/selection metadata", () => {
  const options = [
    { id: "room-10", label: "Local 10", disabled: true, selected: true },
    { id: "room-2", label: "Local 2", disabled: false, selected: false },
  ];
  const result = sortSelectOptions(options, option => option.label, "fr");
  assert.deepEqual(result.map(option => option.id), ["room-2", "room-10"]);
  assert.equal(result[1], options[0]);
  assert.equal(result[1].disabled, true);
  assert.equal(result[1].selected, true);
});
