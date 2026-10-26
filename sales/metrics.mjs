/**
 * The sales market, read from the lots: how each kind of sale went year by
 * year, and how each sire's stock sold — against the market and against
 * what was paid to breed it.
 *
 * Kinds: foals, yearlings, two-year-olds (breeze-ups) and horses in
 * training; regions: Europe, the United States, Australia, New Zealand.
 * Everything is compared in sterling at the month's rates (sales/fx.mjs),
 * so a guineas sale, a euro sale and a dollar sale sit on one scale.
 *
 * For a sire, three readings of "selling well":
 *
 *   multiple   price over the fee his lot was conceived at: the median of
 *              each lot's price / covering fee. 2x is the trade's rough
 *              line for a breeder breaking even on a yearling.
 *   premium    how far his lots sold above (or below) what lots by sires
 *              at his fee sold for in the same kind of sale, region and
 *              year: log price on log fee, the market's line, and his
 *              lots' average distance from it, drawn towards nothing when
 *              there are few of them. +30% means his stock made 30% more
 *              than his fee would predict.
 *   vsMarket   the same distance from the market's median for the kind,
 *              region and year, for sires whose fee is not known.
 *
 * The covering fee is the season before the foal was born: the stallion
 * roster's fee history where it holds that season, else the European
 * workbook's fee for the sire's crop (feeHints), else the nearest season
 * the history holds within two years, marked approximate.
 */

export const KINDS = ["foal", "yearling", "2yo", "hit"];
const SOLD = (l) => l.status === "sold" && Number(l.price_gbp) > 0;
const OFFERED = (l) => !["withdrawn", "catalogued"].includes(l.status);

export function median(xs) {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(d)));

/** A group of lots as the figures a sale reports. */
export function figures(lots) {
  const offered = lots.filter(OFFERED);
  const sold = offered.filter(SOLD);
  const prices = sold.map((l) => Number(l.price_gbp));
  const tier1 = sold.filter((l) => Number(l.sale_tier) === 1).length;
  return {
    offered: offered.length,
    sold: sold.length,
    clearance: offered.length ? round(sold.length / offered.length, 3) : null,
    aggregate: Math.round(prices.reduce((a, b) => a + b, 0)),
    average: round(mean(prices)),
    median: round(median(prices)),
    top: prices.length ? Math.max(...prices) : null,
    tier1Share: sold.length ? round(tier1 / sold.length, 3) : null,
  };
}

/* --------------------------------------------------------------- fees */

/**
 * A covering-fee finder over the roster's fee history, the workbook's
 * hints and sterling rates. `history` is fee-model.json's history keyed by
 * roster id; `idOf(sireKey)` maps a sire to his roster id; `hints` maps
 * `${sireKey}|${coverYear}` to a sterling fee; `toGbp(fee, ccy, year)`.
 */
export function feeFinder({ history = {}, idOf = () => null, hints = new Map(), toGbp }) {
  return function feeFor(sireKey, coverYear) {
    const id = idOf(sireKey);
    const h = id ? history[id] : null;
    const exact = h?.points?.find((p) => p.y === coverYear);
    if (exact) {
      const gbp = toGbp(exact.fee, h.ccy, coverYear);
      if (gbp) return { gbp, approx: false, from: "roster" };
    }
    const hint = hints.get(`${sireKey}|${coverYear}`);
    if (hint) return { gbp: hint, approx: false, from: "workbook" };
    if (h?.points?.length) {
      const near = h.points
        .filter((p) => Math.abs(p.y - coverYear) <= 2 && p.fee > 0)
        .sort((a, b) => Math.abs(a.y - coverYear) - Math.abs(b.y - coverYear) || a.y - b.y)[0];
      if (near) {
        const gbp = toGbp(near.fee, h.ccy, near.y);
        if (gbp) return { gbp, approx: true, from: `roster ${near.y}` };
      }
    }
    return null;
  };
}

