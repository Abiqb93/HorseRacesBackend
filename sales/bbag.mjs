/**
 * BBAG, Baden-Baden (Iffezheim): every sale's results, from the house's own archive.
 *
 * The archive page (bbag-sales.de/archiv~de_DE, "Kataloge und
 * Statistiken") is a small app over a JSON interface on the same address:
 *   ?request=View/BbagHeadless.get/auctions/data
 *     the sale types ("Frühjahrs-Auktion", "Jährlings-Auktion", "Sales &
 *     Racing Festival", "August Online-Auktion", "Christmas Online-Sale")
 *     and the years the archive holds (2004 on);
 *   ?request=View/BbagHeadless.get/advanced/search/result&offset=N (POST
 *     form: auctionType[], auctionYear[], optionally horseType)
 *     one sale's lots, up to 400 a page: lot, name, sex, birth year, sire,
 *     dam, in foal to, vendor, buyer ("agentName"), outcome ("verkauft",
 *     "zurückgekauft", "nicht verkauft", "zurückgezogen") and the hammer
 *     or last bid in euros ("result", "12.000"), with the sale's own id,
 *     name and start time on every lot.
 * A sale is asked for by its type and year, so a sale's id here is
 * "<year>/<type>" ("2025/Jährlings-Auktion"); its label is the house's own
 * number ("BBAG82"). The house writes no lot as sold after the ring.
 *
 * What a lot is the house does not say lot by lot: it is read from its age
 * at the sale, and broodmares from the house's own "Mutterstuten" filter
 * (horseType=motherMares), asked once for each sale that mixes ages.
 */
import { nameKey } from "./normalise.mjs";
import { convert } from "./fx.mjs";

/**
 * The house's sales, by the name it gives them. BBAG-PREM and BBAG-OTHER
 * are the keys sales/normalise.mjs already gives the workbook's rows;
 * BBAG-SPRING and BBAG-AUT are defined here.
 */
const RULES = [
  [/j[äa]hrlings/i, { key: "BBAG-PREM", name: "BBAG Premier Yearlings", type: "yearling", month: 9, tier: 2 }],
  [/fr[üu]hjahr|spring|breeze/i, { key: "BBAG-SPRING", name: "BBAG Spring Breeze-Up & Horses in Training", type: "mixed", month: 5, tier: 3 }],
  [/sales & racing festival|herbst|autumn|october|oktober/i, { key: "BBAG-AUT", name: "BBAG Sales & Racing Festival (Autumn)", type: "mixed", month: 10, tier: 3 }],
  [/./, { key: "BBAG-OTHER", name: "BBAG (other sales)", type: "mixed", month: null, tier: 3 }],
];

/** A sale from the house's name for it ("Jährlings-Auktion 2025"), and its start time (Unix seconds) when known. */
export function saleFromTitle(title, startedAt = null) {
  const t = String(title ?? "").trim();
  if (!t) return null;
  const [, def] = RULES.find(([re]) => re.test(t));
  const named = Number((t.match(/\b(20\d{2}|19\d{2})\b/) ?? [])[1]) || null;
  // The start is midnight or morning in Baden-Baden: read it two hours ahead of UTC.
  const start = Number(startedAt) > 0 ? new Date((Number(startedAt) + 7200) * 1000) : null;
  const year = start ? start.getUTCFullYear() : named;
  if (!year) return null;
  const month = start ? start.getUTCMonth() + 1 : def.month;
  return { key: def.key, name: def.name, type: def.type, tier: def.tier, year, month: month ? `${year}-${String(month).padStart(2, "0")}` : null };
}

/** "2025/Jährlings-Auktion" -> { year: 2025, type: "Jährlings-Auktion" } */
export function parseId(id) {
  const m = String(id ?? "").match(/^(\d{4})\/(.+)$/);
  return m ? { year: Number(m[1]), type: m[2].trim() } : null;
}

