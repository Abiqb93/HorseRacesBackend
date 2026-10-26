/**
 * Fasig-Tipton: every sale's results, from the house's own catalogue API.
 *
 * The house's site is www.fasigtipton.com (fasig.com does not serve it).
 * Its sales of a year are listed at /results/<year> and /catalogues/<year>;
 * each sale's page (/2025/The-Saratoga-Sale) carries the sale's identifier
 * in its Drupal settings (catalogues.sale_identifier, "N25A") and draws its
 * catalogue and results from a Django API on the same host:
 *
 *   /django/api/sales/?sale_identifier=N25A — the sale: its number (279)
 *     and first day.
 *   /django/api/horses/?sale=279 — one row a hip: name, sex, sire, dam,
 *     date of birth, consignor, purchaser, price, private_sale, out, and
 *     what it is sold as (sold_as_code: W weanling, Y yearling, TT
 *     two-year-old in training, RA horse of racing age, RP racing prospect,
 *     RS racing or stallion prospect, RB racing or broodmare prospect, BP
 *     broodmare prospect, B broodmare; "#3" and the like are breeding
 *     rights, not horses, and are left out).
 *
 * A hip bought back reads purchaser "NOT SOLD" with the last bid as its
 * price; one withdrawn reads "OUT" (out: true); one sold privately after the
 * ring has private_sale: true with its buyer and price; before the sale the
 * purchaser and price are empty. An unnamed horse is named by its birth year
 * and dam ("2024-TAPIT'S WORLD").
 *
 * The identifier is the place (K Lexington, N Saratoga, M Timonium for the
 * Midlantic sales, C California, F Florida), the year, and a letter for the
 * sale (K25A Kentucky Winter Mixed, K25B The July Sale, K25H July Selected
 * Horses of Racing Age, K25C Kentucky October, K25D The November Sale, N25A
 * The Saratoga Sale, N25B New York Bred, N25C Saratoga Fall, M25A and M25J
 * the May and June two-year-olds, M25B the fall yearlings, M25C December
 * mixed, C25B California Fall, F22A The Gulfstream Sale, last held in 2022).
 * Digital (online-only) sales, at digital.fasigtipton.com, are left out.
 */
import { nameKey } from "./normalise.mjs";
import { convert } from "./fx.mjs";

export const SITE = "https://www.fasigtipton.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export const saleApiUrl = (identifier) => `${SITE}/django/api/sales/?${new URLSearchParams({ sale_identifier: identifier })}`;
export const horsesUrl = (saleNumber) => `${SITE}/django/api/horses/?${new URLSearchParams({ sale: String(saleNumber) })}`;

