import test from "node:test";
import assert from "node:assert/strict";
import { escapeLike, parseSearchParams, searchHorses, DEFAULT_LIMIT, MAX_LIMIT } from "./horseSearch.mjs";

const quiet = { warn() {} };

const resultsRow = (name, over = {}) => ({
  horse_name: name, horse_country: "IRE", race_country: "FRA", sire_name: "ZELZAL", dam_name: "DARIYBA",
  foaling_year: 2023, runs: 5, wins: 3, last_run: "2026-10-26 00:00:00", ...over,
});
const legacyRow = (name, over = {}) => ({
  horse_name: name, country: "GBR", runs: 14, wins: 1, sire_name: null, dam_name: null, foaling_year: null, ...over,
});

/**
 * A database answering by pass: `prefix` for APIData_Table2 'x%', `word` for
 * '% x%', `legacy` for horse_names. A pass given as an Error rejects.
 */
const db = ({ prefix = [], word = [], legacy = [] } = {}) => {
  const asked = [];
  const runQuery = async (sql, params) => {
    const pattern = params[0];
    const which = /FROM horse_names/.test(sql) ? "legacy" : pattern.startsWith("% ") ? "word" : "prefix";
    asked.push({ which, params, sql });
    const out = { prefix, word, legacy }[which];
    if (out instanceof Error) throw out;
    return out;
  };
  return { runQuery, asked };
};

test("a horse missing from horse_names is found in the results table (Darzakir)", async () => {
  const d = db({ prefix: [resultsRow("DARZAKIR")], legacy: [] });
  const out = await searchHorses(d.runQuery, "darzakir", 12, quiet);
  assert.equal(out.count, 1);
  assert.deepEqual(out.horses[0], {
    horseName: "DARZAKIR", country: "IRE", sireName: "ZELZAL", damName: "DARIYBA", foalingYear: 2023,
    runs: 5, wins: 3, lastRun: "2026-10-26", source: "results",
  });
  assert.equal(d.asked.find((a) => a.which === "prefix").params[0], "darzakir%");
});

test("a short prefix answer is topped up from later words and horse_names, without repeats", async () => {
  const d = db({
    prefix: [resultsRow("LADY OF SHALOTT")],
    word: [resultsRow("MY LADY ROSE"), resultsRow("LADY OF SHALOTT")],
    legacy: [legacyRow("LADY OF SHALOTT"), legacyRow("OLD LADY SMITH")],
  });
  const out = await searchHorses(d.runQuery, "lady", 12, quiet);
  assert.deepEqual(out.horses.map((h) => [h.horseName, h.source]), [
    ["LADY OF SHALOTT", "results"],
    ["MY LADY ROSE", "results"],
    ["OLD LADY SMITH", "horse_names"],
  ]);
});

test("a full prefix answer runs no slow pass", async () => {
  const rows = Array.from({ length: 3 }, (_, i) => resultsRow(`DA${i}`));
  const d = db({ prefix: rows });
  const out = await searchHorses(d.runQuery, "da", 3, quiet);
  assert.equal(out.count, 3);
  assert.deepEqual(d.asked.map((a) => a.which), ["prefix"]);
});

test("an exact name leads, whichever pass found it", async () => {
  const d = db({ prefix: [resultsRow("ZAKIRAH")], legacy: [legacyRow("ZAKIRA")] });
  const out = await searchHorses(d.runQuery, "Zakira", 12, quiet);
  assert.deepEqual(out.horses.map((h) => h.horseName), ["ZAKIRA", "ZAKIRAH"]);
});

test("one pass failing keeps the others; every pass failing is an error", async () => {
  const some = await searchHorses(db({ prefix: new Error("timeout"), legacy: [legacyRow("ZAKIRA")] }).runQuery, "zak", 12, quiet);
  assert.deepEqual(some.horses.map((h) => h.horseName), ["ZAKIRA"]);
  assert.deepEqual(some.failedPasses, ["prefix"]);

  const e = new Error("down");
  await assert.rejects(searchHorses(db({ prefix: e, word: e, legacy: e }).runQuery, "zak", 12, quiet), /every search pass failed/);
});

test("LIKE wildcards in the name match themselves", () => {
  assert.equal(escapeLike("50%_off\\"), "50\\%\\_off\\\\");
});

test("query params: two characters minimum, limit defaulted and capped", () => {
  assert.equal(parseSearchParams({ q: " d " }).q, null);
  assert.deepEqual(parseSearchParams({ q: " darz " }), { q: "darz", limit: DEFAULT_LIMIT });
  assert.equal(parseSearchParams({ q: "da", limit: "999" }).limit, MAX_LIMIT);
  assert.equal(parseSearchParams({ q: "da", limit: "x" }).limit, DEFAULT_LIMIT);
});

test("blank names from horse_names are skipped", async () => {
  const out = await searchHorses(db({ legacy: [legacyRow(""), legacyRow("ZAKIRA")] }).runQuery, "zak", 12, quiet);
  assert.deepEqual(out.horses.map((h) => h.horseName), ["ZAKIRA"]);
});
