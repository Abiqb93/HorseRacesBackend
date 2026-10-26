/**
 * Keeneland, Lexington: every sale's results, from the house's own sale
 * summaries (flex.keeneland.com/summaries/summaries.html).
 *
 * The summaries page is backed by public calls on flex.keeneland.com:
 *
 *   misc/GenerateJson.do?actionName=SalesSummarySales — every sale since
 *     2010: its id, title ("2025 September Yearling Sale"), first and last
 *     day, number of sessions. The id is the house's fiscal sale code: the
 *     year the sales season ends, then the sale (02 September, 03 November
 *     breeding stock, 04 January, 05 April, 06 November horses of racing
 *     age, 07 the Championship sale), so 202602 is September 2025 and
 *     202604 is January 2026.
 *   misc/GenerateJson.do?actionName=SalesSummary (sale id, session 0 for
 *     all) — one row a hip: sex, name, sire, dam, consignor, buyer, price,
 *     an out indicator, and an RNA indicator (Y: bought back, the last bid
 *     written in the buyer column as "R.N.A. (60,000)"; P: sold privately
 *     after it left the ring, with the buyer and the price).
 *   report/Run.do?xml=WebSummaryPagesCSV.do... — the same page as CSV,
 *     with each hip's date of birth and what it was sold as ("Weanling",
 *     "Yearling", "Broodmare", "Racing or Stallion Prospect"). The summary
 *     has no age, so at the mixed sales it is read too.
 *   misc/GenerateJson.do?actionName=SalesSummaryComparativeResultsNew —
 *     the house's own totals (head sold, gross, median), kept beside the
 *     lots so each import can be checked against them. The house's head
 *     count leaves out the private sales after the ring.
 *
 * The house's newer sales pages (www.keeneland.com/json/sale_api/get and
 * catalog-backend.keeneland.com) only hold the sales from 2025 on; the
 * summaries go back to 2010. A sale is in the summaries from its first
 * session: before then it has no rows, and while it runs the hips still to
 * come through the ring read as catalogued.
 *
 * Keeneland has not held a two-year-olds in training sale since 2019; its
 * April sale is now one of horses of racing age, which goes with the
 * Championship sale and the November horses of racing age under
 * KEE-OTHER. Stallion seasons and shares sold at the Championship sale
 * (sold as "S" or "C") are not horses and are left out.
 */
import { nameKey, sexOf } from "./normalise.mjs";
import { convert } from "./fx.mjs";

export const FLEX = "https://flex.keeneland.com";
const DELIM = "^!^";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export const salesUrl = () => `${FLEX}/misc/GenerateJson.do?${new URLSearchParams({ actionName: "SalesSummarySales", paramNames: "", paramValues: "" })}`;
export const summaryUrl = (id) =>
  `${FLEX}/misc/GenerateJson.do?${new URLSearchParams({ actionName: "SalesSummary", paramNames: `sale_id${DELIM}session`, paramValues: `${id}${DELIM}0` })}`;
export const totalsUrl = (id) =>
  `${FLEX}/misc/GenerateJson.do?${new URLSearchParams({ actionName: "SalesSummaryComparativeResultsNew", paramNames: `sale_id${DELIM}session_number`, paramValues: `${id}${DELIM}0` })}`;
export const csvUrl = (id) =>
  `${FLEX}/report/Run.do?${new URLSearchParams({
    xml: "WebSummaryPagesCSV.do", xsl: "WebSummaryPagesCSVMixed.xsl", mimeType: "TXT", contentType: "text/csv", fileName: "WebSummaryPagesCSV.csv",
    saleId: id, sortOrder: "hip", csvFlag: "true", session: "0", buyerFilter: "", sireFilter: "", nameFilter: "", damFilter: "", consignorFilter: "",
    rnaFilter: "", outFilter: "", hipFilter: "", sexFilter: "", priceFilter: "", filterType: "C", sortDirection: "A", reportName: "WebSummaryPagesCSV",
  })}`;

