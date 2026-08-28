/**
 * Course-alias reconciliation.
 *
 * France Galop and PMU do not agree on what a racecourse is called. Before
 * this was handled, 26 Aug 2026 merged to 234 rows when the truth was 154 —
 * every runner at La Teste stored twice, once under each source's spelling.
 * Those duplicates would have become two APIData_Table2 rows for one run.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { reconcileCourseNames, mergeDay } from "./mergeSources.mjs";

const runner = (courseName, horseName, raceNumber = 1) => ({
  meetingDate: "2026-08-26",
  courseName,
  raceNumber,
  horseName,
  clothNumber: null,
});

// The real pairing, reduced to its essentials.
const FG_NAME = "LA TESTE-BASSIN ARCACHON";
const PMU_NAME = "HIPPODROME DE LA TESTE DE BUCH";
const FIELD = ["BEL ECLAT", "CANTAVIR", "HEMATITE", "DARING PRINCE", "ROYALLY"];

test("pairs two spellings of one racecourse by their shared runners", () => {
  const fg = FIELD.map((h) => runner(FG_NAME, h));
  const pmu = FIELD.map((h) => runner(PMU_NAME, h));

  // Keyed on PMU's normalised name. That is "LA TESTE" and not "TESTE DE
  // BUCH": the normaliser keeps the article out of "HIPPODROME DE LA ...",
  // which is what stops the platform filing this fixture under two names.
  const aliases = reconcileCourseNames(fg, pmu);
  assert.equal(aliases.size, 1);
  assert.equal(aliases.get("LA TESTE").courseName, FG_NAME);
  assert.equal(aliases.get("LA TESTE").containment, 1);
});

test("still pairs when one source carries fewer races than the other", () => {
  // France Galop published races 1,2,3,4,6,8 at La Teste where PMU had all
  // eight, so containment has to be measured against the smaller field.
  const fg = FIELD.slice(0, 3).map((h) => runner(FG_NAME, h));
  const pmu = FIELD.map((h) => runner(PMU_NAME, h));

  const aliases = reconcileCourseNames(fg, pmu);
  assert.equal(aliases.get("LA TESTE").courseName, FG_NAME);
});

test("does not pair two genuinely different meetings", () => {
  const fg = FIELD.map((h) => runner("CLAIREFONTAINE", h));
  const pmu = ["OTHER ONE", "OTHER TWO", "OTHER THREE", "OTHER FOUR"].map((h) =>
    runner("VICHY", h),
  );

  assert.equal(reconcileCourseNames(fg, pmu).size, 0);
});

test("ignores an overlap too small to mean anything", () => {
  const fg = [runner("CLAIREFONTAINE", "BEL ECLAT")];
  const pmu = [runner("VICHY", "BEL ECLAT")];

  // One shared name is under the floor: a coincidence, not a meeting.
  assert.equal(reconcileCourseNames(fg, pmu).size, 0);
});

test("merging an aliased meeting yields one row per runner, not two", () => {
  const fg = FIELD.map((h) => runner(FG_NAME, h));
  const pmu = FIELD.map((h) => runner(PMU_NAME, h));

  const { rows, stats } = mergeDay(fg, pmu);

  assert.equal(rows.length, FIELD.length, "each horse must appear exactly once");
  assert.equal(stats.runnersBoth, FIELD.length);
  assert.equal(stats.courseAliases.length, 1);

  const courses = new Set(rows.map((r) => r.courseName));
  assert.deepEqual([...courses], [FG_NAME], "France Galop's name is the one kept");
});

test("leaves course names alone when both sources already agree", () => {
  const fg = FIELD.map((h) => runner("CLAIREFONTAINE", h));
  const pmu = FIELD.map((h) => runner("CLAIREFONTAINE", h));

  const { rows, stats } = mergeDay(fg, pmu);
  assert.equal(stats.courseAliases.length, 0);
  assert.equal(rows.length, FIELD.length);
});
