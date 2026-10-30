import test from "node:test";
import assert from "node:assert/strict";
import { createHomeBuilder, londonDay, VERSION, DEBOUNCE_MS } from "./builder.mjs";

const quiet = { log() {}, warn() {} };

/** A database holding users and stored lists, and this server's routes as a map of path -> JSON. */
const setup = ({ users = ["Tom", "Katie"], routes = {}, failFor = null } = {}) => {
  const stored = new Map();
  const asked = [];
  const runQuery = async (sql, params) => {
    if (/CREATE TABLE/.test(sql)) return [];
    if (/FROM UserAccounts/.test(sql)) return users.map((user_id) => ({ user_id }));
    if (/^\s*INSERT/.test(sql)) { stored.set(params[0], { day: params[1], body: params[4] }); return []; }
    if (/SELECT body/.test(sql)) return stored.has(params[0]) ? [{ body: stored.get(params[0]).body }] : [];
    if (/COUNT\(\*\)/.test(sql)) return [{ n: [...stored.values()].filter((v) => v.day === params[0]).length }];
    throw new Error(`unexpected ${sql}`);
  };
  const fetchJson = async (path) => {
    asked.push(path);
    if (failFor && path.includes(`user=${failFor}`)) throw new Error(`${path}: HTTP 500`);
    return routes[path.split("?")[0]] ?? { data: [] };
  };
  const offspring = async (kind, names) => Object.fromEntries(names.map((n) => [n, kind === "sire" ? ["FRANKEL"] : []]));
  return { stored, asked, runQuery, fetchJson, offspring };
};

const clock = () => new Date("2026-10-30T07:05:00Z");

test("a round reads the feeds and three days of results once, then stores every user's lists for London's day", async () => {
  const s = setup({
    routes: {
      "/api/RacesAndEntries": { data: [{ Horse: "FRANKEL", FixtureDate: "2026-10-30", RaceTitle: "Dewhurst", RaceTime: "2.30pm" }] },
      "/api/sire_tracking": { data: [{ sireName: "Galileo" }] },
    },
  });
  const b = createHomeBuilder({ ...s, clock, log: quiet });
  await b.buildAll("test");
  const feedReads = s.asked.filter((p) => p.startsWith("/api/RacesAndEntries"));
  assert.deepEqual(feedReads, ["/api/RacesAndEntries?from=2026-10-30"]);
  assert.deepEqual(
    s.asked.filter((p) => p.startsWith("/api/APIData_Table2")),
    ["/api/APIData_Table2?meetingDate=2026-10-30", "/api/APIData_Table2?meetingDate=2026-10-29", "/api/APIData_Table2?meetingDate=2026-10-28"],
  );
  assert.deepEqual([...s.stored.keys()], ["Tom", "Katie"]);
  const tom = await b.read("Tom");
  assert.equal(tom.version, VERSION);
  assert.equal(tom.day, "2026-10-30");
  assert.deepEqual(tom.aux.sireUpdates.map((r) => r.horseName), ["FRANKEL"]);
  assert.deepEqual(tom.dash.groupedNotifications.RaceUpdates.today.map((n) => n.sources), [["SIRE"]]);
  assert.equal(await b.builtToday(), true);
  assert.equal(b.status().users, 2);
});

test("one user who cannot be built does not stop the rest", async () => {
  const s = setup({ failFor: "Tom" });
  const b = createHomeBuilder({ ...s, clock, log: quiet });
  await b.buildAll("test");
  assert.deepEqual([...s.stored.keys()], ["Katie"]);
  assert.deepEqual(b.status().failed, ["Tom"]);
});

test("rounds asked for together run once", async () => {
  const s = setup();
  const b = createHomeBuilder({ ...s, clock, log: quiet });
  await Promise.all([b.buildAll("a"), b.buildAll("b")]);
  assert.equal(s.asked.filter((p) => p.startsWith("/api/RacesAndEntries")).length, 1);
});

test("a change rebuilds that user alone, once, a moment after the last of several changes, on the round's feeds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup();
  const b = createHomeBuilder({ ...s, clock, log: quiet });
  await b.buildAll("test");
  s.stored.clear();
  const before = s.asked.length;
  b.rebuildSoon("Tom");
  b.rebuildSoon("Tom");
  t.mock.timers.tick(DEBOUNCE_MS - 1);
  assert.equal(s.stored.size, 0);
  t.mock.timers.tick(1);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([...s.stored.keys()], ["Tom"]);
  const since = s.asked.slice(before);
  assert.equal(since.filter((p) => p.startsWith("/api/horseTracking")).length, 1);
  assert.equal(since.filter((p) => p.startsWith("/api/RacesAndEntries")).length, 0);
});

test("London's day, including the hour after midnight in summer when UTC is still on yesterday", () => {
  assert.equal(londonDay(new Date("2026-07-14T23:30:00Z")), "2026-07-15");
  assert.equal(londonDay(new Date("2026-12-14T23:30:00Z")), "2026-12-14");
  assert.equal(londonDay(new Date("2026-03-01T10:00:00Z"), -2), "2026-02-27");
});
