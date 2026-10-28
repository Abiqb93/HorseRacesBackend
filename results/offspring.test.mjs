import test from "node:test";
import assert from "node:assert/strict";
import { createOffspring, REFRESH_MS } from "./offspring.mjs";

const quiet = { log() {}, warn() {} };

/** A table of runs answering the range query and the month slices the way MySQL would. */
const table = (runs, { failSlice = () => false } = {}) => {
  const asked = [];
  const runQuery = async (sql, params) => {
    asked.push({ sql: sql.replace(/\s+/g, " "), params });
    if (/MIN\(meetingDate\)/.test(sql)) {
      const dates = runs.map((r) => r.meetingDate).sort();
      return [{ lo: new Date(`${dates[0]}T00:00:00Z`), hi: new Date(`${dates.at(-1)}T00:00:00Z`) }];
    }
    const [from, to] = params;
    if (failSlice(from, to)) throw new Error("Query execution was interrupted, maximum statement execution time exceeded");
    return runs
      .filter((r) => r.meetingDate >= from && r.meetingDate < to)
      .map(({ sireName, damName, horseName }) => ({ sireName, damName, horseName }));
  };
  return { runQuery, asked };
};

const RUNS = [
  { horseName: "CITY OF GOLD", sireName: "WOOTTON BASSETT", damName: "SPEED HAWK", meetingDate: "2025-06-14" },
  { horseName: "CITY OF GOLD", sireName: "WOOTTON BASSETT", damName: "SPEED HAWK", meetingDate: "2025-09-02" },
  { horseName: "ALCOHOL FREE", sireName: "NO NAY NEVER", damName: "PLEASANT ROAD", meetingDate: "2025-07-30" },
  { horseName: "LITTLE BIG BEAR", sireName: "NO NAY NEVER", damName: "MAJESTIC", meetingDate: "2025-08-21" },
];

test("the whole table is read a month at a time by date, newest first, and each name asked gets its horses once each", async () => {
  const { runQuery, asked } = table(RUNS);
  const o = createOffspring({ runQuery, pauseMs: 0, log: quiet });
  const r = await o.lookup("sire", ["No Nay Never", "Wootton Bassett", "UNRACED SIRE"]);
  assert.deepEqual(r, {
    "No Nay Never": ["ALCOHOL FREE", "LITTLE BIG BEAR"],
    "Wootton Bassett": ["CITY OF GOLD"],
    "UNRACED SIRE": [],
  });
  assert.deepEqual(await o.lookup("dam", ["Majestic", "speed hawk"]), { Majestic: ["LITTLE BIG BEAR"], "speed hawk": ["CITY OF GOLD"] });
  const slices = asked.filter((a) => /DISTINCT sireName, damName, horseName/.test(a.sql));
  assert.deepEqual(slices.map((a) => a.params), [
    ["2025-09-01", "2025-10-01"], ["2025-08-01", "2025-09-01"], ["2025-07-01", "2025-08-01"], ["2025-06-01", "2025-07-01"],
  ]);
  assert.match(slices[0].sql, /WHERE meetingDate >= \? AND meetingDate < \?/);
  assert.equal(o.status().state, "ready");
  assert.equal(o.status().complete, true);
  assert.equal(o.status().horses, 3);
  assert.equal(o.status().monthsRead, 4);
  assert.equal(o.status().monthsTotal, 4);
});

test("it answers once the latest months are read, and the older ones fill in behind", async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const { runQuery: inner } = table(RUNS);
  // the oldest month (June) is slow to come back
  const runQuery = async (sql, params) => (params?.[0] === "2025-06-01" ? held.then(() => inner(sql, params)) : inner(sql, params));
  const o = createOffspring({ runQuery, pauseMs: 0, readyMonths: 2, log: quiet });
  // ready after September and August: Little Big Bear (Aug) is in, City Of Gold (Sep) too
  assert.deepEqual(await o.lookup("sire", ["No Nay Never"]), { "No Nay Never": ["LITTLE BIG BEAR"] });
  assert.equal(o.status().state, "ready");
  assert.equal(o.status().complete, false);
  release();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(await o.lookup("sire", ["No Nay Never"]), { "No Nay Never": ["ALCOHOL FREE", "LITTLE BIG BEAR"] });
  assert.equal(o.status().complete, true);
});

test("requests made while it is read wait for the one read, and later ones need none", async () => {
  const { runQuery, asked } = table(RUNS);
  const o = createOffspring({ runQuery, pauseMs: 0, log: quiet });
  await Promise.all([o.lookup("sire", ["No Nay Never"]), o.lookup("dam", ["Majestic"]), o.lookup("sire", ["Wootton Bassett"])]);
  const reads = asked.length;
  assert.equal(reads, 5);
  await o.lookup("sire", ["No Nay Never"]);
  assert.equal(asked.length, reads);
  assert.deepEqual(await o.lookup("sire", []), {});
});

test("a month that runs out of time is read in halves", async () => {
  const { runQuery, asked } = table(RUNS, { failSlice: (from, to) => from === "2025-08-01" && to === "2025-09-01" });
  const o = createOffspring({ runQuery, pauseMs: 0, log: quiet });
  assert.deepEqual(await o.lookup("dam", ["Majestic"]), { Majestic: ["LITTLE BIG BEAR"] });
  assert.ok(asked.some((a) => a.params?.[0] === "2025-08-01" && a.params?.[1] === "2025-08-16"));
});

test("a read that fails fails the request, and the next request reads again", async () => {
  let fail = true;
  const { runQuery: inner } = table(RUNS);
  const runQuery = async (sql, params) => { if (fail) throw new Error("gone"); return inner(sql, params); };
  const o = createOffspring({ runQuery, pauseMs: 0, log: quiet });
  await assert.rejects(o.lookup("sire", ["No Nay Never"]), /gone/);
  assert.equal(o.status().state, "failed");
  fail = false;
  assert.deepEqual(await o.lookup("sire", ["No Nay Never"]), { "No Nay Never": ["ALCOHOL FREE", "LITTLE BIG BEAR"] });
});

test("after six hours the latest months are read again while the list on hand answers", async () => {
  let t = Date.UTC(2025, 8, 20);
  const runs = [...RUNS];
  const { runQuery, asked } = table(runs);
  const o = createOffspring({ runQuery, now: () => t, pauseMs: 0, log: quiet });
  await o.lookup("sire", ["No Nay Never"]);
  runs.push({ horseName: "NEW ONE", sireName: "NO NAY NEVER", damName: "X", meetingDate: "2025-09-19" });
  t += REFRESH_MS + 1;
  const before = asked.length;
  // answers at once from what it has...
  assert.deepEqual(await o.lookup("sire", ["No Nay Never"]), { "No Nay Never": ["ALCOHOL FREE", "LITTLE BIG BEAR"] });
  await new Promise((r) => setTimeout(r, 10));
  // ...having read only from last month on
  const slices = asked.slice(before).filter((a) => /DISTINCT/.test(a.sql)).map((a) => a.params[0]);
  assert.deepEqual(slices, ["2025-09-01", "2025-08-01"]);
  assert.deepEqual(await o.lookup("sire", ["No Nay Never"]), { "No Nay Never": ["ALCOHOL FREE", "LITTLE BIG BEAR", "NEW ONE"] });
});
