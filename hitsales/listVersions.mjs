/**
 * Earlier versions of a user's list for a sale (22 October 2026:
 * "restore the previous version of a list", the day a brief run into a
 * category put 148 lots in it at once). hit_sale_lists holds the latest copy
 * only; before a save replaces it, the copy it replaces is kept in
 * hit_sale_list_versions when this says so:
 *
 *   - the last version kept is VERSION_EVERY_MIN minutes old or more, so a
 *     morning's clicking leaves a version every ten minutes, not one a click;
 *   - or the save moves BIG_CHANGE lots or more at once (a brief run, a
 *     category deleted), so the copy before it can always be had back.
 *
 * The last KEEP_VERSIONS of each list are kept. The site puts a version back
 * by saving it with every item that differs stamped now (its
 * hitListHistory.restoreVersion), so the merge here takes it like any edit.
 */
export const VERSION_EVERY_MIN = 10;
export const BIG_CHANGE = 5;
export const KEEP_VERSIONS = 100;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const entriesOf = (list) => (isObject(list) && Array.isArray(list.entries) ? list.entries : []);
const lotOf = (e) => (e && e.lot !== null && e.lot !== undefined ? String(e.lot) : null);

/** Each lot on the list with its categories, as a comparable string. */
function placed(list) {
  const out = new Map();
  for (const e of entriesOf(list)) {
    const lot = lotOf(e);
    if (lot !== null) out.set(lot, JSON.stringify([...(Array.isArray(e.categories) ? e.categories : [])].map(String).sort()));
  }
  return out;
}

/** How many lots a save moves: put on, taken off, or into or out of a category. */
export function lotsMoved(before, after) {
  const a = placed(before);
  const b = placed(after);
  let n = 0;
  for (const lot of new Set([...a.keys(), ...b.keys()])) if (a.get(lot) !== b.get(lot)) n += 1;
  const names = (l) => JSON.stringify((isObject(l) && Array.isArray(l.categories) ? l.categories : []).map((c) => [c?.id, c?.name]).sort());
  // a category made, renamed or deleted counts as a big change too: it is the user's structure
  return n + (names(before) === names(after) ? 0 : BIG_CHANGE);
}

/**
 * Whether the copy a save replaces is kept as a version: `lastAt` is when
 * the last version of this list was kept (null for none), `stored` the copy
 * on the server, `next` the copy about to replace it.
 */
export function keepVersion(lastAt, stored, next, now = new Date()) {
  if (!isObject(stored) || (!entriesOf(stored).length && !Array.isArray(stored.categories))) return false;
  const moved = lotsMoved(stored, next);
  if (moved >= BIG_CHANGE) return true;
  if (!moved && JSON.stringify(stored.lotNotes || {}) === JSON.stringify(next?.lotNotes || {})) return false;
  const last = lastAt ? new Date(lastAt).getTime() : NaN;
  return !Number.isFinite(last) || new Date(now).getTime() - last >= VERSION_EVERY_MIN * 60000;
}

/** A version's line in the list of versions: its lots and categories, e.g. "251 lots · Aus 70 · Ghadayer 12". */
export function versionSummary(list) {
  const entries = entriesOf(list);
  const cats = isObject(list) && Array.isArray(list.categories) ? list.categories : [];
  const per = cats.map((c) => [c?.name || c?.id, entries.filter((e) => Array.isArray(e?.categories) && e.categories.includes(c?.id)).length])
    .filter(([, n]) => n > 0);
  const notes = isObject(list?.lotNotes) ? Object.values(list.lotNotes).filter((v) => typeof v === "string" && v.trim()).length : 0;
  return [`${entries.length} lot${entries.length === 1 ? "" : "s"}`, ...per.map(([nm, n]) => `${nm} ${n}`), ...(notes ? [`${notes} note${notes === 1 ? "" : "s"}`] : [])]
    .join(" · ").slice(0, 250);
}
