import assert from "node:assert/strict";
import test from "node:test";
import { formatPrepaidHours, parsePrepaidHours, prepaidHoursInput } from "../../lib/housePrepaidHours";

test("equivalent decimal hours produce identical canonical minute patches and replay signatures", () => {
  for (const [values, expected] of [
    [["30", "30,0", "30.00", "030.000", " 30 ", "30 h"], 1800],
    [["30,5", "30.5", "30.5000", "30 h 30", "30h30min"], 1830],
    [["0,05", ".05", ",05", "0.0500", "0 h 03"], 3],
  ] as const) {
    const signatures = values.map(value => JSON.stringify({ workerId: "fictional-worker", defaultMinutes: parsePrepaidHours(value), defaultPriceCents: 50000 }));
    assert.equal(new Set(signatures).size, 1);
    for (const value of values) assert.equal(parsePrepaidHours(value), expected, value);
  }
});

test("fractional minutes, malformed and non-positive values are rejected without rounding", () => {
  for (const value of ["", " ", "0", "0,0", "0 h 00", "-1", "+1", "1e2", "Infinity", "NaN", "30,5.0", "30,,5", "30.", "1 h 60", "1 h -1", "1 h 1.5", "0.01", "30.01", "0.016666666666666666667", "30.016666666666666", "150119987579016 h 32"]) {
    assert.equal(parsePrepaidHours(value), null, value);
  }
});

test("all whole-minute durations round-trip exactly in French and English, including non-quarter minutes", () => {
  const values = [
    ...Array.from({ length: 3000 }, (_, index) => index + 1),
    10_000_000,
    ...Array.from({ length: 120 }, (_, index) => Number.MAX_SAFE_INTEGER - index),
  ];
  for (const minutes of values) {
    assert.equal(parsePrepaidHours(prepaidHoursInput(minutes, "fr")), minutes, `fr ${minutes}`);
    assert.equal(parsePrepaidHours(prepaidHoursInput(minutes, "en")), minutes, `en ${minutes}`);
    assert.equal(parsePrepaidHours(formatPrepaidHours(minutes)), minutes, `summary ${minutes}`);
  }
});

test("input displays hours and preserves exact non-terminating fractions using hours/minutes", () => {
  assert.equal(prepaidHoursInput(1800), "30");
  assert.equal(prepaidHoursInput(1830), "30,5");
  assert.equal(prepaidHoursInput(1830, "en"), "30.5");
  assert.equal(prepaidHoursInput(1803), "30,05");
  assert.equal(prepaidHoursInput(1801), "30 h 01");
  assert.equal(prepaidHoursInput(1), "0 h 01");
  assert.equal(prepaidHoursInput(59), "0 h 59");
  assert.equal(prepaidHoursInput(0), "0");
  assert.equal(parsePrepaidHours("0 h 01"), 1);
  assert.equal(parsePrepaidHours("0 h 59"), 59);
});

test("summaries and histories show exact hour fractions without rounding or locale ambiguity", () => {
  assert.equal(formatPrepaidHours(0), "0 h");
  assert.equal(formatPrepaidHours(1800), "30 h");
  assert.equal(formatPrepaidHours(1830), "30 h 30");
  assert.equal(formatPrepaidHours(1801), "30 h 01");
  assert.equal(formatPrepaidHours(59), "0 h 59");
  for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => prepaidHoursInput(value), RangeError);
    assert.throws(() => formatPrepaidHours(value), RangeError);
  }
});
