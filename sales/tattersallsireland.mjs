/**
 * Tattersalls Ireland, Fairyhouse: every sale's results, from the house's own pages.
 *
 * The house runs on the same system as Tattersalls in Newmarket
 * (sales/tattersalls.mjs). Each sale is a code and a two-digit year (SYL25
 * is the September Yearling Sale of 2025, SY225 its Part II); its front
 * page, secure.tattersalls.ie/4DCGI/Sale/<code>/Main, gives its name and
 * dates, and its results are one table at .../Catalogue: lot, horse,
 * (type, at a sale that mixes them), vendor, buyer, price in euros. Before
 * a sale the table has no buyer column and the price column holds the
 * horse's box. A year's sales are listed at
 * .../SaleDates?site=FH&display=results&year=YYYY. Every page wants the
 * session cookie the first one sets, as at Newmarket. There is no results
 * export: the only downloads are the catalogue PDFs.
 *
 * How a lot ended, as the buyer column writes it: a buyer and a price is
 * sold; "Vendor" or "Lot Not Sold" with a figure is bought back at that
 * last bid; "Vendor (6,000) / Buyer (P.S.)" or "Buyer (P.S.)" is sold
 * privately after the ring at the price shown (the house counts these in
 * its "Whole Sale" lots sold); "Lot Withdrawn" is withdrawn.
 *
 * Only Fairyhouse is on the site: the house's Ascot sales are not listed
 * there for any year, so TIR-ASCOT is not fed from here. The store sales
 * (Derby, July, May, August National Hunt) sell unbroken jumpers that fit
 * none of the market's kinds, so their store lots are left out.
 */
import { nameKey } from "./normalise.mjs";
import { convert } from "./fx.mjs";
import { parseHorseCell, parseTotals } from "./tattersalls.mjs";

/**
 * The house's sales: code prefix -> what it sells, when, and where it sits.
 * TIR-SEPT and TIR-NH are the keys sales/normalise.mjs already gives the
 * workbook's rows; TIR-BRZ, TIR-HIT and TIR-FOAL are defined here. A store
 * sale's type is "store": its store lots are not read.
 */
export const TIR_SALES = {
  SYL: { key: "TIR-SEPT", name: "Tattersalls Ireland September Yearlings", type: "yearling", month: 9, tier: 3 },
  SY2: { key: "TIR-SEPT", name: "Tattersalls Ireland September Yearlings", type: "yearling", month: 9, tier: 3 },
  IBU: { key: "TIR-BRZ", name: "Tattersalls Ireland Breeze-Up", type: "2yo", month: 5, tier: 3 },
  P2P: { key: "TIR-HIT", name: "Tattersalls Ireland Point-to-Point & Horses in Training", type: "hit", month: 5, tier: 3 },
  BFS: { key: "TIR-FOAL", name: "Tattersalls Ireland Flat Foals & Breeding Stock", type: "mixed", month: 11, tier: 3 },
  FNH: { key: "TIR-NH", name: "Tattersalls Ireland National Hunt", type: "mixed", month: 2, tier: 3 },
  NNH: { key: "TIR-NH", name: "Tattersalls Ireland National Hunt", type: "mixed", month: 11, tier: 3 },
  ANH: { key: "TIR-NH", name: "Tattersalls Ireland National Hunt", type: "store", month: 8, tier: 3 },
  DBY: { key: "TIR-NH", name: "Tattersalls Ireland National Hunt", type: "store", month: 6, tier: 3 },
  DB2: { key: "TIR-NH", name: "Tattersalls Ireland National Hunt", type: "store", month: 6, tier: 3 },
  JUL: { key: "TIR-NH", name: "Tattersalls Ireland National Hunt", type: "store", month: 7, tier: 3 },
  JL2: { key: "TIR-NH", name: "Tattersalls Ireland National Hunt", type: "store", month: 7, tier: 3 },
  MAY: { key: "TIR-NH", name: "Tattersalls Ireland National Hunt", type: "store", month: 5, tier: 3 },
};

