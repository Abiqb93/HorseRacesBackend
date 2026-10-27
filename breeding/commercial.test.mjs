import test from "node:test";
import assert from "node:assert/strict";

import { buildCommercial, fitHorizon, historyIndex, latestLine, marketByYear, pairsFor, sameSireMoves, stageAt, stageBucket, testFit } from "./commercial.mjs";

/**
 * A made-up European yearling market: the market's median rises 3% a year;
 * each sire's median moves with his Timeform score (a sire at 150 gains 20%
 * on the market a year, one at 70 loses 15%) and falls back a little when it
 * has run ahead of the market. Forty sires, first yearlings 2015 to 2022.
 */
function world({ noise = 0.02 } = {}) {
  const cells = [];
  const market = new Map();
  for (let y = 2014; y <= 2026; y += 1) {
    const m = 40000 * 1.03 ** (y - 2014);
    market.set(y, m);
    cells.push({ type: "yearling", region: "EU", year: y, median: Math.round(m), sold: 2000 });
    cells.push({ type: "foal", region: "EU", year: y, median: Math.round(m * 0.6), sold: 900 });
  }
  const yearlings = [];
  const history = {};
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647 - 0.5) * 2;
  };
  for (let s = 0; s < 40; s += 1) {
    const firstYearlings = 2015 + (s % 8);
    const first = firstYearlings - 1; // first crop foaled the year before
    const score = [70, 90, 100, 110, 150][s % 5];
    const name = s === 0 ? "St Mark's Basilica" : `Sire ${s}`;
    const key = s === 0 ? "ST MARKS BASILICA" : `SIRE ${s}`;
    const byYear = {};
    let rel = 0;
    for (let y = firstYearlings; y <= 2026; y += 1) {
      byYear[y] = { sold: 12, offered: 15, median: Math.round(market.get(y) * Math.exp(rel)), fee: 20000, multiple: null };
      const k = y - first - 1;
      const step = k >= 1 ? 0.5 * Math.log(score / 100) - 0.2 * rel : -0.05 - 0.2 * rel;
      rel += step + noise * rand();
    }
    yearlings.push({ sireKey: key, sire: name.toUpperCase(), byYear, fee: 20000, multiple: 2, premium: 0.1, trend: 0.05 });
    const st = [];
    for (let T = first + 2; T <= 2026; T += 1) st.push([T, T - first - 1, score, 30]);
    history[key] = { sire: name.toUpperCase(), first, s: st };
  }
  return { cells, yearlings, history, market };
}

test("stages and the market by year read as the fit groups them", () => {
  assert.deepEqual([-1, 0, 1, 2, 3, 4, 9].map(stageBucket), [0, 0, 1, 2, 3, 4, 4]);
  assert.equal(stageBucket(null), null);
  const { cells } = world();
  const m = marketByYear(cells, "yearling", "EU");
  assert.equal(m.get(2014), 40000);
  assert.equal(marketByYear(cells, "foal", "EU").get(2014), 24000);
  // A year with few sold (the foal sales not yet held) is not the market's.
  assert.equal(marketByYear([...cells, { type: "foal", region: "EU", year: 2027, median: 2500, sold: 40 }], "foal", "EU", { minSold: 200 }).has(2027), false);
  // From the forecast's first crop where it holds him, else from his first yearlings.
  assert.equal(stageAt({}, { first: 2020 }, 2024), 3);
  assert.equal(stageAt({ byYear: { 2021: { sold: 3 }, 2022: { sold: 5 } } }, null, 2024), 3);
});

test("the forecast's names join the sales' names: no apostrophes, no suffix", () => {
  const h = historyIndex({ "ST MARK'S BASILICA": { sire: "ST MARK'S BASILICA", first: 2021, s: [[2023, 1, 140.5, 30]] } });
  assert.ok(h.has("ST MARKS BASILICA"));
  assert.deepEqual(h.get("ST MARKS BASILICA").byYear.get(2023), { k: 1, score: 140.5, runners: 30 });
});

