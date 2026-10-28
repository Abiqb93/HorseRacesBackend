/**
 * A runner's own record in the sale ring: every lot that was this horse.
 *
 * A horse is usually sold before it has a name (a foal, a yearling), so a
 * lot is matched to a runner by its dam, sire and foaling year, the three
 * things a race result and a catalogue both give. The dam alone is not
 * enough: a mare can have a foal by the same sire in another year, and two
 * mares can share a name across countries. A lot without a foaling year
 * takes the one its sale implies (a foal is sold in its first year, a
 * yearling in its second, a two-year-old in its third); a horse in training
 * without one can be any age, so it is left out rather than guessed.
 */
import { KINDS } from "./metrics.mjs";
import { nameKey } from "./normalise.mjs";

// Statuses that say something about the horse. A lot withdrawn before the
// ring, or one whose outcome the source did not give, is left out.
const SHOWN = new Set(["sold", "sold_private", "rna", "unsold", "catalogued"]);

const AGE_AT_SALE = { foal: 0, yearling: 1, "2yo": 2 };

/** The year a lot was foaled: its own, or the one its sale implies. */
export function foaledOf(lot) {
  if (lot.foaling_year) return Number(lot.foaling_year);
  const age = AGE_AT_SALE[lot.sale_type];
  // Southern-hemisphere ages run from August 1st, so a yearling sold in
  // Australia in January was foaled two calendar years before.
  if (age === undefined || ["AUS", "NZ"].includes(lot.region)) return null;
  return lot.year - age;
}

const byDamCache = new WeakMap();
function lotsByDam(lots) {
  let map = byDamCache.get(lots);
  if (!map) {
    map = new Map();
    for (const l of lots) {
      if (!l.dam_key || !KINDS.includes(l.sale_type)) continue;
      (map.get(l.dam_key) ?? map.set(l.dam_key, []).get(l.dam_key)).push(l);
    }
    byDamCache.set(lots, map);
  }
  return map;
}

/**
 * The lots that were this runner, oldest first. `foaled` is the runner's
 * foaling year (or a date it starts with); `sire` is checked where the lot
 * names one.
 */
export function runnerSales(lots, { dam, sire, foaled }) {
  const damKey = nameKey(dam);
  const year = Number(String(foaled ?? "").slice(0, 4));
  if (!damKey || !year) return [];
  const sireKey = nameKey(sire);
  return (lotsByDam(lots).get(damKey) ?? [])
    .filter((l) => SHOWN.has(l.status) && foaledOf(l) === year && (!sireKey || !l.sire_key || l.sire_key === sireKey))
    .sort((a, b) => a.year - b.year || KINDS.indexOf(a.sale_type) - KINDS.indexOf(b.sale_type))
    .map((l) => ({
      year: l.year,
      sale: l.sale_name,
      company: l.company,
      type: l.sale_type,
      lot: l.lot,
      status: l.status,
      price: l.status === "sold" && Number(l.price) > 0 ? Number(l.price) : null,
      currency: l.currency,
    }));
}

export default { foaledOf, runnerSales };
