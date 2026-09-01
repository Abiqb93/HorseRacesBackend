/**
 * Track & distance pars from the two sectional sources the database holds.
 *
 * Two generated tables, rebuilt daily by the cron in server.jsx and served
 * whole like the other generated reports:
 *
 *  - report_track_pars_tf: Timeform's race-level sectionals. One row per
 *    course+distance from winners of flat races in the last five years:
 *    average winning time, average closing sectional, and the finishing
 *    speed the winner's closing sectional represents against their own race
 *    speed. Timeform names the two Newmarket courses itself, so the Rowley
 *    Mile and the July course arrive already split.
 *
 *  - report_track_pars_rtv: Racing TV's per-furlong sectionals. The racingtv
 *    table has no distance column, so a runner's race distance is read as
 *    the furthest furlong column carrying a time; per-furlong averages come
 *    from every runner with sectionals, and n counts distinct races. The
 *    RTV result URLs do not separate the Newmarket courses, so the label is
 *    joined per meeting date from the Timeform rows in APIData_Table2.
 */

const MAX_F = 34;

const q = (db, sql, params = []) =>
  new Promise((resolve, reject) =>
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))),
  );

/* ------------------------------------------------------------------ TF -- */

export async function buildTimeformPars(db) {
  await q(db, `DROP TABLE IF EXISTS report_track_pars_tf_next`);
  await q(db, `
    CREATE TABLE report_track_pars_tf_next AS
    SELECT
      courseName                                        AS track,
      countryCode                                       AS country,
      CAST(distance AS DECIMAL(5,2))                    AS distance_f,
      COUNT(*)                                          AS runs,
      ROUND(AVG(CAST(finishingTime AS DECIMAL(8,2))), 2)     AS avg_win_time,
      ROUND(AVG(CAST(distanceSectional AS DECIMAL(5,2))), 2) AS avg_sec_dist_f,
      ROUND(AVG(CAST(winnerSectional AS DECIMAL(8,2))), 2)   AS avg_closing_sec,
      -- finishing speed %: closing-sectional speed over whole-race speed
      ROUND(AVG(
        (CAST(distanceSectional AS DECIMAL(5,2)) / CAST(winnerSectional AS DECIMAL(8,2)))
        / (CAST(distance AS DECIMAL(5,2)) / CAST(finishingTime AS DECIMAL(8,2))) * 100
      ), 2)                                             AS avg_fsp,
      MIN(meetingDate)                                  AS from_date,
      MAX(meetingDate)                                  AS to_date
    FROM APIData_Table2
    WHERE raceType = 'Flat'
      AND positionOfficial = 1
      AND meetingDate >= DATE_SUB(CURDATE(), INTERVAL 5 YEAR)
      AND finishingTime REGEXP '^[0-9.]+$' AND CAST(finishingTime AS DECIMAL(8,2)) > 0
      AND winnerSectional REGEXP '^[0-9.]+$' AND CAST(winnerSectional AS DECIMAL(8,2)) > 0
      AND distanceSectional REGEXP '^[0-9.]+$' AND CAST(distanceSectional AS DECIMAL(5,2)) > 0
      AND distance REGEXP '^[0-9.]+$' AND CAST(distance AS DECIMAL(5,2)) > 0
      AND (sourceSystem IS NULL OR sourceSystem <> 'FRANCE')
    GROUP BY courseName, countryCode, CAST(distance AS DECIMAL(5,2))
    HAVING COUNT(*) >= 3
  `);
  await q(db, `DROP TABLE IF EXISTS report_track_pars_tf`);
  await q(db, `RENAME TABLE report_track_pars_tf_next TO report_track_pars_tf`);
  const [{ n }] = await q(db, `SELECT COUNT(*) AS n FROM report_track_pars_tf`);
  return { table: "report_track_pars_tf", rows: n };
}

/* ----------------------------------------------------------------- RTV -- */

const parseTotalSeconds = (s) => {
  // "1min, 27.07s" | "58.9s" | "1min, 0.21s"
  if (!s) return null;
  const m = String(s).match(/(?:(\d+)\s*min[s,]*\s*)?([\d.]+)\s*s/i);
  if (!m) return null;
  const secs = (Number(m[1]) || 0) * 60 + Number(m[2]);
  return Number.isFinite(secs) && secs > 0 ? secs : null;
};

const parsePct = (s) => {
  const v = Number(String(s || "").replace("%", ""));
  return Number.isFinite(v) && v > 50 && v < 150 ? v : null;
};

