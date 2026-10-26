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
import { KINDS, marketTable, marketLines, marketMedians, sireMedians, sireTable, hitTable, damRecord, feeFinder, figures } from "./metrics.mjs";
import { nameKey } from "./normalise.mjs";

export const HINTS_TABLE = "sale_fee_hints";
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

export function createSalesService({ runQuery, log = console, fetchImpl = fetch } = {}) {
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
    feeData = { at: Date.now(), feeFor: feeFinder({ history, idOf: (k) => ids.get(k)?.id ?? null, hints, toGbp }), roster: ids.size, hints: hints.size };
    return feeData;
  }

  /* ------------------------------------------------------------ index */

  async function build() {
    if (building) return building;
    building = (async () => {
      const t0 = Date.now();
      const lots = await runQuery(
        `SELECT /*+ MAX_EXECUTION_TIME(240000) */ source, sale_key, sale_name, sale_tier, region, year, sale_type, lot, sire, sire_key, dam_key,
                sex, foaling_year, status, after_sale, price, currency, price_gbp
           FROM ${LOTS_TABLE}`,
        [],
      );
      for (const l of lots) {
        l.price_gbp = l.price_gbp === null ? null : Number(l.price_gbp);
        l.price = l.price === null ? null : Number(l.price);
      }
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
        market: marketTable(lots),
        tables,
        hit,
        sireMedians: sireMedians(lots),
        fees: { roster: fees.roster, hints: fees.hints, lines: lines.size },
        feeFor: fees.feeFor,
      };
      log.log?.(`[sales] index: ${lots.length} lots in ${index.tookMs} ms`);
      return index;
    })().finally(() => {
      building = null;
    });
    return building;
  }

  const ready = async () => index ?? build();

  /* ------------------------------------------------------------ reads */

  async function market({ type = null, region = null } = {}) {
    const ix = await ready();
    const keep = (c) => (!type || c.type === type) && (!region || c.region === region);
    return { builtAt: ix.builtAt, cells: ix.market.cells.filter(keep), sales: ix.market.sales.filter(keep) };
  }

  async function sires({ type = "yearling", region = null, limit = 2000 } = {}) {
    const ix = await ready();
    const t = ix.tables.get(`${type}|${region ?? "ALL"}`);
    if (!t) return { type, region, years: [], rows: [], builtAt: ix.builtAt };
    return { ...t, rows: t.rows.slice(0, limit), builtAt: ix.builtAt };
  }

  async function sire(key) {
    const ix = await ready();
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
    const ix = await ready();
    return damRecord(ix.lots, nameKey(key), { sireMedians: ix.sireMedians });
  }

  async function hit({ region = null } = {}) {
    const ix = await ready();
    return { ...(ix.hit.get(region ?? "ALL") ?? { rows: [], years: [] }), builtAt: ix.builtAt };
  }

  /** What is held and how the feeds went. `quick` leaves the database out: the job, the seeds, the index. */
  async function status({ quick = false } = {}) {
    if (quick) {
      return {
        index: index ? { builtAt: index.builtAt, lots: index.lots.length, tookMs: index.tookMs, fees: index.fees } : null,
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
  function runJob(house, items, importOne, { pauseMs = 500, meta = {}, skip = null } = {}) {
    if (job) return { running: true, state: job.state };
    const state = { house, ...meta, startedAt: new Date().toISOString(), done: 0, total: items.length, skipped: 0, results: [] };
    job = { state };
    (async () => {
      const held = skip ? await skip() : new Set();
      for (const item of items) {
        if (held.has(String(item))) {
          state.skipped += 1;
          state.done += 1;
          continue;
        }
        try {
          const r = await importOne(item);
          if (r.lots) state.results.push(r);
        } catch (err) {
          state.results.push({ item, error: err.message });
          await logImport(runQuery, { source: house, saleLabel: String(item), error: err.message }).catch(() => {});
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
      (await runQuery(`SELECT DISTINCT sale_key, year FROM ${LOTS_TABLE} WHERE source IN ('tattersalls', 'arqana')`, [])).map((r) => `${r.sale_key}|${r.year}`),
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

  return {
    ensure, build, ready, market, sires, sire, dam, hit, status, figures, manifest,
    importTattersalls, runTattersalls, refreshTattersalls, importArqana, runArqana, refreshArqana, acceptSeed, queueSeed,
  };
}

export default { createSalesService, HINTS_TABLE };
