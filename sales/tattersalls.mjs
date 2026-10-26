/**
 * Tattersalls, Newmarket: every sale's results, from the house's own pages.
 *
 * Each sale is a code and a two-digit year (OC125 is the October Yearling
 * Sale Book 1 of 2025) and its results are one table at
 * secure.tattersalls.com/4DCGI/Sale/<code>/Catalogue: lot, horse, (type),
 * vendor, buyer, price in guineas. The table needs a session: the sale's
 * front page is fetched first for its cookie, as the HIT pipeline on the
 * site does (scripts/hitsales/fetch-catalogue.mjs there).
 *
 * The page also prints the sale's own totals ("Whole Sale": lots sold,
 * aggregate, average, median, top). They are kept beside the lots so every
 * import is checked against the house's figures.
 */
import { nameKey, horseName } from "./normalise.mjs";
import { convert } from "./fx.mjs";

/** The house's sales: code prefix -> what it sells, when, and where it sits. */
export const TATTERSALLS = {
  OC1: { key: "TAT-OC1", name: "Tattersalls October Book 1", type: "yearling", month: 10, tier: 1 },
  OC2: { key: "TAT-OC2", name: "Tattersalls October Book 2", type: "yearling", month: 10, tier: 2 },
  OC3: { key: "TAT-OC3", name: "Tattersalls October Book 3", type: "yearling", month: 10, tier: 3 },
  OC4: { key: "TAT-OC4", name: "Tattersalls October Book 4", type: "yearling", month: 10, tier: 3 },
  SOM: { key: "TAT-SOM", name: "Tattersalls Somerville", type: "yearling", month: 10, tier: 2 },
  DEY: { key: "TAT-DEY", name: "Tattersalls December Yearlings", type: "yearling", month: 12, tier: 3 },
  DEF: { key: "TAT-DEF", name: "Tattersalls December Foals", type: "foal", month: 12, tier: 1 },
  DEM: { key: "TAT-DEM", name: "Tattersalls December Mares", type: "breeding", month: 12, tier: 1 },
  CBU: { key: "TAT-CBU", name: "Tattersalls Craven Breeze-Up", type: "2yo", month: 4, tier: 1 },
  GBU: { key: "TAT-GBU", name: "Tattersalls Guineas Breeze-Up", type: "2yo", month: 4, tier: 2 },
  FEB: { key: "TAT-FEB", name: "Tattersalls February", type: "mixed", month: 2, tier: 3 },
  JUL: { key: "TAT-JUL", name: "Tattersalls July", type: "mixed", month: 7, tier: 2 },
  SEP: { key: "TAT-SEP", name: "Tattersalls September", type: "mixed", month: 9, tier: 3 },
  AUT: { key: "TAT-AUT", name: "Tattersalls Autumn Horses in Training", type: "hit", month: 10, tier: 1 },
};

/** "OC125" -> { prefix: "OC1", year: 2025 } */
export function parseCode(code) {
  const m = String(code ?? "").toUpperCase().match(/^([A-Z]+\d?)(\d{2})$/);
  if (!m || !TATTERSALLS[m[1]]) return null;
  return { prefix: m[1], year: 2000 + Number(m[2]) };
}

export const codeFor = (prefix, year) => `${prefix}${String(year).slice(-2)}`;

