import test from "node:test";
import assert from "node:assert/strict";
import { createOffspring, createGate, CACHE_MS, BATCH } from "./offspring.mjs";

/** A table of runs, answering the offspring query the way MySQL would. */
const table = (runs, { delayMs = 0 } = {}) => {
  const asked = [];
  const runQuery = async (sql, params) => {
    asked.push({ sql: sql.replace(/\s+/g, " "), params });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const column = /DISTINCT (\w+) AS parent/.exec(sql)[1];
    const wanted = new Set(params.map((p) => p.toLowerCase()));
    const seen = new Set();
    return runs
      .filter((r) => wanted.has(String(r[column]).toLowerCase()))
      .map((r) => ({ parent: r[column], horseName: r.horseName }))
      .filter((r) => !seen.has(`${r.parent}|${r.horseName}`) && seen.add(`${r.parent}|${r.horseName}`));
  };
  return { runQuery, asked };
};

const RUNS = [
  { horseName: "CITY OF GOLD", sireName: "WOOTTON BASSETT", damName: "SPEED HAWK" },
  { horseName: "CITY OF GOLD", sireName: "WOOTTON BASSETT", damName: "SPEED HAWK" },
  { horseName: "ALCOHOL FREE", sireName: "NO NAY NEVER", damName: "PLEASANT ROAD" },
  { horseName: "LITTLE BIG BEAR", sireName: "NO NAY NEVER", damName: "MAJESTIC" },
];

test("each name asked gets its horses once each, keyed as it was asked, whatever its case", async () => {
  const { runQuery, asked } = table(RUNS);
  const o = createOffspring({ runQuery });
  const r = await o.lookup("sire", ["No Nay Never", "Wootton Bassett", "UNRACED SIRE"]);
  assert.deepEqual(r, {
    "No Nay Never": ["ALCOHOL FREE", "LITTLE BIG BEAR"],
    "Wootton Bassett": ["CITY OF GOLD"],
    "UNRACED SIRE": [],
  });
  assert.equal(asked.length, 1);
  assert.match(asked[0].sql, /SELECT \/\*\+ MAX_EXECUTION_TIME\(120000\) \*\/ DISTINCT sireName AS parent, horseName FROM APIData_Table2 WHERE sireName IN \(\?,\?,\?\)/);
  assert.deepEqual(await o.lookup("dam", ["Majestic"]), { Majestic: ["LITTLE BIG BEAR"] });
  assert.match(asked[1].sql, /DISTINCT damName AS parent/);
});

test("the read is forced onto the index once it is there", async () => {
  const { runQuery, asked } = table(RUNS);
  const o = createOffspring({ runQuery, indexFor: (kind) => (kind === "sire" ? "idx_sire_horse" : null) });
  await o.lookup("sire", ["No Nay Never"]);
  await o.lookup("dam", ["Majestic"]);
  assert.match(asked[0].sql, /FROM APIData_Table2 FORCE INDEX \(`idx_sire_horse`\) WHERE/);
  assert.doesNotMatch(asked[1].sql, /FORCE INDEX/);
});

test("an answer is kept for twelve hours, and the same name asked twice at once is read once", async () => {
  let t = 0;
  const { runQuery, asked } = table(RUNS, { delayMs: 10 });
  const o = createOffspring({ runQuery, now: () => t });
  const [a, b] = await Promise.all([o.lookup("sire", ["No Nay Never"]), o.lookup("sire", ["no nay never", "Wootton Bassett"])]);
  assert.deepEqual(a["No Nay Never"], b["no nay never"]);
  assert.equal(asked.length, 2);
  assert.deepEqual(asked[1].params, ["Wootton Bassett"]);
  await o.lookup("sire", ["No Nay Never", "Wootton Bassett"]);
  assert.equal(asked.length, 2);
  t = CACHE_MS + 1;
  await o.lookup("sire", ["No Nay Never"]);
  assert.equal(asked.length, 3);
});

test("many names go in batches, and no more than two reads run at once", async () => {
  let running = 0;
  let most = 0;
  const runQuery = async () => {
    running += 1;
    most = Math.max(most, running);
    await new Promise((r) => setTimeout(r, 5));
    running -= 1;
    return [];
  };
  const o = createOffspring({ runQuery });
  const names = Array.from({ length: BATCH * 3 + 1 }, (_, i) => `SIRE ${i}`);
  await Promise.all([o.lookup("sire", names), o.lookup("dam", names)]);
  assert.equal(most, 2);
});

test("a read that fails fails the request, and is asked again next time", async () => {
  let fail = true;
  const runQuery = async () => { if (fail) throw new Error("gone"); return []; };
  const o = createOffspring({ runQuery });
  await assert.rejects(o.lookup("sire", ["No Nay Never"]), /gone/);
  fail = false;
  assert.deepEqual(await o.lookup("sire", ["No Nay Never"]), { "No Nay Never": [] });
});

test("the gate runs its tasks in turn and passes their answers and failures through", async () => {
  const gate = createGate(1);
  const order = [];
  const a = gate(async () => { order.push("a"); return 1; });
  const b = gate(async () => { order.push("b"); throw new Error("b failed"); });
  const c = gate(async () => { order.push("c"); return 3; });
  assert.equal(await a, 1);
  await assert.rejects(b, /b failed/);
  assert.equal(await c, 3);
  assert.deepEqual(order, ["a", "b", "c"]);
});
