/**
 * A pedigree typed in by hand.
 *
 * Equineline is the source of every chart we hold, and it is the bottleneck:
 * one fetch is a paced upstream call that is allowed to fail, and a mare who
 * is not in it is a mare with no grid, no inbreeding screen and no
 * theoretical foal — which is to say a mare the report cannot be written for.
 * The desk usually has her chart on paper. This lets them put it in.
 *
 * ## A typed pedigree is still a pedigree
 *
 * It goes in the same cache, in the same shape, and every reader — the grid,
 * the report, the inbreeding screen, the parent map the nick rebuild walks —
 * treats it exactly like a fetched one, because a pedigree is a fact about a
 * horse and not about where we got it. What is recorded alongside is
 * `source`, so a chart somebody typed can be told from one the upstream sent,
 * and a mistake can be found and corrected later.
 *
 * ## Parse, show, then save
 *
 * Nothing is written until the caller has seen what was read. A pasted block
 * of thirty names has an order that has to be assumed, and an assumed order
 * that is wrong puts a horse's grandsire in the fourth generation — which
 * turns a clean cross into a 3x4 on paper, or hides a real one. So the parse
 * is its own answer: `dryRun` returns the grid and saves nothing, and the
 * form shows it back before anybody commits.
 */

import crypto from "crypto";
import { normaliseName, foalingYearOf } from "./store.mjs";
import { WIDTHS, slotOf } from "./grid.mjs";

/** `pedigree_cache` predates any source but one; this records which. */
export const CACHE_COLUMNS = {
  source: "VARCHAR(16) NULL",
  entered_by: "VARCHAR(64) NULL",
};

const PATH_RE = /^[SD]{1,5}$/;

/** Every path in a full five-generation chart, in drawn order. */
export const ALL_PATHS = (() => {
  const out = [];
  for (let gen = 1; gen <= 5; gen += 1) {
    for (let slot = 0; slot < WIDTHS[gen - 1]; slot += 1) {
      let path = "";
      for (let bit = gen - 1; bit >= 0; bit -= 1) path += (slot >> bit) & 1 ? "D" : "S";
      out.push(path);
    }
  }
  return out;
})();

/** How many names a chart holds at each depth: 2, 6, 14, 30, 62. */
export const CUMULATIVE = WIDTHS.map((_, i) => WIDTHS.slice(0, i + 1).reduce((a, b) => a + b, 0));

/**
 * A reference for a chart nobody fetched.
 *
 * Equineline's are numeric, so a leading "M" cannot collide with one however
 * the two are compared. The rest is a digest of the horse's name and year,
 * which makes the reference stable: typing the same mare's chart in twice
 * corrects the first one instead of filling the cache with duplicates of her.
 */
export function referenceFor(name, year) {
  const key = `${normaliseName(name)}|${Number.isFinite(Number(year)) ? Number(year) : ""}`;
  return `M${crypto.createHash("sha1").update(key).digest("hex").slice(0, 16)}`.slice(0, 32);
}

const cleanName = (raw) =>
  String(raw ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—·•|]+|[\s\-–—·•|]+$/g, "")
    .trim();

/** A handful of words the trade uses instead of a path. */
const WORD_PATHS = new Map([
  ["sire", "S"],
  ["dam", "D"],
  ["damsire", "DS"],
  ["broodmare sire", "DS"],
  ["bms", "DS"],
  ["2nd dam", "DD"],
  ["second dam", "DD"],
  ["grandam", "DD"],
  ["granddam", "DD"],
  ["3rd dam", "DDD"],
  ["third dam", "DDD"],
  ["sires sire", "SS"],
  ["sire's sire", "SS"],
  ["sires dam", "SD"],
  ["sire's dam", "SD"],
]);

/**
 * Read a pasted chart.
 *
 * Two shapes, and which one was used comes back in `format` so the caller can
 * say so. **Labelled** lines — `SDS: Kingman` — mean exactly what they say and
 * carry no assumption. An **ordered** list carries one: that the names run
 * generation by generation, and within a generation from the top of a drawn
 * chart to the bottom. It is only accepted when the count lands exactly on a
 * whole number of generations, because a list that is one name short is a
 * list where every name after the gap is in the wrong place.
 */
