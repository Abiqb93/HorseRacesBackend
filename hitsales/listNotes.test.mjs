import test from "node:test";
import assert from "node:assert/strict";
import { mergeListNotes, notesOf, carriesTimes } from "./listNotes.mjs";

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
