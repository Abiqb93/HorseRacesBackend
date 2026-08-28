/**
 * French racecards, in RacesAndEntries' own shape.
 *
 * No network: the fixtures are the shapes the live PMU programme returns.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  cardRowFor, fixtureDateOf, raceTimeOf, sessionOf, raceTypeLabelOf, ageGroupOf,
} from "./racecards.mjs";

// Deauville's opener, 30 August 2026: 13:58 in Paris, 11:58 UTC.
const DEAUVILLE_OFF = Date.UTC(2026, 7, 30, 11, 58);

test("states the off time in France, not UTC", () => {
  // Reading PMU's epoch as UTC put this race at 11.58am in the Morning
  // session when it goes off at 1.58pm.
  assert.equal(raceTimeOf(DEAUVILLE_OFF), "1.58pm");
  assert.equal(sessionOf(DEAUVILLE_OFF), "Afternoon");
});

test("splits the day the way the British rows do", () => {
  assert.equal(sessionOf(Date.UTC(2026, 7, 30, 8, 0)), "Morning");   // 10:00 Paris
  assert.equal(sessionOf(Date.UTC(2026, 7, 30, 12, 0)), "Afternoon"); // 14:00
  assert.equal(sessionOf(Date.UTC(2026, 7, 30, 16, 0)), "Evening");   // 18:00
  assert.equal(raceTimeOf(Date.UTC(2026, 7, 30, 10, 0)), "12.00pm");  // noon, not 0
  assert.equal(raceTimeOf(null), null);
});

test("writes the fixture date the way the table already holds it", () => {
  assert.equal(fixtureDateOf("2026-08-28"), "Friday 28  August 2026");
  assert.equal(fixtureDateOf("2026-08-30"), "Sunday 30  August 2026");
  assert.equal(fixtureDateOf("nonsense"), null);
});

test("names the discipline and what it is run on", () => {
  assert.equal(raceTypeLabelOf({ specialite: "PLAT", discipline: "PLAT" }), "Flat / Turf");
  assert.equal(raceTypeLabelOf({ specialite: "OBSTACLE", discipline: "HAIE" }), "Hurdle / Turf");
  assert.equal(raceTypeLabelOf({ specialite: "OBSTACLE", discipline: "STEEPLECHASE" }), "Chase / Turf");
  assert.equal(raceTypeLabelOf({ specialite: "PLAT", discipline: "PLAT", typePiste: "PSF" }),
               "Flat / All Weather");
});

test("reads the age conditions off the card", () => {
  assert.equal(ageGroupOf({ conditions: "POUR 2 ANS" }), "2YO");
  assert.equal(ageGroupOf({ conditions: "POUR POULAINS ET POULICHES DE 3 ET 4 ANS" }), "3-4YO");
  assert.equal(ageGroupOf({ conditions: "" }), null);
});

const RUNNER = {
  numPmu: 1, placeCorde: 7, nom: "KORONTANA BE", age: 2, sexe: "MALES",
  driver: "J.MOUTARD", entraineur: "M.ANDRIANTSOA RATSIMIHAH",
  proprietaire: "M.ANDRIANTSOA RATSIMIHAH", handicapPoids: 580, statut: "PARTANT",
};
const COURSE = {
  numExterne: 1, libelle: "PRIX CASINO BARRIERE DEAUVILLE", distance: 1200,
  specialite: "PLAT", discipline: "PLAT", heureDepart: DEAUVILLE_OFF,
  montantPrix: 27400, nombreDeclaresPartants: 12, conditions: "POUR 2 ANS",
};
const MEETING = { numOfficiel: 1, hippodrome: { libelleLong: "HIPPODROME DE DEAUVILLE" } };

const row = () => cardRowFor({ meeting: MEETING, course: COURSE, participant: RUNNER,
                               isoDate: "2026-08-30", seq: 0 });

test("gives a runner its space after the initial", () => {
  // PMU shouts "J.MOUTARD"; without the space the surname keeps the lower
  // case that follows the dot and it reads "J.moutard".
  assert.equal(row().Rider, "J. Moutard");
  assert.equal(row().Trainer, "M. Andriantsoa Ratsimihah");
  assert.equal(row().Horse, "Korontana Be");
});

test("keeps French units as French units", () => {
  // A French runner carries kilos and a French race is run over metres;
  // converting either into the British column's units would be a claim
  // nobody made.
  assert.equal(row().Weight, "58.0kg");
  assert.equal(row().Distance, "1200m");
  assert.equal(row().Prize, "€27,400");
});

test("fills the columns the racecards page reads", () => {
  const r = row();
  assert.equal(r["No."], "1");
  assert.equal(r.No_Draw, "7");
  assert.equal(r.Age, "2");
  assert.equal(r.Sex, "C");
  assert.equal(r.Entries, "12");
  assert.equal(r.FixtureTrack, "DEAUVILLE");
  assert.equal(r.FixtureDate, "Sunday 30  August 2026");
  assert.equal(r.RaceType, "Flat / Turf");
  assert.equal(r.RaceTime, "1.58pm");
  assert.equal(r.RaceID, "2026-08-30:R1:C1");
  assert.equal(r.Status, "Runners published");
});

test("marks the feed so the British rows are never confused with these", () => {
  assert.equal(row().source, "France");
});

test("marks a declared non-runner as one", () => {
  const r = cardRowFor({
    meeting: MEETING, course: COURSE,
    participant: { ...RUNNER, statut: "NON_PARTANT" },
    isoDate: "2026-08-30", seq: 0,
  });
  assert.equal(r.Status, "Non-runner");
});

test("sexes a runner the way the table does", () => {
  const sexOf = (sexe) => cardRowFor({
    meeting: MEETING, course: COURSE, participant: { ...RUNNER, sexe },
    isoDate: "2026-08-30", seq: 0,
  }).Sex;
  assert.equal(sexOf("MALES"), "C");
  assert.equal(sexOf("FEMELLES"), "F");
  assert.equal(sexOf("HONGRES"), "G");
  assert.equal(sexOf("WHAT"), null);
});
