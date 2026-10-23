import test from "node:test";
import assert from "node:assert/strict";
import { mergeListNotes, mergeLotFlags, mergeClientStates, mergeSends, notesOf, carriesTimes, mergeClientNotes } from "./listNotes.mjs";

const NOW = "2026-09-24T18:00:00.000Z";
const T1 = "2026-09-24T10:00:00.000Z";
const T2 = "2026-09-24T12:00:00.000Z";
const T3 = "2026-09-24T14:00:00.000Z";

const entry = (lot, note = "") => ({ lot, name: null, note, categories: [], auto: {}, manual: true });
const past = (pairs) => new Map(pairs.map(([lot, texts]) => [lot, new Set(texts)]));

/* ------------------------------------------------ a page from before notes had times */

test("taking a horse off the list on an older page never loses its note", () => {
  const stored = { entries: [entry("5", "vet him"), entry("9")] };
  // The older page un-starred lot 5: its entry, and the note on it, are gone from the save.
  const incoming = { entries: [entry("9")] };
  const { list, changes } = mergeListNotes(stored, incoming, { now: NOW });
  assert.deepEqual(list.lotNotes, { 5: "vet him" });
  assert.deepEqual(list.entries.map((e) => e.lot), ["9"], "the lot is off the list, as the save said");
  assert.deepEqual(changes, []);
});

test("an older copy of the list cannot drop a note saved since", () => {
  const stored = { entries: [entry("5")], lotNotes: { 5: "walked well", 7: "ask the vet" }, lotNotesAt: { 5: T1, 7: T2 } };
  const stale = { entries: [entry("5"), entry("8")] }; // loaded before either note, then starred lot 8
  const { list } = mergeListNotes(stored, stale, { now: NOW });
  assert.deepEqual(list.lotNotes, { 5: "walked well", 7: "ask the vet" });
  assert.equal(list.entries.find((e) => e.lot === "5").note, "walked well");
  assert.deepEqual(list.entries.map((e) => e.lot), ["5", "8"]);
});

test("an older page's blank note is not a deletion; a changed one is an edit made now", () => {
  const stored = { entries: [entry("5", "old text"), entry("6", "keep me")] };
  const incoming = { entries: [entry("5", "new text"), entry("6", "")] };
  const { list, changes } = mergeListNotes(stored, incoming, { now: NOW });
  assert.deepEqual(list.lotNotes, { 5: "new text", 6: "keep me" });
  assert.equal(list.lotNotesAt[5], NOW);
  assert.deepEqual(changes, [{ lot: "5", text: "new text", at: NOW, previous: "old text" }]);
});

test("an older page cannot put back what a note said before, nor a deleted note", () => {
  const stored = { entries: [entry("5")], lotNotes: { 5: "v2" }, lotNotesAt: { 5: T2, 6: T3 } }; // 6 deleted at T3
  const history = past([["5", ["v1", "v2"]], ["6", ["gone"]]]);
  const stale = { entries: [entry("5", "v1"), entry("6", "gone")] };
  const { list, changes } = mergeListNotes(stored, stale, { now: NOW, pastTexts: history });
  assert.deepEqual(list.lotNotes, { 5: "v2" });
  assert.equal(list.lotNotesAt[6], T3, "the deletion stands");
  assert.deepEqual(changes, []);
});

test("notes the site keeps apart from the list, saved without times, merge the same way", () => {
  // The build between the two changes: lotNotes as text, no times.
  const stored = { entries: [], lotNotes: { 12: "maybe" }, lotNotesAt: { 12: T1 } };
  const incoming = { entries: [], lotNotes: { 14: "second look" } };
  const { list } = mergeListNotes(stored, incoming, { now: NOW });
  assert.deepEqual(list.lotNotes, { 12: "maybe", 14: "second look" });
});

/* ------------------------------------------------ the current site: every note has its time */

test("the later edit of a note wins, whichever save arrives last", () => {
  const stored = { entries: [], lotNotes: { 5: "check the knee" }, lotNotesAt: { 5: T2 } };
  const older = { entries: [], lotNotes: { 5: "check the kn" }, lotNotesAt: { 5: T1 } };
  assert.deepEqual(mergeListNotes(stored, older, { now: NOW }).list.lotNotes, { 5: "check the knee" });
  const newer = { entries: [], lotNotes: { 5: "check the knee again" }, lotNotesAt: { 5: T3 } };
  assert.deepEqual(mergeListNotes(stored, newer, { now: NOW }).list.lotNotes, { 5: "check the knee again" });
});

test("a note the save does not mention is kept: that page had not seen it", () => {
  const stored = { entries: [], lotNotes: { 5: "from the laptop" }, lotNotesAt: { 5: T2 } };
  const phone = { entries: [], lotNotes: { 9: "from the phone" }, lotNotesAt: { 9: T3 } };
  const { list } = mergeListNotes(stored, phone, { now: NOW });
  assert.deepEqual(list.lotNotes, { 5: "from the laptop", 9: "from the phone" });
});

