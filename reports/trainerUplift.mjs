/**
 * Trainer uplift, v2 — does a yard improve or set back the horses it takes on?
 *
 * A move is a change of trainer between consecutive FLAT runs of the same
 * horse (National Hunt runs are ignored entirely: the report is about flat
 * performance on the flat scale). For each move:
 *
 *   baseline   what the horse was rated when it arrived: Timeform's master
 *              rating going into its first run for the new yard where the
 *              feed carries one, otherwise the best of its last three flat
 *              performance ratings for the old yard
 *   afterN     the best flat performance rating inside the first N runs for
 *              the new yard (N = 1, 3, 5, 10)
 *   upliftN    afterN - baseline
 *
 * Dimensions stored per move so the report can cut by them: age and sex at
 * the move, the country and median distance of the first runs for the new
 * yard, and how many runs each yard had.
 *
 * The table is rebuilt in horseCode ranges (POST .../rebuild with
 * {codeFrom, codeTo, init, finalize}) because the source table is far too
 * large to order in one pass; the driver walks the ranges and the finalize
 * call swaps the finished table in atomically.
 */

const MOVES_TABLE = "report_trainer_uplift_moves2";

const q = (db, sql, params = []) =>
  new Promise((resolve, reject) =>
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))),
  );

const validRating = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 10 && n < 200 ? n : null;
};

const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export async function initMoves(db) {
  await q(db, `DROP TABLE IF EXISTS ${MOVES_TABLE}_next`);
  await q(db, `
    CREATE TABLE ${MOVES_TABLE}_next (
      horseName VARCHAR(120),
      horseCode INT,
      moveDate DATE,
      horseAge TINYINT NULL,
      sex VARCHAR(8) NULL,
      country CHAR(3) NULL,
      medianDistF DECIMAL(4,1) NULL,
      fromTrainer VARCHAR(120),
      toTrainer VARCHAR(120),
      runsBefore SMALLINT,
      runsAfter SMALLINT,
      baseline SMALLINT NULL,
      after1 SMALLINT NULL, after3 SMALLINT NULL, after5 SMALLINT NULL, after10 SMALLINT NULL,
      uplift1 SMALLINT NULL, uplift3 SMALLINT NULL, uplift5 SMALLINT NULL, uplift10 SMALLINT NULL,
      INDEX idx_to_trainer (toTrainer),
      INDEX idx_move_date (moveDate)
    )
  `);
  return { ok: true, created: `${MOVES_TABLE}_next` };
}

