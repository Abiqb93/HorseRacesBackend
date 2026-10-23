import test from "node:test";
import assert from "node:assert/strict";
import { summary, moves, sideOf } from "./trainerUplift.mjs";

/** A db that records the SQL it is asked and answers with no rows. */
const recorder = () => { const asked = []; return { asked, query: (sql, params, cb) => { asked.push({ sql: sql.replace(/\s+/g, " "), params }); cb(null, []); } }; };

test("the summary reads the yard joined by default and the yard left on the from side", async () => {
  const db = recorder();
  await summary(db, { minMoves: 5 });
  assert.match(db.asked[0].sql, /SELECT toTrainer AS trainer/);
  assert.match(db.asked[0].sql, /GROUP BY toTrainer/);
  await summary(db, { side: "from", minMoves: 5, trainer: "M. Halford, Ireland" });
  assert.match(db.asked[1].sql, /SELECT fromTrainer AS trainer/);
  assert.match(db.asked[1].sql, /GROUP BY fromTrainer/);
  assert.match(db.asked[1].sql, /fromTrainer = \?/);
  assert.deepEqual(db.asked[1].params.slice(-2), ["M. Halford, Ireland", 5]);
});

test("the moves of a yard are the ones it was left from on the from side, joined on the other", async () => {
  const db = recorder();
  await moves(db, { trainer: "X" });
  assert.match(db.asked[0].sql, /toTrainer = \?/);
  await moves(db, { trainer: "X", side: "FROM" });
  assert.match(db.asked[1].sql, /fromTrainer = \?/);
  assert.equal(sideOf({ side: "from" }), "from");
  assert.equal(sideOf({}), "to");
  assert.equal(sideOf({ side: "sideways" }), "to");
});