test("a user deletes a note by saving a later time with no text", () => {
  const stored = { entries: [entry("5", "x")], lotNotes: { 5: "x" }, lotNotesAt: { 5: T1 } };
  const incoming = { entries: [entry("5")], lotNotes: {}, lotNotesAt: { 5: T2 } };
  const { list, changes } = mergeListNotes(stored, incoming, { now: NOW });
  assert.deepEqual(list.lotNotes, {});
  assert.equal(list.lotNotesAt[5], T2);
  assert.equal(list.entries[0].note, "");
  assert.deepEqual(changes, [{ lot: "5", text: "", at: T2, previous: "x" }]);
  // ...and a deletion older than the note does nothing.
  const late = mergeListNotes({ entries: [], lotNotes: { 5: "y" }, lotNotesAt: { 5: T3 } }, incoming, { now: NOW });
  assert.deepEqual(late.list.lotNotes, { 5: "y" });
});

/* ------------------------------------------------ the sale's own notes */

test("the sale's notes follow the same rules", () => {
  const stored = { entries: [], notes: "ring quiet", notesAt: T2 };
  assert.equal(mergeListNotes(stored, { entries: [], notes: "" }, { now: NOW }).list.notes, "ring quiet", "an older page's blank");
  assert.equal(mergeListNotes(stored, { entries: [], notes: "ring busy" }, { now: NOW }).list.notes, "ring busy", "an older page's edit");
  assert.equal(mergeListNotes(stored, { entries: [], lotNotesAt: {}, notes: "stale", notesAt: T1 }, { now: NOW }).list.notes, "ring quiet");
  assert.equal(mergeListNotes(stored, { entries: [], lotNotesAt: {}, notes: "", notesAt: T3 }, { now: NOW }).list.notes, "", "a deliberate clear");
});

/* ------------------------------------------------ the first save, and reading */

test("the first save of a list keeps its notes, timed or not", () => {
  const { list, changes } = mergeListNotes(null, { entries: [entry("3", "first")], notes: "day one" }, { now: NOW });
  assert.deepEqual(list.lotNotes, { 3: "first" });
  assert.equal(list.notes, "day one");
  assert.equal(changes.length, 2);
});

test("notes are read off entries where a list has no lotNotes, and times mark deletions", () => {
  const n = notesOf({ entries: [entry("4", "on the entry")], lotNotes: { 6: "apart" }, lotNotesAt: { 6: T1, 7: T2 } });
  assert.deepEqual([...n.entries()], [["6", { text: "apart", at: T1 }], ["4", { text: "on the entry", at: "" }], ["7", { text: "", at: T2 }]]);
  assert.equal(carriesTimes({ lotNotesAt: {} }), true);
  assert.equal(carriesTimes({ lotNotes: {} }), false);
});

test("checks set by hand merge by when each was set, and an old page removes none", () => {
  const at = (h) => `2026-10-01T${String(h).padStart(2, "0")}:00:00.000Z`;
  const stored = { entries: [], lotFlags: { 11: { gates: { v: "no", at: at(8) }, action: { v: "yes", at: at(8) } } } };
  const incoming = { entries: [], lotNotesAt: {}, lotFlags: { 11: { gates: { v: "ok", at: at(9) } }, 12: { pedigree: { v: "q", at: at(9) } } } };
  const { list } = mergeListNotes(stored, incoming, { now: at(9) });
  assert.deepEqual(list.lotFlags, {
    11: { gates: { v: "ok", at: at(9) }, action: { v: "yes", at: at(8) } },
    12: { pedigree: { v: "q", at: at(9) } },
  });
  // an older setting does not undo a newer one
  const stale = mergeListNotes(list, { entries: [], lotNotesAt: {}, lotFlags: { 11: { gates: { v: "no", at: at(7) } } } }, { now: at(9) });
  assert.equal(stale.list.lotFlags[11].gates.v, "ok");
  // a page from before checks existed sends none and removes none
  const old = mergeListNotes(list, { entries: [] }, { now: at(9) });
  assert.deepEqual(old.list.lotFlags, list.lotFlags);
  // a cleared check is a setting like any other
  const cleared = mergeListNotes(list, { entries: [], lotNotesAt: {}, lotFlags: { 11: { gates: { v: "", at: at(10) } } } }, { now: at(10) });
  assert.deepEqual(cleared.list.lotFlags[11].gates, { v: "", at: at(10) });
  // nonsense is not stored
  assert.deepEqual(mergeLotFlags(null, { 11: { gates: { v: "maybe", at: at(9) } }, 12: { "no good": { v: "yes", at: at(9) } }, 13: { action: { v: "yes" } } }), {});
  // and a list with no checks carries no empty map
  assert.equal("lotFlags" in mergeListNotes(null, { entries: [] }, { now: at(9) }).list, false);
});