const clean = (s) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t || null;
};
/** "65,000" -> 65000; "---", "Out", "" -> null. */
const money = (s) => {
  const t = String(s ?? "").trim();
  if (!/^\$?[\d,]+(\.\d+)?$/.test(t)) return null;
  const n = Number(t.replace(/[$,]/g, ""));
  return n > 0 ? n : null;
};
const pad = (m) => String(m).padStart(2, "0");
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const monthIn = (t) => {
  const i = MONTHS.findIndex((m) => new RegExp(`\\b${m}\\b`, "i").test(t));
  return i >= 0 ? i + 1 : null;
};
/** "09/08/2025" or "2025-09-08" -> { year, month } */
function dayOf(s) {
  const t = String(s ?? "");
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return { year: Number(m[3]), month: Number(m[1]), iso: `${m[3]}-${pad(m[1])}-${pad(m[2])}` };
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { year: Number(m[1]), month: Number(m[2]), iso: m[0] };
  return null;
}

/** The house's sales: title -> key, name, what it sells, tier (as sales/normalise.mjs SALES), and its month. */
const RULES = [
  [/september/i, "KEE-SEPT", "Keeneland September", "yearling", 1, 9],
  [/racing age/i, "KEE-OTHER", "Keeneland (other sales)", "hit", 3, null],
  [/championship/i, "KEE-OTHER", "Keeneland (other sales)", "mixed", 3, 10],
  [/november|breeding stock/i, "KEE-NOV", "Keeneland November", "mixed", 2, 11],
  [/january/i, "KEE-JAN", "Keeneland January", "mixed", 3, 1],
  [/two-year|two year|2yo|in training/i, "KEE-APR", "Keeneland April Two-Year-Olds", "2yo", 2, 4],
  [/./, "KEE-OTHER", "Keeneland (other sales)", "mixed", 3, null],
];

/**
 * A sale from its title ("2025 September Yearling Sale") and, when known,
 * its first day: the shared key, name, kind, tier, year and month. Null
 * for a sale left out (none of the house's thoroughbred sales is).
 */
export function saleFromTitle(title, { begin = null } = {}) {
  const t = clean(title);
  if (!t) return null;
  if (/quarter horse|standardbred|arabian|\bonline\b|digital/i.test(t)) return null;
  const [, key, name, type, tier, month] = RULES.find(([re]) => re.test(t));
  const day = dayOf(begin);
  const year = day?.year ?? (Number((t.match(/\b((?:19|20)\d{2})\b/) ?? [])[1]) || null);
  if (!year) return null;
  const m = day?.month ?? monthIn(t) ?? month;
  return { key, name, type, tier, year, month: m ? `${year}-${pad(m)}` : null };
}

/** The house's list of sales (SalesSummarySales) as sales, newest first. */
export function parseSales(json) {
  const rows = typeof json === "string" ? JSON.parse(json) : json;
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = clean(r.sale_id);
    const title = clean(r.sale_description);
    const begin = dayOf(r.unformatted_begin_date ?? r.begin_date)?.iso ?? null;
    const sale = saleFromTitle(title, { begin });
    if (!id || !sale) continue;
    out.push({ id, title, ...sale, begin, end: dayOf(r.end_date)?.iso ?? null, sessions: Number(r.number_of_sessions) || null });
  }
  return out;
}

