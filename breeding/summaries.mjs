/**
 * Sires' and damsires' runners, summarised once a night.
 *
 * The expected rating of a foal reads a sire's runners and a damsire's
 * daughters' runners, grouped horse by horse on the results table. For a
 * small sire that is a second; for Galileo, Kingman or Sea The Stars it is
 * more than the twenty-five seconds a request may hold a connection, so the
 * stallions a breeder most wants were the ones that "timed out". The reads
 * are the same every time — a sire's record moves with a season, not an
 * afternoon — so they are done once, at night, with the time they need, and
 * kept in a table the routes read first.
 *
 * Which sires? The ones that were asked for. A route that finds no fresh
 * summary reads live as before and remembers the name; the nightly pass
 * builds every remembered name whose summary is missing, stale or came
 * back short. Nothing is enumerated from the roster, so a stallion nobody
 * looks at costs nothing.
 *
 * The same pass measures the population — every horse that ran in the last
 * two seasons, by its best flat figure — as a histogram, so the grades can
 * be set at the population's own percentiles (an A+ is the top 3% of rated
 * horses, as the user defines it) rather than at fixed figures, and keeps
 * the result in a table so a redeploy does not lose it.
 *
 * Pure where it can be: the SQL, the freshness rule, the histogram
 * arithmetic and the grade lines are plain functions; the table reads and
 * writes take `runQuery` so the server supplies the pool.
 */

import { describe } from "./mating.mjs";

export const SUMMARY_TABLE = "breeding_sire_summary";
export const BASELINE_TABLE = "breeding_baseline";

export const CREATE_SUMMARY = `
  CREATE TABLE IF NOT EXISTS ${SUMMARY_TABLE} (
    kind VARCHAR(8) NOT NULL,
    name_key VARCHAR(120) NOT NULL,
    body MEDIUMTEXT NULL,
    built_at DATETIME NULL,
    took_ms INT NULL,
    timed_out TINYINT NOT NULL DEFAULT 0,
    asked_at DATETIME NULL,
    PRIMARY KEY (kind, name_key)
  )`;

export const CREATE_BASELINE = `
  CREATE TABLE IF NOT EXISTS ${BASELINE_TABLE} (
    id VARCHAR(16) NOT NULL PRIMARY KEY,
    body MEDIUMTEXT NOT NULL,
    built_at DATETIME NOT NULL
  )`;

/** A summary is served for a day and a half; the nightly pass renews it well inside that. */
export const FRESH_MS = 36 * 60 * 60 * 1000;
/** Older than this at night, it is rebuilt. */
export const STALE_MS = 20 * 60 * 60 * 1000;
/** The time a nightly read may take: four minutes a sire, fifteen for the population. */
export const NIGHTLY_HINT = "/*+ MAX_EXECUTION_TIME(240000) */";
export const BASELINE_HINT = "/*+ MAX_EXECUTION_TIME(900000) */";
/**
 * One month of the population's walk (baselineSliceSql): five minutes.
 *
 * The walk as one query grouped two seasons of runs by horse in a single
 * temporary table. It took under six minutes by day on 23 October 2026;
 * on the night of the 24th it ran into a fifteen-minute cap, and on the
 * 26th it ran 87 minutes before a forty-minute cap stopped it. A month at a
 * time reads its runs through the race-date index and groups them in
 * memory; a slice that still runs out of time is split and asked again.
 */
export const BASELINE_SLICE_HINT = "/*+ MAX_EXECUTION_TIME(300000) */";
/** A single sire re-read in the background after a timeout on a request. */
export const BACKGROUND_HINT = "/*+ MAX_EXECUTION_TIME(120000) */";