const OTHER = { key: "TIR-OTHER", name: "Tattersalls Ireland (other sales)", type: "mixed", month: null, tier: 3 };

/** A sale from its title alone, for a code the table above does not know. */
export function saleFromTitle(title) {
  const t = String(title ?? "");
  if (/ascot/i.test(t)) return { key: "TIR-ASCOT", name: "Tattersalls Ireland Ascot Yearlings", type: "mixed", month: null, tier: 3 };
  if (/september yearling/i.test(t)) return TIR_SALES.SYL;
  if (/breeze/i.test(t)) return TIR_SALES.IBU;
  if (/point-to-point|horses in training/i.test(t)) return TIR_SALES.P2P;
  if (/flat foal|november flat|sapphire/i.test(t)) return TIR_SALES.BFS;
  if (/store|derby sale/i.test(t)) return { ...TIR_SALES.DBY, month: null };
  if (/national hunt|\bnh\b/i.test(t)) return { ...TIR_SALES.NNH, month: null };
  return OTHER;
}

/** "SYL25" -> { prefix: "SYL", year: 2025 } */
export function parseCode(code) {
  const m = String(code ?? "").toUpperCase().match(/^([A-Z0-9]{2,4}?)(\d{2})$/);
  return m ? { prefix: m[1], year: 2000 + Number(m[2]) } : null;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** The month a sale opens, from the house's dates ("28 Oct – 1 Nov 2024" opens in October). */
export function monthOf(dates, year) {
  const m = String(dates ?? "").match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i);
  const y = Number((String(dates ?? "").match(/\b(20\d{2})\b/) ?? [])[1]) || year;
  return m && y ? `${y}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, "0")}` : null;
}

/** A sale code, and the name and dates the house gives it, as the sale. */
export function saleOf(code, { title = null, dates = null } = {}) {
  const parsed = parseCode(code);
  if (!parsed) return null;
  const known = TIR_SALES[parsed.prefix] ?? saleFromTitle(title);
  const fallback = known.month ? `${parsed.year}-${String(known.month).padStart(2, "0")}` : null;
  const month = monthOf(dates, parsed.year) ?? fallback;
  return { key: known.key, name: known.name, type: known.type, tier: known.tier, year: parsed.year, month };
}

const decode = (s) =>
  String(s ?? "")
    .replace(/&nbsp;|&ensp;|&emsp;/g, " ")
    .replace(/&ndash;|&mdash;/g, "-")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
