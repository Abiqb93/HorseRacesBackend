/**
 * The stallion forecast: how a young sire's runners rate against the par
 * for a sire at the same stage of his career, and what that has meant for
 * the season after.
 *
 * (27 October 2026: "young stallions that have certain proportion of
 * runners that are maybe at 80 plus time form rating, a percentage versus
 * runners, 90 plus a percentage versus runners, 100 plus a percentage
 * versus runners ... what the par is or the baseline is for stallions of
 * that maturity or at that stage in their career. And then the ones that
 * are tracking above that forecast that might really explode next year.")
 *
 * The reading, in four steps:
 *
 *   share   Of a sire's runners to date in Britain and Ireland (every horse
 *           by him with a rated flat run there), the share whose best
 *           Timeform figure so far is 80 or more, 90 or more, 100 or more.
 *           Britain and Ireland because Timeform rates every runner there;
 *           elsewhere the table holds the races Timeform covers, which are
 *           the better ones, so an American sire read on everything held
 *           was read on the few of his runners good enough to travel (Gun
 *           Runner: 22 of his 549 runners, 73% of them rated 80 or more).
 *   stage   Seasons since his first crop ran: stage 1 is his first crop at
 *           two, stage 2 that crop at three and his second at two, and so on.
 *   par     The average share among sires at the same stage in past seasons,
 *           read at the same point of the season (a sire in October is
 *           compared with sires in their October, not with their whole
 *           year), among sires with ten runners or more.
 *   index   His share against par, each share first drawn towards par
 *           (`indexes`) so a sire with eight runners does not top the list
 *           on two good ones. 100 is par; the score is the average of the
 *           three indexes.
 *
 * Next season is read off history: for every past sire, how his index at
 * this point of stage k carried into his whole stage k + 1. A sire well
 * above par tends to stay above it, but less far above, and the fitted
 * carry-over says how much less. The projection is par for next season's
 * stage times that carried-over index.
 *
 * The figures come from the results table a month at a time (the same walk
 * as the population's, summaries.mjs): each month's horses with their best
 * figure, runs and wins, kept in a table so the walk resumes where it
 * stopped after a restart. A settled season is kept as one record; the
 * season in progress month by month, and the last two months are read
 * again each morning, after the night's results have been written.
 *
 * Pure where it can be: the SQL, the plan of what to read, the merging and
 * the forecast itself are plain functions; the walk takes `runQuery`.
 */

import { halveSlice, horseKey } from "./summaries.mjs";
import { studBookName } from "./mating.mjs";

export const PERIODS_TABLE = "breeding_runner_periods";
/**
 * The shape of a stored period. A period stored in an older shape is read
 * again by the walk and left out of the forecast until it has been.
 */
export const PERIOD_VERSION = 2;
/** The race countries where Timeform rates every runner. */
export const HOME_COUNTRIES = ["GBR", "IRE"];
/** The stored forecast's id in the population table (summaries.mjs). */
export const FORECAST_ID = "sire-forecast";
/** The first season walked. */
export const FIRST_SEASON = 2009;
export const THRESHOLDS = [80, 90, 100];
/** Sires with fewer runners than this at a stage are not counted in its par. */
export const MIN_PAR_RUNNERS = 10;
/** Each share is drawn towards par by this many runners' worth. */
export const SHRINK_RUNNERS = 10;
/** The pull towards par is worth at least this many horses over the line. */
export const PRIOR_HORSES = 2;
/** An index is capped at this many times par. */
export const MAX_INDEX = 4;
/** Stages beyond this are proven sires: no forecast. */
export const MAX_STAGE = 10;
/** Fewer runners than this and a sire is listed but not graded. */
export const MIN_GRADED_RUNNERS = 10;
/** "Might go on" takes more: twenty runners, so a small book's three good horses do not make the call. */
export const BREAKOUT_MIN_RUNNERS = 20;
/** One month of the walk: five minutes, as the population's. */
export const SLICE_HINT = "/*+ MAX_EXECUTION_TIME(300000) */";
/** A stored body is cut into parts of this many characters. */
export const PART_CHARS = 900_000;

