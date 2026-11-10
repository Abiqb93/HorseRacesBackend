/**
 * Pinhooking: a foal bought at a foal sale and sold again as a yearling, or
 * as a two-year-old at a breeze-up, and what it made the second time.
 *
 * A foal is followed on its dam, its foaling year and its sire, the three
 * things every catalogue gives (sales/runners.mjs does the same for a
 * runner). Each foal offered at a foal sale becomes one row of the cohort:
 * what it made as a foal, and what became of it at each later stage.
 *
 * The rules, so every figure can be traced:
 *  - The buy is a foal lot sold in the ring or after it with a price.
 *    A foal bought back (RNA) is not a purchase; it stays in the cohort
 *    with `bought: false`. A private sale with no price is counted and
 *    left out of every return.
 *  - The resale is a lot of the same dam, foaling year and sire at a
 *    yearling sale in the next year, or a breeze-up (2yo) sale the year
 *    after. Every foal bought ends in exactly one outcome per stage:
 *    resold, sold privately, offered and not sold, entered and not
 *    offered (withdrawn), or never entered. A foal never entered again is
 *    never scored as a loss or as nothing: it is counted beside the
 *    returns, which are only ever read "on those resold".
 *  - Foal to two-year-old is the foal held through its yearling year: a
 *    foal resold as a yearling and breezed later belongs to its yearling
 *    buyer, so it is marked `viaYearling` and left out of that return.
 *  - Returns are gross: the resale price against the foal price, both in
 *    sterling at the sale's own date. No keep, preparation, entry or
 *    commission cost is assumed, because none is held.
 *  - A dam, foaling year and sire with two foal lots in one sale (twins, or
 *    two mares of one name) is ambiguous and left out, as is a horse whose
 *    sex differs between its two lots (a colt may be a gelding later).
 *  - A stage whose sales are not all over is marked incomplete and left out
 *    of the returns.
 */
import { KINDS, median, damRecord } from "./metrics.mjs";
import { foaledOf } from "./runners.mjs";

export const STAGES = { yearling: 1, "2yo": 2 };
/** Foal price bands in sterling: [from, to). Published with every answer. */
export const BANDS = [0, 5000, 10000, 20000, 40000, 80000, 160000, 320000];
export const OUTCOMES = ["resold", "sold_private", "offered_not_sold", "entered_not_offered", "not_entered"];

const SOLD = (l) => l.status === "sold" && Number(l.price_gbp) > 0;
const round = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function bandOf(gbp) {
  if (!(gbp > 0)) return null;
  for (let i = BANDS.length - 1; i >= 0; i -= 1) if (gbp >= BANDS[i]) return i === BANDS.length - 1 ? `${BANDS[i]}+` : `${BANDS[i]}-${BANDS[i + 1]}`;
  return null;
}

/** A colt can be gelded between sales; a colt and a filly cannot be one horse. */
const SEXES = { colt: "m", gelding: "m", horse: "m", filly: "f", mare: "f" };
const sexConflict = (a, b) => Boolean(SEXES[a] && SEXES[b] && SEXES[a] !== SEXES[b]);

/**
 * Whether a stage's sales are over for a foaling year. The yearling sales
 * end with December's; the breeze-ups are over by the end of June.
 */
export function stageComplete(foaled, stage, today = new Date()) {
  const year = foaled + STAGES[stage];
  const nowYear = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  if (year < nowYear) return true;
  if (year > nowYear) return false;
  return stage === "2yo" ? month >= 7 : false;
}

const legOf = (l) =>
  l
    ? {
        saleKey: l.sale_key,
        sale: l.sale_name ?? null,
        company: l.company ?? null,
        year: l.year,
        lot: l.lot ?? null,
        status: l.status,
        price: l.price ?? null,
        currency: l.currency ?? null,
        priceGbp: SOLD(l) ? Number(l.price_gbp) : null,
        vendor: l.vendor ?? null,
        buyer: l.buyer ?? null,
        tier: l.sale_tier ?? null,
      }
    : null;

/** What became of a horse at one stage, from the lots of that stage. */
function outcomeAt(lots) {
  if (!lots.length) return { outcome: "not_entered", lot: null, lots: 0 };
  // Sold more than once at one stage (Book 3, then December): the first
  // sale is the pinhooker's exit, and the higher book comes first.
  const sold = lots.filter(SOLD).sort((a, b) => (Number(a.sale_tier) || 9) - (Number(b.sale_tier) || 9));
  if (sold.length) return { outcome: "resold", lot: sold[0], lots: lots.length };
  const priv = lots.find((l) => l.status === "sold_private" || l.status === "sold");
  if (priv) return { outcome: "sold_private", lot: priv, lots: lots.length };
  const rna = lots.find((l) => ["rna", "unsold"].includes(l.status));
  if (rna) return { outcome: "offered_not_sold", lot: rna, lots: lots.length };
  const entered = lots.find((l) => ["withdrawn", "catalogued", "unknown"].includes(l.status));
  return { outcome: entered ? "entered_not_offered" : "not_entered", lot: entered ?? null, lots: lots.length };
}

