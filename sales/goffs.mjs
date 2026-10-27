/**
 * Goffs and Goffs UK: every sale's results, as the results notebook writes them.
 *
 * Goffs's site (goffs.com) does not answer this server: Cloudflare turns its
 * requests away. Its results are read wherever the site does answer, by the
 * user's notebook (goffs_sale_results.ipynb: the year's results index, each
 * sale's results table, cleaned), and sent here as the CSV it writes, one row
 * per lot: year, region (IRE, UK, GoffsGo), sale_title, lot, sire, dam,
 * foaled, colour, sex, consignor, status (Sold, RNA, Not Sold, Withdrawn,
 * Unknown), purchaser, price, rna_price, currency, sale_url, then the page's
 * own columns as raw_*. pandas writes a missing number as an empty field and
 * a whole number with a gap in its column as "2024.0"; both are read here.
 *
 * Which sale a lot is, from the sale's title: the yearling sales keep the
 * keys the European workbook gives them (sales/normalise.mjs), so the house's
 * reading replaces the workbook's; the rest are defined here. What a lot is
 * (foal, yearling, two-year-old, horse in training, breeding stock) comes
 * from the sale, and at the mixed sales from its age and sex. The jumps
 * sales sell unbroken stores and pointers that fit none of the market's
 * kinds, so only their foals are kept, as at Tattersalls Ireland.
 */
import { nameKey, sexOf } from "./normalise.mjs";
import { convert } from "./fx.mjs";

/* ---------------------------------------------------------------- CSV */

/** CSV as written by pandas (RFC 4180: quoted fields may hold commas, quotes doubled, line breaks). */
export function parseCsv(text) {
  const s = String(text ?? "").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
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
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.some((v) => v.trim() !== ""));
  if (!head) return [];
  const names = head.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i] ?? ""])));
}

/* -------------------------------------------------------------- sales */

/**
 * The house's sales, by title: key, name, what it sells, tier, the month it
 * is held. `type` is yearling, foal or 2yo where the sale sells only those;
 * "hit" for the horses-in-training sales; "mixed" for the flat sales that
 * mix foals, yearlings, horses in training and breeding stock; "jumps" for
 * the National Hunt sales; "other" for a sale not known here.
 */
const UK_SALES = [
  [/premier/i, { key: "GUK-PREM", name: "Goffs UK Premier Yearlings", type: "yearling", tier: 2, month: 8 }],
  [/silver/i, { key: "GUK-SILVER", name: "Goffs UK Silver Yearlings", type: "yearling", tier: 3, month: 8 }],
  [/breeze/i, { key: "GUK-BRZ", name: "Goffs UK Breeze Up", type: "2yo", tier: 3, month: 4 }],
  [/aintree|cheltenham|spring|august|january|jumps|national hunt|\bnh\b|point|p2p|store/i, { key: "GUK-NH", name: "Goffs UK National Hunt", type: "jumps", tier: 3, month: null }],
  [/horses in training|\bhit\b|autumn/i, { key: "GUK-HIT", name: "Goffs UK Horses in Training", type: "hit", tier: 3, month: 10 }],
];

const IRE_SALES = [
  [/orby.*book 2|book 2/i, { key: "GOF-ORBY2", name: "Goffs Orby Book 2", type: "yearling", tier: 2, month: 10 }],
  [/orby/i, { key: "GOF-ORBY", name: "Goffs Orby", type: "yearling", tier: 1, month: 9 }],
  [/sportsman/i, { key: "GOF-SPORT", name: "Goffs Sportsman's", type: "yearling", tier: 3, month: 10 }],
  [/open yearling/i, { key: "GOF-OPEN", name: "Goffs Open Yearlings", type: "yearling", tier: 3, month: null }],
  [/autumn yearling/i, { key: "GOF-AUT", name: "Goffs Autumn Yearlings", type: "yearling", tier: 3, month: null }],
  [/premier yearling/i, { key: "GUK-PREM", name: "Goffs UK Premier Yearlings", type: "yearling", tier: 2, month: 8, company: "Goffs UK" }],
  [/foal/i, { key: "GOF-FOAL", name: "Goffs November Foals", type: "foal", tier: 2, month: 11 }],
  [/breeding stock|\bmares?\b/i, { key: "GOF-BS", name: "Goffs Breeding Stock", type: "mixed", tier: 3, month: 11 }],
  [/february/i, { key: "GOF-FEB", name: "Goffs February", type: "mixed", tier: 3, month: 2 }],
  [/london/i, { key: "GOF-LONDON", name: "Goffs London", type: "hit", tier: 2, month: 6 }],
  [/\barc\b/i, { key: "GOF-ARC", name: "Goffs Arc", type: "mixed", tier: 2, month: 10 }],
  [/horses in training|\bhit\b/i, { key: "GOF-HIT", name: "Goffs Horses in Training", type: "hit", tier: 3, month: null }],
  [/land rover|arkle|derby|store|december|national hunt|\bnh\b|champions|thyestes|punchestown|aintree|cheltenham|point|p2p|jumps/i, { key: "GOF-NH", name: "Goffs National Hunt", type: "jumps", tier: 3, month: null }],
];