export const CREATE_PERIODS = `
  CREATE TABLE IF NOT EXISTS ${PERIODS_TABLE} (
    period VARCHAR(10) NOT NULL,
    part SMALLINT NOT NULL DEFAULT 0,
    body MEDIUMTEXT NOT NULL,
    horses INT NOT NULL DEFAULT 0,
    took_ms INT NULL,
    built_at DATETIME NOT NULL,
    PRIMARY KEY (period, part)
  )`;

/**
 * One month of runs, each horse once: its best flat figures in the month,
 * its runs and its wins. The race-date range is the bare column, so its
 * index is used; only rated flat runs are grouped, so a runner is a horse
 * Timeform has rated (the French feed's own rows carry no figures and are
 * left out rather than counted as unrated runners).
 */
export const sliceSql = (flatRun, hint = "") => `
  SELECT ${hint} horseName AS name, YEAR(foalingDate) AS fy, MAX(sireName) AS sire,
         MAX(CASE WHEN preRaceMasterRating BETWEEN 1 AND 140 THEN preRaceMasterRating END) AS bestMaster,
         MAX(CASE WHEN performanceRating    BETWEEN 1 AND 140 THEN performanceRating    END) AS bestPerformance,
         COUNT(*) AS runs,
         SUM(CASE WHEN CAST(positionOfficial AS UNSIGNED) = 1 THEN 1 ELSE 0 END) AS wins,
         SUM(COALESCE(Stakes_Win, 0)) AS stakesWins,
         SUM(COALESCE(Group_Win, 0))  AS groupWins,
         SUM(COALESCE(Group1_Win, 0)) AS group1Wins,
         SUM(CASE WHEN countryCode IN (${HOME_COUNTRIES.map((c) => `'${c}'`).join(", ")}) THEN 1 ELSE 0 END) AS homeRuns
    FROM APIData_Table2
   WHERE meetingDate >= ? AND meetingDate < ?
     AND ${flatRun}
     AND (preRaceMasterRating BETWEEN 1 AND 140 OR performanceRating BETWEEN 1 AND 140)
   GROUP BY horseName, YEAR(foalingDate)`;

/* ------------------------------------------------------------- the plan */

const pad = (n) => String(n).padStart(2, "0");
export const monthId = (season, month) => `${season}-${pad(month)}`;
export const monthRange = (season, month) => ({
  from: `${season}-${pad(month)}-01`,
  to: month === 12 ? `${season + 1}-01-01` : `${season}-${pad(month + 1)}-01`,
});

/**
 * A season is settled once February of the next year begins: the last
 * December results have been rewritten by then. Until it is, it is kept
 * month by month.
 */
export const isSettled = (season, now = new Date()) =>
  now.getUTCFullYear() > season + 1 || (now.getUTCFullYear() === season + 1 && now.getUTCMonth() >= 1);

/**
 * What to read, in order, given the periods held: the current and last
 * month always (the morning's results, and corrections to the days before);
 * then any month of an open season not held; then each settled season whose
 * months are all held, put together without reading anything; then the
 * settled seasons not held, newest first, twelve months each.
 */
export function walkPlan(now = new Date(), held = new Set(), { firstSeason = FIRST_SEASON } = {}) {
  const T0 = now.getUTCFullYear();
  const M0 = now.getUTCMonth() + 1;
  const tasks = [];
  const seen = new Set();
  const push = (t) => {
    const id = t.kind === "month" ? monthId(t.season, t.month) : `${t.kind}:${t.season}`;
    if (seen.has(id)) return;
    seen.add(id);
    tasks.push(t);
  };
  const last = M0 === 1 ? { season: T0 - 1, month: 12 } : { season: T0, month: M0 - 1 };
  push({ kind: "month", season: T0, month: M0, refresh: true });
  if (!isSettled(last.season, now)) push({ kind: "month", ...last, refresh: true });
  for (let T = T0; T >= firstSeason; T -= 1) {
    if (isSettled(T, now)) continue;
    const upTo = T === T0 ? M0 : 12;
    for (let m = upTo; m >= 1; m -= 1) if (!held.has(monthId(T, m))) push({ kind: "month", season: T, month: m });
  }
  for (let T = T0 - 1; T >= firstSeason; T -= 1) {
    if (!isSettled(T, now) || held.has(String(T))) continue;
    const months = Array.from({ length: 12 }, (_, i) => monthId(T, i + 1));
    push(months.every((m) => held.has(m)) ? { kind: "rollup", season: T } : { kind: "season", season: T });
  }
  return tasks;
}