const text = (s) => decode(String(s ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
/** A price: digits and commas only. Before a sale the price column holds the box ("D 164"). */
const money = (s) => {
  const t = text(s);
  if (!/^[\d,.\s]+$/.test(t)) return null;
  const n = Number(t.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The sales on one of the house's sale-date lists: code, title, dates. */
export function parseSaleDates(html) {
  const out = [];
  const seen = new Set();
  for (const card of String(html).split(/class="sale-card sale-card/).slice(1)) {
    const link = card.match(/<a href="\s*[^"]*\/Sale\/([A-Z0-9]+)\/Main"[^>]*>([\s\S]*?)<\/a>/);
    if (!link || seen.has(link[1])) continue;
    seen.add(link[1]);
    const dates = text((card.match(/sale-card__meta-item-text">([\s\S]*?)<\/div>/) ?? [])[1]) || null;
    out.push({ id: link[1], title: text(link[2]) || null, dates });
  }
  return out;
}

/** A sale's front page: its title ("Sapphire Sale 2025") and dates ("16 Dec 2025"). */
export function parseSaleHeader(html) {
  const title = text((String(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/) ?? [])[1]) || null;
  const dates = text((String(html).match(/<div class="caps caps--small">([\s\S]*?)<\/div>/) ?? [])[1]) || null;
  return { title, dates: dates && /\d/.test(dates) ? dates : null };
}

/**
 * What became of a lot, from the buyer cell and the price. A lot bought
 * back reads "Vendor" or "Lot Not Sold", with the last bid either in
 * brackets or as the price; one sold privately after it failed in the ring
 * adds "/ Buyer (P.S.)", and the price is then the private price.
 */
export function readBuyer(buyerCell, price) {
  const b = text(buyerCell);
  if (!b) return { status: price ? "sold_private" : "catalogued", buyer: null, bid: null, afterSale: false };
  if (/^(lot )?withdrawn$/i.test(b)) return { status: "withdrawn", buyer: null, bid: null, afterSale: false };
  const unsold = b.match(/^(?:vendor|lot not sold|not sold)\s*(?:\(([\d,]+)\))?\s*(?:\/\s*(.+?))?$/i);
  if (unsold) {
    const ps = unsold[2] ? unsold[2].match(/^(.+?)\s*\(P\.?S\.?\)$/i) : null;
    if (ps) return { status: price ? "sold" : "sold_private", buyer: ps[1].trim(), bid: null, afterSale: true };
    return { status: "rna", buyer: null, bid: money(unsold[1]) ?? price, afterSale: false };
  }
  const ps = b.match(/^(.+?)\s*\(P\.?S\.?\)$/i);
  if (ps) return { status: price ? "sold" : "sold_private", buyer: ps[1].trim(), bid: null, afterSale: true };
  return { status: price ? "sold" : "sold_private", buyer: b, bid: null, afterSale: false };
}

/**
 * What a lot is, from the house's type code where the sale mixes them
 * (FOA, YRL, 2YO, HIT, P2P, MAR, STO), else from the sale. Null for a lot
 * that is none of foal, yearling, two-year-old, horse in training or
 * breeding stock: a store, or a two-year-old at a store sale.
 */
export function kindOf(code, sale) {
  const c = String(code ?? "").toUpperCase().trim();
  if (/^FOA/.test(c)) return "foal";
  if (/^YRL/.test(c)) return "yearling";
  if (/^2YO/.test(c)) return sale?.type === "store" ? null : "2yo";
  if (/^(HIT|P2P|HOT)/.test(c)) return "hit";
  if (/^(MAR|BMP|BM$|BRD)/.test(c)) return "breeding";
  if (/^ST/.test(c)) return null;
  if (c) return null;
  return sale && !["mixed", "store"].includes(sale.type) ? sale.type : null;
}

const SEX = { colt: "colt", filly: "filly", gelding: "gelding", mare: "filly" };

/** One sale's results page as lots in the shared shape (sales/normalise.mjs). */
export function parseResults(html, code, sale) {
  const s = sale ?? saleOf(code);
  if (!s) throw new Error(`not a Tattersalls Ireland sale code: ${code}`);
  const page = String(html);
  const table = page.match(/<table[^>]*id="listTable"[^>]*>([\s\S]*?)<\/table>/i)?.[1] ?? page;
  const head = [...(table.match(/<tr[^>]*>[\s\S]*?<\/tr>/i)?.[0] ?? "").matchAll(/<th[^>]*class=["']?([\w-]+)/gi)].map((m) => m[1]);
  const at = (name) => head.indexOf(name);
  const col = { type: at("col2type"), vendor: at("col2consignor"), buyer: at("col2purchaser"), price: at("col2price") };
  const presale = col.buyer < 0;
  const lots = [];
  for (const row of table.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    if (!/class=["']ll/.test(row)) continue;
    const cells = row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? [];
    const lot = text((row.match(/class=["']ll[^"']*["'][^>]*>([^<]*)</) ?? [])[1]);
    const horseCell = cells.find((c) => /class=["']tdh/.test(c)) ?? cells[1] ?? "";
    const horse = parseHorseCell(horseCell);
    const typeCode = col.type >= 0 ? text(cells[col.type]) : horse.type;
    const type = kindOf(typeCode, s);
    if (!type) continue;
    const price = presale ? null : money(cells[col.price]);
    const read = presale
      ? { status: /lot withdrawn/i.test(text(horseCell)) ? "withdrawn" : "catalogued", buyer: null, bid: null, afterSale: false }
      : readBuyer(cells[col.buyer], price);
    const foaled = horse.foaled ?? (type === "foal" ? s.year : type === "yearling" ? s.year - 1 : type === "2yo" ? s.year - 2 : null);
    const sold = read.status === "sold";
    const gbp = sold && s.month ? convert(price, "EUR", "GBP", s.month) : null;
    lots.push({
      source: "tattersallsireland",
      company: "Tattersalls Ireland",
      sale_key: s.key,
      sale_name: s.name,
      sale_tier: s.tier,
      sale_label: String(code).toUpperCase(),
      region: "EU",
      year: s.year,
      sale_month: s.month,
      sale_type: type,
      lot,
      horse: horse.horse,
      sire: horse.sire,
      sire_key: nameKey(horse.sire),
      dam: horse.dam,
      dam_key: nameKey(horse.dam),
      sex: SEX[horse.sex] ?? null,
      foaling_year: foaled,
      vendor: col.vendor >= 0 ? text(cells[col.vendor]) || null : null,
      buyer: sold || read.status === "sold_private" ? read.buyer : null,
      status: read.status,
      price: sold ? price : null,
      bid: read.status === "rna" ? read.bid : null,
      currency: "EUR",
      price_gbp: gbp === null ? null : Math.round(gbp),
      after_sale: read.afterSale || undefined,
    });
  }
  return lots;
}

/* ------------------------------------------------------------ fetching */

const BASE = "https://secure.tattersalls.ie/4DCGI/Sale";
const UA = "Mozilla/5.0 (compatible; BlandfordBloodstock/1.0; sales results; +https://www.blandfordbloodstock.tech)";
const pause = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** Pages fetched one at a time with the session cookie the house sets. */
function session(fetchImpl, pauseMs) {
  const jar = new Map();
  let first = true;
  const once = async (url) => {
    if (!first) await pause(pauseMs);
    first = false;
    const res = await fetchImpl(url, {
      headers: { "user-agent": UA, accept: "text/html", ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) },
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
    });
    for (const c of res.headers?.getSetCookie?.() ?? []) {
      const kv = c.split(";")[0];
      const i = kv.indexOf("=");
      if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
    if (!res.ok) throw new Error(`Tattersalls Ireland ${url}: HTTP ${res.status}`);
    return res.text();
  };
  return async (url) => {
    const html = await once(url);
    // The house answers "No Cookie" until its session cookie comes back: ask once more with it.
    return /<title>\s*No Cookie|>\s*No Cookie\s*</i.test(html) ? once(url) : html;
  };
}

/** The year's sales at Fairyhouse: those with results, and those catalogued but not yet sold. */
export async function discover({ year, fetchImpl = fetch, pauseMs = 1000 } = {}) {
  const get = session(fetchImpl, pauseMs);
  const found = new Map();
  const lists = [`${BASE}/SaleDates?site=FH&display=results&year=${year}`];
  if (year >= new Date().getUTCFullYear()) lists.push(`${BASE}/SaleDates?site=FH&display=catalogues`);
  for (const url of lists) {
    for (const s of parseSaleDates(await get(url))) {
      const sale = saleOf(s.id, s);
      if (!sale || sale.year !== Number(year) || found.has(s.id)) continue;
      found.set(s.id, { id: s.id, title: s.title, ...sale });
    }
  }
  return [...found.values()];
}

/** One sale's lots: its front page for the session, name and dates, then its results table. */
export async function fetchSale(id, { fetchImpl = fetch, pauseMs = 1000 } = {}) {
  const code = String(id).toUpperCase();
  if (!parseCode(code)) throw new Error(`not a Tattersalls Ireland sale code: ${id}`);
  const get = session(fetchImpl, pauseMs);
  const header = parseSaleHeader(await get(`${BASE}/${code}/Main`));
  const html = await get(`${BASE}/${code}/Catalogue`);
  const sale = saleOf(code, header);
  return { id: code, title: header.title, sale, lots: parseResults(html, code, sale), totals: parseTotals(html) };
}

export default { TIR_SALES, saleFromTitle, parseCode, monthOf, saleOf, parseSaleDates, parseSaleHeader, readBuyer, kindOf, parseResults, discover, fetchSale };
