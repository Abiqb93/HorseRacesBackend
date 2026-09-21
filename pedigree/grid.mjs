/**
 * A cached pedigree payload as a grid of names.
 *
 * Five arrays — 2, 4, 8, 16, 32 — of ancestor names in drawn order, with null
 * where the pedigree runs out. That is everything a cross needs: whether the
 * same horse appears on both sides, and in which generations.
 *
 * **A hole must stay a hole.** Close it up and every ancestor after it shifts
 * into the wrong generation, and a chart that lies about a 4x5 is worse than
 * no chart at all.
 *
 * This lived inside `/api/pedigree/grids` until the report needed the same
 * shape for two named horses rather than for all of them. One function, two
 * callers, and no chance of the roster's grids and a report's grid disagreeing
 * about where an ancestor sits.
 */

export const WIDTHS = [2, 4, 8, 16, 32];
const PATH = /^[SD]{1,5}$/;

/**
 * S is 0 and D is 1, which makes a path a binary numeral and the numeral the
 * row a tabulated pedigree draws that ancestor on.
 */
export const slotOf = (path) => [...path].reduce((n, c) => n * 2 + (c === "D" ? 1 : 0), 0);

export function gridFromPayload(payload) {
  const grid = WIDTHS.map((w) => new Array(w).fill(null));
  for (const a of payload?.ancestors ?? []) {
    const path = String(a?.path ?? "");
    if (!PATH.test(path)) continue;
    const g = path.length;
    const i = slotOf(path);
    if (i >= grid[g - 1].length) continue;
    const written = String(a?.display_name ?? a?.name ?? "").trim();
    if (written) grid[g - 1][i] = written;
  }
  return grid;
}

/** How much of the five generations a payload actually reaches. */
export const heldIn = (grid) => grid.flat().filter(Boolean).length;
