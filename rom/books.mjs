/**
 * Return of Mares: every stallion's book year by year, what was in it, and
 * what came of it.
 *
 * Weatherbys' Return of Mares lists each mare covered in Britain and Ireland,
 * by whom and at what fee. The user's files add, for 2018 on, each mare's own
 * class on the flat and over jumps and her best progeny's; for 2021–2023,
 * what each covering produced a year on; and for every covering to 2023, the
 * foal's Timeform rating and whether it ran and reached 95, 105 and 115.
 * A record is one covering:
 *
 *   y      covering year           mare, myob, msire, mdam   the mare
 *   st     the stallion            fee (GBP), ccy, amt       the fee
 *   mf     her flat class          mnh    her jumps class     mbp  her best progeny's flat class
 *   ret    what she produced: foal, died (a live foal since died), barren,
 *          slipped, dead, abortion, none (not returned)
 *   rt     the foal's Timeform rating;  ran, r95, r105, r115  0 or 1
 *
 * `buildIndex` reads them into books (coverings per stallion per year), the
 * book's quality (black-type mares, winners, mares already dams of a 95+
 * horse), its fertility (live foals reported per mare covered), its results
 * (runners, 95+, 105+, 115+ per mare covered and per runner) and, for the
 * mating plan, his results with mares by each sire. `insights` reads the
 * index for what moved and what it means.
 */

/** The classes the returns write for a mare's racing, best last. */
export const CLASSES = ["Unr", "Upl", "Pl", "W", "SPl", "GrPl", "LW", "G3W", "G2W", "G1W"];
export const BLACK_TYPE = new Set(["SPl", "GrPl", "LW", "G3W", "G2W", "G1W"]);
export const WINNER = new Set(["W", "LW", "G3W", "G2W", "G1W"]);
const RAN_OVER_JUMPS = new Set(["Pl", "W", "SPl", "GrPl", "LW", "G3W", "G2W", "G1W"]);

const strip = (v) => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());