const toMs = (v) => {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

/** A stored row that can stand for a live read. */
export const isFresh = (row, now = Date.now(), ttl = FRESH_MS) => {
  if (!row || !row.body || Number(row.timed_out)) return false;
  const at = toMs(row.built_at);
  return at !== null && now - at < ttl;
};

/**
 * The stored body for a group of horses: what `describe` says of them, the
 * three best by name, and every horse — the mating route filters the same
 * cross out of a sire's runners and takes the forty best as the foal's
 * relatives, so the horses themselves are kept, best first.
 */
export function summaryOf(horses = []) {
  const list = [...horses].sort((a, b) => (b.best ?? 0) - (a.best ?? 0) || (b.runs ?? 0) - (a.runs ?? 0));
  return {
    ...describe(list),
    top: list
      .filter((h) => Number.isFinite(h.best))
      .slice(0, 3)
      .map((h) => ({ name: h.name, best: h.best, foalingYear: h.foalingYear, sex: h.sex })),
    horses: list,
  };
}

/** The sire-ratings route's shape from a stored body: everything but the horses. */
export const ratingsView = (body) => {
  if (!body) return null;
  const { horses, ...rest } = body;
  return rest;
};

/* ------------------------------------------------------------- the table */

const parseBody = (s) => {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** Stored summaries for some names, parsed, keyed by name. Missing names are simply absent. */
export async function readSummaries(runQuery, kind, keys = []) {
  const out = new Map();
  const names = [...new Set(keys.filter(Boolean))];
  if (!names.length) return out;
  for (let i = 0; i < names.length; i += 200) {
    const chunk = names.slice(i, i + 200);
    const rows = await runQuery(
      `SELECT name_key, body, built_at, took_ms, timed_out FROM ${SUMMARY_TABLE} WHERE kind = ? AND name_key IN (${chunk.map(() => "?").join(", ")})`,
      [kind, ...chunk],
    );
    for (const r of rows) out.set(r.name_key, { ...r, body: parseBody(r.body) });
  }
  return out;
}

/** Names the routes were asked for: a row each, so the nightly pass knows to build them. */
export async function rememberAsked(runQuery, kind, keys = []) {
  const names = [...new Set(keys.filter(Boolean))];
  if (!names.length) return 0;
  await runQuery(
    `INSERT INTO ${SUMMARY_TABLE} (kind, name_key, asked_at) VALUES ${names.map(() => "(?, ?, NOW())").join(", ")}
     ON DUPLICATE KEY UPDATE asked_at = NOW()`,
    names.flatMap((n) => [kind, n]),
  );
  return names.length;
}

/** One summary written, complete or short. A short one is kept so the night knows to try again. */
export async function writeSummary(runQuery, kind, key, body, { tookMs = null, timedOut = false } = {}) {
  await runQuery(
    `INSERT INTO ${SUMMARY_TABLE} (kind, name_key, body, built_at, took_ms, timed_out, asked_at)
     VALUES (?, ?, ?, NOW(), ?, ?, NOW())
     ON DUPLICATE KEY UPDATE body = VALUES(body), built_at = VALUES(built_at), took_ms = VALUES(took_ms), timed_out = VALUES(timed_out)`,
    [kind, key, body ? JSON.stringify(body) : null, tookMs, timedOut ? 1 : 0],
  );
}

/** The names due a build tonight: never built, built short, or built long enough ago. Most recently asked first. */
export async function dueForBuild(runQuery, { limit = 600, staleMs = STALE_MS } = {}) {
  const rows = await runQuery(
    `SELECT kind, name_key FROM ${SUMMARY_TABLE}
      WHERE body IS NULL OR timed_out = 1 OR built_at IS NULL OR built_at < DATE_SUB(NOW(), INTERVAL ? SECOND)
      ORDER BY asked_at DESC
      LIMIT ${Number(limit)}`,
    [Math.round(staleMs / 1000)],
  );
  return rows.map((r) => ({ kind: r.kind, key: r.name_key }));
}

/**
 * The nightly pass: every name due, one at a time, each with the time it
 * needs. `build(kind, key)` is the server's live read with the long cap and
 * answers `{ horses, timedOut }`. Sequential on purpose — the whole point is
 * not to sit on the database while anybody waits.
 */
export async function rebuildSummaries(runQuery, build, { log = console, limit = 600 } = {}) {
  const due = await dueForBuild(runQuery, { limit });
  const started = Date.now();
  let built = 0;
  let short = 0;
  let failed = 0;
  for (const { kind, key } of due) {
    const t = Date.now();
    try {
      const r = await build(kind, key);
      await writeSummary(runQuery, kind, key, r?.timedOut ? null : summaryOf(r?.horses ?? []), { tookMs: Date.now() - t, timedOut: Boolean(r?.timedOut) });
      if (r?.timedOut) short += 1;
      else built += 1;
    } catch (err) {
      failed += 1;
      log.warn?.(`summaries: ${kind} ${key} failed: ${err.message}`);
    }
  }
  const out = { due: due.length, built, short, failed, tookMs: Date.now() - started };
  log.log?.(`summaries: ${JSON.stringify(out)}`);
  return out;
}

/* --------------------------------------------------------- the population */

/**
 * The population as a histogram: how many horses at each best flat figure,
 * among those that ran since `since`. One pass, grouped twice; the
 * percentiles come out of the counts, so the dear part runs once.
 */
export const baselineHistogramSql = (flatRun, hint = "") => `
  SELECT ${hint} best, COUNT(*) AS n
    FROM (
      SELECT GREATEST(
               COALESCE(MAX(CASE WHEN ${flatRun} AND preRaceMasterRating BETWEEN 1 AND 140 THEN preRaceMasterRating END), 0),
               COALESCE(MAX(CASE WHEN ${flatRun} AND performanceRating    BETWEEN 1 AND 140 THEN performanceRating    END), 0)
             ) AS best
        FROM APIData_Table2
       WHERE meetingDate >= ?
       GROUP BY horseName, YEAR(foalingDate)
    ) t
   WHERE best > 0
   GROUP BY best
   ORDER BY best`;

/**
 * The walk in slices: one month of runs, each horse's best flat figures in
 * it. The race-date range is the bare column, so the index on it is used;
 * the flat filter and the rating range are in the WHERE, so the rows that
 * could never count are not grouped at all. Same figures as the one-pass
 * query above, merged across months by mergeSlice.
 */
export const baselineSliceSql = (flatRun, hint = "") => `
  SELECT ${hint} horseName AS name, YEAR(foalingDate) AS fy,
         MAX(CASE WHEN preRaceMasterRating BETWEEN 1 AND 140 THEN preRaceMasterRating END) AS bestMaster,
         MAX(CASE WHEN performanceRating    BETWEEN 1 AND 140 THEN performanceRating    END) AS bestPerformance
    FROM APIData_Table2
   WHERE meetingDate >= ? AND meetingDate < ?
     AND ${flatRun}
     AND (preRaceMasterRating BETWEEN 1 AND 140 OR performanceRating BETWEEN 1 AND 140)
   GROUP BY horseName, YEAR(foalingDate)`;

const iso = (d) => d.toISOString().slice(0, 10);

/** Month-long ranges from `since` (inclusive) to `until` (exclusive), as ISO dates. */
export function monthSlices(since, until = new Date()) {
  const start = new Date(`${String(since).slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${iso(until instanceof Date ? until : new Date(until))}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const out = [];
  let from = start;
  while (from < end) {
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    out.push({ from: iso(from), to: iso(to < end ? to : end) });
    from = to;
  }
  return out;
}

/** A range cut in two, for a slice that ran out of time. Null for a single day. */
export function halveSlice({ from, to }) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  const days = Math.round((b - a) / 86_400_000);
  if (days < 2) return null;
  const mid = iso(new Date(a + Math.floor(days / 2) * 86_400_000));
  return [{ from, to: mid }, { from: mid, to }];
}

/**
 * A horse as MySQL's GROUP BY saw it: the name compared without case or
 * accents (the table's collation), and the foaling year.
 */
export const horseKey = (name, fy) =>
  `${String(name ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim()}\u0000${fy ?? ""}`;

/** Each horse's best figure so far, raised by one slice's rows. */
export function mergeSlice(best, rows = []) {
  for (const r of rows) {
    const figure = Math.max(Number(r.bestMaster) || 0, Number(r.bestPerformance) || 0);
    if (!(figure > 0)) continue;
    const key = horseKey(r.name, r.fy);
    if (!(best.get(key) >= figure)) best.set(key, figure);
  }
  return best;
}

/** The merged bests as histogram rows `{ best, n }`, for histogramStats. */
export function histogramOf(best) {
  const counts = new Map();
  for (const figure of best.values()) counts.set(figure, (counts.get(figure) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([b, n]) => ({ best: b, n }));
}

/**
 * The population measured a month at a time. `runQuery(sql, args)` reads
 * one slice; a slice that times out is halved and each half asked once
 * more. Any slice that still fails fails the measurement, so a partial
 * population is never kept. Returns `{ rows, slices, tookMs, slowest }`.
 */
export async function measureInSlices(runQuery, { flatRun, since, until = new Date(), hint = BASELINE_SLICE_HINT, pauseMs = 500, isTimeout = () => false } = {}) {
  const started = Date.now();
  const best = new Map();
  let slices = 0;
  let slowest = { ms: 0, from: null, to: null };
  const read = async (slice, depth = 0) => {
    const t0 = Date.now();
    try {
      const rows = await runQuery(baselineSliceSql(flatRun, hint), [slice.from, slice.to]);
      mergeSlice(best, rows);
      slices += 1;
      const ms = Date.now() - t0;
      if (ms > slowest.ms) slowest = { ms, from: slice.from, to: slice.to };
    } catch (err) {
      const halves = depth < 2 && isTimeout(err) ? halveSlice(slice) : null;
      if (!halves) {
        err.slice = slice;
        throw err;
      }
      for (const h of halves) await read(h, depth + 1);
    }
  };
  for (const slice of monthSlices(since, until)) {
    await read(slice);
    // A breath between months, so the other reads of the night (and of a
    // day, when it is asked for by hand) are not queued behind the walk.
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return { rows: histogramOf(best), slices, tookMs: Date.now() - started, slowest };
}

/**
 * The grades' lines on the population, as the user defines them: an A+ is
 * the top 3% of rated horses, an A the top 10%, a B the top 20%, a C the
 * top half; the rest is a D. Each is the lowest figure whose share from the
 * top is still inside the band.
 */
export const GRADE_SHARES = [
  ["A+", 0.03],
  ["A", 0.1],
  ["B", 0.2],
  ["C", 0.5],
];

/**
 * Count, mean, spread and the grade lines from histogram rows `{ best, n }`.
 * Returns null for an empty histogram — the fallback is the caller's.
 */
export function histogramStats(rows = []) {
  const bins = rows
    .map((r) => ({ best: Number(r.best), n: Number(r.n) || 0 }))
    .filter((b) => Number.isFinite(b.best) && b.best > 0 && b.n > 0)
    .sort((a, b) => a.best - b.best);
  const n = bins.reduce((a, b) => a + b.n, 0);
  if (!n) return null;
  const mean = bins.reduce((a, b) => a + b.best * b.n, 0) / n;
  const sd = n > 1 ? Math.sqrt(bins.reduce((a, b) => a + b.n * (b.best - mean) ** 2, 0) / (n - 1)) : null;
  // Shares from the top: the grade line is the lowest figure whose share of
  // horses at or above it is still within the band.
  const lines = {};
  for (const [grade, share] of GRADE_SHARES) {
    let above = 0;
    let line = bins[bins.length - 1].best;
    for (let i = bins.length - 1; i >= 0; i -= 1) {
      if ((above + bins[i].n) / n > share) break;
      above += bins[i].n;
      line = bins[i].best;
    }
    lines[grade] = line;
  }
  const median = (() => {
    let seen = 0;
    for (const b of bins) {
      seen += b.n;
      if (seen >= n / 2) return b.best;
    }
    return bins[bins.length - 1].best;
  })();
  return { n, mean: Number(mean.toFixed(2)), sd: sd === null ? null : Number(sd.toFixed(2)), median, grades: lines };
}

/** The flat population is 'flat-2y'; the worldwide file's black-type count is 'worldwide'. */
export async function readBaseline(runQuery, id = "flat-2y") {
  const rows = await runQuery(`SELECT body, built_at FROM ${BASELINE_TABLE} WHERE id = ?`, [id]);
  const row = rows?.[0];
  if (!row) return null;
  const body = parseBody(row.body);
  return body ? { ...body, builtAt: toMs(row.built_at) } : null;
}

export async function writeBaseline(runQuery, body, id = "flat-2y") {
  await runQuery(
    `INSERT INTO ${BASELINE_TABLE} (id, body, built_at) VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE body = VALUES(body), built_at = VALUES(built_at)`,
    [id, JSON.stringify(body)],
  );
}

export default {
  SUMMARY_TABLE,
  BASELINE_TABLE,
  CREATE_SUMMARY,
  CREATE_BASELINE,
  FRESH_MS,
  STALE_MS,
  NIGHTLY_HINT,
  BASELINE_HINT,
  BASELINE_SLICE_HINT,
  BACKGROUND_HINT,
  GRADE_SHARES,
  isFresh,
  summaryOf,
  ratingsView,
  readSummaries,
  rememberAsked,
  writeSummary,
  dueForBuild,
  rebuildSummaries,
  baselineHistogramSql,
  baselineSliceSql,
  monthSlices,
  halveSlice,
  mergeSlice,
  histogramOf,
  measureInSlices,
  histogramStats,
  readBaseline,
  writeBaseline,
};