test("where each lot stands with each client merges by time; the send log is every send once", () => {
  const at = (h) => `2026-10-01T${String(h).padStart(2, "0")}:00:00.000Z`;
  const stored = { entries: [], clientStates: { job: { 6: { s: "shortlisted", at: at(8) } } },
    sends: [{ id: "s1", at: at(8), stage: "initial", scope: "job", lots: ["5", "6"] }] };
  const incoming = { entries: [], lotNotesAt: {}, clientStates: { job: { 6: { s: "dropped", at: at(9) }, 7: { s: "shortlisted", at: at(9) } } },
    sends: [{ id: "s2", at: at(9), stage: "first", scope: "job", lots: ["6"] }] };
  const { list } = mergeListNotes(stored, incoming, { now: at(9) });
  assert.deepEqual(list.clientStates, { job: { 6: { s: "dropped", at: at(9) }, 7: { s: "shortlisted", at: at(9) } } });
  assert.deepEqual(list.sends.map((x) => x.id), ["s1", "s2"]);
  // an old page sends neither and removes neither
  const old = mergeListNotes(list, { entries: [] }, { now: at(10) });
  assert.deepEqual(old.list.clientStates, list.clientStates);
  assert.deepEqual(old.list.sends.map((x) => x.id), ["s1", "s2"]);
  // junk is not stored
  assert.deepEqual(mergeClientStates(null, { "Bad Key": { 6: { s: "dropped", at: at(9) } }, job: { 6: { s: "sold", at: at(9) } } }), {});
  assert.deepEqual(mergeSends(null, [{ id: 3, at: at(9) }, { id: "x", at: "yesterday" }]), []);
});

test("lots and categories saved offline are merged by their times, not replaced by the later save", () => {
  // on the server: lot 9 starred on the desktop at 10:01, lot 3 taken off at 10:02
  const stored = {
    entries: [{ lot: "4", categories: [] }, { lot: "9", categories: [] }],
    entryEdits: { "3": "2026-10-21T10:02:00Z", "4": "2026-10-21T08:00:00Z", "9": "2026-10-21T10:01:00Z" },
    categories: [{ id: "hk", name: "HK" }],
  };
  // the iPad, back on wifi: still has lot 3 from before, starred 5, filed 4 under a new category
  const incoming = {
    entries: [{ lot: "3", categories: [] }, { lot: "4", categories: ["bahrain"] }, { lot: "5", categories: [] }],
    entryEdits: { "3": "2026-10-21T08:00:00Z", "4": "2026-10-21T10:05:00Z", "5": "2026-10-21T10:00:00Z" },
    categories: [{ id: "hk", name: "HK" }, { id: "bahrain", name: "Bahrain" }],
    categoryEdits: { bahrain: "2026-10-21T10:04:00Z" },
    lotNotesAt: {},
  };
  const { list } = mergeListNotes(stored, incoming);
  assert.deepEqual(list.entries.map((e) => e.lot).sort(), ["4", "5", "9"]);
  assert.deepEqual(list.entries.find((e) => e.lot === "4").categories, ["bahrain"]);
  assert.deepEqual(list.categories.map((c) => c.id), ["hk", "bahrain"]);
  assert.equal(list.entryEdits["3"], "2026-10-21T10:02:00Z");
});

test("a save from an older page, with no times, keeps its own lots as before", () => {
  const stored = { entries: [{ lot: "1" }, { lot: "2" }], entryEdits: { "2": "2026-10-21T10:00:00Z" } };
  const { list } = mergeListNotes(stored, { entries: [{ lot: "1" }, { lot: "7" }] });
  assert.deepEqual(list.entries.map((e) => e.lot), ["1", "7"]);
  assert.equal(list.entryEdits["2"], "2026-10-21T10:00:00Z", "the stored times are kept for the next timed save");
});

test("the client comments merge as the notes do: the later edit wins, a deletion is a time with no text, an untimed save adds its texts", () => {
  const stored = { lotNotesAt: {}, lotClientNotes: { 12: "A lovely mover", 3: "Old" }, lotClientNotesAt: { 12: T1, 3: T1 } };
  const save = { lotNotesAt: {}, lotClientNotes: { 12: "A lovely mover, sound" }, lotClientNotesAt: { 12: T2, 3: T2 } };
  const { list } = mergeListNotes(stored, save, { now: NOW });
  assert.deepEqual(list.lotClientNotes, { 12: "A lovely mover, sound" }, "3 deleted at T2, 12 edited at T2");
  assert.deepEqual(list.lotClientNotesAt, { 3: T2, 12: T2 });
  const older = mergeListNotes(list, { lotNotesAt: {}, lotClientNotes: { 12: "A lovely mover", 3: "Old" }, lotClientNotesAt: { 12: T1, 3: T1 } }, { now: NOW });
  assert.deepEqual(older.list.lotClientNotes, { 12: "A lovely mover, sound" }, "an older copy cannot put a deleted comment back");
  const untimed = mergeClientNotes({ lotClientNotes: { 5: "Kept" }, lotClientNotesAt: { 5: T1 } }, { lotClientNotes: { 7: "New" } }, { now: NOW });
  assert.deepEqual(untimed.texts, { 5: "Kept", 7: "New" });
  assert.equal(untimed.times[7], NOW);
  const none = mergeListNotes({ lotNotesAt: {} }, { lotNotesAt: {} }, { now: NOW });
  assert.equal(none.list.lotClientNotes, undefined, "nothing written: nothing kept");
});
