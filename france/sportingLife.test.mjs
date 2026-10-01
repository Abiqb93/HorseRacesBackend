/**
 * Sporting Life as the stopgap for French cards PMU has not published.
 *
 * No network: the fixtures are the shapes Sporting Life's JSON returned for
 * the Arc Saturday card on 1 October 2026.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { isFrenchMeeting, trackKey, offEpoch, slCardRowFor, mergeCardSources } from "./sportingLife.mjs";

const MEETING = {
  meeting_summary: {
    date: "2026-10-03",
    course: { name: "ParisLongchamp", country: { long_name: "France" } },
  },
};
const RACE = {
  race_summary_reference: { id: 939421 },
  name: "Qatar Prix Daniel Wildenstein (Group 2)",
  course_name: "ParisLongchamp",
  course_surface: { surface: "TURF" },
  age: "3YO plus",
  distance: "7f 209y",
  date: "2026-10-03",
  time: "15:35",
  ride_count: 10,
};
const RIDE = {
  cloth_number: 4, draw_number: 4, ride_status: "RUNNER", handicap: "9-2", official_rating: 107,
  owner: { name: "Wathnan Racing" }, trainer: { name: "H Al Jehani" }, jockey: { name: "C Rodriguez" },
  horse: { name: "Diego Ventura", age: 4, sex: { type: "g" }, slug: "diego-ventura/1153127" },
};

test("knows a French meeting from a British one", () => {
  assert.equal(isFrenchMeeting(MEETING), true);
  assert.equal(isFrenchMeeting({ meeting_summary: { course: { country: { long_name: "England" } } } }), false);
  assert.equal(isFrenchMeeting({}), false);
});

test("ParisLongchamp is the Longchamp PMU and the table already hold", () => {
  assert.equal(trackKey("ParisLongchamp"), trackKey("LONGCHAMP"));
  assert.equal(trackKey("Saint-Cloud"), trackKey("SAINT CLOUD"));
  assert.notEqual(trackKey("Chantilly"), trackKey("LONGCHAMP"));
});

test("reads Sporting Life's clock as UTC and states it in Paris", () => {
  // Racing Post shows this race at 4.35pm in London; it goes off at 5.35pm in Paris.
  assert.equal(offEpoch("2026-10-03", "15:35"), Date.UTC(2026, 9, 3, 15, 35));
  assert.equal(offEpoch("2026-10-03", ""), null);
  assert.equal(slCardRowFor({ meeting: MEETING, race: RACE, ride: RIDE, isoDate: "2026-10-03", seq: 7 }).RaceTime, "5.35pm");
});

test("writes a ride in RacesAndEntries' own shape", () => {
  const row = slCardRowFor({ meeting: MEETING, race: RACE, ride: RIDE, isoDate: "2026-10-03", seq: 7, prize: "€104,310" });
  assert.equal(row.Horse, "Diego Ventura");
  assert.equal(row.FixtureTrack, "LONGCHAMP");
  assert.equal(row.FixtureDate, "Saturday 3  October 2026");
  assert.equal(row.RaceTitle, "Qatar Prix Daniel Wildenstein (Group 2)");
  assert.equal(row.Owner, "Wathnan Racing");
  assert.equal(row.Sex, "G");
  assert.equal(row.RaceID, "SL:939421");
  assert.equal(row.Status, "Runners published");
  assert.equal(row.source, "France");
  assert.equal(row.Session, "Evening");
  assert.match(row.RaceURL, /\/2026-10-03\/parislongchamp\/racecard\/939421\/qatar-prix-daniel-wildenstein-group-2$/);
});

test("a withdrawn horse is written as a non-runner", () => {
  const row = slCardRowFor({ meeting: MEETING, race: RACE, ride: { ...RIDE, ride_status: "NON_RUNNER" }, isoDate: "2026-10-03", seq: 0 });
  assert.equal(row.Status, "Non-runner");
});

test("PMU's meeting wins; Sporting Life fills only what PMU has not published", () => {
  const pmu = [{ FixtureTrack: "LONGCHAMP", Horse: "A" }, { FixtureTrack: "CABOURG", Horse: "B" }];
  const sl = [
    { FixtureTrack: "LONGCHAMP", Horse: "A" },   // PMU has Longchamp: dropped
    { FixtureTrack: "CHANTILLY", Horse: "C" },   // PMU does not: kept
  ];
  const { rows, fromSportingLife } = mergeCardSources(pmu, sl);
  assert.equal(fromSportingLife, 1);
  assert.deepEqual(rows.map((r) => r.Horse), ["A", "B", "C"]);
  assert.equal(mergeCardSources([], sl).rows.length, 2);
  assert.equal(mergeCardSources(pmu, []).rows.length, 2);
});
