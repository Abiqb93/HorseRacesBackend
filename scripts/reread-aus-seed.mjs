/**
 * Puts the Australian and New Zealand seed parts' prices back to the hammer.
 *
 * The parts were written with the workbook's Karaka prices as filed, at 0.90
 * of the hammer for the 2018-2023 sales and 0.87 for 2024 and 2025 (see
 * AU_READINGS in sales/normalise.mjs). Each sale-year takes the reading that
 * gives round prices; Australian sale-years read as they are and are left
 * alone. Karaka's 2015-2017 Select and Festival sales, filed with no house,
 * move to Books 2 and 3 in New Zealand dollars. The parts are read from one folder and written to another, and the
 * manifest entries for the new parts are printed (or written with --manifest).
 *
 *   node scripts/reread-aus-seed.mjs <parts dir> <out dir> [--manifest sales/seed-manifest.json]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { bestAuReading, rereadAuLot, saleKeyOfAuLot } from "../sales/normalise.mjs";

export function readingsFor(lots) {
  const groups = new Map();
  for (const l of lots) {
    if (l.status !== "sold" || !(l.price > 0)) continue;
    const k = `${saleKeyOfAuLot(l)}|${l.year}`;
    const list = groups.get(k) ?? [];
    list.push(l.price);
    groups.set(k, list);
  }
  const out = new Map();
  for (const [k, prices] of groups) out.set(k, bestAuReading(prices));
  return out;
}

export function reread(lots, readings) {
  return lots.map((l) => rereadAuLot(l, readings.get(`${saleKeyOfAuLot(l)}|${l.year}`)?.name ?? "price"));
}

function main(argv) {
  const [inDir, outDir] = argv;
  const mIx = argv.indexOf("--manifest");
  const manifestPath = mIx > -1 ? argv[mIx + 1] : null;
  if (!inDir || !outDir) throw new Error("usage: reread-aus-seed.mjs <parts dir> <out dir> [--manifest path]");
  const files = fs.readdirSync(inDir).filter((f) => /^aus-nz-master-.*\.ndjson\.gz$/.test(f)).sort();
  const parts = files.map((f) => ({ f, lots: zlib.gunzipSync(fs.readFileSync(path.join(inDir, f))).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) }));
  const readings = readingsFor(parts.flatMap((p) => p.lots));
  for (const [k, r] of [...readings].sort()) if (r.name !== "price") console.log(`${k}\t${r.name}\tround ${r.hits}/${r.n}`);
  fs.mkdirSync(outDir, { recursive: true });
  const entries = [];
  for (const { f, lots } of parts) {
    const out = reread(lots, readings);
    const buf = zlib.gzipSync(Buffer.from(out.map((l) => JSON.stringify(l)).join("\n")), { level: 9 });
    fs.writeFileSync(path.join(outDir, f), buf);
    const changed = out.filter((l, i) => l.price !== lots[i].price || l.sale_key !== lots[i].sale_key).length;
    entries.push({ name: f.replace(".ndjson.gz", ""), rows: out.length, bytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex"), changed });
  }
  for (const e of entries) console.log(`${e.name}\trows ${e.rows}\tprices changed ${e.changed}\t${e.sha256}`);
  if (manifestPath) {
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    for (const e of entries) {
      const p = m.parts.find((x) => x.name === e.name);
      if (!p) throw new Error(`${e.name} is not in the manifest`);
      Object.assign(p, { rows: e.rows, bytes: e.bytes, sha256: e.sha256 });
    }
    fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + "\n");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) main(process.argv.slice(2));
