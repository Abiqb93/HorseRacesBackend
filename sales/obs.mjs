/**
 * OBS (Ocala Breeders' Sales), Florida: every sale's results, from the house's own catalogue.
 *
 * The catalogue at obssales.com/catalog/#/<sale id>/results reads one
 * public JSON document a sale, from the house's WordPress plugin:
 *   obssales.com/wp-json/obs-catalog-wp-plugin/v1/horse-sales/<sale id>
 * the sale (code, name, category, start, the ids of the sales either side
 * of it) and every hip: type (W, Y, 2, 3, 4, B, J), sex, foaling year,
 * name, sire, dam, consignor, buyer, hammer price in dollars, whether it
 * was out, not sold (with the last bid, "sale_price_rna"), or sold after
 * the ring ("post_sale_indicator"). The house's list of sales needs a
 * login, so a year's sales are read from its public results page
 * (obssales.com/sales-results/), which links each sale by its id: the
 * January Winter Mixed, March, Spring and June two-year-old sales and the
 * October yearlings. The small OBSOnline sales are not linked there; they
 * read the same way by id. Sales before 2024 are on older pages at
 * obscatalog.com (<mon>results/<year>/), not read here.
 */
import { nameKey } from "./normalise.mjs";
import { convert } from "./fx.mjs";

/**
 * The house's sales, by the name it gives them. All are defined here (no
 * OBS sale has a key in sales/normalise.mjs): OBS-MARCH, OBS-SPRING,
 * OBS-JUNE, OBS-OCT, OBS-JAN, OBS-ONLINE.
 */
const RULES = [
  [/obsonline|\bonline\b|second chance/i, { key: "OBS-ONLINE", name: "OBSOnline", type: "mixed", month: null, tier: 3 }],
  [/march/i, { key: "OBS-MARCH", name: "OBS March Two-Year-Olds in Training", type: "2yo", month: 3, tier: 1 }],
  [/spring|april/i, { key: "OBS-SPRING", name: "OBS Spring Two-Year-Olds in Training", type: "2yo", month: 4, tier: 2 }],
  [/june|july/i, { key: "OBS-JUNE", name: "OBS June Two-Year-Olds & Horses of Racing Age", type: "2yo", month: 6, tier: 3 }],
  [/october|yearling/i, { key: "OBS-OCT", name: "OBS October Yearlings", type: "yearling", month: 10, tier: 3 }],
  [/winter|january|mixed/i, { key: "OBS-JAN", name: "OBS Winter Mixed", type: "mixed", month: 1, tier: 3 }],
];

/** A sale from its name ("2025 October Yearling Sale") and, when known, its start ("2025-10-07 04:00:00"). Null for a name the house does not use. */
export function saleFromTitle(title, starts = null) {
  const t = decode(title);
  const rule = RULES.find(([re]) => re.test(t));
  if (!rule) return null;
  const def = rule[1];
  const start = String(starts ?? "").match(/^(\d{4})-(\d{2})/);
  const year = start ? Number(start[1]) : Number((t.match(/\b(20\d{2})\b/) ?? [])[1]) || null;
  if (!year) return null;
  const month = start ? `${start[1]}-${start[2]}` : def.month ? `${year}-${String(def.month).padStart(2, "0")}` : null;
  return { key: def.key, name: def.name, type: def.type, tier: def.tier, year, month };
}

