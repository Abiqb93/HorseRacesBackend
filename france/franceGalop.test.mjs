/**
 * Unit tests for the France Galop scraper, the FG normaliser and the merge.
 *
 * Run: node --test scripts/france/franceGalop.test.mjs
 *
 * No network. Every fixture is a real string taken from a live page — most of
 * these tests exist because the live page surprised us.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  parseFrInt,
  parseFrDecimal,
  parseHorseCell,
  parsePedigreeCell,
  parseFieldCounts,
} from "./franceGalopClient.mjs";
import { normalizeGoing, normalizeRaceType, blackTypeFromFG, isThoroughbred, normalizeFGRunner } from "./normalizeFG.mjs";
import { raceKey, runnerKey, mergeRunner, mergeDay, findIncompleteRaces } from "./mergeSources.mjs";

/* ---------------- numbers ---------------- */

test("a dot before three digits is a thousands separator", () => {
  assert.equal(parseFrInt("3.400"), 3400); // metres
  assert.equal(parseFrInt("16.000"), 16000); // prize
  assert.equal(parseFrInt("1.518.628"), 1518628);
  assert.equal(parseFrInt("124695"), 124695); // no separator at all
});

test("a comma is always a decimal separator", () => {
  assert.equal(parseFrDecimal("59,5 kg"), 59.5);
  assert.equal(parseFrDecimal("4,2"), 4.2);
});

test("a dot before one or two digits is a decimal separator", () => {
  // The Valeur column uses a dot; the weight column uses a comma. Same page.
  assert.equal(parseFrDecimal("43.5"), 43.5);
  assert.equal(parseFrDecimal("28"), 28);
});

test("parseFrDecimal still reads a thousands-dotted integer", () => {
  assert.equal(parseFrDecimal("1.400"), 1400);
});

/* ---------------- horse cell ---------------- */

test("horse cell parses with no country suffix", () => {
  const r = parseHorseCell("EL PROFESSOR CHOP H.PS. 6 a.");
  assert.equal(r.horseName, "EL PROFESSOR CHOP");
  assert.equal(r.country, null);
  assert.equal(r.sex, "g");
  assert.equal(r.age, 6);
});

test("racecard writes the suffix in brackets", () => {
  const r = parseHorseCell("CANTAVIR (GB) M.PS. 2 a.");
  assert.equal(r.horseName, "CANTAVIR");
  assert.equal(r.country, "GB");
  assert.equal(r.sex, "c");
});

test("result page writes the same suffix bare", () => {
  // The two page types genuinely differ; both must work.
  const r = parseHorseCell("HEMATITE IRE F.PS. 4 a.");
  assert.equal(r.horseName, "HEMATITE");
  assert.equal(r.country, "IRE");
  assert.equal(r.sex, "f");
});

test("the markup is lowercase — CSS only makes it look uppercase", () => {
  const r = parseHorseCell("daring prince (gb) m.ps. 5 a.");
  assert.equal(r.horseName, "DARING PRINCE");
  assert.equal(r.country, "GB");
  assert.equal(r.age, 5);
});

test("the unstripped name is kept so a bare-suffix guess is recoverable", () => {
  const r = parseHorseCell("HEMATITE IRE F.PS. 4 a.");
  assert.equal(r.horseNameRaw, "HEMATITE IRE");
});

test("AQPS is flagged by breed and excluded from thoroughbred ingest", () => {
  assert.equal(parseHorseCell("SOME HORSE H.AQPS. 5 a.").breed, "AQPS");
  assert.equal(isThoroughbred({ breed: "AQPS" }), false);
  assert.equal(isThoroughbred({ breed: "PS" }), true);
});

/* ---------------- pedigree ---------------- */

test("pedigree cell yields sire, dam and damsire", () => {
  const r = parsePedigreeCell("Par: VALE OF YORK et MA VICTORYAN (KHELEYF)");
  assert.equal(r.sireName, "VALE OF YORK");
  assert.equal(r.damName, "MA VICTORYAN");
  assert.equal(r.damsireName, "KHELEYF");
});

