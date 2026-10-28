import test from "node:test";
import assert from "node:assert/strict";
import { findDaysOffIndex, ensureDaysOffIndex, attachDaysOff, INDEX_NAME } from "./daysOff.mjs";

const quiet = { log() {}, warn() {} };

/** INFORMATION_SCHEMA.STATISTICS rows for the indexes given as { name: [col, ...] }. */
const statistics = (indexes) =>
  Object.entries(indexes).flatMap(([name, cols]) =>
    cols.map((c, i) => (typeof c === "string" ? { name, seq: i + 1, col: c, part: null } : { name, seq: i + 1, col: c.col, part: c.part })));

test("the index is found by its columns, whatever it is called, and not on a prefix or in another order", async () => {
  const ask = (indexes) => findDaysOffIndex(async () => statistics(indexes));
  assert.equal(await ask({ PRIMARY: ["id"], by_hand: ["horseName", "horseCode", "meetingDate", "courseName"] }), "by_hand");
  assert.equal(await ask({ idx_horse_date: ["horseName", "meetingDate"] }), null);
  assert.equal(await ask({ wrong_order: ["horseName", "meetingDate", "horseCode"] }), null);
  assert.equal(await ask({ prefix: [{ col: "horseName", part: 20 }, "horseCode", "meetingDate"] }), null);
});

test("a missing index is added online on a connection of its own that gives up on a held lock", async () => {
  let built = false;
  const own = [];
  const runQuery = async () => statistics(built ? { [INDEX_NAME]: ["horseName", "horseCode", "meetingDate"] } : {});
  const withConnection = async (fn) => fn(async (sql) => { own.push(sql); if (/ALTER TABLE/.test(sql)) built = true; return []; });
  const r = await ensureDaysOffIndex({ runQuery, withConnection, log: quiet });
  assert.deepEqual(r, { index: INDEX_NAME, added: true });
  assert.match(own[0], /SET SESSION lock_wait_timeout = 2/);
  assert.match(own[1], /ALTER TABLE APIData_Table2 ADD INDEX idx_days_off \(horseName, horseCode, meetingDate\), ALGORITHM=INPLACE, LOCK=NONE/);
});

test("an index already there is not built again, and one another start finished first counts", async () => {
  const there = async () => statistics({ [INDEX_NAME]: ["horseName", "horseCode", "meetingDate"] });
  const never = async () => { throw new Error("should not connect"); };
  assert.deepEqual(await ensureDaysOffIndex({ runQuery: there, withConnection: never, log: quiet }), { index: INDEX_NAME, added: false });

  let calls = 0;
  const appears = async () => (calls++ ? statistics({ [INDEX_NAME]: ["horseName", "horseCode", "meetingDate"] }) : []);
  const duplicate = async () => { throw new Error("ER_DUP_KEYNAME: Duplicate key name 'idx_days_off'"); };
  assert.deepEqual(await ensureDaysOffIndex({ runQuery: appears, withConnection: duplicate, log: quiet }), { index: INDEX_NAME, added: true });

  const locked = async () => { throw new Error("ER_LOCK_WAIT_TIMEOUT: Lock wait timeout exceeded"); };
  await assert.rejects(ensureDaysOffIndex({ runQuery: async () => [], withConnection: locked, log: quiet }), /Lock wait timeout/);
});

const day = (s) => new Date(`${s}T00:00:00`);

test("without the index nothing is asked and the rows go out as they are", async () => {
  const rows = [{ horseName: "GRINANBEARIT", horseCode: "1", meetingDate: day("2026-10-21") }];
  const r = await attachDaysOff(rows, { runQuery: async () => { throw new Error("asked"); }, index: null, log: quiet });
  assert.equal(r, "no-index");
  assert.equal("daysOff" in rows[0], false);
});

test("days off come from each horse's own last run, on the index, the name compared as the table compares it", async () => {
  const asked = [];
  const runQuery = async (sql, params) => {
    asked.push({ sql: sql.replace(/\s+/g, " "), params });
    return [
      { horseName: "Grinanbearit", horseCode: "1", lastRun: day("2026-09-25") },
      { horseName: "FEAR THE DARK", horseCode: "2", lastRun: day("2026-10-12") },
      // A second horse of the winner's name, run more recently: not hers.
      { horseName: "FEAR THE DARK", horseCode: "99", lastRun: day("2026-10-20") },
      { horseName: "Señorita", horseCode: "3", lastRun: day("2026-10-14") },
    ];
  };
  const rows = [
    { horseName: "GRINANBEARIT", horseCode: "1", meetingDate: day("2026-10-21") },
    { horseName: "FEAR THE DARK", horseCode: "2", meetingDate: day("2026-10-21") },
    { horseName: "SENORITA", horseCode: "3", meetingDate: day("2026-10-21") },
    { horseName: "DEBUTANTE", horseCode: "4", meetingDate: day("2026-10-21") },
  ];
  assert.equal(await attachDaysOff(rows, { runQuery, index: "idx_days_off", log: quiet }), "added");
  assert.deepEqual(rows.map((r) => r.daysOff), [26, 9, 7, null]);
  assert.match(asked[0].sql, /FORCE INDEX \(`idx_days_off`\)/);
  assert.match(asked[0].sql, /GROUP BY horseName, horseCode/);
  assert.equal(asked[0].params.at(-1), "2026-10-21");
});

test("a lookup that runs long is left behind: the rows go out on time, and no more chunks are asked", async () => {
  let asked = 0;
  let fail;
  const runQuery = () => { asked += 1; return new Promise((_, reject) => { fail = reject; }); };
  const rows = Array.from({ length: 600 }, (_, i) => ({ horseName: `H${i}`, horseCode: String(i), meetingDate: day("2026-10-26") }));
  const started = Date.now();
  const r = await attachDaysOff(rows, { runQuery, index: "idx_days_off", waitMs: 50, log: quiet });
  assert.equal(r, "timed-out");
  assert.ok(Date.now() - started < 1000);
  assert.equal(rows.some((row) => "daysOff" in row), false);
  // Its failure after the deadline is handled, and it stops there.
  fail(new Error("Query execution was interrupted"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(asked, 1);
});

test("a lookup that fails sends the rows without days off", async () => {
  const rows = [{ horseName: "A", horseCode: "1", meetingDate: day("2026-10-26") }];
  const r = await attachDaysOff(rows, { runQuery: async () => { throw new Error("gone"); }, index: "idx_days_off", log: quiet });
  assert.equal(r, "failed");
  assert.equal("daysOff" in rows[0], false);
});
