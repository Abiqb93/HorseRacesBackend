import test from "node:test";
import assert from "node:assert/strict";
import { buildAux, buildDash, normHorseKey, RACE_FEED_NAMES } from "./dashboard.mjs";

// Midday on 30 October on this machine's clock, as the builder sets it.
const NOW = new Date("2026-10-30T12:00:00");

/** The six feeds, in the page's order, with rows only where given. */
const feeds = (by = {}) => RACE_FEED_NAMES.map((name) => ({ data: by[name] || [] }));

const card = (over) => ({
  Horse: "FRANKEL (GB)", RaceTitle: "Dewhurst Stakes", FixtureTrack: "Newmarket", RaceTime: "2.30pm",
  FixtureDate: "2026-10-30", Rider: "Tom Queally", Owner: "Juddmonte", Trainer: "John & Thady Gosden", ...over,
});

test("a horse is marked by every reason it is on the list, and filed today or upcoming", () => {
  const f = feeds({
    RacesAndEntries: [
      card({}),
      card({ Horse: "KINGMAN", FixtureDate: "2026-11-02", Rider: "James Doyle", Owner: "Someone Else" }),
      card({ Horse: "YESTERDAY'S HORSE", FixtureDate: "2026-10-29" }),
    ],
  });
  const aux = buildAux({
    userId: "Tom", feeds: f, reviewed: [], shares: [], sires: [{ sireName: "Galileo" }], dams: [], owners: [],
    jockeys: [{ jockeyFullName: "James Doyle" }], sireHorses: { Galileo: ["FRANKEL"] }, damHorses: {}, now: NOW,
  });
  const dash = buildDash({
    trackingRows: [{ horseName: "Frankel", TrackingType: "Prospect", trackingDate: "2026-10-01", silkCode: "123" }],
    feeds: f, results: [], aux, now: NOW,
  });
  const today = dash.groupedNotifications.RaceUpdates.today;
  const upcoming = dash.groupedNotifications.RaceUpdates.upcoming;
  assert.deepEqual(today.map((n) => [n.rawHorseName, n.sources]), [["FRANKEL (GB)", ["DIRECT", "SIRE"]]]);
  assert.deepEqual(upcoming.map((n) => [n.rawHorseName, n.sources, n.dayDiff]), [["KINGMAN", ["JOCKEY"], 3]]);
  assert.equal(today[0].raceDateISO, "2026-10-30T00:00:00.000Z");
  assert.equal(today[0].silkCode, 123);
  assert.deepEqual(aux.sireUpdates.map((r) => [r.horseName, r.sireName]), [["FRANKEL (GB)", "Galileo"]]);
  assert.deepEqual(aux.jockeyUpdates.map((r) => r.horseName), ["KINGMAN"]);
  assert.deepEqual(dash.trackedHorses, ["frankel"]);
});

test("an owner's horse counts only while the row still names that owner, or names nobody", () => {
  const f = feeds({
    RacesAndEntries: [
      card({ Horse: "FORTIFICATION", Owner: "Spring Cottage Syndicate" }),
      card({ Horse: "STILL OURS", Owner: "WATHNAN RACING" }),
    ],
    FranceRaceRecords: [{ Horse: "FRENCH ONE", Date: "2026-10-31", Race: "Prix X", Racecourse: "Chantilly" }],
  });
  const aux = buildAux({
    userId: "Tom", feeds: f, reviewed: [], shares: [], sires: [], dams: [], jockeys: [],
    owners: [{ ownerFullName: "Wathnan Racing", correspondingHorses: JSON.stringify(["Fortification", "Still Ours", "French One"]) }],
    sireHorses: {}, damHorses: {}, now: NOW,
  });
  assert.deepEqual(aux.ownerUpdates.map((r) => [r.horseName, r.ownerName, r.source]), [
    ["STILL OURS", "WATHNAN RACING", "RacesAndEntries"],
    ["FRENCH ONE", "Wathnan Racing", "FranceRaceRecords"],
  ]);
});

test("a horse whose latest tracking says Stopped, or that has only notes, is not counted as tracked", () => {
  const rows = [
    { horseName: "Stopped One", TrackingType: "Prospect", trackingDate: "2026-09-01" },
    { horseName: "Stopped One", TrackingType: "Stopped", trackingDate: "2026-10-01" },
    { horseName: "Notes Only", TrackingType: "Private Note", trackingDate: "2026-10-01" },
    { horseName: "Live One (IRE)", TrackingType: "Purchase", trackingDate: "2026-10-01" },
  ];
  const aux = buildAux({ userId: "Tom", feeds: feeds(), reviewed: [], shares: [], sires: [], dams: [], owners: [], jockeys: [], sireHorses: {}, damHorses: {}, now: NOW });
  const dash = buildDash({ trackingRows: rows, feeds: feeds(), results: [], aux, now: NOW });
  assert.deepEqual(dash.trackedHorses, ["live one"]);
  assert.deepEqual(Object.keys(dash.trackingCache).sort(), ["live one", "notes only", "stopped one"]);
});

test("a result is one row per horse per race, with every reason it is there", () => {
  const record = {
    horseName: "FRANKEL", raceTitle: "Juddmonte International", meetingDate: "2026-10-29T00:00:00.000Z",
    scheduledTimeOfRaceLocal: "2026-10-29T15:35:00.000Z", courseName: "YORK", positionOfficial: 1, jockeyFullName: "Tom Queally",
    ownerFullName: "Juddmonte", silkCode: 77,
  };
  const aux = buildAux({
    userId: "Tom", feeds: feeds(), reviewed: [{ horse_name: "Frankel", race_title: "Juddmonte International" }], shares: [],
    sires: [{ sireName: "Galileo" }], dams: [], owners: [], jockeys: [{ jockeyFullName: "Tom Queally" }],
    sireHorses: { Galileo: ["FRANKEL"] }, damHorses: {}, now: NOW,
  });
  const dash = buildDash({
    trackingRows: [{ horseName: "Frankel", TrackingType: "Prospect" }], feeds: feeds(),
    results: [{ date: "2026-10-29", records: [record, { ...record }] }], aux, now: NOW,
  });
  assert.equal(dash.resultsData.length, 1);
  const r = dash.resultsData[0];
  assert.deepEqual(r.sources, ["DIRECT", "SIRE", "JOCKEY"]);
  assert.equal(r.date, "2026-10-29");
  assert.equal(r.time, "03:35 pm");
  assert.equal(r.reviewKey, "frankel-juddmonte international");
  assert.deepEqual(aux.reviewedResultsKeys, ["frankel-juddmonte international"]);
  assert.equal(dash.silkCodeByHorse.frankel, 77);
});

test("names are compared the way the page compares them", () => {
  assert.equal(normHorseKey("  D'Or Et Diamant (FR) "), "dor et diamant");
  assert.equal(normHorseKey("Galileo’s Gold"), "galileos gold");
});