/** The month reads a task costs. */
export const taskSlices = (t) => (t.kind === "month" ? 1 : t.kind === "season" ? 12 : 0);

/* --------------------------------------------------------- the records */

// A horse in a period, as an array: compact, because a season holds forty
// thousand of them and is stored as JSON.
export const F = { name: 0, fy: 1, sire: 2, best: 3, runs: 4, wins: 5, sw: 6, gw: 7, g1w: 8, first: 9, m80: 10, m90: 11, m100: 12, home: 13 };
const MONTH_AT = [F.m80, F.m90, F.m100];

const minMonth = (a, b) => (a && b ? Math.min(a, b) : a || b || 0);

/** One period's horses from a month's rows: `Map(key -> record)`, the sire as a name. */
export function monthRecords(rows = [], month, into = new Map()) {
  for (const r of rows) {
    const best = Math.max(Number(r.bestMaster) || 0, Number(r.bestPerformance) || 0);
    if (!(best > 0)) continue;
    const fy = Number(r.fy) || 0;
    const rec = [
      String(r.name ?? "").trim(),
      fy,
      String(r.sire ?? "").trim(),
      best,
      Number(r.runs) || 0,
      Number(r.wins) || 0,
      Number(r.stakesWins) || 0,
      Number(r.groupWins) || 0,
      Number(r.group1Wins) || 0,
      month,
      ...THRESHOLDS.map((x) => (best >= x ? month : 0)),
      Number(r.homeRuns) || 0,
    ];
    if (!rec[F.name]) continue;
    mergeInto(into, horseKey(rec[F.name], fy), rec);
  }
  return into;
}

/** A record added to a period's map: best raised, counts summed, the first months kept. */
export function mergeInto(map, key, rec) {
  const had = map.get(key);
  if (!had) {
    map.set(key, [...rec]);
    return map;
  }
  had[F.best] = Math.max(had[F.best], rec[F.best]);
  for (const i of [F.runs, F.wins, F.sw, F.gw, F.g1w, F.home]) had[i] = (had[i] ?? 0) + (rec[i] ?? 0);
  for (const i of [F.first, ...MONTH_AT]) had[i] = minMonth(had[i], rec[i]);
  if (!had[F.sire] && rec[F.sire]) had[F.sire] = rec[F.sire];
  return map;
}

/** A period's map as stored: the sires named once, each horse pointing at its sire. */
export function encodePeriod(map, period) {
  const sires = [];
  const at = new Map();
  const horses = [];
  for (const rec of map.values()) {
    const s = rec[F.sire] || "";
    if (!at.has(s)) {
      at.set(s, sires.length);
      sires.push(s);
    }
    const out = [...rec];
    out[F.sire] = at.get(s);
    horses.push(out);
  }
  return { v: PERIOD_VERSION, period, sires, horses };
}

/** A stored period back to `Map(key -> record)`, the sire as a name again. */
export function decodePeriod(body) {
  const map = new Map();
  if (!body?.horses) return map;
  for (const h of body.horses) {
    const rec = [...h];
    rec[F.sire] = body.sires?.[h[F.sire]] ?? "";
    map.set(horseKey(rec[F.name], rec[F.fy]), rec);
  }
  return map;
}

/* ------------------------------------------------------------ the table */

/** Every period held: `{ period, horses, builtAt }`, without the bodies. */
export async function heldPeriods(runQuery) {
  const rows = await runQuery(
    `SELECT period, MAX(horses) AS horses, MAX(built_at) AS built_at, MAX(took_ms) AS took_ms, COUNT(*) AS parts,
            MAX(CASE WHEN part = 0 THEN SUBSTRING(body, 1, 16) END) AS head
       FROM ${PERIODS_TABLE} GROUP BY period ORDER BY period`,
    [],
  );
  return rows.map((r) => ({
    period: r.period,
    horses: Number(r.horses) || 0,
    builtAt: r.built_at ?? null,
    tookMs: r.took_ms ?? null,
    parts: Number(r.parts) || 0,
    v: Number(/"v":(\d+)/.exec(String(r.head ?? ""))?.[1]) || 0,
  }));
}

