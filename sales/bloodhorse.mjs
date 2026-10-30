/**
 * The sales no other feed reads, from BloodHorse's sale results through parse.bot.
 *
 * The user (30 October 2026: "we can use the Bloodhorse API to enrich the
 * sales databases. Fill in any missing. Use this ongoing and update daily.")
 * pointed to a parse.bot scraper over BloodHorse, which lists every sale of a
 * year (get_sales_results) and gives a sale's lots a session at a time
 * (get_sale_detail): lot, horse, sex, year of birth, sire, dam, consignor,
 * buyer and the price in US dollars, whatever currency the sale was held in.
 *
 * It is read for the sales none of the house feeds, the Racing Post feed
 * (sales/parsebot.mjs) or the workbooks hold: the Japanese sales (the JRHA
 * Select Sale, JBBA, JRA, Chiba, JS), New Zealand Bloodstock, Saudi Arabia,
 * Puerto Rico, Argentina and the American state breeders' sales. A sale of a
 * company read elsewhere is left to that feed. And a lot is the last resort
 * for its horse: where any other source holds the same horse at the same
 * sale (the New Zealand workbook's Karaka rows, in their own currency), the
 * index keeps that one (metrics.mjs lastResort).
 *
 * A sale's id is BloodHorse's "<year>/<sale id>/<slug>" ("2025/10303/jrha-
 * select-yearling-foal-sale-2025"), and so is its label; its key is "BH-"
 * and BloodHorse's code ("BH-JRHJUL"), so no other source's key is ever its.
 *
 * PARSE_API_KEY is the key the other parse.bot feeds use.
 */
import { nameKey, sexOf } from "./normalise.mjs";
import { convert } from "./fx.mjs";

const SCRAPER = process.env.PARSE_BLOODHORSE_SCRAPER_ID || "072d02a4-5c40-401d-ba90-3484c0f42431";
const BASE = `https://api.parse.bot/scraper/${SCRAPER}`;
const RESULTS = "https://www.bloodhorse.com/horse-racing/thoroughbred-sales/results";

/** The companies another feed reads, by the start of BloodHorse's sale names; left to those feeds. */
export const READ_ELSEWHERE = /^(keeneland|fasig|tattersalls|goffs|doncaster bloodstock|arqana|inglis|magic millions|ocala|obs\b|baden|bbag|osarus|canadian thoroughbred|california|texas|washington|ltba|louisiana|emirates|sga\b|auctav|thoroughbid|goresbridge)/i;

/**
 * National Hunt sales: stores and pointers are none of the market's kinds,
 * so they are left out here as the Racing Post feed leaves them out. A sale
 * is jumps by its name (National Hunt, point-to-point, store), or by its
 * house (Brightwells, Cheltenham) unless the name says flat: Brightwells'
 * Ascot breeze-ups and horses-in-training sales were flat sales.
 */
const JUMPS_NAME = /national hunt|\bn\.?h\.?\b|point[- ]to[- ]point|\bp2p\b|\bstore\b|\bjumps?\b/i;
const JUMPS_HOUSE = /brightwells|cheltenham/i;
const FLAT = /flat|yearling|foal|breeze|2yo|two[- ]year|in training|racing age/i;
export const isJumps = (name) => {
  const s = String(name ?? "");
  return JUMPS_NAME.test(s) || (JUMPS_HOUSE.test(s) && !FLAT.test(s));
};

/** The same rule as the database matches it, for the rows read before jumps sales were left out. */
export const JUMPS_WHERE =
  "(LOWER(sale_name) REGEXP 'national hunt|point[- ]to[- ]point|p2p| store|jump'"
  + " OR (LOWER(sale_name) REGEXP 'brightwells|cheltenham' AND LOWER(sale_name) NOT REGEXP 'flat|yearling|foal|breeze|2yo|two[- ]year|in training|racing age'))";

/** Rows of jumps sales this feed read before it left them out, removed; how many went. */
export async function pruneJumps(runQuery) {
  const done = await runQuery(`DELETE FROM sale_lots WHERE source = 'bloodhorse' AND ${JUMPS_WHERE}`, []);
  return done?.affectedRows ?? 0;
}

/** Whether a sale is this feed's: one no other feed reads, and not a jumps sale. */
export const isGap = (name) => Boolean(String(name ?? "").trim()) && !READ_ELSEWHERE.test(String(name).trim()) && !isJumps(name);