export function parsePastedPedigree(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((l) => cleanName(l))
    .filter(Boolean);
  if (!lines.length) return { ancestors: [], format: "empty", warnings: ["Nothing to read."] };

  const labelled = [];
  let unlabelled = 0;
  for (const line of lines) {
    // A label may start with a digit — "2nd dam" is how the trade writes it —
    // and is kept short, so a line that happens to contain a colon in the
    // middle of a name is not mistaken for a position.
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9'’\s]{0,20}?)\s*[:\t|]\s*(.+)$/);
    if (!m) {
      unlabelled += 1;
      continue;
    }
    const raw = m[1].trim();
    const upper = raw.toUpperCase();
    const path = PATH_RE.test(upper)
      ? upper
      : WORD_PATHS.get(raw.toLowerCase().replace(/['’]/g, "")) ?? null;
    const name = cleanName(m[2]);
    if (path && name) labelled.push({ path, name });
    else unlabelled += 1;
  }

  if (labelled.length && labelled.length >= lines.length - unlabelled) {
    const warnings = [];
    if (unlabelled) warnings.push(`${unlabelled} line${unlabelled === 1 ? "" : "s"} had no position and ${unlabelled === 1 ? "was" : "were"} skipped.`);
    return { ancestors: dedupe(labelled), format: "labelled", warnings };
  }

  const depth = CUMULATIVE.indexOf(lines.length);
  if (depth === -1) {
    return {
      ancestors: [],
      format: "unknown",
      warnings: [
        `Read ${lines.length} name${lines.length === 1 ? "" : "s"}, which is not a whole number of generations ` +
          `(${CUMULATIVE.join(", ")}). Label each line with its position instead — "SDS: Kingman" — ` +
          `or fill the grid directly.`,
      ],
    };
  }
  const ancestors = lines.map((name, i) => ({ path: ALL_PATHS[i], name }));
  return {
    ancestors: dedupe(ancestors),
    format: "ordered",
    warnings: [
      `Read as ${depth + 1} generation${depth ? "s" : ""} in drawn order, sire at the top. ` +
        `Check the grid before saving — an order read wrongly puts an ancestor in the wrong generation.`,
    ],
  };
}

/** Last writer wins on a repeated path, and a bad path is dropped. */
function dedupe(list) {
  const at = new Map();
  for (const a of list) {
    const path = String(a?.path ?? "").toUpperCase();
    const name = cleanName(a?.name ?? a?.display_name);
    if (!PATH_RE.test(path) || !name) continue;
    at.set(path, name);
  }
  return [...at.entries()]
    .map(([path, name]) => ({ path, name }))
    .sort((a, b) => a.path.length - b.path.length || slotOf(a.path) - slotOf(b.path));
}

/**
 * What a typed chart does not get to claim.
 *
 * An ancestor whose own parent is missing is fine — that is a hole, and holes
 * are honest. An ancestor *under* a hole is not: if we do not know a horse's
 * dam we cannot know her sire, and a name sitting there came from somewhere
 * else. It is kept, because the person typing may know something the chart
 * does not show, but it is reported so they can look again.
 */
export function orphanPaths(ancestors) {
  const have = new Set(ancestors.map((a) => a.path));
  return ancestors
    .map((a) => a.path)
    .filter((p) => p.length > 1 && !have.has(p.slice(0, -1)))
    .sort();
}

/**
 * The cached shape, built from a chart somebody typed.
 *
 * Deliberately the *same* shape the upstream sends, down to the key names,
 * because every reader in the codebase already knows how to read that and a
 * second shape would mean a second set of readers to keep in step.
 */
export function payloadFrom({ name, year = null, sex = null, ancestors = [], source = "manual", enteredBy = null }) {
  const display = cleanName(name);
  if (!display) return null;
  const list = dedupe(ancestors);
  if (!list.length) return null;
  const foaled = Number.isFinite(Number(year)) && Number(year) > 1700 ? String(Number(year)) : null;
  return {
    horse: {
      name: display,
      reference_number: referenceFor(display, year),
      foaled,
      sex: sex ? String(sex).slice(0, 16) : null,
      source,
      entered_by: enteredBy ? String(enteredBy).slice(0, 64) : null,
    },
    ancestors: list.map((a) => ({ path: a.path, name: a.name, display_name: a.name })),
  };
}

/** The `pedigree_cache` row for a typed chart. */
export function rowFrom(payload, { source = "manual", enteredBy = null } = {}) {
  const horse = payload?.horse ?? {};
  const display = cleanName(horse.name);
  const reference = horse.reference_number ? String(horse.reference_number) : null;
  if (!display || !reference) return null;
  return {
    reference,
    name_key: normaliseName(display),
    display: display.slice(0, 191),
    foaling_year: foalingYearOf(horse.foaled),
    sex: horse.sex ? String(horse.sex).slice(0, 16) : null,
    payload: JSON.stringify(payload),
    source: String(source).slice(0, 16),
    entered_by: enteredBy ? String(enteredBy).slice(0, 64) : null,
  };
}

export const UPSERT = `INSERT INTO pedigree_cache
    (reference, name_key, display, foaling_year, sex, payload, source, entered_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE
    name_key = VALUES(name_key), display = VALUES(display),
    foaling_year = VALUES(foaling_year), sex = VALUES(sex),
    payload = VALUES(payload), source = VALUES(source),
    entered_by = VALUES(entered_by), fetched_at = CURRENT_TIMESTAMP`;

export const upsertArgs = (row) => [
  row.reference, row.name_key, row.display, row.foaling_year,
  row.sex, row.payload, row.source, row.entered_by,
];

/** Add the two provenance columns to a cache built before they existed. */
export async function ensureUploadSchema(runQuery, { log = console } = {}) {
  const added = [];
  const columns = await runQuery(
    `SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedigree_cache'`,
    [],
  );
  if (!columns.length) return { added, present: false };
  const have = new Set(columns.map((r) => r.name));
  for (const [column, definition] of Object.entries(CACHE_COLUMNS)) {
    if (have.has(column)) continue;
    await runQuery(`ALTER TABLE pedigree_cache ADD COLUMN \`${column}\` ${definition}`, []);
    added.push(column);
  }
  if (added.length) log.log?.(`pedigree cache: added ${added.join(", ")}`);
  return { added, present: true };
}
