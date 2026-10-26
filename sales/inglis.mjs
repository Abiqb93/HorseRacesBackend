/**
 * Inglis, Sydney and Melbourne: every sale's results, from the house's own export.
 *
 * Each sale has a page at inglis.com.au/sale/<slug> (the slug is its year and
 * name: 2026-australian-easter-yearling-sale) and its results an "Export as
 * CSV" at inglis.com.au/sales/<slug>/csv/index, which is in fact an .xlsx
 * (read with sales/xlsx.mjs): a header row, then one row a lot — lot,
 * colour, sex (Colt, Filly, Gelding, Mare), name, vendor, sire, dam,
 * purchaser and location, status ("Sold", "Passed In - Reserve: $350,000",
 * "Withdrawn"), price ("$400,000"), stables, covering stallion, dam sire,
 * date of birth. Ahead of a sale the export is the header row alone until
 * the catalogue is out, and a lot not yet offered has no status or price.
 *
 * The export does not say what a lot is. At a sale of one kind (yearlings,
 * weanlings, two-year-olds) every lot is that kind; at the breeding and
 * mixed sales it is read from the sex, the age and whether a mare is
 * covered. A passed-in lot's last bid is not published, only the vendor's
 * reserve, which is kept as its bid. The house does not mark a lot sold
 * after the ring: such a deal reads as a sale like any other.
 *
 * The sales with results are listed at inglis.com.au/sales/results (a
 * search by year finds one year's), the sales to come in the calendar at
 * inglis.com.au/calendar. Inglis Digital's online sales run on another
 * platform with no results export and are not read here.
 *
 * Prices are Australian dollars as the hammer fell, kept as published.
 * Inglis's conditions of sale (15.1): "Bidding will be on a GST exclusive
 * basis", GST being added to the final bid where the vendor is registered.
 */
import { readSheet } from "./xlsx.mjs";
import { nameKey } from "./normalise.mjs";
import { convert } from "./fx.mjs";

const UA = "BlandfordBloodstock/1.0 (sales results; +https://www.blandfordbloodstock.tech)";
const BASE = "https://inglis.com.au";
export const exportUrl = (slug) => `${BASE}/sales/${encodeURIComponent(slug)}/csv/index`;
export const salePageUrl = (slug) => `${BASE}/sale/${encodeURIComponent(slug)}`;
export const resultsUrl = (year, page = 1) => `${BASE}/sales/results?search=${encodeURIComponent(year)}${page > 1 ? `&page=${page}` : ""}`;
export const CALENDAR_URL = `${BASE}/calendar`;

/*
 * The house's sales: title -> the shared key, what it sells, its tier and
 * usual month (used only when neither the listing nor the sale's page dates
 * it). The yearling keys are the workbook's (sales/normalise.mjs), the HTBA
 * Yearling Sale's among them, so a sale-year read here replaces the
 * workbook's reading of it. New here:
 *   ING-R2R    Ready2Race Sale (two-year-olds)
 *   ING-WEAN   Australian Weanling Sale
 *   ING-CHAIR  The Chairman's Sale (broodmares and broodmare prospects)
 *   ING-BROOD  Australian Broodmare Sale (and the Broodmare and Weanling Sale of 2019)
 *   ING-GSTH   Great Southern Sale, Melbourne (weanlings; broodmares in some years)
 */
const RULES = [
  [/digital|online/i, null],
  [/easter yearling/i, "ING-EASTER", "Inglis Easter", "yearling", 1, 4],
  [/classic yearling/i, "ING-CLASSIC", "Inglis Classic", "yearling", 2, 2],
  [/premier yearling/i, "ING-PREMIER", "Inglis Premier", "yearling", 2, 3],
  [/gold yearling|vobis gold/i, "ING-VOBIS", "Inglis Melbourne VOBIS Gold", "yearling", 3, 4],
  [/htba/i, "HTBA", "HTBA Yearling Sale", "yearling", 3, 4],
  [/scone yearling/i, "ING-SCONE", "Inglis Scone", "yearling", 3, 5],
  [/festival yearling/i, "ING-FEST", "Inglis Festival", "yearling", 3, 3],
  [/select yearling/i, "ING-SELECT", "Inglis Select", "yearling", 3, 3],
  [/ready\s?(?:2|to)\s?race/i, "ING-R2R", "Inglis Ready2Race", "2yo", 1, 10],
  [/chairman/i, "ING-CHAIR", "Inglis Chairman's Sale", "breeding", 1, 5],
  [/great southern/i, "ING-GSTH", "Inglis Great Southern", "mixed", 3, 6],
  [/broodmare and weanling|broodmare & weanling/i, "ING-BROOD", "Inglis Australian Broodmare", "mixed", 2, 5],
  [/broodmare/i, "ING-BROOD", "Inglis Australian Broodmare", "breeding", 2, 5],
  [/weanling/i, "ING-WEAN", "Inglis Australian Weanling", "foal", 1, 5],
];