export async function buildMovesRange(db, codeFrom, codeTo) {
  const rows = await q(db, `
    SELECT horseCode, horseName, meetingDate, trainerFullName,
           performanceRating, preRaceMasterRating,
           countryCode, distance, horseAge, horseGender
    FROM APIData_Table2
    WHERE horseCode BETWEEN ? AND ?
      AND raceType = 'Flat'
      AND trainerFullName IS NOT NULL AND trainerFullName <> ''
    ORDER BY horseCode, meetingDate
  `, [codeFrom, codeTo]);

  const byHorse = new Map();
  for (const r of rows) {
    if (!byHorse.has(r.horseCode)) byHorse.set(r.horseCode, []);
    byHorse.get(r.horseCode).push(r);
  }

  let moves = 0;
  const inserts = [];
  for (const runs of byHorse.values()) {
    for (let i = 1; i < runs.length; i += 1) {
      const prev = runs[i - 1];
      const cur = runs[i];
      if (String(prev.trainerFullName).trim() === String(cur.trainerFullName).trim()) continue;

      const before = runs.slice(0, i).filter((r) => String(r.trainerFullName).trim() === String(prev.trainerFullName).trim());
      const after = [];
      for (let j = i; j < runs.length; j += 1) {
        if (String(runs[j].trainerFullName).trim() !== String(cur.trainerFullName).trim()) break;
        after.push(runs[j]);
      }
      if (!after.length) continue;

      // What the horse was rated on arrival: the master rating going into
      // its first run for the new yard, else the best of its last three
      // flat runs for the old one.
      const lastThree = before.slice(-3).map((r) => validRating(r.performanceRating)).filter((v) => v !== null);
      const base = validRating(cur.preRaceMasterRating) ?? (lastThree.length ? Math.max(...lastThree) : null);
      if (base === null) continue;

      // Best performance inside the first N runs -- null until the horse
      // has actually had N runs for the yard, so a two-run stay never
      // reports a 10-run uplift.
      const aN = (n) => {
        if (after.length < n) return null;
        const v = after.slice(0, n).map((r) => validRating(r.performanceRating)).filter((x) => x !== null);
        return v.length ? Math.max(...v) : null;
      };
      const a1 = aN(1), a3 = aN(3), a5 = aN(5), a10 = aN(10);

      const firstFive = after.slice(0, 5);
      const countries = {};
      for (const r of firstFive) {
        const c = (r.countryCode || "").trim();
        if (c) countries[c] = (countries[c] || 0) + 1;
      }
      const country = Object.entries(countries).sort((x, y) => y[1] - x[1])[0]?.[0] || null;
      const medDist = median(firstFive.map((r) => Number(r.distance)).filter((d) => d > 0 && d < 40));

      inserts.push([
        cur.horseName, cur.horseCode, String(cur.meetingDate).slice(0, 10),
        Number(cur.horseAge) || null, cur.horseGender || null, country,
        medDist, prev.trainerFullName, cur.trainerFullName,
        before.length, after.length, base,
        a1, a3, a5, a10,
        a1 !== null ? a1 - base : null,
        a3 !== null ? a3 - base : null,
        a5 !== null ? a5 - base : null,
        a10 !== null ? a10 - base : null,
      ]);
      moves += 1;
    }
  }

  for (let i = 0; i < inserts.length; i += 200) {
    const chunk = inserts.slice(i, i + 200);
    await q(db, `
      INSERT INTO ${MOVES_TABLE}_next
        (horseName, horseCode, moveDate, horseAge, sex, country, medianDistF,
         fromTrainer, toTrainer, runsBefore, runsAfter, baseline,
         after1, after3, after5, after10, uplift1, uplift3, uplift5, uplift10)
      VALUES ${chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",")}
    `, chunk.flat());
  }

  return { codeFrom, codeTo, sourceRows: rows.length, horses: byHorse.size, moves };
}

export async function finalizeMoves(db) {
  await q(db, `DROP TABLE IF EXISTS ${MOVES_TABLE}`);
  await q(db, `RENAME TABLE ${MOVES_TABLE}_next TO ${MOVES_TABLE}`);
  const [{ n }] = await q(db, `SELECT COUNT(*) AS n FROM ${MOVES_TABLE}`);
  return { table: MOVES_TABLE, rows: n };
}

/**
 * Full rebuild in one process, for the weekly cron: walks the horseCode
 * range in windows so no single query orders millions of rows.
 */
export async function rebuildAll(db, { chunk = 100000, log = () => {} } = {}) {
  const [{ lo, hi }] = await q(db, `
    SELECT MIN(horseCode) AS lo, MAX(horseCode) AS hi
    FROM APIData_Table2 WHERE horseCode IS NOT NULL
  `);
  if (lo === null) return { moves: 0 };
  await initMoves(db);
  let total = 0;
  for (let from = lo; from <= hi; from += chunk) {
    const out = await buildMovesRange(db, from, Math.min(hi, from + chunk - 1));
    total += out.moves;
    log(`trainer-uplift ${from}..${from + chunk - 1}: +${out.moves} moves (${total})`);
  }
  return { ...(await finalizeMoves(db)), moves: total };
}

/* ---------------------------------------------------------- querying -- */

