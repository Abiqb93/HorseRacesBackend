import test from "node:test";
import assert from "node:assert/strict";

import {
  F,
  PART_CHARS,
  buildForecast,
  currentPoint,
  decodePeriod,
  encodePeriod,
  firstCrop,
  indexes,
  isSettled,
  mergeInto,
  monthRange,
  monthRecords,
  pointStats,
  readPeriod,
  sliceSql,
  verdictOf,
  walkPeriods,
  walkPlan,
  writePeriod,
} from "./forecast.mjs";
import { horseKey } from "./summaries.mjs";
import { FLAT_RUN } from "./mating.mjs";

const day = (s) => new Date(`${s}T06:00:00Z`);

test("the slice reads one month of rated flat runs, grouped by horse", () => {
  const sql = sliceSql(FLAT_RUN, "/*+ X */");
  assert.match(sql, /\/\*\+ X \*\/ horseName AS name/);
  assert.match(sql, /meetingDate >= \? AND meetingDate < \?/);
  assert.match(sql, /GROUP BY horseName, YEAR\(foalingDate\)/);
  assert.ok(sql.includes(FLAT_RUN));
  assert.deepEqual(monthRange(2025, 12), { from: "2025-12-01", to: "2026-01-01" });
  assert.deepEqual(monthRange(2026, 3), { from: "2026-03-01", to: "2026-04-01" });
});

test("a season settles in the February after it", () => {
  assert.equal(isSettled(2025, day("2026-01-20")), false);
  assert.equal(isSettled(2025, day("2026-02-01")), true);
  assert.equal(isSettled(2024, day("2026-01-20")), true);
});

