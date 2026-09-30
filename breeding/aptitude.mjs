/**
 * A family's record by trip, by age and by sex — the pure parts.
 *
 * `/api/breeding/aptitude` answers the question a mating report asks after
 * "is it a good cross": what will the foal want to do? At what trip, at what
 * age, and — because colts and fillies of the same family are not the same
 * racehorses — for which sex. The evidence is the runs of the horses that
 * share its blood: the stallion's runners, the mare's produce, the mare's own
 * career, the damsire's runners, and the stallion's own.
 *
 * The route groups the results table on the database side (one row per
 * furlong, age and sex for each group of horses) and this module turns those
 * rows into the shape the charts read, so every rule about what counts is in
 * one tested place:
 *
 *   - **Flat only.** A hurdler's two-mile win is not evidence that a flat
 *     family stays, and a sire's jumpers would drag every profile out.
 *   - **Five to sixteen furlongs.** Anything shorter joins the five-furlong
 *     column and anything longer the sixteen; the chart ends are "and less"
 *     and "and more", which is how the trade speaks of them anyway.
 *   - **Ages 2, 3 and 4+.** The industry's own split — juvenile, classic
 *     generation, older — and the one the stallion roster publishes, so our
 *     tables and the roster's line up.
 *   - **Timeform's 999 is not a rating.** Only figures inside 1–140 count.
 *
 * Pure: rows in, shapes out.
 */

export const FURLONG_MIN = 5;
export const FURLONG_MAX = 16;
export const AGES = ["2", "3", "4+"];
export const RATING_BIN = 5;
export const RATING_MIN = 20;
export const RATING_MAX = 140;

/** A trip in furlongs as the column it is counted in, or null. */
export const furlongBucket = (raw) => {
  const f = Number(raw);
  if (!Number.isFinite(f) || f <= 0) return null;
  return Math.min(FURLONG_MAX, Math.max(FURLONG_MIN, Math.round(f)));
};

/** An age at the running as its bucket, or null for anything under two. */
export const ageBucket = (raw) => {
  const a = Number(raw);
  if (!Number.isFinite(a) || a < 2) return null;
  if (a === 2) return "2";
  if (a === 3) return "3";
  return "4+";
};

/** Timeform's sex codes, as at the running, reduced to male and female. */
export const sexBucket = (raw) => {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "f" || s === "m") return "F";
  if (s === "c" || s === "g" || s === "h" || s === "r") return "M";
  return null;
};

const int = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * The grouped rows folded into cells: one per furlong, age and sex.
 *
 * The query already grouped, but on raw furlongs and raw ages, so several of
 * its rows land in one cell here (a 4.5f and a 5.2f run are both the
 * five-furlong column). A row whose sex is unrecorded still counts in the
 * totals — it is a run — and is carried under sex "U" so the male and female
 * views do not claim it.
 */
export function foldCells(rows = []) {
  const at = new Map();
  for (const r of rows) {
    const f = furlongBucket(r.f);
    const age = ageBucket(r.age);
    if (f === null || age === null) continue;
    const sex = sexBucket(r.sex) ?? "U";
    const key = `${f}|${age}|${sex}`;
    const cell = at.get(key) ?? { f, age, sex, runs: 0, wins: 0, places: 0, stakesWins: 0, groupWins: 0 };
    cell.runs += int(r.runs);
    cell.wins += int(r.wins);
    cell.places += int(r.places);
    cell.stakesWins += int(r.stakesWins);
    cell.groupWins += int(r.groupWins);
    at.set(key, cell);
  }
  return [...at.values()].sort((a, b) => a.f - b.f || a.age.localeCompare(b.age) || a.sex.localeCompare(b.sex));
}

/** Linear interpolation between order statistics; null on an empty list. */
const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/**
 * Every horse's best figure as a distribution: the five numbers a box plot
 * draws, the mean and spread, and 5lb bins for a violin.
 *
 * Bins rather than the horses themselves, because a big sire has thousands of
 * rated runners and a chart needs their shape, not their names. The bins run
 * from 20 to 140 so two groups' violins share one axis.
 */
