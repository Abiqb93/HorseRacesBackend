/**
 * The commercial forecast: where a stallion's yearling prices are heading,
 * read off how past sires' prices moved with their runners.
 *
 * (27 October 2026: "We want to look at their sales prices, yearlings and
 * foals and if they're multiples of the stud fee, see how that could
 * project yearling sales prices next year or the year after." And: "a table
 * ... to then project which stallions are going to become hot commercially.
 * So really what we're trying to do is forecast commercial growth of a
 * stallion.")
 *
 * The reading, for one kind of sale (European yearlings) at a time:
 *
 *   move      For every past sire with five or more sold in a year and again
 *             h years later: how far his median moved beyond the market's
 *             own move over those years, on the log scale. The market's move
 *             is the median move among every sire sold in both years (a
 *             same-sire index), not the change in the overall median, which
 *             moves with which sales are held: the European yearling median
 *             rose 39% from 2024 to 2025 on the sales held, mostly because
 *             of which sales those were.
 *   drivers   His Timeform score at the time (the stallion forecast's
 *             index on par for his stage, breeding/forecast.mjs: 100 is
 *             par) and how far his median sat above the market's. The first
 *             is what the racecourse is saying; the second is how much of
 *             it the price has already taken in, which pulls a median that
 *             ran ahead back towards the market.
 *   fit       move = a + b·log(score/100) + c·log(median/market), least
 *             squares, for each stage of his career (no runners yet, years
 *             one, two, three, four and on) and each horizon of one to four
 *             years; a stage with too few sires borrows b and c from all of
 *             them and keeps its own a.
 *   test      The one-year fit made on the years before the last two, and
 *             judged on those two: how close it came, against a call that
 *             the median moves with the market.
 *
 * A projection starts from his last three sale years together (each
 * carried to the latest by the market's same-sire moves, weighted by how
 * many sold), not one year: Golden Horn's 2026 median was five yearlings.
 * Each target year is read off the fit for that horizon directly, the path
 * kept from turning back or running past the three-year fit. Moving a year
 * at a time on the one-year fit compounded what the longer fits show does
 * not compound: Golden Horn £26k to £57k by 2029, City Light £14k to £41k
 * (27 October 2026: "the data isn't holding up for me").
 *
 * A proven sire (seven seasons of runners or more) is held at his level:
 * the market has his record, and the fits are for sires it is still
 * learning. A Timeform score read on a sire whose runners mostly race
 * abroad counts for as much of him as those runners are: City Light's 167
 * was read on 14 of his 225 runners, the ones sent to Britain and Ireland.
 * The market is held where it is: today's money. The line (log price on
 * log fee, the latest year of the kind) is returned as well: it is what a
 * mare's fee sweet spot is worked out on.
 *
 * Pure: the routes hand in the sales tables and the forecast's history.
 */

import { nameKey } from "../sales/normalise.mjs";

export const HORIZONS = [1, 2, 3, 4];
/** A year's median counts when this many sold. */
export const MIN_SOLD = 5;
/** A stage fits its own slopes from this many pairs; fewer borrow the pooled ones. */
export const MIN_STAGE_PAIRS = 60;

