/**
 * Every horse that has raced, worldwide, 2014–2024 crops — the stud book's
 * other half.
 *
 * `breeding/data/horses-<crop>.csv.gz` are eleven files, one per foaling year,
 * one row per horse that ran anywhere: 463,359 horses by 8,714 sires out of
 * 178,705 dams, from the USA (160k) through Australia, Japan, Ireland, France
 * and Britain to Korea and Italy. Each row carries sex, sire, dam, a former
 * name, the career — runs, listed / stakes / group / Group 1 wins and places —
 * and the turf and all-weather records: runs, wins, the range of winning
 * distances, prize money in US dollars, the best distance and the going it
 * came on.
 *
 * ## What it adds to the results table
 *
 * Our results table knows the horses our feeds cover, with their Timeform
 * figures. This file knows every runner on earth, without a figure. The two
 * answer different questions about a mating: the first, *how good* the
 * relatives were; the second, *how many* of a sire's foals reached black
 * type, at what distances, on which surface, in which countries — the
 * questions a breeder asks of a stallion standing in Kentucky or Japan whose
 * runners never appear in a British results feed.
 *
 * ## Loaded on boot, once
 *
 * The table is created if absent and filled if short. A deploy restarts the
 * process, so the count check runs on every boot and the fill only once; a
 * fill is ~930 batched inserts and runs in the background while the server
 * answers requests. Nothing here is on a request path.
 *
 * Names: `sire` and `dam` are kept as the file writes them, "NICCONI (AUS)",
 * and a `*_key` beside each holds the stud-book form the results table uses,
 * "NICCONI" — so a join between the two never trips on a suffix.
 */

import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { studBookName } from "./mating.mjs";

export const TABLE = "breeding_horses";
/** The file's row count; the table is refilled if it holds fewer than this. */
export const EXPECTED_ROWS = 463_000;
const DATA_DIR = fileURLToPath(new URL("./data/", import.meta.url));

