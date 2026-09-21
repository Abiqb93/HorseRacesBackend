import test from "node:test";
import assert from "node:assert/strict";

import {
  NICK_AGGREGATE,
  crossKey,
  describeCross,
  parentLinksFromPedigree,
  sireLine,
  studKey,
  thinnessNotes,
} from "./nicks.mjs";

test("a cross is keyed on both sides in stud-book form", () => {
  assert.equal(crossKey("Frankel (GB)", "*Kingman"), "FRANKEL|KINGMAN");
  assert.equal(crossKey(" sea the stars ", "cape cross (IRE)"), "SEA THE STARS|CAPE CROSS");
  assert.equal(studKey(null), "");
});

test("a cross nobody has tried has no strike rate, which is not a strike rate of nought", () => {
  const untried = describeCross([], { sire: "Frankel", damsire: "Kendargent" });
  assert.equal(untried.runners, 0);
  assert.equal(untried.swPct, null);
  assert.equal(untried.sire, "FRANKEL");

  const failed = describeCross([{ runners: 20, winners: 12, stakes_winners: 0, group_winners: 0, g1_winners: 0, black_type: 1 }]);
  assert.equal(failed.swPct, 0);
});

test("the driver's DECIMAL sums arrive as strings and must not be summed as text", () => {
  const d = describeCross([
    { runners: "9", winners: "6", stakes_winners: "1", group_winners: "0", g1_winners: "0", black_type: "2", crop_from: 2015, crop_to: 2022 },
    { runners: "31", winners: "19", stakes_winners: "3", group_winners: "2", g1_winners: "1", black_type: "5", crop_from: 2014, crop_to: 2023 },
  ]);
  assert.equal(d.runners, 40);
  assert.equal(d.stakesWinners, 4);
  assert.equal(d.g1Winners, 1);
  assert.equal(d.swPct, 10);
  assert.equal(d.cropFrom, 2014);
  assert.equal(d.cropTo, 2023);
  assert.equal(d.basis, "runners");
  assert.equal(d.sources, 2);
});

test("a sire line is the horse and his sons who stand, not every descendant", () => {
  const parents = new Map([
    ["FRANKEL", "GALILEO"],
    ["CHURCHILL", "GALILEO"],
    ["GLENEAGLES", "GALILEO"],
    // A grandson: Galileo's line, but not one generation from him.
    ["WESTOVER", "FRANKEL"],
    ["KINGMAN", "INVINCIBLE SPIRIT"],
  ]);
  const line = sireLine("Galileo", parents);
  assert.deepEqual(new Set(line), new Set(["GALILEO", "FRANKEL", "CHURCHILL", "GLENEAGLES"]));
  assert.ok(!line.includes("WESTOVER"));
  // A horse nobody has a sire for is a line of one, not an error.
  assert.deepEqual(sireLine("Kendargent", parents), ["KENDARGENT"]);
  assert.deepEqual(sireLine(null, parents), []);
});

test("a pedigree gives up every horse-and-sire pair it holds, and a hole gives none", () => {
  const links = parentLinksFromPedigree({
    horse: { name: "Circios (IRE)" },
    ancestors: [
      { path: "S", name: "Kingman" },
      { path: "SS", name: "Invincible Spirit" },
      { path: "D", display_name: "Could it be Love (USA)" },
      { path: "DS", name: "War Front" },
      // The dam's dam is missing, so nothing below her can be attributed.
      { path: "DDS", name: "Arch" },
    ],
  });
  const map = new Map(links.map((l) => [l.horse, l.sire]));
  assert.equal(map.get("CIRCIOS"), "KINGMAN");
  assert.equal(map.get("KINGMAN"), "INVINCIBLE SPIRIT");
  assert.equal(map.get("COULD IT BE LOVE"), "WAR FRONT");
  // "DD" is not in the chart, so "DDS" is nobody's sire here.
  assert.ok(![...map.values()].includes("ARCH"));
  assert.deepEqual(parentLinksFromPedigree({}), []);
});

test("every figure carries the reason it is a floor", () => {
  const notes = thinnessNotes({ coverage: 0.42, cropFrom: 2014, cropTo: 2024 });
  assert.ok(notes.some((n) => /not foals/.test(n)));
  assert.ok(notes.some((n) => /2014 to 2024/.test(n)));
  assert.ok(notes.some((n) => /42%.*floor/.test(n)));
  // Good coverage says so rather than warning about it.
  const good = thinnessNotes({ coverage: 0.95 });
  assert.ok(good.some((n) => /95%/.test(n) && !/floor/.test(n)));
});

test("the aggregate joins the dam to her own row, which is where the damsire lives", () => {
  const sql = NICK_AGGREGATE("nick_stats_next");
  assert.match(sql, /JOIN horse_parents p ON p\.horse_key = h\.dam_key/);
  assert.match(sql, /GROUP BY h\.sire_key, p\.sire_key/);
  // A stakes winner is a stakes winner at any level; counting only s_wins
  // would drop every horse whose only black type is a Group race.
  assert.match(sql, /SUM\(h\.s_wins > 0 OR h\.g_wins > 0 OR h\.g1_wins > 0\)/);
});