/** The house's CSV export, read: CR line ends, quoted cells. One object a hip, keyed by the header. */
export function parseCsv(text) {
  const s = String(text ?? "").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = (rows[0] ?? []).map((h) => h.trim());
  return rows.slice(1).filter((r) => r.length > 2).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

/** "0012" -> "12", "0012A" -> "12A" */
export const hipOf = (h) => {
  const m = String(h ?? "").trim().match(/^0*(\d+)\s*([A-Z]*)$/i);
  return m ? `${Number(m[1])}${m[2].toUpperCase()}` : clean(h);
};

/**
 * What became of a hip, from its summary row. Out: withdrawn. RNA: bought
 * back, the last bid from "R.N.A. (60,000)". P: sold privately after the
 * ring. A price: sold in the ring. Nothing yet: still to come (catalogued).
 */
export function outcomeOf(row) {
  const rna = String(row?.RnaIndicator ?? "").trim().toUpperCase();
  const shown = String(row?.SalePriceFormatted ?? "").trim();
  const buyer = clean(row?.Buyer);
  const price = Number(row?.SalePrice) > 0 ? Number(row.SalePrice) : money(shown);
  if (String(row?.OutIndicator ?? "").trim().toUpperCase() === "Y" || /^out$/i.test(shown)) {
    return { status: "withdrawn", buyer: null, price: null, bid: null, afterSale: false };
  }
  if (rna === "Y" || /^r\.?\s?n\.?\s?a\b/i.test(buyer ?? "")) {
    return { status: "rna", buyer: null, price: null, bid: money((String(buyer ?? "").match(/\(\s*\$?([\d,]+)\s*\)/) ?? [])[1]), afterSale: false };
  }
  if (rna === "P") return { status: price ? "sold" : "sold_private", buyer, price, bid: null, afterSale: true };
  if (price) return { status: "sold", buyer, price, bid: null, afterSale: false };
  if (buyer) return { status: "sold_private", buyer, price: null, bid: null, afterSale: false };
  return { status: "catalogued", buyer: null, price: null, bid: null, afterSale: false };
}

/**
 * What a hip is, from what the house sold it as. A filly sold as a racing
 * or broodmare prospect is a horse in training at a sale of horses of
 * racing age and breeding stock anywhere else. Null for what is not a horse
 * (a stallion season or share). Where the house says nothing, the sale's
 * kind, then the hip's age and sex, decide.
 */
export function kindOf(soldAs, { saleType = "mixed", age = null, sex = null, named = false, month = null } = {}) {
  const s = String(soldAs ?? "").trim().toLowerCase();
  if (/weanling/.test(s)) return "foal";
  if (/yearling/.test(s)) return "yearling";
  if (/two-year|2yo|in training/.test(s)) return "2yo";
  if (/^[sc]$|season|share|breeding right/.test(s)) return null;
  if (/racing or broodmare/.test(s)) return saleType === "hit" ? "hit" : "breeding";
  if (/racing/.test(s)) return "hit";
  if (/broodmare|stallion/.test(s)) return "breeding";
  if (saleType !== "mixed") return saleType;
  const x = String(sex ?? "").toLowerCase();
  if (age === 0) return "foal";
  if (age === 1) return "yearling";
  if (/mare/.test(x)) return "breeding";
  if (age === null && !named) return month && month >= 7 ? "foal" : "yearling";
  if (/horse|stallion/.test(x)) return "breeding";
  return /filly/.test(x) ? "breeding" : "hit";
}

/**
 * One sale's summary rows (and, at a mixed sale, its CSV) as lots in the
 * shared shape. `sale` is a saleFromTitle() result; `csv` the export text.
 */
export function parseResults(rows, { id, title = null, sale, csv = null }) {
  const list = typeof rows === "string" ? JSON.parse(rows) : rows ?? [];
  const meta = sale ?? saleFromTitle(title ?? list[0]?.ReportHeader);
  if (!meta) return { id, title, sale: null, lots: [] };
  const extra = new Map(parseCsv(csv).map((r) => [hipOf(r.Hip), r]));
  const month = /^\d{4}-\d{2}$/.test(meta.month ?? "") ? meta.month : null;
  const monthNo = month ? Number(month.slice(5)) : null;
  const lots = [];
  for (const r of Array.isArray(list) ? list : []) {
    const lot = hipOf(r.Hip);
    if (!lot) continue;
    const more = extra.get(lot) ?? {};
    const born = Number((String(more.DOB ?? "").match(/(\d{4})\s*$/) ?? [])[1]) || null;
    const horse = clean(r.Name) ?? clean(more["Horse Name"]);
    const type = kindOf(more.SoldAs, { saleType: meta.type, age: born ? meta.year - born : null, sex: r.Sex ?? more.Sex, named: !!horse, month: monthNo });
    if (!type) continue;
    const o = outcomeOf(r);
    const foaled = born ?? (type === "foal" ? meta.year : type === "yearling" ? meta.year - 1 : type === "2yo" ? meta.year - 2 : null);
    const sire = clean(r.Sire ?? more.Sire);
    const dam = clean(r.Dam ?? more.Dam);
    const sold = o.status === "sold";
    const gbp = sold ? convert(o.price, "USD", "GBP", month ?? String(meta.year)) : null;
    const out = {
      source: "keeneland",
      company: "Keeneland",
      sale_key: meta.key,
      sale_name: meta.name,
      sale_tier: meta.tier,
      sale_label: `KEE-${id}`,
      region: "US",
      year: meta.year,
      sale_month: month,
      sale_type: type,
      lot,
      horse,
      sire,
      sire_key: nameKey(sire),
      dam,
      dam_key: nameKey(dam),
      sex: sexOf(clean(r.Sex ?? more.Sex)),
      foaling_year: foaled,
      vendor: clean(r.Consignor ?? more.PropertyLine1),
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
  return { id, title: title ?? clean(list[0]?.ReportHeader), sale: meta, lots };
}

/** The house's totals for the sale (all sessions, the sale's own year): head sold, gross, median. */
export function parseTotals(json, year) {
  const rows = typeof json === "string" ? JSON.parse(json) : json;
  if (!Array.isArray(rows)) return null;
  const mine = rows.filter((r) => Number(r.year) === Number(year));
  const all = mine.find((r) => String(r.type) === "5") ?? mine.find((r) => String(r.type) === "3");
  if (!all) return null;
  return { sold: Number(all.head) || 0, gross: Number(all.gross) || 0, median: Number(all.median) || null, average: Number(all.average) || null };
}

/** How far the parsed ring sales agree with the house's totals: "exact", "close" (within 1%) or "off". */
export function reconcile({ lots, totals }) {
  if (!totals) return null;
  const ring = lots.filter((l) => l.status === "sold" && l.price && !l.after_sale);
  const gross = ring.reduce((a, l) => a + l.price, 0);
  const gap = totals.sold ? (totals.sold - ring.length) / totals.sold : 0;
  const exact = ring.length === totals.sold && Math.abs(gross - totals.gross) < 1;
  return {
    sold: { ours: ring.length, house: totals.sold, private: lots.filter((l) => l.after_sale).length },
    gross: { ours: gross, house: totals.gross },
    gap: Number(gap.toFixed(4)),
    verdict: exact ? "exact" : Math.abs(gap) <= 0.01 ? "close" : "off",
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getText(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { "user-agent": UA, accept: "application/json, text/csv, */*" }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Keeneland: HTTP ${res.status} for ${url}`);
  return res.text();
}

/** Every sale in the house's summaries, newest first. */
export async function listSales({ fetchImpl = fetch } = {}) {
  return parseSales(await getText(salesUrl(), fetchImpl));
}

/** The house's thoroughbred sales of a year (by the sale's first day), in date order, each with the id fetchSale() takes. */
export async function discover({ year, fetchImpl = fetch } = {}) {
  const all = await listSales({ fetchImpl });
  return all.filter((s) => s.year === Number(year)).sort((a, b) => String(a.begin ?? a.month).localeCompare(String(b.begin ?? b.month)));
}

/**
 * One sale's results as lots. `info` (an entry from discover()) saves
 * looking the sale up; the CSV is read at the sales that mix ages and kinds,
 * one request at a time with a short pause between.
 */
export async function fetchSale(id, { fetchImpl = fetch, info = null, pauseMs = 500 } = {}) {
  const code = String(id).trim();
  const sale = info?.key ? info : (await listSales({ fetchImpl })).find((s) => s.id === code) ?? null;
  if (!info?.key) await sleep(pauseMs);
  const rows = JSON.parse(await getText(summaryUrl(code), fetchImpl));
  const title = sale?.title ?? clean(rows[0]?.ReportHeader);
  const meta = sale ? { key: sale.key, name: sale.name, type: sale.type, tier: sale.tier, year: sale.year, month: sale.month } : saleFromTitle(title);
  if (!meta || !rows.length) return { id: code, title, sale: meta, lots: [], totals: null };
  let csv = null;
  if (meta.type !== "yearling" && meta.type !== "2yo") {
    await sleep(pauseMs);
    try {
      csv = await getText(csvUrl(code), fetchImpl);
    } catch {
      csv = null; // without it, ages and kinds are read from sex and name
    }
  }
  let totals = null;
  await sleep(pauseMs);
  try {
    totals = parseTotals(await getText(totalsUrl(code), fetchImpl), meta.year);
  } catch {
    totals = null;
  }
  return { ...parseResults(rows, { id: code, title, sale: meta, csv }), totals };
}

export default {
  FLEX, salesUrl, summaryUrl, totalsUrl, csvUrl, saleFromTitle, parseSales, parseCsv, hipOf, outcomeOf, kindOf, parseResults, parseTotals, reconcile,
  listSales, discover, fetchSale,
};
