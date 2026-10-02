import test from "node:test";
import assert from "node:assert/strict";
import {
  dayKey, clockKey, nameKey, trackKey, attachRunnerFacts, attachRaceFacts, raceTracks, runnerNames,
} from "./racecardFacts.mjs";

// Drymee as the morning job stored it, and as the racecard prints it.
const DRYMEE = {
  id: 16, section: "DECLARATIONS_WINDOW", source: "RacesAndEntries", category: "JOCKEY", tag: "James Doyle",
  horseName: "Drymee", raceDate: "2026-10-02T00:00:00.000Z", raceDateStr: "02-10-2026", raceTime: "3.00pm",
  raceSortTime: "15:00:00", track: "Ascot", raceTitle: "Colliers Business Rates Experts Classified Stakes (class 3)",
  jockeyFullName: "James Doyle", done: 0, notes: null,
};
const DRYMEE_CARD = {
  Horse: "Drymee", Rider: "James Doyle", Rating: "87", Distance: "1m", Status: "Runners published",
  RaceTime: "3.00pm", RaceID: "47614", RaceTitle: "Colliers Business Rates Experts Classified Stakes (Class 3)",
  FixtureTrack: "ASCOT", FixtureDate: "Friday 2  October 2026",
};

test("a race day reads the same from every shape the tables hold", () => {
  for (const v of ["Friday 2  October 2026", "2026-10-02", "2026-10-02T00:00:00.000Z", "02-10-2026", "2/10/2026",
    "Friday, 2nd October 2026", new Date(2026, 9, 2)]) {
    assert.equal(dayKey(v), "2026-10-02", String(v));
  }
  for (const v of ["0000-00-00", "", null, undefined, "2026-02-31", "31-02-2026", "soon", new Date(NaN)]) {
    assert.equal(dayKey(v), "", String(v));
  }
});

test("a race time reads as the 24-hour clock, an unmarked early hour being the afternoon", () => {
  const cases = {
    "3.00pm": "15:00", "3:00 PM": "15:00", "05:18 PM": "17:18", "15:00": "15:00", "15:00:00": "15:00",
    "12.15pm": "12:15", "12:05 AM": "00:05", "11.30am": "11:30", "1.50": "13:50", "11:00": "11:00", "17:14": "17:14",
    "09:30:00": "09:30", "00:30:00": "00:30",
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(clockKey(raw), want, raw);
  for (const bad of ["", null, "TBC", "25:00", "3.75pm"]) assert.equal(clockKey(bad), "", String(bad));
});

test("a horse and a course match whatever their case, spacing or country suffix", () => {
  assert.equal(nameKey(" DRYMEE "), "drymee");
  assert.equal(nameKey("Lion's  Pride (IRE)"), "lion's pride");
  assert.equal(trackKey(" Kempton  park "), "KEMPTON PARK");
  assert.deepEqual(runnerNames([{ horseName: "Drymee" }, { horseName: "drymee" }, { horseName: "Galileo Gold (GB)" }, {}]),
    ["Drymee", "drymee", "Galileo Gold"]);
  assert.deepEqual(raceTracks([{ track: "Ascot" }, { track: "ASCOT" }, { track: "" }, { track: "Hereford" }]), ["ASCOT", "HEREFORD"]);
});

test("a horse item gains its runner's distance, rating, declaration and the racecard's title", () => {
  const [out] = attachRunnerFacts([DRYMEE], [DRYMEE_CARD]);
  assert.equal(out.distance, "1m");
  assert.equal(out.officialRating, "87");
  assert.equal(out.entryStatus, "Runners published");
  assert.equal(out.racecardTitle, "Colliers Business Rates Experts Classified Stakes (Class 3)");
  // and keeps everything it had
  for (const k of Object.keys(DRYMEE)) assert.deepEqual(out[k], DRYMEE[k], k);
});

test("what an item already holds is never overwritten, and a blank or '--' fills nothing", () => {
  const [out] = attachRunnerFacts([{ ...DRYMEE, distance: "7f", officialRating: "" }], [{ ...DRYMEE_CARD, Rating: "--", Status: "" }]);
  assert.equal(out.distance, "7f");
  assert.equal(out.officialRating, "");
  assert.equal(out.entryStatus, undefined);
});

test("a horse with two racecard rows that day takes the one at its course and time", () => {
  const elsewhere = { ...DRYMEE_CARD, FixtureTrack: "NEWMARKET", RaceTime: "2.25pm", Distance: "7f", RaceTitle: "Other race (Class 4)" };
  const twin = { ...DRYMEE_CARD, FixtureDate: "2026-10-02" };
  assert.equal(attachRunnerFacts([DRYMEE], [elsewhere, DRYMEE_CARD])[0].distance, "1m");
  assert.equal(attachRunnerFacts([DRYMEE], [elsewhere, twin])[0].distance, "1m", "the same race stored under its other date format");
  // a different day is a different race
  assert.equal(attachRunnerFacts([DRYMEE], [{ ...DRYMEE_CARD, FixtureDate: "Saturday 3  October 2026" }])[0].distance, undefined);
});

test("an item that matches nothing, or cannot be read, comes back as it went in", () => {
  const result = { ...DRYMEE, section: "RESULTS_YESTERDAY", horseName: "Not On The Card" };
  const undated = { ...DRYMEE, raceDate: null, raceDateStr: "" };
  const nameless = { ...DRYMEE, horseName: "" };
  const out = attachRunnerFacts([result, undated, nameless], [DRYMEE_CARD]);
  assert.equal(out[0], result);
  assert.equal(out[1], undated);
  assert.equal(out[2], nameless);
  assert.deepEqual(attachRunnerFacts([], [DRYMEE_CARD]), []);
  assert.deepEqual(attachRunnerFacts([DRYMEE], []), [DRYMEE]);
});

test("a race item gains its distance and title, by course, day and time or else by title", () => {
  const race = { id: 146, race_title: "Colliers Business Rates Experts Classified Stakes (Class 3)", race_date: "2026-10-02T00:00:00.000Z", race_time: "15:00", track: "Ascot" };
  const [bySlot] = attachRaceFacts([race], [DRYMEE_CARD]);
  assert.equal(bySlot.distance, "1m");
  assert.equal(bySlot.racecardTitle, DRYMEE_CARD.RaceTitle);
  const [byTitle] = attachRaceFacts([{ ...race, race_time: "", track: "" }], [DRYMEE_CARD]);
  assert.equal(byTitle.distance, "1m");
  const manual = { id: 93, race_title: "test", race_date: "0000-00-00", race_time: "16:00", track: "test" };
  assert.equal(attachRaceFacts([manual], [DRYMEE_CARD])[0], manual);
  const other = { ...race, race_date: "2026-10-03" };
  assert.equal(attachRaceFacts([other], [DRYMEE_CARD])[0], other);
});