const decode = (s) =>
  String(s ?? "")
    .replace(/&#0?38;|&amp;/g, "&")
    .replace(/&#8217;|&#0?39;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The sales the house's results page links to its catalogue: id and title. */
export function parseResultsPage(html) {
  const out = new Map();
  for (const m of String(html).matchAll(/catalog\/#\/(\d+)\/results"[^>]*>([^<]+)</g)) {
    const title = decode(m[2]);
    if (title && !out.has(m[1])) out.set(m[1], { id: Number(m[1]), title });
  }
  return [...out.values()];
}

/** What a hip is, from the house's type code, else its age at the sale. Null for neither. */
export function kindOf(type, { foaled = null, year = null, sex = null } = {}) {
  const t = String(type ?? "").toUpperCase().trim();
  if (t === "W") return "foal";
  if (t === "Y") return "yearling";
  if (t === "2") return "2yo";
  if (/^[3-9]$|^R$|^H$/.test(t)) return "hit";
  if (/^[BJM]$/.test(t)) return "breeding";
  const age = foaled && year ? year - foaled : null;
  if (age === 0) return "foal";
  if (age === 1) return "yearling";
  if (age === 2) return "2yo";
  if (age >= 3) return /^M$/i.test(sex ?? "") ? "breeding" : "hit";
  return null;
}

/**
 * What became of a hip: out (withdrawn or scratched), not sold (RNA, with
 * the last bid when the house gives one), sold in the ring or after it,
 * or not through the ring yet (catalogued).
 */
export function outcomeOf(h) {
  const d = h?.display_props ?? {};
  const buyer = String(h?.buyer_name ?? "").trim();
  const hammer = Number(h?.hammer_price);
  if (String(h?.in_out_status).toUpperCase() === "O" || d.is_hip_out || /^out$/i.test(buyer)) return { status: "withdrawn", price: null, bid: null, afterSale: false };
  if (d.is_hip_not_through_ring_yet) return { status: "catalogued", price: null, bid: null, afterSale: false };
  if (String(h?.rna_summary_indicator).toUpperCase() === "Y" || d.is_rna || /^rna$/i.test(buyer)) {
    const last = Number(h?.sale_price_rna) > 0 ? Number(h.sale_price_rna) : hammer < 0 ? -hammer : null;
    return { status: "rna", price: null, bid: last, afterSale: false };
  }
  const after = String(h?.post_sale_indicator).toUpperCase() === "Y";
  if (hammer > 0) return { status: "sold", price: hammer, bid: null, afterSale: after };
  if (d.is_hip_sold || (buyer && after)) return { status: "sold_private", price: null, bid: null, afterSale: after };
  return { status: "catalogued", price: null, bid: null, afterSale: false };
}

const SEX = { C: "colt", R: "colt", H: "colt", F: "filly", M: "filly", G: "gelding" };
const clean = (s) => {
  const t = decode(s);
  return t || null;
};
/** A name without its country ("Dark Angel (IRE)" -> "Dark Angel"). */
const bare = (s) => clean(s)?.replace(/\s*\([A-Z]{2,3}\)\s*$/, "") || null;
/** A consignor without the house's consignment numeral ("Beth Bayer, Agent XV" -> "Beth Bayer, Agent"). */
const consignor = (s) => clean(s)?.replace(/(,\s*Agent)\s+[IVXLC]+$/i, "$1") ?? null;

/** One sale's JSON document as the sale and its lots in the shared shape. */
export function parseSale(doc) {
  const d = typeof doc === "string" ? JSON.parse(doc) : doc;
  const id = Number(d?.sale_id) || null;
  const title = clean(d?.sale_name);
  const sale = saleFromTitle(`${title ?? ""} ${/online/i.test(d?.sale_category ?? "") || Number(d?.is_digital) === 1 ? "online" : ""}`, d?.sale_starts);
  if (!sale || !id) return { id, code: d?.sale_code ?? null, title, sale: null, lots: [] };
  const lots = [];
  for (const h of d.sale_hip ?? []) {
    if (/^zz\s*blank/i.test(String(h.sire_name ?? "")) || /^blank pages?$/i.test(String(h.consignor_name ?? "").trim())) continue;
    const foaled = Number(h.foaling_year) || null;
    const type = kindOf(h.horse_type, { foaled, year: sale.year, sex: h.sex });
    if (!type) continue;
    const { status, price, bid, afterSale } = outcomeOf(h);
    const gbp = status === "sold" && sale.month ? convert(price, "USD", "GBP", sale.month) : null;
    lots.push({
      source: "obs",
      company: "OBS",
      sale_key: sale.key,
      sale_name: sale.name,
      sale_tier: sale.tier,
      sale_label: `OBS${id}`,
      region: "US",
      year: sale.year,
      sale_month: sale.month,
      sale_type: type,
      lot: String(h.hip_number ?? "").trim(),
      horse: bare(h.horse_name),
      sire: bare(h.sire_name),
      sire_key: nameKey(h.sire_name),
      dam: bare(h.dam_name),
      dam_key: nameKey(h.dam_name),
      sex: SEX[String(h.sex ?? "").toUpperCase()] ?? null,
      foaling_year: foaled,
      vendor: consignor(h.consignor_name ?? h.property_line_1),
      buyer: status === "sold" || status === "sold_private" ? clean(h.buyer_name) : null,
      status,
      price,
      bid,
      currency: "USD",
      price_gbp: gbp === null ? null : Math.round(gbp),
      after_sale: afterSale || undefined,
    });
  }
  return { id, code: d.sale_code ?? null, title, sale, lots };
}

/* ------------------------------------------------------------ fetching */

const SITE = "https://obssales.com";
export const saleUrl = (id) => `${SITE}/wp-json/obs-catalog-wp-plugin/v1/horse-sales/${Number(id)}`;
const UA = "Mozilla/5.0 (compatible; BlandfordBloodstock/1.0; sales results; +https://www.blandfordbloodstock.tech)";

async function get(fetchImpl, url, accept) {
  const res = await fetchImpl(url, { headers: { "user-agent": UA, accept }, redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`OBS ${url}: HTTP ${res.status}`);
  return res.text();
}

/** The year's sales, as the house's results page links them. */
export async function discover({ year, fetchImpl = fetch } = {}) {
  const html = await get(fetchImpl, `${SITE}/sales-results/`, "text/html");
  const out = [];
  for (const { id, title } of parseResultsPage(html)) {
    const sale = saleFromTitle(title);
    if (!sale || sale.year !== Number(year)) continue;
    out.push({ id, title, ...sale });
  }
  return out.sort((a, b) => String(a.month).localeCompare(String(b.month)) || a.id - b.id);
}

/** One sale's lots, by the house's sale id (146 is the October Yearling Sale of 2025). */
export async function fetchSale(id, { fetchImpl = fetch } = {}) {
  if (!(Number(id) > 0)) throw new Error(`not an OBS sale id: ${id}`);
  const text = await get(fetchImpl, saleUrl(id), "application/json");
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error(`OBS sale ${id}: not JSON`);
  }
  const { title, sale, lots } = parseSale(doc);
  return { id: Number(id), title, sale, lots };
}

export default { saleFromTitle, parseResultsPage, kindOf, outcomeOf, parseSale, saleUrl, discover, fetchSale };
