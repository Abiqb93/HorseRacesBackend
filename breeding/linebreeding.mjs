/**
 * Deep linebreeding: do horses carrying more crosses of a dominant ancestor
 * than their contemporaries run better?
 *
 * The question (24 November 2026, Richard on Better Loosen Up's 25 crosses of
 * St Simon): "is Northern Dancer going to be the next horse that we see in
 * pedigrees where we're going to see significant inbreeding in the eighth and
 * ninth generation ... over 20 crosses", and whether that many crosses, "male
 * and female", act as "a genetic retaining wall".
 *
 * The study, in five steps:
 *
 *   runners    every horse by the chosen sires, foaled in the chosen crops,
 *              with a run in Britain or Ireland (where Timeform rates every
 *              runner): its best flat figure and its black-type wins
 *   pedigrees  each sire's 6x6 grid from Arion, once, and each dam's 6x6:
 *              together they are the foal's seven generations
 *   measures   for each foal, the crosses of the ancestor asked about (where
 *              they sit, on which side) and his share of the foal's pedigree,
 *              the sum of one half to the power of each cross's generation;
 *              and the closest duplication of any ancestor, so close
 *              inbreeding is kept apart from deep linebreeding
 *   baseline   a foal is read against his half-brothers and sisters: the
 *              same sire, the same crop. Within a sire the sire's side is
 *              fixed, so what varies is what the dam brings
 *   the test   best figure against crosses within sire and crop, holding the
 *              dam's other produce (her other runners' figures) and the
 *              closest duplication constant; and the black-type rate of the
 *              foals above their sire-and-crop's average against those below
 *
 * The grids come from Arion a few at a time, at night, inside a daily
 * allowance of their own that leaves the team's own reports their room; a
 * study of two thousand dams takes a few weeks at that pace, and says so.
 *
 * Pure functions first; the job and its tables after.
 */

import { HORSE_SUMMARY_SELECT, summariseHorse, studBookName } from "./mating.mjs";
import { normaliseName } from "../pedigree/store.mjs";

export const DEFAULT_CROPS = [2015, 2019];
export const DEFAULT_TARGET = "Northern Dancer";
export const GRID_GENERATIONS = 6;
/** Grids a day for the study, and the room left in Arion's own allowance for the team. */
export const DAILY_GRIDS = 120;
export const ARION_HEADROOM = 40;
/** The hours (UTC) the study reads in: out of everyone's way. */
export const WINDOW_UTC = [0, 6];
/** A grid that fails this many times is left out. */
export const MAX_TRIES = 3;

/* ---------------------------------------------------------------- keys */

export const horseKey = (name, year) => `${normaliseName(name)}|${year ?? ""}`;
export const damKey = (dam, damsire) => `dam|${normaliseName(dam)}|${normaliseName(damsire)}`;
export const sireKey = (sire) => `sire|${normaliseName(sire)}`;
/** An ancestor's key: its name without its country, as every grid spells it differently. */
export const ancestorKey = (name) => normaliseName(name);

/* ------------------------------------------------------------ pedigrees */

/** A parsed grid's ancestors as stored: [path, key, year]. */
export const compactGrid = (ancestors = []) => ancestors.map((a) => [a.path, ancestorKey(a.name), a.foaling_year ?? null]);

/**
 * The foal's pedigree from his sire's grid and his dam's: the sire and dam
 * themselves in the first generation, then each grid one generation down
 * and on its own side. Two 6x6 grids make seven generations.
 */
export function foalPedigree({ sire, dam, sireGrid = [], damGrid = [] }) {
  const out = [];
  if (sire) out.push({ path: "S", gen: 1, key: ancestorKey(sire) });
  if (dam) out.push({ path: "D", gen: 1, key: ancestorKey(dam) });
  for (const [path, key] of sireGrid) out.push({ path: `S${path}`, gen: path.length + 1, key });
  for (const [path, key] of damGrid) out.push({ path: `D${path}`, gen: path.length + 1, key });
  return out;
}

/**
 * One ancestor in a pedigree: how many times, where, on which side, and his
 * share of it, each cross worth a half to the power of its generation (a
 * grandparent a quarter, a seventh-generation ancestor 1/128).
 */