test("pedigree cell copes with no damsire", () => {
  const r = parsePedigreeCell("Par: RECORDER et KENSHABA");
  assert.equal(r.sireName, "RECORDER");
  assert.equal(r.damName, "KENSHABA");
  assert.equal(r.damsireName, null);
});

/* ---------------- field counts ---------------- */

test("the entries line is parsed — this is the entries data", () => {
  const c = parseFieldCounts(
    "ARRIVEE NON ENREGISTREE : 19 Engagés. 8 Forfaits. 1 Non-Déclaré-Partant. 10 Partants Définitifs.",
  );
  assert.equal(c.entered, 19);
  assert.equal(c.forfeits, 8);
  assert.equal(c.notDeclared, 1);
  assert.equal(c.declared, 10);
});

test("supplemented runners are counted", () => {
  const c = parseFieldCounts("ARRIVEE OFFICIELLE : 11 Engagés. 1 Supplémentaire. 11 Partants Définitifs.");
  assert.equal(c.entered, 11);
  assert.equal(c.supplemented, 1);
  assert.equal(c.declared, 11);
  assert.equal(c.forfeits, null); // absent, not zero
});

/* ---------------- normalisation ---------------- */

test("French going maps to the platform's vocabulary", () => {
  assert.equal(normalizeGoing("collant"), "Holding");
  assert.equal(normalizeGoing("tr souple"), "Soft");
  assert.equal(normalizeGoing("bon"), "Good");
  assert.equal(normalizeGoing("TRES LOURD"), "Very Heavy");
});

test("discipline letter decides Flat vs Jumps", () => {
  assert.equal(normalizeRaceType({ disciplineLetter: "O" }), "Jumps");
  assert.equal(normalizeRaceType({ disciplineLetter: "P" }), "Flat");
  assert.equal(normalizeRaceType({ speciality: "S (4 ans)" }), "Jumps");
  assert.equal(normalizeRaceType({ speciality: "P (3 ans)" }), "Flat");
});

test("black type comes off the France Galop category", () => {
  assert.deepEqual(blackTypeFromFG({ raceCategory: "GROUPE I" }), { group: 1, listed: 0 });
  assert.deepEqual(blackTypeFromFG({ raceCategory: "GROUPE III" }), { group: 3, listed: 0 });
  assert.deepEqual(blackTypeFromFG({ raceTitle: "PRIX NUREYEV (LISTED)" }), { group: null, listed: 1 });
  assert.deepEqual(blackTypeFromFG({ raceCategory: "HANDICAP DIVISE" }), { group: null, listed: 0 });
});

/* ---------------- merge ---------------- */

test("race key uses race number, because two races often share a distance", () => {
  const a = { meetingDate: "2026-08-21", courseName: "CLAIREFONTAINE", raceNumber: 6, distanceMetres: 1400 };
  const b = { meetingDate: "2026-08-21", courseName: "CLAIREFONTAINE", raceNumber: 7, distanceMetres: 1400 };
  assert.notEqual(raceKey(a), raceKey(b));
});

test("race key survives the two sources spelling a course differently", () => {
  assert.equal(
    raceKey({ meetingDate: "2026-06-07", courseName: "ParisLongchamp", raceNumber: 1 }),
    raceKey({ meetingDate: "2026-06-07", courseName: "LONGCHAMP", raceNumber: 1 }),
  );
});

test("runner key is the cloth number", () => {
  assert.equal(runnerKey({ clothNumber: 7, horseName: "X" }), "7");
});

test("France Galop wins a conflict, PMU fills what it alone holds", () => {
  const fg = {
    horseName: "WHISKEY BENT", sireName: "HELLO YOUMZAIN", damName: "ANSWER ME",
    officialRating: 43.5, primeEleveur: 3116, positionOfficial: 1, sourceHorseId: "FGID",
  };
  const pmu = {
    horseName: "WHISKEY BENT", sireName: "WRONG SIRE", damName: null,
    officialRating: 40, ispDecimal: 4.3, public_comments: "Co animateur…",
    sourceHorseId: "WHISKEY BENT-ANSWER ME-HELLO YOUMZAIN", positionOfficial: 1,
  };
  const m = mergeRunner(fg, pmu);
  assert.equal(m.sireName, "HELLO YOUMZAIN", "FG wins the conflict");
  assert.equal(m.officialRating, 43.5, "FG wins the conflict");
  assert.equal(m.ispDecimal, 4.3, "PMU contributes what only it has");
  assert.equal(m.public_comments, "Co animateur…");
  assert.deepEqual(m.sources, ["FG", "PMU"]);
  assert.equal(m.fgHorseId, "FGID");
});

