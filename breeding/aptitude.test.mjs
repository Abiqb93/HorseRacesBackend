import test from "node:test";
import assert from "node:assert/strict";

import {
  ageBucket,
  describeGroup,
  foldCells,
  furlongBucket,
  groupQueries,
  ratingDistribution,
  sexBucket,
  totals,
} from "./aptitude.mjs";

test("a trip is counted in whole furlongs, with the ends open", () => {
  assert.equal(furlongBucket("11.93"), 12);
  assert.equal(furlongBucket(5.4), 5);
  // Anything shorter than five joins five; anything past sixteen joins sixteen.
  assert.equal(furlongBucket("4.5"), 5);
  assert.equal(furlongBucket("21.9"), 16);
  assert.equal(furlongBucket(""), null);
  assert.equal(furlongBucket(null), null);
  assert.equal(furlongBucket("abc"), null);
});

test("ages are the trade's three: juvenile, classic generation, older", () => {
  assert.equal(ageBucket(2), "2");
  assert.equal(ageBucket("3"), "3");
  assert.equal(ageBucket(4), "4+");
  assert.equal(ageBucket(9), "4+");
  assert.equal(ageBucket(1), null);
  assert.equal(ageBucket(null), null);
});

test("sex is read the way Timeform writes it at the running", () => {
  for (const code of ["f", "m", "F"]) assert.equal(sexBucket(code), "F");
  for (const code of ["c", "g", "h", "r"]) assert.equal(sexBucket(code), "M");
  assert.equal(sexBucket(""), null);
  assert.equal(sexBucket("x"), null);
});

test("grouped rows fold into one cell per furlong, age and sex", () => {
  const cells = foldCells([
    { f: 5, age: 2, sex: "c", runs: 10, wins: 2, places: 4, stakesWins: 1, groupWins: 0 },
    // 4.6f rounds to 5 at the database; 4 is folded into the five column here.
    { f: 4, age: 2, sex: "g", runs: 3, wins: 1, places: 1, stakesWins: 0, groupWins: 0 },
    { f: 12, age: 5, sex: "m", runs: 7, wins: 3, places: 5, stakesWins: 2, groupWins: 1 },
    { f: 12, age: 4, sex: "f", runs: 1, wins: 1, places: 1, stakesWins: 0, groupWins: 0 },
    // Unrecorded sex still counts as a run, under its own label.
    { f: 8, age: 3, sex: null, runs: 2, wins: 0, places: 1, stakesWins: 0, groupWins: 0 },
    // A yearling row is not a run on the flat anyone reads.
    { f: 6, age: 1, sex: "c", runs: 9, wins: 9, places: 9, stakesWins: 0, groupWins: 0 },
  ]);
  assert.deepEqual(
    cells.map((c) => [c.f, c.age, c.sex, c.runs, c.wins]),
    [
      [5, "2", "M", 13, 3],
      [8, "3", "U", 2, 0],
      [12, "4+", "F", 8, 4],
    ],
  );
  assert.deepEqual(totals(cells), { runs: 23, wins: 7, places: 12, stakesWins: 3, groupWins: 1 });
});

test("a rating distribution carries the five numbers of a box plot and bins for a violin", () => {
  const d = ratingDistribution([60, 70, 80, 90, 100, 999, 0, null, "85"]);
  // 999 and 0 are not ratings; "85" is.
  assert.equal(d.n, 6);
  assert.equal(d.min, 60);
  assert.equal(d.max, 100);
  assert.equal(d.median, 82.5);
  assert.equal(d.q1, 72.5);
  assert.equal(d.q3, 88.75);
  assert.equal(d.bins[0].from, 20);
  assert.equal(d.bins.at(-1).to, 140);
  assert.equal(d.bins.reduce((a, b) => a + b.n, 0), 6);
  // An empty group has a shape of nothing, not zeroes that look like horses.
  const none = ratingDistribution([]);
  assert.equal(none.n, 0);
  assert.equal(none.median, null);
});

test("both queries are flat only and carry the execution cap", () => {
  const q = groupQueries("sireName = ?", "/*+ MAX_EXECUTION_TIME(9000) */");
  for (const sql of [q.cells, q.ratings]) {
    assert.match(sql, /raceType = 'Flat'/);
    assert.match(sql, /MAX_EXECUTION_TIME\(9000\)/);
    assert.match(sql, /WHERE sireName = \?/);
  }
  assert.match(q.cells, /GROUP BY f, age, sex/);
  assert.match(q.ratings, /GROUP BY horseName, foalYear/);
  assert.match(q.ratings, /BETWEEN 1 AND 140/);
});

test("a group is its cells, its totals and its horses' ratings", () => {
  const g = describeGroup({
    cellRows: [{ f: 8, age: 3, sex: "c", runs: 4, wins: 1, places: 2, stakesWins: 0, groupWins: 0 }],
    ratingRows: [{ best: 88 }, { best: 0 }, { best: 101 }],
  });
  assert.equal(g.horses, 3);
  assert.equal(g.runs, 4);
  assert.equal(g.ratings.n, 2);
  assert.equal(g.timedOut, false);
  assert.equal(describeGroup({ timedOut: true }).timedOut, true);
});
