/**
 * Sale lots, as one shape whatever sold them.
 *
 * Every lot from every sale — a yearling at Tattersalls, a foal at Goffs, a
 * two-year-old at a breeze-up, a horse in training at Arqana — becomes one
 * row: who sold it and when, what it was (sire, dam, sex, foaling year),
 * what became of it (sold, not sold, withdrawn, out), and the price in the
 * currency it was sold in, with sterling beside it for comparing markets.
 *
 * Three workbooks seed it, each built by hand over years and each with its
 * own habits (readers below), and the sale companies' own results keep it
 * up to date (sales/sources). The readers are pure and tested: a price read
 * in the wrong currency, or a horse that was not sold read as sold, is a
 * wrong median nobody can see.
 */
import { convert } from "./fx.mjs";

/* -------------------------------------------------------------- names */

/** A horse's name as a key: no country, no accents, no punctuation, upper case. */
export function nameKey(raw) {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s*\([A-Za-z]{2,3}\)\s*$/, "")
    .replace(/['’`´.]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/** "Hoodoo Blue (IRE)2014 Bay colt" -> "Hoodoo Blue"; a lot's name is often given with its description. */
export function horseName(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(.*?)(?:\s*\([A-Z]{2,3}\))?\s*\d{4}\b/);
  const name = (m ? m[1] : s).trim();
  return name && !/^(bay|chestnut|grey|gray|brown|black|roan|dark)/i.test(name) ? name : null;
}

export function sexOf(raw) {
  const s = String(raw ?? "").toLowerCase();
  if (/colt|^c$|^h$|horse|stallion|ridgling|rig/.test(s)) return "colt";
  if (/filly|^f$|mare|^m$/.test(s)) return "filly";
  if (/gelding|^g$/.test(s)) return "gelding";
  return null;
}

/* -------------------------------------------------------------- sales */

/**
 * A sale as one identity across years: the same sale is "October Yearling
 * Sale (Book 1)" in 2019, "OC1" in 2023 and "Tatts Book 1" in 2025. The
 * tier says where it sits in its market (1: the select sales, 2: the
 * premier books, 3: the rest), so a sire's lots can be read for where they
 * were sold as well as what they made.
 */
const SALES = [
  // Tattersalls, Newmarket — guineas
  [/tattersalls$/i, /book 1|^oc1$|tatts book 1/i, "TAT-OC1", "Tattersalls October Book 1", 1],
  [/tattersalls$/i, /book 2|^oc2$|tatts book 2/i, "TAT-OC2", "Tattersalls October Book 2", 2],
  [/tattersalls$/i, /book 3|^oc3$|tatts book 3/i, "TAT-OC3", "Tattersalls October Book 3", 3],
  [/tattersalls$/i, /book 4|^oc4$/i, "TAT-OC4", "Tattersalls October Book 4", 3],
  [/tattersalls$/i, /^som$|somerville/i, "TAT-SOM", "Tattersalls Somerville", 2],
  [/tattersalls$/i, /^dey$|december yearling|tatts december/i, "TAT-DEY", "Tattersalls December Yearlings", 3],
  [/tattersalls$/i, /^syl$|^sy2$/i, "TIR-SEPT", "Tattersalls Ireland September Yearlings", 3, "Tattersalls Ireland"],
  [/tattersalls$/i, /ascot yearling/i, "TAT-ASCOT", "Tattersalls Ascot Yearlings", 3],
  [/tattersalls$/i, /^february/i, "TAT-FEB", "Tattersalls February", 3],
  [/tattersalls$/i, /^july/i, "TAT-JUL", "Tattersalls July", 2],
  [/tattersalls$/i, /online/i, "TAT-ONLINE", "Tattersalls Online", 3],
  [/tattersalls$/i, /./, "TAT-OTHER", "Tattersalls (other sales)", 3],
  // Tattersalls Ireland, Fairyhouse — euros
  [/tattersalls ireland/i, /september yearling|tatts ireland/i, "TIR-SEPT", "Tattersalls Ireland September Yearlings", 3],
  [/tattersalls ireland/i, /ascot yearling/i, "TIR-ASCOT", "Tattersalls Ireland Ascot Yearlings", 3],
  [/tattersalls ireland/i, /\bnh\b|national hunt/i, "TIR-NH", "Tattersalls Ireland National Hunt", 3],
  [/tattersalls ireland/i, /./, "TIR-OTHER", "Tattersalls Ireland (other sales)", 3],
  // Goffs, Kildare — euros; its Doncaster sales are Goffs UK's
  [/^goffs$/i, /orby.*book 2|orby book 2/i, "GOF-ORBY2", "Goffs Orby Book 2", 2],
  [/^goffs$/i, /orby/i, "GOF-ORBY", "Goffs Orby", 1],
  [/^goffs$/i, /sportsman/i, "GOF-SPORT", "Goffs Sportsman's", 3],
  [/^goffs$/i, /open yearling/i, "GOF-OPEN", "Goffs Open Yearlings", 3],
  [/^goffs$/i, /autumn/i, "GOF-AUT", "Goffs Autumn Yearlings", 3],
  [/^goffs$/i, /premier yearling/i, "GUK-PREM", "Goffs UK Premier Yearlings", 2, "Goffs UK"],
  [/^goffs$/i, /./, "GOF-OTHER", "Goffs (other sales)", 3],
  // Goffs UK, Doncaster — sterling
  [/goffs uk/i, /premier/i, "GUK-PREM", "Goffs UK Premier Yearlings", 2],
  [/goffs uk/i, /silver/i, "GUK-SILVER", "Goffs UK Silver Yearlings", 3],
  [/goffs uk/i, /./, "GUK-OTHER", "Goffs UK (other sales)", 3],
  // Arqana, Deauville — euros
  [/arqana/i, /august.*v2|august v\.?2/i, "ARQ-AUG2", "Arqana August V.2", 2],
  [/arqana/i, /august|select yearling/i, "ARQ-AUG", "Arqana August", 1],
  [/arqana/i, /october|september yearling/i, "ARQ-OCT", "Arqana October", 2],
  [/arqana/i, /november/i, "ARQ-NOV", "Arqana November Yearlings", 3],
  [/arqana/i, /./, "ARQ-OTHER", "Arqana (other sales)", 3],
  // BBAG, Baden-Baden — euros
  [/bbag/i, /premier|september yearling/i, "BBAG-PREM", "BBAG Premier Yearlings", 2],
  [/bbag/i, /./, "BBAG-OTHER", "BBAG (other sales)", 3],
  // Keeneland, Lexington — dollars
  [/keeneland/i, /september/i, "KEE-SEPT", "Keeneland September", 1],
  [/keeneland/i, /november/i, "KEE-NOV", "Keeneland November", 2],
  [/keeneland/i, /january/i, "KEE-JAN", "Keeneland January", 3],
  [/keeneland/i, /april|two-year|2yo/i, "KEE-APR", "Keeneland April Two-Year-Olds", 2],
  [/keeneland/i, /./, "KEE-OTHER", "Keeneland (other sales)", 3],
  // Fasig-Tipton — dollars
  [/fasig/i, /saratoga fall/i, "FT-SARFALL", "Fasig-Tipton Saratoga Fall", 3],
  [/fasig/i, /saratoga/i, "FT-SAR", "Fasig-Tipton Saratoga", 1],
  [/fasig/i, /july/i, "FT-JULY", "Fasig-Tipton July", 3],
  [/fasig/i, /october|kentucky october/i, "FT-OCT", "Fasig-Tipton October", 3],
  [/fasig/i, /new york bred/i, "FT-NYB", "Fasig-Tipton New York Bred", 3],
  [/fasig/i, /midlantic/i, "FT-MID", "Fasig-Tipton Midlantic", 3],
  [/fasig/i, /california/i, "FT-CAL", "Fasig-Tipton California", 3],
  [/fasig/i, /november/i, "FT-NOV", "Fasig-Tipton November", 2],
  [/fasig/i, /gulfstream|florida/i, "FT-GULF", "Fasig-Tipton Gulfstream Two-Year-Olds", 1],
  [/fasig/i, /showcase/i, "FT-SHOW", "Fasig-Tipton Selected Yearlings Showcase", 2],
  [/fasig/i, /./, "FT-OTHER", "Fasig-Tipton (other sales)", 3],
  // Australia and New Zealand — dollars of each (the workbook names no house)
  [/^\(none\)$|magic|inglis|nzb|htba/i, /^mm gc|magic millions gold coast yearling|^mm gold coast yearling/i, "MM-GC", "Magic Millions Gold Coast", 1, "Magic Millions"],
  [/^\(none\)$|magic|inglis|nzb|htba/i, /gold coast march|mm gold coast march/i, "MM-MARCH", "Magic Millions Gold Coast March", 3, "Magic Millions"],
  [/^\(none\)$|magic|inglis|nzb|htba/i, /gold coast national/i, "MM-NAT", "Magic Millions National", 3, "Magic Millions"],
  [/^\(none\)$|magic|inglis|nzb|htba/i, /mm adelaide/i, "MM-ADL", "Magic Millions Adelaide", 3, "Magic Millions"],
  [/^\(none\)$|magic|inglis|nzb|htba/i, /mm perth/i, "MM-PER", "Magic Millions Perth", 3, "Magic Millions"],
  [/^\(none\)$|magic|inglis|nzb|htba/i, /mm tasmanian/i, "MM-TAS", "Magic Millions Tasmania", 3, "Magic Millions"],
  [/^\(none\)$|magic|inglis|nzb|htba/i, /capricornia/i, "MM-CAP", "Magic Millions Capricornia", 3, "Magic Millions"],
  [/^\(none\)$|magic|inglis|nzb|htba/i, /inglis easter|^easter/i, "ING-EASTER", "Inglis Easter", 1, "Inglis"],
  [/^\(none\)$|magic|inglis|nzb|htba/i, /inglis classic|^classic/i, "ING-CLASSIC", "Inglis Classic", 2, "Inglis"],
  [/^\(none\)$|magic|inglis|nzb|htba/i, /^premier yearling sale$|inglis premier/i, "ING-PREMIER", "Inglis Premier", 2, "Inglis"],
  [/^\(none\)$|magic|inglis|nzb|htba/i, /melbourne vobis|vobis gold/i, "ING-VOBIS", "Inglis Melbourne VOBIS Gold", 3, "Inglis"],
  [/^\(none\)$|magic|inglis|nzb|htba/i, /festival yearling/i, "ING-FEST", "Inglis Festival", 3, "Inglis"],
  [/^\(none\)$|magic|inglis|nzb|htba/i, /scone yearling/i, "ING-SCONE", "Inglis Scone", 3, "Inglis"],
  [/^\(none\)$|magic|inglis|nzb|htba/i, /^select yearling/i, "ING-SELECT", "Inglis Select", 3, "Inglis"],
  [/^\(none\)$|magic|inglis|nzb|htba/i, /htba/i, "HTBA", "HTBA Yearling Sale", 3, "Hunter Thoroughbred Breeders"],
  [/^\(none\)$|magic|inglis|nzb|htba/i, /karaka book 1/i, "NZB-B1", "NZB Karaka Book 1", 1, "NZB"],
  [/^\(none\)$|magic|inglis|nzb|htba/i, /karaka book 2/i, "NZB-B2", "NZB Karaka Book 2", 2, "NZB"],
  [/^\(none\)$|magic|inglis|nzb|htba/i, /karaka book 3/i, "NZB-B3", "NZB Karaka Book 3", 3, "NZB"],
  [/^\(none\)$|magic|inglis|nzb|htba/i, /karaka online/i, "NZB-ONLINE", "NZB Karaka Online", 3, "NZB"],
];

/** The currency a sale is held in. Tattersalls in Newmarket sells in guineas. */
export function currencyOf(saleKey) {
  const k = String(saleKey ?? "");
  if (/^TAT-/.test(k)) return "GNS";
  if (/^GUK-/.test(k)) return "GBP";
  if (/^(TIR|GOF|ARQ|BBAG)-/.test(k)) return "EUR";
  if (/^(KEE|FT|OBS)-/.test(k)) return "USD";
  if (/^NZB-/.test(k)) return "NZD";
  if (/^(MM|ING|HTBA)/.test(k)) return "AUD";
  return null;
}

export function regionOf(saleKey) {
  const k = String(saleKey ?? "");
  if (/^(KEE|FT|OBS)-/.test(k)) return "US";
  if (/^NZB-/.test(k)) return "NZ";
  if (/^(MM|ING|HTBA)/.test(k)) return "AUS";
  return "EU";
}

/** The canonical sale for a company and a sale name. */
export function saleOf(company, sale) {
  const c = String(company ?? "").trim() || "(none)";
  for (const [co, re, key, name, tier, coName] of SALES) {
    if (co.test(c) && re.test(String(sale ?? "").trim())) {
      return { key, name, tier, company: coName ?? String(company ?? "").trim(), currency: currencyOf(key), region: regionOf(key) };
    }
  }
  return null;
}

/* ------------------------------------------------------------- status */

/**
 * What became of a lot, from how the sale wrote the buyer's column. A lot
 * bought back by its vendor, passed in, or "not sold" carries the last bid
 * as its price in some books; it is not a sale and its figure is a bid.
 */
export function statusOf(buyer, { price = null, sold = null } = {}) {
  const b = String(buyer ?? "").trim();
  if (/withdrawn|^out$|^scratched/i.test(b)) return "withdrawn";
  if (/^vendor\b|not sold|r\.?n\.?a|\bpsd\b|passed in|buy ?back|bought back/i.test(b)) return "rna";
  if (sold === 0 || sold === false) return /^-+$|^$/.test(b) ? "unsold" : "rna";
  if (sold === 1 || sold === true) return "sold";
  if (Number(price) > 0) return "sold";
  return b ? "unknown" : "unknown";
}

/* ------------------------------------------------------------- prices */

const step = (v) => (v < 10000 ? 100 : v < 100000 ? 500 : 1000);
const isRound = (v) => v > 0 && Math.abs(v - Math.round(v / step(v)) * step(v)) < 0.51;

/**
 * The European workbook's two price columns, read back to the price the
 * hammer fell at. Its columns were filled differently by company and year:
 * the sterling column holds the guineas price for Tattersalls up to 2022 and
 * guineas times 1.05 from 2023; the euro price times 0.87 for Arqana, BBAG
 * and Tattersalls Ireland up to 2022, the euro price itself for Goffs; times
 * 0.82 for the Irish sales filed under Tattersalls in 2023 and 2024; and the
 * euro column is only ever the sterling one at a fixed rate, except for
 * Arqana and Goffs in 2023 and 2024, where it is the only price there is.
 * Hammer prices are round, so each sale-year takes the reading that gives
 * round prices (EU_RULES below, measured on the whole file: every one of
 * its 270 sale-years reads round for 90% of its lots or more).
 */
export const EU_READINGS = {
  gbp: (g) => g,
  eur: (g, e) => e,
  "gbp/1.05": (g) => g / 1.05,
  "gbp/0.87": (g) => g / 0.87,
  "gbp/0.82": (g) => g / 0.82,
};

/** The reading that gives round prices for most lots of a group of rows `[gbp, eur]`. */
export function bestReading(pairs) {
  let best = null;
  for (const [name, read] of Object.entries(EU_READINGS)) {
    let hits = 0;
    let n = 0;
    for (const [g, e] of pairs) {
      const v = read(g, e);
      if (!(v > 0)) continue;
      n += 1;
      if (isRound(v)) hits += 1;
    }
    if (n && (!best || hits > best.hits)) best = { name, hits, n, share: hits / n };
  }
  return best;
}

/** A price read and rounded to the nearest step a hammer could have fallen at. */
export function hammer(v) {
  if (!(v > 0)) return null;
  const s = v < 1000 ? 50 : step(v);
  return Math.round(v / s) * s;
}

/* ----------------------------------------------------------- the readers */

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const str = (v) => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

/** The sterling figure beside a price, at the sale's year (or month when known). */
function withSterling(lot) {
  const when = lot.sale_month ?? String(lot.year);
  const gbp = lot.price !== null && lot.currency ? convert(lot.price, lot.currency, "GBP", when) : null;
  return { ...lot, price_gbp: gbp === null ? null : Math.round(gbp) };
}

/**
 * The European yearling workbook (2015-2025). Rows of 2025 are a catalogue
 * without results, and its American rows of 2025 are the American
 * workbook's, so both are dropped here; `readings` comes from euReadings().
 */
export function fromEuRow(r, readings) {
  const year = Number(r.Year);
  const sale = saleOf(r.SalesCompany, r.Sale);
  if (!sale || !year) return null;
  if (sale.region !== "EU") return null;
  const g = num(r.SalePriceGBP) ?? 0;
  const e = num(r.SalePriceEUR) ?? 0;
  const groupKey = `${r.SalesCompany}|${r.Sale}|${r.Year}`;
  const reading = readings?.get(groupKey)?.name ?? null;
  const raw = reading && (g > 0 || e > 0) ? EU_READINGS[reading](g, e) : null;
  const status = statusOf(r.Buyer, { price: raw });
  const catalogueOnly = year >= 2025 && !(g > 0 || e > 0) && !str(r.Buyer);
  const lot = {
    source: "eu-master",
    company: sale.company,
    sale_key: sale.key,
    sale_name: sale.name,
    sale_tier: sale.tier,
    sale_label: str(r.Sale),
    region: sale.region,
    year,
    sale_month: null,
    sale_type: "yearling",
    lot: str(r.Lot),
    horse: horseName(r.Horse),
    sire: str(r.Sire),
    sire_key: nameKey(r.Sire_clean ?? r.Sire),
    dam: str(r.Dam),
    dam_key: nameKey(r.Dam_clean ?? r.Dam),
    sex: sexOf(r.Sex),
    foaling_year: num(r.BirthYear),
    vendor: str(r.VendorNameDetails),
    buyer: str(r.Buyer),
    status: catalogueOnly ? "catalogued" : status,
    price: status === "sold" ? hammer(raw) : null,
    bid: status === "rna" ? hammer(raw) : null,
    currency: sale.currency,
    reading,
  };
  return withSterling(lot);
}

/** The readings for the European workbook, one per company, sale and year. */
export function euReadings(rows) {
  const groups = new Map();
  for (const r of rows) {
    const g = num(r.SalePriceGBP) ?? 0;
    const e = num(r.SalePriceEUR) ?? 0;
    if (!(g > 0 || e > 0)) continue;
    const k = `${r.SalesCompany}|${r.Sale}|${r.Year}`;
    const list = groups.get(k) ?? [];
    list.push([g, e]);
    groups.set(k, list);
  }
  const out = new Map();
  for (const [k, pairs] of groups) out.set(k, bestReading(pairs));
  return out;
}

/**
 * The American yearling workbook (2015-2025): Keeneland and Fasig-Tipton,
 * offered and sold flagged on every row, the race record of the horse where
 * it was matched. Gulfstream and Florida are two-year-old sales: the
 * workbook assumed a yearling's foaling year for them.
 */
export function fromUsRow(r) {
  const year = num(r.Year);
  const sale = saleOf(r.SaleCompany, r.Sale);
  if (!sale || !year) return null;
  const twoYearOld = sale.key === "FT-GULF";
  const sold = num(r.Sold);
  const status = statusOf(r.Buyer, { sold });
  const rnaBid = num((String(r.Buyer ?? "").match(/R\.?N\.?A\.?\s*\(([\d,]+)\)/i) ?? [])[1]);
  const lot = {
    source: "us-master",
    company: sale.company,
    sale_key: sale.key,
    sale_name: sale.name,
    sale_tier: sale.tier,
    sale_label: str(r.Sale),
    region: "US",
    year,
    sale_month: null,
    sale_type: twoYearOld ? "2yo" : "yearling",
    lot: str(r.LOT),
    horse: str(r.HorseName) ?? str(r.LOTName),
    sire: str(r.Sire),
    sire_key: nameKey(r.Sire),
    dam: str(r.Dam),
    dam_key: nameKey(r.Dam),
    sex: null,
    foaling_year: twoYearOld ? year - 2 : num(r.YOB),
    vendor: str(r.ConsignorDisplay) ?? str(r.Consignor),
    buyer: str(r.Buyer),
    status,
    price: status === "sold" ? num(r.Price) : null,
    bid: status === "rna" ? rnaBid : null,
    currency: "USD",
    record: r.MatchStatus === "matched" ? { runs: num(r.AllRuns), wins: num(r.CareerWins), sw: num(r.SWins), gw: num(r.GWins), g1w: num(r.G1Wins), prize_usd: num(r.PrizemoneyUSD) } : null,
  };
  if (lot.status === "sold" && !(lot.price > 0)) lot.status = "sold_private";
  return withSterling(lot);
}

/**
 * The Australian and New Zealand yearling workbook (2015-2025): Magic
 * Millions, Inglis, NZB Karaka and the regional sales; the race record of
 * each horse that ran. A southern yearling is sold in the year after its
 * birth year's spring, so its foaling year is the sale year less two.
 */
export function fromAuRow(r) {
  const year = num(r.Year);
  const sale = saleOf(null, r.SaleName);
  if (!sale || !year) return null;
  const sold = num(r.Sold);
  const status = statusOf(r.Buyer, { sold });
  const reserve = num((String(r.Buyer ?? "").match(/Res\s*\$?([\d,]+)/i) ?? [])[1]);
  const ran = num(r.Runner) !== null;
  const lot = {
    source: "aus-nz-master",
    company: sale.company,
    sale_key: sale.key,
    sale_name: sale.name,
    sale_tier: sale.tier,
    sale_label: str(r.SaleName),
    region: sale.region,
    year,
    sale_month: null,
    sale_type: "yearling",
    lot: str(r.LOT),
    horse: str(r.name),
    sire: str(r.Sire),
    sire_key: nameKey(r.Sire),
    dam: str(r.Dam),
    dam_key: nameKey(r.Dam),
    sex: null,
    foaling_year: num(r.BirthYear),
    vendor: str(r.Vendor),
    buyer: str(r.Buyer),
    status,
    price: status === "sold" ? num(r.Price) : null,
    bid: status === "rna" ? reserve : null,
    currency: sale.currency,
    record: ran ? { runner: num(r.Runner), winner: num(r.Winner), sw: num(r["StakesWinner"]), gw: num(r["Group Winner"]), g1w: num(r["Grp1 Winner"]) } : null,
  };
  if (lot.status === "sold" && !(lot.price > 0)) lot.status = "sold_private";
  return withSterling(lot);
}

/**
 * The European workbook's covering fees, by sire and season. Its "Stud
 * Fee" column is the sire's fee in the season the lot was conceived, in
 * sterling, multiplied by 0.82 (measured against the stallion roster's fee
 * history: within 3% for 70% of sterling fees; euro fees were converted
 * first, so they agree less closely). Divided back, it is the only fee
 * history before 2022 for most European sires. Returns a Map of
 * `${sireKey}|${coverYear}` -> sterling fee (the median of the crop's lots).
 */
export function feeHintsFromEu(rows) {
  const groups = new Map();
  for (const r of rows) {
    const fee = num(r["Stud Fee"]);
    const born = num(r.BirthYear);
    if (!(fee > 0) || !born) continue;
    const k = `${nameKey(r.Sire_clean ?? r.Sire)}|${born - 1}`;
    (groups.get(k) ?? groups.set(k, []).get(k)).push(fee / 0.82);
  }
  const out = new Map();
  for (const [k, fees] of groups) {
    const s2 = fees.sort((a, b) => a - b);
    out.set(k, Math.round(s2[Math.floor(s2.length / 2)]));
  }
  return out;
}

/** A lot's identity: the same lot read twice is one row. */
export const lotKey = (l) => `${l.sale_key}|${l.year}|${l.sale_label ?? ""}|${l.lot ?? ""}|${l.dam_key ?? ""}`;

export default {
  nameKey, horseName, sexOf, saleOf, currencyOf, regionOf, statusOf, EU_READINGS, bestReading, hammer,
  euReadings, fromEuRow, fromUsRow, fromAuRow, feeHintsFromEu, lotKey,
};