/* ------------------------------------------------------------- market */

const cellKey = (l) => `${l.sale_type}|${l.region}|${l.year}`;

/** The market by kind, region and year, and by sale. */
export function marketTable(lots) {
  const byCell = new Map();
  const bySale = new Map();
  for (const l of lots) {
    if (!KINDS.includes(l.sale_type)) continue;
    const k = cellKey(l);
    (byCell.get(k) ?? byCell.set(k, []).get(k)).push(l);
    const s = `${l.sale_type}|${l.sale_key}|${l.year}`;
    (bySale.get(s) ?? bySale.set(s, []).get(s)).push(l);
  }
  const cells = [...byCell.entries()].map(([k, ls]) => {
    const [type, region, year] = k.split("|");
    return { type, region, year: Number(year), ...figures(ls) };
  });
  const prev = new Map(cells.map((c) => [`${c.type}|${c.region}|${c.year}`, c]));
  for (const c of cells) {
    const p = prev.get(`${c.type}|${c.region}|${c.year - 1}`);
    c.change = p ? { median: p.median ? round(c.median / p.median - 1, 3) : null, aggregate: p.aggregate ? round(c.aggregate / p.aggregate - 1, 3) : null, clearance: p.clearance !== null && c.clearance !== null ? round(c.clearance - p.clearance, 3) : null } : null;
  }
  const sales = [...bySale.entries()].map(([k, ls]) => {
    const [type, saleKey, year] = k.split("|");
    return { type, saleKey, saleName: ls[0].sale_name, region: ls[0].region, tier: ls[0].sale_tier, year: Number(year), currency: ls[0].currency, ...figures(ls) };
  });
  cells.sort((a, b) => a.type.localeCompare(b.type) || a.region.localeCompare(b.region) || a.year - b.year);
  sales.sort((a, b) => b.year - a.year || (a.tier ?? 9) - (b.tier ?? 9) || b.aggregate - a.aggregate);
  return { cells, sales };
}

/* -------------------------------------------------------------- sires */

/** The market's line, log price on log fee, per kind, region and year. */
export function marketLines(lots, feeFor) {
  const groups = new Map();
  for (const l of lots) {
    if (!SOLD(l) || !KINDS.includes(l.sale_type) || !l.foaling_year) continue;
    const fee = feeFor(l.sire_key, l.foaling_year - 1);
    if (!fee?.gbp) continue;
    const k = cellKey(l);
    (groups.get(k) ?? groups.set(k, []).get(k)).push([Math.log(fee.gbp), Math.log(Number(l.price_gbp))]);
  }
  const lines = new Map();
  for (const [k, pts] of groups) {
    if (pts.length < 30) continue;
    const mx = mean(pts.map((p) => p[0]));
    const my = mean(pts.map((p) => p[1]));
    let sxy = 0;
    let sxx = 0;
    for (const [x, y] of pts) {
      sxy += (x - mx) * (y - my);
      sxx += (x - mx) ** 2;
    }
    const b = sxx ? sxy / sxx : 0;
    lines.set(k, { a: my - b * mx, b, n: pts.length });
  }
  return lines;
}

/** How far a set of distances (in logs) says the sire sold above his line, drawn towards nothing when few. */
const shrunk = (rs, prior = 8) => (rs.length ? Math.exp((rs.reduce((a, b) => a + b, 0) / (rs.length + prior))) - 1 : null);

/**
 * Every sire's lots of a kind in a region: by year, and over the latest
 * `window` years the kind and region have results for. A sire whose first
 * lots of the kind fall inside the window is marked by the crop he is on.
 */
