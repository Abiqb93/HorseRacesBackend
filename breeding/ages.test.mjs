import test from "node:test";
import assert from "node:assert/strict";

import { MARE_BANDS, SIRE_BANDS, ageGrid, ageGridArgs, ageGridSql, mareBand, sireBand } from "./ages.mjs";

test("ages fall into the bands the paper used, and an unknown age into none", () => {
  assert.equal(sireBand(4), "3-6");
  assert.equal(sireBand(10), "7-10");
  assert.equal(sireBand(16), "16-20");
  assert.equal(sireBand(25), "21+");
  assert.equal(sireBand(null), null);
  assert.equal(mareBand(5), "3-5");
  assert.equal(mareBand(9), "6-9");
  assert.equal(mareBand(17), "14-17");
  assert.equal(mareBand(18), "18-20");
  assert.equal(mareBand(23), "21+");
  assert.equal(mareBand(2), null);
});

test("the SQL bands both ages the same way the code does, and takes the sire as a second argument", () => {
  const sql = ageGridSql({ hint: "/*+ MAX_EXECUTION_TIME(1000) */" });
  for (const b of [...SIRE_BANDS, ...MARE_BANDS]) assert.ok(sql.includes(`BETWEEN ${b.lo} AND ${b.hi} THEN '${b.key}'`), b.key);
  assert.match(sql, /r\.foalYear - 1 - s\.y/);
  assert.match(sql, /r\.foalYear - d\.y/);
  // Every runner is kept, ages known or not, so the population baseline comes from the same read.
  assert.match(sql, /LEFT JOIN d /);
  assert.match(sql, /SUM\(COALESCE\(sr\.rate, 0\)\)\s+AS expectedStakes/);
  assert.doesNotMatch(sql, /sireName = \?/);
  assert.match(ageGridSql({ sire: "DUBAWI" }), /AND sireName = \?/);
  assert.deepEqual(ageGridArgs(), ["2008-01-01"]);
  assert.deepEqual(ageGridArgs({ sire: "DUBAWI" }), ["2008-01-01", "DUBAWI"]);
});

test("the grid holds every cell, rates per runner, a sire-adjusted index, margins, and the population", () => {
  const rows = [
    { sireBand: "3-6", mareBand: "18-20", runners: 22, stakesWinners: 3, groupWinners: 2, group1Winners: 0, rated100: 5, rated110: 1, meanBest: 84, expectedStakes: 2 },
    { sireBand: "21+", mareBand: "18-20", runners: 13, stakesWinners: 0, groupWinners: 0, group1Winners: 0, rated100: 1, rated110: 0, meanBest: 72, expectedStakes: 1.3 },
    { sireBand: "21+", mareBand: "6-9", runners: 196, stakesWinners: 20, groupWinners: 12, group1Winners: 3, rated100: 45, rated110: 20, meanBest: 83, expectedStakes: 16 },
    { sireBand: null, mareBand: "6-9", runners: 50, stakesWinners: 5, groupWinners: 2, group1Winners: 1, rated100: 10, rated110: 3, meanBest: 80, expectedStakes: 2.5 },
    { sireBand: "7-10", mareBand: null, runners: 1000, stakesWinners: 25, groupWinners: 10, group1Winners: 2, rated100: 60, rated110: 20, meanBest: 70, expectedStakes: 30 },
  ];
  const g = ageGrid(rows);
  assert.equal(g.grid.length, SIRE_BANDS.length);
  assert.equal(g.grid[0].cells.length, MARE_BANDS.length);
  const young = g.grid.find((r) => r.sire === "3-6").cells.find((c) => c.mare === "18-20");
  assert.equal(young.runners, 22);
  assert.equal(young.stakesRate, 13.6);
  assert.equal(young.stakesIndex, 150);
  const old = g.grid.find((r) => r.sire === "21+");
  assert.equal(old.cells.find((c) => c.mare === "18-20").stakesRate, 0);
  assert.equal(old.cells.find((c) => c.mare === "18-20").stakesIndex, 0);
  assert.equal(old.all.runners, 209);
  assert.equal(old.all.stakesWinners, 20);
  // An empty cell is a cell with nothing in it, not a missing one.
  const empty = g.grid.find((r) => r.sire === "11-15").cells.find((c) => c.mare === "21+");
  assert.equal(empty.runners, 0);
  assert.equal(empty.stakesRate, null);
  assert.equal(empty.stakesIndex, null);
  // Margins by the mare's age count every runner whose dam's age is known, the sire's age known or not.
  assert.equal(g.byMare.find((m) => m.mare === "18-20").runners, 35);
  assert.equal(g.byMare.find((m) => m.mare === "6-9").runners, 246);
  assert.equal(g.unknownSire.find((m) => m.mare === "6-9").runners, 50);
  assert.equal(g.all.runners, 231);
  // The population is every runner: the baseline a rate is read against.
  assert.equal(g.unknownMare.runners, 1000);
  assert.equal(g.population.runners, 1281);
  assert.equal(g.population.stakesWinners, 53);
  assert.equal(g.population.stakesRate, 4.1);
});
