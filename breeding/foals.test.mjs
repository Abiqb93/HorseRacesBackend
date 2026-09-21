import test from "node:test";
import assert from "node:assert/strict";

import { foalColumns, foalOut, foalLine, parseSex, seasonOfFoaling, cleanMedia, dateOnly } from "./foals.mjs";

test("a foal is filed under the season his dam was covered, not the year he was born", () => {
  // Foaled February 2026, so she was covered in 2025 and this foal belongs
  // beside the 2025 plan — which is the only thing it is read next to.
  assert.equal(seasonOfFoaling("2026-02-07"), 2025);
  assert.equal(seasonOfFoaling(null), null);
});

test("a record with a date files itself", () => {
  assert.equal(foalColumns({ foaledDate: "2026-02-07" }).season, 2025);
  // Unless the season is stated, in which case the desk is right.
  assert.equal(foalColumns({ foaledDate: "2026-02-07", season: 2024 }).season, 2024);
});

test("a field nobody mentioned is left alone", () => {
  const cols = foalColumns({ notes: "walks well" });
  assert.deepEqual(Object.keys(cols), ["notes"]);
  // An empty string is a clearing, not an omission.
  assert.deepEqual(foalColumns({ notes: "" }), { notes: null });
});

test("colt, filly, gelding, however they are typed", () => {
  assert.equal(parseSex("Colt"), "c");
  assert.equal(parseSex("FILLY"), "f");
  assert.equal(parseSex("gelding"), "g");
  assert.equal(parseSex("f"), "f");
  assert.equal(parseSex("bay"), null);
  assert.equal(parseSex(""), null);
});

test("only http links are kept, because a link in this field is rendered as one", () => {
  const media = cleanMedia([
    { url: "javascript:alert(1)" },
    { url: "data:text/html,<script>x</script>" },
    { url: "https://drive.example/photo.jpg", kind: "photo", caption: "at three weeks" },
    { url: "http://drive.example/walk.mp4", kind: "video" },
    { url: "https://drive.example/odd", kind: "nonsense" },
  ]);
  assert.equal(media.length, 3);
  assert.equal(media[0].url, "https://drive.example/photo.jpg");
  assert.equal(media[0].caption, "at three weeks");
  assert.equal(media[2].kind, "photo");
});

test("a season out of the calendar is no season", () => {
  assert.equal(foalColumns({ season: "not a year" }).season, null);
  assert.equal(foalColumns({ season: "2027" }).season, 2027);
});

test("a row reads back with its media parsed, however the column returned it", () => {
  const asString = foalOut({ id: 1, mare_id: 2, season: 2025, media: '[{"url":"https://x/y.jpg"}]' });
  assert.equal(asString.media[0].url, "https://x/y.jpg");
  const asObject = foalOut({ id: 1, mare_id: 2, season: 2025, media: [{ url: "https://x/y.jpg" }] });
  assert.equal(asObject.media.length, 1);
  // A column that will not parse is an empty list, never a crash.
  assert.deepEqual(foalOut({ id: 1, mare_id: 2, season: 2025, media: "{oh dear" }).media, []);
});

test("the line a list shows names what is known and nothing else", () => {
  assert.equal(
    foalLine({ name: "Unnamed", sex: "c", sire: "Frankel", foaledDate: "2026-02-07" }),
    "Unnamed, colt by Frankel foaled 7 Feb 2026",
  );
  assert.equal(foalLine({ sex: null, sire: null, foaledDate: null }), "foal");
  assert.equal(foalLine(null), "");
});

test("a DATE column comes back as the day it names, whatever the driver hands over", () => {
  // The driver builds a Date at local midnight. String() on it is "Sat Feb 07",
  // which is not a date, and toISOString() is a day early east of Greenwich.
  assert.equal(dateOnly(new Date(2026, 1, 7)), "2026-02-07");
  assert.equal(dateOnly("2026-02-07"), "2026-02-07");
  assert.equal(dateOnly("2026-02-07T00:00:00.000Z"), "2026-02-07");
  assert.equal(dateOnly(null), null);
  assert.equal(dateOnly(new Date("nonsense")), null);
  assert.equal(foalOut({ id: 1, foaled_date: new Date(2026, 1, 7) }).foaledDate, "2026-02-07");
});
