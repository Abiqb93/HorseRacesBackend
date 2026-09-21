/**
 * Pedigrees we can walk ourselves.
 *
 * `nick_stats` answers one question — how a sire's runners have gone out of a
 * damsire's daughters — and it answers it from a single generation on each
 * side. Two of the things the desk asks for need more than that: which stakes
 * winners share a theoretical foal's pedigree, and how the twenty
 * four-generation crosses behind that foal have actually performed. Both need
 * a pedigree, and for most horses we hold no chart.
 *
 * What we do hold is a very large number of (horse → sire) facts, and, once
 * this module has run, (horse → dam) as well. A parent map is a pedigree you
 * can walk: four steps out from a horse gives his first four generations,
 * with a hole wherever the map runs out. That is not Equineline's chart and
 * this file never pretends it is — `coverage` travels with every figure — but
 * it is ours, it is free, and it covers every horse that has run in the
 * results table or appears in the worldwide file.
 *
 * ## The rule that matters
 *
 * A hole is a hole. Where a parent is unknown the walk stops on that branch
 * and the ancestor is simply absent; nothing is promoted into the gap. A
 * pedigree that closes its own holes puts ancestors in the wrong generation,
 * and a wrong generation is what turns a 5x5 into a 3x4 on paper.
 */

import { PARENTS_TABLE, NICKS_TABLE, studKey } from "./nicks.mjs";

export const SW_TABLE = "sw_ancestors";

/** How far out a walk goes. Four generations is what the crosses need. */
export const SW_DEPTH = 4;

/* ------------------------------------------------------------ the schema */

/** `horse_parents` was built for sires alone; a pedigree needs both sides. */
export const LINEAGE_COLUMNS = {
  dam_key: "VARCHAR(80) NULL",
};

export const LINEAGE_INDEXES = {
  idx_hp_dam: "(dam_key)",
};

export const CREATE_SW_ANCESTORS = (table = SW_TABLE) => `
  CREATE TABLE IF NOT EXISTS ${table} (
    sw_key VARCHAR(80) NOT NULL,
    ancestor_key VARCHAR(80) NOT NULL,
    gen TINYINT NOT NULL,
    side CHAR(1) NOT NULL,
    PRIMARY KEY (sw_key, ancestor_key),
    KEY idx_swa_ancestor (ancestor_key)
  )`;

/**
 * Deepen the parent map: dams for horses that have one, and sires for dams.
 *
 * Not `INSERT IGNORE`, because most of these rows already exist: the horse is
 * in the table with a sire and a null dam. `COALESCE(dam_key,
 * VALUES(dam_key))` fills the blank and leaves a dam already recorded alone,
 * so the first source to know a horse's dam keeps the answer even though the
 * pass that wrote his sire may have been a different one.
 *
 * The third pass is the one that buys a generation. The worldwide file names
 * a horse's dam but knows nothing about her, because she was foaled before
 * the crops it covers — so a walk reaches her and stops, and every pedigree
 * is two deep on the female side. The results table records a runner's
 * damsire in a column of its own, which is exactly the fact the walk is
 * missing: it gives her a sire without her ever having to appear as a runner
 * herself. On this server that pass adds almost nothing, because the local
 * results table is a stub; against the real one it is the difference between
 * a pedigree that stops at the dam and one that goes on.
 */