const pad = (m) => String(m).padStart(2, "0");
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "2026-australian-easter-yearling-sale" -> 2026 */
export const yearOfSlug = (slug) => Number((String(slug ?? "").match(/^(20\d{2})-/) ?? [])[1]) || null;

/** "2026-australian-easter-yearling-sale" -> "2026 Australian Easter Yearling Sale" */
export const titleFromSlug = (slug) =>
  String(slug ?? "")
    .split("-")
    .filter(Boolean)
    .map((w) => (w === "htba" ? "HTBA" : w[0].toUpperCase() + w.slice(1)))
    .join(" ") || null;

/**
 * A sale from its title ("2026 Australian Easter Yearling Sale"): the shared
 * key, kind, tier, year and month. `year` and `month` (YYYY-MM) override
 * what the title and the rule say. Null for a sale left out.
 */
export function saleFromTitle(title, { year = null, month = null } = {}) {
  const t = String(title ?? "").replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, "&").trim();
  if (!t) return null;
  const rule = RULES.find(([re]) => re.test(t));
  if (!rule || !rule[1]) return null;
  const [, key, name, type, tier, usual] = rule;
  const y = Number(year) || Number((t.match(/\b(20\d{2})\b/) ?? [])[1]) || (month ? Number(String(month).slice(0, 4)) : null);
  if (!y) return null;
  const m = /^\d{4}-\d{2}$/.test(String(month ?? "")) ? month : `${y}-${pad(usual)}`;
  return { key, name, type, tier, year: y, month: m };
}

