/**
 * Age effects: stakes rates by the sire's age at the cover and the mare's age
 * at foaling, over the whole database — the pure parts.
 *
 * Why it exists: an old mare's cover is a question of which sire, and the
 * answer turned out to depend on his age as much as hers. On an eight-sire
 * sample (5,193 runners) the mare's age cost little until 18, and from 18 the
 * sire's age was what separated the cells: sires in their first crops gave 3
 * stakes winners from 22 runners, sires of 7 to 15 gave 5 from 89, sires of
 * 21 and over none from 13. Cells that thin should be read off every runner
 * we hold, not a sample, so the grid is built here from one grouped read of
 * the results table.
 *
 * What the database can and cannot know. A dam's age is her foal's year less
 * her own, and her own year is on her rows only where she raced on the table
 * (Britain, Ireland, France); a sire's likewise. So the grid is the subset
 * with both parents raced here, which leans towards the better-bred, and says
 * so in `basis`. Stakes means Listed and above, and rates are per runner, not
 * per foal: nothing here is about the chance of getting the foal.
 *
 * The SQL does the grouping; this file names the bands, shapes the cells and
 * reads the rates, so the bands can be tested without a database.
 */

/** The sire's age at the cover: his foal's year less one, less his own. */
export const SIRE_BANDS = [
  { key: "3-6", label: "3 to 6, first crops", lo: 3, hi: 6 },
  { key: "7-10", label: "7 to 10", lo: 7, hi: 10 },
  { key: "11-15", label: "11 to 15", lo: 11, hi: 15 },
  { key: "16-20", label: "16 to 20", lo: 16, hi: 20 },
  { key: "21+", label: "21 and over", lo: 21, hi: 30 },
];

/** The mare's age at foaling: her foal's year less her own. */
export const MARE_BANDS = [
  { key: "3-9", label: "3 to 9", lo: 3, hi: 9 },
  { key: "10-14", label: "10 to 14", lo: 10, hi: 14 },
  { key: "15-17", label: "15 to 17", lo: 15, hi: 17 },
  { key: "18-20", label: "18 to 20", lo: 18, hi: 20 },
  { key: "21+", label: "21 and over", lo: 21, hi: 28 },
];

const bandOf = (bands, age) => {
  const a = Number(age);
  if (!Number.isFinite(a)) return null;
  return bands.find((b) => a >= b.lo && a <= b.hi)?.key ?? null;
};
export const sireBand = (age) => bandOf(SIRE_BANDS, age);
export const mareBand = (age) => bandOf(MARE_BANDS, age);

/** A CASE expression that bands an age in SQL exactly as `bandOf` does. */
const caseFor = (bands, expr) =>
  `CASE ${bands.map((b) => `WHEN ${expr} BETWEEN ${b.lo} AND ${b.hi} THEN '${b.key}'`).join(" ")} ELSE NULL END`;

/**
 * One row per horse: who by, out of whom, foaled when, best figure, black type.
 * The same reading of the table the mating routes make, kept to the columns
 * the grid needs. 999 is Timeform's "none" and is filtered by the BETWEEN.
 */
export const RUNNER_SELECT = `
  SELECT horseName,
         YEAR(foalingDate)                    AS foalYear,
         MAX(sireName)                        AS sireName,
         MAX(damName)                         AS damName,
         MAX(NULLIF(damsireName, ''))         AS damsireName,
         MAX(GREATEST(
           CASE WHEN preRaceMasterRating BETWEEN 1 AND 140 THEN preRaceMasterRating ELSE 0 END,
           CASE WHEN performanceRating    BETWEEN 1 AND 140 THEN performanceRating    ELSE 0 END)) AS best,
         SUM(COALESCE(Stakes_Win, 0))         AS stakesWins,
         SUM(COALESCE(Group_Win, 0))          AS groupWins,
         SUM(COALESCE(Group1_Win, 0))         AS group1Wins
    FROM APIData_Table2
   WHERE raceType = 'Flat' AND foalingDate >= ?`;

/** A horse's own foaling year, where it raced here: the first year its rows carry. */
const OWN_YEAR = (genders) =>
  `SELECT horseName, MIN(YEAR(foalingDate)) AS y
     FROM APIData_Table2
    WHERE horseGender IN (${genders.map((g) => `'${g}'`).join(", ")}) AND foalingDate IS NOT NULL
    GROUP BY horseName`;

/**
 * The grid in one read: runners grouped by the sire's and the mare's age
 * bands. Args: the earliest foaling date counted, then (with a sire) his
 * name. `hint` is the route's MAX_EXECUTION_TIME comment.
 */
