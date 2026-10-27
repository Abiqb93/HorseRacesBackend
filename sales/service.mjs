/**
 * The sales service: the lots held in memory for the pages, the fees they
 * are read against, the house feeds that keep them current, and the seed
 * that loads the workbooks.
 *
 * Reads: the market (by kind, region, year and sale), a kind's sire table,
 * a sire's record across kinds, a mare's produce, horses in training. All
 * served from one in-memory index built from the lots table (a few hundred
 * thousand rows, a few seconds) and rebuilt after every import and nightly.
 *
 * The workbooks are the user's own compilations and are not published in
 * this repository (it is public). They are loaded as gzipped NDJSON parts,
 * each accepted only if its SHA-256 is in seed-manifest.json — which holds
 * only the hashes — so the route cannot be used to write anything else.
 */
import crypto from "node:crypto";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { convert } from "./fx.mjs";
import { ensureSalesSchema, upsertLots, dropSuperseded, logImport, LOTS_TABLE, IMPORTS_TABLE } from "./store.mjs";
import { TATTERSALLS, codeFor, fetchResults, reconcile } from "./tattersalls.mjs";
import { fetchExport as fetchArqana } from "./arqana.mjs";
import * as keeneland from "./keeneland.mjs";
import * as fasig from "./fasig.mjs";
import * as magicmillions from "./magicmillions.mjs";
import * as inglis from "./inglis.mjs";
import * as tattersallsireland from "./tattersallsireland.mjs";
import * as bbag from "./bbag.mjs";
import * as obs from "./obs.mjs";

/**
 * The houses read through one shape: `discover({ year })` lists a year's
 * sales, `fetchSale(id, { info })` reads one into lots. `idOf` turns the
 * label a module gives its lots back into the id it fetches by; BBAG's
 * label is the house's sale number, which it cannot be fetched by, so its
 * sales are kept current by the daily reading alone.
 */
export const FEEDS = {
  keeneland: { mod: keeneland, name: "Keeneland", idOf: (l) => String(l).replace(/^KEE-/, "") },
  fasig: { mod: fasig, name: "Fasig-Tipton", idOf: (l) => String(l).replace(/^FT-/, "") },
  magicmillions: { mod: magicmillions, name: "Magic Millions", idOf: String },
  inglis: { mod: inglis, name: "Inglis", idOf: String },
  tattersallsireland: { mod: tattersallsireland, name: "Tattersalls Ireland", idOf: String },
  bbag: { mod: bbag, name: "BBAG", idOf: null },
  obs: { mod: obs, name: "OBS", idOf: (l) => String(l).replace(/^OBS/, "") },
};
export const HOUSE_SOURCES = ["tattersalls", "arqana", ...Object.keys(FEEDS)];
import { KINDS, marketTable, marketLines, marketMedians, sireMedians, sireTable, hitTable, damRecord, feeFinder, figures, preferHouses } from "./metrics.mjs";
import { nameKey } from "./normalise.mjs";

export const HINTS_TABLE = "sale_fee_hints";
const BUILD_PAGE = 50_000;
const CREATE_HINTS = `
  CREATE TABLE IF NOT EXISTS ${HINTS_TABLE} (
    sire_key VARCHAR(96) NOT NULL,
    cover_year SMALLINT NOT NULL,
    fee_gbp INT NOT NULL,
    PRIMARY KEY (sire_key, cover_year)
  )`;

const SITE = "https://www.blandfordbloodstock.tech";
const MANIFEST = path.join(path.dirname(new URL(import.meta.url).pathname), "seed-manifest.json");

/** What the lots held come from, and how many of each kind, region and year: the status, read from memory. */
export function coverageOf(lots) {
  const bySource = new Map();
  const byKind = new Map();
  for (const l of lots) {
    const sold = l.status === "sold" ? 1 : 0;
    const s = bySource.get(l.source) ?? bySource.set(l.source, { source: l.source, lots: 0, sold: 0, fromYear: l.year, toYear: l.year }).get(l.source);
    s.lots += 1;
    s.sold += sold;
    s.fromYear = Math.min(s.fromYear, l.year);
    s.toYear = Math.max(s.toYear, l.year);
    const k = `${l.sale_type}|${l.region}|${l.year}`;
    const c = byKind.get(k) ?? byKind.set(k, { type: l.sale_type, region: l.region, year: l.year, lots: 0, sold: 0 }).get(k);
    c.lots += 1;
    c.sold += sold;
  }
  return {
    bySource: [...bySource.values()],
    byKind: [...byKind.values()].sort((a, b) => a.type.localeCompare(b.type) || a.region.localeCompare(b.region) || a.year - b.year),
  };
}