/** A horse's name for joining: no country, no punctuation, lower case. */
export const nameKey = (v) =>
  strip(v)
    .replace(/\s*\([A-Z]{2,4}\)\s*$/, "")
    .toLowerCase()
    .replace(/[''`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** "Blue Point (IRE)" → { name: "Blue Point", country: "IRE" }; capitals put back to words. */
export function splitName(raw) {
  const s = strip(raw);
  const m = s.match(/^(.*?)\s*\(([A-Z]{2,4})\)\s*$/);
  let name = m ? m[1] : s;
  if (name && name === name.toUpperCase() && /[A-Z]/.test(name)) name = name.toLowerCase().replace(/(^|[\s-])([a-z])/g, (x, p, c) => p + c.toUpperCase());
  return { name, country: m ? m[2] : null };
}

const median = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
};
const share = (a, b) => (b ? a / b : null);
/** A Timeform rating: the files write 0 where a foal has none. */
const rated = (rt) => Number.isFinite(rt) && rt > 0;

/** The fee bands a book is compared within. */
export const FEE_BANDS = [
  { key: "u5", label: "under £5k", lo: 0, hi: 5000 },
  { key: "5-10", label: "£5k–£10k", lo: 5000, hi: 10000 },
  { key: "10-20", label: "£10k–£20k", lo: 10000, hi: 20000 },
  { key: "20-40", label: "£20k–£40k", lo: 20000, hi: 40000 },
  { key: "40-80", label: "£40k–£80k", lo: 40000, hi: 80000 },
  { key: "80+", label: "£80k and up", lo: 80000, hi: Infinity },
];
export const feeBand = (fee) => (Number.isFinite(fee) && fee > 0 ? FEE_BANDS.find((b) => fee >= b.lo && fee < b.hi)?.key ?? null : null);

const blank = () => ({ covers: 0, fees: [], q: { n: 0, bt: 0, w: 0, pl: 0, upl: 0, unr: 0, dbt: 0, nhN: 0, nh: 0, proven: 0, provenN: 0 }, ret: null, res: null });

/**
 * The years whose foals have run enough to be read: runners per mare covered
 * at least four-fifths of the typical year's. Later years have only their
 * first runners in.
 */
export function readableYears(rows) {
  const by = new Map();
  for (const r of rows) {
    if (r.ran === undefined || r.ran === null) continue;
    const b = by.get(r.y) ?? by.set(r.y, { n: 0, ran: 0 }).get(r.y);
    b.n += 1;
    b.ran += r.ran ? 1 : 0;
  }
  const rates = [...by.entries()].map(([y, b]) => [y, b.ran / b.n]).sort((a, b) => a[0] - b[0]);
  const typical = median(rates.map(([, r]) => r * 1000)) / 1000;
  const through = rates.filter(([, r]) => r >= 0.8 * typical).map(([y]) => y);
  return { resultsThrough: through.length ? Math.max(...through) : null, firstRunners: rates.filter(([y, r]) => r > 0 && r < 0.8 * typical).map(([y]) => y), typical };
}

/** Flat, jumps or both: by his foals' flat runners where they are known, else by his mares' jumps racing. */
export function codeOf(s, resultsThrough) {
  let covers = 0;
  let ran = 0;
  for (const [y, r] of Object.entries(s.years)) {
    if (!r.res || Number(y) > resultsThrough) continue;
    covers += r.res.covers;
    ran += r.res.ran;
  }
  if (covers >= 30) {
    const rate = ran / covers;
    return rate < 0.08 ? "jumps" : rate >= 0.15 ? "flat" : "mixed";
  }
  let nhN = 0;
  let nh = 0;
  for (const r of Object.values(s.years)) {
    nhN += r.q.nhN;
    nh += r.q.nh;
  }
  if (nhN >= 10) {
    const rate = nh / nhN;
    return rate >= 0.1 ? "jumps" : rate < 0.03 ? "flat" : "mixed";
  }
  return "unknown";
}

/**
 * Everything the pages read, from the coverings.
 *
 * Returns { years, resultsThrough, firstRunners, totals, stallions, crosses, mares }
 * where `stallions` is Map(key → stallion) with `years[y]` holding his book
 * that year, `crosses` Map(stallion key → Map(mare's sire key → record)) for
 * the readable years, and `mares` Map(mare key → her coverings).
 */
export function buildIndex(rows) {
  const { resultsThrough, firstRunners, typical } = readableYears(rows);
  const years = [...new Set(rows.map((r) => r.y))].filter(Number.isFinite).sort((a, b) => a - b);

  // When each mare first had a 95+ foal: the foal born the year after a
  // covering. A mare is counted proven at a covering once that foal was old
  // enough to have shown it: three or more years before.
  const proven95 = new Map();
  for (const r of rows) {
    if (!r.r95 || !r.mare) continue;
    const k = `${nameKey(r.mare)}|${r.myob ?? ""}`;
    const born = r.y + 1;
    if (!proven95.has(k) || born < proven95.get(k)) proven95.set(k, born);
  }

  const stallions = new Map();
  const crosses = new Map();
  const mares = new Map();
  const names = new Map();
  const nameOf = (raw) => {
    const k = nameKey(raw);
    if (!names.has(k)) names.set(k, splitName(raw));
    return k;
  };

  for (const r of rows) {
    if (!r.st || !Number.isFinite(r.y)) continue;
    const k = nameOf(r.st);
    const s = stallions.get(k) ?? stallions.set(k, { key: k, years: {} }).get(k);
    const yr = s.years[r.y] ?? (s.years[r.y] = blank());
    yr.covers += 1;
    if (Number.isFinite(r.fee) && r.fee > 0) yr.fees.push(r.fee);

    const q = yr.q;
    if (r.mf) {
      q.n += 1;
      if (BLACK_TYPE.has(r.mf)) q.bt += 1;
      if (WINNER.has(r.mf)) q.w += 1;
      if (r.mf === "Pl") q.pl += 1;
      if (r.mf === "Upl") q.upl += 1;
      if (r.mf === "Unr") q.unr += 1;
      if (BLACK_TYPE.has(r.mbp)) q.dbt += 1;
    }
    if (r.mnh) {
      q.nhN += 1;
      if (RAN_OVER_JUMPS.has(r.mnh)) q.nh += 1;
    }
    if (r.mare) {
      q.provenN += 1;
      const first = proven95.get(`${nameKey(r.mare)}|${r.myob ?? ""}`);
      if (first && first <= r.y - 3) q.proven += 1;
    }

    if (r.ret) {
      const t = yr.ret ?? (yr.ret = { n: 0, foal: 0, died: 0, barren: 0, slipped: 0, dead: 0, abortion: 0, none: 0, other: 0 });
      t.n += 1;
      t[r.ret] = (t[r.ret] ?? 0) + 1;
    }

    if (r.ran !== undefined && r.ran !== null) {
      const res = yr.res ?? (yr.res = { covers: 0, ran: 0, r95: 0, r105: 0, r115: 0, rated: 0, sum: 0, best: null });
      res.covers += 1;
      res.ran += r.ran ? 1 : 0;
      res.r95 += r.r95 ? 1 : 0;
      res.r105 += r.r105 ? 1 : 0;
      res.r115 += r.r115 ? 1 : 0;
      if (rated(r.rt)) {
        res.rated += 1;
        res.sum += r.rt;
        if (!res.best || r.rt > res.best.rt) res.best = { rt: r.rt, mare: splitName(r.mare).name, born: r.y + 1 };
      }
      if (r.msire && resultsThrough && r.y <= resultsThrough) {
        const mk = nameOf(r.msire);
        const byMare = crosses.get(k) ?? crosses.set(k, new Map()).get(k);
        const c = byMare.get(mk) ?? byMare.set(mk, { covers: 0, ran: 0, r95: 0, r105: 0, r115: 0 }).get(mk);
        c.covers += 1;
        c.ran += r.ran ? 1 : 0;
        c.r95 += r.r95 ? 1 : 0;
        c.r105 += r.r105 ? 1 : 0;
        c.r115 += r.r115 ? 1 : 0;
      }
    }

    if (r.mare) {
      const mk = `${nameKey(r.mare)}|${r.myob ?? ""}`;
      const m = mares.get(mk) ?? mares.set(mk, { mare: r.mare, myob: r.myob ?? null, msire: null, mdam: null, c: [] }).get(mk);
      if (!m.msire && r.msire) m.msire = r.msire;
      if (!m.mdam && r.mdam) m.mdam = r.mdam;
      m.c.push(compactCovering(r, k));
    }
  }

  for (const s of stallions.values()) {
    Object.assign(s, names.get(s.key));
    for (const yr of Object.values(s.years)) {
      yr.fee = median(yr.fees);
      delete yr.fees;
    }
    s.code = codeOf(s, resultsThrough);
  }

  return { years, resultsThrough, firstRunners, typicalRan: typical, totals: totalsOf(years, stallions), stallions, crosses, mares, names };
}

// What a mare's own page needs of a covering, small enough to hold every
// one: [year, stallion key, fee, amount, currency, return, foal's sex, foaling
// date, rating, ran/95/105/115 as bits, her class].
function compactCovering(r, stallionKey) {
  const bits = (r.ran ? 1 : 0) | (r.r95 ? 2 : 0) | (r.r105 ? 4 : 0) | (r.r115 ? 8 : 0) | (r.ran === undefined || r.ran === null ? 16 : 0);
  return [r.y, stallionKey, r.fee ?? null, r.amt ?? null, r.ccy ?? null, r.ret ?? null, r.fsex ?? null, r.fdate ?? null, rated(r.rt) ? r.rt : null, bits, r.mf ?? null];
}

function openCovering(t) {
  const [y, st, fee, amt, ccy, ret, fsex, fdate, rt, bits, mf] = t;
  const known = !(bits & 16);
  return { y, st, fee, amt, ccy, ret, fsex, fdate, rt, ran: known ? Boolean(bits & 1) : null, r95: known ? Boolean(bits & 2) : null, r105: known ? Boolean(bits & 4) : null, r115: known ? Boolean(bits & 8) : null, mf };
}

/** Each year across every stallion, flat and jumps apart. */
function totalsOf(years, stallions) {
  return years.map((y) => {
    const t = { y, covers: 0, stallions: 0, flat: { covers: 0, stallions: 0, books: [], fees: [], q: { n: 0, bt: 0, w: 0, unr: 0 }, ret: { n: 0, foal: 0, died: 0, none: 0 }, res: { covers: 0, ran: 0, r95: 0, r105: 0, r115: 0 } }, jumps: { covers: 0, stallions: 0 } };
    for (const s of stallions.values()) {
      const yr = s.years[y];
      if (!yr) continue;
      t.covers += yr.covers;
      t.stallions += 1;
      const side = s.code === "jumps" ? t.jumps : t.flat;
      side.covers += yr.covers;
      side.stallions += 1;
      if (yr.covers >= 10) side.stallions10 = (side.stallions10 ?? 0) + 1;
      if (side !== t.flat) continue;
      t.flat.books.push(yr.covers);
      if (yr.fee) for (let i = 0; i < yr.covers; i += 1) t.flat.fees.push(yr.fee);
      for (const f of ["n", "bt", "w", "unr"]) t.flat.q[f] += yr.q[f];
      if (yr.ret) for (const f of ["n", "foal", "died", "none"]) t.flat.ret[f] += yr.ret[f] ?? 0;
      if (yr.res) for (const f of ["covers", "ran", "r95", "r105", "r115"]) t.flat.res[f] += yr.res[f];
    }
    const books = t.flat.books.sort((a, b) => b - a);
    const sum = books.reduce((a, b) => a + b, 0);
    // Some years' returns list a few hundred more stallions with a mare or
    // two each; stallions and the average book count those with ten or more.
    const real = books.filter((b) => b >= 10);
    t.flat.top10 = share(books.slice(0, 10).reduce((a, b) => a + b, 0), sum);
    t.flat.stallions10 = real.length;
    t.flat.books100 = books.filter((b) => b >= 100).length;
    t.flat.books150 = books.filter((b) => b >= 150).length;
    t.flat.biggest = books[0] ?? null;
    t.flat.meanBook = real.length ? Math.round((real.reduce((a, b) => a + b, 0) / real.length) * 10) / 10 : null;
    t.flat.medianFee = median(t.flat.fees);
    delete t.flat.books;
    delete t.flat.fees;
    if (!t.flat.q.n) t.flat.q = null;
    if (!t.flat.ret.n) t.flat.ret = null;
    if (!t.flat.res.covers) t.flat.res = null;
    return t;
  });
}

/** A stallion's results over the readable years, summed. */
export function resultsOf(s, resultsThrough) {
  const out = { crops: 0, covers: 0, ran: 0, r95: 0, r105: 0, r115: 0, rated: 0, sum: 0, best: null, from: null, to: null };
  for (const [y, yr] of Object.entries(s.years)) {
    if (!yr.res || Number(y) > resultsThrough) continue;
    out.crops += 1;
    for (const f of ["covers", "ran", "r95", "r105", "r115", "rated", "sum"]) out[f] += yr.res[f];
    if (yr.res.best && (!out.best || yr.res.best.rt > out.best.rt)) out.best = yr.res.best;
    out.from = out.from === null ? Number(y) : Math.min(out.from, Number(y));
    out.to = out.to === null ? Number(y) : Math.max(out.to, Number(y));
  }
  out.mean = out.rated ? Math.round((out.sum / out.rated) * 10) / 10 : null;
  delete out.sum;
  return out.covers ? out : null;
}

/** His book's mares over the years their class is known. */
export function qualityOf(s, { from = null } = {}) {
  const q = { n: 0, bt: 0, w: 0, unr: 0, dbt: 0, proven: 0, provenN: 0 };
  for (const [y, yr] of Object.entries(s.years)) {
    if (from && Number(y) < from) continue;
    for (const f of Object.keys(q)) q[f] += yr.q[f] ?? 0;
  }
  return q.n || q.provenN ? q : null;
}

/** Live foals reported per mare covered, over the years the returns are held. */
export function fertilityOf(s) {
  const f = { n: 0, live: 0, none: 0 };
  for (const yr of Object.values(s.years)) {
    if (!yr.ret) continue;
    f.n += yr.ret.n;
    f.live += (yr.ret.foal ?? 0) + (yr.ret.died ?? 0);
    f.none += yr.ret.none ?? 0;
  }
  return f.n ? f : null;
}

/**
 * The table row of a stallion: books by year in `years` order, the latest
 * and the change on the year before, his fee, his book's quality and his
 * results. `seasons` counts the years he covered in the return.
 */
export function rowOf(s, index) {
  const { years, resultsThrough } = index;
  const books = years.map((y) => s.years[y]?.covers ?? 0);
  const fees = years.map((y) => s.years[y]?.fee ?? null);
  const active = years.filter((y) => s.years[y]);
  const last = active.at(-1) ?? null;
  const prev = last !== null && s.years[last - 1] ? s.years[last - 1].covers : 0;
  const peakY = active.reduce((b, y) => (b === null || s.years[y].covers > s.years[b].covers ? y : b), null);
  const latestQ = [...active].reverse().find((y) => s.years[y].q.n >= 10);
  return {
    key: s.key,
    name: s.name,
    country: s.country,
    code: s.code,
    first: active[0] ?? null,
    last,
    seasons: active.length,
    books,
    fees,
    latest: last !== null ? s.years[last].covers : 0,
    prev,
    peak: peakY !== null ? { y: peakY, n: s.years[peakY].covers } : null,
    fee: last !== null ? s.years[last].fee : null,
    quality: latestQ ? { y: latestQ, ...pick(s.years[latestQ].q, ["n", "bt", "w", "unr", "dbt"]) } : null,
    fertility: fertilityOf(s),
    results: resultsOf(s, resultsThrough),
  };
}

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

/** One stallion in full: each year's book, its mares, its foals and their results, and his best crosses. */
export function detailOf(s, index, { crossLimit = 30 } = {}) {
  const row = rowOf(s, index);
  const years = index.years
    .filter((y) => s.years[y])
    .map((y) => {
      const yr = s.years[y];
      return {
        y,
        covers: yr.covers,
        fee: yr.fee,
        quality: yr.q.n || yr.q.provenN ? yr.q : null,
        returns: yr.ret,
        results: yr.res ? { ...yr.res, mean: yr.res.rated ? Math.round((yr.res.sum / yr.res.rated) * 10) / 10 : null, sum: undefined, readable: y <= index.resultsThrough } : null,
      };
    });
  const byMare = index.crosses.get(s.key) ?? new Map();
  const crosses = [...byMare.entries()]
    .map(([k, c]) => ({ sire: index.names.get(k)?.name ?? k, key: k, ...c }))
    .filter((c) => c.covers >= 3)
    .sort((a, b) => b.r95 - a.r95 || b.covers - a.covers)
    .slice(0, crossLimit);
  return { ...row, years, crosses };
}

/** His record with mares by one sire, over the readable years. */
export function crossOf(index, stallionKey, mareSire) {
  const c = index.crosses.get(stallionKey)?.get(nameKey(mareSire));
  return c ? { sire: index.names.get(nameKey(mareSire))?.name ?? mareSire, ...c } : null;
}

/** A mare's coverings in the return, by name and, where given, foaling year. */
export function mareOf(index, name, yob = null) {
  const k = nameKey(name);
  const matches = [...index.mares.entries()].filter(([mk]) => mk.startsWith(`${k}|`) && (!yob || mk === `${k}|${yob}`));
  if (!matches.length) return { found: false, candidates: [] };
  if (matches.length > 1) return { found: false, candidates: matches.map(([mk, m]) => ({ yob: Number(mk.split("|")[1]) || null, coverings: m.c.length, msire: m.msire })) };
  const [, m] = matches[0];
  const coverings = m.c
    .map(openCovering)
    .sort((a, b) => a.y - b.y)
    .map((c) => ({ ...c, stallion: index.names.get(c.st)?.name ?? c.st, country: index.names.get(c.st)?.country ?? null, readable: c.y <= index.resultsThrough }));
  return { found: true, name: splitName(m.mare).name, country: splitName(m.mare).country, yob: m.myob, msire: m.msire, mdam: m.mdam, coverings };
}

/**
 * What moved, and what it means: risers and fallers on the year; the usual
 * life of a book from his first season on, and who has held his; the books
 * that got the best mares; results against what the fee paid for, and the
 * cost in fees of each 95+ horse. Flat stallions only.
 */
export function insights(index, { minPrev = 40, minRunners = 40 } = {}) {
  const { years, resultsThrough } = index;
  const flat = [...index.stallions.values()].filter((s) => s.code !== "jumps");
  const last = years.at(-1);
  const prevY = last - 1;

  const moves = flat
    .map((s) => ({ s, now: s.years[last]?.covers ?? 0, before: s.years[prevY]?.covers ?? 0 }))
    .filter((m) => m.before >= minPrev || m.now >= minPrev)
    .map((m) => ({ key: m.s.key, name: m.s.name, now: m.now, before: m.before, change: m.now - m.before, pct: m.before ? (m.now - m.before) / m.before : null }));
  const risers = moves.filter((m) => m.change > 0 && m.before > 0).sort((a, b) => b.change - a.change).slice(0, 8);
  const fallers = moves.filter((m) => m.change < 0).sort((a, b) => a.change - b.change).slice(0, 8);
  const newcomers = moves.filter((m) => m.before === 0 && m.now >= minPrev && !years.slice(0, -1).some((y) => index.stallions.get(m.key).years[y])).sort((a, b) => b.now - a.now).slice(0, 8);

  // A book's life: seasons counted from his first in the return, for those
  // who began after its first year (so the first season is truly his first)
  // with a first book of fifty or more: a stallion standing commercially.
  const bySeason = new Map();
  const held = [];
  for (const s of flat) {
    const active = years.filter((y) => s.years[y]);
    if (!active.length || active[0] === years[0]) continue;
    const first = active[0];
    if (s.years[first].covers < 50) continue;
    for (const y of active) {
      const season = y - first + 1;
      const list = bySeason.get(season) ?? bySeason.set(season, []).get(season);
      list.push(s.years[y].covers);
    }
    const firstBook = s.years[first].covers;
    const nowBook = s.years[last]?.covers ?? 0;
    const seasonNow = last - first + 1;
    if (seasonNow >= 5 && firstBook >= 60 && nowBook >= firstBook) held.push({ key: s.key, name: s.name, first, firstBook, now: nowBook, season: seasonNow });
  }
  const life = [...bySeason.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, list]) => list.length >= 10)
    .map(([season, list]) => ({ season, stallions: list.length, median: median(list), mean: Math.round(list.reduce((a, b) => a + b, 0) / list.length), over100: list.filter((n) => n >= 100).length }));

  // Results against the fee: each fee band's 95+ per runner, and each
  // stallion's runners read against the band their dams were covered in.
  const band = new Map();
  for (const s of flat) {
    for (const [y, yr] of Object.entries(s.years)) {
      if (!yr.res || Number(y) > resultsThrough) continue;
      const b = feeBand(yr.fee);
      if (!b) continue;
      const t = band.get(b) ?? band.set(b, { ran: 0, r95: 0, r105: 0, covers: 0, fees: 0 }).get(b);
      t.ran += yr.res.ran;
      t.r95 += yr.res.r95;
      t.r105 += yr.res.r105;
      t.covers += yr.res.covers;
    }
  }
  const bandRate = (b) => {
    const t = band.get(b);
    return t && t.ran ? t.r95 / t.ran : null;
  };
  const value = [];
  const versusFee = [];
  for (const s of flat) {
    let ran = 0;
    let r95 = 0;
    let expected = 0;
    let feesPaid = 0;
    let covers = 0;
    for (const [y, yr] of Object.entries(s.years)) {
      if (!yr.res || Number(y) > resultsThrough) continue;
      // a year whose fee is private is read neither way: what his runners
      // did is set against what the same years' fees bought
      const rate = bandRate(feeBand(yr.fee));
      if (rate === null) continue;
      ran += yr.res.ran;
      r95 += yr.res.r95;
      covers += yr.res.covers;
      expected += rate * yr.res.ran;
      feesPaid += yr.fee * yr.res.covers;
    }
    if (ran < minRunners) continue;
    if (expected > 0) versusFee.push({ key: s.key, name: s.name, ran, r95, expected: Math.round(expected * 10) / 10, ratio: r95 / expected, fee: median(Object.values(s.years).map((yr) => yr.fee)) });
    if (r95 >= 3 && feesPaid > 0) value.push({ key: s.key, name: s.name, covers, r95, feesPaid, per95: Math.round(feesPaid / r95) });
  }
  versusFee.sort((a, b) => b.ratio - a.ratio);
  value.sort((a, b) => a.per95 - b.per95);

  // The books with the best mares in the latest year their class is known.
  const qYear = [...years].reverse().find((y) => flat.some((s) => s.years[y]?.q.n >= 30));
  const bestMares = qYear
    ? flat
        .filter((s) => s.years[qYear]?.q.n >= 40)
        .map((s) => ({ key: s.key, name: s.name, y: qYear, mares: s.years[qYear].q.n, bt: s.years[qYear].q.bt / s.years[qYear].q.n, w: s.years[qYear].q.w / s.years[qYear].q.n, fee: s.years[qYear].fee }))
        .sort((a, b) => b.bt - a.bt)
        .slice(0, 10)
    : [];

  return {
    year: last,
    risers,
    fallers,
    newcomers,
    life,
    held: held.sort((a, b) => b.now / b.firstBook - a.now / a.firstBook).slice(0, 10),
    feeBands: FEE_BANDS.map((b) => ({ ...b, hi: Number.isFinite(b.hi) ? b.hi : null, ...(band.get(b.key) ?? {}), rate95: bandRate(b.key) })),
    over: versusFee.slice(0, 10),
    under: versusFee.slice(-10).reverse(),
    value: value.slice(0, 10),
    bestMares,
  };
}
