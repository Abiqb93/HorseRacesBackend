import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SIRES,
  juvenileArgs,
  juvenileSires,
  juvenileSql,
  parseSireList,
  sireRunnersSql,
  summariseSires,
} from "./sires.mjs";

const row = (o) => ({
  horseName: o.name,
  foalYear: o.year ?? 2020,
  sireName: o.sire,
  sireKeyRaw: o.sire,
  damName: o.dam ?? "SOME DAM",
  damsireName: null,
  sex: o.sex ?? "c",
  foaled: null,
  bestMaster: o.master ?? null,
  bestPerformance: o.perf ?? null,
  runs: o.runs ?? 3,
  wins: o.wins ?? 0,
  stakesWins: o.sw ?? 0,
  groupWins: o.gw ?? 0,
  group1Wins: 0,
  lastRun: null,
});

test("a sire list is read as stud-book names, each once, and capped", () => {
  assert.deepEqual(parseSireList("Dubawi|Frankel (GB)|*Sea The Stars|dubawi"), ["DUBAWI", "FRANKEL", "SEA THE STARS"]);
  assert.deepEqual(parseSireList("Kingman, Night of Thunder"), ["KINGMAN", "NIGHT OF THUNDER"]);
  assert.deepEqual(parseSireList(""), []);
  const many = Array.from({ length: MAX_SIRES + 20 }, (_, i) => `Sire ${i}`).join("|");
  assert.equal(parseSireList(many).length, MAX_SIRES);
});

test("the bulk query groups by sire and horse, with one placeholder per sire", () => {
  const sql = sireRunnersSql(3, "/*+ X */");
  assert.match(sql, /SELECT \/\*\+ X \*\/ sireName AS sireKeyRaw, horseName,/);
  assert.match(sql, /sireName IN \(\?, \?, \?\)/);
  assert.match(sql, /GROUP BY sireName, horseName, foalYear/);
});

test("each sire asked about is summarised on the best figure, and one with none says so", () => {
  const out = summariseSires(
    [
      row({ name: "A", sire: "Dubawi", master: 100, perf: 110 }),
      row({ name: "B", sire: "DUBAWI", master: 90 }),
      row({ name: "C", sire: "Dubawi" }), // unrated
      row({ name: "D", sire: "Frankel", perf: 120 }),
      row({ name: "E", sire: "Somebody Else", perf: 130 }), // not asked for
    ],
    ["DUBAWI", "FRANKEL", "KINGMAN"],
  );
  assert.deepEqual(Object.keys(out), ["DUBAWI", "FRANKEL", "KINGMAN"]);
  assert.equal(out.DUBAWI.n, 3);
  assert.equal(out.DUBAWI.rated, 2);
  assert.equal(out.DUBAWI.mean, 100); // 110 and 90
  assert.deepEqual(out.DUBAWI.top.map((h) => h.name), ["A", "B"]);
  assert.equal(out.FRANKEL.max, 120);
  assert.equal(out.KINGMAN.rated, 0);
  assert.equal(out.KINGMAN.mean, null);
});

test("a season's two-year-olds are those foaled two years before it, running in it", () => {
  assert.deepEqual(juvenileArgs(2026), ["2024-01-01", "2025-01-01", "2026-01-01", "2027-01-01"]);
  const sql = juvenileSql();
  assert.match(sql, /foalingDate >= \? AND foalingDate < \?/);
  assert.match(sql, /meetingDate >= \? AND meetingDate < \?/);
});

test("juvenile sires rank on their best, then their best three, then their depth", () => {
  const list = juvenileSires([
    row({ name: "Star", sire: "Sire A", perf: 115, wins: 2, sw: 1 }),
    row({ name: "A2", sire: "Sire A", perf: 70 }),
    row({ name: "B1", sire: "Sire B", perf: 110 }),
    row({ name: "B2", sire: "Sire B", perf: 105 }),
    row({ name: "B3", sire: "Sire B", perf: 100, wins: 1 }),
    row({ name: "C1", sire: "Sire C", perf: 110 }),
    row({ name: "C2", sire: "Sire C", perf: 80 }),
    row({ name: "D1", sire: "Sire D" }), // unrated only
  ]);
  assert.deepEqual(list.map((s) => s.sire), ["SIRE A", "SIRE B", "SIRE C"]);
  const b = list.find((s) => s.sire === "SIRE B");
  assert.equal(b.top3Mean, 105);
  assert.equal(b.over90, 3);
  assert.equal(b.over100, 3);
  assert.equal(b.winners, 1);
  const a = list[0];
  assert.equal(a.best, 115);
  assert.equal(a.stakesWinners, 1);
  assert.equal(a.horses[0].name, "Star");
  // A sire whose juveniles are all unrated is left off at the default floor.
  assert.equal(list.some((s) => s.sire === "SIRE D"), false);
  assert.equal(juvenileSires([], {}).length, 0);
});
