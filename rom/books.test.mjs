import assert from "node:assert/strict";
import { test } from "node:test";

import { buildIndex, codeOf, crossOf, detailOf, feeBand, insights, mareOf, nameKey, readableYears, rowOf, splitName } from "./books.mjs";

// A small return: a flat stallion with results, a jumps stallion whose foals
// never run on the flat, a newcomer, and years whose foals have not run yet.
function coverings() {
  const rows = [];
  const add = (n, r) => {
    for (let i = 0; i < n; i += 1) rows.push({ ...r, mare: r.mare ?? `${r.st} Mare ${r.y} ${i} (GB)`, myob: r.myob ?? 2008 });
  };
  for (const y of [2016, 2017, 2018, 2019]) {
    // Flat Sire: 100 mares a year at £20k, a third run, one in ten runners 95+
    add(10, { y, st: "Flat Sire (IRE)", fee: 20000, msire: "Dansili (GB)", mf: "LW", mbp: "G1W", ran: 1, r95: 1, r105: 1, r115: 0, rt: 108 });
    add(20, { y, st: "Flat Sire (IRE)", fee: 20000, msire: "Galileo (IRE)", mf: "W", ran: 1, r95: 0, r105: 0, r115: 0, rt: 80 });
    add(70, { y, st: "Flat Sire (IRE)", fee: 20000, msire: "Galileo (IRE)", mf: "Unr", ran: 0, r95: 0, r105: 0, r115: 0 });
    // Jumps Sire: 60 mares at £4k, none ever runs on the flat
    add(60, { y, st: "Jumps Sire (GER)", fee: 4000, msire: "Presenting (GB)", mf: "Unr", mnh: "W", ran: 0, r95: 0, r105: 0, r115: 0 });
  }
  // 2020: the foals have barely run (a later year in the files)
  add(100, { y: 2020, st: "Flat Sire (IRE)", fee: 25000, msire: "Galileo (IRE)", mf: "W", ran: 0, r95: 0, r105: 0, r115: 0, ret: "foal" });
  add(2, { y: 2020, st: "Flat Sire (IRE)", fee: 25000, msire: "Galileo (IRE)", ran: 1, r95: 0, r105: 0, r115: 0, ret: "barren" });
  add(40, { y: 2020, st: "Jumps Sire (GER)", fee: 4000, msire: "Presenting (GB)", mnh: "Pl", ran: 0, r95: 0, r105: 0, r115: 0 });
  // 2021: no results yet; a newcomer
  add(150, { y: 2021, st: "Flat Sire (IRE)", fee: 30000, msire: "Galileo (IRE)", mf: "W" });
  add(80, { y: 2021, st: "New Horse (GB)", fee: 10000, msire: "Dubawi (IRE)", mf: "SPl" });
  // one mare covered across the years, her foal of 2016 a 95+ horse
  rows.push({ y: 2016, st: "Flat Sire (IRE)", mare: "Prudenzia (IRE)", myob: 2005, msire: "Dansili (GB)", mdam: "Platonic (GB)", fee: 20000, ran: 1, r95: 1, r105: 1, r115: 1, rt: 116 });
  rows.push({ y: 2020, st: "Flat Sire (IRE)", mare: "Prudenzia (IRE)", myob: 2005, msire: "Dansili (GB)", fee: 25000, ret: "foal", fsex: "F", fdate: 20210304, ran: 0, r95: 0, r105: 0, r115: 0, rt: 0 });
  rows.push({ y: 2021, st: "New Horse (GB)", mare: "Prudenzia (IRE)", myob: 2005, msire: "Dansili (GB)", fee: 10000 });
  return rows;
}

test("names join without country or punctuation, and read as words", () => {
  assert.equal(nameKey("St Mark's Basilica (IRE)"), "st marks basilica");
  assert.deepEqual(splitName("Blue Point (IRE)"), { name: "Blue Point", country: "IRE" });
  assert.deepEqual(splitName("CRYSTAL OCEAN (GB)"), { name: "Crystal Ocean", country: "GB" });
  assert.equal(feeBand(20000), "20-40");
  assert.equal(feeBand(4999), "u5");
  assert.equal(feeBand(null), null);
});

test("results are read only for the years whose foals have run", () => {
  const r = readableYears(coverings());
  assert.equal(r.resultsThrough, 2019, "2020's foals have hardly run");
  assert.deepEqual(r.firstRunners, [2020]);
});

