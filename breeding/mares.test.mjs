import test from "node:test";
import assert from "node:assert/strict";

import {
  mareNameKey,
  mergeMareRow,
  parseDate,
  parsePreferenceLines,
  parseStatus,
  parseSuggestion,
  pickSearchHit,
  seasonRowFrom,
  shortDate,
  statusLine,
  studName,
} from "./mares.mjs";
import { normaliseName } from "../pedigree/store.mjs";

test("a mare's key is the pedigree cache's key, or the two stores cannot join", () => {
  // Duplicated rather than imported because server.jsx needs it from CommonJS.
  // If these ever drift, a mare on the band silently stops matching her chart.
  for (const name of [
    "Circios (IRE)",
    "=Cash In The Hand (AUS)",
    "JASNA'S SECRET",
    "  St Mark's Basilica  ",
    "Lope de Vega",
    "*Anasheed",
  ]) {
    assert.equal(mareNameKey(name), normaliseName(name), name);
  }
});

test("a stud-book name drops the country and the sigil but keeps the apostrophe", () => {
  assert.equal(studName("=Jasna's Secret (FR)"), "JASNA'S SECRET");
  assert.equal(studName("  not this time "), "NOT THIS TIME");
  assert.equal(studName(null), "");
});

test("a date is read in the four forms a mating pack writes it", () => {
  assert.equal(parseDate("24 Feb 26"), "2026-02-24");
  assert.equal(parseDate("25 Mar 2026"), "2026-03-25");
  // Day first: 07.02.26 is the seventh of February to a British desk.
  assert.equal(parseDate("07.02.26"), "2026-02-07");
  assert.equal(parseDate("2026-05-20"), "2026-05-20");
  assert.equal(parseDate(""), null);
  assert.equal(parseDate("sometime in the spring"), null);
  assert.equal(parseDate("32.01.26"), null);
  assert.equal(shortDate("2026-02-24"), "24/02/26");
  assert.equal(shortDate(null), null);
});

test("a status line is read, and written back the same way", () => {
  assert.deepEqual(parseStatus("Status: i/f FRANKEL lsd 24/02/26"), {
    status: "in_foal",
    coveringSire: "FRANKEL",
    lastServiceDate: "2026-02-24",
  });
  assert.deepEqual(parseStatus("I/f to JUSTIFY lsd 20/05/26"), {
    status: "in_foal",
    coveringSire: "JUSTIFY",
    lastServiceDate: "2026-05-20",
  });
  assert.equal(parseStatus("MAIDEN").status, "maiden");
  assert.equal(parseStatus("MAIDEN").coveringSire, null);

  // Barren names the stallion she failed to, which is a fact about the season
  // and not the same as never having been covered.
  const barren = parseStatus("BARREN (to Justify)");
  assert.equal(barren.status, "barren");
  assert.equal(barren.coveringSire, "JUSTIFY");

  // The index writes the same mare's season as "Not in foal".
  assert.equal(parseStatus("Not in foal").status, "barren");

  assert.equal(statusLine({ status: "in_foal", coveringSire: "FRANKEL", lastServiceDate: "2026-02-24" }), "i/f FRANKEL lsd 24/02/26");
  assert.equal(statusLine({ status: "maiden" }), "MAIDEN");
  assert.equal(statusLine({ status: "barren", coveringSire: "JUSTIFY" }), "BARREN (to Justify)");
  assert.equal(statusLine({}), null);
});

test("the same text ranks in the index and offers alternatives in a report", () => {
  // The index: a separator is a ranking.
  assert.deepEqual(parseSuggestion("Not This Time/ Night of Thunder"), [
    { rank: 1, stallion: "NOT THIS TIME", region: null, tag: null },
    { rank: 2, stallion: "NIGHT OF THUNDER", region: null, tag: null },
  ]);

  // A report's own preference line: both are first choices, and reading it as
  // a ranking would promote a mare's second string to a decision nobody made.
  assert.deepEqual(parsePreferenceLines(["1st preference: Not This Time / Nyquist"]), [
    { rank: 1, stallion: "NOT THIS TIME", region: null, tag: null },
    { rank: 1, stallion: "NYQUIST", region: null, tag: null },
  ]);
});