/** One period written in parts (a whole season is a few megabytes of JSON), replacing what was there. */
export async function writePeriod(runQuery, period, map, { tookMs = null } = {}) {
  const text = JSON.stringify(encodePeriod(map, period));
  const parts = [];
  for (let i = 0; i < text.length; i += PART_CHARS) parts.push(text.slice(i, i + PART_CHARS));
  if (!parts.length) parts.push("");
  for (let p = 0; p < parts.length; p += 1) {
    await runQuery(
      `INSERT INTO ${PERIODS_TABLE} (period, part, body, horses, took_ms, built_at) VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE body = VALUES(body), horses = VALUES(horses), took_ms = VALUES(took_ms), built_at = VALUES(built_at)`,
      [period, p, parts[p], map.size, tookMs],
    );
  }
  await runQuery(`DELETE FROM ${PERIODS_TABLE} WHERE period = ? AND part >= ?`, [period, parts.length]);
  return { period, horses: map.size, parts: parts.length, chars: text.length };
}

/** One stored period, its parts joined. Null when it is not held or does not parse. */
export async function readPeriod(runQuery, period) {
  const rows = await runQuery(`SELECT part, body FROM ${PERIODS_TABLE} WHERE period = ? ORDER BY part`, [period]);
  if (!rows.length) return null;
  try {
    return JSON.parse(rows.map((r) => r.body).join(""));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- the walk */

/** One month read from the results table, a timed-out month halved as the population's walk does. */
async function readMonth(runQuery, { flatRun, season, month, hint, isTimeout }) {
  const map = new Map();
  const read = async (slice, depth = 0) => {
    try {
      const rows = await runQuery(sliceSql(flatRun, hint), [slice.from, slice.to]);
      monthRecords(rows, month, map);
    } catch (err) {
      const halves = depth < 2 && isTimeout(err) ? halveSlice(slice) : null;
      if (!halves) {
        err.slice = slice;
        throw err;
      }
      for (const h of halves) await read(h, depth + 1);
    }
  };
  await read(monthRange(season, month));
  return map;
}

/**
 * The walk: the plan's tasks in order, as many month reads as `maxSlices`
 * allows. Each period is written as soon as it is read, so a restart loses
 * at most the one in hand. `progress` is told after each task.
 */
export async function walkPeriods(runQuery, { flatRun, now = new Date(), maxSlices = 24, hint = SLICE_HINT, pauseMs = 1500, isTimeout = () => false, log = console, progress = () => {}, firstSeason = FIRST_SEASON } = {}) {
  const started = Date.now();
  const held = new Set((await heldPeriods(runQuery)).filter((p) => p.v >= PERIOD_VERSION).map((p) => p.period));
  const tasks = walkPlan(now, held, { firstSeason });
  const done = [];
  let slices = 0;
  const pause = () => (pauseMs ? new Promise((r) => setTimeout(r, pauseMs)) : null);
  for (const t of tasks) {
    const cost = taskSlices(t);
    if (cost && slices + cost > maxSlices) break;
    const t0 = Date.now();
    if (t.kind === "month") {
      const map = await readMonth(runQuery, { flatRun, season: t.season, month: t.month, hint, isTimeout });
      await writePeriod(runQuery, monthId(t.season, t.month), map, { tookMs: Date.now() - t0 });
      slices += 1;
      done.push({ period: monthId(t.season, t.month), horses: map.size, ms: Date.now() - t0 });
      await pause();
    } else {
      const season = new Map();
      for (let m = 1; m <= 12; m += 1) {
        let month;
        if (t.kind === "rollup") month = decodePeriod(await readPeriod(runQuery, monthId(t.season, m)));
        else {
          month = await readMonth(runQuery, { flatRun, season: t.season, month: m, hint, isTimeout });
          slices += 1;
          await pause();
        }
        for (const [k, rec] of month) mergeInto(season, k, rec);
      }
      await writePeriod(runQuery, String(t.season), season, { tookMs: Date.now() - t0 });
      await runQuery(`DELETE FROM ${PERIODS_TABLE} WHERE period LIKE ?`, [`${t.season}-%`]);
      done.push({ period: String(t.season), horses: season.size, ms: Date.now() - t0, kind: t.kind });
    }
    progress({ done: done.length, of: tasks.length, slices, last: done[done.length - 1] });
  }
  const remaining = tasks.length - done.length;
  const out = { tasks: tasks.length, done, remaining, slices, tookMs: Date.now() - started };
  log.log?.(`forecast walk: ${done.length} of ${tasks.length} periods, ${slices} months read, ${Math.round(out.tookMs / 1000)}s`);
  return out;
}

/** Every period held, decoded and put together by season: `Map(season -> Map(key -> record))`. */
export async function readSeasons(runQuery) {
  const out = new Map();
  for (const p of await heldPeriods(runQuery)) {
    if (p.v < PERIOD_VERSION) continue;
    const season = Number(p.period.slice(0, 4));
    const map = decodePeriod(await readPeriod(runQuery, p.period));
    if (!out.has(season)) out.set(season, new Map());
    const into = out.get(season);
    for (const [k, rec] of map) mergeInto(into, k, rec);
  }
  return out;
}

/* --------------------------------------------------------- the forecast */

const sireKey = (raw) => studBookName(raw).normalize("NFD").replace(/[̀-ͯ]/g, "");

const quantile = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const round = (v, dp = 4) => (Number.isFinite(v) ? Number(v.toFixed(dp)) : null);

/**
 * The season the forecast reads as current: this one from March, when the
 * turf season has begun; last season, whole, in January and February.
 */
export const currentPoint = (now = new Date()) => {
  const T0 = now.getUTCFullYear();
  const M0 = now.getUTCMonth() + 1;
  return M0 >= 3 ? { season: T0, month: M0 } : { season: T0 - 1, month: 12 };
};

/** A sire's first crop: the earliest foaling year with two runners or more, so one stray name does not move it. */
export function firstCrop(horses) {
  const counts = new Map();
  for (const h of horses) if (h.fy) counts.set(h.fy, (counts.get(h.fy) ?? 0) + 1);
  const years = [...counts.keys()].sort((a, b) => a - b);
  return years.find((y) => counts.get(y) >= 2) ?? years[0] ?? null;
}

/**
 * A sire's runners at one point: season `T`, through month `cut`. A horse
 * is a runner once it has a rated run by then; its best is its best by
 * then. Returns counts at each threshold, stakes and group winners (whole
 * seasons only: wins carry no month), and the horses themselves when asked.
 */
export function pointStats(horses, T, cut, { keep = false, inProgress = false, homeOnly = true } = {}) {
  let runners = 0;
  const n = THRESHOLDS.map(() => 0);
  let sw = 0;
  let gw = 0;
  const kept = [];
  for (const h of horses) {
    let ran = false;
    let best = 0;
    const reached = THRESHOLDS.map(() => false);
    let swHorse = 0;
    let gwHorse = 0;
    let runs = 0;
    let lastSeason = 0;
    let home = false;
    for (const [season, rec] of h.seasons) {
      if (season > T) continue;
      if (season < T || (rec[F.first] && rec[F.first] <= cut)) {
        ran = true;
        lastSeason = Math.max(lastSeason, season);
        if (rec[F.home] > 0) home = true;
      }
      if (season < T) {
        best = Math.max(best, rec[F.best]);
        THRESHOLDS.forEach((x, i) => {
          if (rec[F.best] >= x) reached[i] = true;
        });
        swHorse += rec[F.sw];
        gwHorse += rec[F.gw];
        runs += rec[F.runs];
      } else {
        MONTH_AT.forEach((at, i) => {
          if (rec[at] && rec[at] <= cut) reached[i] = true;
        });
        // The season's best, runs and wins carry no month: counted whole at
        // the season's end, and for the season in progress, whose record
        // ends where the point is. A past season read part-way counts only
        // the thresholds, which do carry their month.
        if (cut >= 12 || inProgress) {
          best = Math.max(best, rec[F.best]);
          swHorse += rec[F.sw];
          gwHorse += rec[F.gw];
          runs += rec[F.runs];
        }
      }
    }
    if (!ran || (homeOnly && !home)) continue;
    runners += 1;
    reached.forEach((r, i) => {
      if (r) n[i] += 1;
    });
    if (swHorse) sw += 1;
    if (gwHorse) gw += 1;
    if (keep) kept.push({ h, best, runs, sw: swHorse, gw: gwHorse, lastSeason });
  }
  return { runners, n, sw, gw, horses: keep ? kept : undefined };
}

/**
 * Shares as indexes on par (1 is par), each first drawn towards par. The
 * pull is ten runners' worth, or as many as par expects two horses over the
 * line from, whichever is more: at 80 a sire needs ten runners to move far
 * from par, at 100, where par is a few in a hundred, he needs one or two
 * of them to have got there before it counts for much. Capped at four
 * times par, so one figure cannot carry the average of three.
 */
export function indexes(stats, par) {
  if (!stats?.runners || !par) return null;
  return THRESHOLDS.map((_, i) => {
    const p = par[i];
    if (!(p > 0)) return null;
    const pull = Math.max(SHRINK_RUNNERS, PRIOR_HORSES / p);
    const shrunk = (stats.n[i] + pull * p) / (stats.runners + pull);
    return Math.min(MAX_INDEX, shrunk / p);
  });
}

const meanOf = (xs) => {
  const v = xs.filter(Number.isFinite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** The word for a score: how far from par he is tracking. */
export function verdictOf(score, runners) {
  if (!(runners >= MIN_GRADED_RUNNERS) || !Number.isFinite(score)) return "early";
  if (score >= 140) return "well-ahead";
  if (score >= 115) return "ahead";
  if (score > 85) return "par";
  return "behind";
}

/**
 * The forecast from the seasons held (`readSeasons`), as of `now`.
 *
 * `symbols`, when the Timeform symbols are held, is `Map(horseKey -> symbol)`
 * of each horse's latest master-rating symbol; a "p" or "P" is Timeform's
 * mark that the horse is open to improvement, and a sire's count of them is
 * reported beside his shares.
 */
export function buildForecast(seasons, { now = new Date(), symbols = null, symbolsSince = null, symbolsCount = null } = {}) {
  const point = currentPoint(now);
  const held = [...seasons.keys()].sort((a, b) => a - b);
  if (!held.length) return null;
  const dataFirst = held[0];

  // Horses by sire, each with its seasons in order.
  const horses = new Map();
  for (const T of held) {
    if (T > point.season) continue;
    for (const [key, rec] of seasons.get(T)) {
      if (!rec[F.fy]) continue;
      let h = horses.get(key);
      if (!h) {
        h = { key, name: rec[F.name], fy: rec[F.fy], sire: rec[F.sire], seasons: [] };
        horses.set(key, h);
      }
      if (!h.sire && rec[F.sire]) h.sire = rec[F.sire];
      h.seasons.push([T, rec]);
    }
  }
  const sires = new Map();
  for (const h of horses.values()) {
    const k = sireKey(h.sire);
    if (!k) continue;
    if (!sires.has(k)) sires.set(k, { key: k, name: studBookName(h.sire), horses: [] });
    sires.get(k).horses.push(h);
  }

  // Every sire whose whole record is held: his stats at each stage, through
  // the current month and through the season's end.
  const records = [];
  for (const s of sires.values()) {
    const first = firstCrop(s.horses);
    if (!first || first < dataFirst - 1) continue;
    const stages = [];
    for (let T = first + 2; T <= point.season; T += 1) {
      const k = T - first - 1;
      if (k > MAX_STAGE + 1) break;
      const complete = T < point.season || point.month >= 12;
      stages.push({
        k,
        T,
        toDate: pointStats(s.horses, T, point.month),
        whole: complete ? pointStats(s.horses, T, 12) : null,
      });
    }
    if (stages.length) records.push({ ...s, first, stages });
  }

  // Par at each stage: the average share among past sires with enough
  // runners, to the same point of the season and over the whole of it. The
  // average, not the median: at 100 the median sire in his first seasons
  // has none, and a par of nothing measures nobody.
  const par = [];
  for (let k = 1; k <= MAX_STAGE + 1; k += 1) {
    const toDate = THRESHOLDS.map(() => []);
    const whole = THRESHOLDS.map(() => []);
    let count = 0;
    for (const r of records) {
      const st = r.stages.find((x) => x.k === k);
      if (!st || st.T >= point.season) continue;
      if (st.toDate.runners >= MIN_PAR_RUNNERS) {
        count += 1;
        THRESHOLDS.forEach((_, i) => toDate[i].push(st.toDate.n[i] / st.toDate.runners));
      }
      if (st.whole && st.whole.runners >= MIN_PAR_RUNNERS) THRESHOLDS.forEach((_, i) => whole[i].push(st.whole.n[i] / st.whole.runners));
    }
    par.push({
      stage: k,
      sires: count,
      toDate: toDate.map((xs) => round(meanOf(xs))),
      toDateUpper: toDate.map((xs) => round(quantile(xs, 0.75))),
      whole: whole.map((xs) => round(meanOf(xs))),
      wholeUpper: whole.map((xs) => round(quantile(xs, 0.75))),
      seasons: [...new Set(records.flatMap((r) => r.stages.filter((x) => x.k === k && x.T < point.season).map((x) => x.T)))].sort((a, b) => a - b),
    });
  }
  const parAt = (k) => par.find((p) => p.stage === k) ?? null;

  // The carry-over: for past sires, the index this point of stage k against
  // the index over the whole of stage k + 1, on the log scale, through the
  // origin. Fitted per stage where there are sires enough, else pooled.
  const pairs = THRESHOLDS.map(() => new Map());
  const pooled = THRESHOLDS.map(() => ({ xy: 0, xx: 0, n: 0 }));
  const hold = new Map();
  for (const r of records) {
    for (const st of r.stages) {
      const next = r.stages.find((x) => x.k === st.k + 1);
      if (!next?.whole || st.T >= point.season) continue;
      if (st.toDate.runners < MIN_PAR_RUNNERS || next.whole.runners < MIN_PAR_RUNNERS) continue;
      const a = indexes(st.toDate, parAt(st.k)?.toDate);
      const b = indexes(next.whole, parAt(st.k + 1)?.whole);
      if (!a || !b) continue;
      THRESHOLDS.forEach((_, i) => {
        if (!(a[i] > 0) || !(b[i] > 0)) return;
        const x = Math.log(a[i]);
        const y = Math.log(b[i]);
        const m = pairs[i].get(st.k) ?? { xy: 0, xx: 0, n: 0 };
        m.xy += x * y;
        m.xx += x * x;
        m.n += 1;
        pairs[i].set(st.k, m);
        pooled[i].xy += x * y;
        pooled[i].xx += x * x;
        pooled[i].n += 1;
      });
      // How often a sire a quarter or more above par stayed above it.
      const sa = meanOf(a);
      const sb = meanOf(b);
      if (sa >= 1.25) {
        const m = hold.get(st.k) ?? { ahead: 0, stayed: 0 };
        m.ahead += 1;
        if (sb >= 1) m.stayed += 1;
        hold.set(st.k, m);
      }
    }
  }
  const clampBeta = (b) => Math.max(0, Math.min(1.2, b));
  const betaAt = (i, k) => {
    const m = pairs[i].get(k);
    if (m && m.n >= 40 && m.xx > 0) return clampBeta(m.xy / m.xx);
    return pooled[i].xx > 0 ? clampBeta(pooled[i].xy / pooled[i].xx) : 0.5;
  };
  const carry = [];
  for (let k = 1; k <= MAX_STAGE; k += 1) {
    const h = hold.get(k);
    carry.push({
      stage: k,
      beta: THRESHOLDS.map((_, i) => round(betaAt(i, k), 3)),
      sires: pairs[0].get(k)?.n ?? 0,
      aheadStayed: h ? { ahead: h.ahead, stayed: h.stayed } : null,
    });
  }

  // This season: each young sire's place against par, and next season's call.
  const out = [];
  for (const r of records) {
    const st = r.stages.find((x) => x.T === point.season);
    if (!st || st.k > MAX_STAGE) continue;
    const p = parAt(st.k);
    const stats = pointStats(r.horses, point.season, point.month, { keep: true, inProgress: true });
    if (stats.runners < 3) continue;
    const idx = indexes(stats, p?.toDate);
    const score = idx ? meanOf(idx) * 100 : null;
    const nextPar = parAt(st.k + 1)?.whole ?? null;
    // Next season's index: this one carried over at the fitted rate.
    const carried = idx ? idx.map((v, i) => (v > 0 ? Math.exp(betaAt(i, st.k) * Math.log(v)) : null)) : null;
    const next = carried && nextPar ? THRESHOLDS.map((_, i) => (carried[i] && nextPar[i] > 0 ? round(nextPar[i] * carried[i]) : null)) : null;
    const nextScore = carried && nextPar ? meanOf(carried) * 100 : null;
    const prev = r.stages.find((x) => x.k === st.k - 1);
    const prevIdx = prev ? indexes(prev.toDate, parAt(st.k - 1)?.toDate) : null;
    const kept = stats.horses;
    const active = kept.filter((x) => x.lastSeason === point.season);
    // A symbol is looked up by name and foaling year, and by name alone where
    // it was kept without a foaling date (the backfill fills them in after).
    const symbolOf = (h) => symbols.get(h.key) ?? symbols.get(horseKey(h.name, 0)) ?? "";
    const pHorses = symbols ? active.filter((x) => /p/i.test(symbolOf(x.h))) : null;
    const crops = new Set(r.horses.map((h) => h.fy).filter((y) => y >= r.first)).size;
    out.push({
      sire: r.name,
      key: r.key,
      firstCrop: r.first,
      stage: st.k,
      crops,
      runners: stats.runners,
      active: active.length,
      n: stats.n,
      share: stats.n.map((c) => round(c / stats.runners)),
      par: p?.toDate ?? null,
      index: idx ? idx.map((v) => round(v, 3)) : null,
      score: round(score, 1),
      verdict: verdictOf(score, stats.runners),
      was: prevIdx ? round(meanOf(prevIdx) * 100, 1) : null,
      next,
      nextPar,
      nextScore: round(nextScore, 1),
      // Young, graded, and still a quarter above par once the carry-over has
      // taken its share: the ones that might really go on next season.
      breakout: st.k <= 4 && stats.runners >= BREAKOUT_MIN_RUNNERS && nextScore >= 125,
      stakesWinners: stats.sw,
      groupWinners: stats.gw,
      // Lightly raced: this season's runners with three rated runs or fewer in all.
      unexposed: active.filter((x) => x.runs <= 3).length,
      p: pHorses ? { n: pHorses.length, share: active.length ? round(pHorses.length / active.length) : null, horses: pHorses.sort((a, b) => b.best - a.best).slice(0, 6).map((x) => ({ name: x.h.name, best: x.best, symbol: symbolOf(x.h) })) } : null,
      top: kept
        .filter((x) => x.best > 0)
        .sort((a, b) => b.best - a.best)
        .slice(0, 3)
        .map((x) => ({ name: x.h.name, fy: x.h.fy, best: x.best })),
    });
  }
  out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.runners - a.runners);

  return {
    v: 1,
    builtAt: now.toISOString(),
    season: point.season,
    through: point.month,
    thresholds: THRESHOLDS,
    basis: { countries: HOME_COUNTRIES, words: "runners in Britain and Ireland, where Timeform rates every runner" },
    seasonsHeld: held,
    firstSeason: dataFirst,
    rules: { minParRunners: MIN_PAR_RUNNERS, shrinkRunners: SHRINK_RUNNERS, priorHorses: PRIOR_HORSES, maxIndex: MAX_INDEX, minGradedRunners: MIN_GRADED_RUNNERS, breakoutMinRunners: BREAKOUT_MIN_RUNNERS, maxStage: MAX_STAGE },
    par,
    carry,
    symbols: symbols ? { held: true, since: symbolsSince, horses: symbolsCount ?? symbols.size } : { held: false },
    sires: out,
  };
}

/** The words for a stage, as the page writes them. */
export function stageWords(k) {
  if (k === 1) return "first crop at two";
  if (k === 2) return "first crop at three";
  return `${k}th season of runners`;
}

export default {
  PERIODS_TABLE,
  FORECAST_ID,
  FIRST_SEASON,
  THRESHOLDS,
  CREATE_PERIODS,
  sliceSql,
  walkPlan,
  isSettled,
  monthRecords,
  mergeInto,
  encodePeriod,
  decodePeriod,
  heldPeriods,
  writePeriod,
  readPeriod,
  walkPeriods,
  readSeasons,
  currentPoint,
  firstCrop,
  pointStats,
  indexes,
  verdictOf,
  buildForecast,
  stageWords,
};
