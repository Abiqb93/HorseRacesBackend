import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  COLUMNS,
  classScore,
  describeWorldwide,
  readCrop,
  rowFromRecord,
  splitCsvLine,
  summariseWorldwide,
} from "./horses.mjs";

test("a CSV line splits on commas and respects quotes", () => {
  assert.deepEqual(splitCsvLine("A,B,,D"), ["A", "B", "", "D"]);
  assert.deepEqual(splitCsvLine('"Smith, John",x,"say ""hi"""'), ["Smith, John", "x", 'say "hi"']);
});

test("a file record becomes a table row in column order, with stud-book keys", () => {
  const row = rowFromRecord({
    HorseName: "NATURE STRIP", FoalingCountry: "AUS", FoalingYear: "2014", Sex: "G",
    Sire: "NICCONI (AUS)", Dam: "STRIKELINE (AUS)", LateName: "", AllRuns: "41", LSWins: "0", LSTop3: "0",
    SWins: "16", STop3: "23", GWins: "14", GTop3: "21", G1Wins: "9", G1Top3: "12", TurfvsAW: "1",
    TurfRuns: "41", TurfWins: "20", TurfMinWinDist: "1000", TurfMaxWinDist: "1200", TurfPrizemoneyUSD: "15263924",
    TurfBestDistance: "1200", TurfBestGoing: "S5", AWRuns: "0", AWWins: "0", AWMinWinDist: "0", AWMaxWinDist: "0",
    AWPrizemoneyUSD: "0", AWBestDistance: "NULL", AWBestGoing: "NULL",
  });
  assert.equal(row.length, COLUMNS.length);
  const at = (c) => row[COLUMNS.indexOf(c)];
  assert.equal(at("horse_name"), "NATURE STRIP");
  assert.equal(at("sire"), "NICCONI (AUS)");
  assert.equal(at("sire_key"), "NICCONI");
  assert.equal(at("dam_key"), "STRIKELINE");
  assert.equal(at("late_name"), null);
  assert.equal(at("g1_wins"), 9);
  assert.equal(at("aw_best_dist"), null);
  assert.equal(at("turf_prize_usd"), 15263924);
});

test("the real 2024 crop file streams and every record has the columns the mapper needs", async () => {
  const file = fileURLToPath(new URL("./data/horses-2024.csv.gz", import.meta.url));
  let n = 0;
  let bad = 0;
  for await (const rec of readCrop(file)) {
    n += 1;
    const row = rowFromRecord(rec);
    if (!row[0] || row[2] !== 2024 || !row[5]) bad += 1;
  }
  assert.equal(n, 4382);
  assert.equal(bad, 0);
});

test("a group describes its black type, surface and distance", () => {
  const h = (o) => summariseWorldwide({ horse_name: "X", foaling_year: 2020, foaling_country: "GB", runs: 5, ...o });
  const d = describeWorldwide([
    h({ turf_wins: 2, s_wins: 1, g_wins: 1, turf_runs: 5, turf_best_dist: 1200 }),
    h({ turf_wins: 0, turf_runs: 3, aw_runs: 2, aw_best_dist: 1600, s_top3: 1 }),
    h({ aw_wins: 1, aw_runs: 5, aw_best_dist: 2400 }),
  ]);
  assert.equal(d.n, 3);
  assert.equal(d.winners, 2);
  assert.equal(d.stakesWinners, 1);
  assert.equal(d.groupWinners, 1);
  assert.equal(d.blackTypePlaced, 2);
  assert.equal(Number(d.turfShare.toFixed(3)), Number((8 / 15).toFixed(3)));
  assert.deepEqual(d.distance.map((b) => b.n), [1, 0, 1, 0, 1, 0]);
  assert.equal(d.byCountry[0].country, "GB");
});

test("class orders a Group 1 winner above everything", () => {
  const g1 = summariseWorldwide({ horse_name: "A", g1_wins: 1, turf_wins: 1 });
  const sw = summariseWorldwide({ horse_name: "B", s_wins: 3, turf_wins: 6 });
  assert.ok(classScore(g1) > classScore(sw));
});
