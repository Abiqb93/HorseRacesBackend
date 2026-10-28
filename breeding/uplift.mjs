/**
 * Sire uplift: a stallion's runners against the same mares' other foals by
 * other sires — the pure parts.
 *
 * A sire's average says who had the better mares; uplift says who did more
 * with them. For each of his runners with a rating, the dam's other foals by
 * other sires are averaged, and the difference is his lift over that mare.
 * The mean of those lifts is his uplift; the share of his runners ahead of
 * their siblings says how often it holds. The same read over one damsire's
 * daughters is the cross's uplift.
 *
 * Read from our database only, so a mare's other foals are the ones that
 * raced in Britain, Ireland or France. A sire with only two-year-olds and
 * three-year-olds reads low against mature siblings, and `young` says so.
 */

import { RUNNER_SELECT } from "./ages.mjs";

/**
 * His runners, each with the dam's other foals' mean. Args: since, sire,
 * since, sire, sire, then the damsire where one is given.
 */
export const upliftSql = ({ damsire = null, hint = "", limit = 4000 } = {}) => `
  SELECT ${hint} h.horseName, h.foalYear, h.damName, h.damsireName, h.best, h.stakesWins, h.groupWins, h.group1Wins,
         o.othersMean, o.othersN
    FROM (${RUNNER_SELECT} AND sireName = ?
          GROUP BY horseName, YEAR(foalingDate)) h
    JOIN (SELECT x.damName, AVG(x.best) AS othersMean, COUNT(*) AS othersN
            FROM (${RUNNER_SELECT}
                    AND damName IN (SELECT DISTINCT damName FROM APIData_Table2 WHERE sireName = ?)
                    AND sireName <> ?
                  GROUP BY horseName, YEAR(foalingDate)) x
           WHERE x.best > 0
           GROUP BY x.damName) o ON o.damName = h.damName
   WHERE h.best > 0${damsire ? " AND h.damsireName = ?" : ""}
   ORDER BY h.best DESC
   LIMIT ${Number(limit)}`;

export const upliftArgs = ({ since = "2008-01-01", sire, damsire = null } = {}) =>
  damsire ? [since, sire, since, sire, sire, damsire] : [since, sire, since, sire, sire];

const round1 = (v) => Math.round(v * 10) / 10;

/** Rows from `upliftSql` as a summary: the uplift, its spread, and the runners that carry it. */
export function upliftSummary(rows = [], { season = new Date().getUTCFullYear() } = {}) {
  const runners = rows
    .map((r) => ({
      name: r.horseName,
      foalingYear: Number(r.foalYear) || null,
      dam: r.damName,
      damsire: r.damsireName || null,
      best: Number(r.best) || null,
      othersMean: Number(r.othersMean) || null,
      othersN: Number(r.othersN) || 0,
      stakesWins: Number(r.stakesWins) || 0,
      groupWins: Number(r.groupWins) || 0,
      group1Wins: Number(r.group1Wins) || 0,
    }))
    .filter((h) => h.best && h.othersMean && h.othersN > 0)
    .map((h) => ({ ...h, uplift: round1(h.best - h.othersMean) }));
  if (!runners.length) return { n: 0, runners: [] };
  const ups = runners.map((h) => h.uplift).sort((a, b) => a - b);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const oldest = Math.min(...runners.map((h) => h.foalingYear ?? season));
  return {
    n: runners.length,
    uplift: round1(mean(ups)),
    median: round1(ups[Math.floor(ups.length / 2)]),
    shareUp: Math.round((100 * ups.filter((u) => u > 0).length) / ups.length),
    hisMean: round1(mean(runners.map((h) => h.best))),
    maresMean: round1(mean(runners.map((h) => h.othersMean))),
    stakesWinners: runners.filter((h) => h.stakesWins > 0).length,
    group1Winners: runners.filter((h) => h.group1Wins > 0).length,
    // Only two- and three-year-olds to his name: a figure that will rise.
    young: season - oldest <= 3,
    runners: [...runners].sort((a, b) => b.uplift - a.uplift),
  };
}

export default { upliftSql, upliftArgs, upliftSummary };