const goodYear = (v, minSold = MIN_SOLD) => v && v.sold >= minSold && v.median > 0;
const round = (v, dp = 3) => (Number.isFinite(v) ? Number(v.toFixed(dp)) : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** From this many seasons of runners a sire is proven, and held at his level. */
export const PROVEN_STAGE = 7;
/** A Timeform score counts in full once his British and Irish runners are this share of all his runners. */
export const HOME_SHARE_FULL = 0.5;
/** The sale years a projection starts from. */
export const BASIS_YEARS = 3;

/** A stage of career as the fit groups it: 0 no runners yet, 1–3, and 4 for four and on. */
export const stageBucket = (k) => (k === null || k === undefined ? null : k <= 0 ? 0 : k >= 4 ? 4 : k);

/** The market's median by year for one kind and region, from the sales market cells. */
export function marketByYear(cells = [], type = "yearling", region = "EU", { minSold = 0 } = {}) {
  const out = new Map();
  for (const c of cells) if (c.type === type && c.region === region && c.median > 0 && (Number(c.sold) || 0) >= minSold) out.set(Number(c.year), Number(c.median));
  return out;
}

/**
 * The market's move from year y to y + h, as a same-sire index: the median
 * of log(median in y + h / median in y) over every sire with enough sold in
 * both. `Map(y -> move)`.
 */
export function sameSireMoves(rows, h, { minSold = MIN_SOLD } = {}) {
  const by = new Map();
  for (const row of rows ?? []) {
    for (const [ys, v1] of Object.entries(row.byYear ?? {})) {
      const y = Number(ys);
      const v2 = row.byYear[String(y + h)] ?? row.byYear[y + h];
      if (!goodYear(v1, minSold) || !goodYear(v2, minSold)) continue;
      if (!by.has(y)) by.set(y, []);
      by.get(y).push(Math.log(v2.median / v1.median));
    }
  }
  const out = new Map();
  for (const [y, xs] of by) {
    if (xs.length < 10) continue;
    const s = [...xs].sort((a, b) => a - b);
    out.set(y, s[Math.floor(s.length / 2)]);
  }
  return out;
}

/** The forecast's history by sales name key: `Map(key -> { first, byYear: Map(T -> { k, score, runners }) })`. */
export function historyIndex(history = {}) {
  const out = new Map();
  for (const h of Object.values(history ?? {})) {
    const key = nameKey(h.sire);
    if (!key) continue;
    const byYear = new Map();
    for (const [T, k, score, runners] of h.s ?? []) byYear.set(Number(T), { k: Number(k), score: Number.isFinite(score) ? Number(score) : null, runners: Number(runners) || 0 });
    out.set(key, { first: Number(h.first) || null, byYear });
  }
  return out;
}

/**
 * His stage in year `y`: from the forecast where it holds him, else from
 * his first yearlings at the sales (a yearling sold in Y was foaled in
 * Y - 1, so his first crop runs at two in Y + 1).
 */
export function stageAt(row, hist, y) {
  if (hist?.first) return y - hist.first - 1;
  const years = Object.entries(row?.byYear ?? {})
    .filter(([, v]) => v.sold > 0)
    .map(([yy]) => Number(yy));
  if (!years.length) return null;
  const firstYearlings = Math.min(...years);
  return y - firstYearlings;
}

/**
 * The pairs a horizon is fitted on: a sire's median in year y and in y + h,
 * each with five sold, the move beyond the market's, and the two drivers.
 * A sire with runners but no Timeform score that year is left out: the
 * fit would read his silence as par.
 */
export function pairsFor(rows, market, hist, h, { minSold = MIN_SOLD, moves = sameSireMoves(rows, h, { minSold }) } = {}) {
  const out = [];
  for (const row of rows ?? []) {
    const hi = hist.get(row.sireKey) ?? null;
    for (const [ys, v1] of Object.entries(row.byYear ?? {})) {
      const y = Number(ys);
      const v2 = row.byYear[String(y + h)] ?? row.byYear[y + h];
      if (!goodYear(v1, minSold) || !goodYear(v2, minSold)) continue;
      const m1 = market.get(y);
      const move = moves.get(y);
      if (!m1 || move === undefined) continue;
      const k = stageAt(row, hi, y);
      const bucket = stageBucket(k);
      if (bucket === null) continue;
      const score = hi?.byYear.get(y)?.score ?? null;
      if (bucket > 0 && !score) continue;
      out.push({
        key: row.sireKey,
        y,
        h,
        bucket,
        x: score ? Math.log(score / 100) : 0,
        rel: Math.log(v1.median / m1),
        d: Math.log(v2.median / v1.median) - move,
      });
    }
  }
  return out;
}

/** Least squares of d on [1, x, rel]; null when the pairs cannot carry it. */
function ols(ps) {
  if (ps.length < 8) return null;
  // Normal equations for three unknowns.
  const S = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const t = [0, 0, 0];
  for (const p of ps) {
    const v = [1, p.x, p.rel];
    for (let i = 0; i < 3; i += 1) {
      t[i] += v[i] * p.d;
      for (let j = 0; j < 3; j += 1) S[i][j] += v[i] * v[j];
    }
  }
  const det = (m) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(S);
  if (Math.abs(D) < 1e-9) return null;
  const solve = (i) => det(S.map((row, r) => row.map((c, j) => (j === i ? t[r] : c))));
  return { a: solve(0) / D, b: solve(1) / D, c: solve(2) / D };
}

/**
 * The fit for one horizon: slopes from all the pairs, then each stage's
 * own where it has enough pairs, its intercept always its own (the stage
 * is most of what tells a young sire's prices which way they go).
 */
export function fitHorizon(ps) {
  const pooled = ols(ps);
  if (!pooled) return null;
  const buckets = {};
  for (const b of [0, 1, 2, 3, 4]) {
    const mine = ps.filter((p) => p.bucket === b);
    if (!mine.length) continue;
    const own = mine.length >= MIN_STAGE_PAIRS ? ols(mine) : null;
    const slope = own ?? pooled;
    const a = mean(mine.map((p) => p.d - slope.b * p.x - slope.c * p.rel));
    const resid = mine.map((p) => p.d - (a + slope.b * p.x + slope.c * p.rel));
    buckets[b] = {
      a: round(a, 4),
      b: round(slope.b, 4),
      c: round(slope.c, 4),
      n: mine.length,
      own: Boolean(own),
      sd: round(Math.sqrt(mean(resid.map((r) => r * r)) ?? 0), 4),
    };
  }
  return { pooled: { a: round(pooled.a, 4), b: round(pooled.b, 4), c: round(pooled.c, 4), n: ps.length }, buckets };
}

const predict = (fit, bucket, x, rel) => {
  const f = fit?.buckets?.[bucket] ?? (fit ? { ...fit.pooled, sd: null } : null);
  return f ? { d: f.a + f.b * x + f.c * rel, sd: f.sd } : null;
};

/**
 * The one-year fit judged on years it did not see: fitted on pairs ending
 * before `fromYear`, scored on the pairs ending in or after it. Errors are
 * in the median's own terms (a log error of 0.2 is about 22% out).
 */
export function testFit(ps, fromYear) {
  const train = ps.filter((p) => p.y + p.h < fromYear);
  const test = ps.filter((p) => p.y + p.h >= fromYear);
  const fit = fitHorizon(train);
  if (!fit || !test.length) return null;
  const err = [];
  const naive = [];
  let direction = 0;
  let called = 0;
  for (const p of test) {
    const g = predict(fit, p.bucket, p.x, p.rel);
    if (!g) continue;
    err.push(Math.abs(g.d - p.d));
    naive.push(Math.abs(p.d));
    if (Math.abs(p.d) > 0.1) {
      called += 1;
      if (Math.sign(g.d) === Math.sign(p.d)) direction += 1;
    }
  }
  const medianOf = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };
  return {
    pairs: err.length,
    years: [...new Set(test.map((p) => p.y + p.h))].sort(),
    medianError: round(Math.exp(medianOf(err)) - 1, 3),
    medianErrorNoChange: round(Math.exp(medianOf(naive)) - 1, 3),
    directionRight: called ? round(direction / called, 3) : null,
    moves: called,
  };
}

