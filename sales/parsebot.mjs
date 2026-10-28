/**
 * The sale companies no house feed reads, from Racing Post's sales results through parse.bot.
 *
 * Every house the market is read from has a feed of its own (sales/service.mjs
 * FEEDS, Tattersalls, Arqana), except where its site will not answer this
 * server: goffs.com turns it away, so on 27 October 2026 the index held no
 * Goffs results at all and every Goffs lot since 2025 read as catalogued. The
 * user (27 October 2026: "Just to fill gaps on any sales we can't bring in
 * automatically", "We want to go older, back to 2015", "we dont need a
 * token, just run automatically") pointed to a parse.bot scraper over Racing
 * Post's sales pages, which gives every lot of a sale: lot, horse, sex, year
 * of birth, sire, dam, vendor, buyer and price.
 *
 * This reads it as a feed like any other (discover a year's sales, fetch one),
 * for the companies no other feed reads: Goffs, Goffs UK and GoffsGo, Osarus,
 * Goresbridge, Tattersalls Cheltenham, Thoroughbid and the rest. A company a
 * house feed reads is left to that feed, so no lot is held twice.
 *
 * A sale's id is Racing Post's "<venue>/<first day>" ("3/2025-09-29"), and so
 * is its label. Goffs sales take the keys sales/goffs.mjs gives them (the
 * workbook's own: GOF-ORBY, GUK-PREM and so on), so their results replace the
 * workbook's rows; any other company's take a key of its own, by company and
 * kind of sale ("OSA-YRL").
 *
 * The buyer column says what became of a lot:
 *   "Meadowview Stables", 40000                sold
 *   "Vendor (60000)", "Not Sold (45000)"       bought back at the last bid
 *   "Vendor (48000) / Form Bloodstock (PS)"    sold after the ring, at its price
 *   "Withdrawn"                                withdrawn
 *   nothing, the sale still to come            catalogued
 *
 * PARSE_API_KEY is the key the pedigree lookups already use (pedigree/client.mjs).
 */
import { nameKey, sexOf } from "./normalise.mjs";
import { convert } from "./fx.mjs";
import { regionOf as goffsRegion, saleFromTitle as goffsSale, kindOf } from "./goffs.mjs";

const SCRAPER = process.env.PARSE_SALES_SCRAPER_ID || "c8c40e63-fbf4-42f4-b1bc-88695b5118d6";
const BASE = `https://api.parse.bot/scraper/${SCRAPER}`;

/** The companies a house feed already reads, as Racing Post names them; left to those feeds. */
export const READ_ELSEWHERE = new Set([
  "TATTERSALLS", "TATTERSALLS IRELAND", "ARQANA", "KEENELAND", "FASIG-TIPTON",
  "FASIG-TIPTON (MIDLANTIC)", "OCALA", "BADEN-BADEN", "MAGIC MILLIONS", "INGLIS",
]);

const GOFFS = new Set(["GOFFS", "GOFFS UK", "GOFFSGO"]);

/** The other companies: a short code for their keys, the name shown, and their market. */
const COMPANIES = {
  OSARUS: { code: "OSA", name: "Osarus", region: "EU" },
  // National Hunt houses: a sale of theirs is a jumps sale unless its name says otherwise.
  GORESBRIDGE: { code: "GBG", name: "Goresbridge", region: "EU", jumps: true },
  "TATTERSALLS CHELTENHAM": { code: "TCH", name: "Tattersalls Cheltenham", region: "EU", jumps: true },
  THOROUGHBID: { code: "TBID", name: "Thoroughbid", region: "EU", jumps: true },
  SGA: { code: "SGA", name: "SGA", region: "EU" },
  AKTEM: { code: "AKT", name: "Aktem", region: "EU" },
  "AUCTAV.COM": { code: "AUC", name: "Auctav", region: "EU" },
  "EMIRATES RACING AUTHORITY": { code: "ERA", name: "Emirates Racing Authority", region: "UAE" },
  "CANADIAN THOROUGHBRED HORSE SOCIETY": { code: "CTHS", name: "CTHS", region: "US" },
  "CALIFORNIA THOROUGHBRED BREEDERS ASSOCIATION": { code: "CTBA", name: "CTBA", region: "US" },
  "TEXAS THOROUGHBRED ASSOCIATION": { code: "TTA", name: "Texas Thoroughbred Association", region: "US" },
  "WASHINGTON TBA": { code: "WTBA", name: "Washington TBA", region: "US" },
  "LOUISIANA TBA": { code: "LTBA", name: "Louisiana TBA", region: "US" },
};

const words = (s) => String(s ?? "").trim().replace(/\s+/g, " ");
const upper = (s) => words(s).toUpperCase();

