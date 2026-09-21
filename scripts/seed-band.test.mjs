import test from "node:test";
import assert from "node:assert/strict";

import { normaliseMare, preferencesFor, seasonFor } from "./seed-band.mjs";

test("a pack transcribed from the reports and one from the index read the same", () => {
  const fromReports = normaliseMare({
    name: "CIRCIOS",
    yob: 2022,
    foaledIn: "IRE",
    statusLine: "i/f FRANKEL lsd 24/02/26",
    preferenceLines: ["1st preference: Not This Time / Nyquist", "2nd preference: Night of Thunder"],
  });
  const fromIndex = normaliseMare({
    mare: "CIRCIOS",
    yob: 2022,
    country: "IRE",
    plan2026: "Frankel",
    lsd: "24 Feb 26",
    status: "In foal",
    suggestion2027: "Not This Time/ Night of Thunder",
  });

  assert.equal(fromReports.name, "CIRCIOS");
  assert.equal(fromIndex.name, "CIRCIOS");
  assert.equal(fromIndex.foaledIn, "IRE");
  assert.equal(seasonFor(fromReports).coveringSire, "FRANKEL");
  assert.equal(seasonFor(fromIndex).coveringSire, "Frankel");
  assert.equal(seasonFor(fromReports).lastServiceDate, "2026-02-24");
  assert.equal(seasonFor(fromIndex).lastServiceDate, "24 Feb 26");
  assert.equal(seasonFor(fromIndex).status, "in_foal");

  // The report's own line keeps both first choices; the index ranks them.
  assert.deepEqual(preferencesFor(fromReports).map((p) => [p.rank, p.stallion]), [
    [1, "NOT THIS TIME"],
    [1, "NYQUIST"],
    [2, "NIGHT OF THUNDER"],
  ]);
  assert.deepEqual(preferencesFor(fromIndex).map((p) => [p.rank, p.stallion]), [
    [1, "NOT THIS TIME"],
    [2, "NIGHT OF THUNDER"],
  ]);
});

test("a blank column does not shout down a status line that has the fact", () => {
  // The normaliser writes "" for what the pack left empty, and "" is not null,
  // so a naive ?? chain would prefer the empty column over the parsed line.
  const m = normaliseMare({ name: "X", statusLine: "i/f DUBAWI lsd 19/04/26", lsd: "" });
  assert.equal(seasonFor(m).lastServiceDate, "2026-04-19");
});

test("barren names the stallion she failed to, and a maiden names nobody", () => {
  const barren = normaliseMare({ name: "STAY ALERT", statusLine: "BARREN (to Justify)", foaled2026: "03.03.26", foalBy: "JUSTIFY" });
  const s = seasonFor(barren);
  assert.equal(s.status, "barren");
  assert.equal(s.coveringSire, "JUSTIFY");
  assert.equal(s.foaledDate, "03.03.26");

  const maiden = seasonFor(normaliseMare({ name: "PEARLA", statusLine: "MAIDEN" }));
  assert.equal(maiden.status, "maiden");
  assert.equal(maiden.coveringSire, null);
});

test("where a pack holds two readings of one season the desk's own report wins", () => {
  const m = normaliseMare({
    name: "MELO MELO",
    plans2027: [
      { source: "docx", preferences: [{ rank: 1, stallion: "LOPE DE VEGA" }], analysis: "the working folder's view" },
      { source: "master", preferences: [{ rank: 1, stallion: "JUSTIFY" }], analysis: "the report that was sent" },
    ],
  });
  assert.equal(preferencesFor(m)[0].stallion, "JUSTIFY");
  assert.match(m.analysis, /was sent/);
});

test("a row with nothing but a name yields nothing rather than an invented season", () => {
  const s = seasonFor(normaliseMare({ name: "LADY VIVIAN" }));
  assert.equal(s.status, null);
  assert.equal(s.coveringSire, null);
  assert.deepEqual(preferencesFor(normaliseMare({ name: "LADY VIVIAN" })), []);
});
