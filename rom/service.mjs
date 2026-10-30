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

import { buildIndex, crossOf, detailOf, insights, mareOf, nameKey, rowOf } from "./books.mjs";

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

export function createRomService({ runQuery, log = console, manifestPath = MANIFEST, rebuildDelayMs = 4000 } = {}) {
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
      resultsThrough: index?.resultsThrough ?? null,
      stallions: index?.stallions.size ?? null,
      mares: index?.mares.size ?? null,
      recent: seeds.slice(0, 13),
    };
  }

  /** The overview: each year's totals, every stallion's row, and what moved. */
  async function books() {
    const ix = await ready();
    return { years: ix.years, resultsThrough: ix.resultsThrough, firstRunners: ix.firstRunners, totals: ix.totals, stallions: ix.list, insights: ix.insights, built };
  }

  /** One stallion in full, by name. */
  async function stallion(name) {
    const ix = await ready();
    const s = ix.stallions.get(nameKey(name));
    return s ? { ...detailOf(s, ix), resultsThrough: ix.resultsThrough, firstRunners: ix.firstRunners, allYears: ix.years } : null;
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
    return { years: ix.years, resultsThrough: ix.resultsThrough, stallions: out };
  }

  /** A mare's coverings in the return. */
  async function mare(name, yob = null) {
    const ix = await ready();
    return { resultsThrough: ix.resultsThrough, ...mareOf(ix, name, yob) };
  }

  return { ensure, build, ready, acceptSeed, status, books, stallion, stallions, mare, manifest };
}

export default { createRomService, SEED_TABLE };
