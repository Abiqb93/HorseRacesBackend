/**
 * Return of Mares: the user's files, held as the seed parts they were sent
 * in as, and read into books in memory (rom/books.mjs).
 *
 * The parts are the user's Return of Mares files, one per covering year with
 * breeders left out, kept in the private site repository (data/rom/seed).
 * POST /api/rom/seed takes a part only if its SHA-256 is in
 * rom/seed-manifest.json, and keeps it whole in `rom_seed`; the index is
 * built from the parts held, a couple of minutes after a start and a few
 * seconds after a part arrives. A quarter of a million coverings read in
 * about two seconds, so nothing is written row by row.
 */
import crypto from "node:crypto";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

import { enrichMares, mapsFrom } from "./enrich.mjs";
import { studBookName } from "../breeding/mating.mjs";
import { buildIndex, classFromRunners, crossOf, detailOf, fillClasses, insights, mareOf, maresOf, nameKey, rowOf } from "./books.mjs";

export const SEED_TABLE = "rom_seed";
const CREATE = `
  CREATE TABLE IF NOT EXISTS ${SEED_TABLE} (
    name VARCHAR(64) NOT NULL PRIMARY KEY,
    sha256 CHAR(64) NOT NULL,
    rows_n INT NOT NULL,
    body LONGBLOB NOT NULL,
    loaded_at DATETIME NOT NULL
  )`;
const MANIFEST = path.join(path.dirname(new URL(import.meta.url).pathname), "seed-manifest.json");

const notReady = (why) => Object.assign(new Error(why), { code: "ROM_EMPTY" });