test("a preference line carries a jurisdiction and a note about the mating", () => {
  assert.deepEqual(
    parsePreferenceLines(["1st preference USA: Not This Time", "1st preference EU: Frankel"]),
    [
      { rank: 1, stallion: "NOT THIS TIME", region: "USA", tag: null },
      { rank: 1, stallion: "FRANKEL", region: "EU", tag: null },
    ],
  );
  assert.deepEqual(parsePreferenceLines(["2nd preference: Night of Thunder (3x3 Galileo)"]), [
    { rank: 2, stallion: "NIGHT OF THUNDER", region: null, tag: "3x3 Galileo" },
  ]);
  // Anything that is not a preference line is not one.
  assert.deepEqual(parsePreferenceLines(["Race Record: won a 7f novice"]), []);
});

test("the desk's abbreviations are the horses they stand for", () => {
  assert.equal(parseSuggestion("NTT")[0].stallion, "NOT THIS TIME");
  assert.equal(parseSuggestion("SSB")[0].stallion, "STARSPANGLEDBANNER");
  assert.deepEqual(parseSuggestion(""), []);
  assert.deepEqual(parseSuggestion("-"), []);
});

test("a season row treats the empty string as unset and refuses a date it cannot read", () => {
  const row = seasonRowFrom({
    status: "in_foal",
    coveringSire: "frankel (GB)",
    lastServiceDate: "24 Feb 26",
    foaledDate: "",
    foalBy: "",
    foalSex: "Filly",
  });
  assert.equal(row.status, "in_foal");
  assert.equal(row.covering_sire, "FRANKEL");
  assert.equal(row.last_service_date, "2026-02-24");
  assert.equal(row.foaled_date, null);
  assert.equal(row.foal_by, null);
  assert.equal(row.foal_sex, "f");

  assert.throws(() => seasonRowFrom({ status: "pregnant" }), /status must be one of/);
  assert.throws(() => seasonRowFrom({ foaledDate: "whenever" }), /foaledDate is not a date/);
});

test("the fixture wins over the database, and what the database knows alone survives", () => {
  const merged = mergeMareRow(
    // What we hold: a French runner our results feed could not name parents for.
    { horse_name: "ANTISANA", country_code: "FRA", foaling_year: 0, sire_name: null, dam_name: null, best_rating: 75 },
    { name: "ANTISANA", foaledIn: "FR", yob: 2017, sire: "SIYOUNI", dam: "ANTARCTICA", damsire: "GALILEO", client: "Wathnan Racing" },
  );
  assert.equal(merged.sire_name, "SIYOUNI");
  assert.equal(merged.damsire_name, "GALILEO");
  assert.equal(merged.foaling_year, 2017);
  assert.equal(merged.client_name, "Wathnan Racing");
  // The rating came from our data and the fixture says nothing about it.
  assert.equal(merged.best_rating, 75);
  assert.equal(merged.role, "broodmare");
});

test("a search hit is accepted only when it is unambiguously her", () => {
  const hits = [
    { horse_name: "DARE TO DREAM", foaling_year: 2021, sire_name: "EXCEED AND EXCEL", best_rating: 106 },
  ];
  // Same name, same year, different stallion: this is not our mare, and a
  // rating attached to the wrong horse is invisible once it is saved.
  assert.equal(pickSearchHit(hits, { year: 2021, sire: "CAMELOT" }), null);
  assert.equal(pickSearchHit(hits, { year: 2021, sire: "Exceed and Excel" })?.best_rating, 106);

  // Our data does not always know the sire; that is not a disagreement.
  const unparented = [{ horse_name: "OLENTIA", foaling_year: 2019, sire_name: null, best_rating: 111 }];
  assert.equal(pickSearchHit(unparented, { year: 2019, sire: "ZOUSTAR" })?.best_rating, 111);

  // Two of a name and a year: pick neither.
  const twins = [
    { horse_name: "SCENIC", foaling_year: 2020, sire_name: null },
    { horse_name: "SCENIC", foaling_year: 2020, sire_name: null },
  ];
  assert.equal(pickSearchHit(twins, { year: 2020 }), null);
  assert.equal(pickSearchHit([], { year: 2020 }), null);
});
