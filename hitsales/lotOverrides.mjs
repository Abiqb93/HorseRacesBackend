/**
 * The user's own data on a lot: figures it has checked by hand and links it
 * wants to hand (16 October 2026: "German and French horses…
 * can I add in a link… manually update data on these horses so that it's
 * done once and then it overrides whatever else is there").
 *
 * One record per (sale, lot), shared by everyone — a correction is
 * a fact about the horse, not one user's view — shaped
 *
 *   { fields: { <key>: <value> }, links: [{ label, url }], by, at }
 *
 * `fields` holds row keys the site's catalogue carries (an official rating,
 * a Timeform figure, a name…); a value of null clears an earlier override.
 * `links` is replaced whole. The site and the nightly build apply the
 * record over what the warehouse says (src/utils/hitOverrides.js).
 */

const FIELD_KEY = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const MAX_FIELDS = 40;
const MAX_LINKS = 12;

const cleanUrl = (u) => {
  const s = String(u ?? "").trim();
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(s) || s.length > 500) return null;
  return s;
};

/** The links as the user typed them, kept only where the url is a web address. */
export function cleanLinks(links) {
  if (!Array.isArray(links)) return [];
  const out = [];
  for (const l of links) {
    const url = cleanUrl(l?.url);
    if (!url) continue;
    const label = String(l?.label ?? "").trim().slice(0, 60) || url.replace(/^https?:\/\//, "").slice(0, 60);
    if (!out.some((x) => x.url === url)) out.push({ label, url });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

/** A field value as stored: a finite number, a short string, or null to clear. */
export function cleanField(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean") return v;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > 200) return undefined;
  const n = Number(s);
  return /^-?\d+(\.\d+)?$/.test(s) && Number.isFinite(n) ? n : s;
}

/**
 * The stored record with an incoming change laid over it: fields given are
 * set (null removes one), fields not given stand; links, when given, are
 * replaced. Returns null for a record left empty.
 */
export function mergeLotOverride(stored, incoming, { by = null, at = new Date().toISOString() } = {}) {
  const fields = { ...(stored?.fields || {}) };
  const inc = incoming?.fields && typeof incoming.fields === "object" ? incoming.fields : {};
  let n = 0;
  for (const [k, v] of Object.entries(inc)) {
    if (!FIELD_KEY.test(k)) continue;
    const c = cleanField(v);
    if (c === undefined) continue;
    if (c === null) delete fields[k]; else fields[k] = c;
    if (++n >= MAX_FIELDS) break;
  }
  const links = incoming && Object.prototype.hasOwnProperty.call(incoming, "links") ? cleanLinks(incoming.links) : (stored?.links || []);
  if (!Object.keys(fields).length && !links.length) return null;
  return { fields, links, by: by ? String(by).slice(0, 64) : stored?.by ?? null, at };
}