/**
 * The cohort: one row per foal offered at a foal sale of `region` from
 * `from` to `to` (the foal sale's year), each with its later outcomes.
 * `feeFor(sireKey, coverYear)` gives the covering fee in sterling;
 * `sireMedians` and `marketMedians` are metrics.mjs's maps, read for the
 * dam's prior record and for the market's own change between the sales.
 */
export function pinhookCohort(lots, { region = "EU", from = 2015, to = 9999, feeFor = () => null, sireMedians = new Map(), marketMedians = new Map(), today = new Date() } = {}) {
  const groups = new Map();
  const byDam = new Map();
  const skipped = { noDam: 0, noSire: 0, noYear: 0 };
  for (const l of lots) {
    if (!KINDS.includes(l.sale_type) || l.sale_type === "hit") continue;
    if (!l.dam_key) {
      if (l.sale_type === "foal" && l.region === region) skipped.noDam += 1;
      continue;
    }
    (byDam.get(l.dam_key) ?? byDam.set(l.dam_key, []).get(l.dam_key)).push(l);
    const foaled = foaledOf(l);
    if (!foaled) {
      if (l.sale_type === "foal" && l.region === region) skipped.noYear += 1;
      continue;
    }
    if (!l.sire_key) {
      if (l.sale_type === "foal" && l.region === region) skipped.noSire += 1;
      continue;
    }
    const k = `${l.dam_key}|${foaled}|${l.sire_key}`;
    (groups.get(k) ?? groups.set(k, { damKey: l.dam_key, foaled, sireKey: l.sire_key, lots: [] }).get(k)).lots.push(l);
  }

  const rows = [];
  for (const g of groups.values()) {
    const foalLots = g.lots.filter((l) => l.sale_type === "foal" && l.region === region && l.year === g.foaled);
    if (!foalLots.length || g.foaled < from || g.foaled > to) continue;
    const flags = [];
    // Two foal lots in one sale: twins, or two mares of one name.
    const perSale = new Map();
    for (const l of foalLots) perSale.set(l.sale_key, (perSale.get(l.sale_key) ?? 0) + 1);
    if ([...perSale.values()].some((n) => n > 1)) flags.push("ambiguous");
    // Offered at two foal sales (Goffs in November, then Tattersalls in
    // December): the one it was sold at is the buy, else the last offered.
    const soldFoal = foalLots.filter(SOLD);
    if (soldFoal.length > 1) flags.push("foal_sold_twice");
    const foal = soldFoal[0] ?? foalLots.find((l) => !["withdrawn", "catalogued"].includes(l.status)) ?? foalLots[0];
    const bought = SOLD(foal);
    const privateFoal = foal.status === "sold_private" || (foal.status === "sold" && !bought);

    const stages = {};
    for (const stage of Object.keys(STAGES)) {
      const at = g.lots.filter((l) => l.sale_type === stage && l.year === g.foaled + STAGES[stage]);
      const o = outcomeAt(at);
      if (o.lot && sexConflict(foal.sex, o.lot.sex)) flags.push(`sex_${stage}`);
      const leg = legOf(o.lot);
      const multiple = bought && leg?.priceGbp ? round(leg.priceGbp / Number(foal.price_gbp), 3) : null;
      const foalMarket = marketMedians.get(`foal|${region}|${foal.year}`);
      const stageMarket = o.lot ? marketMedians.get(`${stage}|${o.lot.region}|${o.lot.year}`) : marketMedians.get(`${stage}|${region}|${g.foaled + STAGES[stage]}`);
      const marketMultiple = foalMarket && stageMarket ? stageMarket / foalMarket : null;
      stages[stage] = {
        outcome: o.outcome,
        lots: o.lots,
        ...leg,
        multiple,
        grossGbp: multiple !== null ? Math.round(leg.priceGbp - Number(foal.price_gbp)) : null,
        marketMultiple: round(marketMultiple, 3),
        vsMarket: multiple !== null && marketMultiple ? round(multiple / marketMultiple, 3) : null,
        complete: stageComplete(g.foaled, stage, today),
      };
    }
    stages["2yo"].viaYearling = stages.yearling.outcome === "resold" || stages.yearling.outcome === "sold_private";

    // The mare's record before this foal was sold: her earlier produce only.
    const prior = (byDam.get(g.damKey) ?? []).filter((l) => l.year < foal.year);
    const dr = prior.length ? damRecord(prior, g.damKey, { sireMedians }) : null;

    rows.push({
      damKey: g.damKey,
      sireKey: g.sireKey,
      sire: foal.sire ?? null,
      foaled: g.foaled,
      sex: foal.sex ?? null,
      foal: legOf(foal),
      bought,
      privateFoal,
      band: bought ? bandOf(Number(foal.price_gbp)) : null,
      feeGbp: feeFor(g.sireKey, g.foaled - 1) ?? null,
      damPrior: dr ? { index: dr.index, basis: dr.basis, sold: dr.sold, lots: dr.lots.length } : { index: null, basis: 0, sold: 0, lots: 0 },
      yearling: stages.yearling,
      twoyo: stages["2yo"],
      flags,
    });
  }
  rows.sort((a, b) => a.foal.year - b.foal.year || String(a.foal.saleKey).localeCompare(String(b.foal.saleKey)) || String(a.foal.lot).localeCompare(String(b.foal.lot), undefined, { numeric: true }));
  return { region, from, to, rows, skipped };
}