export const LINEAGE_PASSES = [
  {
    source: "results",
    sql: `INSERT INTO ${PARENTS_TABLE} (horse_key, sire_key, dam_key, sex, source)
          SELECT UPPER(TRIM(horseName)), UPPER(TRIM(MAX(sireName))), UPPER(TRIM(MAX(damName))),
                 MAX(horseGender), 'results'
            FROM APIData_Table2
           WHERE sireName IS NOT NULL AND sireName <> ''
             AND damName IS NOT NULL AND damName <> ''
             AND horseName IS NOT NULL
           GROUP BY horseName
          ON DUPLICATE KEY UPDATE dam_key = COALESCE(${PARENTS_TABLE}.dam_key, VALUES(dam_key))`,
  },
  {
    source: "worldwide",
    sql: `INSERT INTO ${PARENTS_TABLE} (horse_key, sire_key, dam_key, sex, source)
          SELECT horse_name, MAX(sire_key), MAX(dam_key), MAX(sex), 'worldwide'
            FROM breeding_horses
           WHERE sire_key IS NOT NULL AND sire_key <> ''
             AND dam_key IS NOT NULL AND dam_key <> ''
           GROUP BY horse_name
          ON DUPLICATE KEY UPDATE dam_key = COALESCE(${PARENTS_TABLE}.dam_key, VALUES(dam_key))`,
  },
  {
    source: "damsires",
    sql: `INSERT INTO ${PARENTS_TABLE} (horse_key, sire_key, dam_key, sex, source)
          SELECT UPPER(TRIM(damName)), UPPER(TRIM(MAX(damsireName))), NULL, 'F', 'results'
            FROM APIData_Table2
           WHERE damName IS NOT NULL AND damName <> ''
             AND damsireName IS NOT NULL AND damsireName <> ''
           GROUP BY damName
          ON DUPLICATE KEY UPDATE sex = COALESCE(${PARENTS_TABLE}.sex, VALUES(sex))`,
  },
];

/** Kept under the old name: the third pass does more than dams. */
export const DAM_PASSES = LINEAGE_PASSES;

/**
 * Both parents of every ancestor a cached chart names.
 *
 * The chart is the better source — it reaches horses that never raced and
 * never appear in the worldwide file — so these links are worth harvesting
 * even where the same horse is already known. A horse at path P has his sire
 * at P+"S" and his dam at P+"D"; where either is missing that half is null.
 */
export function pedigreeParents(payload) {
  const at = new Map();
  for (const a of payload?.ancestors ?? []) {
    const path = String(a?.path ?? "");
    if (!/^[SD]{1,5}$/.test(path)) continue;
    const name = studKey(a?.display_name ?? a?.name);
    if (name) at.set(path, name);
  }
  const out = [];
  const push = (horse, sire, dam) => {
    if (!horse || (!sire && !dam)) return;
    out.push({ horse, sire: sire ?? null, dam: dam ?? null });
  };
  push(studKey(payload?.horse?.name), at.get("S"), at.get("D"));
  for (const [path, name] of at) push(name, at.get(`${path}S`), at.get(`${path}D`));
  return out;
}

/* ------------------------------------------------------------- the walks */

const PATH_RE = /^[SD]{1,5}$/;

/**
 * A cached chart as `{path → key}`, ready to be re-rooted under a foal.
 *
 * `prefix` is where the horse himself sits in the foal's pedigree: "S" for
 * the stallion, "D" for the mare. His own sire then lands at "SS", which is
 * exactly where a foal's paternal grandsire belongs.
 */
export function ancestorsFromPayload(payload, prefix = "") {
  const out = new Map();
  const self = studKey(payload?.horse?.name);
  if (prefix && self) out.set(prefix, self);
  for (const a of payload?.ancestors ?? []) {
    const path = String(a?.path ?? "");
    if (!PATH_RE.test(path)) continue;
    const key = studKey(a?.display_name ?? a?.name);
    if (!key) continue;
    const full = `${prefix}${path}`;
    if (full.length <= 5) out.set(full, key);
  }
  return out;
}

/**
 * The same shape, walked out of a parent map instead of a chart.
 *
 * `parents` answers `get(key)` with `{sire, dam}` or nothing. Breadth-first so
 * a walk that runs out of map stops at the right generation rather than
 * following one deep branch and calling it a pedigree.
 */