export function ratingDistribution(ratings = []) {
  const v = ratings
    .map(Number)
    .filter((x) => Number.isFinite(x) && x >= 1 && x <= RATING_MAX)
    .sort((a, b) => a - b);
  const n = v.length;
  const bins = [];
  for (let from = RATING_MIN; from < RATING_MAX; from += RATING_BIN) {
    bins.push({ from, to: from + RATING_BIN, n: 0 });
  }
  for (const x of v) {
    const i = Math.min(bins.length - 1, Math.max(0, Math.floor((x - RATING_MIN) / RATING_BIN)));
    bins[i].n += 1;
  }
  if (!n) return { n: 0, mean: null, sd: null, min: null, p10: null, q1: null, median: null, q3: null, p90: null, max: null, bins };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  return {
    n,
    mean,
    sd: n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null,
    min: v[0],
    p10: quantile(v, 0.1),
    q1: quantile(v, 0.25),
    median: quantile(v, 0.5),
    q3: quantile(v, 0.75),
    p90: quantile(v, 0.9),
    max: v[n - 1],
    bins,
  };
}

/** Totals over a group's cells: what the headline tiles quote. */
export function totals(cells = []) {
  return cells.reduce(
    (a, c) => ({
      runs: a.runs + c.runs,
      wins: a.wins + c.wins,
      places: a.places + c.places,
      stakesWins: a.stakesWins + c.stakesWins,
      groupWins: a.groupWins + c.groupWins,
    }),
    { runs: 0, wins: 0, places: 0, stakesWins: 0, groupWins: 0 },
  );
}

/**
 * The two queries a group needs, for one WHERE clause.
 *
 * `cells` groups on raw trip, age and sex, flat only; `ratings` groups on the
 * horse (name and foaling year, since a name is not a horse) and keeps its
 * best in-scale figure from the flat. Both carry the route's execution cap,
 * passed in, so a group that cannot be read in time is reported as unread
 * rather than as empty.
 */
export function groupQueries(where, hint = "") {
  const flat = "raceType = 'Flat'";
  return {
    cells: `SELECT ${hint}
        ROUND(CAST(distance AS DECIMAL(6,2))) AS f,
        COALESCE(horseAge, YEAR(meetingDate) - YEAR(foalingDate)) AS age,
        horseGender AS sex,
        COUNT(*) AS runs,
        SUM(CASE WHEN CAST(positionOfficial AS UNSIGNED) = 1 THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN CAST(positionOfficial AS UNSIGNED) BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS places,
        SUM(COALESCE(Stakes_Win, 0)) AS stakesWins,
        SUM(COALESCE(Group_Win, 0)) AS groupWins
      FROM APIData_Table2
      WHERE ${where} AND ${flat} AND distance IS NOT NULL AND distance <> ''
      GROUP BY f, age, sex`,
    ratings: `SELECT ${hint}
        horseName, YEAR(foalingDate) AS foalYear,
        GREATEST(
          COALESCE(MAX(CASE WHEN preRaceMasterRating BETWEEN 1 AND 140 THEN preRaceMasterRating END), 0),
          COALESCE(MAX(CASE WHEN performanceRating BETWEEN 1 AND 140 THEN performanceRating END), 0)
        ) AS best
      FROM APIData_Table2
      WHERE ${where} AND ${flat}
      GROUP BY horseName, foalYear`,
  };
}

/** A group, shaped: its cells, their totals, its horses' ratings. */
export function describeGroup({ cellRows = [], ratingRows = [], timedOut = false } = {}) {
  const cells = foldCells(cellRows);
  const rated = ratingRows.map((r) => Number(r.best)).filter((b) => b > 0);
  return {
    horses: ratingRows.length,
    ...totals(cells),
    cells,
    ratings: ratingDistribution(rated),
    timedOut: Boolean(timedOut),
  };
}

export default { furlongBucket, ageBucket, sexBucket, foldCells, ratingDistribution, totals, groupQueries, describeGroup };