/** The company that held a sale, from its name: the name the index matches horses by (metrics.mjs houseOf). */
const COMPANIES = [
  [/^jrha/i, "JRHA"],
  [/^jbba/i, "JBBA"],
  [/^jra\b/i, "JRA"],
  [/^js\b/i, "JS"],
  [/^chiba/i, "Chiba Thoroughbred Sales"],
  [/^new zealand bloodstock|^nzb\b/i, "New Zealand Bloodstock"],
  [/^jockey club of saudi arabia/i, "Jockey Club of Saudi Arabia"],
  [/^hacienda los nietos/i, "Hacienda Los Nietos"],
  [/^potrero los llanos/i, "Potrero Los Llanos"],
  [/^itoba|^indiana/i, "Indiana TOBA"],
  [/^minnesota/i, "Minnesota Thoroughbred Association"],
  [/^iowa/i, "Iowa TBOA"],
  [/^ohio/i, "Ohio TBOA"],
  [/^arizona/i, "Arizona TBA"],
];
export function companyOf(name) {
  const s = String(name ?? "").trim();
  const hit = COMPANIES.find(([re]) => re.test(s));
  if (hit) return hit[1];
  return s.replace(/\b(19|20)\d{2}\b.*$/, "").replace(/\s+(select|yearling|weanling|mixed|winter|summer|spring|fall|autumn|breeze|sale|2yos?|two-year).*$/i, "").trim().slice(0, 48) || "BloodHorse";
}

/** The market a sale belongs to, from BloodHorse's location ("Japan, JPN"). */
export function regionOf(location) {
  const code = String(location ?? "").split(",").pop().trim().toUpperCase();
  if (["USA", "US", "CAN"].includes(code)) return "US";
  if (["NZ", "NZL"].includes(code)) return "NZ";
  if (["AUS"].includes(code)) return "AUS";
  if (["GBR", "GB", "IRE", "FRA", "FR", "GER", "ITY", "ITA"].includes(code)) return "EU";
  return code.slice(0, 3) || null;
}

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

/** A sale's identity: its own key, its name without the year, and the month it was held. */
export function saleOf({ name, code, year, month }) {
  const y = Number(year) || null;
  const m = MONTHS[String(month ?? "").trim().toLowerCase()] ?? null;
  const select = /jrha select|karaka.*book 1|karaka yearling/i.test(name ?? "");
  return {
    key: `BH-${String(code ?? "").replace(/\d{4}$/, "").toUpperCase() || "SALE"}`.slice(0, 24),
    name: String(name ?? "").replace(/\s*\b(19|20)\d{2}\b/g, "").replace(/\s+/g, " ").trim().slice(0, 96),
    company: companyOf(name),
    tier: select ? 1 : 3,
    year: y,
    month: y && m ? `${y}-${String(m).padStart(2, "0")}` : null,
  };
}

/** What a lot is, from BloodHorse's lot type and the horse's age at the sale. */
export function kindOf(lotType, age) {
  const t = String(lotType ?? "").toLowerCase();
  if (t.startsWith("broodmare")) return "breeding";
  if (t.startsWith("weanling") || age === 0) return "foal";
  if (t.startsWith("yearling") || age === 1) return "yearling";
  if (t.startsWith("two-year") || t.startsWith("2yo")) return "2yo";
  if (t.includes("racing prospect") || t.includes("horse of racing age") || t.includes("in training")) return "hit";
  return null;
}

