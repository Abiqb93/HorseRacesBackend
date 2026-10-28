import test from "node:test";
import assert from "node:assert/strict";

import { upliftArgs, upliftSql, upliftSummary } from "./uplift.mjs";

test("the SQL reads his runners against their dams' other foals by other sires, with the damsire as a last argument", () => {
  const sql = upliftSql({ hint: "/*+ MAX_EXECUTION_TIME(1000) */" });
  assert.match(sql, /AND sireName = \?/);
  assert.match(sql, /AND sireName <> \?/);
  assert.match(sql, /SELECT DISTINCT damName FROM APIData_Table2 WHERE sireName = \?/);
  assert.doesNotMatch(sql, /damsireName = \?/);
  assert.match(upliftSql({ damsire: "DANSILI" }), /AND h\.damsireName = \?/);
  assert.deepEqual(upliftArgs({ sire: "FRANKEL" }), ["2008-01-01", "FRANKEL", "2008-01-01", "FRANKEL", "FRANKEL"]);
  assert.deepEqual(upliftArgs({ sire: "FRANKEL", damsire: "DANSILI" }).at(-1), "DANSILI");
});

test("the summary is the mean lift over the mares, how often it holds, and the runners that carry it", () => {
  const row = (name, best, othersMean, o = {}) => ({
    horseName: name, foalYear: o.year ?? 2019, damName: o.dam ?? "A MARE", damsireName: "DANSILI",
    best, othersMean, othersN: o.n ?? 2, stakesWins: o.sw ?? 0, groupWins: 0, group1Wins: o.g1 ?? 0,
  });
  const s = upliftSummary(
    [row("MINNIE HAUK", 128, 80, { sw: 6, g1: 4 }), row("SOUL SISTER", 119, 103, { sw: 2, g1: 1 }), row("DISSIDENT", 76, 104), row("NO RATING", null, 90), row("NO SIBLINGS", 100, null, { n: 0 })],
    { season: 2026 },
  );
  assert.equal(s.n, 3);
  assert.equal(s.uplift, round((48 + 16 - 28) / 3));
  assert.equal(s.median, 16);
  assert.equal(s.shareUp, 67);
  assert.equal(s.stakesWinners, 2);
  assert.equal(s.group1Winners, 2);
  assert.equal(s.runners[0].name, "MINNIE HAUK");
  assert.equal(s.runners[0].uplift, 48);
  assert.equal(s.young, false);
  // A sire whose oldest runners are three reads young.
  assert.equal(upliftSummary([row("A", 90, 80, { year: 2023 })], { season: 2026 }).young, true);
  assert.deepEqual(upliftSummary([]), { n: 0, runners: [] });
});

const round = (v) => Math.round(v * 10) / 10;