/** A company not named above: its initials for a key, its own name, its market from its currency. */
function companyOf(name, currency) {
  const known = COMPANIES[upper(name)];
  if (known) return known;
  const initials = upper(name).replace(/[^A-Z ]/g, "").split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 6) || "OTH";
  const region = { USD: "US", CAD: "US", AUD: "AUS", NZD: "NZ" }[currency] ?? "EU";
  return { code: initials, name: words(name), region };
}

/** Whether a sale is this feed's: a company no house feed reads. */
export const isGap = (company) => Boolean(upper(company)) && !READ_ELSEWHERE.has(upper(company));

/** What a sale sells, from its name, for the companies without a list of their own sales. */
const KINDS = [
  [/foal/i, "foal", "FOAL", "Foals"],
  [/yearling/i, "yearling", "YRL", "Yearlings"],
  [/breeze|2yo|two.year/i, "2yo", "BRZ", "Breeze-Up"],
  [/national hunt|\bn\.?h\.?\b|store|point|p2p|chase|jump|bumper/i, "jumps", "NH", "National Hunt"],
  [/horses in training|\bhit\b|in training/i, "hit", "HIT", "Horses in Training"],
  [/breeding stock|mares?\b|broodmare/i, "mixed", "BS", "Breeding Stock"],
];

/** A sale's identity: Goffs's own keys for Goffs, a company-and-kind key for any other. */
export function saleOf({ sale_company: company, sale_name: title, sale_date: date }, currency = null) {
  const year = Number(String(date ?? "").slice(0, 4)) || null;
  const month = /^\d{4}-\d{2}/.test(String(date ?? "")) ? String(date).slice(0, 7) : null;
  if (GOFFS.has(upper(company))) {
    const region = upper(company) === "GOFFS UK" ? "UK" : upper(company) === "GOFFSGO" ? "GoffsGo" : goffsRegion(null, null, title);
    const s = goffsSale(title, region);
    return { key: s.key, name: s.name, type: s.type, tier: s.tier, company: s.company, region: "EU", year, month };
  }
  const c = companyOf(company, currency);
  const flat = /flat|yearling|foal|breeze|2yo/i.test(title ?? "");
  const [, type, code, kindName] = (c.jumps && !flat ? KINDS.find(([, t]) => t === "jumps") : null)
    ?? KINDS.find(([re]) => re.test(title ?? "")) ?? [null, "mixed", "MIX", null];
  const name = words(String(title ?? "").replace(/\b(19|20)\d{2}\b/g, "")) || (kindName ? `${c.name} ${kindName}` : c.name);
  return { key: `${c.code}-${code}`.slice(0, 24), name: name.slice(0, 96), type, tier: 3, company: c.name.slice(0, 48), region: c.region, year, month };
}

const BOUGHT_BACK = /^\s*(?:vendor|not sold)\b\s*(?:\(\s*([\d,]+)\s*\))?\s*(?:\/\s*(.+?))?\s*$/i;

/**
 * What became of a lot, from Racing Post's buyer column and price. `held`
 * is whether the sale has been held: a lot with no outcome at a sale to come
 * is catalogued, at one held it is unknown.
 */
export function outcomeOf(buyer, price, held = true) {
  const b = words(buyer);
  const p = Number(price) > 0 ? Number(price) : null;
  if (/^withdrawn\b/i.test(b)) return { status: "withdrawn", price: null, bid: null, buyer: null, afterSale: false };
  const m = b.match(BOUGHT_BACK);
  if (m) {
    const bid = m[1] ? Number(m[1].replace(/,/g, "")) : null;
    // parse.bot cuts the column at 50 characters, sometimes inside "(PS)".
    const after = words((m[2] ?? "").replace(/\s*\(PS\)?\s*$/i, ""));
    if (p && after) return { status: "sold", price: p, bid: null, buyer: after, afterSale: true };
    return { status: "rna", price: null, bid, buyer: null, afterSale: false };
  }
  if (p && b) return { status: "sold", price: p, bid: null, buyer: b, afterSale: false };
  if (!b && !p) return { status: held ? "unknown" : "catalogued", price: null, bid: null, buyer: null, afterSale: false };
  return { status: "unknown", price: null, bid: null, buyer: null, afterSale: false };
}

/**
 * One sale's results (parse.bot's get_sales_results) in the shared shape.
 * `today` (YYYY-MM-DD) says whether the sale has been held.
 */
