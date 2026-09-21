/**
 * Nicks, from our own data.
 *
 * A nick is the oldest question in breeding: this stallion, over mares by
 * that one — has it worked? The desk's own reports answer it in a fixed
 * idiom, three figures at a time:
 *
 *   "Frankel / Kingman direct cross 9 runners including SW SAND GAZELLE"
 *   "Frankel / Kingman more generally 4 SW from 40 runners"
 *   "Galileo / Kingman generally 26 SW including G1Ws"
 *
 * Those three are the same computation at three widths: the exact cross, the
 * stallion against the damsire's whole sire line, and the stallion's sire
 * line against the damsire's. All of them come out of `breeding_horses`, the
 * worldwide file of every horse that has raced from the 2014 crop on.
 *
 * ## The damsire is not a column
 *
 * `breeding_horses` names a horse's sire and dam and nothing further back, so
 * the damsire has to be found the way a stud book finds it: the dam is a
 * horse, and her sire is on her own row. `/api/breeding/mating` already does
 * this per request for one stallion's runners. Doing it for every cross at
 * once needs the map built once, which is `horse_parents`.
 *
 * `horse_parents` draws on three sources in order of trust — our results
 * table first (it names dams that raced in Britain, Ireland and France,
 * including ones foaled long before 2014), then the worldwide file, then the
 * cached pedigrees, which know the dams of horses that never ran anywhere we
 * cover. `INSERT IGNORE` keeps the first writer, so the order is the ranking.
 *
 * ## What these figures are not
 *
 * They count **runners, not foals**. The file holds horses that raced; a foal
 * that never got to the track is not in it, and neither is one still too
 * young. So "4 SWs from 40 runners" is a different denominator from Arion's
 * "4 SWs from 40 foals" and will read a point or two higher. Every figure
 * therefore travels with `basis: "runners"` and the crop range it was drawn
 * from, and the report prints both.
 *
 * They also stop at the 2014 crop. A sire whose best years were the 2000s —
 * Galileo, Danehill, Sadler's Wells — shows only the tail of his record here.
 * `coverage` says what share of a stallion's runners have a known damsire at
 * all, because a cross computed over the third of his runners whose dams we
 * can name is a floor, not a measurement, and a floor presented as a
 * measurement is the failure this module exists to avoid.
 */

export const PARENTS_TABLE = "horse_parents";
export const NICKS_TABLE = "nick_stats";

export const CREATE_PARENTS = `
  CREATE TABLE IF NOT EXISTS ${PARENTS_TABLE} (
    horse_key VARCHAR(80) NOT NULL PRIMARY KEY,
    sire_key  VARCHAR(80) NOT NULL,
    sex CHAR(1) NULL,
    source VARCHAR(12) NOT NULL,
    KEY idx_hp_sire (sire_key)
  )`;

export const CREATE_NICKS = (table = NICKS_TABLE) => `
  CREATE TABLE IF NOT EXISTS ${table} (
    sire_key VARCHAR(80) NOT NULL,
    damsire_key VARCHAR(80) NOT NULL,
    runners INT NOT NULL,
    winners INT NOT NULL,
    stakes_winners INT NOT NULL,
    group_winners INT NOT NULL,
    g1_winners INT NOT NULL,
    black_type INT NOT NULL,
    sw_pct DECIMAL(5,2) NULL,
    crop_from SMALLINT NULL,
    crop_to SMALLINT NULL,
    PRIMARY KEY (sire_key, damsire_key),
    KEY idx_ns_damsire (damsire_key)
  )`;

/** One cross, as a key. Both sides normalised so a lookup cannot miss on a suffix. */
export const crossKey = (sire, damsire) =>
  `${studKey(sire)}|${studKey(damsire)}`;