export function crossesOf(pedigree, target) {
  const key = ancestorKey(target);
  const hits = pedigree.filter((a) => a.key === key);
  const sire = hits.filter((a) => a.path.startsWith("S"));
  const dam = hits.filter((a) => a.path.startsWith("D"));
  return {
    n: hits.length,
    sire: sire.length,
    dam: dam.length,
    gens: hits.map((a) => a.gen).sort((x, y) => x - y),
    share: hits.reduce((t, a) => t + 0.5 ** a.gen, 0),
    text: `${sire.map((a) => a.gen).sort((x, y) => x - y).join(",") || "-"} x ${dam.map((a) => a.gen).sort((x, y) => x - y).join(",") || "-"}`,
  };
}

/**
 * The closest duplication on both sides: the lowest sum of generations of any
 * ancestor found on the sire's side and the dam's (3x4 is 7). Null when no
 * ancestor appears on both. This is close inbreeding, held apart from the
 * deep crosses the study is about.
 */
export function closestDuplication(pedigree) {
  const sire = new Map();
  const dam = new Map();
  for (const a of pedigree) {
    const side = a.path.startsWith("S") ? sire : dam;
    side.set(a.key, Math.min(side.get(a.key) ?? 99, a.gen));
  }
  let best = null;
  for (const [k, g] of sire) {
    if (!dam.has(k)) continue;
    const sum = g + dam.get(k);
    if (best === null || sum < best.sum) best = { key: k, sum, text: `${g}x${dam.get(k)}` };
  }
  return best;
}

/** The ancestors that repeat most across a set of pedigrees, by mean crosses a horse. */
export function mostRepeated(pedigrees, { top = 10, minCrosses = 2 } = {}) {
  const total = new Map();
  for (const p of pedigrees) {
    const n = new Map();
    for (const a of p) n.set(a.key, (n.get(a.key) ?? 0) + 1);
    for (const [k, c] of n) if (c >= minCrosses) total.set(k, (total.get(k) ?? 0) + c);
  }
  return [...total.entries()]
    .map(([key, crosses]) => ({ key, mean: crosses / Math.max(1, pedigrees.length) }))
    .sort((a, b) => b.mean - a.mean)
    .slice(0, top);
}

/* --------------------------------------------------------------- the test */

/**
 * Least squares within groups: each variable less its group's mean, then
 * ordinary least squares on what is left (the sire-and-crop baseline taken
 * out of every horse). `rows` are { group, y, x: [..] }; returns each
 * coefficient with its standard error, or null where too few rows vary.
 */
export function withinGroups(rows, names = []) {
  const groups = new Map();
  for (const r of rows) {
    if (!Number.isFinite(r.y) || r.x.some((v) => !Number.isFinite(v))) continue;
    if (!groups.has(r.group)) groups.set(r.group, []);
    groups.get(r.group).push(r);
  }
  const data = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const my = g.reduce((t, r) => t + r.y, 0) / g.length;
    const mx = Array.from({ length: names.length }, (_, j) => g.reduce((t, r) => t + r.x[j], 0) / g.length);
    for (const r of g) data.push({ y: r.y - my, x: r.x.map((v, j) => v - mx[j]) });
  }
  const used = [...groups.values()].filter((g) => g.length >= 2).length;
  // a variable that never moves within a group says nothing here: it is
  // left out and reported as such, rather than making the sum unsolvable
  const keep = Array.from({ length: names.length }, (_, j) => j).filter((j) => data.reduce((t, d) => t + d.x[j] ** 2, 0) > 1e-9);
  const k = keep.length;
  const n = data.length;
  const dof = n - used - k;
  if (!k || dof < 10) return null;
  const xtx = Array.from({ length: k }, () => new Array(k).fill(0));
  const xty = new Array(k).fill(0);
  for (const d of data) {
    for (let i = 0; i < k; i += 1) {
      xty[i] += d.x[keep[i]] * d.y;
      for (let j = 0; j < k; j += 1) xtx[i][j] += d.x[keep[i]] * d.x[keep[j]];
    }
  }
  const inv = invert(xtx);
  if (!inv) return null;
  const beta = inv.map((row) => row.reduce((t, v, j) => t + v * xty[j], 0));
  let rss = 0;
  for (const d of data) {
    const fit = keep.reduce((t, col, i) => t + d.x[col] * beta[i], 0);
    rss += (d.y - fit) ** 2;
  }
  const s2 = rss / dof;
  return {
    n,
    groups: used,
    coefficients: names.map((name, j) => {
      const i = keep.indexOf(j);
      return i < 0 ? { name, estimate: null, se: null, note: "does not vary within sire and crop" } : { name, estimate: beta[i], se: Math.sqrt(s2 * inv[i][i]) };
    }),
    residualSd: Math.sqrt(s2),
  };
}

