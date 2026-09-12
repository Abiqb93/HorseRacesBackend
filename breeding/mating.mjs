/**
 * The results table read as a stud book — the pure parts.
 *
 * `/api/breeding/mating` in server.jsx does the retrieval; everything here is
 * arithmetic and shaping over rows, kept out of the route so it can be tested
 * against fixtures without a database. See the route's comment for the whole
 * design: why the damsire is derived, why 999 is filtered, what stays
 * server-side.
 */

/** A name as the results table writes it: no sigil, no country, upper case. */
export const studBookName = (raw) =>
  String(raw ?? "")
    .trim()
    .replace(/^[*=$]+/, "")
    .replace(/\s*\([A-Za-z]{2,3}\)\s*$/, "")
    .trim()
    .toUpperCase();

/**
 * One row per horse: parentage, sex, foaling year, career, best figures.
 *
 * Grouped on the name *and* the foaling year, because a name is not a horse.
 * Enable's own record merged with a single 2008 row for another Enable — no
 * sire, one run — and reported the Arc winner as foaled six years early. Two
 * horses of a name and a year is rare enough to live with; two of a name is
 * not. The route uses `GROUP BY horseName, foalYear` with this select.
 *
 * Timeform's master rating is the horse's level and the performance rating is
 * one run's; both carry a 999 sentinel for "none", which would make every
 * horse a champion if it were summed, so only figures inside the scale count.
 */
export const HORSE_SUMMARY_SELECT = `
  SELECT horseName,
         YEAR(foalingDate)                    AS foalYear,
         MAX(sireName)                        AS sireName,
         MAX(damName)                         AS damName,
         MAX(NULLIF(damsireName, ''))         AS damsireName,
         MAX(horseGender)                     AS sex,
         MIN(foalingDate)                     AS foaled,
         MAX(CASE WHEN preRaceMasterRating BETWEEN 1 AND 140 THEN preRaceMasterRating END) AS bestMaster,
         MAX(CASE WHEN performanceRating    BETWEEN 1 AND 140 THEN performanceRating    END) AS bestPerformance,
         COUNT(*)                             AS runs,
         SUM(CASE WHEN CAST(positionOfficial AS UNSIGNED) = 1 THEN 1 ELSE 0 END) AS wins,
         SUM(COALESCE(Stakes_Win, 0))         AS stakesWins,
         SUM(COALESCE(Group_Win, 0))          AS groupWins,
         SUM(COALESCE(Group1_Win, 0))         AS group1Wins,
         MAX(meetingDate)                     AS lastRun
    FROM APIData_Table2`;

export const summariseHorse = (r) => {
  const bestMaster = Number(r.bestMaster) || null;
  const bestPerformance = Number(r.bestPerformance) || null;
  const foaled = r.foaled ? new Date(r.foaled) : null;
  const foalYear = Number(r.foalYear) || (foaled && !Number.isNaN(foaled.getTime()) ? foaled.getUTCFullYear() : null);
  return {
    name: r.horseName,
    sire: r.sireName || null,
    dam: r.damName || null,
    damsire: r.damsireName || null,
    sex: r.sex || null,
    foalingYear: foalYear,
    // The higher of the two: a horse's best figure is its best figure
    // whichever scale recorded it.
    best: Math.max(bestMaster ?? 0, bestPerformance ?? 0) || null,
    bestMaster,
    bestPerformance,
    runs: Number(r.runs) || 0,
    wins: Number(r.wins) || 0,
    stakesWins: Number(r.stakesWins) || 0,
    groupWins: Number(r.groupWins) || 0,
    group1Wins: Number(r.group1Wins) || 0,
    lastRun: r.lastRun ? String(r.lastRun).slice(0, 10) : null,
  };
};

/**
 * Which of several horses of the mare's name is the mare.
 *
 * Her foaling year settles it where the caller knows it; failing that her
 * sire, where the caller knows him; failing both, the one with the career —
 * a namesake with a single run and no sire is a stray row, not a broodmare.
 */
export const pickOwnRow = (rows, { year = null, sire = null } = {}) => {
  if (!rows?.length) return null;
  const byYear = year ? rows.find((r) => r.foalingYear === Number(year)) : null;
  if (byYear) return byYear;
  const bySire = sire ? rows.find((r) => studBookName(r.sire) === studBookName(sire)) : null;
  if (bySire) return bySire;
  return [...rows].sort((a, b) => b.runs - a.runs)[0];
};

/** Linear interpolation between order statistics; null on an empty list. */
export const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/** n, mean, spread and the black-type tally of a group of horses. */
export const describe = (horses) => {
  const rated = horses.map((h) => h.best).filter((b) => Number.isFinite(b)).sort((a, b) => a - b);
  const mean = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null;
  return {
    n: horses.length,
    rated: rated.length,
    mean,
    sd: rated.length > 1 ? Math.sqrt(rated.reduce((a, b) => a + (b - mean) ** 2, 0) / (rated.length - 1)) : null,
    q1: quantile(rated, 0.25),
    median: quantile(rated, 0.5),
    q3: quantile(rated, 0.75),
    max: rated.length ? rated[rated.length - 1] : null,
    stakesWinners: horses.filter((h) => h.stakesWins > 0).length,
    groupWinners: horses.filter((h) => h.groupWins > 0).length,
    group1Winners: horses.filter((h) => h.group1Wins > 0).length,
    winners: horses.filter((h) => h.wins > 0).length,
  };
};