/** The stud-book form of a name: no sigil, no country, upper case. */
export const studKey = (raw) =>
  String(raw ?? "")
    .trim()
    .replace(/^[*=$]+/, "")
    .replace(/\s*\([A-Za-z]{2,3}\)\s*$/, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

/* ------------------------------------------------------------- the rebuild */

/**
 * The three passes that fill `horse_parents`, in order of trust.
 *
 * Every one is an INSERT IGNORE, so a horse named by the results table keeps
 * that answer even when the worldwide file disagrees; `source` records which
 * pass wrote the row, so a disagreement can be found later.
 */
export const PARENT_PASSES = [
  {
    source: "results",
    sql: `INSERT IGNORE INTO ${PARENTS_TABLE} (horse_key, sire_key, sex, source)
          SELECT UPPER(TRIM(horseName)), UPPER(TRIM(MAX(sireName))), MAX(horseGender), 'results'
            FROM APIData_Table2
           WHERE sireName IS NOT NULL AND sireName <> '' AND horseName IS NOT NULL
           GROUP BY horseName`,
  },
  {
    source: "worldwide",
    sql: `INSERT IGNORE INTO ${PARENTS_TABLE} (horse_key, sire_key, sex, source)
          SELECT horse_name, MAX(sire_key), MAX(sex), 'worldwide'
            FROM breeding_horses
           WHERE sire_key IS NOT NULL AND sire_key <> ''
           GROUP BY horse_name`,
  },
];

/**
 * Every (horse → sire) link a cached pedigree carries.
 *
 * An ancestor at path P and one at P+"S" are a horse and his sire, five
 * generations deep, for horses that may never have raced. A hole yields no
 * link rather than a wrong one: the ancestor below a gap is not the gap's
 * child.
 */
export function parentLinksFromPedigree(payload) {
  const at = new Map();
  for (const a of payload?.ancestors ?? []) {
    const path = String(a?.path ?? "");
    if (!/^[SD]{1,5}$/.test(path)) continue;
    const name = studKey(a?.display_name ?? a?.name);
    if (name) at.set(path, name);
  }
  const horse = studKey(payload?.horse?.name);
  const links = [];
  if (horse && at.has("S")) links.push({ horse, sire: at.get("S") });
  for (const [path, name] of at) {
    const sire = at.get(`${path}S`);
    if (sire) links.push({ horse: name, sire });
  }
  // A horse's own sex is only known for the subject; an ancestor's is implied
  // by its path — the last step of "SD" is a dam, so that horse is female.
  return links.map((l, i) => ({ ...l, sex: null }));
}

/** The aggregate over `breeding_horses`, joined through the parent map. */
export const NICK_AGGREGATE = (into) => `
  INSERT INTO ${into}
    (sire_key, damsire_key, runners, winners, stakes_winners, group_winners, g1_winners,
     black_type, sw_pct, crop_from, crop_to)
  SELECT h.sire_key, p.sire_key,
         COUNT(*),
         SUM(COALESCE(h.turf_wins, 0) + COALESCE(h.aw_wins, 0) > 0),
         SUM(h.s_wins > 0 OR h.g_wins > 0 OR h.g1_wins > 0),
         SUM(h.g_wins > 0 OR h.g1_wins > 0),
         SUM(h.g1_wins > 0),
         SUM(h.s_wins > 0 OR h.g_wins > 0 OR h.g1_wins > 0 OR h.s_top3 > 0 OR h.g_top3 > 0),
         ROUND(100 * SUM(h.s_wins > 0 OR h.g_wins > 0 OR h.g1_wins > 0) / COUNT(*), 2),
         MIN(h.foaling_year), MAX(h.foaling_year)
    FROM breeding_horses h
    JOIN ${PARENTS_TABLE} p ON p.horse_key = h.dam_key
   WHERE h.sire_key IS NOT NULL AND h.sire_key <> ''
   GROUP BY h.sire_key, p.sire_key`;

/**
 * Rebuild both tables.
 *
 * Built into `_next` and renamed in, so a read during the rebuild sees the
 * last complete answer rather than a table filling up — the same trap the
 * worldwide population guard exists for, where a partially loaded table
 * looked like a population with a 15% stakes-winner rate.
 */
export async function rebuildNickStats(runQuery, { log = console, pedigreeLinks = true } = {}) {
  const started = Date.now();
  await runQuery(CREATE_PARENTS, []);

  const before = await runQuery(`SELECT COUNT(*) AS n FROM ${PARENTS_TABLE}`, []);
  for (const pass of PARENT_PASSES) {
    try {
      await runQuery(pass.sql, []);
    } catch (err) {
      log.warn?.(`nick stats: parent pass '${pass.source}' failed: ${err.message}`);
    }
  }

  if (pedigreeLinks) {
    try {
      const rows = await runQuery("SELECT payload FROM pedigree_cache", []);
      const seen = new Map();
      for (const row of rows) {
        let payload;
        try { payload = JSON.parse(row.payload); } catch { continue; }
        for (const link of parentLinksFromPedigree(payload)) {
          if (!seen.has(link.horse)) seen.set(link.horse, link.sire);
        }
      }
      const links = [...seen.entries()];
      for (let i = 0; i < links.length; i += 500) {
        const chunk = links.slice(i, i + 500);
        await runQuery(
          `INSERT IGNORE INTO ${PARENTS_TABLE} (horse_key, sire_key, sex, source) VALUES ${
            chunk.map(() => "(?, ?, NULL, 'pedigree')").join(", ")
          }`,
          chunk.flat(),
        );
      }
      log.log?.(`nick stats: ${links.length} parent links from cached pedigrees`);
    } catch (err) {
      log.warn?.(`nick stats: pedigree pass failed: ${err.message}`);
    }
  }

  const after = await runQuery(`SELECT COUNT(*) AS n FROM ${PARENTS_TABLE}`, []);

  const next = `${NICKS_TABLE}_next`;
  await runQuery(`DROP TABLE IF EXISTS ${next}`, []);
  await runQuery(CREATE_NICKS(next), []);
  await runQuery(NICK_AGGREGATE(next), []);
  const [{ n: crosses }] = await runQuery(`SELECT COUNT(*) AS n FROM ${next}`, []);

  // A rebuild that found nothing is a broken rebuild, not an empty world; the
  // old table stays.
  if (!Number(crosses)) {
    await runQuery(`DROP TABLE IF EXISTS ${next}`, []);
    throw new Error("nick rebuild produced no crosses; keeping the previous table");
  }

  const old = `${NICKS_TABLE}_old`;
  await runQuery(`DROP TABLE IF EXISTS ${old}`, []);
  const exists = await runQuery(
    `SELECT 1 AS present FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [NICKS_TABLE],
  );
  await runQuery(
    exists.length
      ? `RENAME TABLE ${NICKS_TABLE} TO ${old}, ${next} TO ${NICKS_TABLE}`
      : `RENAME TABLE ${next} TO ${NICKS_TABLE}`,
    [],
  );
  await runQuery(`DROP TABLE IF EXISTS ${old}`, []);

  const summary = {
    parents: Number(after?.[0]?.n ?? 0),
    parentsAdded: Number(after?.[0]?.n ?? 0) - Number(before?.[0]?.n ?? 0),
    crosses: Number(crosses),
    seconds: Math.round((Date.now() - started) / 1000),
  };
  log.log?.(
    `nick stats rebuilt: ${summary.crosses} crosses from ${summary.parents} known parents in ${summary.seconds}s`,
  );
  return summary;
}

/* ---------------------------------------------------------------- reading */

const int = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * One cross's figures, as a report reads them.
 *
 * `swPct` is null rather than 0 when there are no runners: a cross nobody has
 * tried and a cross that has failed are different answers, and a zero would
 * read as the second.
 */
export function describeCross(rows = [], { sire = null, damsire = null, basis = "runners" } = {}) {
  const totals = rows.reduce(
    (a, r) => ({
      runners: a.runners + int(r.runners),
      winners: a.winners + int(r.winners),
      stakesWinners: a.stakesWinners + int(r.stakes_winners),
      groupWinners: a.groupWinners + int(r.group_winners),
      g1Winners: a.g1Winners + int(r.g1_winners),
      blackType: a.blackType + int(r.black_type),
      cropFrom: Math.min(a.cropFrom, int(r.crop_from) || Infinity),
      cropTo: Math.max(a.cropTo, int(r.crop_to) || -Infinity),
    }),
    { runners: 0, winners: 0, stakesWinners: 0, groupWinners: 0, g1Winners: 0, blackType: 0, cropFrom: Infinity, cropTo: -Infinity },
  );
  return {
    sire: sire ? studKey(sire) : null,
    damsire: damsire ? studKey(damsire) : null,
    runners: totals.runners,
    winners: totals.winners,
    stakesWinners: totals.stakesWinners,
    groupWinners: totals.groupWinners,
    g1Winners: totals.g1Winners,
    blackType: totals.blackType,
    swPct: totals.runners ? Number(((100 * totals.stakesWinners) / totals.runners).toFixed(1)) : null,
    basis,
    cropFrom: Number.isFinite(totals.cropFrom) ? totals.cropFrom : null,
    cropTo: Number.isFinite(totals.cropTo) ? totals.cropTo : null,
    sources: rows.length,
  };
}

/**
 * A sire line: the horse, and the sons of him who stand as sires themselves.
 *
 * One generation, not the whole male line. "Galileo / Kingman generally" in
 * the desk's report means Galileo and his sons over Kingman-line mares, and
 * widening it to every descendant would fold in half the stud book.
 */
export function sireLine(root, parents = new Map()) {
  const key = studKey(root);
  if (!key) return [];
  const out = new Set([key]);
  for (const [horse, sire] of parents) {
    if (studKey(sire) === key) out.add(studKey(horse));
  }
  return [...out];
}

/** What the reader must be told about every figure above. */
export function thinnessNotes({ coverage = null, cropFrom = null, cropTo = null } = {}) {
  const notes = [
    "Counted over horses that have raced, not foals — a strike rate here has a smaller denominator than a foal-based one and reads higher.",
  ];
  if (cropFrom && cropTo) notes.push(`Crops ${cropFrom} to ${cropTo} only; a stallion's earlier runners are not in this file.`);
  if (coverage != null) {
    notes.push(
      coverage >= 0.9
        ? `Damsire known for ${Math.round(coverage * 100)}% of his runners.`
        : `Damsire known for only ${Math.round(coverage * 100)}% of his runners, so these counts are a floor.`,
    );
  }
  return notes;
}