const decode = (s) =>
  String(s ?? "")
    .replace(/&nbsp;|&ensp;|&emsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
const text = (s) => decode(String(s ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
/** A price: digits and commas only. Before a sale the price column holds the horse's box ("SP FF 797"). */
const money = (s) => {
  const t = String(s ?? "").replace(/&nbsp;/g, " ").trim();
  if (!/^[\d,.\s]+$/.test(t)) return null;
  const n = Number(t.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const SEX = { C: "colt", F: "filly", G: "gelding", M: "mare", R: "colt", H: "colt" };

/**
 * The horse cell. Unnamed: "Sire (IRE) / Dam (FR) Ch.F. (IRE)". Named:
 * "Name (GB) [HIT] [2023] B.G. BY Sire (IRE) EX Dam (IRE)".
 */
export function parseHorseCell(html) {
  const names = [...String(html).matchAll(/<a[^>]*class=["'](?:hn|hg)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((m) => text(m[1]));
  const body = text(html);
  const sexCode = (body.match(/\b(?:[A-Z][a-z]{0,2}\.)?\s?([CFGMRH])\.(?:\s|$|\()/) ?? [])[1] ?? null;
  const type = (String(html).match(/class=["']ht["'][^>]*>([^<]*)</i) ?? [])[1]?.trim() || null;
  const year = Number((body.match(/\b(19|20)\d{2}\b/) ?? [])[0]) || null;
  // A mare sold in foal: "EX Atlantic Light (GB) COVERED BY Caturra".
  const plain = body.replace(/\s+(?:COVERED BY|IN FOAL TO|CARRYING TO)\s+.*$/i, "");
  const by = (plain.match(/\bBY\s+(.+?)(?=\s+EX\s|$)/) ?? [])[1] ?? null;
  const ex = (plain.match(/\bEX\s+(.+?)$/) ?? [])[1] ?? null;
  const strip = (s) => (s ? s.replace(/\s*\([A-Z]{2,3}\)\s*$/, "").trim() : null);
  if (by || ex) {
    return { horse: strip(names[0] ?? null), sire: strip(by), dam: strip(ex), sex: SEX[sexCode] ?? null, foaled: year, type };
  }
  // Unnamed: the first two names are the sire and the dam.
  return { horse: null, sire: strip(names[0] ?? null), dam: strip(names[1] ?? null), sex: SEX[sexCode] ?? null, foaled: year, type };
}

/**
 * What became of a lot, from the buyer cell and the price. Tattersalls
 * writes a lot bought back as "Vendor" with the last bid as its price, or
 * "Vendor (18,000)"; one sold privately after it failed to sell in the ring
 * as "Vendor (18,000) / Buyer (P.S.)" with the private price; and one not
 * offered as "Lot Withdrawn" — which the house also prints for a lot led
 * out unsold, so the two cannot be told apart and both are out of the ring.
 */
export function readBuyer(buyerCell, price) {
  const b = text(buyerCell);
  // Withdrawn from the ring and sold privately: "Lot Withdrawn / Rabbah Bloodstock (P.S.)".
  const wdPs = b.match(/^lot withdrawn\s*\/\s*(.+?)\s*\(P\.?S\.?\)\s*$/i);
  if (wdPs) return { status: price ? "sold" : "sold_private", buyer: wdPs[1].trim(), bid: null, afterSale: true };
  if (/lot withdrawn|^wd$/i.test(b)) return { status: "withdrawn", buyer: null, bid: null, afterSale: false };
  // Not sold in the ring, then sold privately: "Vendor (30,000) / Dan Astbury (P.S.)",
  // or "Lot Not Sold (38,000) / George Boughey Racing / Morshead (P.S.)".
  const ps = b.match(/^(?:vendor|lot not sold|not sold)\s*(?:\(([\d,]+)\))?\s*\/\s*(.+?)\s*\(P\.?S\.?\)\s*$/i);
  if (ps) return { status: price ? "sold" : "rna", buyer: ps[2].trim(), bid: money(ps[1]), afterSale: true };
  const vendor = b.match(/^(?:vendor|lot not sold|not sold)\s*(?:\(([\d,]+)\))?/i);
  if (vendor) return { status: "rna", buyer: null, bid: money(vendor[1]) ?? price, afterSale: false };
  // A buyer marked (P.S.) alone bought privately, outside the ring.
  const privately = /\(P\.?S\.?\)\s*$/i.test(b);
  if (b && price) return { status: "sold", buyer: privately ? b.replace(/\s*\(P\.?S\.?\)\s*$/i, "") : b, bid: null, afterSale: privately };
  if (b && !price) return { status: "unknown", buyer: b, bid: null, afterSale: false };
  return { status: price ? "sold" : "unknown", buyer: null, bid: null, afterSale: false };
}

/** The house's totals for the sale: lots sold, aggregate, average, median, top (guineas). */
export function parseTotals(html) {
  const m = String(html).match(
    /Whole Sale<\/td>\s*<td class="col1lots">([\d,]+)<\/td>\s*<td class="col1value">([\d,]+)<\/td>\s*<td class="col1value">([\d,]+)<\/td>\s*<td class="col1value">([\d,]+)<\/td>\s*<td class="col1value">([\d,]+)/,
  );
  if (!m) return null;
  const [sold, aggregate, average, median, top] = m.slice(1).map(money);
  const ps = String(html).match(/Subsequent Private Sales<\/td>\s*<td class="col1lots otherPS">([\d,]+)<\/td>\s*<td class="col1value otherPS">([\d,]+)/);
  return { sold, aggregate, average, median, top, privateSales: ps ? { lots: money(ps[1]), aggregate: money(ps[2]) } : null };
}

/** The age a lot is sold at, and so what kind of lot it is, at a sale that mixes them. */
function lotType(sale, horse, year) {
  if (sale.type !== "mixed" && !(sale.type === "2yo" && horse.type)) return sale.type;
  const t = String(horse.type ?? "").toUpperCase();
  if (t === "HIT" || t === "HOT") return "hit";
  if (/^M|MAR|BMP/.test(t)) return "breeding";
  const age = horse.foaled ? year - horse.foaled : null;
  if (age === 0) return "foal";
  if (age === 1) return "yearling";
  if (age === 2 && !horse.horse) return "2yo";
  if (age !== null && age >= 2) return horse.sex === "mare" ? "breeding" : "hit";
  return sale.type === "2yo" ? "2yo" : "unknown";
}

/** One sale's results page as lots in the shared shape (sales/normalise.mjs). */
export function parseResults(html, code) {
  const parsed = parseCode(code);
  if (!parsed) throw new Error(`not a Tattersalls sale code: ${code}`);
  const sale = TATTERSALLS[parsed.prefix];
  const year = parsed.year;
  const month = `${year}-${String(sale.month).padStart(2, "0")}`;
  const lots = [];
  for (const row of String(html).match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    if (!/class=["']ll/.test(row)) continue;
    const cells = row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? [];
    const lot = text((row.match(/class=["']ll[^"']*["'][^>]*>([^<]*)</) ?? [])[1]);
    const horseCell = cells.find((c) => /class=["']tdh/.test(c)) ?? cells[1] ?? "";
    const horse = parseHorseCell(horseCell);
    const priceCell = cells.find((c) => /class=["']price/.test(c)) ?? null;
    const after = cells.slice(cells.indexOf(horseCell) + 1).filter((c) => !/col2type|class=["']price/.test(c));
    // Before a lot is sold its row has no buyer cell, and the price column
    // holds the box it is stabled in ("SP FF 797"): catalogued.
    const presale = after.length < 2;
    const price = presale ? null : money(text(priceCell));
    const vendor = text(after[0] ?? "") || null;
    const read = presale
      ? { status: /lot withdrawn/i.test(text(horseCell)) ? "withdrawn" : "catalogued", buyer: null, bid: null, afterSale: false }
      : readBuyer(after[1] ?? "", price);
    const type = lotType(sale, horse, year);
    const foaled = horse.foaled ?? (type === "foal" ? year : type === "yearling" ? year - 1 : type === "2yo" ? year - 2 : null);
    const sold = read.status === "sold";
    const gbp = sold ? convert(price, "GNS", "GBP", month) : null;
    lots.push({
      source: "tattersalls",
      company: "Tattersalls",
      sale_key: sale.key,
      sale_name: sale.name,
      sale_tier: sale.tier,
      sale_label: code,
      region: "EU",
      year,
      sale_month: month,
      sale_type: type,
      lot,
      horse: horse.horse,
      sire: horse.sire,
      sire_key: nameKey(horse.sire),
      dam: horse.dam,
      dam_key: nameKey(horse.dam),
      sex: horse.sex === "mare" ? "filly" : horse.sex,
      foaling_year: foaled,
      vendor,
      buyer: read.buyer,
      status: read.status,
      price: sold ? price : null,
      bid: read.status === "rna" ? read.bid : null,
      currency: "GNS",
      price_gbp: gbp === null ? null : Math.round(gbp),
      after_sale: read.afterSale || undefined,
    });
  }
  return { code, sale, year, lots, totals: parseTotals(html) };
}

const UA = "BlandfordBloodstock/1.0 (sales results; +https://www.blandfordbloodstock.tech)";

/** A sale's results page, with the session the house wants. */
export async function fetchResults(code, { fetchImpl = fetch } = {}) {
  const jar = new Map();
  const get = async (url) => {
    const res = await fetchImpl(url, {
      headers: { "user-agent": UA, accept: "text/html", ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) },
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const kv = c.split(";")[0];
      const i = kv.indexOf("=");
      if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
    return res;
  };
  await get(`https://secure.tattersalls.com/4DCGI/Sale/${code}/Main`);
  const res = await get(`https://secure.tattersalls.com/4DCGI/Sale/${code}/Catalogue`);
  if (!res.ok) throw new Error(`Tattersalls ${code}: HTTP ${res.status}`);
  const html = await res.text();
  if (/<title>\s*No Cookie/i.test(html)) throw new Error(`Tattersalls ${code}: no session`);
  return parseResults(html, code);
}

/**
 * How far the parsed lots agree with the house's totals. Up to 2024 the
 * page's ring sales (a buyer and a price) are exactly the house's "lots
 * sold"; from 2025 the house counts some deals the table does not show, so
 * the check falls back to everything sold (ring and private together)
 * against the house's lots sold plus its subsequent private sales. A sale
 * is "exact" when it matches the house's ring figures, "close" when
 * everything sold is within 3% of the house's count, and "off" beyond.
 */
export function reconcile({ lots, totals }) {
  if (!totals) return null;
  // The house's count is its "Whole Sale" line and its subsequent private
  // sales together: the private sales are on the results page too, each
  // lot marked (P.S.) beside its buyer.
  const sold = lots.filter((l) => l.status === "sold" && l.price);
  const ring = sold.filter((l) => !l.after_sale);
  const sum = (xs) => xs.reduce((a, l) => a + l.price, 0);
  const houseCount = totals.sold + (totals.privateSales?.lots ?? 0);
  const houseAggregate = totals.aggregate + (totals.privateSales?.aggregate ?? 0);
  const exact = sold.length === houseCount && Math.abs(sum(sold) - houseAggregate) <= 1;
  const gap = houseCount ? (houseCount - sold.length) / houseCount : 0;
  return {
    sold: { ours: sold.length, house: houseCount, ring: ring.length, houseRing: totals.sold },
    aggregate: { ours: sum(sold), house: houseAggregate },
    top: { ours: Math.max(0, ...sold.map((l) => l.price)), house: totals.top },
    gap: Number(gap.toFixed(3)),
    verdict: exact ? "exact" : Math.abs(gap) <= 0.03 ? "close" : "off",
  };
}

export default { TATTERSALLS, parseCode, codeFor, parseHorseCell, readBuyer, parseTotals, parseResults, fetchResults, reconcile };
