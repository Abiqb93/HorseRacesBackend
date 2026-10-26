/**
 * Magic Millions, Gold Coast: every sale's results, from the house's own export.
 *
 * Each sale has a code, the year's last two digits and three letters (26GPR
 * is the Gold Coast Yearling Sale of 2026, 25GWW the National Weanling Sale
 * of 2025), and its results are the online catalogue's "CSV/Excel" export at
 * catalogue.magicmillions.com.au/csv/<code>.csv: a header row, then one row a
 * lot — lot number, book, vendor, name, colour, sex (C, F, G, M, R), date of
 * birth, sire, dam, the time it sold, buyer, buyer's location, price, and
 * what it is (Yearling, Weanling, 2YO, 3YO, Broodmare, RF a racing filly or
 * mare, RH a racehorse, SH a share in a stallion). A lot passed in has its
 * last bid and the vendor's reserve where the buyer goes ("Psd $100000 Res
 * $120000") and no price; a lot withdrawn has "withdrawn" for its price; a
 * lot not yet offered has neither. The house does not mark a lot sold after
 * the ring: a deal done after a lot passed in reads as a sale like any other,
 * and the house's own totals count it so.
 *
 * The sales and their codes are listed year by year and month by month at
 * www.magicmillions.com.au/sales-list/, back to 2010; a sale listed without
 * a catalogue link has no results to read.
 *
 * Prices are Australian dollars as the hammer fell, kept as published: the
 * figure is the bid, and GST, where the vendor is registered for it, is
 * invoiced on top.
 */
import { nameKey } from "./normalise.mjs";
import { convert } from "./fx.mjs";

const UA = "BlandfordBloodstock/1.0 (sales results; +https://www.blandfordbloodstock.tech)";
export const SALES_LIST_URL = "https://www.magicmillions.com.au/sales-list/";
export const csvUrl = (code) => `https://catalogue.magicmillions.com.au/csv/${encodeURIComponent(code)}.csv`;

/*
 * The house's sales: title -> the shared key, what it sells, its tier and
 * usual month (used only when neither the list nor the export dates it).
 * The yearling keys are the workbook's (sales/normalise.mjs), so a sale-year
 * read here replaces the workbook's reading of it. New here:
 *   MM-PER-WINTER  Perth Winter Yearling Sale
 *   MM-ADL-MAY     Adelaide May Yearling Sale (2017-2018)
 *   MM-QTIS        QTIS (600) Yearling Sale (2010-2013)
 *   MM-WEAN        Gold Coast National Weanling Sale
 *   MM-BROOD       Gold Coast National Broodmare Sale
 *   MM-2YO         Gold Coast 2YOs / Horses In Training Sale (the breeze-up sale)
 *   MM-RACE        Gold Coast racehorse sales (Summer, National, Spring, Autumn)
 *   MM-NT          Northern Territory tried horse sales (Darwin, Alice Springs)
 *   MM-PER-MIXED   Perth Winter Thoroughbred / Weanling / Racehorse sales
 *   MM-ONLINE      online and virtual sales held in the catalogue
 *   MM-OTHER       monthly, mixed and dispersal sales
 */
const RULES = [
  [/fundraiser|estate of the late/i, null],
  [/march yearling/i, "MM-MARCH", "Magic Millions Gold Coast March", "yearling", 3, 3],
  [/national yearling/i, "MM-NAT", "Magic Millions National", "yearling", 3, 6],
  [/gold coast yearling/i, "MM-GC", "Magic Millions Gold Coast", "yearling", 1, 1],
  [/perth winter yearling/i, "MM-PER-WINTER", "Magic Millions Perth Winter Yearlings", "yearling", 3, 6],
  [/perth yearling/i, "MM-PER", "Magic Millions Perth", "yearling", 3, 2],
  [/adelaide may yearling/i, "MM-ADL-MAY", "Magic Millions Adelaide May Yearlings", "yearling", 3, 5],
  [/adelaide yearling/i, "MM-ADL", "Magic Millions Adelaide", "yearling", 3, 3],
  [/tasmanian (?:select )?yearling/i, "MM-TAS", "Magic Millions Tasmania", "yearling", 3, 2],
  [/capricornia/i, "MM-CAP", "Magic Millions Capricornia", "yearling", 3, 4],
  [/qtis.*yearling/i, "MM-QTIS", "Magic Millions QTIS Yearlings", "yearling", 3, 3],
  [/online|virtual/i, "MM-ONLINE", "Magic Millions Online", "mixed", 3, null],
  [/perth/i, "MM-PER-MIXED", "Magic Millions Perth Mixed", "mixed", 3, 6],
  [/broodmare/i, "MM-BROOD", "Magic Millions National Broodmare", "breeding", 1, 5],
  [/weanling/i, "MM-WEAN", "Magic Millions National Weanling", "foal", 1, 5],
  [/2\s?yo|breeze|gold coast horses in training/i, "MM-2YO", "Magic Millions Gold Coast Horses in Training", "2yo", 1, 10],
  [/tried horse/i, "MM-NT", "Magic Millions Northern Territory Tried Horses", "hit", 3, 7],
  [/racehorse|horses in training/i, "MM-RACE", "Magic Millions Racehorses", "hit", 2, 6],
  [/monthly|mixed|thoroughbred|bloodstock|dispersal|reduction|catwalk|sale series/i, "MM-OTHER", "Magic Millions (other sales)", "mixed", 3, null],
];

