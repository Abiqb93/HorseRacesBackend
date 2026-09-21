import test from "node:test";
import assert from "node:assert/strict";

import { gridFromPayload, heldIn, slotOf } from "./grid.mjs";

test("S is 0 and D is 1, so the path is the row a chart draws that ancestor on", () => {
  assert.equal(slotOf("S"), 0);
  assert.equal(slotOf("D"), 1);
  assert.equal(slotOf("SS"), 0);
  assert.equal(slotOf("SD"), 1);
  assert.equal(slotOf("DS"), 2);
  assert.equal(slotOf("DD"), 3);
  assert.equal(slotOf("DDDDD"), 31);
});

test("a hole stays a hole, because closing it up shifts every ancestor after it", () => {
  const grid = gridFromPayload({
    ancestors: [
      { path: "S", name: "Kingman" },
      // No "D" at all: the mare's dam is not in this chart.
      { path: "SS", name: "Invincible Spirit" },
      { path: "SD", display_name: "Zenda (GB)" },
      { path: "DS", name: "War Front" },
    ],
  });
  assert.equal(grid[0][0], "Kingman");
  assert.equal(grid[0][1], null);
  assert.equal(grid[1][0], "Invincible Spirit");
  assert.equal(grid[1][1], "Zenda (GB)");
  assert.equal(grid[1][2], "War Front");
  assert.equal(grid[1][3], null);
  assert.deepEqual(grid.map((row) => row.length), [2, 4, 8, 16, 32]);
  assert.equal(heldIn(grid), 4);
});

test("nonsense is left out rather than dropped into the wrong slot", () => {
  const grid = gridFromPayload({
    ancestors: [
      { path: "SDSDSD", name: "Too deep" },
      { path: "X", name: "Not a path" },
      { path: "", name: "No path" },
      { path: "S", name: "  " },
      { path: "D", name: "Could it be Love" },
    ],
  });
  assert.equal(heldIn(grid), 1);
  assert.equal(grid[0][1], "Could it be Love");
  assert.equal(heldIn(gridFromPayload(null)), 0);
});