export const ageGridSql = ({ sire = null, hint = "" } = {}) => `
  SELECT ${hint} ${caseFor(SIRE_BANDS, "(r.foalYear - 1 - s.y)")} AS sireBand,
         ${caseFor(MARE_BANDS, "(r.foalYear - d.y)")}             AS mareBand,
         COUNT(*)                                                  AS runners,
         SUM(CASE WHEN r.stakesWins > 0 THEN 1 ELSE 0 END)         AS stakesWinners,
         SUM(CASE WHEN r.groupWins  > 0 THEN 1 ELSE 0 END)         AS groupWinners,
         SUM(CASE WHEN r.group1Wins > 0 THEN 1 ELSE 0 END)         AS group1Winners,
         SUM(CASE WHEN r.best >= 100 THEN 1 ELSE 0 END)            AS rated100,
         SUM(CASE WHEN r.best >= 110 THEN 1 ELSE 0 END)            AS rated110,
         AVG(NULLIF(r.best, 0))                                    AS meanBest
    FROM (${RUNNER_SELECT}${sire ? " AND sireName = ?" : ""}
          GROUP BY horseName, YEAR(foalingDate)) r
    JOIN (${OWN_YEAR(["f", "m"])}) d ON d.horseName = r.damName
    LEFT JOIN (${OWN_YEAR(["c", "h"])}) s ON s.horseName = r.sireName
   GROUP BY sireBand, mareBand`;

export const ageGridArgs = ({ since = "2008-01-01", sire = null } = {}) => (sire ? [since, sire] : [since]);

const rate = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);

/**
 * Rows from `ageGridSql` as the page reads them: every cell of the grid,
 * empty ones included, each with its counts and rates; the margins for each
 * sire band and each mare band; and the cells where the sire's age is not
 * known (he did not race here) kept apart under `unknownSire`.
 */
export function ageGrid(rows = []) {
  const cell = () => ({ runners: 0, stakesWinners: 0, groupWinners: 0, group1Winners: 0, rated100: 0, rated110: 0, bestSum: 0 });
  const cells = new Map();
  const unknownSire = new Map();
  for (const r of rows) {
    const m = r.mareBand;
    if (!m) continue;
    const target = r.sireBand ? cells : unknownSire;
    const key = r.sireBand ? `${r.sireBand}|${m}` : m;
    const c = target.get(key) ?? cell();
    const n = Number(r.runners) || 0;
    c.runners += n;
    c.stakesWinners += Number(r.stakesWinners) || 0;
    c.groupWinners += Number(r.groupWinners) || 0;
    c.group1Winners += Number(r.group1Winners) || 0;
    c.rated100 += Number(r.rated100) || 0;
    c.rated110 += Number(r.rated110) || 0;
    c.bestSum += (Number(r.meanBest) || 0) * n;
    target.set(key, c);
  }
  const finish = (c) => ({
    runners: c.runners,
    stakesWinners: c.stakesWinners,
    groupWinners: c.groupWinners,
    group1Winners: c.group1Winners,
    rated100: c.rated100,
    rated110: c.rated110,
    stakesRate: rate(c.stakesWinners, c.runners),
    groupRate: rate(c.groupWinners, c.runners),
    group1Rate: rate(c.group1Winners, c.runners),
    rated100Rate: rate(c.rated100, c.runners),
    meanBest: c.runners ? Math.round((10 * c.bestSum) / c.runners) / 10 : null,
  });
  const sum = (list) =>
    list.reduce((a, c) => {
      for (const k of Object.keys(a)) a[k] += c[k];
      return a;
    }, cell());
  const grid = SIRE_BANDS.map((s) => ({
    sire: s.key,
    label: s.label,
    cells: MARE_BANDS.map((m) => ({ mare: m.key, label: m.label, ...finish(cells.get(`${s.key}|${m.key}`) ?? cell()) })),
    all: finish(sum(MARE_BANDS.map((m) => cells.get(`${s.key}|${m.key}`) ?? cell()))),
  }));
  const byMare = MARE_BANDS.map((m) => ({ mare: m.key, label: m.label, ...finish(sum(SIRE_BANDS.map((s) => cells.get(`${s.key}|${m.key}`) ?? cell()))) }));
  const all = finish(sum([...cells.values()]));
  return {
    sireBands: SIRE_BANDS,
    mareBands: MARE_BANDS,
    grid,
    byMare,
    all,
    unknownSire: MARE_BANDS.map((m) => ({ mare: m.key, label: m.label, ...finish(unknownSire.get(m.key) ?? cell()) })),
  };
}

export default { SIRE_BANDS, MARE_BANDS, sireBand, mareBand, ageGridSql, ageGridArgs, ageGrid, RUNNER_SELECT };