const clean = (s) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t || null;
};
const decode = (s) =>
  String(s ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
const pad = (m) => String(m).padStart(2, "0");
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const monthIn = (t) => {
  const i = MONTHS.findIndex((m) => new RegExp(`\\b${m}\\b`, "i").test(t));
  return i >= 0 ? i + 1 : null;
};
/** "08-04-2025", "08/04/2025" or "2025-08-04" -> { year, month, iso } */
function dayOf(s) {
  const t = String(s ?? "");
  let m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return { year: Number(m[3]), month: Number(m[1]), iso: `${m[3]}-${pad(m[1])}-${pad(m[2])}` };
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { year: Number(m[1]), month: Number(m[2]), iso: m[0] };
  return null;
}

/** The house's sales: title -> key, name, what it sells, tier (as sales/normalise.mjs SALES), usual month. */
const RULES = [
  [/saratoga fall/i, "FT-SARFALL", "Fasig-Tipton Saratoga Fall", "mixed", 3, 10],
  [/showcase/i, "FT-SHOW", "Fasig-Tipton Selected Yearlings Showcase", "yearling", 2, 9],
  [/new york|\bny[- ]?bred/i, "FT-NYB", "Fasig-Tipton New York Bred", "yearling", 3, 8],
  [/midlantic.*(two-year|2yo|in training)/i, "FT-MID", "Fasig-Tipton Midlantic", "2yo", 3, 5],
  [/midlantic.*(december|mixed)/i, "FT-MID", "Fasig-Tipton Midlantic", "mixed", 3, 12],
  [/midlantic|eastern fall|timonium/i, "FT-MID", "Fasig-Tipton Midlantic", "yearling", 3, 10],
  [/california/i, "FT-CAL", "Fasig-Tipton California", "yearling", 3, 9],
  [/gulfstream|florida/i, "FT-GULF", "Fasig-Tipton Gulfstream Two-Year-Olds", "2yo", 1, 3],
  [/two-year|2yo|in training/i, "FT-OTHER", "Fasig-Tipton (other sales)", "2yo", 3, null],
  [/racing age|all ages|\bhora\b/i, "FT-OTHER", "Fasig-Tipton (other sales)", "hit", 3, null],
  [/saratoga/i, "FT-SAR", "Fasig-Tipton Saratoga", "yearling", 1, 8],
  [/july/i, "FT-JULY", "Fasig-Tipton July", "yearling", 3, 7],
  [/october/i, "FT-OCT", "Fasig-Tipton October", "yearling", 3, 10],
  [/november/i, "FT-NOV", "Fasig-Tipton November", "mixed", 2, 11],
  [/./, "FT-OTHER", "Fasig-Tipton (other sales)", "mixed", 3, null],
];

/**
 * A sale from its title ("The Saratoga Sale (2025)") and, when known, its
 * first day: the shared key, name, kind, tier, year and month. Null for a
 * sale left out (digital, online-only).
 */
export function saleFromTitle(title, { start = null, year = null } = {}) {
  const t = clean(decode(title));
  if (!t) return null;
  if (/digital|\bonline\b/i.test(t)) return null;
  const [, key, name, type, tier, month] = RULES.find(([re]) => re.test(t));
  const day = dayOf(start);
  const y = day?.year ?? (Number((t.match(/\b((?:19|20)\d{2})\b/) ?? [])[1]) || null) ?? (Number(year) || null);
  if (!y) return null;
  const m = day?.month ?? monthIn(t) ?? month;
  return { key, name, type, tier, year: y, month: m ? `${y}-${pad(m)}` : null };
}

/** Each identifier's sale, by place and letter. */
const CODES = {
  KA: "Kentucky Winter Mixed",
  KB: "The July Sale",
  KH: "July Selected Horses of Racing Age",
  KC: "Kentucky October Yearlings",
  KD: "The November Sale",
  NA: "The Saratoga Sale",
  NB: "New York Bred Yearlings",
  NC: "Saratoga Fall Mixed",
  MA: "Midlantic May Two-Year-Olds in Training",
  MJ: "Midlantic June Two-Year-Olds in Training",
  MB: "Midlantic Fall Yearlings",
  MC: "Midlantic December Mixed",
  CA: "Santa Anita Two-Year-Olds in Training",
  CB: "California Fall Yearlings",
  FA: "The Gulfstream Sale",
};

/** The year in an identifier ("N25A" -> 2025). */
export const yearOfCode = (identifier) => {
  const m = String(identifier ?? "").trim().match(/^[A-Z](\d{2})[A-Z]$/i);
  return m ? 2000 + Number(m[1]) : null;
};
/** A first day, kept only when it falls in the identifier's year: a few old sales carry another year's date (N16A says 2017). */
const startFor = (identifier, start) => {
  const y = yearOfCode(identifier);
  const d = dayOf(start);
  return d && (!y || d.year === y) ? d.iso : null;
};

/** A sale from its identifier ("N25A"), for when its title is not to hand. Unknown letters are FT-OTHER. */
export function saleFromCode(identifier, { start = null } = {}) {
  const m = String(identifier ?? "").trim().toUpperCase().match(/^([A-Z])(\d{2})([A-Z])$/);
  if (!m) return null;
  const year = 2000 + Number(m[2]);
  const title = `${CODES[m[1] + m[3]] ?? "Fasig-Tipton sale"} (${year})`;
  return { title, ...saleFromTitle(title, { start: startFor(identifier, start) }) };
}

/** A results or catalogues page: each sale's page path, title and dates as printed. */
export function parseListing(html) {
  const out = [];
  const seen = new Set();
  for (const m of String(html).matchAll(/<h3 class="sale-name">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<div class="sale-date">\s*([^<]*?)\s*<\/div>/g)) {
    const path = m[1].replace(/^https?:\/\/[^/]+/, "").replace(/^\/index\.php/, "").replace(/[#?].*$/, "");
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ path, title: clean(decode(m[2].replace(/<[^>]+>/g, " "))), dates: clean(m[3]) });
  }
  return out;
}

/** A sale's page: its identifier, title and first and last day, from its Drupal settings. */
export function parseSalePage(html) {
  const m = String(html).match(/data-drupal-selector="drupal-settings-json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  let c;
  try {
    c = JSON.parse(m[1]).catalogues ?? null;
  } catch {
    return null;
  }
  if (!c?.sale_identifier) return null;
  return {
    identifier: String(c.sale_identifier).trim().toUpperCase(),
    title: clean(String(c.title ?? c.sale_name ?? "").replace(/\s*\((?:19|20)\d{2}\)\s*$/, "")),
    start: dayOf(c.sale_start_date)?.iso ?? null,
    end: dayOf(c.sale_end_date)?.iso ?? null,
  };
}

/**
 * What a hip is, from the house's sold-as code. A racing or broodmare
 * prospect is a horse in training at a sale of horses of racing age and
 * breeding stock anywhere else. Null for what is not a horse. Where the
 * house says nothing, the sale's kind, then the hip's age and sex, decide.
 */
export function kindOf(code, { saleType = "mixed", age = null, sex = null, named = false, month = null } = {}) {
  const c = String(code ?? "").trim().toUpperCase();
  if (c.startsWith("#") || /SEASON|SHARE|RIGHT/.test(c)) return null;
  if (c === "W" || /WEANLING/.test(c)) return "foal";
  if (c === "Y" || /YEARLING/.test(c)) return "yearling";
  if (c === "TT" || /TWO-YEAR|2YO|IN TRAINING/.test(c)) return "2yo";
  if (c === "RB" || /RACING OR BROODMARE/.test(c)) return saleType === "hit" ? "hit" : "breeding";
  if (["RA", "RP", "RS", "R"].includes(c) || /RACING/.test(c)) return "hit";
  if (["B", "BP", "S", "SP"].includes(c) || /BROODMARE|STALLION/.test(c)) return "breeding";
  if (saleType !== "mixed") return saleType;
  const x = String(sex ?? "").toUpperCase();
  if (age === 0) return "foal";
  if (age === 1) return "yearling";
  if (x === "M") return "breeding";
  if (age === null && !named) return month && month >= 7 ? "foal" : "yearling";
  if (x === "H") return "breeding";
  return x === "F" ? "breeding" : "hit";
}

/**
 * What became of a hip. Out: withdrawn. NOT SOLD: bought back, the price
 * being the last bid. Private sale: sold after the ring. A buyer and a
 * price: sold. Nothing yet: still to come (catalogued).
 */
export function outcomeOf(row) {
  const p = clean(row?.purchaser);
  const price = Number(row?.price) > 0 ? Number(row.price) : null;
  if (row?.out === true || /^(out|withdrawn|scratched)$/i.test(p ?? "")) return { status: "withdrawn", buyer: null, price: null, bid: null, afterSale: false };
  if (/^(not sold|no sale|rna|r\.n\.a\.?|buy ?back|bought back)$/i.test(p ?? "")) return { status: "rna", buyer: null, price: null, bid: price, afterSale: false };
  const afterSale = row?.private_sale === true;
  if (price) return { status: "sold", buyer: p, price, bid: null, afterSale };
  if (p || afterSale) return { status: "sold_private", buyer: p, price: null, bid: null, afterSale };
  return { status: "catalogued", buyer: null, price: null, bid: null, afterSale: false };
}

const SEX = { C: "colt", F: "filly", G: "gelding", M: "filly", H: "colt", R: "colt" };

/** One sale's horses (the API's rows) as lots in the shared shape. `sale` is a saleFromTitle() result. */
export function parseHorses(rows, { id, title = null, sale }) {
  const list = typeof rows === "string" ? JSON.parse(rows) : rows ?? [];
  if (!sale) return { id, title, sale: null, lots: [] };
  const month = /^\d{4}-\d{2}$/.test(sale.month ?? "") ? sale.month : null;
  const monthNo = month ? Number(month.slice(5)) : null;
  const lots = [];
  for (const r of Array.isArray(list) ? list : []) {
    const lot = clean(r.hip);
    if (!lot) continue;
    const born = Number((String(r.year_of_birth ?? "").match(/((?:19|20)\d{2})/) ?? [])[1]) || null;
    const rawName = clean(r.name);
    const horse = rawName && !/^(?:19|20)\d{2}\s*-/.test(rawName) ? rawName : null;
    const sexCode = String(r.sex ?? "").trim().toUpperCase();
    const type = kindOf(clean(r.sold_as_description) ?? r.sold_as_code, { saleType: sale.type, age: born ? sale.year - born : null, sex: sexCode, named: !!horse, month: monthNo });
    if (!type) continue;
    const o = outcomeOf(r);
    const sire = clean(r.sire);
    const dam = clean(r.dam);
    const sold = o.status === "sold";
    const gbp = sold ? convert(o.price, "USD", "GBP", month ?? String(sale.year)) : null;
    const out = {
      source: "fasig",
      company: "Fasig-Tipton",
      sale_key: sale.key,
      sale_name: sale.name,
      sale_tier: sale.tier,
      sale_label: `FT-${id}`,
      region: "US",
      year: sale.year,
      sale_month: month,
      sale_type: type,
      lot: String(Number(lot) || lot),
      horse,
      sire,
      sire_key: nameKey(sire),
      dam,
      dam_key: nameKey(dam),
      sex: SEX[sexCode] ?? null,
      foaling_year: born ?? (type === "foal" ? sale.year : type === "yearling" ? sale.year - 1 : type === "2yo" ? sale.year - 2 : null),
      vendor: clean(r.consignor) ?? clean(r.property_line),
      buyer: sold || o.status === "sold_private" ? o.buyer : null,
      status: o.status,
      price: sold ? o.price : null,
      bid: o.status === "rna" ? o.bid : null,
      currency: "USD",
      price_gbp: gbp === null ? null : Math.round(gbp),
    };
    if (o.afterSale && (sold || o.status === "sold_private")) out.after_sale = true;
    lots.push(out);
  }
  return { id, title, sale, lots };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getText(url, fetchImpl, accept = "application/json") {
  const res = await fetchImpl(url, { headers: { "user-agent": UA, accept }, redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Fasig-Tipton: HTTP ${res.status} for ${url}`);
  return res.text();
}

/**
 * The house's thoroughbred sales of a year, each with the identifier
 * fetchSale() takes: the sales on its results and catalogues pages for the
 * year, each sale's page read for its identifier, one request at a time.
 */
export async function discover({ year, fetchImpl = fetch, pauseMs = 700 } = {}) {
  const y = Number(year);
  const listed = new Map();
  for (const kind of ["results", "catalogues"]) {
    try {
      for (const s of parseListing(await getText(`${SITE}/${kind}/${y}`, fetchImpl, "text/html"))) if (!listed.has(s.path)) listed.set(s.path, s);
    } catch (e) {
      if (kind === "results") throw e; // a year with no catalogues page yet is fine
    }
    await sleep(pauseMs);
  }
  const out = [];
  const ids = new Set();
  for (const s of listed.values()) {
    const page = parseSalePage(await getText(`${SITE}${s.path}`, fetchImpl, "text/html"));
    await sleep(pauseMs);
    if (!page || ids.has(page.identifier)) continue;
    const title = page.title ?? s.title;
    const sale = saleFromTitle(title, { start: startFor(page.identifier, page.start), year: yearOfCode(page.identifier) ?? y }) ?? null;
    if (!sale || sale.year !== y) continue;
    ids.add(page.identifier);
    out.push({ id: page.identifier, title, ...sale, start: page.start, end: page.end, path: s.path });
  }
  return out.sort((a, b) => String(a.start ?? a.month).localeCompare(String(b.start ?? b.month)));
}

/**
 * One sale's catalogue and results as lots, from its identifier ("N25A").
 * `info` (an entry from discover()) gives the sale's title; without it the
 * identifier does.
 */
export async function fetchSale(id, { fetchImpl = fetch, info = null, pauseMs = 500 } = {}) {
  const code = String(id).trim().toUpperCase();
  const found = JSON.parse(await getText(saleApiUrl(code), fetchImpl));
  const record = Array.isArray(found) ? found.find((s) => String(s.sale_identifier).toUpperCase() === code) ?? found[0] : null;
  const fromCode = saleFromCode(code, { start: record?.sale_start_day });
  const title = info?.title ?? fromCode?.title ?? null;
  const meta = info?.key
    ? { key: info.key, name: info.name, type: info.type, tier: info.tier, year: info.year, month: info.month }
    : fromCode && { key: fromCode.key, name: fromCode.name, type: fromCode.type, tier: fromCode.tier, year: fromCode.year, month: fromCode.month };
  if (!record || !meta) return { id: code, title, sale: meta ?? null, lots: [] };
  await sleep(pauseMs);
  const horses = JSON.parse(await getText(horsesUrl(record.id), fetchImpl));
  return parseHorses(horses, { id: code, title, sale: meta });
}

export default { SITE, saleApiUrl, horsesUrl, saleFromTitle, saleFromCode, yearOfCode, parseListing, parseSalePage, kindOf, outcomeOf, parseHorses, discover, fetchSale };