/**
 * Where a projection starts: his medians over the last BASIS_YEARS sale
 * years, each carried to the latest year by the market's same-sire moves
 * (`oneYear`: year -> log move to the next), averaged on the log scale and
 * weighted by how many sold. Null with fewer than MIN_SOLD sold in all.
 */
export function basisOf(years, latestYear, oneYear = new Map()) {
  const used = (years ?? []).filter(([y, v]) => y > latestYear - BASIS_YEARS && y <= latestYear && v?.sold > 0 && v.median > 0);
  const sold = used.reduce((a, [, v]) => a + v.sold, 0);
  if (sold < MIN_SOLD) return null;
  let sum = 0;
  for (const [y, v] of used) {
    let carry = 0;
    for (let t = y; t < latestYear; t += 1) carry += oneYear.get(t) ?? 0;
    sum += v.sold * (Math.log(v.median) + carry);
  }
  return { kind: "yearlings", year: latestYear, median: Math.round(Math.exp(sum / sold)), sold, years: used.map(([y]) => y) };
}

/** How much of a sire his British and Irish runners are, as the weight his Timeform score is read at. */
export function homeWeight(homeRunners, allRunners) {
  if (!(homeRunners > 0) || !(allRunners >= 20)) return 1;
  return Math.min(1, homeRunners / allRunners / HOME_SHARE_FULL);
}

