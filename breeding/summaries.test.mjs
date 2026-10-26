import test from "node:test";
import assert from "node:assert/strict";

import {
  CREATE_SUMMARY,
  baselineHistogramSql,
  dueForBuild,
  histogramStats,
  isFresh,
  ratingsView,
  readSummaries,
  rebuildSummaries,
  rememberAsked,
  summaryOf,
  writeSummary,
} from "./summaries.mjs";
import { FLAT_RUN } from "./mating.mjs";

const h = (name, best, extra = {}) => ({ name, best, runs: 3, wins: 1, stakesWins: 0, groupWins: 0, group1Wins: 0, foalingYear: 2020, sex: "c", ...extra });

test("a stored summary stands for a live read while it is fresh and complete", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");
  assert.equal(isFresh({ body: "{}", built_at: "2026-10-23 03:00:00", timed_out: 0 }, now), true);
  assert.equal(isFresh({ body: "{}", built_at: "2026-10-21 03:00:00", timed_out: 0 }, now), false, "two days old");
  assert.equal(isFresh({ body: "{}", built_at: "2026-10-23 03:00:00", timed_out: 1 }, now), false, "came back short");
  assert.equal(isFresh({ body: null, built_at: "2026-10-23 03:00:00", timed_out: 0 }, now), false, "never built");
  assert.equal(isFresh(null, now), false);
});

test("the stored body is the group described, its three best, and every horse best first", () => {
  const body = summaryOf([h("B", 90), h("A", 120, { stakesWins: 1 }), h("C", null), h("D", 100)]);
  assert.equal(body.n, 4);
  assert.equal(body.rated, 3);
  assert.deepEqual(body.top.map((t) => t.name), ["A", "D", "B"]);
  assert.deepEqual(body.horses.map((x) => x.name), ["A", "D", "B", "C"]);
  assert.equal(body.stakesWinners, 1);
  // The ratings route serves everything but the horses.
  const view = ratingsView(body);
  assert.equal(view.horses, undefined);
  assert.equal(view.rated, 3);
  assert.equal(ratingsView(null), null);
});

test("the grade lines fall at the population's own percentiles: top 3%, 10%, 20%, half", () => {
  // A thousand horses: 30 at 130, 70 at 115, 100 at 105, 300 at 90, 500 at 70.
  const rows = [
    { best: 70, n: 500 },
    { best: 90, n: 300 },
    { best: 105, n: 100 },
    { best: 115, n: 70 },
    { best: 130, n: 30 },
  ];
  const s = histogramStats(rows);
  assert.equal(s.n, 1000);
  assert.deepEqual(s.grades, { "A+": 130, A: 115, B: 105, C: 90 });
  assert.equal(s.median, 70, "half the horses are at 70");
  assert.ok(Math.abs(s.mean - 84.45) < 0.01);
  assert.ok(s.sd > 0);
  // A band nobody fills exactly: the line is the lowest figure still inside it.
  const spread = histogramStats([{ best: 100, n: 97 }, { best: 120, n: 2 }, { best: 125, n: 1 }]);
  assert.equal(spread.grades["A+"], 120, "two at 120 and one at 125 are 3% of a hundred");
  assert.equal(spread.grades.A, 120, "the next bin would take the share past 10%");
  assert.equal(histogramStats([]), null);
});

test("the histogram reads flat figures only, over horses that ran since a date", () => {
  const sql = baselineHistogramSql(FLAT_RUN, "/*+ X */");
  assert.match(sql, /SELECT \/\*\+ X \*\/ best, COUNT\(\*\) AS n/);
  assert.match(sql, /raceType = 'Flat'/);
  assert.match(sql, /WHERE meetingDate >= \?/);
  assert.match(sql, /GROUP BY horseName, YEAR\(foalingDate\)/);
  assert.match(sql, /GROUP BY best/);
  assert.match(CREATE_SUMMARY, /PRIMARY KEY \(kind, name_key\)/);
});