export function sireTable(lots, { type, region = null, window = 3, feeFor = () => null, lines = new Map(), medians = new Map() } = {}) {
  const pool = lots.filter((l) => l.sale_type === type && (!region || l.region === region) && l.sire_key);
  const years = [...new Set(pool.filter(SOLD).map((l) => l.year))].sort((a, b) => a - b);
  const latest = years.at(-1) ?? null;
  const inWindow = new Set(years.slice(-window));
  const bySire = new Map();
  for (const l of pool) (bySire.get(l.sire_key) ?? bySire.set(l.sire_key, []).get(l.sire_key)).push(l);
  const rows = [];
  for (const [sireKey, ls] of bySire) {
    const recent = ls.filter((l) => inWindow.has(l.year));
    if (!recent.length) continue;
    const fig = figures(recent);
    const perLot = [];
    const resid = [];
    const residMarket = [];
    let approx = false;
    let feeSeen = null;
    for (const l of recent) {
      if (!SOLD(l)) continue;
      const p = Number(l.price_gbp);
      const fee = l.foaling_year ? feeFor(sireKey, l.foaling_year - 1) : null;
      const m = medians.get(cellKey(l));
      if (m) residMarket.push(Math.log(p / m));
      if (!fee?.gbp) continue;
      approx = approx || fee.approx;
      feeSeen = fee;
      perLot.push(p / fee.gbp);
      const line = lines.get(cellKey(l));
      if (line) resid.push(Math.log(p) - (line.a + line.b * Math.log(fee.gbp)));
    }
    const byYear = {};
    for (const y of [...new Set(ls.map((l) => l.year))].sort()) {
      const yl = ls.filter((l) => l.year === y);
      const f = figures(yl);
      const fee = yl[0]?.foaling_year ? feeFor(sireKey, yl[0].foaling_year - 1) : null;
      byYear[y] = { offered: f.offered, sold: f.sold, median: f.median, clearance: f.clearance, fee: fee?.gbp ? Math.round(fee.gbp) : null, multiple: f.median && fee?.gbp ? round(f.median / fee.gbp, 2) : null };
    }
    const soldYears = Object.entries(byYear).filter(([, v]) => v.sold > 0).map(([y]) => Number(y));
    const first = soldYears[0] ?? null;
    const medYears = Object.entries(byYear).filter(([y, v]) => inWindow.has(Number(y)) && v.median).map(([y, v]) => [Number(y), v.median]);
    const trend = medYears.length >= 2 ? round(medYears.at(-1)[1] / medYears[0][1] - 1, 3) : null;
    const premium = shrunk(resid);
    rows.push({
      sireKey,
      sire: ls.find((l) => l.sire)?.sire ?? sireKey,
      ...fig,
      fee: feeSeen?.gbp ? Math.round(feeSeen.gbp) : null,
      feeApprox: approx || undefined,
      multiple: round(median(perLot), 2),
      share2x: perLot.length ? round(perLot.filter((x) => x >= 2).length / perLot.length, 3) : null,
      premium: round(premium, 3),
      vsMarket: round(shrunk(residMarket), 3),
      trend,
      firstYear: first,
      cropsInData: soldYears.length,
      young: first !== null && years[0] !== undefined && first > years[0] && latest - first <= 2,
      byYear,
      verdict: verdictOf({ sold: fig.sold, premium, vsMarket: shrunk(residMarket) }),
    });
  }
  rows.sort((a, b) => (b.aggregate ?? 0) - (a.aggregate ?? 0));
  return { type, region, years: [...inWindow], latest, rows };
}

/** "selling well", "selling poorly" or neither, from how far above or below his line the sire sold. */
export function verdictOf({ sold, premium, vsMarket }) {
  if (!sold || sold < 6) return null;
  const r = premium ?? vsMarket;
  if (r === null || r === undefined) return null;
  if (r >= 0.2) return "well";
  if (r <= -0.2) return "poorly";
  return null;
}

/* ---------------------------------------------------- horses in training */

/**
 * Horses in training by sire: how many were sold early (aged two or three
 * at the sale — moved on after a season or two), their clearance and
 * median. The share sold early says how much of a sire's stock is traded
 * on before it has had a full career: a market that buys early buys
 * prospects, a sire whose stock all comes up at five is selling ex-racers.
 */