/** A dollar figure from BloodHorse's price text: "$46,817", "($70,226)" for a last bid, "(-)" for none. */
const dollars = (text) => {
  const m = String(text ?? "").match(/\$\s*([\d,]+)/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
};

/** What became of a lot: sold at its price, bought back at its last bid, or not sold. */
export function outcomeOf(lot) {
  const status = String(lot?.status ?? "").trim().toLowerCase();
  const price = Number(lot?.price_usd) > 0 ? Number(lot.price_usd) : null;
  if (status === "sold") return price ? { status: "sold", price, bid: null } : { status: "sold_private", price: null, bid: null };
  if (status === "rna") return { status: "rna", price: null, bid: dollars(lot?.price_text) };
  if (/not sold|no sale|unsold/.test(status)) return { status: "unsold", price: null, bid: null };
  if (/out|withdrawn|scratch/.test(status)) return { status: "withdrawn", price: null, bid: null };
  return { status: "unknown", price: null, bid: null };
}

const words = (s) => String(s ?? "").trim().replace(/\s+/g, " ");

/** One session's lots (get_sale_detail) in the shared shape. `sale` is saleOf's, with the sale's id and region. */
export function parseLots(lots, sale) {
  const out = [];
  for (const l of lots ?? []) {
    const dam = words(l?.dam);
    if (!dam || !sale?.year) continue;
    const born = Number(l.year_of_birth) || null;
    const age = born ? sale.year - born : null;
    const type = kindOf(l.lot_type, age);
    if (!type) continue;
    const o = outcomeOf(l);
    const gbp = o.price ? convert(o.price, "USD", "GBP", sale.month ?? String(sale.year)) : null;
    const name = words(l.name);
    const sex = String(l.sex ?? "").toUpperCase();
    out.push({
      source: "bloodhorse",
      company: sale.company,
      sale_key: sale.key,
      sale_name: sale.name,
      sale_tier: sale.tier,
      sale_label: sale.id,
      region: sale.region,
      year: sale.year,
      sale_month: sale.month,
      sale_type: type,
      lot: words(l.hip) || null,
      horse: name && !/^unnamed$/i.test(name) ? name : null,
      sire: words(l.sire) || null,
      sire_key: nameKey(l.sire) || null,
      dam,
      dam_key: nameKey(dam),
      sex: sex === "M" ? "filly" : sexOf(sex === "R" ? "rig" : sex),
      foaling_year: born,
      vendor: words(l.consignor) || null,
      buyer: o.status === "sold" || o.status === "sold_private" ? words(l.buyer) || null : null,
      status: o.status,
      after_sale: 0,
      price: o.price,
      bid: o.bid,
      currency: "USD",
      price_gbp: gbp === null ? null : Math.round(gbp),
    });
  }
  return out;
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
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`BloodHorse ${endpoint}: HTTP ${res.status} (is PARSE_API_KEY a key for this scraper's account?)`), { final: true });
      if (!res.ok || text.startsWith("error code:")) throw new Error(`BloodHorse ${endpoint}: HTTP ${res.status}`);
      const body = JSON.parse(text);
      if (body?.status !== "success") throw Object.assign(new Error(`BloodHorse ${endpoint}: ${body?.error?.message ?? body?.message ?? "no data"}`), { final: true });
      return body.data;
    } catch (err) {
      last = err;
      if (err.final || attempt === tries) break;
      await pause(3000 * attempt);
    }
  }
  throw last;
}

/** A sale's id from its BloodHorse link: "<year>/<sale id>/<slug>". */
export const idOfLink = (link) => (String(link ?? "").match(/\/results\/(\d{4}\/\d+\/[^/?#]+)/) ?? [])[1] ?? null;

/** The year's sales no other feed reads, earliest first. */
export async function discover({ year, fetchImpl = fetch } = {}) {
  const data = await call("get_sales_results", { year }, { fetchImpl });
  return (data?.sales ?? [])
    .filter((s) => isGap(s.name) && idOfLink(s.link))
    .map((s) => {
      const sale = saleOf({ name: s.name, code: s.code, year, month: s.month });
      return { id: idOfLink(s.link), title: s.name, ...sale };
    });
}

/** One sale, every session, by "<year>/<sale id>/<slug>". `info` is discover's entry for it, where the caller has it. */
export async function fetchSale(id, { fetchImpl = fetch, info = null } = {}) {
  const m = String(id ?? "").match(/^(\d{4})\/(\d+)\/([^/]+)$/);
  if (!m) throw new Error(`not a BloodHorse sale id (year/id/slug): ${id}`);
  const first = await call("get_sale_detail", { url: `${RESULTS}/${id}/1` }, { fetchImpl });
  const sessions = [...new Set([1, ...(first?.sessions ?? [])].map(Number))].filter((n) => n >= 1).sort((a, b) => a - b);
  const pages = [first];
  for (const n of sessions.filter((n) => n !== 1)) pages.push(await call("get_sale_detail", { url: `${RESULTS}/${id}/${n}` }, { fetchImpl }));
  const name = first?.sale_name ?? info?.title ?? null;
  const code = String(first?.lots?.[0]?.sale_code ?? "").replace(/\d{4}$/, "") || info?.key?.replace(/^BH-/, "") || m[2];
  // The month from the calendar where the caller has it, else from the sale's own dates ("Monday, July 14 - ...").
  const month = (String(first?.sale_dates ?? "").toLowerCase().match(/january|february|march|april|may|june|july|august|september|october|november|december/) ?? [])[0];
  const base = saleOf({ name, code, year: m[1], month });
  const sale = { ...base, month: info?.month ?? base.month, id: String(id), region: regionOf(first?.location) };
  const lots = pages.flatMap((p) => parseLots(p?.lots, sale));
  return { id: String(id), title: name, sale, lots };
}

export default { READ_ELSEWHERE, isGap, companyOf, regionOf, saleOf, kindOf, outcomeOf, parseLots, idOfLink, discover, fetchSale };