/**
 * A lot as the index keeps it: the same fields in the same order for every
 * lot, so V8 gives them all one compact layout (deleting a field from a
 * row instead turns each into a dictionary, six times the memory), and
 * one shared copy of the strings that recur across hundreds of thousands
 * of rows (sale names, sires, statuses), which the database driver
 * otherwise gives every row its own copy of.
 */
const strings = new Map();
const shared = (v) => {
  if (typeof v !== "string") return v;
  const had = strings.get(v);
  if (had !== undefined) return had;
  strings.set(v, v);
  return v;
};
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
export function slim(r) {
  return {
    source: shared(r.source),
    company: shared(r.company ?? null),
    sale_key: shared(r.sale_key),
    sale_name: shared(r.sale_name ?? null),
    sale_tier: r.sale_tier ?? null,
    region: shared(r.region),
    year: r.year,
    sale_type: shared(r.sale_type),
    lot: r.lot ?? null,
    sire: shared(r.sire ?? null),
    sire_key: shared(r.sire_key ?? null),
    dam_key: r.dam_key ?? null,
    sex: shared(r.sex ?? null),
    foaling_year: r.foaling_year ?? null,
    status: shared(r.status),
    after_sale: r.after_sale ?? 0,
    price: num(r.price),
    currency: shared(r.currency ?? null),
    price_gbp: num(r.price_gbp),
  };
}