const ONLINE = { key: "GOF-ONLINE", name: "Goffs Online", type: "other", tier: 3, month: null };
const OTHER = { key: "GOF-OTHER", name: "Goffs (other sales)", type: "other", tier: 3, month: null };
const UK_OTHER = { key: "GUK-OTHER", name: "Goffs UK (other sales)", type: "other", tier: 3, month: null };

/** A title as words: a page saved from the browser is named "orby-sale-2025" or "orby_sale_2025". */
const words = (title) => String(title ?? "").replace(/[-_]+/g, " ");

/** Where a sale was held, from the region the notebook gives, its page or its title. */
export function regionOf(region, url, title) {
  const r = String(region ?? "").trim().toUpperCase();
  if (["IRE", "UK", "GOFFSGO", "FRA"].includes(r)) return r === "GOFFSGO" ? "GoffsGo" : r;
  const m = String(url ?? "").match(/\/sale\/(IRE|UK|GoffsGo|FRA)\//i);
  if (m) return m[1].toUpperCase() === "GOFFSGO" ? "GoffsGo" : m[1].toUpperCase();
  if (/goffs ?go|online/i.test(words(title))) return "GoffsGo";
  if (/goffs uk|doncaster|premier|silver|breeze/i.test(words(title))) return "UK";
  return "IRE";
}

/** A sale from its title and where it was held. */
export function saleFromTitle(title, region = "IRE") {
  const t = words(title);
  if (region === "GoffsGo") return { ...ONLINE, company: "Goffs" };
  if (region === "UK") {
    const hit = UK_SALES.find(([re]) => re.test(t));
    return { ...(hit ? hit[1] : UK_OTHER), company: "Goffs UK" };
  }
  const hit = IRE_SALES.find(([re]) => re.test(t));
  return { company: "Goffs", ...(hit ? hit[1] : OTHER) };
}

/** The sale's year: the index year the notebook read it from, else the year in its title or page. */
export function yearOf(row, fallback = null) {
  const n = Math.trunc(Number(row.year));
  if (n >= 1990 && n <= 2100) return n;
  for (const s of [row.sale_title, row.sale_url]) {
    const m = String(s ?? "").match(/\b(19[9]\d|20\d{2})\b/);
    if (m) return Number(m[1]);
  }
  return fallback;
}

/**
 * What a lot is, from the sale and the lot's age and sex. A sale of one
 * kind is that kind, unless the lot is a mare (the foal sales sell some
 * breeding stock too); at the mixed sales a foal or a yearling is read
 * from its age, a mare as breeding stock, and an older horse as in
 * training; at the jumps sales only a foal is kept; at a sale not known
 * here, an older horse is left out rather than guessed.
 */
export function kindOf(sale, age, mare = false) {
  if (["yearling", "foal", "2yo"].includes(sale.type) && !mare && (age === null || age <= 2)) return sale.type;
  if (age === 0) return "foal";
  if (sale.type === "jumps") return null;
  if (age === 1) return "yearling";
  if (sale.type === "hit") return "hit";
  if (mare) return "breeding";
  if (sale.type === "mixed" && age >= 2) return "hit";
  return null;
}

/* -------------------------------------------------------------- lots */

const str = (v) => {
  const s = String(v ?? "").trim();
  return s && !/^(nan|none|null)$/i.test(s) ? s : null;
};
const num = (v) => {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const whole = (v) => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};
const CURRENCIES = ["EUR", "GBP", "USD", "GNS"];

/**
 * What became of a lot, from the notebook's status: sold with its price,
 * bought back with the last bid (in brackets after "Vendor", or the price
 * the page showed), not sold, or withdrawn. A row it could not read is
 * read here again from the price and the buyer.
 */
export function outcomeOf(row) {
  const status = String(row.status ?? "").trim().toLowerCase();
  const price = num(row.price);
  const bid = num(row.rna_price);
  const buyer = str(row.purchaser);
  if (status === "withdrawn") return { status: "withdrawn", price: null, bid: null, buyer: null };
  if (status === "rna") return { status: "rna", price: null, bid: bid ?? price, buyer: null };
  if (status === "not sold") return bid ?? price ? { status: "rna", price: null, bid: bid ?? price, buyer: null } : { status: "unsold", price: null, bid: null, buyer: null };
  if (status === "sold") return price > 0 ? { status: "sold", price, bid: null, buyer } : { status: "sold_private", price: null, bid: null, buyer };
  if (price > 0 && buyer && !/^vendor\b/i.test(buyer)) return { status: "sold", price, bid: null, buyer };
  return { status: "unknown", price: null, bid: null, buyer: null };
}

/** The sale's own label: its page on goffs.com where the notebook read it, else its title. */
export function labelOf(row) {
  const m = String(row.sale_url ?? "").match(/\/sale\/([^?#]+)/i);
  return (m ? m[1].replace(/\/+$/, "") : str(row.sale_title)) ?? null;
}

/**
 * The notebook's rows as lots in the shared shape (sales/normalise.mjs),
 * and what was made of each sale: its key, year, how many lots were read
 * and sold, and how many were left out (jumps stores, an older horse at a
 * sale not known here, a row with no dam). `year` is the year to use for
 * a sale whose year neither the notebook nor its title gives.
 */
export function fromNotebookRows(rows, { year = null } = {}) {
  const lots = [];
  const sales = new Map();
  const problems = [];
  const horseCol = rows.length ? Object.keys(rows[0]).find((k) => /^raw_(horse|name|horse name)$/i.test(k)) : null;
  for (const row of rows) {
    const title = str(row.sale_title);
    const region = regionOf(row.region, row.sale_url, title);
    const y = yearOf(row, year);
    const label = labelOf(row) ?? "(no title)";
    if (!y) {
      if (!problems.some((p) => p.sale === label)) problems.push({ sale: label, problem: "no year: give it as ?year=" });
      continue;
    }
    const sale = saleFromTitle(title, region);
    const id = `${label}|${y}`;
    const entry = sales.get(id) ?? { title, label, key: sale.key, name: sale.name, year: y, lots: 0, sold: 0, leftOut: 0 };
    sales.set(id, entry);
    const dam = str(row.dam);
    const foaled = whole(row.foaled);
    const age = foaled ? y - foaled : null;
    const sexWord = str(row.sex);
    const type = kindOf(sale, age, /mare/i.test(sexWord ?? ""));
    if (!type || !dam) {
      entry.leftOut += 1;
      continue;
    }
    const out = outcomeOf(row);
    const ccy = String(row.currency ?? "").trim().toUpperCase();
    const currency = CURRENCIES.includes(ccy) ? ccy : sale.company === "Goffs UK" ? "GBP" : "EUR";
    const month = sale.month ? `${y}-${String(sale.month).padStart(2, "0")}` : null;
    const gbp = out.price ? convert(out.price, currency, "GBP", month ?? String(y)) : null;
    const lotNo = whole(row.lot);
    lots.push({
      source: "goffs",
      company: sale.company,
      sale_key: sale.key,
      sale_name: sale.name,
      sale_tier: sale.tier,
      sale_label: label,
      region: "EU",
      year: y,
      sale_month: month,
      sale_type: type,
      lot: lotNo === null ? str(row.lot) : String(lotNo),
      horse: horseCol ? str(row[horseCol]) : null,
      sire: str(row.sire),
      sire_key: nameKey(row.sire) || null,
      dam,
      dam_key: nameKey(dam),
      sex: /mare/i.test(sexWord ?? "") ? "filly" : sexOf(sexWord),
      foaling_year: foaled ?? (type === "foal" ? y : type === "yearling" ? y - 1 : type === "2yo" ? y - 2 : null),
      vendor: str(row.consignor),
      buyer: out.status === "sold" || out.status === "sold_private" ? out.buyer : null,
      status: out.status,
      price: out.price,
      bid: out.bid,
      currency,
      price_gbp: gbp === null ? null : Math.round(gbp),
    });
    entry.lots += 1;
    if (out.status === "sold") entry.sold += 1;
  }
  return { lots, sales: [...sales.values()], problems };
}

/** The notebook's CSV, read and turned into lots. */
export function fromNotebookCsv(text, opts = {}) {
  const rows = parseCsv(text);
  return { rows: rows.length, ...fromNotebookRows(rows, opts) };
}

export default { parseCsv, regionOf, saleFromTitle, yearOf, kindOf, outcomeOf, labelOf, fromNotebookRows, fromNotebookCsv };
