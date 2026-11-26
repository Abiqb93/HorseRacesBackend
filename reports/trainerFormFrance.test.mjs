import test from "node:test";
import assert from "node:assert/strict";
import { trainerFormRows, frenchTrainer } from "./trainerFormFrance.mjs";

test("the feed's (S) mark comes off the yard's name", () => {
  assert.equal(frenchTrainer("FH. GRAFFARD (S)"), "FH. GRAFFARD");
  assert.equal(frenchTrainer("A.FABRE"), "A.FABRE");
});

test("French trainer form: a yard well below its own norm in the last 30 days is out of form, off results alone (26 November 2026)", () => {
  const runs = [];
  const day = (n) => new Date(Date.parse("2026-11-26") - n * 86400000).toISOString().slice(0, 10);
  let race = 0;
  // two yards over the period: A wins often before and never lately; B the same throughout
  for (let i = 0; i < 60; i += 1) {
    const d = day(40 + i);
    race += 1;
    runs.push({ trainer: "A", date: d, race: String(race), pos: i % 2 ? 1 : 2, runners: 10, sp: 3, prize: null });
    runs.push({ trainer: "B", date: d, race: String(race), pos: 5, runners: 10, sp: 6, prize: null });
  }
  for (let i = 0; i < 15; i += 1) {
    const d = day(i + 1);
    race += 1;
    runs.push({ trainer: "A", date: d, race: String(race), pos: 10, runners: 10, sp: 3, prize: null });
    runs.push({ trainer: "B", date: d, race: String(race), pos: 5, runners: 10, sp: 6, prize: null });
  }
  const rows = trainerFormRows(runs, { today: "2026-11-26" });
  const a = rows.find((r) => r.trainer === "A");
  const b = rows.find((r) => r.trainer === "B");
  assert.equal(a.form, "out of form");
  assert.equal(a.wins30, 0);
  assert.equal(b.form, "steady");
  assert.equal(a.prizePerRun, null, "no prize stated: a dash, never nought");
  assert.ok(a.ae > 0);
});
