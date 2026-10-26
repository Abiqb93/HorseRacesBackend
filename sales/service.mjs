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

export function createSalesService({ runQuery, log = console, fetchImpl = fetch } = {}) {
  let index = null;
  let building = null;
  let feeData = null;
  let job = null;
  let lastJob = null;

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
      for (const type of KINDS.filter((k) => k !== "hit")) {
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

  async function status() {
    const [bySource, byKind, imports] = await Promise.all([
      runQuery(`SELECT source, COUNT(*) AS lots, SUM(status = 'sold') AS sold, MIN(year) AS fromYear, MAX(year) AS toYear FROM ${LOTS_TABLE} GROUP BY source`, []),
      runQuery(`SELECT sale_type AS type, region, year, COUNT(*) AS lots, SUM(status = 'sold') AS sold FROM ${LOTS_TABLE} GROUP BY sale_type, region, year ORDER BY sale_type, region, year`, []),
      runQuery(`SELECT source, sale_key, sale_label, year, lots, sold, reconcile, note, error, at FROM ${IMPORTS_TABLE} ORDER BY id DESC LIMIT 60`, []),
    ]);
    return {
      index: index ? { builtAt: index.builtAt, lots: index.lots.length, tookMs: index.tookMs, fees: index.fees } : null,
      bySource: bySource.map((r) => ({ ...r, lots: Number(r.lots), sold: Number(r.sold) })),
      byKind: byKind.map((r) => ({ ...r, lots: Number(r.lots), sold: Number(r.sold) })),
      imports: imports.map((r) => ({ ...r, reconcile: typeof r.reconcile === "string" ? JSON.parse(r.reconcile) : r.reconcile })),
      job: job ? { ...job.state } : null,
      lastJob,
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

  /** Every Tattersalls sale in a range of years, one at a time, in the background. */
  function runTattersalls({ from, to, prefixes = Object.keys(TATTERSALLS), pauseMs = 500 } = {}) {
    if (job) return { running: true, state: job.state };
    const state = { house: "tattersalls", from, to, startedAt: new Date().toISOString(), done: 0, total: (to - from + 1) * prefixes.length, results: [] };
    job = { state };
    (async () => {
      for (let y = from; y <= to; y += 1) {
        for (const p of prefixes) {
          const code = codeFor(p, y);
          try {
            const r = await importTattersalls(code);
            if (r.lots) state.results.push(r);
          } catch (err) {
            state.results.push({ code, error: err.message });
            await logImport(runQuery, { source: "tattersalls", saleLabel: code, year: y, error: err.message }).catch(() => {});
          }
          state.done += 1;
          if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
        }
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
      (await runQuery(`SELECT DISTINCT sale_key, year FROM ${LOTS_TABLE} WHERE source = 'tattersalls'`, [])).map((r) => `${r.sale_key}|${r.year}`),
    );
    const keep = lines.filter((l) => !housed.has(`${l.sale_key}|${l.year}`));
    await upsertLots(runQuery, keep);
    await logImport(runQuery, { source: part.source ?? "seed", saleLabel: part.name, lots: keep.length, sold: keep.filter((l) => l.status === "sold").length, note: `seed part; ${lines.length - keep.length} held by a house feed` });
    return { accepted: true, part: part.name, rows: keep.length, skipped: lines.length - keep.length };
  }

  return { ensure, build, ready, market, sires, sire, dam, hit, status, importTattersalls, runTattersalls, refreshTattersalls, acceptSeed, manifest, figures };
}

export default { createSalesService, HINTS_TABLE };
