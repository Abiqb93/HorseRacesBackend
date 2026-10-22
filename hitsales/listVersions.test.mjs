import test from "node:test";
import assert from "node:assert/strict";
import { keepVersion, lotsMoved, versionSummary, VERSION_EVERY_MIN } from "./listVersions.mjs";

const cats = [{ id: "aus", name: "Aus" }, { id: "ghadayer", name: "Ghadayer" }];
const list = (entries, notes = {}) => ({ categories: cats, entries: entries.map(([lot, ...c]) => ({ lot, categories: c })), lotNotes: notes });
const NOW = new Date("2026-10-22T16:00:00.000Z");
const ago = (min) => new Date(NOW.getTime() - min * 60000).toISOString();

test("a brief run of five lots or more keeps the copy before it, however recent the last version", () => {
  const before = list([["720", "ghadayer"]]);
  const after = list([["720", "aus"], ["1", "aus"], ["2", "aus"], ["3", "aus"], ["4", "aus"]]);
  assert.equal(lotsMoved(before, after), 5);
  assert.equal(keepVersion(ago(1), before, after, NOW), true);
});

test("a click keeps a version only every ten minutes", () => {
  const before = list([["720", "ghadayer"]]);
  const after = list([["720", "ghadayer", "aus"]]);
  assert.equal(keepVersion(ago(2), before, after, NOW), false);
  assert.equal(keepVersion(ago(VERSION_EVERY_MIN), before, after, NOW), true);
  assert.equal(keepVersion(null, before, after, NOW), true, "the first version of a list");
  // a note changed is a change; a save that changes nothing is not
  assert.equal(keepVersion(ago(30), before, list([["720", "ghadayer"]], { 720: "walker" }), NOW), true);
  assert.equal(keepVersion(ago(30), before, list([["720", "ghadayer"]]), NOW), false);
});

test("a category made, renamed or deleted is a big change; nothing stored, nothing kept", () => {
  const before = list([["720", "ghadayer"]]);
  assert.equal(keepVersion(ago(1), before, { ...before, categories: [cats[1]] }, NOW), true);
  assert.equal(keepVersion(null, null, before, NOW), false);
});

test("a version's line", () => {
  assert.equal(versionSummary(list([["720", "ghadayer"], ["1", "aus"], ["2"]], { 720: "walker", 1: " " })), "3 lots · Aus 1 · Ghadayer 1 · 1 note");
});