export function parseSale(data, { today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!data?.venue_id || !data?.sale_date || !isGap(data.sale_company)) return { title: data?.sale_name ?? null, sale: null, lots: [] };
  const id = `${data.venue_id}/${data.sale_date}`;
  const held = String(data.sale_end_date ?? data.sale_date) < today;
  const sale = saleOf(data, (data.lots ?? []).find((l) => l?.currency)?.currency ?? null);
  const lots = [];
  for (const l of data.lots ?? []) {
    const dam = words(l?.dam_name);
    if (!dam || !sale.year) continue;
    const born = Number(l.year_of_birth) || null;
    const age = born ? sale.year - born : Number.isFinite(Number(l.age)) ? Number(l.age) : null;
    const mare = upper(l.sex) === "M";
    const type = kindOf(sale, age, mare);
    if (!type) continue;
    const out = outcomeOf(l.buyer, l.price, held);
    const currency = upper(l.currency) || null;
    const gbp = out.price && currency ? convert(out.price, currency, "GBP", sale.month ?? String(sale.year)) : null;
    lots.push({
      source: "parsebot",
      company: sale.company,
      sale_key: sale.key,
      sale_name: sale.name,
      sale_tier: sale.tier,
      sale_label: id,
      region: sale.region,
      year: sale.year,
      sale_month: sale.month,
      sale_type: type,
      lot: l.lot_no === null || l.lot_no === undefined ? null : `${l.lot_no}${words(l.lot_letter)}`,
      horse: words(l.horse_name) || null,
      sire: words(l.sire_name) || null,
      sire_key: nameKey(l.sire_name) || null,
      dam,
      dam_key: nameKey(dam),
      sex: mare ? "filly" : sexOf(upper(l.sex) === "R" ? "rig" : l.sex),
      foaling_year: born,
      vendor: words(String(l.vendor ?? "").replace(/^\s*from\s+/i, "")) || null,
      buyer: out.buyer,
      status: out.status,
      after_sale: out.afterSale ? 1 : 0,
      price: out.price,
      bid: out.bid,
      currency,
      price_gbp: gbp === null ? null : Math.round(gbp),
    });
  }
  return { title: data.sale_name ?? null, sale: { ...sale, id }, lots };
}

/* ------------------------------------------------------------ fetching */

const pause = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** One parse.bot call, with the retries its 502s need. The key travels in a header, never the URL. */
async function call(endpoint, params, { fetchImpl = fetch, tries = 3 } = {}) {
  const key = process.env.PARSE_API_KEY;
  if (!key) throw new Error("PARSE_API_KEY is not configured on this server");
  const url = new URL(`${BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  let last = null;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const res = await fetchImpl(url, { headers: { "X-API-Key": key }, signal: AbortSignal.timeout(300_000) });
      const text = await res.text();
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`parse.bot ${endpoint}: HTTP ${res.status} (is PARSE_API_KEY a key for this scraper's account?)`), { final: true });
      if (!res.ok || text.startsWith("error code:")) throw new Error(`parse.bot ${endpoint}: HTTP ${res.status}`);
      const body = JSON.parse(text);
      if (body?.status !== "success") throw Object.assign(new Error(`parse.bot ${endpoint}: ${body?.error?.message ?? body?.message ?? "no data"}`), { final: true });
      return body.data;
    } catch (err) {
      last = err;
      if (err.final || attempt === tries) break;
      await pause(3000 * attempt);
    }
  }
  throw last;
}

/**
 * The year's sales of the companies no other feed reads, earliest first. A
 * National Hunt sale is left out: its stores and pointers are none of the
 * market's kinds (sales/goffs.mjs kindOf), and a sale that gives no lots is
 * never marked as read, so it would be asked for again on every backfill.
 */
export async function discover({ year, fetchImpl = fetch } = {}) {
  const data = await call("list_sales_catalogues", { year }, { fetchImpl });
  return (data?.sales ?? [])
    .filter((s) => isGap(s.sale_company) && Number(s.total_lots) > 0 && String(s.sale_date).startsWith(String(year)))
    .map((s) => {
      const sale = saleOf(s);
      return { id: `${s.venue_id}/${s.sale_date}`, title: s.sale_name, ...sale, month: sale.month };
    })
    .filter((s) => s.type !== "jumps")
    .sort((a, b) => String(a.id.split("/")[1]).localeCompare(String(b.id.split("/")[1])));
}

/** One sale, by "<venue>/<first day>". */
export async function fetchSale(id, { fetchImpl = fetch, today } = {}) {
  const m = String(id ?? "").match(/^(\d+)\/(\d{4}-\d{2}-\d{2})$/);
  if (!m) throw new Error(`not a Racing Post sale id (venue/date): ${id}`);
  const data = await call("get_sales_results", { venue_id: m[1], sale_date: m[2] }, { fetchImpl });
  const { title, sale, lots } = parseSale(data, today ? { today } : {});
  return { id: String(id), title, sale, lots };
}

export default { READ_ELSEWHERE, isGap, saleOf, outcomeOf, parseSale, discover, fetchSale };
