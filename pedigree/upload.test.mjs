import test from "node:test";
import assert from "node:assert/strict";

import {
  parsePastedPedigree,
  payloadFrom,
  rowFrom,
  referenceFor,
  orphanPaths,
  ALL_PATHS,
  CUMULATIVE,
} from "./upload.mjs";
import { gridFromPayload } from "./grid.mjs";

test("labelled lines mean exactly what they say", () => {
  const { ancestors, format, warnings } = parsePastedPedigree(
    "S: Frankel\nSS: Galileo\nSD: Kind\nD: Could It Be Love\nDS: War Front",
  );
  assert.equal(format, "labelled");
  assert.deepEqual(warnings, []);
  const at = new Map(ancestors.map((a) => [a.path, a.name]));
  assert.equal(at.get("SDS"), undefined);
  assert.equal(at.get("DS"), "War Front");
  assert.equal(at.get("SD"), "Kind");
});

test("the words the trade uses stand in for a path", () => {
  const { ancestors } = parsePastedPedigree("Sire: Frankel\nDamsire: Kingman\n2nd dam: Regardez");
  const at = new Map(ancestors.map((a) => [a.path, a.name]));
  assert.equal(at.get("S"), "Frankel");
  assert.equal(at.get("DS"), "Kingman");
  assert.equal(at.get("DD"), "Regardez");
});

test("an ordered list is only read when it lands on a whole generation", () => {
  const two = parsePastedPedigree("Frankel\nCould It Be Love");
  assert.equal(two.format, "ordered");
  assert.deepEqual(two.ancestors.map((a) => a.path), ["S", "D"]);
  // One name short of six: every name after the gap would be in the wrong
  // place, so nothing is read at all.
  const five = parsePastedPedigree(["a", "b", "c", "d", "e"].join("\n"));
  assert.equal(five.format, "unknown");
  assert.deepEqual(five.ancestors, []);
  assert.match(five.warnings[0], /whole number of generations/);
});

test("an ordered list always says the order was assumed", () => {
  const six = parsePastedPedigree(["S", "D", "SS", "SD", "DS", "DD"].join("\n"));
  assert.equal(six.format, "ordered");
  assert.equal(six.ancestors.length, 6);
  assert.match(six.warnings[0], /Check the grid before saving/);
});

test("the drawn order is the grid's own order", () => {
  assert.deepEqual(ALL_PATHS.slice(0, 6), ["S", "D", "SS", "SD", "DS", "DD"]);
  assert.equal(ALL_PATHS.length, 62);
  assert.deepEqual(CUMULATIVE, [2, 6, 14, 30, 62]);
});

test("a typed chart reads back through the same grid every other chart does", () => {
  const payload = payloadFrom({
    name: "Circios",
    year: 2022,
    sex: "F",
    ancestors: [
      { path: "S", name: "Kingman" },
      { path: "D", name: "Could It Be Love" },
      { path: "SS", name: "Invincible Spirit" },
      { path: "DS", name: "War Front" },
    ],
  });
  const grid = gridFromPayload(payload);
  assert.equal(grid[0][0], "Kingman");
  assert.equal(grid[0][1], "Could It Be Love");
  assert.equal(grid[1][0], "Invincible Spirit");
  assert.equal(grid[1][2], "War Front");
  // The hole where the sire's dam belongs stays a hole.
  assert.equal(grid[1][1], null);
});

test("the same mare typed twice corrects her chart rather than duplicating it", () => {
  assert.equal(referenceFor("Circios", 2022), referenceFor("CIRCIOS (IRE)", "2022"));
  assert.notEqual(referenceFor("Circios", 2022), referenceFor("Circios", 2021));
  // Equineline's references are numeric, so a leading M cannot collide.
  assert.match(referenceFor("Circios", 2022), /^M[0-9a-f]+$/);
  assert.ok(referenceFor("Circios", 2022).length <= 32);
});

test("a name below a gap is kept but reported", () => {
  const orphans = orphanPaths([
    { path: "S", name: "Kingman" },
    { path: "SSS", name: "Green Desert" },
  ]);
  assert.deepEqual(orphans, ["SSS"]);
});

test("a chart with no usable names is no chart", () => {
  assert.equal(payloadFrom({ name: "Circios", ancestors: [] }), null);
  assert.equal(payloadFrom({ name: "", ancestors: [{ path: "S", name: "Kingman" }] }), null);
  assert.equal(payloadFrom({ name: "Circios", ancestors: [{ path: "X", name: "Nope" }] }), null);
});

test("the cache row carries the name key the rest of the codebase joins on", () => {
  const payload = payloadFrom({ name: "Circios (IRE)", year: 2022, ancestors: [{ path: "S", name: "Kingman" }] });
  const row = rowFrom(payload, { source: "manual", enteredBy: "richardbrown1" });
  assert.equal(row.name_key, "circios");
  assert.equal(row.foaling_year, 2022);
  assert.equal(row.source, "manual");
  assert.equal(row.entered_by, "richardbrown1");
  assert.equal(JSON.parse(row.payload).ancestors[0].display_name, "Kingman");
});