export async function buildRtvPars(db) {
  // The July course label, per meeting date, from Timeform's own rows.
  const julyDates = new Set(
    (
      await q(db, `
        SELECT DISTINCT DATE_FORMAT(meetingDate, '%Y-%m-%d') AS d
        FROM APIData_Table2
        WHERE courseName = 'NEWMARKET (JULY)'
      `)
    ).map((r) => r.d),
  );

  const fCols = Array.from({ length: MAX_F }, (_, i) => `\`${i + 1}f Time\``);
  const rows = await q(db, `
    SELECT Track, Date, RaceURL, Position, \`Total Time\`, \`FSP %\`, ${fCols.join(", ")}
    FROM racingtv
    WHERE \`1f Time\` IS NOT NULL AND \`1f Time\` <> ''
  `);

  const agg = new Map(); // track|dist -> accumulator
  for (const r of rows) {
    const fs = [];
    for (let i = 1; i <= MAX_F; i += 1) {
      const v = Number(r[`${i}f Time`]);
      fs.push(Number.isFinite(v) && v > 4 && v < 60 ? v : null);
    }
    let dist = 0;
    for (let i = MAX_F - 1; i >= 0; i -= 1) if (fs[i] !== null) { dist = i + 1; break; }
    if (dist < 4) continue; // no flat race is shorter than 4f; junk row

    let track = String(r.Track || "").trim();
    if (!track) continue;
    if (/^newmarket$/i.test(track)) {
      const d = String(r.Date || "").slice(0, 10);
      track = julyDates.has(d) ? "Newmarket (July)" : "Newmarket (Rowley)";
    }

    const key = `${track}|${dist}`;
    if (!agg.has(key)) {
      agg.set(key, {
        track, dist, n: 0, races: new Set(),
        fSum: Array(MAX_F).fill(0), fN: Array(MAX_F).fill(0),
        totSum: 0, totN: 0, fspSum: 0, fspN: 0,
        from: null, to: null,
      });
    }
    const a = agg.get(key);
    a.n += 1;
    if (r.RaceURL) a.races.add(r.RaceURL);
    for (let i = 0; i < dist; i += 1) {
      if (fs[i] !== null) { a.fSum[i] += fs[i]; a.fN[i] += 1; }
    }
    const tot = parseTotalSeconds(r["Total Time"]);
    if (tot) { a.totSum += tot; a.totN += 1; }
    const fsp = parsePct(r["FSP %"]);
    if (fsp) { a.fspSum += fsp; a.fspN += 1; }
    const d = String(r.Date || "").slice(0, 10);
    if (d) {
      if (!a.from || d < a.from) a.from = d;
      if (!a.to || d > a.to) a.to = d;
    }
  }

  await q(db, `DROP TABLE IF EXISTS report_track_pars_rtv_next`);
  const fDefs = Array.from({ length: MAX_F }, (_, i) => `\`avg_${i + 1}f_time\` DECIMAL(6,2) NULL`);
  await q(db, `
    CREATE TABLE report_track_pars_rtv_next (
      track VARCHAR(64) NOT NULL,
      distance_f SMALLINT NOT NULL,
      races INT NOT NULL,
      runners INT NOT NULL,
      avg_total_time DECIMAL(7,2) NULL,
      avg_fsp DECIMAL(5,2) NULL,
      from_date DATE NULL,
      to_date DATE NULL,
      ${fDefs.join(",\n      ")}
    )
  `);

  for (const a of agg.values()) {
    if (a.races.size < 3) continue;
    const cols = ["track", "distance_f", "races", "runners", "avg_total_time", "avg_fsp", "from_date", "to_date"];
    const vals = [
      a.track, a.dist, a.races.size, a.n,
      a.totN ? +(a.totSum / a.totN).toFixed(2) : null,
      a.fspN ? +(a.fspSum / a.fspN).toFixed(2) : null,
      a.from, a.to,
    ];
    for (let i = 0; i < a.dist; i += 1) {
      cols.push(`avg_${i + 1}f_time`);
      vals.push(a.fN[i] ? +(a.fSum[i] / a.fN[i]).toFixed(2) : null);
    }
    await q(
      db,
      `INSERT INTO report_track_pars_rtv_next (${cols.map((c) => `\`${c}\``).join(",")})
       VALUES (${cols.map(() => "?").join(",")})`,
      vals,
    );
  }

  await q(db, `DROP TABLE IF EXISTS report_track_pars_rtv`);
  await q(db, `RENAME TABLE report_track_pars_rtv_next TO report_track_pars_rtv`);
  const [{ n }] = await q(db, `SELECT COUNT(*) AS n FROM report_track_pars_rtv`);
  return { table: "report_track_pars_rtv", rows: n, sourceRows: rows.length };
}

export async function rebuildTrackPars(db) {
  const tf = await buildTimeformPars(db);
  const rtv = await buildRtvPars(db);
  return { tf, rtv };
}