/** The usual title for a code, for a sale the list does not name. */
const CODE_TITLES = {
  GPR: "Gold Coast Yearling Sale",
  GQR: "Gold Coast March Yearling Sale",
  GWY: "Gold Coast National Yearling Sale",
  APR: "Adelaide Yearling Sale",
  PPR: "Perth Yearling Sale",
  TSY: "Tasmanian Yearling Sale",
  RPR: "Capricornia Yearling Sale",
  PMY: "Perth Winter Yearling Sale",
  PSS: "Perth Winter Thoroughbred Sale",
  GWW: "Gold Coast National Weanling Sale",
  GWM: "Gold Coast National Broodmare Sale",
  GRT: "Gold Coast Horses In Training Sale",
  DRS: "TRNT Select Tried Horse Sale (Darwin)",
  ARS: "TRNT Select Tried Horse Sale (Alice Springs)",
  VMA: "August Virtual Sale",
};

/** "26GPR" -> 2026 */
export const yearOfCode = (code) => {
  const m = String(code ?? "").match(/^(\d{2})[A-Z0-9]{3}$/i);
  return m ? 2000 + Number(m[1]) : null;
};

/** A title for a code the list does not give, from the house's usual names. */
export function titleForCode(code) {
  const year = yearOfCode(code);
  const t = CODE_TITLES[String(code ?? "").slice(2).toUpperCase()];
  return year && t ? `${year} ${t}` : null;
}

const pad = (m) => String(m).padStart(2, "0");

/**
 * A sale from its title ("2026 Gold Coast Yearling Sale"): the shared key,
 * kind, tier, year and month. `year` and `month` (YYYY-MM) override what the
 * title and the rule say. Null for a sale left out.
 */
