import test from "node:test";
import assert from "node:assert/strict";
import {
  normaliseSubject, isSearchableSubject, describeAge, splitByAsker, askerSummary,
} from "./teamMemory.mjs";

test("a country suffix does not stop a horse being found", () => {
  assert.equal(normaliseSubject("PABORUS (FR)"), "PABORUS");
  assert.equal(normaliseSubject("Ol' Man River (IRE)"), "Ol' Man River");
});

test("apostrophes and hyphens survive - they are part of names", () => {
  assert.equal(normaliseSubject("Al-Nayyir"), "Al-Nayyir");
  assert.equal(normaliseSubject("Ol' Man River"), "Ol' Man River");
});

test("punctuation that is not part of a name is dropped", () => {
  assert.equal(normaliseSubject("Kodiac?  %"), "Kodiac");
});

test("a subject too short to mean anything is refused", () => {
  // a two-letter LIKE matches nearly every question ever asked, and the
  // assistant would report the coincidence as a connection
  assert.equal(isSearchableSubject("a"), false);
  assert.equal(isSearchableSubject("(FR)"), false);
  assert.equal(isSearchableSubject(""), false);
  assert.equal(isSearchableSubject(null), false);
  assert.equal(isSearchableSubject("Kodiac"), true);
});

test("ages read the way a person says them", () => {
  const now = new Date("2026-09-09T12:00:00Z");
  const at = (iso) => describeAge(new Date(iso), now);
  assert.equal(at("2026-09-09T06:00:00Z"), "today");
  assert.equal(at("2026-09-08T23:00:00Z"), "yesterday");
  assert.equal(at("2026-09-06T09:00:00Z"), "3 days ago");
  assert.equal(at("2026-09-01T09:00:00Z"), "last week");
  assert.equal(at("2026-08-10T09:00:00Z"), "4 weeks ago");
});

test("an unparseable timestamp does not become 'today'", () => {
  assert.equal(describeAge("not a date"), "at an unknown time");
});

test("the reader's own questions are never reported as a colleague's", () => {
  const rows = [
    { user_id: "Richard", question: "Paborus for the Abbaye?", asked_at: new Date() },
    { user_id: "Stuart", question: "How is Paborus?", asked_at: new Date() },
  ];
  const { colleagues, you } = splitByAsker(rows, { userId: "Richard" });
  assert.equal(colleagues.length, 1);
  assert.equal(colleagues[0].asked_by, "Stuart");
  assert.equal(you.length, 1);
});

test("the split is case-insensitive on the user id", () => {
  const rows = [{ user_id: "RICHARD", question: "x", asked_at: new Date() }];
  assert.equal(splitByAsker(rows, { userId: "richard" }).you.length, 1);
});

test("with no user id every row is a colleague's, not the reader's", () => {
  const rows = [{ user_id: "Stuart", question: "x", asked_at: new Date() }];
  assert.equal(splitByAsker(rows, {}).colleagues.length, 1);
});

test("asker summary counts repeats so the assistant can name a person", () => {
  const now = new Date("2026-09-09T12:00:00Z");
  const rows = [
    { user_id: "Stuart", question: "a", asked_at: new Date("2026-09-08T09:00:00Z") },
    { user_id: "Stuart", question: "b", asked_at: new Date("2026-09-07T09:00:00Z") },
    { user_id: "Tom", question: "c", asked_at: new Date("2026-09-01T09:00:00Z") },
  ];
  const { colleagues } = splitByAsker(rows, { userId: "Richard", now });
  const summary = askerSummary(colleagues);
  assert.deepEqual(summary, [
    { asked_by: "Stuart", times: 2, most_recent: "yesterday" },
    { asked_by: "Tom", times: 1, most_recent: "last week" },
  ]);
});

test("no rows is an empty answer, not a crash", () => {
  assert.deepEqual(splitByAsker(null, { userId: "x" }), { colleagues: [], you: [] });
  assert.deepEqual(askerSummary(undefined), []);
});
