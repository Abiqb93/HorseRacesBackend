import test from "node:test";
import assert from "node:assert/strict";
import { mareKey, seasonOf, readSave, saveNote, listNotes, MAX_NOTE } from "./mareNotes.mjs";

test("a mare's key is her name without its country, and her foaling year", () => {
  assert.equal(mareKey("Angel Vision (IRE)", 2012), "angel vision|2012");
  assert.equal(mareKey("angel vision", "2012"), "angel vision|2012");
  assert.equal(mareKey("Angel Vision"), "angel vision");
  assert.equal(mareKey("", 2012), null);
});

test("a season is a year from 2000 to 2100", () => {
  assert.equal(seasonOf("2027"), 2027);
  assert.equal(seasonOf(1999), null);
  assert.equal(seasonOf("next"), null);
});

test("a save is refused without a mare, a season, or over the length", () => {
  assert.throws(() => readSave({ season: 2027, body: "x" }), /mare/);
  assert.throws(() => readSave({ mare: "Integral", season: 27 }), /season/);
  assert.throws(() => readSave({ mare: "Integral", season: 2027, body: "x".repeat(MAX_NOTE + 1) }), /characters/);
  assert.deepEqual(readSave({ mare: "Integral (GB)", year: 2010, season: 2027, body: "Kind of Blue?\r\nCall Cheveley" }), {
    key: "integral|2010", name: "Integral (GB)", season: 2027, body: "Kind of Blue?\nCall Cheveley",
  });
});

/** A fake database holding the two tables in memory. */
function fakeDb() {
  const notes = new Map(); const history = [];
  const run = async (sql, p) => {
    if (sql.startsWith("SELECT body")) { const r = notes.get(p.join("|")); return r ? [{ body: r.body }] : []; }
    if (sql.startsWith("INSERT INTO mare_mating_note_history")) { history.push(p); return {}; }
    if (sql.startsWith("INSERT INTO mare_mating_notes")) { notes.set([p[0], p[1], p[3]].join("|"), { season: p[3], body: p[4], updated_at: "2026-11-27T12:00:00Z" }); return {}; }
    if (sql.includes("AND season = ?")) { const r = notes.get(p.join("|")); return r ? [r] : []; }
    if (sql.startsWith("SELECT season")) return [...notes.entries()].filter(([k]) => k.startsWith(`${p[0]}|${p[1]}|`)).map(([, v]) => v).sort((a, b) => b.season - a.season);
    throw new Error(`unexpected ${sql}`);
  };
  return { run, history };
}

test("saving keeps the replaced text in the history, and lists newest season first", async () => {
  const { run, history } = fakeDb();
  const k = { key: "integral|2010", name: "Integral", body: "" };
  await saveNote(run, "u1", { ...k, season: 2026, body: "Went to Vandeek" });
  await saveNote(run, "u1", { ...k, season: 2027, body: "Try Kind of Blue" });
  assert.equal(history.length, 0);
  await saveNote(run, "u1", { ...k, season: 2027, body: "Booked to Kind of Blue" });
  await saveNote(run, "u1", { ...k, season: 2027, body: "Booked to Kind of Blue" });
  assert.equal(history.length, 1, "the same text saved twice adds no history");
  assert.equal(history[0][3], "Try Kind of Blue");
  const list = await listNotes(run, "u1", "integral|2010");
  assert.deepEqual(list.map((n) => [n.season, n.body]), [[2027, "Booked to Kind of Blue"], [2026, "Went to Vandeek"]]);
  assert.deepEqual(await listNotes(run, "u2", "integral|2010"), [], "another user's notes are not shared");
});
