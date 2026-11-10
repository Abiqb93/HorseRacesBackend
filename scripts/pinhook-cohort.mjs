#!/usr/bin/env node
/**
 * The pinhook cohort read straight from the houses' own published results,
 * without the database: for building and checking the foal model on a
 * machine that has no database access, and for checking the served cohort
 * (GET /api/sales/pinhook/cohort) against the houses.
 *
 *   node scripts/pinhook-cohort.mjs --cache <dir> --out <file.ndjson.gz> [--from 2015 --to 2025] [--arqana 186-460]
 *
 * Reads, through this repository's own readers:
 *   Tattersalls: December Foals (DEF), October Books 1-4, December Yearlings,
 *     Craven and Guineas Breeze-Ups, for the years asked and the two after;
 *   Arqana (optional): every sale number in the range given (foals,
 *     yearlings and the breeze-up are kept, the rest left out).
 * Each sale is cached in --cache as it is read, so a rerun reads only what
 * is missing. The output is one JSON line per foal offered (sales/pinhook.mjs
 * pinhookCohort), the first line a header saying what was read and when.
 *
 * Goffs and the other houses the parse.bot feed reads are not here: the
 * served cohort holds them. A resale at a house not read here counts as
 * "never entered", so the resale rate read from this file is a floor.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fetchResults, reconcile, codeFor } from "../sales/tattersalls.mjs";
import { fetchExport } from "../sales/arqana.mjs";
import { oneLotOnce, sireMedians, marketMedians } from "../sales/metrics.mjs";
import { pinhookCohort } from "../sales/pinhook.mjs";

const arg = (k, d = null) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const cache = path.resolve(arg("cache", ".pinhook-cache"));
const out = arg("out");
const from = Number(arg("from", 2015));
const to = Number(arg("to", new Date().getUTCFullYear() - 1));
const arqana = arg("arqana");
if (!out) {
  console.error("--out <file.ndjson.gz> is required");
  process.exit(1);
}
fs.mkdirSync(cache, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cached(name, read) {
  const p = path.join(cache, `${name}.json`);
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  for (let a = 0; a < 3; a += 1) {
    try {
      const got = { name, fetchedAt: new Date().toISOString(), ...(await read()) };
      fs.writeFileSync(p, JSON.stringify(got));
      await sleep(700);
      return got;
    } catch (err) {
      console.warn(`${name}: ${err.message}`);
      await sleep(4000 * (a + 1));
    }
  }
  return null;
}

const codes = [];
for (let y = from; y <= to; y += 1) codes.push(codeFor("DEF", y));
for (let y = from + 1; y <= to + 1; y += 1) for (const p of ["OC1", "OC2", "OC3", "OC4", "DEY"]) codes.push(codeFor(p, y));
for (let y = from + 2; y <= to + 2; y += 1) for (const p of ["CBU", "GBU"]) codes.push(codeFor(p, y));

const lots = [];
const read = [];
for (const code of codes) {
  const got = await cached(code, async () => {
    const r = await fetchResults(code);
    return { lots: r.lots, reconcile: r.lots.length ? reconcile(r) : null };
  });
  if (!got) continue;
  lots.push(...got.lots);
  read.push({ sale: code, lots: got.lots.length, verdict: got.reconcile?.verdict ?? null, fetchedAt: got.fetchedAt });
}
if (arqana) {
  const [a, b] = arqana.split("-").map(Number);
  for (let v = a; v <= b; v += 1) {
    const got = await cached(`ARQ${v}`, async () => ({ lots: (await fetchExport(v))?.lots ?? [] }));
    const keep = (got?.lots ?? []).filter((l) => ["foal", "yearling", "2yo"].includes(l.sale_type));
    if (!keep.length) continue;
    lots.push(...keep);
    read.push({ sale: `ARQ${v}`, saleKey: keep[0].sale_key, year: keep[0].year, lots: keep.length, fetchedAt: got.fetchedAt });
  }
}

const once = oneLotOnce(lots);
const cohort = pinhookCohort(once.lots, { region: "EU", from, to, sireMedians: sireMedians(once.lots), marketMedians: marketMedians(once.lots) });
const header = {
  header: true,
  builtAt: new Date().toISOString(),
  from,
  to,
  lots: once.lots.length,
  listedTwice: once.dropped,
  rows: cohort.rows.length,
  skipped: cohort.skipped,
  sales: read,
  note: "Tattersalls and Arqana results only; a resale at another house reads as never entered.",
};
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, zlib.gzipSync([header, ...cohort.rows].map((r) => JSON.stringify(r)).join("\n")));
console.log(`${once.lots.length} lots read from ${read.length} sales; ${cohort.rows.length} foals offered ${from}-${to} written to ${out}`);