export function saleFromTitle(title, { year = null, month = null } = {}) {
  const t = String(title ?? "").replace(/&#0?38;|&amp;/g, "&").trim();
  if (!t) return null;
  const rule = RULES.find(([re]) => re.test(t));
  if (!rule || !rule[1]) return null;
  const [, key, name, type, tier, usual] = rule;
  const y = Number(year) || Number((t.match(/\b(20\d{2})\b/) ?? [])[1]) || (month ? Number(String(month).slice(0, 4)) : null);
  if (!y) return null;
  const m = /^\d{4}-\d{2}$/.test(String(month ?? "")) ? month : usual ? `${y}-${pad(usual)}` : null;
  return { key, name, type, tier, year: y, month: m };
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const decode = (s) =>
  String(s ?? "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&#0?38;|&amp;/g, "&")
    .replace(/&#0?39;|&#8217;|&rsquo;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
const text = (s) => decode(String(s ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/**
 * The sales list page as sales: one entry for each sale with a catalogue,
 * `{ id, title, year, month, dates }`. The page is a block a year (an h2),
 * a list a month (an h3), an item a sale: "<span>13th - 18th</span> -- Gold
 * Coast Yearling Sale" and, once the catalogue is out, a link to it.
 */
export function parseSalesList(html) {
  const out = [];
  for (const block of String(html).split(/<div class="sales-list-year">/).slice(1)) {
    const year = Number((block.match(/sales-list-year-title">\s*(\d{4})/) ?? [])[1]);
    if (!year) continue;
    for (const part of block.split(/<h3>/).slice(1)) {
      const monthName = text(part.slice(0, part.indexOf("</h3>"))).toLowerCase();
      const mi = MONTHS.indexOf(monthName);
      for (const li of part.match(/<li>[\s\S]*?<\/li>/g) ?? []) {
        const code = (li.match(/catalogue\.magicmillions\.com\.au\/sale\/(\d{2}[A-Z0-9]{3})\b/i) ?? [])[1];
        if (!code) continue;
        const first = (li.match(/<a [^>]*>([\s\S]*?)<\/a>/) ?? [])[1] ?? "";
        const dates = text((first.match(/<span>([\s\S]*?)<\/span>/) ?? [])[1]);
        const name = text(first.replace(/<span>[\s\S]*?<\/span>/, "")).replace(/^-+\s*/, "");
        out.push({ id: code.toUpperCase(), title: `${year} ${name}`, year, month: mi >= 0 ? `${year}-${pad(mi + 1)}` : null, dates: dates || null });
      }
    }
  }
  return out;
}

/** A CSV text as rows of strings: quoted fields, doubled quotes, line breaks inside quotes. */
export function parseCsv(input) {
  const s = String(input ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v !== ""));
}

/** What a lot is, from the export's "type". Null for a share in a stallion, and for a lot of no stated kind at a mixed sale. */
export function kindOf(type, saleType) {
  const t = String(type ?? "").trim().toUpperCase();
  if (t === "YEARLING") return "yearling";
  if (t === "WEANLING" || t === "FOAL") return "foal";
  if (t === "2YO") return "2yo";
  if (t === "BROODMARE") return "breeding";
  if (/^(?:RF|RH|RACEHORSE|HIT|[3-9]YO|\d{2}YO)$/.test(t)) return "hit";
  if (t === "SH") return null;
  return saleType === "mixed" ? null : saleType;
}

const clean = (v) => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t || null;
};
const money = (v) => {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * What became of a lot, from the buyer and price columns: sold (a price),
 * passed in ("Psd $100000 Res $120000": the last bid, else the reserve, as
 * its bid), withdrawn ("withdrawn" for a price), or still to come (neither).
 */
export function outcomeOf(buyer, price) {
  const b = clean(buyer) ?? "";
  const p = clean(price) ?? "";
  if (/^withdrawn$/i.test(p) || /^withdrawn$/i.test(b)) return { status: "withdrawn", price: null, bid: null };
  const psd = b.match(/^(?:psd|passed in)\b[\s:-]*\$?\s*([\d,]*)(?:.*?\bres(?:erve)?\b[\s:-]*\$?\s*([\d,]+))?/i);
  if (psd) return { status: "rna", price: null, bid: money(psd[1]) ?? money(psd[2]) };
  const amount = money(p);
  if (amount) return { status: "sold", price: amount, bid: null };
  if (b) return { status: "sold_private", price: null, bid: null };
  return { status: "catalogued", price: null, bid: null };
}

const SEX = { C: "colt", H: "colt", R: "colt", S: "colt", F: "filly", M: "filly", G: "gelding" };
/** "Field of Daysees (AUS)" -> "Field of Daysees" */
const bare = (v) => {
  const t = clean(v);
  return t ? t.replace(/\s*\([A-Z]{2,3}\)\s*$/, "").trim() || null : null;
};
/** "13/01/2026 11:01" -> "2026-01" */
const monthOfDate = (v) => {
  const m = String(v ?? "").match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${pad(m[2])}` : null;
};

/**
 * One sale's export as lots in the shared shape (sales/normalise.mjs).
 * `title` is the sale's own ("2026 Gold Coast Yearling Sale"), `month` the
 * one the list files it under; without them the code's usual title and the
 * export's own sale dates serve.
 */
export function parseResults(csvText, { id, title = null, month = null } = {}) {
  const code = String(id ?? "").toUpperCase();
  const saleTitle = title ?? titleForCode(code);
  const rows = parseCsv(csvText);
  const head = (rows[0] ?? []).map((h) => String(h).trim().toLowerCase());
  const at = (name) => head.indexOf(name);
  const col = {
    lot: at("lot number"), vendor: at("vendor"), name: at("lot name"), sex: at("sex"), dob: at("dob"), sire: at("sire"), dam: at("dam"),
    date: at("sale date"), buyer: at("buyer"), price: at("price"), type: at("type"),
  };
  const body = col.lot >= 0 ? rows.slice(1) : [];
  // The month it sold in, when the list does not say: its earliest sale time.
  const dated = body.map((r) => monthOfDate(r[col.date])).filter(Boolean).sort();
  const sale = saleFromTitle(saleTitle, { year: yearOfCode(code), month: month ?? dated[0] ?? null });
  if (!sale) return { id: code, title: saleTitle, sale: null, lots: [] };
  const lots = [];
  for (const r of body) {
    const lot = clean(r[col.lot]);
    if (!lot || !/^\d+[A-Z]?$/i.test(lot)) continue;
    const type = kindOf(r[col.type], sale.type);
    if (!type) continue;
    const out = outcomeOf(r[col.buyer], r[col.price]);
    const born = (String(r[col.dob] ?? "").match(/(\d{4})\s*$/) ?? [])[1];
    const when = sale.month ?? String(sale.year);
    const gbp = out.price ? convert(out.price, "AUD", "GBP", when) : null;
    lots.push({
      source: "magicmillions",
      company: "Magic Millions",
      sale_key: sale.key,
      sale_name: sale.name,
      sale_tier: sale.tier,
      sale_label: code,
      region: "AUS",
      year: sale.year,
      sale_month: sale.month,
      sale_type: type,
      lot: String(Number(lot) || lot),
      horse: bare(r[col.name]),
      sire: bare(r[col.sire]),
      sire_key: nameKey(r[col.sire]),
      dam: bare(r[col.dam]),
      dam_key: nameKey(r[col.dam]),
      sex: SEX[String(r[col.sex] ?? "").trim().toUpperCase()] ?? null,
      foaling_year: born ? Number(born) : null,
      vendor: clean(r[col.vendor]),
      buyer: out.status === "sold" || out.status === "sold_private" ? clean(r[col.buyer]) : null,
      status: out.status,
      price: out.price,
      bid: out.bid,
      currency: "AUD",
      price_gbp: gbp === null ? null : Math.round(gbp),
    });
  }
  return { id: code, title: saleTitle, sale, lots };
}

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

async function getText(url, fetchImpl, accept) {
  const res = await fetchImpl(url, { headers: { "user-agent": UA, accept }, redirect: "follow", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Magic Millions ${url}: HTTP ${res.status}`);
  return res.text();
}

/** The house's thoroughbred sales of a year that have a catalogue, with the code their results are read by. */
export async function discover({ year, fetchImpl = fetch } = {}) {
  const y = Number(year);
  const html = await getText(SALES_LIST_URL, fetchImpl, "text/html");
  const out = [];
  for (const s of parseSalesList(html)) {
    if (s.year !== y) continue;
    const sale = saleFromTitle(s.title, { year: s.year, month: s.month });
    if (sale) out.push({ id: s.id, title: s.title, key: sale.key, name: sale.name, type: sale.type, tier: sale.tier, month: sale.month, year: sale.year });
  }
  return out;
}

/**
 * One sale's results, by its code. Pass the sale's entry from discover() as
 * `info` (or its `title` and `month`) to save a request; without them the
 * sales list is read for them.
 */
export async function fetchSale(id, { fetchImpl = fetch, info = null, title = info?.title ?? null, month = info?.month ?? null, pauseMs = 1000 } = {}) {
  const code = String(id ?? "").toUpperCase();
  if (!yearOfCode(code)) throw new Error(`not a Magic Millions sale code: ${id}`);
  let known = { title, month };
  if (!title) {
    const listed = parseSalesList(await getText(SALES_LIST_URL, fetchImpl, "text/html")).find((s) => s.id === code);
    known = { title: listed?.title ?? null, month: month ?? listed?.month ?? null };
    await sleep(pauseMs);
  }
  const csv = await getText(csvUrl(code), fetchImpl, "text/csv");
  // A code with no sale behind it comes back as a page, not an export: no lots.
  if (!/^\uFEFF?"?lot number"?,/i.test(csv.trimStart())) return { id: code, title: known.title ?? titleForCode(code), sale: null, lots: [] };
  return parseResults(csv, { id: code, title: known.title, month: known.month });
}

export default { SALES_LIST_URL, csvUrl, yearOfCode, titleForCode, saleFromTitle, parseSalesList, parseCsv, kindOf, outcomeOf, parseResults, discover, fetchSale };