export function hitTable(lots, { region = null, window = 3 } = {}) {
  const pool = lots.filter((l) => l.sale_type === "hit" && (!region || l.region === region) && l.sire_key);
  const years = [...new Set(pool.filter(SOLD).map((l) => l.year))].sort((a, b) => a - b);
  const inWindow = new Set(years.slice(-window));
  const bySire = new Map();
  for (const l of pool) if (inWindow.has(l.year)) (bySire.get(l.sire_key) ?? bySire.set(l.sire_key, []).get(l.sire_key)).push(l);
  const rows = [];
  for (const [sireKey, ls] of bySire) {
    const offered = ls.filter(OFFERED);
    const early = offered.filter((l) => l.foaling_year && l.year - l.foaling_year <= 3);
    const fig = figures(ls);
    const earlySold = early.filter(SOLD);
    rows.push({
      sireKey,
      sire: ls.find((l) => l.sire)?.sire ?? sireKey,
      ...fig,
      early: early.length,
      earlyShare: offered.length ? round(early.length / offered.length, 3) : null,
      earlySold: earlySold.length,
      earlyMedian: round(median(earlySold.map((l) => Number(l.price_gbp)))),
    });
  }
  rows.sort((a, b) => b.offered - a.offered);
  return { region, years: [...inWindow], rows };
}

/* ---------------------------------------------------------- a mare */

/**
 * A mare's produce at auction, and how far it sold above or below its
 * sire's median for the kind, region and year: her commercial index. 1.4
 * means her foals have made 40% more than their sires' stock did.
 */
export function damRecord(lots, damKey, { sireMedians = new Map() } = {}) {
  const mine = lots.filter((l) => l.dam_key === damKey && KINDS.includes(l.sale_type));
  const ratios = [];
  const items = mine
    .sort((a, b) => a.year - b.year)
    .map((l) => {
      const ref = sireMedians.get(`${l.sire_key}|${l.sale_type}|${l.region}|${l.year}`);
      const ratio = SOLD(l) && ref ? Number(l.price_gbp) / ref : null;
      if (ratio) ratios.push(ratio);
      return { year: l.year, sale: l.sale_name, type: l.sale_type, lot: l.lot, sire: l.sire, sex: l.sex, status: l.status, price: l.price, currency: l.currency, priceGbp: l.price_gbp, sireMedianGbp: ref ? Math.round(ref) : null, ratio: round(ratio, 2) };
    });
  const index = ratios.length ? Math.exp(ratios.reduce((a, r) => a + Math.log(r), 0) / (ratios.length + 1)) : null;
  return { damKey, lots: items, sold: items.filter((i) => i.status === "sold").length, index: round(index, 2), basis: ratios.length };
}

/** Each sire's median by kind, region and year: `${sireKey}|${type}|${region}|${year}` -> sterling median. */
export function sireMedians(lots) {
  const groups = new Map();
  for (const l of lots) {
    if (!SOLD(l) || !l.sire_key) continue;
    const k = `${l.sire_key}|${l.sale_type}|${l.region}|${l.year}`;
    (groups.get(k) ?? groups.set(k, []).get(k)).push(Number(l.price_gbp));
  }
  const out = new Map();
  for (const [k, ps] of groups) if (ps.length >= 3) out.set(k, median(ps));
  return out;
}

/** The market's median by kind, region and year. */
export function marketMedians(lots) {
  const groups = new Map();
  for (const l of lots) {
    if (!SOLD(l)) continue;
    const k = cellKey(l);
    (groups.get(k) ?? groups.set(k, []).get(k)).push(Number(l.price_gbp));
  }
  return new Map([...groups].map(([k, ps]) => [k, median(ps)]));
}

export default { KINDS, median, figures, feeFinder, marketTable, marketLines, sireTable, verdictOf, hitTable, damRecord, sireMedians, marketMedians };
