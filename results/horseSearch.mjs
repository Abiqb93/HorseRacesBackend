/**
 * Horse name search, for the Horse Profile page.
 *
 * The page used to search `horse_names`, a summary table that nothing in these
 * repos rebuilds. It stopped gaining horses, so a horse that started racing
 * since (Darzakir, first run at Deauville on 26 November 2025, Listed winner
 * at Chantilly on 26 October 2026) could not be found, even though every one
 * of its runs is in APIData_Table2 and the Prospects list shows it.
 *
 * So the results table is searched first, and `horse_names` is kept only as a
 * last pass, for any horse it holds that the results table does not.
 *
 * ## Three passes, cheap first
 *
 * 1. Prefix on APIData_Table2 (`LIKE 'x%'`), which can use the index on the
 *    name. Most searches are the first letters of a name and end here.
 * 2. Only when that comes back short of the limit: the term at the start of a
 *    later word (`LIKE '% x%'`) on APIData_Table2, so "lady" finds My Lady
 *    Rose; and a contains search of `horse_names`, which is what this page
 *    did before, so nothing it found then is lost now. Both run together.
 *
 * The passes that cannot use the index are capped with MAX_EXECUTION_TIME;
 * a pass cut off at the cap, or failing, costs its own rows and nothing else.
 * The later-word pass is a full scan: on the live table (5 November 2026) it
 * hit a 5 s cap for "darzakir", so a search typed letter by letter took six
 * seconds to show one horse. At 1.5 s it finds what it can and lets go.
 *
 * ## One result per name
 *
 * Grouped by name, not by horseCode: older rows have no horseCode, and the
 * profile this result opens is read by name (/api/APIData_Table2/horse), so a
 * result per code would offer two choices that open the same page.
 *
 * Runs and wins count distinct meetings, because the table can hold the same
 * run twice (Darzakir's Chantilly and Saint-Cloud wins are each two rows).
 */

export const MIN_QUERY_LENGTH = 2;
export const DEFAULT_LIMIT = 12;
export const MAX_LIMIT = 50;

/** Caps, in milliseconds, on each pass. */
export const PREFIX_CAP_MS = 8000;
export const WORD_CAP_MS = 1500;
export const LEGACY_CAP_MS = 3000;

/** Escape LIKE's wildcards so a name with % or _ in it matches itself. */
export const escapeLike = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

const RESULTS_SQL = (capMs) => `
    SELECT /*+ MAX_EXECUTION_TIME(${capMs}) */
           horseName                                        AS horse_name,
           MAX(horseCountry)                                AS horse_country,
           MAX(countryCode)                                 AS race_country,
           MAX(sireName)                                    AS sire_name,
           MAX(damName)                                     AS dam_name,
           MAX(YEAR(foalingDate))                           AS foaling_year,
           COUNT(DISTINCT DATE(meetingDate), courseName)    AS runs,
           COUNT(DISTINCT CASE WHEN positionOfficial = 1
                 THEN CONCAT(DATE(meetingDate), '|', courseName) END) AS wins,
           MAX(meetingDate)                                 AS last_run
      FROM APIData_Table2
     WHERE horseName LIKE ? ESCAPE '\\\\'
     GROUP BY horseName
     ORDER BY (horseName = ?) DESC, last_run DESC
     LIMIT ?`;

const LEGACY_SQL = (capMs) => `
    SELECT /*+ MAX_EXECUTION_TIME(${capMs}) */
           Sire AS horse_name, Country AS country, Runs AS runs, Wins AS wins,
           sireName AS sire_name, damName AS dam_name, YEAR(foalingDate) AS foaling_year
      FROM horse_names
     WHERE Sire LIKE ? ESCAPE '\\\\' AND Sire <> ''
     ORDER BY (Sire = ?) DESC, Runs DESC
     LIMIT ?`;

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

const fromResults = (r) => ({
  horseName: r.horse_name,
  country: r.horse_country || r.race_country || null,
  sireName: r.sire_name ?? null,
  damName: r.dam_name ?? null,
  foalingYear: num(r.foaling_year),
  runs: num(r.runs),
  wins: num(r.wins),
  lastRun: r.last_run ? String(r.last_run instanceof Date ? r.last_run.toISOString() : r.last_run).slice(0, 10) : null,
  source: "results",
});

const fromLegacy = (r) => ({
  horseName: r.horse_name,
  country: r.country ?? null,
  sireName: r.sire_name ?? null,
  damName: r.dam_name ?? null,
  foalingYear: num(r.foaling_year),
  runs: num(r.runs),
  wins: num(r.wins),
  lastRun: null,
  source: "horse_names",
});

const nameKey = (n) => String(n ?? "").trim().toUpperCase();

/** Read and normalise the query string's `q` and `limit`. Null q when too short. */
export function parseSearchParams(query = {}) {
  const q = String(query.q ?? query.name ?? "").trim();
  const asked = Number.parseInt(query.limit, 10);
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : DEFAULT_LIMIT;
  return { q: q.length >= MIN_QUERY_LENGTH ? q : null, limit };
}

/**
 * Search by name. `runQuery(sql, params)` resolves to rows.
 * Resolves to { count, horses, failedPasses }; rejects only when every pass failed.
 */
export async function searchHorses(runQuery, q, limit = DEFAULT_LIMIT, log = console) {
  const term = escapeLike(q);
  const exact = q;
  const failures = [];

  const pass = async (label, sql, params, map) => {
    try {
      return (await runQuery(sql, params)).map(map);
    } catch (err) {
      failures.push(label);
      log.warn?.(`horse search (${label}) failed: ${err.message}`);
      return [];
    }
  };

  const prefix = await pass("prefix", RESULTS_SQL(PREFIX_CAP_MS), [`${term}%`, exact, limit], fromResults);

  let word = [];
  let legacy = [];
  if (prefix.length < limit) {
    [word, legacy] = await Promise.all([
      pass("word", RESULTS_SQL(WORD_CAP_MS), [`% ${term}%`, exact, limit], fromResults),
      pass("horse_names", LEGACY_SQL(LEGACY_CAP_MS), [`%${term}%`, exact, limit], fromLegacy),
    ]);
  }

  const ran = prefix.length < limit ? 3 : 1;
  if (failures.length === ran) throw new Error(`every search pass failed (${failures.join(", ")})`);

  const seen = new Set();
  const horses = [];
  for (const h of [...prefix, ...word, ...legacy]) {
    const k = nameKey(h.horseName);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    horses.push(h);
    if (horses.length >= limit) break;
  }

  // An exact name match leads, whichever pass found it.
  const want = nameKey(q);
  const at = horses.findIndex((h) => nameKey(h.horseName) === want);
  if (at > 0) horses.unshift(...horses.splice(at, 1));

  return { count: horses.length, horses, failedPasses: failures };
}
