import test from "node:test";
import assert from "node:assert/strict";

import { MARE_BANDS, SIRE_BANDS, ageGrid, ageGridArgs, ageGridSql, mareBand, sireBand } from "./ages.mjs";

test("ages fall into the bands the paper used, and an unknown age into none", () => {
  assert.equal(sireBand(4), "3-6");
  assert.equal(sireBand(10), "7-10");
  assert.equal(sireBand(16), "16-20");
  assert.equal(sireBand(25), "21+");
  assert.equal(sireBand(null), null);
  assert.equal(mareBand(5), "3-9");
  assert.equal(mareBand(18), "18-20");
  assert.equal(mareBand(23), "21+");
  assert.equal(mareBand(2), null);
});

test("the SQL bands both ages the same way the code does, and takes the sire as a second argument", () => {
  const sql = ageGridSql({ hint: "/*+ MAX_EXECUTION_TIME(1000) */" });
  for (const b of [...SIRE_BANDS, ...MARE_BANDS]) assert.ok(sql.includes(`BETWEEN ${b.lo} AND ${b.hi} THEN '${b.key}'`), b.key);
  assert.match(sql, /r\.foalYear - 1 - s\.y/);
  assert.match(sql, /r\.foalYear - d\.y/);
  assert.doesNotMatch(sql, /sireName = \?/);
  assert.match(ageGridSql({ sire: "DUBAWI" }), /AND sireName = \?/);
  assert.deepEqual(ageGridArgs(), ["2008-01-01"]);
  assert.deepEqual(ageGridArgs({ sire: "DUBAWI" }), ["2008-01-01", "DUBAWI"]);
});

test("the grid holds every cell, rates per runner, margins, and the sires whose age is unknown apart", () => {
  const rows = [
    { sireBand: "3-6", mareBand: "18-20", runners: 22, stakesWinners: 3, groupWinners: 2, group1Winners: 0, rated100: 5, rated110: 1, meanBest: 84 },
    { sireBand: "21+", mareBand: "18-20", runners: 13, stakesWinners: 0, groupWinners: 0, group1Winners: 0, rated100: 1, rated110: 0, meanBest: 72 },
    { sireBand: "21+", mareBand: "3-9", runners: 196, stakesWinners: 20, groupWinners: 12, group1Winners: 3, rated100: 45, rated110: 20, meanBest: 83 },
    { sireBand: null, mareBand: "3-9", runners: 50, stakesWinners: 5, groupWinners: 2, group1Winners: 1, rated100: 10, rated110: 3, meanBest: 80 },
    { sireBand: "7-10", mareBand: null, runners: 9, stakesWinners: 1, groupWinners: 0, group1Winners: 0, rated100: 1, rated110: 0, meanBest: 90 },
  ];
  const g = ageGrid(rows);
  assert.equal(g.grid.length, SIRE_BANDS.length);
  assert.equal(g.grid[0].cells.length, MARE_BANDS.length);
  const young = g.grid.find((r) => r.sire === "3-6").cells.find((c) => c.mare === "18-20");
  assert.equal(young.runners, 22);
  assert.equal(young.stakesRate, 13.6);
  const old = g.grid.find((r) => r.sire === "21+");
  assert.equal(old.cells.find((c) => c.mare === "18-20").stakesRate, 0);
  assert.equal(old.all.runners, 209);
  assert.equal(old.all.stakesWinners, 20);
  // An empty cell is a cell with nothing in it, not a missing one.
  assert.equal(g.grid.find((r) => r.sire === "11-15").cells.find((c) => c.mare === "21+").runners, 0);
  assert.equal(g.grid.find((r) => r.sire === "11-15").cells.find((c) => c.mare === "21+").stakesRate, null);
  // Margins by the mare's age count only runners whose sire's age is known.
  assert.equal(g.byMare.find((m) => m.mare === "18-20").runners, 35);
  assert.equal(g.byMare.find((m) => m.mare === "3-9").runners, 196);
  assert.equal(g.unknownSire.find((m) => m.mare === "3-9").runners, 50);
  assert.equal(g.all.runners, 231);
  // A row with no mare band is nothing to the grid.
  assert.equal(g.all.stakesWinners, 23);
});