export function createRomService({ runQuery, log = console, manifestPath = MANIFEST, rebuildDelayMs = 4000, sireRunners = null, now = () => new Date() } = {}) {
  let index = null;
  let built = null;
  let building = null;
  let ensured = false;
  let timer = null;
  const seeds = [];

  const manifest = () => {
    try {
      return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      return { parts: [] };
    }
  };

  /**
   * The classes the files leave out, filled: from her other years in the
   * return, then from the worldwide runners file (breeding_horses) for the
   * mares still without one. The runners file is read for those names only;
   * if it is not there the return's own fill stands.
   */
  async function fillFromRunners(rows) {
    const { missing } = fillClasses(rows);
    if (!missing.length) return;
    const own = new Map();
    const names = [...new Set(missing.map((m) => m.name.toUpperCase()))];
    try {
      for (let i = 0; i < names.length; i += 1000) {
        const part = names.slice(i, i + 1000);
        const found = await runQuery(
          `SELECT horse_name, foaling_year, runs, ls_wins, ls_top3, s_wins, s_top3, g_wins, g_top3, g1_wins, turf_wins, aw_wins
             FROM breeding_horses WHERE sex IN ('F', 'M') AND horse_name IN (${part.map(() => "?").join(", ")})`,
          part,
        );
        for (const h of found ?? []) own.set(`${nameKey(h.horse_name)}|${h.foaling_year}`, classFromRunners(h));
      }
    } catch (err) {
      log.warn?.(`[rom] runners file not read for mares' classes: ${err.message}`);
      return;
    }
    fillClasses(rows, { own });
  }

  async function ensure() {
    if (ensured) return;
    await runQuery(CREATE);
    ensured = true;
  }

  /** The index, from every held part the manifest still lists. */
  function build() {
    if (building) return building;
    building = (async () => {
      await ensure();
      const t = Date.now();
      const listed = new Set(manifest().parts.map((p) => p.sha256));
      const parts = await runQuery(`SELECT name, sha256, body FROM ${SEED_TABLE} ORDER BY name`);
      const rows = [];
      let used = 0;
      for (const p of parts) {
        if (!listed.has(p.sha256)) continue;
        used += 1;
        for (const line of zlib.gunzipSync(p.body).toString("utf8").split("\n")) if (line) rows.push(JSON.parse(line));
      }
      if (rows.length) await fillFromRunners(rows);
      const ix = rows.length ? buildIndex(rows) : null;
      if (ix) {
        ix.list = [...ix.stallions.values()].map((s) => rowOf(s, ix)).sort((a, b) => b.latest - a.latest || a.name.localeCompare(b.name));
        ix.insights = insights(ix);
      }
      index = ix;
      built = { at: new Date().toISOString(), tookMs: Date.now() - t, parts: used, coverings: rows.length };
      log.log?.(`[rom] index built: ${rows.length} coverings from ${used} parts in ${built.tookMs} ms`);
      return index;
    })().finally(() => {
      building = null;
    });
    return building;
  }

  const ready = async () => {
    const ix = index ?? (await build());
    if (!ix) throw notReady("No Return of Mares is loaded yet.");
    return ix;
  };

  /** A part, if the manifest lists it: kept whole, and the index rebuilt shortly after. */
  async function acceptSeed(buffer) {
    const sha = crypto.createHash("sha256").update(buffer).digest("hex");
    const part = manifest().parts.find((p) => p.sha256 === sha);
    if (!part) return { accepted: false, sha256: sha };
    let rows = 0;
    try {
      rows = zlib.gunzipSync(buffer).toString("utf8").split("\n").filter(Boolean).length;
    } catch {
      return { accepted: false, sha256: sha, error: "not gzipped NDJSON" };
    }
    await ensure();
    await runQuery(`REPLACE INTO ${SEED_TABLE} (name, sha256, rows_n, body, loaded_at) VALUES (?, ?, ?, ?, NOW())`, [part.name, sha, rows, buffer]);
    seeds.unshift({ part: part.name, rows, at: new Date().toISOString() });
    seeds.splice(40);
    clearTimeout(timer);
    timer = setTimeout(() => build().catch((err) => log.warn?.(`[rom] index not built: ${err.message}`)), rebuildDelayMs);
    timer.unref?.();
    return { accepted: true, part: part.name, rows };
  }

  async function status() {
    await ensure();
    const held = await runQuery(`SELECT name, sha256, rows_n, loaded_at FROM ${SEED_TABLE} ORDER BY name`);
    const parts = manifest().parts.map((p) => {
      const h = held.find((x) => x.name === p.name);
      return { name: p.name, year: p.year ?? null, rows: p.rows, held: Boolean(h && h.sha256 === p.sha256), loadedAt: h?.loaded_at ?? null };
    });
    return {
      parts,
      held: parts.filter((p) => p.held).length,
      wanted: parts.length,
      built,
      building: Boolean(building),
      years: index?.years ?? null,
      feeYears: index?.feeYears ?? null,
      feeFrom: index?.feeFrom ?? null,
      resultsThrough: index?.resultsThrough ?? null,
      stallions: index?.stallions.size ?? null,
      mares: index?.mares.size ?? null,
      recent: seeds.slice(0, 13),
    };
  }

  /** The overview: each year's totals, every stallion's row, and what moved. */
  async function books() {
    const ix = await ready();
    return { years: ix.years, resultsThrough: ix.resultsThrough, firstRunners: ix.firstRunners, feeYears: ix.feeYears, feeFrom: ix.feeFrom, totals: ix.totals, stallions: ix.list, insights: ix.insights, built };
  }

  /** One stallion in full, by name. */
  async function stallion(name) {
    const ix = await ready();
    const s = ix.stallions.get(nameKey(name));
    return s ? { ...detailOf(s, ix), resultsThrough: ix.resultsThrough, firstRunners: ix.firstRunners, feeYears: ix.feeYears, feeFrom: ix.feeFrom, allYears: ix.years } : null;
  }

  /**
   * Several stallions' rows, as a mating plan reads them, each with his
   * record over mares by `msire` (her sire) where one is given.
   */
  async function stallions(names = [], { msire = null } = {}) {
    const ix = await ready();
    const out = [];
    for (const n of names) {
      const s = ix.stallions.get(nameKey(n));
      out.push(s ? { asked: n, ...rowOf(s, ix), cross: msire ? crossOf(ix, s.key, msire) : null } : { asked: n, missing: true });
    }
    return { years: ix.years, resultsThrough: ix.resultsThrough, feeYears: ix.feeYears, feeFrom: ix.feeFrom, stallions: out };
  }

  const maresCache = new Map();
  const MARES_TTL_MS = 30 * 60 * 1000;
  const RUNNER_COLS = "horse_name, foaling_year, sex, dam_key, dam, runs, ls_wins, ls_top3, s_wins, s_top3, g_wins, g_top3, g1_wins, turf_wins, aw_wins";

  /** Rows of the runners file where `col` is one of `values`, a thousand at a time; none if it cannot be read. */
  async function runnersWhere(col, values, extra = "") {
    const out = [];
    const list = [...new Set(values.filter(Boolean))];
    try {
      for (let i = 0; i < list.length; i += 1000) {
        const part = list.slice(i, i + 1000);
        out.push(...((await runQuery(`SELECT ${RUNNER_COLS} FROM breeding_horses WHERE ${col} IN (${part.map(() => "?").join(", ")})${extra}`, part)) ?? []));
      }
    } catch (err) {
      log.warn?.(`[rom] runners file not read (${col}): ${err.message}`);
    }
    return out;
  }

  /**
   * A stallion's mares, covering by covering, made whole from the runners
   * file and his runners on our results table (rom/enrich.mjs). Kept half an
   * hour, since a page opens it again and again.
   */
  async function stallionMares(name) {
    const ix = await ready();
    const key = nameKey(name);
    const hit = maresCache.get(key);
    if (hit && hit.built === ix && Date.now() - hit.at < MARES_TTL_MS) return hit.out;
    const out = maresOf(ix, name);
    if (!out) return null;
    const upper = (v) => studBookName(v);
    const names = out.mares.map((r) => upper(r.mare));
    const [mares, foals, sireFoals] = await Promise.all([
      runnersWhere("horse_name", names, " AND sex IN ('F', 'M')"),
      runnersWhere("dam_key", names),
      runnersWhere("sire_key", [upper(out.name)]),
    ]);
    // the parent map for the dams the runners file does not name
    const noDam = out.mares.filter((r) => !r.mdam).map((r) => upper(r.mare));
    let parents = [];
    try {
      const list = [...new Set(noDam)];
      for (let i = 0; i < list.length; i += 1000) {
        const part = list.slice(i, i + 1000);
        parents.push(...((await runQuery(`SELECT horse_key, sire_key, dam_key FROM horse_parents WHERE dam_key IS NOT NULL AND horse_key IN (${part.map(() => "?").join(", ")})`, part)) ?? []));
      }
    } catch (err) {
      parents = [];
      log.warn?.(`[rom] parent map not read: ${err.message}`);
    }
    let ratings = [];
    if (sireRunners) {
      try {
        ratings = (await sireRunners(upper(out.name))) ?? [];
      } catch (err) {
        log.warn?.(`[rom] his runners not read for ${out.name}: ${err.message}`);
      }
    }
    enrichMares(out, { ...mapsFrom({ mares, foals, sireFoals, ratings, parents }), year: now().getUTCFullYear(), lastReturnYear: out.lastReturnYear });
    out.year = now().getUTCFullYear();
    maresCache.set(key, { at: Date.now(), built: ix, out });
    return out;
  }

  /**
   * A mare's foaling year from the return, by her name and her sire: the
   * one mare of the name by that sire, or null where there is none or more
   * than one. The linebreeding study asks it of a dam Arion lists twice.
   */
  async function mareYear(name, sire) {
    const ix = await ready();
    const k = nameKey(name);
    const want = sire ? nameKey(sire) : null;
    const years = new Set();
    for (const [mk, m] of ix.mares) {
      if (!mk.startsWith(`${k}|`) || !m.myob) continue;
      if (want && (!m.msire || nameKey(m.msire) !== want)) continue;
      years.add(Number(m.myob));
    }
    return years.size === 1 ? [...years][0] : null;
  }

  /** A mare's coverings in the return. */
  async function mare(name, yob = null) {
    const ix = await ready();
    return { resultsThrough: ix.resultsThrough, firstRunners: ix.firstRunners, feeYears: ix.feeYears, feeFrom: ix.feeFrom, ...mareOf(ix, name, yob) };
  }

  return { ensure, build, ready, acceptSeed, status, books, stallion, stallionMares, stallions, mare, mareYear, manifest };
}

export default { createRomService, SEED_TABLE };