const decode = (s) =>
  String(s ?? "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&#8217;|&rsquo;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
const text = (s) => decode(String(s ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** "29, 30 March 2026" / "27, 28 February & 1 March 2022" / "4 - 5 May" -> "YYYY-MM" (the first month named). */
export function monthOf(dates, year = null) {
  const s = text(dates).toLowerCase();
  const y = Number((s.match(/\b(20\d{2})\b/) ?? [])[1]) || Number(year) || null;
  // With two months named, the first one written is where the sale starts.
  const m = s.match(new RegExp(`\\b(${MONTHS.join("|")})\\b`));
  return m && y ? `${y}-${pad(MONTHS.indexOf(m[1]) + 1)}` : null;
}

/**
 * The results listing as sales, `{ id, title, year, month, dates }`, one a
 * card: a link to the sale's page with its title, its dates beside it, and
 * its exports.
 */
export function parseResultsList(html) {
  const out = [];
  for (const card of String(html).split(/<div class="border-b border-blue-700 mb-8 pb-2">/).slice(1)) {
    const link = card.match(/<a href="\/sale\/([a-z0-9-]+)">([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const dates = text((card.match(/<div class="text-sm text-gray-400">([\s\S]*?)<\/div>/) ?? [])[1]);
    const year = yearOfSlug(link[1]);
    if (!year) continue;
    out.push({ id: link[1], title: text(link[2]), year, month: monthOf(dates, year), dates: dates || null });
  }
  return out;
}

/** Whether the results listing has a further page. */
export const hasNextPage = (html) => /nextPage\(\s*'page'\s*\)/.test(String(html));

/**
 * The calendar's sales on the house's own site, `{ id, title, year, month,
 * dates }`: table rows (a link to the sale, then its dates) and catalogue
 * panels (a link, the title, the venue, the dates). Inglis Digital's online
 * sales link elsewhere and are left out.
 */
export function parseCalendar(html) {
  const s = String(html);
  const out = new Map();
  const add = (slug, title, dates) => {
    const year = yearOfSlug(slug);
    if (!year || out.has(slug)) return;
    const t = text(title);
    out.set(slug, { id: slug, title: /^20\d{2}\b/.test(t) ? t : `${year} ${t}`, year, month: monthOf(dates, year), dates: text(dates) || null });
  };
  for (const row of s.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const m = row.match(/<td[^>]*>\s*<a href="(?:https?:\/\/(?:www\.)?inglis\.com\.au)?\/sale\/([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
    if (m) add(m[1], m[2], m[3]);
  }
  const panel = /<a class="catalogue-panel-item"\s+href="(?:https?:\/\/(?:www\.)?inglis\.com\.au)?\/sale\/([a-z0-9-]+)"[\s\S]*?class="font-bold[^"]*">([\s\S]*?)<\/div>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/gi;
  for (const m of s.matchAll(panel)) add(m[1], m[2], m[3]);
  return [...out.values()];
}

/** A sale's own page: its title ("2026 Australian Easter Yearling Sale") and the month it starts. */
export function parseSalePage(html) {
  const s = String(html);
  const title = text((s.match(/<title>([\s\S]*?)<\/title>/i) ?? [])[1]).replace(/\s*-\s*Inglis\s*$/i, "") || null;
  const dates = (s.match(/<p class="[^"]*text-gray-600[^"]*">\s*([^<]*\b20\d{2})\s*<\/p>/) ?? [])[1] ?? null;
  return { title, month: monthOf(dates) };
}

/** "Passed In - Reserve: $350,000" and the rest of the status column, read. */
export function outcomeOf(status, price) {
  const s = String(status ?? "").replace(/\s+/g, " ").trim();
  const amount = money(price);
  if (/^withdrawn/i.test(s)) return { status: "withdrawn", price: null, bid: null };
  if (/^passed in|^psd\b|^not sold|^vendor/i.test(s)) {
    const reserve = s.match(/reserve\b[\s:-]*\$?\s*([\d,]+)/i);
    const bid = s.match(/^(?:passed in|psd)\s*\$\s*([\d,]+)/i);
    return { status: "rna", price: null, bid: money(bid?.[1]) ?? money(reserve?.[1]) };
  }
  if (/^sold/i.test(s)) return amount ? { status: "sold", price: amount, bid: null } : { status: "sold_private", price: null, bid: null };
  if (!s && amount) return { status: "sold", price: amount, bid: null };
  return { status: "catalogued", price: null, bid: null };
}

/** A horse's age by the southern hemisphere's reckoning: everyone a year older on 1 August. */
export function ageAt(foalingYear, saleMonth) {
  const [y, m] = String(saleMonth ?? "").split("-").map(Number);
  if (!foalingYear || !y) return null;
  return y - foalingYear - (m && m < 8 ? 1 : 0);
}

/**
 * What a lot is. The export does not say, so at a sale of one kind every lot
 * is that kind; at a breeding or mixed sale a mare, or a filly in foal, is
 * breeding stock, a young horse is by its age (a weanling, a yearling, an
 * unraced two-year-old), a filly older than that a broodmare prospect, a
 * gelding a racehorse. A colt of racing age there is a stallion or a share
 * in one ("Bivouac - Breeding Right"): null, left out.
 */
export function kindOf({ sex, name, covered, age }, saleType) {
  if (/breeding right|\bshares?\b/i.test(String(name ?? ""))) return null;
  if (saleType === "yearling" || saleType === "foal") return saleType;
  if (saleType === "2yo") return age !== null && age >= 3 ? "hit" : "2yo";
  const s = String(sex ?? "").toLowerCase();
  if (s === "mare" || covered) return "breeding";
  if (age === 0) return "foal";
  if (age === 1) return "yearling";
  if (age === 2 && !name) return "2yo";
  if (s === "filly") return "breeding";
  if (s === "gelding") return "hit";
  return null;
}

const clean = (v) => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t || null;
};
function money(v) {
  if (typeof v === "number") return v > 0 ? v : null;
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
/** "One Kiss (NZ)" -> "One Kiss" */
const bare = (v) => {
  const t = clean(v);
  return t ? t.replace(/\s*\([A-Z]{2,3}\)\s*$/, "").trim() || null : null;
};
/** A date of birth as written ("2024-10-18") or as a spreadsheet serial: the year. */
function yearBorn(v) {
  if (typeof v === "number" && v > 1000 && v < 100000) return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).getUTCFullYear();
  return Number((String(v ?? "").match(/\b(19|20)\d{2}\b/) ?? [])[0]) || null;
}
const SEX = { colt: "colt", horse: "colt", stallion: "colt", rig: "colt", filly: "filly", mare: "filly", gelding: "gelding" };

/** One sale's export (an .xlsx) as lots in the shared shape (sales/normalise.mjs). */
export function parseExport(buf, { id, title = null, month = null } = {}) {
  const slug = String(id ?? "");
  const saleTitle = title ?? titleFromSlug(slug);
  const sale = saleFromTitle(saleTitle, { year: yearOfSlug(slug), month });
  if (!sale) return { id: slug, title: saleTitle, sale: null, lots: [] };
  const rows = readSheet(buf);
  const head = (rows[0] ?? []).map((h) => clean(h)?.toLowerCase() ?? null);
  const at = (name) => head.indexOf(name);
  const col = {
    lot: at("lot"), sex: at("sex"), name: at("name"), vendor: at("vendor"), sire: at("sire"), dam: at("dam"), buyer: at("purchaser name"),
    status: at("status"), price: at("price"), covering: at("covering stallion"), dob: at("dob"),
  };
  const lots = [];
  for (const r of col.lot >= 0 ? rows.slice(1) : []) {
    const lot = clean(r[col.lot]);
    if (!lot || !/^\d+[A-Z]?$/i.test(lot)) continue;
    const born = yearBorn(r[col.dob]);
    const name = bare(r[col.name]);
    const type = kindOf({ sex: clean(r[col.sex]), name: clean(r[col.name]), covered: Boolean(clean(r[col.covering])), age: ageAt(born, sale.month) }, sale.type);
    if (!type) continue;
    const out = outcomeOf(r[col.status], r[col.price]);
    const gbp = out.price ? convert(out.price, "AUD", "GBP", sale.month) : null;
    lots.push({
      source: "inglis",
      company: "Inglis",
      sale_key: sale.key,
      sale_name: sale.name,
      sale_tier: sale.tier,
      sale_label: slug,
      region: "AUS",
      year: sale.year,
      sale_month: sale.month,
      sale_type: type,
      lot: String(Number(lot) || lot),
      horse: name,
      sire: bare(r[col.sire]),
      sire_key: nameKey(r[col.sire]),
      dam: bare(r[col.dam]),
      dam_key: nameKey(r[col.dam]),
      sex: SEX[String(r[col.sex] ?? "").trim().toLowerCase()] ?? null,
      foaling_year: born,
      vendor: clean(r[col.vendor]),
      buyer: out.status === "sold" || out.status === "sold_private" ? clean(r[col.buyer]) : null,
      status: out.status,
      price: out.price,
      bid: out.bid,
      currency: "AUD",
      price_gbp: gbp === null ? null : Math.round(gbp),
    });
  }
  return { id: slug, title: saleTitle, sale, lots };
}

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

async function get(url, fetchImpl, accept) {
  const res = await fetchImpl(url, { headers: { "user-agent": UA, accept }, redirect: "follow", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Inglis ${url}: HTTP ${res.status}`);
  return res;
}

/**
 * The house's thoroughbred sales of a year: those with results (the results
 * listing, searched by year, page by page) and those to come (the calendar),
 * each with the slug its results are read by.
 */
export async function discover({ year, fetchImpl = fetch, pauseMs = 1000 } = {}) {
  const y = Number(year);
  const found = new Map();
  for (let page = 1; page <= 10; page += 1) {
    const html = await (await get(resultsUrl(y, page), fetchImpl, "text/html")).text();
    const cards = parseResultsList(html);
    for (const c of cards) if (c.year === y && !found.has(c.id)) found.set(c.id, c);
    await sleep(pauseMs);
    if (!cards.length || !hasNextPage(html)) break;
  }
  const calendar = await (await get(CALENDAR_URL, fetchImpl, "text/html")).text();
  for (const c of parseCalendar(calendar)) if (c.year === y && !found.has(c.id)) found.set(c.id, c);
  const out = [];
  for (const c of found.values()) {
    const sale = saleFromTitle(c.title, { year: c.year, month: c.month });
    if (sale) out.push({ id: c.id, title: c.title, key: sale.key, name: sale.name, type: sale.type, tier: sale.tier, month: sale.month, year: sale.year });
  }
  return out.sort((a, b) => String(a.month).localeCompare(String(b.month)) || a.id.localeCompare(b.id));
}

/**
 * One sale's results, by its slug. Pass the sale's entry from discover() as
 * `info` (or its `title` and `month`) to save a request; without them the
 * sale's page is read for them.
 */
export async function fetchSale(id, { fetchImpl = fetch, info = null, title = info?.title ?? null, month = info?.month ?? null, pauseMs = 1000 } = {}) {
  const slug = String(id ?? "");
  if (!yearOfSlug(slug)) throw new Error(`not an Inglis sale: ${id}`);
  let known = { title, month };
  if (!title || !month) {
    const page = parseSalePage(await (await get(salePageUrl(slug), fetchImpl, "text/html")).text());
    known = { title: title ?? page.title, month: month ?? page.month };
    await sleep(pauseMs);
  }
  const res = await get(exportUrl(slug), fetchImpl, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    const t = known.title ?? titleFromSlug(slug);
    return { id: slug, title: t, sale: saleFromTitle(t, { year: yearOfSlug(slug), month: known.month }), lots: [] };
  }
  return parseExport(buf, { id: slug, title: known.title, month: known.month });
}

export default {
  exportUrl, salePageUrl, resultsUrl, CALENDAR_URL, yearOfSlug, titleFromSlug, saleFromTitle, monthOf, parseResultsList, hasNextPage, parseCalendar,
  parseSalePage, outcomeOf, ageAt, kindOf, parseExport, discover, fetchSale,
};