export function ancestorsFromParents(rootKey, parents, { prefix = "", maxPath = 5 } = {}) {
  const out = new Map();
  const root = studKey(rootKey);
  if (!root) return out;
  if (prefix) out.set(prefix, root);
  let frontier = [[prefix, root]];
  while (frontier.length) {
    const next = [];
    for (const [path, key] of frontier) {
      if (path.length >= maxPath) continue;
      const rec = parents?.get?.(key);
      if (!rec) continue;
      for (const [step, parent] of [["S", rec.sire], ["D", rec.dam]]) {
        const p = studKey(parent);
        if (!p) continue;
        const child = `${path}${step}`;
        if (out.has(child)) continue;
        out.set(child, p);
        next.push([child, p]);
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * The theoretical foal's pedigree, from whatever each side could supply.
 *
 * Returns `{ancestors, held, sides}` where `ancestors` is `path → key` over
 * the foal's own five generations and `sides` records which source answered
 * for each parent, so a report can say "her half is from a chart, his from
 * our own records" rather than implying both were drawn the same way.
 */
export function foalAncestors({ sire = null, dam = null } = {}) {
  const ancestors = new Map();
  const sides = {};
  for (const [prefix, side] of [["S", sire], ["D", dam]]) {
    if (!side) {
      sides[prefix] = { source: "none", held: 0 };
      continue;
    }
    const map = side.payload
      ? ancestorsFromPayload(side.payload, prefix)
      : ancestorsFromParents(side.key, side.parents, { prefix });
    for (const [path, key] of map) ancestors.set(path, key);
    sides[prefix] = { source: side.payload ? "chart" : "records", held: map.size };
  }
  return { ancestors, held: ancestors.size, sides };
}

/* -------------------------------------------------------- the similarity */

/**
 * What a shared ancestor is worth, by the generation he stands in.
 *
 * Halving each generation out is the same arithmetic as a pedigree's own
 * blood share, and it is the reason a shared grandsire says more about two
 * horses than four shared names in the fifth generation.
 */
export const GEN_WEIGHT = [16, 8, 4, 2, 1];
export const weightOf = (gen) => GEN_WEIGHT[gen - 1] ?? 0;

/**
 * How much of a theoretical foal's pedigree a horse repeats.
 *
 * `shared` counts each ancestor once, at his nearest place in each pedigree,
 * and scores him on the *further* of the two: an ancestor who is a grandsire
 * of one and a fifth-generation name in the other is a thin link, and scoring
 * him on the near placement would make every horse look related to every
 * Northern Dancer descendant. `similarity` is the score as a share of what a
 * horse with the foal's own pedigree would score, so it reads as a
 * percentage and does not move when a pedigree is only three deep.
 *
 * This is our own arithmetic, not anybody's published index, and the weights
 * are written down here so that a figure can be argued with.
 */
export function similarity(foal, other) {
  const nearest = (m) => {
    const out = new Map();
    for (const [path, key] of m) {
      const gen = path.length;
      if (!out.has(key) || gen < out.get(key)) out.set(key, gen);
    }
    return out;
  };
  const a = nearest(foal);
  const b = nearest(other);
  let score = 0;
  const shared = [];
  for (const [key, genA] of a) {
    const genB = b.get(key);
    if (!genB) continue;
    const w = weightOf(Math.max(genA, genB));
    if (!w) continue;
    score += w;
    shared.push({ name: key, foalGen: genA, gen: genB, weight: w });
  }
  let self = 0;
  for (const [, gen] of a) self += weightOf(gen);
  shared.sort((x, y) => y.weight - x.weight || x.name.localeCompare(y.name));
  return {
    score,
    similarity: self > 0 ? Math.round((1000 * score) / self) / 10 : null,
    shared,
  };
}

/**
 * Does an ancestor appear on both halves of the foal?
 *
 * The quarters are the foal's four grandparents. A name in all four is the
 * kind of duplication that pedigree people set most store by, and it is worth
 * naming separately from a plain count of shared ancestors.
 */
export function quartersHeld(ancestors) {
  const quarters = ["SS", "SD", "DS", "DD"];
  const inQuarter = new Map();
  for (const [path, key] of ancestors) {
    if (path.length < 2) continue;
    const q = path.slice(0, 2);
    if (!quarters.includes(q)) continue;
    if (!inQuarter.has(key)) inQuarter.set(key, new Set());
    inQuarter.get(key).add(q);
  }
  const all = [];
  for (const [key, qs] of inQuarter) if (qs.size === 4) all.push(key);
  return all.sort();
}

/* ----------------------------------------------------- the impact profile */

/**
 * The twenty crosses behind a theoretical foal.
 *
 * Four male ancestors from the stallion's side and five from the mare's, each
 * pairing a cross that a breeder would name out loud. The paths are the
 * foal's, so "SDS" is the stallion's damsire and "DDS" is the mare's.
 *
 * Twenty is the number the trade's impact profiles use. These are our own
 * twenty: the ones our data can actually answer, written down rather than
 * inferred from somebody's printed report.
 */
export const SIRE_SIDE = [
  { path: "S", label: "the stallion" },
  { path: "SS", label: "his sire" },
  { path: "SSS", label: "his sire's sire" },
  { path: "SDS", label: "his damsire" },
];

export const DAM_SIDE = [
  { path: "DS", label: "her sire" },
  { path: "DSS", label: "her sire's sire" },
  { path: "DDS", label: "her damsire" },
  { path: "DSDS", label: "her sire's damsire" },
  { path: "DDDS", label: "her second damsire" },
];

/** The cells, with the names filled in where the pedigree reaches them. */
export function impactCells(ancestors) {
  const cells = [];
  for (const s of SIRE_SIDE) {
    for (const d of DAM_SIDE) {
      cells.push({
        sirePath: s.path,
        damPath: d.path,
        sireLabel: s.label,
        damLabel: d.label,
        sire: ancestors.get(s.path) ?? null,
        damsire: ancestors.get(d.path) ?? null,
      });
    }
  }
  return cells;
}

/**
 * A cross's index, in the shape the trade reads it.
 *
 * `par` is the population's stakes-winner rate. A line's own index is its rate
 * over par — a sire line twice as good as the breed scores 2. Expected stakes
 * winners on a cross is what those two indices predict on their own, before
 * anything is claimed for the cross itself, and the cross's index is what it
 * actually produced against that. 100 is par: the cross did exactly what the
 * two lines would do apart. Above is the cross adding something.
 *
 * `null` where there is nothing to divide by. A cross with no runners has no
 * index, and printing 0 for it would read as a failure rather than a silence.
 */
export function crossIndex({ runners = 0, stakesWinners = 0, sireRate = null, damsireRate = null, par = null }) {
  const r = Number(runners) || 0;
  if (!r || !par || par <= 0) return { expected: null, index: null };
  const sii = Number.isFinite(sireRate) && sireRate !== null ? sireRate / par : 1;
  const bsii = Number.isFinite(damsireRate) && damsireRate !== null ? damsireRate / par : 1;
  const expected = r * par * sii * bsii;
  if (!(expected > 0)) return { expected: null, index: null };
  return {
    expected: Math.round(expected * 100) / 100,
    index: Math.round((100 * Number(stakesWinners || 0)) / expected),
  };
}

/** Where a cell's index puts it, for a reader who wants four words not a number. */
export function bandOf(index, runners) {
  if (index === null || index === undefined) return "untried";
  if ((Number(runners) || 0) < 20) return "thin";
  if (index >= 150) return "strong";
  if (index >= 110) return "above";
  if (index >= 90) return "par";
  return "below";
}

/* --------------------------------------------------------- the SW rebuild */

/** Stakes winners, as the worldwide file records them. */
export const SW_SEED = (table) => `
  INSERT IGNORE INTO ${table} (sw_key, ancestor_key, gen, side)
  SELECT t.sw_key, t.anc, 1, t.side FROM (
    SELECT h.horse_name AS sw_key, h.sire_key AS anc, 'S' AS side
      FROM breeding_horses h
     WHERE (h.s_wins > 0 OR h.g_wins > 0 OR h.g1_wins > 0)
       AND h.sire_key IS NOT NULL AND h.sire_key <> ''
    UNION ALL
    SELECT h.horse_name, h.dam_key, 'D'
      FROM breeding_horses h
     WHERE (h.s_wins > 0 OR h.g_wins > 0 OR h.g1_wins > 0)
       AND h.dam_key IS NOT NULL AND h.dam_key <> ''
  ) AS t`;

/**
 * One generation further out.
 *
 * The derived table is not decoration: MySQL will not read from the table an
 * INSERT is writing to unless the read is materialised first, and wrapping the
 * select in `FROM (…) AS t` is what materialises it. `INSERT IGNORE` against
 * the primary key means an ancestor who appears twice keeps his nearest
 * placement, because the generations are inserted in order.
 */
export const SW_STEP = (table) => `
  INSERT IGNORE INTO ${table} (sw_key, ancestor_key, gen, side)
  SELECT t.sw_key, t.anc, t.gen, t.side FROM (
    SELECT a.sw_key AS sw_key, p.sire_key AS anc, a.gen + 1 AS gen, a.side AS side
      FROM ${table} a JOIN ${PARENTS_TABLE} p ON p.horse_key = a.ancestor_key
     WHERE a.gen = ? AND p.sire_key IS NOT NULL
    UNION ALL
    SELECT a.sw_key, p.dam_key, a.gen + 1, a.side
      FROM ${table} a JOIN ${PARENTS_TABLE} p ON p.horse_key = a.ancestor_key
     WHERE a.gen = ? AND p.dam_key IS NOT NULL
  ) AS t`;

/**
 * Add `dam_key` to the parent map and fill it.
 *
 * Idempotent: the column check is an INFORMATION_SCHEMA read, and both passes
 * only ever fill a blank.
 */
export async function ensureLineageSchema(runQuery, { log = console } = {}) {
  const added = [];
  const columns = await runQuery(
    `SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [PARENTS_TABLE],
  );
  if (!columns.length) return { added, present: false };
  const have = new Set(columns.map((r) => r.name));
  for (const [column, definition] of Object.entries(LINEAGE_COLUMNS)) {
    if (have.has(column)) continue;
    await runQuery(`ALTER TABLE ${PARENTS_TABLE} ADD COLUMN \`${column}\` ${definition}`, []);
    added.push(column);
  }
  for (const [name, definition] of Object.entries(LINEAGE_INDEXES)) {
    const found = await runQuery(
      `SELECT INDEX_NAME AS name FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
      [PARENTS_TABLE, name],
    );
    if (found.length) continue;
    try {
      await runQuery(`ALTER TABLE ${PARENTS_TABLE} ADD INDEX ${name} ${definition}`, []);
      added.push(name);
    } catch (err) {
      if (!/Duplicate key name/i.test(err.message)) throw err;
    }
  }
  if (added.length) log.log?.(`lineage schema: added ${added.join(", ")}`);
  return { added, present: true };
}

/**
 * Fill both parents, then index every stakes winner's first four generations.
 *
 * Built into a `_next` table and renamed in, for the same reason the nick
 * rebuild is: a report that reads the table halfway through a rebuild would
 * find a handful of ancestors per horse and conclude the pedigrees are thin.
 * A rebuild that finds nothing keeps the old table rather than publishing an
 * empty one.
 */
export async function rebuildStakesPedigrees(runQuery, { log = console, depth = SW_DEPTH, pedigreeLinks = true } = {}) {
  const started = Date.now();
  const schema = await ensureLineageSchema(runQuery, { log });
  if (!schema.present) throw new Error(`${PARENTS_TABLE} is not built yet; run the nick rebuild first`);

  for (const pass of LINEAGE_PASSES) {
    try {
      await runQuery(pass.sql, []);
    } catch (err) {
      log.warn?.(`lineage: dam pass '${pass.source}' failed: ${err.message}`);
    }
  }

  if (pedigreeLinks) {
    try {
      const rows = await runQuery("SELECT payload FROM pedigree_cache", []);
      const seen = new Map();
      for (const row of rows) {
        let payload;
        try { payload = JSON.parse(row.payload); } catch { continue; }
        for (const link of pedigreeParents(payload)) {
          const cur = seen.get(link.horse);
          if (!cur) seen.set(link.horse, link);
          else {
            if (!cur.sire && link.sire) cur.sire = link.sire;
            if (!cur.dam && link.dam) cur.dam = link.dam;
          }
        }
      }
      const links = [...seen.values()].filter((l) => l.sire);
      for (let i = 0; i < links.length; i += 400) {
        const chunk = links.slice(i, i + 400);
        await runQuery(
          `INSERT INTO ${PARENTS_TABLE} (horse_key, sire_key, dam_key, sex, source) VALUES ${
            chunk.map(() => "(?, ?, ?, NULL, 'pedigree')").join(", ")
          } ON DUPLICATE KEY UPDATE dam_key = COALESCE(${PARENTS_TABLE}.dam_key, VALUES(dam_key))`,
          chunk.flatMap((l) => [l.horse, l.sire, l.dam]),
        );
      }
      log.log?.(`lineage: ${links.length} parent pairs from cached pedigrees`);
    } catch (err) {
      log.warn?.(`lineage: pedigree pass failed: ${err.message}`);
    }
  }

  const [{ n: dams }] = await runQuery(
    `SELECT COUNT(*) AS n FROM ${PARENTS_TABLE} WHERE dam_key IS NOT NULL`, []);

  const next = `${SW_TABLE}_next`;
  await runQuery(`DROP TABLE IF EXISTS ${next}`, []);
  await runQuery(CREATE_SW_ANCESTORS(next), []);
  await runQuery(SW_SEED(next), []);
  for (let gen = 1; gen < depth; gen += 1) await runQuery(SW_STEP(next), [gen, gen]);

  const [{ n: links }] = await runQuery(`SELECT COUNT(*) AS n FROM ${next}`, []);
  const [{ n: winners }] = await runQuery(`SELECT COUNT(DISTINCT sw_key) AS n FROM ${next}`, []);
  if (!Number(links)) {
    await runQuery(`DROP TABLE IF EXISTS ${next}`, []);
    throw new Error("stakes pedigree rebuild produced no ancestors; keeping the previous table");
  }

  const old = `${SW_TABLE}_old`;
  await runQuery(`DROP TABLE IF EXISTS ${old}`, []);
  const exists = await runQuery(
    `SELECT 1 AS present FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [SW_TABLE],
  );
  await runQuery(
    exists.length
      ? `RENAME TABLE ${SW_TABLE} TO ${old}, ${next} TO ${SW_TABLE}`
      : `RENAME TABLE ${next} TO ${SW_TABLE}`,
    [],
  );
  await runQuery(`DROP TABLE IF EXISTS ${old}`, []);

  const summary = {
    dams: Number(dams ?? 0),
    winners: Number(winners ?? 0),
    links: Number(links ?? 0),
    depth,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  log.log?.(
    `stakes pedigrees rebuilt: ${summary.winners} winners, ${summary.links} ancestor links, ` +
      `${summary.dams} known dams, ${summary.seconds}s`,
  );
  return summary;
}

/** The par rate and a line's own, read off `nick_stats`. */
export const PAR_SQL = `SELECT SUM(runners) AS runners, SUM(stakes_winners) AS sw FROM ${NICKS_TABLE}`;

export const rateOf = (sw, runners) => {
  const r = Number(runners) || 0;
  const s = Number(sw) || 0;
  return r > 0 ? s / r : null;
};