test("a PMU value fills a gap France Galop leaves", () => {
  const m = mergeRunner({ horseName: "X", damName: null }, { horseName: "X", damName: "SOME MARE" });
  assert.equal(m.damName, "SOME MARE");
});

test("a France-Galop-only meeting still comes through", () => {
  // Beaupreau: PMH, so PMU has nothing at all for it.
  const fgRows = [
    { meetingDate: "2026-08-22", courseName: "BEAUPREAU", raceNumber: 2, clothNumber: 1, horseName: "A", numberOfRunners: 2 },
    { meetingDate: "2026-08-22", courseName: "BEAUPREAU", raceNumber: 2, clothNumber: 2, horseName: "B", numberOfRunners: 2 },
  ];
  const { rows, stats } = mergeDay(fgRows, []);
  assert.equal(rows.length, 2);
  assert.equal(stats.racesFgOnly, 1);
  assert.equal(stats.racesPmuOnly, 0);
  assert.deepEqual(stats.fgOnlyCourses, ["BEAUPREAU"]);
});

test("a disagreement on a settled result is surfaced, not silently resolved", () => {
  const fg = [{ meetingDate: "2026-08-21", courseName: "X", raceNumber: 1, clothNumber: 1, horseName: "A", positionOfficial: 1 }];
  const pmu = [{ meetingDate: "2026-08-21", courseName: "X", raceNumber: 1, clothNumber: 1, horseName: "A", positionOfficial: 3 }];
  const { stats } = mergeDay(fg, pmu);
  assert.equal(stats.conflicts.length, 1);
  assert.equal(stats.conflicts[0].field, "positionOfficial");
});

test("a short race is detectable from our own rows", () => {
  const rows = [
    { meetingDate: "2026-08-16", courseName: "ROYAN", raceNumber: 1, horseName: "A", numberOfRunners: 8 },
    { meetingDate: "2026-08-16", courseName: "ROYAN", raceNumber: 1, horseName: "B", numberOfRunners: 8 },
  ];
  const short = findIncompleteRaces(rows);
  assert.equal(short.length, 1);
  assert.equal(short[0].held, 2);
  assert.equal(short[0].expected, 8);
});

test("a complete race is not flagged", () => {
  const rows = [
    { meetingDate: "2026-08-16", courseName: "ROYAN", raceNumber: 1, horseName: "A", numberOfRunners: 2 },
    { meetingDate: "2026-08-16", courseName: "ROYAN", raceNumber: 1, horseName: "B", numberOfRunners: 2 },
  ];
  assert.equal(findIncompleteRaces(rows).length, 0);
});

test("files a France Galop runner under the country the race was run in", () => {
  // countryCode is the race country across the platform -- every runner at
  // Southwell is GBR whatever its breeding. This carried the breeding country,
  // so one French card arrived split across FR, FRA, IRE, GB and GER and the
  // results page, which groups on it, showed France twice over.
  const row = (country) =>
    normalizeFGRunner({
      fixture: { meetingDate: "2026-08-30" },
      race: { meetingDate: "2026-08-30", raceCode: "X" },
      runner: { horseName: "A HORSE", country, age: 4 },
    });

  assert.equal(row("GB").countryCode, "FRA");
  assert.equal(row("IRE").countryCode, "FRA");
  assert.equal(row(null).countryCode, "FRA");

  // The breeding country is not lost -- it has its own column, and that is
  // the one that should differ between runners. It is written in the
  // platform's vocabulary, which spells a British-bred horse GBR.
  assert.equal(row("GB").horseCountry, "GBR");
  assert.equal(row("IRE").horseCountry, "IRE");
  assert.equal(row(null).horseCountry, "FR");
});