/**
 * The moves to each target, kept on one road: none turns back on the one
 * before it or runs past where the last ends (fitted separately, the
 * horizons can disagree in the middle).
 */
export function steadyPath(ds) {
  const last = ds.at(-1);
  if (!Number.isFinite(last)) return ds.map(() => null);
  const lo = Math.min(0, last);
  const hi = Math.max(0, last);
  const out = [];
  let prev = 0;
  for (const d of ds) {
    let v = Number.isFinite(d) ? Math.max(lo, Math.min(hi, d)) : prev;
    v = last >= 0 ? Math.max(v, prev) : Math.min(v, prev);
    out.push(v);
    prev = v;
  }
  return out;
}

/** The market's line for a kind and region: the latest year with one, `{ year, a, b, n }`. */
export function latestLine(lines, type = "yearling", region = "EU") {
  let best = null;
  for (const [k, v] of Object.entries(lines ?? {})) {
    const [t, r, y] = k.split("|");
    if (t !== type || r !== region) continue;
    if (!best || Number(y) > best.year) best = { year: Number(y), a: v.a, b: v.b, n: v.n };
  }
  return best;
}

/**
 * Each sire's projection. `rows` the yearling table (by year), `foals` the
 * foal table, `current` the forecast's sires this season (their score to
 * date), `fees` the workbook fees by sire and covering year, `runners` each
 * sire's runners worldwide on the roster.
 */