export function createSalesService({ runQuery, log = console, fetchImpl = fetch, feeds = FEEDS, buildPage = BUILD_PAGE } = {}) {
  let index = null;
  let building = null;
  let feeData = null;
  let job = null;
  let lastJob = null;
  let seedChain = Promise.resolve();
  const seeds = [];

  async function ensure() {
    await ensureSalesSchema(runQuery);
    await runQuery(CREATE_HINTS, []);
  }

  /* ------------------------------------------------------------- fees */

  async function loadFees() {
    if (feeData && Date.now() - feeData.at < 12 * 3600 * 1000) return feeData;
    const get = async (p) => {
      const res = await fetchImpl(`${SITE}${p}`, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
      return res.json();
    };
    let history = {};
    let ids = new Map();
    try {
      const [model, roster] = await Promise.all([get("/data/stallions/fee-model.json"), get("/data/stallions/index.json")]);
      history = model.history ?? {};
      // Two roster stallions can share a name (AUGUSTERODIN, CITY OF TROY):
      // the one standing in Europe wins for sales read in sterling.
      for (const s of roster.stallions ?? []) {
        const k = nameKey(s.n);
        const prev = ids.get(k);
        const europe = (s.regions ?? []).some((r) => /GB|IRE|FR|EUR|UK|GER|ITY/.test(r));
        if (!prev || (europe && !prev.europe)) ids.set(k, { id: s.id, europe });
      }
    } catch (err) {
      log.warn?.(`[sales] fee model not read: ${err.message}`);
    }
    const hints = new Map();
    for (const r of await runQuery(`SELECT sire_key, cover_year, fee_gbp FROM ${HINTS_TABLE}`, []).catch(() => [])) {
      hints.set(`${r.sire_key}|${r.cover_year}`, Number(r.fee_gbp));
    }
    const toGbp = (fee, ccy, year) => {
      const v = convert(fee, ccy, "GBP", String(year));
      return v ? Math.round(v) : null;
    };
    feeData = { at: Date.now(), feeFor: feeFinder({ history, idOf: (k) => ids.get(k)?.id ?? null, hints, toGbp }), roster: ids.size, hints: hints.size, hintMap: hints };
    return feeData;
  }

  /* ------------------------------------------------------------ index */

  async function build() {
    if (building) return building;
    building = (async () => {
      const t0 = Date.now();
      // Read in pages by id, each with its own time limit: the table
      // outgrew what one statement could read in four minutes while the
      // feeds were writing to it.
      const raw = [];
      for (let after = 0; ; ) {
        const page = await runQuery(
          `SELECT /*+ MAX_EXECUTION_TIME(240000) */ id, source, company, sale_key, sale_name, sale_tier, region, year, sale_type, lot, sire, sire_key, dam_key,
                  sex, foaling_year, status, after_sale, price, currency, price_gbp
             FROM ${LOTS_TABLE} WHERE id > ? ORDER BY id LIMIT ${Number(buildPage)}`,
          [after],
        );
        for (const l of page) {
          after = Math.max(after, Number(l.id));
          raw.push(slim(l));
        }
        if (page.length < buildPage) break;
      }
      // A horse a house's results hold is read from them, not a workbook too.
      const { lots, dropped } = preferHouses(raw, new Set(HOUSE_SOURCES));
      const fees = await loadFees();
      const lines = marketLines(lots, fees.feeFor);
      const medians = marketMedians(lots);
      const tables = new Map();
      for (const type of KINDS) {
        for (const region of [null, "EU", "US", "AUS", "NZ"]) {
          const t = sireTable(lots, { type, region, feeFor: fees.feeFor, lines, medians });
          if (t.rows.length) tables.set(`${type}|${region ?? "ALL"}`, t);
        }
      }
      const hit = new Map();
      for (const region of [null, "EU", "US"]) {
        const t = hitTable(lots, { region });
        if (t.rows.length) hit.set(region ?? "ALL", t);
      }
      index = {
        builtAt: new Date().toISOString(),
        tookMs: Date.now() - t0,
        lots,
        coverage: coverageOf(lots),
        workbookTwice: dropped,
        market: marketTable(lots),
        tables,
        hit,
        sireMedians: sireMedians(lots),
        fees: { roster: fees.roster, hints: fees.hints, lines: lines.size },
        feeFor: fees.feeFor,
        // The market's lines and the workbooks' fees by covering year, for
        // the commercial forecast (breeding/commercial.mjs).
        lines: Object.fromEntries(lines),
        hintMap: fees.hintMap ?? new Map(),
      };
      log.log?.(`[sales] index: ${lots.length} lots in ${index.tookMs} ms (${dropped} workbook lots a house also holds left out)`);
      return index;
    })().finally(() => {
      building = null;
    });
    return building;
  }

  const ready = async () => index ?? build();

  /**
   * The index for a page's request: the one held, or, while the first
   * one after a restart is still being built, an error the routes answer
   * with 503 at once, rather than holding the request open for minutes.
   */
  const readyNow = async () => {
    if (index) return index;
    build().catch((err) => log.warn?.(`[sales] index not built: ${err.message}`));
    const err = new Error("the sales figures are being built after a restart; try again in a minute or two");
    err.code = "SALES_BUILDING";
    throw err;
  };

  /* ------------------------------------------------------------ reads */

  async function market({ type = null, region = null } = {}) {
    const ix = await readyNow();
    const keep = (c) => (!type || c.type === type) && (!region || c.region === region);
    return { builtAt: ix.builtAt, cells: ix.market.cells.filter(keep), sales: ix.market.sales.filter(keep) };
  }

  async function sires({ type = "yearling", region = null, limit = 2000 } = {}) {
    const ix = await readyNow();
    const t = ix.tables.get(`${type}|${region ?? "ALL"}`);
    if (!t) return { type, region, years: [], rows: [], builtAt: ix.builtAt };
    return { ...t, rows: t.rows.slice(0, limit), builtAt: ix.builtAt };
  }

  async function sire(key) {
    const ix = await readyNow();
    const k = nameKey(key);
    const out = {};
    for (const [tk, t] of ix.tables) {
      const row = t.rows.find((r) => r.sireKey === k);
      if (row) out[tk] = { ...row, years: t.years };
    }
    const hitRow = ix.hit.get("ALL")?.rows.find((r) => r.sireKey === k) ?? null;
    const lots = ix.lots
      .filter((l) => l.sire_key === k && KINDS.includes(l.sale_type))
      .sort((a, b) => b.year - a.year || (b.price_gbp ?? 0) - (a.price_gbp ?? 0))
      .slice(0, 300);
    return { sireKey: k, tables: out, hit: hitRow, lots, builtAt: ix.builtAt };
  }

  async function dam(key) {
    const ix = await readyNow();
    return damRecord(ix.lots, nameKey(key), { sireMedians: ix.sireMedians });
  }

  /**
   * What the commercial forecast reads: the yearling and foal tables of a
   * region with every year, the market's cells, its lines, and the fees
   * the workbooks give each sire by covering year, in sterling.
   */
  async function commercialInputs({ region = "EU" } = {}) {
    const ix = await readyNow();
    const fees = new Map();
    for (const [k, fee] of ix.hintMap ?? []) {
      const [sireKey, year] = k.split("|");
      if (!fees.has(sireKey)) fees.set(sireKey, []);
      fees.get(sireKey).push([Number(year), Math.round(fee)]);
    }
    for (const list of fees.values()) list.sort((a, b) => a[0] - b[0]);
    return {
      builtAt: ix.builtAt,
      yearlings: ix.tables.get(`yearling|${region}`)?.rows ?? [],
      foals: ix.tables.get(`foal|${region}`)?.rows ?? [],
      cells: ix.market.cells.filter((c) => c.region === region),
      lines: ix.lines ?? {},
      fees,
    };
  }

  async function hit({ region = null } = {}) {
    const ix = await readyNow();
    return { ...(ix.hit.get(region ?? "ALL") ?? { rows: [], years: [] }), builtAt: ix.builtAt };
  }

  /** What is held and how the feeds went. `quick` leaves the database out: the job, the seeds, the index. */
  async function status({ quick = false } = {}) {
    if (quick) {
      return {
        index: index ? { builtAt: index.builtAt, lots: index.lots.length, tookMs: index.tookMs, fees: index.fees, workbookTwice: index.workbookTwice } : null,
        ...(index?.coverage ?? { bySource: [], byKind: [] }),
        job: job ? { ...job.state, results: job.state.results.slice(-5) } : null,
        lastJob,
        seeds,
      };
    }
    // Counting the whole table can take minutes while a feed is writing to
    // it; the counts are given up after 20 seconds and the index's used.
    const counted = await Promise.all([
      runQuery(`SELECT /*+ MAX_EXECUTION_TIME(20000) */ source, COUNT(*) AS lots, SUM(status = 'sold') AS sold, MIN(year) AS fromYear, MAX(year) AS toYear FROM ${LOTS_TABLE} GROUP BY source`, []),
      runQuery(`SELECT /*+ MAX_EXECUTION_TIME(20000) */ sale_type AS type, region, year, COUNT(*) AS lots, SUM(status = 'sold') AS sold FROM ${LOTS_TABLE} GROUP BY sale_type, region, year ORDER BY sale_type, region, year`, []),
    ]).catch((err) => ({ error: err.message }));
    const fallback = index?.coverage ?? { bySource: [], byKind: [] };
    const [bySource, byKind] = counted.error ? [fallback.bySource, fallback.byKind] : counted;
    const imports = await runQuery(`SELECT source, sale_key, sale_label, year, lots, sold, reconcile, note, error, at FROM ${IMPORTS_TABLE} ORDER BY id DESC LIMIT 60`, []);
    return {
      index: index ? { builtAt: index.builtAt, lots: index.lots.length, tookMs: index.tookMs, fees: index.fees } : null,
      counts: counted.error ? `from the index (${counted.error})` : "from the table",
      bySource: bySource.map((r) => ({ ...r, lots: Number(r.lots), sold: Number(r.sold) })),
      byKind: byKind.map((r) => ({ ...r, lots: Number(r.lots), sold: Number(r.sold) })),
      imports: imports.map((r) => ({ ...r, reconcile: typeof r.reconcile === "string" ? JSON.parse(r.reconcile) : r.reconcile })),
      job: job ? { ...job.state } : null,
      lastJob,
      seeds,
    };
  }

  /* ------------------------------------------------------------- feeds */

  /** One Tattersalls sale fetched, checked against the house's totals and written. */
  async function importTattersalls(code) {
    const out = await fetchResults(code, { fetchImpl });
    if (!out.lots.length) return { code, lots: 0, note: "no lots on the page" };
    const rec = reconcile(out);
    await upsertLots(runQuery, out.lots);
    const dropped = await dropSuperseded(runQuery, { saleKey: out.sale.key, year: out.year, source: "tattersalls" });
    const sold = out.lots.filter((l) => l.status === "sold").length;
    await logImport(runQuery, { source: "tattersalls", saleKey: out.sale.key, saleLabel: code, year: out.year, lots: out.lots.length, sold, reconcile: rec, note: dropped ? `replaced ${dropped} workbook rows` : null });
    return { code, lots: out.lots.length, sold, verdict: rec?.verdict ?? null, replaced: dropped };
  }

  /**
   * A list of sales read one at a time in the background, the index rebuilt
   * at the end. One job at a time; asking again while one runs reports it.
   */
  /**
   * One sale's import, given up after `ms`: a fetch or a write that never
   * returns would otherwise hold the job, and every job after it, for good.
   */
  const bounded = (work, ms, what) =>
    Promise.race([work, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what}: no answer in ${Math.round(ms / 1000)} s`)), ms).unref?.())]);

  function runJob(house, items, importOne, { pauseMs = 500, meta = {}, skip = null, itemTimeoutMs: limit } = {}) {
    const itemTimeoutMs = limit ?? 10 * 60_000;
    if (job) return { running: true, state: job.state };
    const state = { house, ...meta, startedAt: new Date().toISOString(), done: 0, total: Array.isArray(items) ? items.length : null, skipped: 0, results: [] };
    job = { state };
    (async () => {
      // A list, or a function that finds it (a house's sales of some years).
      const list = Array.isArray(items) ? items : await items(state);
      state.total = list.length;
      const held = skip ? await skip() : new Set();
      for (const item of list) {
        if (held.has(String(item?.id ?? item))) {
          state.skipped += 1;
          state.done += 1;
          continue;
        }
        try {
          const r = await bounded(importOne(item), itemTimeoutMs, String(item?.id ?? item));
          if (r.lots) state.results.push(r);
        } catch (err) {
          state.results.push({ item: item?.id ?? item, error: err.message });
          await logImport(runQuery, { source: house, saleLabel: String(item?.id ?? item), year: item?.year ?? null, error: err.message }).catch(() => {});
        }
        state.done += 1;
        if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
      }
    })()
      .catch((err) => {
        state.error = err.message;
      })
      .finally(async () => {
        state.finishedAt = new Date().toISOString();
        lastJob = state;
        job = null;
        await build().catch((err) => log.warn?.(`[sales] index not rebuilt: ${err.message}`));
      });
    return { started: true, state };
  }

  /**
   * The sales of a house already read in full: imported without an error,
   * with lots, in a year before this one (this year's may still be
   * selling). A run asked to skip them picks up where a restart cut one off.
   */
  const heldLabels = (source, toLabel = String) => async () => {
    const rows = await runQuery(
      `SELECT DISTINCT sale_label FROM ${IMPORTS_TABLE} WHERE source = ? AND error IS NULL AND lots > 0 AND year < ?`,
      [source, new Date().getFullYear()],
    );
    return new Set(rows.map((r) => toLabel(r.sale_label)));
  };

  /** Every Tattersalls sale in a range of years, one at a time, in the background. */
  function runTattersalls({ from, to, prefixes = Object.keys(TATTERSALLS), pauseMs = 500, skipHeld = false } = {}) {
    const codes = [];
    for (let y = from; y <= to; y += 1) for (const p of prefixes) codes.push(codeFor(p, y));
    return runJob("tattersalls", codes, importTattersalls, { pauseMs, meta: { from, to }, skip: skipHeld ? heldLabels("tattersalls") : null });
  }

  /**
   * One Arqana sale, by its number, read from the house's export and
   * written. The workbook's rows for the same sale and year give way.
   * Arqana publishes no totals beside the export, so there is nothing to
   * reconcile against; the figures are the house's own lot by lot.
   */
  async function importArqana(venid) {
    const out = await fetchArqana(venid, { fetchImpl });
    if (!out.sale || !out.lots.length) return { venid, title: out.title, lots: 0 };
    await upsertLots(runQuery, out.lots);
    const dropped = await dropSuperseded(runQuery, { saleKey: out.sale.key, year: out.sale.year, source: "arqana" });
    const sold = out.lots.filter((l) => l.status === "sold").length;
    const catalogued = out.lots.filter((l) => l.status === "catalogued").length;
    await logImport(runQuery, {
      source: "arqana", saleKey: out.sale.key, saleLabel: `ARQ${venid}`, year: out.sale.year, lots: out.lots.length, sold,
      note: [out.title, catalogued ? `${catalogued} not yet through the ring` : null, dropped ? `replaced ${dropped} workbook rows` : null].filter(Boolean).join("; "),
    });
    return { venid, title: out.title, key: out.sale.key, year: out.sale.year, lots: out.lots.length, sold, catalogued, replaced: dropped };
  }

  /** A run of Arqana's sale numbers (186 is August 2014), in the background. */
  function runArqana({ from, to, pauseMs = 500, skipHeld = false } = {}) {
    const venids = [];
    for (let v = from; v <= to; v += 1) venids.push(v);
    return runJob("arqana", venids, importArqana, { pauseMs, meta: { from, to }, skip: skipHeld ? heldLabels("arqana", (l) => String(l).replace(/^ARQ/, "")) : null });
  }

  const heldArqana = async (where, params) =>
    (await runQuery(`SELECT DISTINCT sale_label FROM ${LOTS_TABLE} WHERE source = 'arqana' AND ${where}`, params))
      .map((r) => Number(String(r.sale_label).replace(/^ARQ/, "")))
      .filter(Number.isFinite);

  /**
   * Arqana kept current. Sales are numbered in order, so the daily reading
   * looks again at this year's sales and at the numbers either side of the
   * newest one held (a catalogue appears weeks before the sale and the
   * numbers are not always issued in sale order). The live reading looks
   * only at the sales with lots not yet through the ring.
   */
  async function refreshArqana({ years = [new Date().getFullYear()], live = false, ahead = 15, behind = 20 } = {}) {
    let venids;
    if (live) {
      venids = await heldArqana(`status = 'catalogued' AND year IN (${years.map(() => "?").join(", ")})`, years);
    } else {
      const thisYear = await heldArqana(`year IN (${years.map(() => "?").join(", ")})`, years);
      const all = await heldArqana("1 = 1", []);
      const top = all.length ? Math.max(...all) : 400;
      const near = [];
      for (let v = top - behind; v <= top + ahead; v += 1) if (!all.includes(v)) near.push(v);
      venids = [...new Set([...thisYear, ...near])].sort((a, b) => a - b);
    }
    const results = [];
    for (const v of venids) {
      try {
        const r = await importArqana(v);
        if (r.lots) results.push(r);
      } catch (err) {
        results.push({ venid: v, error: err.message });
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (results.some((r) => r.lots)) await build().catch((err) => log.warn?.(`[sales] index not rebuilt: ${err.message}`));
    return results;
  }

  /**
   * The house's sales of a year kept current: every sale of `years` read
   * again (daily), or only those still being sold — a sale whose last
   * reading had lots catalogued but not yet through the ring (live).
   */
  async function refreshTattersalls({ years = [new Date().getFullYear()], live = false } = {}) {
    let codes = [];
    if (live) {
      const rows = await runQuery(
        `SELECT DISTINCT sale_label FROM ${LOTS_TABLE} WHERE source = 'tattersalls' AND status = 'catalogued' AND year IN (${years.map(() => "?").join(", ")})`,
        years,
      );
      codes = rows.map((r) => r.sale_label).filter(Boolean);
    } else {
      for (const y of years) for (const p of Object.keys(TATTERSALLS)) codes.push(codeFor(p, y));
    }
    const results = [];
    for (const code of codes) {
      try {
        results.push(await importTattersalls(code));
      } catch (err) {
        results.push({ code, error: err.message });
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (results.some((r) => r.lots)) await build().catch((err) => log.warn?.(`[sales] index not rebuilt: ${err.message}`));
    return results;
  }

  /**
   * One sale of a house read through FEEDS and written. The workbook's
   * rows for the same sale and year give way, as for Tattersalls; the
   * house's totals, where it publishes them, are reconciled against.
   */
  async function importHouse(house, id, info = null) {
    const feed = feeds[house];
    if (!feed) throw new Error(`no feed for ${house}`);
    const out = await feed.mod.fetchSale(id, { fetchImpl, info: info?.key ? info : null });
    if (!out?.sale || !out.lots?.length) return { house, id, title: out?.title ?? info?.title ?? null, lots: 0 };
    await upsertLots(runQuery, out.lots);
    let dropped = 0;
    for (const k of new Set(out.lots.map((l) => `${l.sale_key}|${l.year}`))) {
      const [saleKey, year] = k.split("|");
      dropped += await dropSuperseded(runQuery, { saleKey, year: Number(year), source: house });
    }
    const rec = out.totals && typeof feed.mod.reconcile === "function" ? feed.mod.reconcile(out) : null;
    const sold = out.lots.filter((l) => l.status === "sold").length;
    const catalogued = out.lots.filter((l) => l.status === "catalogued").length;
    await logImport(runQuery, {
      source: house, saleKey: out.sale.key, saleLabel: out.lots[0].sale_label, year: out.sale.year, lots: out.lots.length, sold, reconcile: rec,
      note: [out.title, catalogued ? `${catalogued} not yet through the ring` : null, dropped ? `replaced ${dropped} workbook rows` : null].filter(Boolean).join("; "),
    });
    return { house, id, title: out.title, key: out.sale.key, year: out.sale.year, lots: out.lots.length, sold, catalogued, replaced: dropped, verdict: rec?.verdict ?? null };
  }

  /** A house's sales found year by year and read one at a time, in the background. */
  function runHouse(house, { from, to, pauseMs = 1000, skipHeld = false, itemTimeoutMs } = {}) {
    const feed = feeds[house];
    if (!feed) throw new Error(`no feed for ${house}`);
    const find = async (state) => {
      const all = [];
      for (let y = from; y <= to; y += 1) {
        try {
          all.push(...(await feed.mod.discover({ year: y, fetchImpl })));
        } catch (err) {
          state.results.push({ item: `discover ${y}`, error: err.message });
        }
      }
      return all;
    };
    return runJob(house, find, (entry) => importHouse(house, entry.id, entry), {
      pauseMs, meta: { from, to }, skip: skipHeld && feed.idOf ? heldLabels(house, feed.idOf) : null, itemTimeoutMs,
    });
  }

  /**
   * A house kept current. Daily: the sales of `years` within a month or so
   * of today (a sale's results settle in the weeks after it; a catalogue
   * appears weeks before), and any with lots still to go through the ring.
   * Live: only those with lots still to go through the ring.
   */
  async function refreshHouse(house, { years = [new Date().getFullYear()], live = false, now = new Date() } = {}) {
    const feed = feeds[house];
    const pending = !feed.idOf ? [] : (
      await runQuery(
        `SELECT DISTINCT sale_label FROM ${LOTS_TABLE} WHERE source = ? AND status = 'catalogued' AND year IN (${years.map(() => "?").join(", ")})`,
        [house, ...years],
      )
    ).map((r) => feed.idOf(r.sale_label));
    if (live && !feed.idOf) return [];
    const entries = new Map(pending.map((id) => [id, { id }]));
    if (!live) {
      const monthNo = (m) => (/^\d{4}-\d{2}/.test(String(m)) ? Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) : null);
      const here = now.getFullYear() * 12 + now.getMonth() + 1;
      for (const y of years) {
        for (const e of await feed.mod.discover({ year: y, fetchImpl })) {
          const m = monthNo(e.month);
          if (m === null || Math.abs(m - here) <= 1) entries.set(String(e.id), e);
          else if (entries.has(String(e.id))) entries.set(String(e.id), e);
        }
      }
    }
    const results = [];
    for (const e of entries.values()) {
      try {
        const r = await importHouse(house, e.id, e);
        if (r.lots) results.push(r);
      } catch (err) {
        results.push({ house, id: e.id, error: err.message });
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (results.some((r) => r.lots)) await build().catch((err) => log.warn?.(`[sales] index not rebuilt: ${err.message}`));
    return results;
  }

  /* -------------------------------------------------------------- seed */

  function manifest() {
    try {
      return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    } catch {
      return { parts: [] };
    }
  }

  /**
   * A part of the seed: gzipped NDJSON, accepted only if its SHA-256 is in
   * the manifest. Lots go to the lots table; fee hints to theirs.
   */
  async function acceptSeed(buffer) {
    const sha = crypto.createHash("sha256").update(buffer).digest("hex");
    const part = manifest().parts.find((p) => p.sha256 === sha);
    if (!part) return { accepted: false, sha256: sha };
    const lines = zlib.gunzipSync(buffer).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    if (part.kind === "fee-hints") {
      for (let i = 0; i < lines.length; i += 1000) {
        const chunk = lines.slice(i, i + 1000);
        await runQuery(
          `INSERT INTO ${HINTS_TABLE} (sire_key, cover_year, fee_gbp) VALUES ${chunk.map(() => "(?, ?, ?)").join(", ")} ON DUPLICATE KEY UPDATE fee_gbp = VALUES(fee_gbp)`,
          chunk.flatMap((h) => [h.sire_key, h.cover_year, h.fee_gbp]),
        );
      }
      feeData = null;
      return { accepted: true, part: part.name, rows: lines.length };
    }
    // A sale-year the house's own results hold is not overwritten by a workbook.
    const housed = new Set(
      (await runQuery(`SELECT DISTINCT sale_key, year FROM ${LOTS_TABLE} WHERE source IN (${HOUSE_SOURCES.map(() => "?").join(", ")})`, HOUSE_SOURCES)).map((r) => `${r.sale_key}|${r.year}`),
    );
    const keep = lines.filter((l) => !housed.has(`${l.sale_key}|${l.year}`));
    await upsertLots(runQuery, keep);
    await logImport(runQuery, { source: part.source ?? "seed", saleLabel: part.name, lots: keep.length, sold: keep.filter((l) => l.status === "sold").length, note: `seed part; ${lines.length - keep.length} held by a house feed` });
    return { accepted: true, part: part.name, rows: keep.length, skipped: lines.length - keep.length };
  }

  /**
   * A seed part taken in and loaded in the background, one part after
   * another: loading one takes longer than a request may stay open. The
   * outcome of each is in the status (seeds).
   */
  function queueSeed(buffer, { rebuild = false } = {}) {
    const sha = crypto.createHash("sha256").update(buffer).digest("hex");
    const part = manifest().parts.find((p) => p.sha256 === sha);
    if (!part) return { accepted: false, sha256: sha };
    const entry = { part: part.name, state: "queued", queuedAt: new Date().toISOString() };
    seeds.unshift(entry);
    seeds.splice(40);
    seedChain = seedChain.then(async () => {
      entry.state = "loading";
      try {
        Object.assign(entry, await acceptSeed(buffer), { state: "done", finishedAt: new Date().toISOString() });
      } catch (err) {
        Object.assign(entry, { state: "failed", error: err.message, finishedAt: new Date().toISOString() });
      }
      if (rebuild) await build().catch((err) => log.warn?.(`[sales] index not rebuilt: ${err.message}`));
    });
    return { accepted: true, queued: true, part: part.name };
  }

  /** Whether a long job is writing: the scheduled refreshes wait for the next run rather than write beside it. */
  const busy = () => Boolean(job);

  return {
    ensure, build, ready, busy, market, sires, sire, dam, hit, commercialInputs, status, figures, manifest,
    importTattersalls, runTattersalls, refreshTattersalls, importArqana, runArqana, refreshArqana, importHouse, runHouse, refreshHouse,
    acceptSeed, queueSeed,
  };
}

export default { createSalesService, HINTS_TABLE, FEEDS, HOUSE_SOURCES };
