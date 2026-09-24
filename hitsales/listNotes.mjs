/**
 * A user's notes on a sale, merged into the stored list rather than
 * overwritten by whichever copy of the list was saved last.
 *
 * The site saves a user's list for a sale as one document, and the route used
 * to store whatever arrived. So any copy of the list older than the one on the
 * server wrote over it, and a note saved in the meantime was gone: a second
 * tab, the lot page opened while the catalogue's save was still on its way, a
 * tab left open since before the last deploy. On 24 September a user reported
 * losing notes, and both lists on the Arc sale had last been saved from tabs
 * running the build from before notes were kept apart from the list — where
 * taking a horse off the list also deleted its note.
 *
 * The desk's rule: a note a user has saved is never lost unless that user
 * deletes or edits it — and taking a horse off the list is neither.
 *
 * So the notes in a save are merged into the stored ones, lot by lot:
 *
 *   - A save from the current site carries each note's own edit time
 *     (`lotNotesAt`, and `notesAt` for the sale's notes), and a deletion is
 *     an edit time with no text. The later edit of each note wins, and a note
 *     the save does not mention is kept: the page simply did not know it.
 *
 *   - A save from an older page carries no times. A note in it that differs
 *     from the stored one is taken as an edit made now; a note it lacks, or
 *     leaves blank, is kept. An older page cannot delete a note — it cannot
 *     say that it meant to, and it drops notes it never loaded. Nor can it
 *     bring back what the note used to say: text the note has already had
 *     (`pastTexts`, from the history) is a stale copy from a page that never
 *     saw the later edit or the deletion, not a new edit.
 *
 * Everything else in the list (the lots on it, the categories) is the save's,
 * as before. Every change to a note is also returned so the route can keep it
 * in a history table that is never deleted from.
 */

/** Text, or "" for anything that is not a note. */
const noteText = (v) => (typeof v === "string" && v.trim() ? v : "");

/** An ISO time, or "" where there is none: "" sorts before every time. */
const noteTime = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v : "");

const lotKey = (v) => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Does this copy of a list carry the notes' own edit times? */
export const carriesTimes = (list) => isObject(list) && isObject(list.lotNotesAt);

/**
 * The notes one copy of a list holds: lot -> { text, at }. A note on a lot's
 * entry counts where lotNotes has none (lists saved before lotNotes existed);
 * a time with no text is a deletion.
 */
export function notesOf(list) {
  const out = new Map();
  if (!isObject(list)) return out;
  const at = isObject(list.lotNotesAt) ? list.lotNotesAt : {};
  const lotNotes = isObject(list.lotNotes) ? list.lotNotes : {};
  for (const [k, v] of Object.entries(lotNotes)) {
    const lot = lotKey(k);
    if (lot && noteText(v)) out.set(lot, { text: v, at: noteTime(at[k]) });
  }
  for (const e of Array.isArray(list.entries) ? list.entries : []) {
    const lot = lotKey(e?.lot);
    if (lot && !out.has(lot) && noteText(e?.note)) out.set(lot, { text: e.note, at: noteTime(at[lot]) });
  }
  for (const [k, v] of Object.entries(at)) {
    const lot = lotKey(k);
    if (lot && !out.has(lot) && noteTime(v)) out.set(lot, { text: "", at: noteTime(v) });
  }
  return out;
}

/**
 * Merge the notes of `incoming` (a save) into `stored` (the list on the
 * server, or null). Returns the list to store — the save's, with the merged
 * notes — and the notes that changed, as { lot, text, at, previous } (lot
 * null for the sale's own notes; text "" for a deletion). `pastTexts` maps a
 * lot ("" for the sale's notes) to every text its note has had.
 */
export function mergeListNotes(stored, incoming, { now = new Date().toISOString(), pastTexts = new Map() } = {}) {
  const timed = carriesTimes(incoming);
  // "" keys the sale's own notes; lots are never "".
  const hadText = (lot, text) => Boolean(pastTexts.get(lot)?.has(text));
  const before = notesOf(stored);
  const came = notesOf(incoming);
  const merged = new Map(before);

  for (const [lot, note] of came) {
    const old = before.get(lot);
    if (timed) {
      // The later edit wins; on a tie the stored note stands.
      if (!old || note.at > old.at) merged.set(lot, note);
    } else if (note.text && (!old || note.text !== old.text) && !hadText(lot, note.text)) {
      // An older page's note that differs is an edit, made now. What it
      // lacks or leaves blank is not a deletion, and what the note has
      // said before is a stale copy.
      merged.set(lot, { text: note.text, at: now });
    }
  }

  const changes = [];
  for (const [lot, note] of merged) {
    const previous = before.get(lot)?.text || "";
    if (previous !== note.text) changes.push({ lot, text: note.text, at: note.at || now, previous });
  }

  // The sale's own notes, by the same rules.
  const storedSale = { text: noteText(stored?.notes), at: noteTime(stored?.notesAt) };
  const cameSale = { text: noteText(incoming?.notes), at: noteTime(incoming?.notesAt) };
  let sale = storedSale;
  if (timed) {
    if (cameSale.at > storedSale.at) sale = cameSale;
  } else if (cameSale.text && cameSale.text !== storedSale.text && !hadText("", cameSale.text)) {
    sale = { text: cameSale.text, at: now };
  }
  if (sale.text !== storedSale.text) {
    changes.push({ lot: null, text: sale.text, at: sale.at || now, previous: storedSale.text });
  }

  const lotNotes = {};
  const lotNotesAt = {};
  for (const [lot, note] of [...merged].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
    if (note.text) lotNotes[lot] = note.text;
    if (note.at) lotNotesAt[lot] = note.at;
  }
  const entries = (Array.isArray(incoming?.entries) ? incoming.entries : []).map((e) => {
    const lot = lotKey(e?.lot);
    // A listed lot carries its note on its entry too, where older pages and
    // the daily sale mail read it.
    return lot === null ? e : { ...e, note: merged.get(lot)?.text || "" };
  });

  const list = { ...(isObject(incoming) ? incoming : {}), entries, lotNotes, lotNotesAt, notes: sale.text };
  if (sale.at) list.notesAt = sale.at;
  else delete list.notesAt;
  return { list, changes };
}