export const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    horse_name        VARCHAR(80)  NOT NULL,
    foaling_country   VARCHAR(4)   NOT NULL,
    foaling_year      SMALLINT     NOT NULL,
    sex               CHAR(1),
    sire              VARCHAR(80),
    sire_key          VARCHAR(80),
    dam               VARCHAR(80),
    dam_key           VARCHAR(80),
    late_name         VARCHAR(80),
    runs              SMALLINT,
    ls_wins           SMALLINT,
    ls_top3           SMALLINT,
    s_wins            SMALLINT,
    s_top3            SMALLINT,
    g_wins            SMALLINT,
    g_top3            SMALLINT,
    g1_wins           SMALLINT,
    g1_top3           SMALLINT,
    turf_vs_aw        TINYINT,
    turf_runs         SMALLINT,
    turf_wins         SMALLINT,
    turf_min_win_dist SMALLINT,
    turf_max_win_dist SMALLINT,
    turf_prize_usd    BIGINT,
    turf_best_dist    SMALLINT,
    turf_best_going   VARCHAR(4),
    aw_runs           SMALLINT,
    aw_wins           SMALLINT,
    aw_min_win_dist   SMALLINT,
    aw_max_win_dist   SMALLINT,
    aw_prize_usd      BIGINT,
    aw_best_dist      SMALLINT,
    aw_best_going     VARCHAR(4),
    PRIMARY KEY (horse_name, foaling_year, foaling_country),
    KEY idx_bh_sire (sire_key),
    KEY idx_bh_dam (dam_key)
  )`;

export const COLUMNS = [
  "horse_name", "foaling_country", "foaling_year", "sex", "sire", "sire_key", "dam", "dam_key",
  "late_name", "runs", "ls_wins", "ls_top3", "s_wins", "s_top3", "g_wins", "g_top3", "g1_wins",
  "g1_top3", "turf_vs_aw", "turf_runs", "turf_wins", "turf_min_win_dist", "turf_max_win_dist",
  "turf_prize_usd", "turf_best_dist", "turf_best_going", "aw_runs", "aw_wins", "aw_min_win_dist",
  "aw_max_win_dist", "aw_prize_usd", "aw_best_dist", "aw_best_going",
];

/**
 * One CSV line to fields. Quoted fields with embedded commas and doubled
 * quotes are handled; nothing else in this file needs more than that.
 */
export function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const int = (v) => (v === "" || v === "NULL" || v == null ? null : Number.parseInt(v, 10));
const big = (v) => (v === "" || v === "NULL" || v == null ? null : Number(v));
const str = (v, max) => (v === "" || v === "NULL" || v == null ? null : String(v).slice(0, max));

/** A file row, keyed by header, to a table row in COLUMNS order. */
export function rowFromRecord(r) {
  return [
    str(r.HorseName, 80), str(r.FoalingCountry, 4), int(r.FoalingYear), str(r.Sex, 1),
    str(r.Sire, 80), studBookName(r.Sire).slice(0, 80) || null,
    str(r.Dam, 80), studBookName(r.Dam).slice(0, 80) || null,
    str(r.LateName, 80),
    int(r.AllRuns), int(r.LSWins), int(r.LSTop3), int(r.SWins), int(r.STop3), int(r.GWins), int(r.GTop3),
    int(r.G1Wins), int(r.G1Top3), int(r.TurfvsAW),
    int(r.TurfRuns), int(r.TurfWins), int(r.TurfMinWinDist), int(r.TurfMaxWinDist), big(r.TurfPrizemoneyUSD),
    int(r.TurfBestDistance), str(r.TurfBestGoing, 4),
    int(r.AWRuns), int(r.AWWins), int(r.AWMinWinDist), int(r.AWMaxWinDist), big(r.AWPrizemoneyUSD),
    int(r.AWBestDistance), str(r.AWBestGoing, 4),
  ];
}

/** Stream one gzipped crop file as header-keyed records. */
export async function* readCrop(file) {
  const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  let header = null;
  for await (const line of lines) {
    if (!line) continue;
    if (!header) { header = splitCsvLine(line).map((h) => h.trim()); continue; }
    const cells = splitCsvLine(line);
    const rec = {};
    header.forEach((h, i) => { rec[h] = cells[i] ?? ""; });
    yield rec;
  }
}

/**
 * Create the table if it is missing and fill it if it is short. Returns a
 * summary; never throws on a bad row — one unreadable line is one horse
 * missing, not a boot failure.
 */
export async function ensureWorldwideHorses(runQuery, { log = console, batch = 500 } = {}) {
  await runQuery(CREATE_TABLE_SQL, []);
  const [{ n }] = await runQuery(`SELECT COUNT(*) AS n FROM ${TABLE}`, []);
  if (Number(n) >= EXPECTED_ROWS) return { filled: false, rows: Number(n) };

  log.log(`breeding horses: table holds ${n}, filling from ${DATA_DIR}`);
  const files = (await readdir(DATA_DIR)).filter((f) => /^horses-\d{4}\.csv\.gz$/.test(f)).sort();
  const placeholders = `(${COLUMNS.map(() => "?").join(",")})`;
  const sql = (k) => `INSERT IGNORE INTO ${TABLE} (${COLUMNS.join(",")}) VALUES ${Array(k).fill(placeholders).join(",")}`;
  let inserted = 0;
  let pending = [];
  const flush = async () => {
    if (!pending.length) return;
    const rows = pending;
    pending = [];
    await runQuery(sql(rows.length), rows.flat());
    inserted += rows.length;
  };
  for (const f of files) {
    for await (const rec of readCrop(path.join(DATA_DIR, f))) {
      try {
        const row = rowFromRecord(rec);
        if (!row[0] || !row[2]) continue;
        pending.push(row);
        if (pending.length >= batch) await flush();
      } catch (err) {
        log.warn(`breeding horses: skipped a row in ${f}: ${err.message}`);
      }
    }
    await flush();
    log.log(`breeding horses: ${f} done, ${inserted} rows sent`);
  }
  const [{ n: after }] = await runQuery(`SELECT COUNT(*) AS n FROM ${TABLE}`, []);
  log.log(`breeding horses: table holds ${after}`);
  return { filled: true, rows: Number(after), sent: inserted };
}

/* ------------------------------------------------------------------ reads */

/** A worldwide horse row, shaped like the results table's summaries. */
export const summariseWorldwide = (r) => ({
  name: r.horse_name,
  lateName: r.late_name || null,
  country: r.foaling_country,
  sire: r.sire_key || null,
  dam: r.dam_key || null,
  damsire: r.damsire_key || null,
  sex: r.sex ? String(r.sex).toLowerCase() : null,
  foalingYear: Number(r.foaling_year) || null,
  best: null,
  runs: Number(r.runs) || 0,
  wins: (Number(r.turf_wins) || 0) + (Number(r.aw_wins) || 0),
  stakesWins: Number(r.s_wins) || 0,
  groupWins: Number(r.g_wins) || 0,
  group1Wins: Number(r.g1_wins) || 0,
  listedWins: Number(r.ls_wins) || 0,
  blackTypePlaces: Number(r.s_top3) || 0,
  prizeUsd: (Number(r.turf_prize_usd) || 0) + (Number(r.aw_prize_usd) || 0),
  turfRuns: Number(r.turf_runs) || 0,
  awRuns: Number(r.aw_runs) || 0,
  bestDistance: Number(r.turf_best_dist) || Number(r.aw_best_dist) || null,
  bestGoing: r.turf_best_going || r.aw_best_going || null,
  source: "worldwide",
});

/**
 * The shape of a group of worldwide horses: black-type rates, surface and
 * distance. Distances are binned to the bands a breeder speaks in.
 */
export const DISTANCE_BANDS = [
  { label: "≤6f", max: 1300 },
  { label: "7f", max: 1500 },
  { label: "8f", max: 1700 },
  { label: "9–10f", max: 2100 },
  { label: "11–12f", max: 2500 },
  { label: "13f+", max: Infinity },
];

export function describeWorldwide(horses) {
  const n = horses.length;
  const count = (f) => horses.filter(f).length;
  const bands = DISTANCE_BANDS.map((b) => ({ ...b, n: 0 }));
  for (const h of horses) {
    if (!h.bestDistance) continue;
    const band = bands.find((b) => h.bestDistance <= b.max);
    if (band) band.n += 1;
  }
  const turf = horses.reduce((s, h) => s + h.turfRuns, 0);
  const aw = horses.reduce((s, h) => s + h.awRuns, 0);
  return {
    n,
    winners: count((h) => h.wins > 0),
    stakesWinners: count((h) => h.stakesWins > 0),
    groupWinners: count((h) => h.groupWins > 0),
    group1Winners: count((h) => h.group1Wins > 0),
    blackTypePlaced: count((h) => h.stakesWins > 0 || h.blackTypePlaces > 0),
    turfShare: turf + aw > 0 ? turf / (turf + aw) : null,
    distance: bands.map((b) => ({ label: b.label, n: b.n })),
    byCountry: Object.entries(
      horses.reduce((m, h) => ((m[h.country] = (m[h.country] ?? 0) + 1), m), {}),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([country, n_]) => ({ country, n: n_ })),
  };
}

/** Class before everything: Group 1, then Group, then stakes, then wins, then money. */
export const classScore = (h) =>
  h.group1Wins * 1000 + h.groupWins * 100 + h.stakesWins * 10 + (h.listedWins ?? 0) * 5 + h.wins + (h.prizeUsd ?? 0) / 1e7;