export function buildCommercial({ yearlings = [], foals = [], cells = [], lines = {}, history = {}, current = [], fees = new Map(), runners = new Map(), now = new Date(), region = "EU" } = {}) {
  const market = marketByYear(cells, "yearling", region, { minSold: 200 });
  const foalMarket = marketByYear(cells, "foal", region, { minSold: 200 });
  const hist = historyIndex(history);
  const latestYear = Math.max(...market.keys());
  const fits = {};
  const pairsByH = {};
  for (const h of HORIZONS) {
    pairsByH[h] = pairsFor(yearlings, market, hist, h);
    fits[h] = fitHorizon(pairsByH[h]);
  }
  const test = testFit(pairsByH[1], latestYear - 1);
  const line = latestLine(lines, "yearling", region);
  const foalLine = latestLine(lines, "foal", region);
  // The market's one-year moves, same sire to same sire: what a base year
  // before the latest is carried forward by.
  const oneYear = sameSireMoves(yearlings, 1);

  const nowYear = now.getUTCFullYear();
  const targets = [nowYear + 1, nowYear + 2, nowYear + 3];

  const scoreNow = new Map((current ?? []).map((f) => [nameKey(f.sire), f]));
  const foalsBy = new Map((foals ?? []).map((r) => [r.sireKey, r]));
  const yearBy = new Map((yearlings ?? []).map((r) => [r.sireKey, r]));
  const keys = new Set([...yearBy.keys(), ...[...scoreNow.keys()].filter((k) => scoreNow.get(k).stage <= 6)]);

  const sires = [];
  for (const key of keys) {
    const row = yearBy.get(key) ?? null;
    const foalRow = foalsBy.get(key) ?? null;
    const hi = hist.get(key) ?? null;
    const f = scoreNow.get(key) ?? null;
    const years = Object.entries(row?.byYear ?? {})
      .map(([y, v]) => [Number(y), v])
      .sort((a, b) => a[0] - b[0]);
    const recent = years.filter(([y]) => y >= latestYear - 3);
    if (!recent.length && !f) continue;
    const stage = f?.stage ?? (years.length ? stageAt(row, hi, nowYear) : null);
    const proven = stage !== null && stage >= PROVEN_STAGE;
    const basis = basisOf(years, latestYear, oneYear);
    // His Timeform score this season, read for as much of him as his
    // British and Irish runners are. A proven sire's is not read: he is held.
    const weight = f?.score ? homeWeight(f.runners, runners.get(key) ?? null) : 0;
    const scoreUsed = !proven && f?.score ? 100 * Math.exp(weight * Math.log(f.score / 100)) : null;
    const x = scoreUsed ? Math.log(scoreUsed / 100) : 0;
    let projected = null;
    if (basis && market.get(latestYear) && fits[1]) {
      const bucket = stageBucket(stage ?? 4);
      const rel = Math.log(basis.median / market.get(latestYear));
      const hs = targets.map((Y) => Math.min(Y - latestYear, HORIZONS.at(-1)));
      const ds = proven ? hs.map(() => 0) : steadyPath(hs.map((h) => predict(fits[h], bucket, x, rel)?.d ?? null));
      projected = targets.map((Y, i) => {
        const centre = basis.median * Math.exp(ds[i] ?? 0);
        const sd = fits[hs[i]]?.buckets?.[bucket]?.sd ?? null;
        return { year: Y, median: Math.round(centre), low: sd ? Math.round(centre * Math.exp(-sd)) : null, high: sd ? Math.round(centre * Math.exp(sd)) : null };
      });
    }
    const yearOf = ([y, v]) => ({ year: y, sold: v.sold, median: v.median, average: v.average ?? null, fee: v.fee, multiple: v.multiple });
    sires.push({
      key,
      sire: row?.sire ?? f?.sire ?? key,
      stage,
      proven,
      score: f?.score ?? null,
      scoreUsed: scoreUsed ? round(scoreUsed, 1) : null,
      scoreWeight: f?.score ? round(weight, 2) : null,
      fee: row?.fee ?? null,
      yearlings: recent.length
        ? {
            years: recent.map(yearOf),
            latest: recent.at(-1)[0],
            multiple: row?.multiple ?? null,
            premium: row?.premium ?? null,
            trend: row?.trend ?? null,
          }
        : null,
      foals: foalRow
        ? {
            years: Object.entries(foalRow.byYear ?? {})
              .map(([y, v]) => yearOf([Number(y), v]))
              .filter((v) => v.year >= latestYear - 3),
            multiple: foalRow.multiple ?? null,
          }
        : null,
      basis,
      projected,
      fees: fees.get(key) ?? null,
    });
  }
  sires.sort((a, b) => String(a.sire).localeCompare(String(b.sire)));

  return {
    v: 1,
    builtAt: now.toISOString(),
    region,
    targets,
    market: {
      latestYear,
      sameSire: Object.fromEntries([...oneYear].filter(([y]) => y >= latestYear - 6).map(([y, v]) => [y, round(Math.exp(v) - 1, 3)])),
      yearlings: Object.fromEntries([...market].filter(([y]) => y >= latestYear - 5)),
      foals: Object.fromEntries([...foalMarket].filter(([y]) => y >= latestYear - 5)),
    },
    line,
    foalLine,
    model: {
      horizons: Object.fromEntries(HORIZONS.map((h) => [h, fits[h]])),
      test,
      minSold: MIN_SOLD,
      drivers: ["log(Timeform score / 100)", "log(his median / market median)"],
    },
    sires,
  };
}

export default { HORIZONS, MIN_SOLD, PROVEN_STAGE, HOME_SHARE_FULL, BASIS_YEARS, basisOf, homeWeight, steadyPath, stageBucket, marketByYear, sameSireMoves, historyIndex, stageAt, pairsFor, fitHorizon, testFit, latestLine, buildCommercial };