const FILTERS = (query) => {
  const where = [];
  const params = [];
  if (query.country) { where.push("country = ?"); params.push(String(query.country).toUpperCase()); }
  if (query.sex) {
    const sexes = String(query.sex).toLowerCase().split(",").filter(Boolean);
    if (sexes.length) { where.push(`LOWER(sex) IN (${sexes.map(() => "?").join(",")})`); params.push(...sexes); }
  }
  const ageMin = Number(query.ageMin), ageMax = Number(query.ageMax);
  if (Number.isFinite(ageMin)) { where.push("horseAge >= ?"); params.push(ageMin); }
  if (Number.isFinite(ageMax)) { where.push("horseAge <= ?"); params.push(ageMax); }
  const dMin = Number(query.distMin), dMax = Number(query.distMax);
  if (Number.isFinite(dMin)) { where.push("medianDistF >= ?"); params.push(dMin); }
  if (Number.isFinite(dMax)) { where.push("medianDistF <= ?"); params.push(dMax); }
  if (query.since) { where.push("moveDate >= ?"); params.push(String(query.since)); }
  if (query.trainer) { where.push("toTrainer = ?"); params.push(String(query.trainer)); }
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
};

export async function summary(db, query) {
  const { where, params } = FILTERS(query);
  const rows = await q(db, `
    SELECT
      toTrainer AS trainer,
      COUNT(*) AS moves,
      ROUND(AVG(baseline), 1) AS avgBaseline,
      ROUND(AVG(uplift1), 2) AS avgUplift1,   SUM(uplift1 IS NOT NULL) AS n1,
      ROUND(AVG(uplift3), 2) AS avgUplift3,   SUM(uplift3 IS NOT NULL) AS n3,
      ROUND(AVG(uplift5), 2) AS avgUplift5,   SUM(uplift5 IS NOT NULL) AS n5,
      ROUND(AVG(uplift10), 2) AS avgUplift10, SUM(uplift10 IS NOT NULL) AS n10,
      ROUND(AVG(CASE WHEN uplift5 IS NOT NULL THEN uplift5 > 0 END), 3) AS pctImproved5,
      ROUND(AVG(CASE WHEN uplift3 IS NOT NULL THEN uplift3 > 0 END), 3) AS pctImproved3
    FROM ${MOVES_TABLE}
    ${where}
    GROUP BY toTrainer
    HAVING COUNT(*) >= ?
  `, [...params, Math.max(1, Number(query.minMoves) || 5)]);

  // Composite 0-100. Each horizon's mean uplift is shrunk toward zero by its
  // sample size (an empirical-Bayes style k=8 prior: 4 moves count half),
  // blended with fixed weights that favour the medium horizons where the
  // signal is most stable, then percentile-ranked across the trainers the
  // filter kept.
  const K = 8;
  const W = { u1: 0.15, u3: 0.3, u5: 0.35, u10: 0.2 };
  for (const r of rows) {
    const sh = (avg, n) => (avg === null || !n ? null : (Number(avg) * n) / (n + K));
    const parts = [
      [sh(r.avgUplift1, r.n1), W.u1],
      [sh(r.avgUplift3, r.n3), W.u3],
      [sh(r.avgUplift5, r.n5), W.u5],
      [sh(r.avgUplift10, r.n10), W.u10],
    ].filter(([v]) => v !== null);
    const wSum = parts.reduce((a, [, w]) => a + w, 0);
    r.scoreRaw = wSum ? +(parts.reduce((a, [v, w]) => a + v * w, 0) / wSum).toFixed(3) : null;
  }
  const ranked = rows.filter((r) => r.scoreRaw !== null).sort((a, b) => a.scoreRaw - b.scoreRaw);
  ranked.forEach((r, i) => {
    r.upliftScore = Math.round((i / Math.max(1, ranked.length - 1)) * 100);
  });
  return rows.sort((a, b) => (b.upliftScore ?? -1) - (a.upliftScore ?? -1));
}

export async function moves(db, query) {
  const { where, params } = FILTERS(query);
  return q(db, `
    SELECT * FROM ${MOVES_TABLE}
    ${where}
    ORDER BY moveDate DESC
    LIMIT 2000
  `, params);
}