test("the plan: this month and last always, open months, then settled seasons newest first", () => {
  const now = day("2026-10-27");
  const held = new Set(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2025"]);
  const plan = walkPlan(now, held, { firstSeason: 2022 });
  assert.deepEqual(plan.slice(0, 2), [
    { kind: "month", season: 2026, month: 10, refresh: true },
    { kind: "month", season: 2026, month: 9, refresh: true },
  ]);
  assert.deepEqual(plan.slice(2).map((t) => `${t.kind}:${t.season}`), ["season:2024", "season:2023", "season:2022"]);

  // In January last season is still open, by month; its December is read again.
  const jan = walkPlan(day("2026-01-10"), new Set(), { firstSeason: 2025 });
  assert.deepEqual(jan.slice(0, 2).map((t) => `${t.season}-${t.month}`), ["2026-1", "2025-12"]);
  assert.equal(jan.filter((t) => t.kind === "month" && t.season === 2025).length, 12);

  // A settled season whose months are all held is put together, not read.
  const months = new Set(Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}`));
  const feb = walkPlan(day("2026-02-03"), months, { firstSeason: 2025 });
  assert.deepEqual(feb.find((t) => t.season === 2025), { kind: "rollup", season: 2025 });
});

test("a month's rows become one record a horse; months merge into a season", () => {
  const rows = [
    { name: "Alpha", fy: 2023, sire: "Kingman", bestMaster: 78, bestPerformance: 84, runs: 2, wins: 1, stakesWins: 0, groupWins: 0, group1Wins: 0, homeRuns: 2 },
    { name: "Beta", fy: 2023, sire: "Kingman", bestMaster: null, bestPerformance: 0, runs: 1, wins: 0 },
  ];
  const june = monthRecords(rows, 6);
  assert.equal(june.size, 1, "a horse with no figure is not a rated runner");
  const a = june.get(horseKey("Alpha", 2023));
  assert.equal(a[F.best], 84);
  assert.equal(a[F.first], 6);
  assert.deepEqual([a[F.m80], a[F.m90], a[F.m100]], [6, 0, 0]);
  assert.equal(a[F.home], 2);

  const season = new Map();
  for (const [k, r] of june) mergeInto(season, k, r);
  const sept = monthRecords([{ name: "Alpha", fy: 2023, sire: "Kingman", bestPerformance: 101, runs: 1, wins: 1, stakesWins: 1, groupWins: 1, homeRuns: 0 }], 9);
  for (const [k, r] of sept) mergeInto(season, k, r);
  const s = season.get(horseKey("Alpha", 2023));
  assert.equal(s[F.best], 101);
  assert.equal(s[F.runs], 3);
  assert.equal(s[F.wins], 2);
  assert.deepEqual([s[F.first], s[F.m80], s[F.m90], s[F.m100]], [6, 6, 9, 9]);
  assert.equal(s[F.home], 2, "runs in Britain and Ireland summed");

  const back = decodePeriod(JSON.parse(JSON.stringify(encodePeriod(season, "2025"))));
  assert.deepEqual(back.get(horseKey("Alpha", 2023)), s);
});

/** A table in memory, answering the statements the module sends. */
function fakeTable() {
  const rows = new Map();
  const runQuery = async (sql, args) => {
    if (/^\s*INSERT INTO breeding_runner_periods/.test(sql)) {
      const [period, part, body, horses, tookMs] = args;
      rows.set(`${period}|${part}`, { period, part, body, horses, took_ms: tookMs, built_at: new Date() });
      return { affectedRows: 1 };
    }
    if (/^DELETE FROM breeding_runner_periods WHERE period = \? AND part >= \?/.test(sql)) {
      for (const [k, r] of rows) if (r.period === args[0] && r.part >= args[1]) rows.delete(k);
      return {};
    }
    if (/^DELETE FROM breeding_runner_periods WHERE period LIKE \?/.test(sql)) {
      const prefix = args[0].replace("%", "");
      for (const [k, r] of rows) if (r.period.startsWith(prefix)) rows.delete(k);
      return {};
    }
    if (/SELECT part, body FROM breeding_runner_periods/.test(sql)) {
      return [...rows.values()].filter((r) => r.period === args[0]).sort((a, b) => a.part - b.part);
    }
    if (/SELECT period, MAX\(horses\)/.test(sql)) {
      const by = new Map();
      for (const r of rows.values()) {
        const had = by.get(r.period);
        by.set(r.period, { period: r.period, horses: r.horses, built_at: r.built_at, took_ms: r.took_ms, parts: (had?.parts ?? 0) + 1, head: r.part === 0 ? r.body.slice(0, 16) : had?.head ?? null });
      }
      return [...by.values()].sort((a, b) => a.period.localeCompare(b.period));
    }
    throw new Error(`unexpected: ${sql.slice(0, 60)}`);
  };
  return { rows, runQuery };
}

test("a period is stored in parts and read back whole", async () => {
  const { rows, runQuery } = fakeTable();
  const map = new Map();
  for (let i = 0; i < 30000; i += 1) map.set(horseKey(`Horse ${i}`, 2022), [`Horse ${i}`, 2022, "Some Sire With A Long Name", 70 + (i % 40), 4, 1, 0, 0, 0, 5, 6, 0, 0]);
  const w = await writePeriod(runQuery, "2024", map);
  assert.ok(w.parts > 1, `${w.chars} characters should need more than one part of ${PART_CHARS}`);
  assert.equal([...rows.values()].filter((r) => r.period === "2024").length, w.parts);
  const back = decodePeriod(await readPeriod(runQuery, "2024"));
  assert.equal(back.size, 30000);
  // Written again smaller, the parts left over are removed.
  await writePeriod(runQuery, "2024", new Map([...map].slice(0, 10)));
  assert.equal([...rows.values()].filter((r) => r.period === "2024").length, 1);
});

test("the walk reads the plan's months within its budget and rolls a settled season up", async () => {
  const { rows, runQuery: table } = fakeTable();
  const asked = [];
  const runQuery = async (sql, args) => {
    if (sql.includes("FROM APIData_Table2")) {
      asked.push(args[0]);
      return [{ name: `Runner ${args[0]}`, fy: 2022, sire: "Test Sire", bestPerformance: 85, runs: 1, wins: 0, homeRuns: 1 }];
    }
    return table(sql, args);
  };
  const first = await walkPeriods(runQuery, { flatRun: FLAT_RUN, now: day("2026-03-15"), maxSlices: 5, pauseMs: 0, firstSeason: 2025, log: {} });
  assert.deepEqual(asked, ["2026-03-01", "2026-02-01", "2026-01-01"]);
  assert.equal(first.slices, 3, "a whole season (twelve months) does not fit in the two left");
  assert.ok(first.remaining > 0);

  const second = await walkPeriods(runQuery, { flatRun: FLAT_RUN, now: day("2026-03-15"), maxSlices: 40, pauseMs: 0, firstSeason: 2025, log: {} });
  assert.equal(second.done.at(-1).period, "2025");
  const periods = new Set([...rows.values()].map((r) => r.period));
  assert.ok(periods.has("2025") && periods.has("2026-03"));
  assert.equal(decodePeriod(await readPeriod(table, "2025")).size, 12, "one runner a month, twelve months");
});

test("first crop ignores a single stray name", () => {
  assert.equal(firstCrop([{ fy: 2001 }, { fy: 2019 }, { fy: 2019 }, { fy: 2020 }]), 2019);
  assert.equal(firstCrop([{ fy: 2021 }]), 2021);
});

/** A horse in the shape buildForecast makes: its seasons in order. */
const horse = (key, fy, seasons) => ({ key, name: key, fy, sire: "X", seasons });
const rec = (best, { first = 6, runs = 2, sw = 0, home = 1 } = {}) => {
  const r = [`h`, 2020, "X", best, runs, 0, sw, 0, 0, first, 0, 0, 0, home];
  [80, 90, 100].forEach((x, i) => {
    if (best >= x) r[10 + i] = first;
  });
  return r;
};

test("a sire's runners at a point: past seasons whole, the season in question to its month", () => {
  const horses = [
    horse("a", 2022, [[2024, rec(85)], [2025, rec(96, { first: 8 })]]),
    horse("b", 2023, [[2025, rec(70, { first: 9 })]]),
    horse("c", 2023, [[2025, rec(102, { first: 5, sw: 1 })]]),
  ];
  const july = pointStats(horses, 2025, 7);
  assert.equal(july.runners, 2, "b had not run by July");
  assert.deepEqual(july.n, [2, 1, 1], "a at 85 from last season; c at 102 by May; a's 96 came in August");
  const whole = pointStats(horses, 2025, 12, { keep: true });
  assert.equal(whole.runners, 3);
  assert.deepEqual(whole.n, [2, 2, 1]);
  assert.equal(whole.sw, 1);
  assert.equal(whole.horses.find((x) => x.h.key === "a").best, 96);
});

test("indexes pull a small sire towards par, harder where par is rare", () => {
  const par = [0.3, 0.1, 0.02];
  const small = indexes({ runners: 8, n: [6, 3, 1] }, par);
  const big = indexes({ runners: 80, n: [60, 30, 10] }, par);
  assert.ok(small[0] < big[0], "the same share counts for more from eighty runners");
  assert.ok(small[2] < 2, `one 100-rated horse of eight is ${small[2].toFixed(2)} times par, not six`);
  assert.equal(indexes({ runners: 500, n: [500, 500, 500] }, par)[2], 4, "capped at four times par");
  assert.deepEqual(indexes({ runners: 20, n: [6, 2, 0] }, [0.3, 0.1, 0]).slice(0, 2).map((v) => Number(v.toFixed(3))), [1, 1]);
  assert.equal(verdictOf(150, 25), "well-ahead");
  assert.equal(verdictOf(150, 6), "early");
  assert.equal(verdictOf(100, 25), "par");
  assert.equal(verdictOf(70, 25), "behind");
});

test("the point read as current: this season from March, last season whole before it", () => {
  assert.deepEqual(currentPoint(day("2026-10-27")), { season: 2026, month: 10 });
  assert.deepEqual(currentPoint(day("2026-02-10")), { season: 2025, month: 12 });
});

/**
 * Seasons for a made-up population: forty past sires whose runners rate as
 * the population's, one young sire well above them, one below. Each sire has
 * twenty foals a crop, each crop racing at two and three.
 */
function population({ now = 2026 } = {}) {
  const seasons = new Map();
  const put = (T, name, fy, sire, best, first = 6, home = 1) => {
    if (!seasons.has(T)) seasons.set(T, new Map());
    const r = [name, fy, sire, best, 3, best >= 90 ? 1 : 0, best >= 100 ? 1 : 0, 0, 0, first, ...[80, 90, 100].map((x) => (best >= x ? first : 0)), home];
    mergeInto(seasons.get(T), horseKey(name, fy), r);
  };
  // A rating for foal i of a crop, at two and at three; `lift` raises a sire.
  const ratings = (i, lift) => {
    const base = 55 + ((i * 37) % 45); // 55..99 spread
    return [base + lift, base + 8 + lift];
  };
  const sire = (name, first, lift, { abroad = 0 } = {}) => {
    for (let fy = first; fy <= now - 2; fy += 1) {
      for (let i = 0; i < 20; i += 1) {
        const [two, three] = ratings(i + fy, lift);
        const horseName = `${name} ${fy} ${i}`;
        // `abroad` of each crop ran only where Timeform rates the better races.
        const home = i < abroad ? 0 : 1;
        put(fy + 2, horseName, fy, name, two, 7, home);
        if (fy + 3 <= now) put(fy + 3, horseName, fy, name, three, 6, home);
      }
    }
  };
  for (let s = 0; s < 40; s += 1) sire(`Past Sire ${s}`, 2010 + (s % 10), (s % 5) - 2);
  sire("Rising Star", 2022, 14);
  sire("Slow Burner", 2022, -14);
  sire("Travelling Man", 2022, 0, { abroad: 15 });
  return seasons;
}

test("the forecast: par by stage from past sires, the young sires graded against it, next season projected", () => {
  const f = buildForecast(population(), { now: day("2026-10-27") });
  assert.equal(f.season, 2026);
  assert.equal(f.through, 10);
  const p1 = f.par.find((p) => p.stage === 1);
  const p2 = f.par.find((p) => p.stage === 2);
  assert.ok(p1.sires >= 30, `par at stage 1 from ${p1.sires} sires`);
  assert.ok(p2.toDate[0] > p1.toDate[0], "a sire's share of 80s rises as his first crop turns three");
  assert.ok(f.carry.find((c) => c.stage === 1).beta.every((b) => b >= 0 && b <= 1.2));

  const star = f.sires.find((s) => s.sire === "RISING STAR");
  const slow = f.sires.find((s) => s.sire === "SLOW BURNER");
  assert.equal(star.stage, 3, "first crop 2022: two in 2024, three in 2025, stage 3 in 2026");
  assert.equal(star.firstCrop, 2022);
  assert.ok(star.score > 115, `Rising Star scores ${star.score}`);
  assert.ok(["ahead", "well-ahead"].includes(star.verdict));
  assert.equal(slow.verdict, "behind");
  assert.ok(star.next.every((v, i) => v >= star.nextPar[i]), "projected above next season's par");
  assert.ok(star.nextScore < star.score, "less far above par next season: the carry-over takes its share");
  assert.equal(f.sires[0].sire, "RISING STAR", "best first");
  assert.equal(star.p, null, "no symbols held, no p count");
  assert.equal(f.symbols.held, false);
  assert.ok(star.top.length === 3 && star.top[0].best >= star.top[2].best);
  assert.ok(!f.sires.some((s) => s.sire.startsWith("PAST SIRE") && s.stage > 10), "proven sires are not forecast");
  const travelling = f.sires.find((s) => s.sire === "TRAVELLING MAN");
  assert.equal(travelling.runners, 5 * 3, "only his runners in Britain and Ireland count: five a crop, three crops");
  assert.equal(f.basis.countries.join(","), "GBR,IRE");
});

test("the forecast counts Timeform p symbols among this season's runners when they are held", () => {
  const seasons = population();
  const symbols = new Map();
  for (const [key, r] of seasons.get(2026)) if (r[F.sire] === "Rising Star" && r[F.best] >= 90) symbols.set(key, "p");
  const f = buildForecast(seasons, { now: day("2026-10-27"), symbols, symbolsSince: "2026-10-28" });
  const star = f.sires.find((s) => s.sire === "RISING STAR");
  assert.ok(star.p.n > 0);
  assert.equal(star.p.n, symbols.size);
  assert.ok(star.p.horses.every((h) => h.symbol === "p"));
  assert.equal(f.sires.find((s) => s.sire === "SLOW BURNER").p.n, 0);
  assert.equal(f.symbols.since, "2026-10-28");
});

test("a period stored in an older shape is read again, and left out until it is", async () => {
  const { rows, runQuery: table } = fakeTable();
  rows.set("2026-03|0", { period: "2026-03", part: 0, body: JSON.stringify({ v: 1, period: "2026-03", sires: [], horses: [] }), horses: 0, took_ms: 0, built_at: new Date() });
  const asked = [];
  const runQuery = async (sql, args) => {
    if (sql.includes("FROM APIData_Table2")) {
      asked.push(args[0]);
      return [];
    }
    return table(sql, args);
  };
  const { readSeasons } = await import("./forecast.mjs");
  assert.equal((await readSeasons(runQuery)).size, 0, "the old shape is not read into the forecast");
  await walkPeriods(runQuery, { flatRun: FLAT_RUN, now: day("2026-03-15"), maxSlices: 3, pauseMs: 0, firstSeason: 2026, log: {} });
  assert.ok(asked.includes("2026-03-01"));
  assert.match(rows.get("2026-03|0").body, /^\{"v":2,/);
});