/** The stage of a row a return is read from: `yearling` or `2yo`. */
const legFor = (row, to) => (to === "2yo" ? row.twoyo : row.yearling);

/** Whether a row counts toward a stage's returns. */
export function counts(row, to) {
  const leg = legFor(row, to);
  if (!row.bought || !leg.complete || row.flags.some((f) => f === "ambiguous" || f.startsWith("sex_"))) return false;
  if (to === "2yo" && leg.viaYearling) return false;
  return true;
}

/** The returns of a group of cohort rows at one stage. */
export function returnsOf(rows, to = "yearling") {
  const kept = rows.filter((r) => counts(r, to));
  const by = Object.fromEntries(OUTCOMES.map((o) => [o, 0]));
  for (const r of kept) by[legFor(r, to).outcome] += 1;
  const resold = kept.filter((r) => legFor(r, to).outcome === "resold" && legFor(r, to).multiple !== null);
  const multiples = resold.map((r) => legFor(r, to).multiple);
  const gross = resold.map((r) => legFor(r, to).grossGbp);
  const vsMarket = resold.map((r) => legFor(r, to).vsMarket).filter((v) => v !== null);
  const spent = kept.reduce((a, r) => a + Number(r.foal.priceGbp), 0);
  return {
    bought: kept.length,
    ...by,
    resaleRate: kept.length ? round(by.resold / kept.length, 3) : null,
    medianMultiple: round(median(multiples), 2),
    meanMultiple: round(mean(multiples), 2),
    shareProfitGross: resold.length ? round(multiples.filter((m) => m > 1).length / resold.length, 3) : null,
    share2x: resold.length ? round(multiples.filter((m) => m >= 2).length / resold.length, 3) : null,
    medianGrossGbp: round(median(gross)),
    meanGrossGbp: round(mean(gross)),
    medianVsMarket: round(median(vsMarket), 2),
    medianFoalGbp: round(median(kept.map((r) => Number(r.foal.priceGbp)))),
    spentGbp: Math.round(spent),
  };
}

const GROUPS = {
  year: (r) => r.foal.year,
  sire: (r) => r.sireKey,
  sale: (r) => r.foal.saleKey,
  band: (r) => r.band,
  sex: (r) => (SEXES[r.sex] === "m" ? "colt" : SEXES[r.sex] === "f" ? "filly" : null),
  pinhooker: (r) => r.foal.buyer,
  resale: (r, to) => (legFor(r, to).outcome === "resold" ? legFor(r, to).saleKey : null),
};
export const GROUP_BY = Object.keys(GROUPS);

/** The returns grouped by `by` (year, sire, sale, band, sex, pinhooker, resale), groups of at least `minBought`. */
export function pinhookTable(cohort, { to = "yearling", by = "year", minBought = 1 } = {}) {
  const keyOf = GROUPS[by] ?? GROUPS.year;
  const groups = new Map();
  for (const r of cohort.rows) {
    if (!counts(r, to)) continue;
    const k = keyOf(r, to);
    if (k === null || k === undefined || k === "") continue;
    (groups.get(k) ?? groups.set(k, []).get(k)).push(r);
  }
  const rows = [];
  for (const [k, list] of groups) {
    const ret = returnsOf(list, to);
    if (ret.bought >= minBought) rows.push({ key: k, sire: by === "sire" ? list[0].sire : undefined, sale: by === "sale" || by === "resale" ? (by === "sale" ? list[0].foal.sale : legFor(list[0], to).sale) : undefined, ...ret });
  }
  rows.sort((a, b) => (by === "year" ? Number(a.key) - Number(b.key) : by === "band" ? parseInt(a.key, 10) - parseInt(b.key, 10) : b.bought - a.bought));
  const flagged = cohort.rows.filter((r) => r.flags.length).length;
  return {
    to,
    by,
    region: cohort.region,
    bands: BANDS,
    total: returnsOf(cohort.rows, to),
    offered: cohort.rows.length,
    bought: cohort.rows.filter((r) => r.bought).length,
    privateFoals: cohort.rows.filter((r) => r.privateFoal).length,
    flagged,
    skipped: cohort.skipped,
    rows,
    basis: "Gross: resale price against foal price, in sterling at each sale's date. No keep, preparation, entry or commission cost is included.",
  };
}

export default { STAGES, BANDS, OUTCOMES, GROUP_BY, bandOf, stageComplete, pinhookCohort, counts, returnsOf, pinhookTable };
