/**
 * A mare's foals as Arion lists them: each foal under its dam's name, country
 * and year ("All of Me (GB) 2014"), which is the Stallion x Mare match by the
 * mare's birth year (18 November 2026: "They need to match by Stallion x Mare
 * (using the mares birth year)").
 *
 * Arion's search by dam is by the start of the name and lists at most thirty
 * foals across every mare of the name, so a common name can lose some of a
 * mare's foals off the end. What the list says is used where it settles a
 * foal: listed under her, it is hers; listed under another mare of the name,
 * it is hers. Anything it does not list is left to the age and sire rules
 * (mating.mjs hersOnly), with the other mares Arion names counted as dams.
 */

/** "All of Me (GB) 2014" -> { name, country, year }. */
export function damOfLabel(s) {
  const m = String(s ?? "").trim().match(/^(.*?)\s*(?:\(([A-Za-z]{2,4})\))?\s*(\d{4})?$/);
  return { name: (m?.[1] ?? "").trim(), country: m?.[2] ? m[2].toUpperCase() : null, year: m?.[3] ? Number(m[3]) : null };
}

/** A name as a key: Arion writes "Biv s Song" for Biv's Song. */
export const foalKey = (n) =>
  String(n ?? "")
    .toLowerCase()
    .replace(/^[=*$]+/, "")
    .replace(/\s*\([a-z]{2,4}\)\s*$/, "")
    .replace(/['’]/g, "")
    .replace(/(\w) s\b/g, "$1s")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Arion's candidates, grouped by dam: only mares of exactly this name. */
export function damGroups(candidates = [], damName) {
  const want = foalKey(damName);
  const groups = new Map();
  for (const c of candidates) {
    const cells = c?.cells ?? [];
    const dam = damOfLabel(cells[4]);
    if (foalKey(dam.name) !== want) continue;
    const label = `${dam.name}|${dam.country ?? ""}|${dam.year ?? ""}`;
    if (!groups.has(label)) groups.set(label, { ...dam, foals: [] });
    const name = String(cells[0] ?? "").trim();
    groups.get(label).foals.push({ name, key: foalKey(name), year: Number(cells[2]) || null, country: cells[1] ? String(cells[1]).toUpperCase() : null, sire: cells[3] || null, unnamed: /^00/.test(name) });
  }
  return [...groups.values()];
}

const EUROPE = new Set(["GB", "IRE", "FR", "GER", "ITY", "SWE", "NOR", "DEN", "SPA", "BEL", "HOL", "SWI", "AUT", "CZE", "POL", "HUN", "TUR"]);
const countryOf = (c) => ({ GBR: "GB", FRA: "FR", IRL: "IRE", ITA: "ITY", DEU: "GER" })[String(c ?? "").toUpperCase()] ?? (String(c ?? "").toUpperCase() || null);

/**
 * Which group is her: by her year; between two of her year, her country, then
 * the same part of the world (a row saying IRE for a mare Arion has as GB).
 * Null when none, or when two remain.
 */
export function herGroup(groups, { year = null, country = null } = {}) {
  if (!year) return null;
  let same = groups.filter((g) => g.year === Number(year));
  if (same.length <= 1) return same[0] ?? null;
  const c = countryOf(country);
  const byCountry = same.filter((g) => g.country === c);
  if (byCountry.length === 1) return byCountry[0];
  const byRegion = same.filter((g) => EUROPE.has(g.country) === EUROPE.has(c));
  return byRegion.length === 1 ? byRegion[0] : null;
}

/**
 * Each foal judged against Arion's list: "hers", "other" (listed under
 * another mare of the name) or "unknown". `capped` is a list Arion cut at
 * thirty, where a foal missing from her group may still be hers.
 */
export function judge(foal, groups, her) {
  const k = foalKey(foal?.name);
  const y = Number(foal?.foalingYear ?? foal?.year) || null;
  const match = (f) => f.key === k && (!y || !f.year || f.year === y);
  if (her && her.foals.some(match)) return "hers";
  if (groups.some((g) => g !== her && g.foals.some(match))) return "other";
  return "unknown";
}

/** The other mares of the name, as namesakes for the age rule. */
export const otherDams = (groups, her) => groups.filter((g) => g !== her).map((g) => ({ year: g.year, isHer: false }));