test("a book: its size, fee, mares, fertility and results, year by year", () => {
  const ix = buildIndex(coverings());
  const s = ix.stallions.get("flat sire");
  assert.equal(s.name, "Flat Sire");
  assert.equal(s.country, "IRE");
  assert.equal(s.years[2016].covers, 101);
  assert.equal(s.years[2016].fee, 20000);
  assert.equal(s.years[2017].q.bt, 10, "a listed winner is a black-type mare");
  assert.equal(s.years[2017].q.w, 30, "winners count the black-type winners too");
  assert.equal(s.years[2017].q.dbt, 10, "dam of a Group 1 winner");
  assert.equal(s.years[2017].res.ran, 30);
  assert.equal(s.years[2017].res.r95, 10);
  assert.equal(s.years[2017].res.rated, 30);
  assert.equal(s.years[2020].ret.foal, 101);
  assert.equal(s.years[2020].ret.barren, 2);
  // a rating of 0 is no rating
  assert.equal(s.years[2020].res.rated, 0);

  const row = rowOf(s, ix);
  assert.deepEqual(row.books, [101, 100, 100, 100, 103, 150]);
  assert.equal(row.latest, 150);
  assert.equal(row.prev, 103);
  assert.deepEqual(row.peak, { y: 2021, n: 150 });
  assert.equal(row.results.crops, 4, "only 2016–2019 are read for results");
  assert.equal(row.results.ran, 121);
  assert.equal(row.results.r95, 41);
  assert.equal(row.results.best.rt, 116);
  assert.equal(row.results.best.mare, "Prudenzia");
  assert.deepEqual(row.fertility, { n: 103, live: 101, none: 0 });
});

test("flat or jumps: by the foals' flat runners, else by the mares' jumps racing", () => {
  const ix = buildIndex(coverings());
  assert.equal(ix.stallions.get("flat sire").code, "flat");
  assert.equal(ix.stallions.get("jumps sire").code, "jumps");
  assert.equal(ix.stallions.get("new horse").code, "unknown", "no foals run and no mares' jumps record");
  assert.equal(codeOf({ years: { 2021: { q: { nhN: 20, nh: 4 } } } }, 2019), "jumps");
  assert.equal(codeOf({ years: { 2021: { q: { nhN: 20, nh: 0 } } } }, 2019), "flat");
});

test("a mare counts as proven once her 95+ foal was old enough to show it", () => {
  const ix = buildIndex(coverings());
  // Prudenzia's 2017 foal was 95+: proven at her 2020 covering, not at 2016's
  assert.equal(ix.stallions.get("flat sire").years[2020].q.proven, 1);
  assert.equal(ix.stallions.get("flat sire").years[2016].q.proven, 0);
  assert.equal(ix.stallions.get("new horse").years[2021].q.proven, 1);
});

test("his record with mares by one sire, over the readable years", () => {
  const ix = buildIndex(coverings());
  assert.deepEqual(crossOf(ix, "flat sire", "Dansili (GB)"), { sire: "Dansili", covers: 41, ran: 41, r95: 41, r105: 41, r115: 1 });
  assert.equal(crossOf(ix, "flat sire", "Galileo (IRE)").covers, 360, "2020's coverings are not read");
  assert.equal(crossOf(ix, "flat sire", "Nobody"), null);
  const d = detailOf(ix.stallions.get("flat sire"), ix);
  assert.equal(d.crosses[0].sire, "Dansili", "the cross with most 95+ horses first");
  assert.equal(d.years.find((y) => y.y === 2020).results.readable, false);
});

test("totals: each year's flat book, apart from the jumps", () => {
  const ix = buildIndex(coverings());
  const t2017 = ix.totals.find((t) => t.y === 2017);
  assert.equal(t2017.covers, 160);
  assert.equal(t2017.flat.covers, 100);
  assert.equal(t2017.jumps.covers, 60);
  assert.equal(t2017.flat.stallions10, 1);
  assert.equal(t2017.flat.books100, 1);
  assert.equal(t2017.flat.top10, 1);
});

test("a mare's coverings, with what came of each", () => {
  const ix = buildIndex(coverings());
  const m = mareOf(ix, "Prudenzia");
  assert.equal(m.found, true);
  assert.equal(m.yob, 2005);
  assert.equal(m.msire, "Dansili (GB)");
  assert.deepEqual(
    m.coverings.map((c) => [c.y, c.stallion, c.rt, c.r95, c.ret]),
    [
      [2016, "Flat Sire", 116, true, null],
      [2020, "Flat Sire", null, false, "foal"],
      [2021, "New Horse", null, null, null],
    ],
  );
  assert.equal(m.coverings[1].fdate, 20210304);
  assert.equal(mareOf(ix, "Nobody").found, false);
});

test("insights: what moved, the life of a book, and results against the fee", () => {
  const ix = buildIndex(coverings());
  const ins = insights(ix, { minPrev: 40, minRunners: 20 });
  assert.equal(ins.year, 2021);
  assert.deepEqual(ins.risers.map((r) => [r.name, r.before, r.now]), [["Flat Sire", 103, 150]]);
  assert.deepEqual(ins.newcomers.map((r) => r.name), ["New Horse"]);
  // Flat Sire's runners read against the £20k band: he is the band
  const over = ins.over.find((o) => o.name === "Flat Sire");
  assert.ok(Math.abs(over.ratio - 1) < 1e-9);
  assert.equal(ins.value[0].name, "Flat Sire");
  // £20k on each of the 401 mares covered in the readable years, over 41 horses rated 95+
  assert.equal(ins.value[0].per95, Math.round((20000 * 401) / 41));
  assert.ok(!ins.over.some((o) => o.name === "Jumps Sire"), "jumps stallions are left out");
});
