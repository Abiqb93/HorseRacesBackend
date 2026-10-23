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
