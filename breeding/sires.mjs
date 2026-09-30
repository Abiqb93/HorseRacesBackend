/**
 * Sires in bulk: their runners' ratings, and their two-year-olds.
 *
 * A mating report asks about one stallion and reads his runners with one
 * query. A screen that ranks every stallion on the roster for one mare asks
 * the same question two hundred times, and a list of the season's best
 * two-year-olds by sire asks it of every sire at once. Both are the same
 * reduction — each horse to its best Timeform figure, then each sire to a
 * summary of his horses — done over many sires per query instead of one.
 *
 * The reductions are here and pure, so the routes are a query and a call.
 * Ratings follow `mating.mjs` exactly (the better of the master and the
 * performance figure, 1 to 140, 999 and zeros ignored), because a list that
 * graded a stallion on a different figure from the report it links to would
 * disagree with itself one click later.
 */

import { HORSE_SUMMARY_SELECT, describe, studBookName, summariseHorse } from "./mating.mjs";

/** The most sires one request may ask about; the page asks in pages. */
export const MAX_SIRES = 150;

/** Sires per query: small, because each is every run by every one of his runners. */
export const SIRES_PER_QUERY = 6;

/**
 * "Dubawi|Frankel (GB)|*Sea The Stars" to stud-book names, each once, in the
 * order given. A comma is accepted too, since a hand-typed URL will use one.
 */
export function parseSireList(raw, { max = MAX_SIRES } = {}) {
  const out = [];
  const seen = new Set();
  for (const part of String(raw ?? "").split(/[|,]/)) {
    const name = studBookName(part);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

/** One query's worth of sires: every runner by any of them, one row per horse. */
export const sireRunnersSql = (count, hint = "") =>
  `${HORSE_SUMMARY_SELECT.replace("SELECT ", `SELECT ${hint} `).replace("horseName,", "sireName AS sireKeyRaw, horseName,")}
   WHERE sireName IN (${new Array(count).fill("?").join(", ")})
   GROUP BY sireName, horseName, foalYear`;

/**
 * Rows from `sireRunnersSql` to a summary per sire: the same `describe` the
 * mating route gives one sire, and his three best, so a list can name them.
 * Every sire asked about gets an entry — a sire with no runners on file is
 * `rated: 0`, which is an answer, not a gap.
 */
export function summariseSires(rows, asked) {
  const by = new Map(asked.map((s) => [s, []]));
  for (const r of rows ?? []) {
    const key = studBookName(r.sireKeyRaw ?? r.sireName);
    if (!by.has(key)) continue;
    by.get(key).push(summariseHorse(r));
  }
  const out = {};
  for (const [sire, horses] of by) {
    const d = describe(horses);
    out[sire] = {
      ...d,
      top: horses
        .filter((h) => Number.isFinite(h.best))
        .sort((a, b) => b.best - a.best)
        .slice(0, 3)
        .map((h) => ({ name: h.name, best: h.best, foalingYear: h.foalingYear, sex: h.sex })),
    };
  }
  return out;
}

/* ------------------------------------------------------------- juveniles */

/**
 * Every two-year-old of a season, one row per horse, with its sire.
 *
 * A two-year-old of season Y was foaled in Y - 2 and ran in Y. Both halves
 * matter: the foaling year alone would count a three-year-old's juvenile
 * figures from last year, and the meeting dates alone would count older
 * horses' runs. Ratings are the best of that season's runs only, because
 * "the highest-rated two-year-olds" is a question about what they did as
 * two-year-olds.
 */
export const juvenileSql = (hint = "") =>
  `${HORSE_SUMMARY_SELECT.replace("SELECT ", `SELECT ${hint} `)}
   WHERE foalingDate >= ? AND foalingDate < ?
     AND meetingDate >= ? AND meetingDate < ?
   GROUP BY horseName, foalYear`;

export const juvenileArgs = (season) => [
  `${season - 2}-01-01`,
  `${season - 1}-01-01`,
  `${season}-01-01`,
  `${season + 1}-01-01`,
];

/**
 * The season's two-year-olds, by sire, best first.
 *
 * Ranked by the sire's best juvenile, then by the average of his best three
 * (so one freak does not carry a sire past another with three good ones),
 * then by how many he has rated 90 or more. Every figure travels with its
 * count; a sire with one rated runner is listed, and the count says so.
 */
export function juvenileSires(rows, { minRated = 1, limit = 200 } = {}) {
  const by = new Map();
  for (const r of rows ?? []) {
    const h = summariseHorse(r);
    const sire = studBookName(h.sire);
    if (!sire) continue;
    if (!by.has(sire)) by.set(sire, []);
    by.get(sire).push(h);
  }
  const out = [];
  for (const [sire, horses] of by) {
    const rated = horses.filter((h) => Number.isFinite(h.best)).sort((a, b) => b.best - a.best);
    if (rated.length < minRated) continue;
    const top3 = rated.slice(0, 3);
    out.push({
      sire,
      runners: horses.length,
      rated: rated.length,
      winners: horses.filter((h) => h.wins > 0).length,
      stakesWinners: horses.filter((h) => h.stakesWins > 0).length,
      groupWinners: horses.filter((h) => h.groupWins > 0).length,
      best: rated[0]?.best ?? null,
      top3Mean: top3.length ? top3.reduce((a, h) => a + h.best, 0) / top3.length : null,
      over90: rated.filter((h) => h.best >= 90).length,
      over100: rated.filter((h) => h.best >= 100).length,
      mean: rated.length ? rated.reduce((a, h) => a + h.best, 0) / rated.length : null,
      horses: rated.slice(0, 5).map((h) => ({
        name: h.name,
        dam: h.dam,
        sex: h.sex,
        best: h.best,
        runs: h.runs,
        wins: h.wins,
        stakesWins: h.stakesWins,
        groupWins: h.groupWins,
      })),
    });
  }
  return out
    .sort(
      (a, b) =>
        (b.best ?? 0) - (a.best ?? 0) ||
        (b.top3Mean ?? 0) - (a.top3Mean ?? 0) ||
        b.over90 - a.over90 ||
        a.sire.localeCompare(b.sire),
    )
    .slice(0, limit);
}

export default { parseSireList, sireRunnersSql, summariseSires, juvenileSql, juvenileArgs, juvenileSires, MAX_SIRES, SIRES_PER_QUERY };