/** A small matrix's inverse by Gauss-Jordan, or null when it has none. */
export function invert(m) {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) return null;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let j = 0; j < 2 * n; j += 1) a[c][j] /= d;
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = a[r][c];
      for (let j = 0; j < 2 * n; j += 1) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((row) => row.slice(n));
}

/**
 * The study's reading for one ancestor: each foal's crosses and share, his
 * best figure, his dam's other produce, and the tests above. `foals` carry
 * { sire, crop, sex, best, blackType, pedigree, damProduce } where
 * damProduce is the mean best figure of the dam's other runners (null if
 * she has none on record).
 */
export function readStudy(foals, target = DEFAULT_TARGET) {
  const rows = foals
    .filter((f) => f.pedigree?.length)
    .map((f) => {
      const c = crossesOf(f.pedigree, target);
      const close = closestDuplication(f.pedigree);
      return { ...f, crosses: c.n, share: c.share, damSide: c.dam, closeSum: close ? close.sum : 15, group: `${normaliseName(f.sire)}|${f.crop}|${f.sex ?? ""}` };
    });
  const rated = rows.filter((r) => Number.isFinite(r.best));
  const group = (r) => `${normaliseName(r.sire)}|${r.crop}`;

  const crossesOnly = withinGroups(rated.map((r) => ({ group: r.group, y: r.best, x: [r.crosses] })), ["crosses"]);
  const withControls = withinGroups(
    rated.filter((r) => Number.isFinite(r.damProduce)).map((r) => ({ group: r.group, y: r.best, x: [r.crosses, r.damProduce, r.closeSum] })),
    ["crosses", "dam's other produce", "closest duplication"],
  );
  const byShare = withinGroups(rated.map((r) => ({ group: r.group, y: r.best, x: [r.share * 100] })), ["share, per point"]);

  // above and below the sire-and-crop's own average
  const means = new Map();
  for (const r of rows) {
    const g = group(r);
    const m = means.get(g) ?? { t: 0, n: 0 };
    m.t += r.crosses;
    m.n += 1;
    means.set(g, m);
  }
  const split = { above: { n: 0, bt: 0, best: [] }, level: { n: 0, bt: 0, best: [] }, below: { n: 0, bt: 0, best: [] } };
  for (const r of rows) {
    const m = means.get(group(r));
    if (!m || m.n < 2) continue;
    const d = r.crosses - m.t / m.n;
    const side = d > 0.25 ? split.above : d < -0.25 ? split.below : split.level;
    side.n += 1;
    if (r.blackType) side.bt += 1;
    if (Number.isFinite(r.best)) side.best.push(r.best);
  }
  const median = (v) => {
    if (!v.length) return null;
    const s = [...v].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const crossTable = new Map();
  for (const r of rows) {
    const t = crossTable.get(r.crosses) ?? { crosses: r.crosses, n: 0, bt: 0 };
    t.n += 1;
    if (r.blackType) t.bt += 1;
    crossTable.set(r.crosses, t);
  }
  return {
    target,
    foals: rows.length,
    rated: rated.length,
    meanCrosses: rows.length ? rows.reduce((t, r) => t + r.crosses, 0) / rows.length : null,
    crossesOnly,
    withControls,
    byShare,
    baseline: Object.fromEntries(
      Object.entries(split).map(([k, v]) => [k, { n: v.n, blackType: v.bt, blackTypeRate: v.n ? v.bt / v.n : null, medianBest: median(v.best) }]),
    ),
    byCrosses: [...crossTable.values()].sort((a, b) => a.crosses - b.crosses).map((t) => ({ ...t, blackTypeRate: t.n ? t.bt / t.n : null })),
  };
}

/* ----------------------------------------------------------------- SQL */

const IN = (n) => new Array(n).fill("?").join(", ");

/** Every horse by these sires in these crops, from its runs in Britain and Ireland. */
export const runnersSql = (sires) =>
  `${HORSE_SUMMARY_SELECT.replace("SELECT ", "SELECT /*+ MAX_EXECUTION_TIME(600000) */ ")}
   WHERE sireName IN (${IN(sires)}) AND YEAR(foalingDate) BETWEEN ? AND ? AND countryCode IN ('GBR', 'IRE')
   GROUP BY horseName, YEAR(foalingDate)`;

/** The runners already saved for these sires and crops, for a resumed plan. */
export const savedRunnersSql = (sires) =>
  `SELECT name, crop, sire, dam, damsire FROM study_lb_runners WHERE sire IN (${IN(sires)}) AND crop BETWEEN ? AND ?`;

/** The sires with the most runners in Britain and Ireland in these crops. */
export const topSiresSql = `
  SELECT /*+ MAX_EXECUTION_TIME(600000) */ sireName AS sire, COUNT(DISTINCT horseName) AS n
    FROM APIData_Table2
   WHERE YEAR(foalingDate) BETWEEN ? AND ? AND countryCode IN ('GBR', 'IRE')
   GROUP BY sireName ORDER BY n DESC LIMIT ?`;

/** Dam names in one search of the results table: all of the study's at once. */
export const PRODUCE_NAMES = 10000;

/** Every runner out of these dams, any sire, any crop: their other produce. */
export const produceSql = (dams) =>
  `${HORSE_SUMMARY_SELECT.replace("SELECT ", "SELECT /*+ MAX_EXECUTION_TIME(1800000) */ ")}
   WHERE damName IN (${IN(dams)}) AND countryCode IN ('GBR', 'IRE')
   GROUP BY horseName, YEAR(foalingDate)`;

/* --------------------------------------------------------------- tables */

export const TABLES = [
  // the pages Arion sent that did not read as a grid, kept to be looked at
  `CREATE TABLE IF NOT EXISTS study_lb_pages (
     grid_key VARCHAR(191) NOT NULL PRIMARY KEY,
     html MEDIUMTEXT NOT NULL,
     error TEXT NULL,
     saved_at DATETIME NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS study_lb_state (
     id TINYINT NOT NULL PRIMARY KEY,
     enabled TINYINT NOT NULL DEFAULT 0,
     plan TEXT NULL,
     stage VARCHAR(40) NULL,
     note TEXT NULL,
     started_by VARCHAR(64) NULL,
     started_at DATETIME NULL,
     planned_at DATETIME NULL
   )`,
  `CREATE TABLE IF NOT EXISTS study_lb_runners (
     horse_key VARCHAR(191) NOT NULL PRIMARY KEY,
     name VARCHAR(191) NOT NULL,
     crop SMALLINT NOT NULL,
     sex VARCHAR(8) NULL,
     sire VARCHAR(191) NOT NULL,
     dam VARCHAR(191) NULL,
     damsire VARCHAR(191) NULL,
     best SMALLINT NULL,
     runs INT NOT NULL DEFAULT 0,
     stakes_wins INT NOT NULL DEFAULT 0,
     group_wins INT NOT NULL DEFAULT 0,
     group1_wins INT NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS study_lb_produce (
     dam_key VARCHAR(191) NOT NULL,
     horse_key VARCHAR(191) NOT NULL,
     best SMALLINT NULL,
     PRIMARY KEY (dam_key, horse_key)
   )`,
  `CREATE TABLE IF NOT EXISTS study_lb_grids (
     grid_key VARCHAR(191) NOT NULL PRIMARY KEY,
     kind VARCHAR(8) NOT NULL,
     name VARCHAR(191) NOT NULL,
     sire_hint VARCHAR(191) NULL,
     status VARCHAR(12) NOT NULL DEFAULT 'todo',
     tries INT NOT NULL DEFAULT 0,
     error TEXT NULL,
     ancestors MEDIUMTEXT NULL,
     inbreeding TEXT NULL,
     fetched_at DATETIME NULL,
     KEY status (status)
   )`,
];

/* ------------------------------------------------------------------ job */

const today = (now) => new Date(now).toISOString().slice(0, 10);
export const inWindow = (now = new Date(), [from, to] = WINDOW_UTC) => {
  const h = new Date(now).getUTCHours();
  return h >= from && h < to;
};

/**
 * The study's job: plan it (runners, dams' other produce, the grids to
 * read), then read one grid a tick inside its window and allowance, and
 * read the results back. `fetchGrid` is the Arion grid fetcher;
 * `arionStatus` says how much of Arion's own day is used.
 */
/**
 * Of the horses Arion lists under one name, the one old enough to be this
 * sire or this dam: foaled at least four years before the study's first foal
 * by him or out of her, and no more than 30 (a sire) or 27 (a dam) before
 * the last. Null unless exactly one fits.
 */
export function oldEnough(matches = [], { kind = "dam", lo = null, hi = null } = {}) {
  const first = Number(lo);
  const last = Number(hi);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return null;
  const span = kind === "sire" ? 30 : 27;
  const fit = matches.filter((m) => Number(m?.foaling_year) > 1700 && m.foaling_year <= first - 4 && m.foaling_year >= last - span);
  return fit.length === 1 ? fit[0] : null;
}

/** The stages planning passes through before the pedigrees are read. */
export const PLAN_STAGES = new Set(["planning", "choosing sires", "reading runners", "reading the dams' produce"]);

export function createLinebreedingStudy({ runQuery, fetchGrid, arionStatus = () => ({}), damYear = null, log = console, env = process.env, now = () => new Date() }) {
  let ready = null;
  const ensure = () => {
    ready =
      ready ??
      (async () => {
        for (const sql of TABLES) await runQuery(sql);
      })().catch((err) => {
        ready = null;
        throw err;
      });
    return ready;
  };
  const daily = Number(env.STUDY_DAILY_GRIDS) > 0 ? Number(env.STUDY_DAILY_GRIDS) : DAILY_GRIDS;
  let busy = false;
  // whether this process is planning: a planning stage in the table with no
  // plan running here means a restart cut it off, and the next tick resumes it
  let planning = false;

  const state = async () => (await runQuery("SELECT * FROM study_lb_state WHERE id = 1"))?.[0] ?? null;
  const setState = (fields) => {
    const cols = Object.keys(fields);
    return runQuery(
      `INSERT INTO study_lb_state (id, ${cols.join(", ")}) VALUES (1, ${cols.map(() => "?").join(", ")})
       ON DUPLICATE KEY UPDATE ${cols.map((c) => `${c} = VALUES(${c})`).join(", ")}`,
      Object.values(fields),
    );
  };

  /** Plan the study: its runners, their dams' other produce, the grids to read. */
  /** Rows written a few hundred to a statement: thousands of single writes took minutes. */
  async function writeRows(head, rows, per = 500) {
    if (!rows.length) return;
    const width = rows[0].length;
    const group = `(${new Array(width).fill("?").join(", ")})`;
    for (let i = 0; i < rows.length; i += per) {
      const part = rows.slice(i, i + per);
      await runQuery(`${head} VALUES ${part.map(() => group).join(", ")}`, part.flat());
    }
  }

  async function plan({ sires = null, crops = DEFAULT_CROPS, topSires = 12, resumeFrom = null } = {}) {
    await ensure();
    const [from, to] = crops;
    await setState({ stage: "choosing sires", note: null });
    let chosen = (sires ?? []).map(studBookName).filter(Boolean);
    if (!chosen.length) {
      const rows = await runQuery(topSiresSql, [from, to, Number(topSires)]);
      chosen = rows.map((r) => studBookName(r.sire)).filter(Boolean);
    }
    let runners = [];
    if (resumeFrom === "reading the dams' produce") {
      // the runners were read and saved before the restart: take them back
      runners = (await runQuery(savedRunnersSql(chosen.length), [...chosen, from, to])).map((r) => ({ name: r.name, foalingYear: r.crop, sire: r.sire, dam: r.dam, damsire: r.damsire }));
    }
    if (!runners.length) {
      await setState({ stage: "reading runners", plan: JSON.stringify({ sires: chosen, crops: [from, to] }) });
      for (let i = 0; i < chosen.length; i += 4) {
        const part = chosen.slice(i, i + 4);
        const rows = await runQuery(runnersSql(part.length), [...part, from, to]);
        for (const r of rows) runners.push(summariseHorse(r));
      }
      runners = runners.filter((h) => h.name && h.foalingYear && h.sire);
      await writeRows(
        "REPLACE INTO study_lb_runners (horse_key, name, crop, sex, sire, dam, damsire, best, runs, stakes_wins, group_wins, group1_wins)",
        runners.map((h) => [horseKey(h.name, h.foalingYear), h.name, h.foalingYear, h.sex, studBookName(h.sire), h.dam, h.damsire, h.best, h.runs, h.stakesWins, h.groupWins, h.group1Wins]),
      );
    }
    // the dams, and every runner out of each: her other produce is the
    // study's measure of the mare. All the dams' names go in one search, so
    // the results table is gone through once (dam name has no index there).
    const dams = new Map();
    for (const h of runners) if (h.dam) dams.set(damKey(h.dam, h.damsire), { dam: h.dam, damsire: h.damsire });
    const names = [...new Set([...dams.values()].map((d) => d.dam))];
    await setState({ stage: "reading the dams' produce", note: `${names.length.toLocaleString("en-GB")} dams` });
    const produce = [];
    for (let i = 0; i < names.length; i += PRODUCE_NAMES) {
      const part = names.slice(i, i + PRODUCE_NAMES);
      for (const r of await runQuery(produceSql(part.length), part)) {
        const h = summariseHorse(r);
        const dk = damKey(h.dam, h.damsire);
        if (dams.has(dk)) produce.push([dk, horseKey(h.name, h.foalingYear), h.best]);
      }
    }
    await writeRows("REPLACE INTO study_lb_produce (dam_key, horse_key, best)", produce);
    // the grids: each sire once, each dam once
    await writeRows("INSERT IGNORE INTO study_lb_grids (grid_key, kind, name, sire_hint)", [
      ...chosen.map((s) => [sireKey(s), "sire", s, null]),
      ...[...dams].map(([k, d]) => [k, "dam", d.dam, d.damsire ?? null]),
    ]);
    await setState({ stage: "reading pedigrees", planned_at: now(), note: null });
    log.log?.(`[study] linebreeding planned: ${chosen.length} sires, ${runners.length} runners, ${dams.size} dams`);
    return { sires: chosen, runners: runners.length, dams: dams.size };
  }

  /** Plan in the background; the status says where it has got to, or why it failed. */
  function runPlan(args) {
    planning = true;
    return plan(args)
      .catch(async (err) => {
        log.warn?.(`[study] linebreeding plan failed: ${err.message}`);
        await setState({ stage: "plan failed", note: err.message }).catch(() => {});
      })
      .finally(() => {
        planning = false;
      });
  }

  async function start({ userId, sires = null, crops = DEFAULT_CROPS, topSires = 12 } = {}) {
    await ensure();
    await setState({ enabled: 1, started_by: String(userId ?? "").slice(0, 64) || null, started_at: now(), stage: "planning" });
    runPlan({ sires, crops, topSires });
    return { started: true };
  }

  async function stop() {
    await ensure();
    await setState({ enabled: 0 });
    return { stopped: true };
  }

  async function status() {
    await ensure();
    const s = await state();
    const g = await runQuery("SELECT kind, status, COUNT(*) AS n FROM study_lb_grids GROUP BY kind, status");
    const r = await runQuery("SELECT COUNT(*) AS n FROM study_lb_runners");
    const t = await runQuery("SELECT COUNT(*) AS n FROM study_lb_grids WHERE fetched_at >= ?", [`${today(now())} 00:00:00`]);
    const grids = {};
    for (const row of g ?? []) grids[`${row.kind}:${row.status}`] = Number(row.n);
    const todo = Object.entries(grids).filter(([k]) => k.endsWith(":todo")).reduce((x, [, n]) => x + n, 0);
    return {
      enabled: Boolean(Number(s?.enabled)),
      stage: s?.stage ?? null,
      note: s?.note ?? null,
      plan: s?.plan ? JSON.parse(s.plan) : null,
      startedAt: s?.started_at ?? null,
      runners: Number(r?.[0]?.n ?? 0),
      grids,
      readToday: Number(t?.[0]?.n ?? 0),
      dailyGrids: daily,
      window: `${WINDOW_UTC[0]}:00-${WINDOW_UTC[1]}:00 UTC`,
      daysLeft: Math.ceil(todo / daily),
      failures: (await runQuery("SELECT kind, name, error FROM study_lb_grids WHERE status = 'failed' ORDER BY fetched_at DESC LIMIT 15")) ?? [],
    };
  }

  /** A page that did not read as a grid, as Arion sent it; the latest when no key is given. */
  async function page(key = null) {
    await ensure();
    const rows = key
      ? await runQuery("SELECT grid_key, html, error, saved_at FROM study_lb_pages WHERE grid_key = ?", [key])
      : await runQuery("SELECT grid_key, html, error, saved_at FROM study_lb_pages ORDER BY saved_at DESC LIMIT 1");
    return rows?.[0] ?? null;
  }

  /** The failed grids back in the queue, to be asked for again. */
  async function retryFailed() {
    await ensure();
    const r = await runQuery("UPDATE study_lb_grids SET status = 'todo', tries = 0, error = NULL WHERE status = 'failed'");
    return { requeued: Number(r?.affectedRows ?? 0) };
  }

  /** One grid, if the window, the study's allowance and Arion's own allow it. */
  async function tick() {
    if (busy) return { skipped: "busy" };
    busy = true;
    try {
      await ensure();
      const s = await state();
      if (s && Number(s.enabled) && PLAN_STAGES.has(s.stage) && !planning) {
        // a restart (a deploy) stopped the planning part way: start it again
        // with the sires and crops it was given
        const saved = s.stage !== "planning" && s.stage !== "choosing sires" && s.plan ? JSON.parse(s.plan) : {};
        runPlan({ sires: saved.sires ?? null, crops: saved.crops ?? DEFAULT_CROPS, resumeFrom: s.stage });
        log.log?.(`[study] linebreeding: planning resumed from "${s.stage}"`);
        return { resumed: s.stage };
      }
      if (!s || !Number(s.enabled) || s.stage !== "reading pedigrees") return { skipped: "not reading" };
      if (!inWindow(now())) return { skipped: "outside the window" };
      const t = await runQuery("SELECT COUNT(*) AS n FROM study_lb_grids WHERE fetched_at >= ?", [`${today(now())} 00:00:00`]);
      if (Number(t?.[0]?.n ?? 0) >= daily) return { skipped: "today's allowance used" };
      const a = (await arionStatus()) ?? {};
      if (Number.isFinite(a.usedToday) && Number.isFinite(a.dailyLimit) && a.usedToday >= a.dailyLimit - ARION_HEADROOM) {
        return { skipped: "Arion's day is nearly used" };
      }
      const next = (await runQuery(`SELECT * FROM study_lb_grids WHERE status = 'todo' ORDER BY kind = 'sire' DESC, grid_key LIMIT 1`))?.[0];
      if (!next) {
        await setState({ stage: "pedigrees read" });
        return { skipped: "nothing left" };
      }
      const ask = (year = null) =>
        fetchGrid({ name: next.name, sire: next.sire_hint ?? null, year, generations: GRID_GENERATIONS, userId: "linebreeding-study", keep: false });
      let grid = null;
      let failure = null;
      try {
        grid = await ask();
      } catch (err) {
        failure = err;
      }
      // several of the name: the one old enough to be this sire or this dam,
      // asked for again by its year (Kodiac (GB) 2001, not Kodiac (CHI) 2012)
      // a dam Arion lists twice: her foaling year from the Return of Mares,
      // where one mare of the name is by her sire (26 November 2026: "Arion
      // lists 17 horses called ALL THE RAGE")
      if (failure?.ambiguous && next.kind === "dam" && damYear) {
        const y = await Promise.resolve(damYear(next.name, next.sire_hint ?? null)).catch(() => null);
        if (y) {
          try {
            grid = await ask(y);
            failure = null;
          } catch (err) {
            failure = err;
          }
        }
      }
      if (failure?.ambiguous && Array.isArray(failure.matches)) {
        const crops = (await runQuery(
          next.kind === "sire"
            ? "SELECT MIN(crop) AS lo, MAX(crop) AS hi FROM study_lb_runners WHERE sire = ?"
            : "SELECT MIN(crop) AS lo, MAX(crop) AS hi FROM study_lb_runners WHERE dam = ? AND damsire <=> ?",
          next.kind === "sire" ? [next.name] : [next.name, next.sire_hint ?? null],
        ))?.[0];
        const one = oldEnough(failure.matches, { kind: next.kind, lo: crops?.lo, hi: crops?.hi });
        if (one) {
          try {
            grid = await ask(one.foaling_year);
            failure = null;
          } catch (err) {
            failure = err;
          }
        }
      }
      if (grid) {
        await runQuery(
          "UPDATE study_lb_grids SET status = 'done', tries = tries + 1, error = NULL, ancestors = ?, inbreeding = ?, fetched_at = ? WHERE grid_key = ?",
          [JSON.stringify(compactGrid(grid.ancestors)), grid.inbreeding_text ?? null, now(), next.grid_key],
        );
        return { read: next.name };
      }
      if (failure?.html) {
        await runQuery("REPLACE INTO study_lb_pages (grid_key, html, error, saved_at) VALUES (?, ?, ?, ?)", [next.grid_key, String(failure.html).slice(0, 4_000_000), String(failure.message).slice(0, 500), now()]).catch(() => {});
      }
      const tries = Number(next.tries) + 1;
      // a name Arion cannot tell apart, or does not hold, will not change by asking again
      const final = tries >= MAX_TRIES || failure.ambiguous || failure.notFound;
      await runQuery("UPDATE study_lb_grids SET status = ?, tries = ?, error = ?, fetched_at = ? WHERE grid_key = ?", [
        final ? "failed" : "todo",
        tries,
        String(failure.message).slice(0, 500),
        now(),
        next.grid_key,
      ]);
      return { failed: next.name, error: failure.message };
    } finally {
      busy = false;
    }
  }

  /** The study as it stands: the foals whose sire's and dam's grids are read. */
  async function results({ target = DEFAULT_TARGET } = {}) {
    await ensure();
    const runners = await runQuery("SELECT * FROM study_lb_runners");
    const grids = new Map((await runQuery("SELECT grid_key, ancestors FROM study_lb_grids WHERE status = 'done'")).map((g) => [g.grid_key, JSON.parse(g.ancestors)]));
    const produce = new Map();
    for (const p of await runQuery("SELECT dam_key, horse_key, best FROM study_lb_produce")) {
      if (!produce.has(p.dam_key)) produce.set(p.dam_key, []);
      produce.get(p.dam_key).push(p);
    }
    const foals = [];
    for (const r of runners) {
      const sg = grids.get(sireKey(r.sire));
      const dk = damKey(r.dam, r.damsire);
      const dg = grids.get(dk);
      if (!sg || !dg) continue;
      const others = (produce.get(dk) ?? []).filter((p) => p.horse_key !== r.horse_key && Number.isFinite(Number(p.best)) && p.best !== null);
      foals.push({
        name: r.name,
        sire: r.sire,
        crop: Number(r.crop),
        sex: r.sex,
        best: r.best === null ? null : Number(r.best),
        blackType: Number(r.stakes_wins) > 0,
        damProduce: others.length ? others.reduce((t, p) => t + Number(p.best), 0) / others.length : null,
        pedigree: foalPedigree({ sire: r.sire, dam: r.dam, sireGrid: sg, damGrid: dg }),
      });
    }
    const reading = readStudy(foals, target);
    return { ...reading, mostRepeated: mostRepeated(foals.map((f) => f.pedigree), { top: 12 }), status: await status() };
  }

  return { plan, start, stop, status, tick, results, retryFailed, page };
}