/** A price as the house writes it: "12.000" (thousands with points), "0" for none. */
export function euros(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v > 0 ? v : null;
  const n = Number(String(v).replace(/,\d*$/, "").replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * What became of a lot. "zurückgekauft" is bought back by the vendor and
 * "nicht verkauft" left unsold, both at the last bid shown; a sale not yet
 * held has no outcome: catalogued.
 */
export function outcomeOf(resultType) {
  const s = String(resultType ?? "").toLowerCase().trim();
  if (s === "verkauft") return "sold";
  if (/zur[üu]ckgekauft|nicht verkauft/.test(s)) return "rna";
  if (/zur[üu]ckgezogen/.test(s)) return "withdrawn";
  return "catalogued";
}

const SEX = { hengst: "colt", stute: "filly", wallach: "gelding" };
const clean = (s) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t || null;
};
/** A name without its country ("Counterattack (AUS)" -> "Counterattack"); "N.N." is an unnamed horse. */
const bare = (s) => {
  const t = clean(s)?.replace(/\s*\([A-Z]{2,3}\)\s*$/, "") ?? null;
  return t && !/^n\.?\s?n\.?$/i.test(t) ? t : null;
};

/**
 * What a lot is, from its age at the sale: a foal, a yearling, a
 * two-year-old (at the spring breeze-up; later in the year one is in
 * training), older horses in training, and the house's broodmares (or a
 * mare sold in foal) as breeding stock.
 */
export function kindOf(lot, sale, mares = null) {
  if (mares?.has(lot.horseAuctionDataID) || clean(lot.inFoalTo) || clean(lot.foalToName)) return "breeding";
  const born = Number(lot.horseBirthdate) || null;
  if (!born || !sale?.year) return sale?.type === "mixed" ? null : sale?.type ?? null;
  const age = sale.year - born;
  if (age <= 0) return "foal";
  if (age === 1) return "yearling";
  if (age === 2) return Number(String(sale.month ?? "").slice(5)) <= 6 ? "2yo" : "hit";
  return "hit";
}

/**
 * One sale's lots (the "list" of its search pages, put together) in the
 * shared shape. `mares` is the set of the sale's broodmares
 * (horseAuctionDataID) from the house's own filter, when asked for.
 */
export function parseLots(list, { mares = null } = {}) {
  const rows = (list ?? []).filter((l) => l && l.lotNumber !== null && l.lotNumber !== undefined);
  const first = rows[0];
  const title = clean(first?.auctionName);
  const sale = first ? saleFromTitle(title, first.auctionDateStart) : null;
  if (!sale) return { title, sale: null, auctionId: null, lots: [] };
  const auctionId = first.auctionID ?? null;
  const seen = new Set();
  const lots = [];
  for (const l of rows) {
    if (seen.has(l.horseAuctionDataID ?? `${l.auctionID}|${l.lotNumber}`)) continue;
    seen.add(l.horseAuctionDataID ?? `${l.auctionID}|${l.lotNumber}`);
    const type = kindOf(l, sale, mares);
    if (!type) continue;
    const outcome = outcomeOf(l.resultType);
    const figure = euros(l.result);
    const status = outcome === "sold" && !figure ? "sold_private" : outcome;
    const sold = status === "sold";
    const gbp = sold && sale.month ? convert(figure, "EUR", "GBP", sale.month) : null;
    lots.push({
      source: "bbag",
      company: "BBAG",
      sale_key: sale.key,
      sale_name: sale.name,
      sale_tier: sale.tier,
      sale_label: `BBAG${l.auctionID ?? auctionId}`,
      region: "EU",
      year: sale.year,
      sale_month: sale.month,
      sale_type: type,
      lot: String(l.lotNumber),
      horse: bare(l.horseName),
      sire: bare(l.fatherName),
      sire_key: nameKey(l.fatherName),
      dam: bare(l.motherName),
      dam_key: nameKey(l.motherName),
      sex: SEX[String(l.horseGender ?? "").toLowerCase()] ?? null,
      foaling_year: Number(l.horseBirthdate) || null,
      vendor: clean(l.sellerName),
      buyer: sold || status === "sold_private" ? clean(l.agentName) : null,
      status,
      price: sold ? figure : null,
      bid: status === "rna" ? figure : null,
      currency: "EUR",
      price_gbp: gbp === null ? null : Math.round(gbp),
    });
  }
  return { title, sale, auctionId, lots };
}

/* ------------------------------------------------------------ fetching */

const ARCHIVE = "https://bbag-sales.de/archiv~de_DE";
const UA = "Mozilla/5.0 (compatible; BlandfordBloodstock/1.0; sales results; +https://www.blandfordbloodstock.tech)";
const PAGE = 400;
const pause = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** Requests one at a time, with the cookie and form token the archive page hands out. */
function session(fetchImpl, pauseMs) {
  const jar = new Map();
  let token = null;
  let first = true;
  const call = async (url, init = {}) => {
    if (!first) await pause(pauseMs);
    first = false;
    const res = await fetchImpl(url, {
      ...init,
      headers: { "user-agent": UA, "x-requested-with": "XMLHttpRequest", ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(60_000),
    });
    for (const c of res.headers?.getSetCookie?.() ?? []) {
      const kv = c.split(";")[0];
      const i = kv.indexOf("=");
      if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
    if (!res.ok) throw new Error(`BBAG ${url}: HTTP ${res.status}`);
    return res.text();
  };
  const json = (text, what) => {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`BBAG ${what}: not JSON`);
    }
  };
  return {
    async types() {
      return json(await call(`${ARCHIVE}?request=View/BbagHeadless.get/auctions/data`), "auctions/data");
    },
    async search(type, year, { offset = 0, horseType = null } = {}) {
      if (token === null) token = (String(await call(ARCHIVE)).match(/data-csrf-token="([^"]*)"/) ?? [])[1] ?? "";
      const form = new FormData();
      form.append("auctionType[]", type);
      form.append("auctionYear[]", String(year));
      if (horseType) form.append("horseType", horseType);
      form.append("csrfToken", token);
      const q = `request=View/BbagHeadless.get/advanced/search/result&languageId=1&orderField=lotNumber&orderDirection=asc&offset=${offset}&token=${token}&auctionDay=0`;
      return json(await call(`${ARCHIVE}?${q}`, { method: "POST", body: form }), `${year} ${type}`).list ?? [];
    },
  };
}

/** Every lot of one sale, page by page. */
async function allLots(s, type, year, horseType = null) {
  const out = [];
  for (let offset = 0; offset < 20 * PAGE; ) {
    const page = await s.search(type, year, { offset, horseType });
    out.push(...page);
    if (page.length < PAGE) break;
    offset += page.length;
  }
  return out;
}

/** The year's sales: each of the house's sale types asked for the year, kept where it holds lots. */
export async function discover({ year, fetchImpl = fetch, pauseMs = 1000 } = {}) {
  const s = session(fetchImpl, pauseMs);
  const data = await s.types();
  if (Array.isArray(data.auctionYears) && !data.auctionYears.map(String).includes(String(year))) return [];
  const out = [];
  for (const type of data.auctionTypes ?? []) {
    const page = await s.search(type, year);
    if (!page.length) continue;
    const { title, sale, auctionId } = parseLots(page.slice(0, 1));
    if (!sale || sale.year !== Number(year)) continue;
    out.push({ id: `${year}/${type}`, title, ...sale, auctionId });
  }
  return out.sort((a, b) => String(a.month).localeCompare(String(b.month)));
}

/** One sale's lots, by "<year>/<type>"; the house's broodmares are asked for where the sale mixes ages. */
export async function fetchSale(id, { fetchImpl = fetch, pauseMs = 1000 } = {}) {
  const parsed = parseId(id);
  if (!parsed) throw new Error(`not a BBAG sale id (year/type): ${id}`);
  const s = session(fetchImpl, pauseMs);
  const list = await allLots(s, parsed.type, parsed.year);
  const probe = parseLots(list.slice(0, 1));
  const mares = probe.sale && probe.sale.type !== "yearling" ? new Set((await allLots(s, parsed.type, parsed.year, "motherMares")).map((l) => l.horseAuctionDataID)) : null;
  const { title, sale, auctionId, lots } = parseLots(list, { mares });
  return { id: String(id), title, sale, auctionId, lots };
}

export default { saleFromTitle, parseId, euros, outcomeOf, kindOf, parseLots, discover, fetchSale };
