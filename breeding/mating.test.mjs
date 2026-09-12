import test from "node:test";
import assert from "node:assert/strict";

import { describe, pickOwnRow, quantile, studBookName, summariseHorse } from "./mating.mjs";

test("a name is written the way the results table writes it", () => {
  assert.equal(studBookName("=Frankel (GB)"), "FRANKEL");
  assert.equal(studBookName("  Sadler's Wells (USA) "), "SADLER'S WELLS");
  assert.equal(studBookName("Dubawi"), "DUBAWI");
  assert.equal(studBookName(null), "");
});

test("a horse's best figure is the higher of its two scales, and 999 never reaches it", () => {
  // The SQL filters the sentinel; the mapper sees only in-scale figures.
  const h = summariseHorse({ horseName: "X", bestMaster: 104, bestPerformance: 109, runs: "7", wins: "2", foaled: "2019-03-02T00:00:00Z" });
  assert.equal(h.best, 109);
  assert.equal(h.runs, 7);
  assert.equal(h.wins, 2);
  assert.equal(h.foalingYear, 2019);
  const unrated = summariseHorse({ horseName: "Y", bestMaster: null, bestPerformance: null });
  assert.equal(unrated.best, null);
});

test("quantiles interpolate and an empty group has none", () => {
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([10], 0.5), 10);
  assert.equal(quantile([10, 20], 0.5), 15);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.25), 2);
});

test("describe counts the rated, the winners and the black type", () => {
  const d = describe([
    { best: 80, wins: 1, stakesWins: 0, groupWins: 0, group1Wins: 0 },
    { best: 100, wins: 3, stakesWins: 1, groupWins: 1, group1Wins: 0 },
    { best: null, wins: 0, stakesWins: 0, groupWins: 0, group1Wins: 0 },
  ]);
  assert.equal(d.n, 3);
  assert.equal(d.rated, 2);
  assert.equal(d.mean, 90);
  assert.equal(d.median, 90);
  assert.equal(d.winners, 2);
  assert.equal(d.stakesWinners, 1);
  assert.equal(d.groupWinners, 1);
  assert.equal(d.group1Winners, 0);
  assert.equal(describe([]).mean, null);
});

test("the mare's own row is picked by year, then by sire, then by career", () => {
  const rows = [
    { name: "ENABLE", foalingYear: 2008, sire: null, runs: 1 },
    { name: "ENABLE", foalingYear: 2014, sire: "NATHANIEL", runs: 20 },
  ];
  assert.equal(pickOwnRow(rows, { year: 2014 }).foalingYear, 2014);
  assert.equal(pickOwnRow(rows, { sire: "Nathaniel (GB)" }).foalingYear, 2014);
  assert.equal(pickOwnRow(rows, {}).foalingYear, 2014);
  assert.equal(pickOwnRow([], {}), null);
});

test("the foaling year comes from the grouped column, never from a namesake's row", () => {
  assert.equal(summariseHorse({ horseName: "X", foalYear: "2014", foaled: "2008-03-12" }).foalingYear, 2014);
  assert.equal(summariseHorse({ horseName: "X", foaled: "2019-05-01T00:00:00Z" }).foalingYear, 2019);
});