test("the market's move is the same sires' move, not the overall median's", () => {
  const rows = [
    { sireKey: "A", byYear: { 2024: { sold: 10, median: 10000 }, 2025: { sold: 10, median: 11000 } } },
    ...Array.from({ length: 10 }, (_, i) => ({ sireKey: `B${i}`, byYear: { 2024: { sold: 8, median: 20000 }, 2025: { sold: 8, median: 22000 } } })),
    { sireKey: "C", byYear: { 2024: { sold: 2, median: 5000 }, 2025: { sold: 9, median: 50000 } } },
  ];
  const moves = sameSireMoves(rows, 1);
  assert.ok(Math.abs(Math.exp(moves.get(2024)) - 1.1) < 1e-9, "the median sire rose 10%; the one with two sold is not counted");
});

test("the fit finds what moves prices: the Timeform score up, a median that ran ahead back", () => {
  const { cells, yearlings, history } = world();
  const market = marketByYear(cells);
  const pairs = pairsFor(yearlings, market, historyIndex(history), 1);
  assert.ok(pairs.length > 200, `${pairs.length} pairs`);
  const fit = fitHorizon(pairs);
  assert.ok(Math.abs(fit.pooled.b - 0.5) < 0.1, `slope on the score ${fit.pooled.b}`);
  assert.ok(Math.abs(fit.pooled.c + 0.2) < 0.08, `pull back ${fit.pooled.c}`);
  assert.ok(fit.buckets[0] && fit.buckets[4], "a fit for sires with no runners yet and for established ones");

  const t = testFit(pairs, 2025);
  assert.deepEqual(t.years, [2025, 2026]);
  assert.ok(t.medianError < t.medianErrorNoChange, `fit ${t.medianError} against no change ${t.medianErrorNoChange}`);
  assert.ok(t.directionRight > 0.8);
});

test("a sire scoring well above par is projected to gain on one at par, and the line is the latest year's", () => {
  const { cells, yearlings, history } = world();
  const lines = { "yearling|EU|2025": { a: 3, b: 0.7, n: 900 }, "yearling|EU|2026": { a: 3.1, b: 0.68, n: 800 }, "foal|EU|2026": { a: 2.9, b: 0.7, n: 300 }, "yearling|US|2026": { a: 9, b: 0.1, n: 50 } };
  assert.deepEqual(latestLine(lines), { year: 2026, a: 3.1, b: 0.68, n: 800 });
  const current = [
    { sire: "SIRE 4", stage: 5, score: 150 },
    { sire: "SIRE 2", stage: 5, score: 100 },
    { sire: "NEW SIRE", stage: 1, score: 120 },
  ];
  const fees = new Map([["SIRE 4", [[2023, 15000], [2024, 20000]]]]);
  const out = buildCommercial({ yearlings, cells, lines, history, current, fees, now: new Date("2026-10-27T00:00:00Z") });
  assert.deepEqual(out.targets, [2027, 2028, 2029]);
  assert.equal(out.line.year, 2026);
  const hot = out.sires.find((s) => s.key === "SIRE 4");
  const par = out.sires.find((s) => s.key === "SIRE 2");
  assert.equal(hot.basis.kind, "yearlings");
  assert.equal(hot.basis.year, 2026);
  const gain = (s) => s.projected[2].median / s.basis.median;
  assert.ok(gain(hot) > gain(par), `150 gains ${gain(hot).toFixed(2)}, par ${gain(par).toFixed(2)}`);
  assert.ok(hot.projected.every((p) => p.low <= p.median && p.median <= p.high));
  assert.deepEqual(hot.fees, [[2023, 15000], [2024, 20000]]);
  // A sire the sales have not met yet is listed from the forecast, with nothing to project from.
  const fresh = out.sires.find((s) => s.key === "NEW SIRE");
  assert.equal(fresh.projected, null);
  assert.equal(fresh.score, 120);
  assert.ok(out.model.test.pairs > 0);
  assert.equal(hot.scoreFrom, "now");

  // A proven sire the forecast no longer scores keeps his last score, not par.
  const proven = buildCommercial({
    yearlings,
    cells,
    lines,
    history: { ...history, "SIRE 4": { ...history["SIRE 4"], s: history["SIRE 4"].s.filter(([T]) => T <= 2022) } },
    current: [],
    now: new Date("2026-10-27T00:00:00Z"),
  }).sires.find((s) => s.key === "SIRE 4");
  assert.equal(proven.scoreUsed, 150);
  assert.equal(proven.scoreFrom, 2022);
});
