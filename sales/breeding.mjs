/**
 * Fillies and mares in the sale ring, lot by lot: what the valuation pages
 * read (9 November 2026: "a leaderboard for highest price fillies sold off the
 * track", and comparables "to help with evaluation").
 *
 * Breeding-stock lots, and horses-in-training lots that are fillies or mares
 * (a filly sold out of training at an in-training sale is a broodmare prospect
 * as often as a racehorse). Foals, yearlings and two-year-olds are not here:
 * /api/sales/runners already answers for those. The race record is not joined
 * here — the site joins each lot to Timeform's record of the horse by name,
 * dam and year — so this stays a reading of what the sale houses published.
 */
const SHOWN = new Set(["sold", "sold_private", "rna", "unsold"]);

export function breedingLots(lots, { region = null, from = null, to = null, maxAge = null, minPrice = 0, hit = true } = {}) {
  const out = [];
  for (const l of lots) {
    const kind = l.sale_type === "breeding" ? "breeding" : l.sale_type === "hit" && hit ? "hit" : null;
    if (!kind) continue;
    if (kind === "hit" && l.sex !== "filly") continue;
    if (l.sex && l.sex !== "filly") continue;
    if (!SHOWN.has(l.status)) continue;
    if (region && l.region !== region) continue;
    if (from && l.year < from) continue;
    if (to && l.year > to) continue;
    const age = l.foaling_year ? l.year - Number(l.foaling_year) : null;
    if (maxAge !== null && (age === null || age > maxAge)) continue;
    const sold = (l.status === "sold" || l.status === "sold_private") && Number(l.price_gbp) > 0;
    if (minPrice && !(sold && Number(l.price_gbp) >= minPrice)) continue;
    out.push({
      kind, source: l.source, company: l.company ?? null, sale: l.sale_key, saleName: l.sale_label ?? l.sale_name ?? null,
      region: l.region ?? null, year: l.year, month: l.sale_month ?? null, lot: l.lot ?? null,
      horse: l.horse ?? null, sire: l.sire ?? null, dam: l.dam ?? null, foaled: l.foaling_year ? Number(l.foaling_year) : null, age,
      status: l.status, price: l.price === null || l.price === undefined ? null : Number(l.price), currency: l.currency ?? null,
      priceGbp: sold ? Number(l.price_gbp) : null, bid: l.bid === null || l.bid === undefined ? null : Number(l.bid),
      buyer: l.buyer ?? null, vendor: l.vendor ?? null, record: l.record ?? null,
    });
  }
  return out.sort((a, b) => (b.priceGbp ?? -1) - (a.priceGbp ?? -1) || b.year - a.year);
}

export default { breedingLots };
