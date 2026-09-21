import test from "node:test";
import assert from "node:assert/strict";

import {
  ancestorsFromPayload,
  ancestorsFromParents,
  similarity,
  quartersHeld,
  impactCells,
  crossIndex,
  bandOf,
  pedigreeParents,
  weightOf,
  SIRE_SIDE,
  DAM_SIDE,
} from "./lineage.mjs";

const payload = (name, pairs) => ({
  horse: { name },
  ancestors: Object.entries(pairs).map(([path, n]) => ({ path, display_name: n })),
});

test("a chart is re-rooted under the foal, so the sire's own sire lands at SS", () => {
  const a = ancestorsFromPayload(payload("Frankel", { S: "Galileo", D: "Kind", SS: "Sadler's Wells" }), "S");
  assert.equal(a.get("S"), "FRANKEL");
  assert.equal(a.get("SS"), "GALILEO");
  assert.equal(a.get("SD"), "KIND");
  assert.equal(a.get("SSS"), "SADLER'S WELLS");
});

test("nothing past the fifth generation is carried in", () => {
  const a = ancestorsFromPayload(payload("X", { SSSSS: "Deep" }), "S");
  assert.equal(a.has("SSSSSS"), false);
  assert.equal(a.size, 1);
});

test("a walk stops at a hole and promotes nothing into it", () => {
  const parents = new Map([
    ["CIRCIOS", { sire: "KINGMAN", dam: "COULD IT BE LOVE" }],
    ["KINGMAN", { sire: "INVINCIBLE SPIRIT", dam: null }],
    // Could It Be Love's parents are unknown.
    ["INVINCIBLE SPIRIT", { sire: "GREEN DESERT", dam: "RAFHA" }],
  ]);
  const a = ancestorsFromParents("CIRCIOS", parents, { prefix: "D" });
  assert.equal(a.get("D"), "CIRCIOS");
  assert.equal(a.get("DS"), "KINGMAN");
  assert.equal(a.get("DD"), "COULD IT BE LOVE");
  assert.equal(a.get("DSS"), "INVINCIBLE SPIRIT");
  // The gap stays a gap: nothing sits under Could It Be Love, and Kingman's
  // dam does not become Green Desert.
  assert.equal(a.has("DDS"), false);
  assert.equal(a.has("DSD"), false);
  assert.equal(a.get("DSSS"), "GREEN DESERT");
});

test("a shared ancestor is scored on the further of his two places", () => {
  // Galileo is the foal's grandsire and the other horse's fifth-generation
  // name. Scoring him as a grandsire would make every Galileo descendant look
  // like a close relation.
  const foal = new Map([["SS", "GALILEO"]]);
  const other = new Map([["SSSSS", "GALILEO"]]);
  const { score, shared } = similarity(foal, other);
  assert.equal(score, weightOf(5));
  assert.equal(shared[0].foalGen, 2);
  assert.equal(shared[0].gen, 5);
});

test("similarity is a share of the foal's own pedigree, so a thin chart is not flattered", () => {
  const foal = new Map([["S", "A"], ["D", "B"], ["SS", "C"], ["SD", "D"]]);
  const all = similarity(foal, new Map(foal));
  assert.equal(all.similarity, 100);
  const half = similarity(foal, new Map([["S", "A"], ["D", "B"]]));
  assert.equal(half.score, weightOf(1) * 2);
  // Rounded to a tenth: a percentage with fourteen decimal places is a
  // figure that looks more exact than the pedigree behind it.
  assert.equal(half.similarity, 66.7);
});

test("nothing shared scores nothing, and an empty pedigree has no percentage", () => {
  assert.equal(similarity(new Map(), new Map()).similarity, null);
  assert.equal(similarity(new Map([["S", "A"]]), new Map([["S", "B"]])).score, 0);
});

test("an ancestor in all four quarters is named; one in three is not", () => {
  const ancestors = new Map([
    ["SSS", "SADLER'S WELLS"], ["SDS", "SADLER'S WELLS"],
    ["DSS", "SADLER'S WELLS"], ["DDS", "SADLER'S WELLS"],
    ["SSD", "URBAN SEA"], ["SDD", "URBAN SEA"], ["DSD", "URBAN SEA"],
  ]);
  assert.deepEqual(quartersHeld(ancestors), ["SADLER'S WELLS"]);
});

test("the impact profile is twenty cells, named where the pedigree reaches them", () => {
  const ancestors = new Map([["S", "FRANKEL"], ["SS", "GALILEO"], ["DS", "KINGMAN"]]);
  const cells = impactCells(ancestors);
  assert.equal(cells.length, SIRE_SIDE.length * DAM_SIDE.length);
  assert.equal(cells.length, 20);
  const named = cells.find((c) => c.sirePath === "S" && c.damPath === "DS");
  assert.equal(named.sire, "FRANKEL");
  assert.equal(named.damsire, "KINGMAN");
  // A cell whose pedigree runs out is a cell with no names, not a cell with
  // the wrong ones.
  const blank = cells.find((c) => c.damPath === "DDDS");
  assert.equal(blank.damsire, null);
});

test("a cross nobody has tried has no index, rather than an index of nought", () => {
  const { expected, index } = crossIndex({ runners: 0, stakesWinners: 0, sireRate: 0.1, damsireRate: 0.1, par: 0.05 });
  assert.equal(expected, null);
  assert.equal(index, null);
  assert.equal(bandOf(null, 0), "untried");
});

test("index 100 is the two lines doing apart what they did together", () => {
  // Par 5%, both lines twice par, 100 runners: 100 × 0.05 × 2 × 2 = 20 expected.
  const at = crossIndex({ runners: 100, stakesWinners: 20, sireRate: 0.1, damsireRate: 0.1, par: 0.05 });
  assert.equal(at.expected, 20);
  assert.equal(at.index, 100);
  const over = crossIndex({ runners: 100, stakesWinners: 30, sireRate: 0.1, damsireRate: 0.1, par: 0.05 });
  assert.equal(over.index, 150);
  assert.equal(bandOf(over.index, 100), "strong");
});

test("a cross too small to mean anything is marked thin, whatever its index", () => {
  assert.equal(bandOf(400, 4), "thin");
  assert.equal(bandOf(400, 40), "strong");
});

test("a chart gives both parents of every ancestor it names", () => {
  const links = pedigreeParents(payload("Frankel", {
    S: "Galileo", D: "Kind", SS: "Sadler's Wells", SD: "Urban Sea", DS: "Danehill",
  }));
  const by = new Map(links.map((l) => [l.horse, l]));
  assert.deepEqual(by.get("FRANKEL"), { horse: "FRANKEL", sire: "GALILEO", dam: "KIND" });
  assert.deepEqual(by.get("GALILEO"), { horse: "GALILEO", sire: "SADLER'S WELLS", dam: "URBAN SEA" });
  // Kind's sire is known and her dam is not; half a link is still a link.
  assert.deepEqual(by.get("KIND"), { horse: "KIND", sire: "DANEHILL", dam: null });
  // Sadler's Wells has neither parent on this chart, so he is not a row.
  assert.equal(by.has("SADLER'S WELLS"), false);
});
