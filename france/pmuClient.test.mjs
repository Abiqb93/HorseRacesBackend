/**
 * Which of PMU's races we take.
 *
 * No network: the fixtures below are the shapes the live programme returns.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  isThoroughbredRace,
  frenchThoroughbredMeetings,
} from "./pmuClient.mjs";

test("takes a jumps race even though it never says OBSTACLE", () => {
  // The bug this guards: a meeting's disciplinesMere says OBSTACLE while the
  // races inside it say HAIE or STEEPLECHASE, so matching a race against the
  // meeting's vocabulary dropped every French hurdle and chase ever run.
  assert.ok(isThoroughbredRace({ specialite: "OBSTACLE", discipline: "HAIE" }));
  assert.ok(isThoroughbredRace({ specialite: "OBSTACLE", discipline: "STEEPLECHASE" }));
  assert.ok(isThoroughbredRace({ specialite: "OBSTACLE", discipline: "CROSS" }));
  assert.ok(isThoroughbredRace({ specialite: "PLAT", discipline: "PLAT" }));
});

test("leaves harness racing alone", () => {
  assert.equal(isThoroughbredRace({ specialite: "TROT_ATTELE", discipline: "ATTELE" }), false);
  assert.equal(isThoroughbredRace({ specialite: "TROT_MONTE", discipline: "MONTE" }), false);
});

test("falls back to the discipline when a race carries no specialite", () => {
  assert.ok(isThoroughbredRace({ discipline: "HAIE" }));
  assert.ok(isThoroughbredRace({ discipline: "PLAT" }));
  assert.equal(isThoroughbredRace({ discipline: "ATTELE" }), false);
  assert.equal(isThoroughbredRace({}), false);
});

test("keeps French thoroughbred meetings and drops the rest", () => {
  const programme = {
    reunions: [
      { hippodrome: { libelleLong: "CLAIREFONTAINE" }, pays: { code: "FRA" }, disciplinesMere: ["OBSTACLE"] },
      { hippodrome: { libelleLong: "LA TESTE" }, pays: { code: "FRA" }, disciplinesMere: ["PLAT"] },
      { hippodrome: { libelleLong: "VINCENNES" }, pays: { code: "FRA" }, disciplinesMere: ["TROT"] },
      { hippodrome: { libelleLong: "GELSENKIRCHEN" }, pays: { code: "DEU" }, disciplinesMere: ["TROT"] },
      { hippodrome: { libelleLong: "YORK" }, pays: { code: "GBR" }, disciplinesMere: ["PLAT"] },
    ],
  };
  const kept = frenchThoroughbredMeetings(programme).map((m) => m.hippodrome.libelleLong);
  assert.deepEqual(kept, ["CLAIREFONTAINE", "LA TESTE"]);
});

test("keeps a mixed Flat-and-jumps card", () => {
  const programme = {
    reunions: [
      { hippodrome: { libelleLong: "AUTEUIL" }, pays: { code: "FRA" }, disciplinesMere: ["OBSTACLE", "PLAT"] },
    ],
  };
  assert.equal(frenchThoroughbredMeetings(programme).length, 1);
});