test("the table round trip: remembered names are due, a build writes them, a short one stays due", async () => {
  const calls = [];
  const rows = new Map();
  const runQuery = async (sql, args) => {
    calls.push(sql.trim().split(/\s+/).slice(0, 2).join(" "));
    if (/^\s*INSERT INTO breeding_sire_summary \(kind, name_key, asked_at\)/.test(sql)) {
      for (let i = 0; i < args.length; i += 2) {
        const k = `${args[i]}|${args[i + 1]}`;
        if (!rows.has(k)) rows.set(k, { kind: args[i], name_key: args[i + 1], body: null, built_at: null, timed_out: 0 });
      }
      return [];
    }
    if (/^\s*INSERT INTO breeding_sire_summary \(kind, name_key, body/.test(sql)) {
      const [kind, key, body, tookMs, timedOut] = args;
      rows.set(`${kind}|${key}`, { kind, name_key: key, body, built_at: new Date(), took_ms: tookMs, timed_out: timedOut });
      return [];
    }
    if (/^\s*SELECT kind, name_key FROM breeding_sire_summary/.test(sql)) {
      return [...rows.values()].filter((r) => !r.body || r.timed_out || !r.built_at);
    }
    if (/^\s*SELECT name_key, body, built_at/.test(sql)) {
      const [kind, ...names] = args;
      return [...rows.values()].filter((r) => r.kind === kind && names.includes(r.name_key));
    }
    throw new Error(`unexpected sql: ${sql.slice(0, 60)}`);
  };
  assert.equal(await rememberAsked(runQuery, "sire", ["GALILEO", "FRANKEL", "GALILEO"]), 2);
  assert.deepEqual(await dueForBuild(runQuery), [{ kind: "sire", key: "GALILEO" }, { kind: "sire", key: "FRANKEL" }]);
  const built = await rebuildSummaries(
    runQuery,
    async (kind, key) => (key === "GALILEO" ? { horses: [h("X", 110)], timedOut: false } : { horses: [], timedOut: true }),
    { log: { log() {}, warn() {} } },
  );
  assert.deepEqual({ due: built.due, built: built.built, short: built.short, failed: built.failed }, { due: 2, built: 1, short: 1, failed: 0 });
  const got = await readSummaries(runQuery, "sire", ["GALILEO", "FRANKEL", "NOBODY"]);
  assert.equal(got.get("GALILEO").body.rated, 1);
  assert.equal(isFresh(got.get("GALILEO")), true);
  assert.equal(isFresh(got.get("FRANKEL")), false, "short: due again tomorrow");
  assert.equal(got.has("NOBODY"), false);
  // Frankel is still due; Galileo is not.
  assert.deepEqual(await dueForBuild(runQuery), [{ kind: "sire", key: "FRANKEL" }]);
  await writeSummary(runQuery, "damsire", "DUBAWI", summaryOf([h("Y", 95)]), { tookMs: 12 });
  assert.equal((await readSummaries(runQuery, "damsire", ["DUBAWI"])).get("DUBAWI").body.n, 1);
});

/* ------------------------------------------------- the walk a month at a time */

import { baselineSliceSql, monthSlices, halveSlice, mergeSlice, histogramOf, measureInSlices } from "./summaries.mjs";

test("two seasons are read a month at a time, the last month ending tomorrow", () => {
  const s = monthSlices("2024-10-26", new Date("2026-10-26T04:00:00Z"));
  assert.equal(s.length, 25);
  assert.deepEqual(s[0], { from: "2024-10-26", to: "2024-11-01" });
  assert.deepEqual(s[1], { from: "2024-11-01", to: "2024-12-01" });
  assert.deepEqual(s.at(-1), { from: "2026-10-01", to: "2026-10-27" });
  for (let i = 1; i < s.length; i += 1) assert.equal(s[i].from, s[i - 1].to, "no gap and no overlap between months");
});

test("a month that runs out of time is cut in two, down to a day", () => {
  assert.deepEqual(halveSlice({ from: "2025-03-01", to: "2025-04-01" }), [{ from: "2025-03-01", to: "2025-03-16" }, { from: "2025-03-16", to: "2025-04-01" }]);
  assert.equal(halveSlice({ from: "2025-03-01", to: "2025-03-02" }), null);
});

test("a slice reads the race-date range on the bare column, flat runs with a rating only", () => {
  const sql = baselineSliceSql("(raceType = 'Flat')", "/*+ X */");
  assert.match(sql, /SELECT \/\*\+ X \*\/ horseName/);
  assert.match(sql, /meetingDate >= \? AND meetingDate < \?/);
  assert.doesNotMatch(sql, /DATE\(meetingDate\)/);
  assert.match(sql, /AND \(raceType = 'Flat'\)/);
  assert.match(sql, /GROUP BY horseName, YEAR\(foalingDate\)/);
});

test("a horse's best is kept across months, and a name is one horse whatever its case or accents", () => {
  const best = new Map();
  mergeSlice(best, [
    { name: "Élan Vital", fy: 2021, bestMaster: 88, bestPerformance: 91 },
    { name: "Enable", fy: 2014, bestMaster: 128, bestPerformance: null },
    { name: "Enable", fy: 2008, bestMaster: 40, bestPerformance: null },
    { name: "Nothing Rated", fy: 2022, bestMaster: null, bestPerformance: null },
  ]);
  mergeSlice(best, [
    { name: "ELAN VITAL", fy: 2021, bestMaster: 95, bestPerformance: 90 },
    { name: "enable", fy: 2014, bestMaster: 120, bestPerformance: 125 },
  ]);
  assert.equal(best.size, 3);
  assert.deepEqual(histogramOf(best), [{ best: 40, n: 1 }, { best: 95, n: 1 }, { best: 128, n: 1 }]);
});

test("the walk merges every month, halves one that times out, and gives the one-pass histogram", async () => {
  const runs = [
    ["2025-01-10", "A", 2020, 80, 82], ["2025-06-15", "A", 2020, 90, 85],
    ["2025-03-05", "B", 2019, 100, null], ["2025-03-20", "B", 2019, 70, 104],
    ["2025-02-01", "C", 2021, 60, 61],
  ];
  const asked = [];
  const runQuery = async (sql, [from, to]) => {
    asked.push(`${from}..${to}`);
    if (from === "2025-03-01" && to === "2025-04-01") {
      const err = new Error("ER_QUERY_TIMEOUT: maximum statement execution time exceeded");
      err.code = "ER_QUERY_TIMEOUT";
      throw err;
    }
    const by = new Map();
    for (const [d, name, fy, m, p] of runs) {
      if (d < from || d >= to) continue;
      const k = `${name}|${fy}`;
      const r = by.get(k) ?? { name, fy, bestMaster: null, bestPerformance: null };
      r.bestMaster = Math.max(r.bestMaster ?? 0, m ?? 0) || null;
      r.bestPerformance = Math.max(r.bestPerformance ?? 0, p ?? 0) || null;
      by.set(k, r);
    }
    return [...by.values()];
  };
  const out = await measureInSlices(runQuery, {
    flatRun: "(1=1)",
    since: "2025-01-01",
    until: new Date("2025-06-30T00:00:00Z"),
    pauseMs: 0,
    isTimeout: (e) => e.code === "ER_QUERY_TIMEOUT",
  });
  assert.deepEqual(out.rows, [{ best: 61, n: 1 }, { best: 90, n: 1 }, { best: 104, n: 1 }]);
  assert.ok(asked.includes("2025-03-01..2025-03-16") && asked.includes("2025-03-16..2025-04-01"), "March was halved and both halves read");
  assert.equal(out.slices, 7, "five whole months and March's two halves");
  assert.equal(histogramStats(out.rows).n, 3);
});

test("a month that fails for another reason fails the walk, so no partial population is kept", async () => {
  const runQuery = async (sql, [from]) => {
    if (from === "2025-02-01") throw new Error("ER_LOCK_WAIT_TIMEOUT");
    return [];
  };
  await assert.rejects(
    measureInSlices(runQuery, { flatRun: "(1=1)", since: "2025-01-01", until: new Date("2025-03-15T00:00:00Z"), pauseMs: 0, isTimeout: () => false }),
    (err) => err.slice?.from === "2025-02-01",
  );
});
