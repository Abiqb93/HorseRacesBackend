/**
 * Track & distance pars from the sectional sources the database holds.
 *
 * Generated tables, rebuilt daily by the cron in server.jsx and served
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
 *
 *  - report_track_pars_atr / report_track_pars_atr_going: At The Races'
 *    per-segment sectionals (attheraces), one row per British course and
 *    exact distance, the second also per going, in the segment columns ATR
 *    itself uses (Start-5f, 5f-4f ... 1f-Finish); Newmarket is split into
 *    its Rowley Mile and July courses by month. See buildAtrPars.
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

/* ----------------------------------------------------------------- ATR -- */

// Every sectional segment column the attheraces table carries, in the order
// the site's "Finishing Speed % : Track and Distance Pars" sheet lists them.
// Furlong segments count down to the line (Start-5f, 5f-4f ... 1f-Finish);
// the metre ones are the overseas tracks' labels and stay for completeness.
export const ATR_SEGMENTS = [
  "Start-5f", "5f-4f", "4f-3f", "3f-2f", "2f-1f", "1f-Finish", "Start-4f", "Start-6f", "6f-5f", "Start-9f", "9f-8f", "8f-7f", "7f-6f",
  "Start-7f", "Start-14f", "14f-13f", "13f-12f", "12f-11f", "11f-10f", "10f-9f", "Start-8f", "Start-13f", "Start-11f", "Start-10f",
  "Start-12f", "12f-8f", "8f-6f", "6f-4f", "4f-2f", "Start-20f", "20f-16f", "16f-12f", "Start-24f", "24f-20f", "Start-16f", "Start-15f",
  "15f-14f", "Start-1f", "Start-18f", "18f-17f", "17f-16f", "16f-15f", "3f-1f", "Start-17f", "Start-19f", "19f-18f", "9f-7f",
  "Start-1800m", "1800m-1600m", "1600m-1400m", "1400m-1200m", "1200m-1000m", "1000m-800m", "800m-600m", "600m-400m", "400m-200m",
  "200m-Finish", "Start-1000m", "Start-1200m", "Start-1400m", "Start-800m", "Start-1600m", "Start-2200m", "2200m-2000m", "2000m-1800m",
  "Start-2600m", "2600m-2400m", "2400m-2200m", "Start-2000m", "Start-3000m", "3000m-2800m", "2800m-2600m", "5f-3f", "Start-21f",
  "21f-20f", "20f-19f", "7f-5f", "6f-3f", "Start-3f", "11f-9f", "1000m-600m",
];

/** "7f 213y" -> 7.97, "1m (Str)" -> 8, "2m 4f 110y" -> 20.5 */
export const distanceToFurlongs = (label) => {
  const m = String(label || "").match(/(?:(\d+)m\b)?\s*(?:(\d+)f\b)?\s*(?:(\d+)y\b)?/);
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  const f = Number(m[1] || 0) * 8 + Number(m[2] || 0) + Number(m[3] || 0) / 220;
  return f > 0 ? Math.round(f * 100) / 100 : null;
};

/**
 * At The Races per-segment pars: one row per British course and exact race
 * distance (and, in the second table, per going as ATR reports it), from
 * every runner ATR timed. A segment cell can carry a position tag after the
 * time ("68.81 Rear"), so the leading number is what is averaged; blanks and
 * anything non-numeric drop out of the average rather than pulling it to zero.
 * British courses only, as the sheet has always had it: ATR labels every
 * overseas track with its country in brackets.
 */
export async function buildAtrPars(db) {
  const segAvg = ATR_SEGMENTS.map(
    (s) => `ROUND(AVG(NULLIF(CAST(SUBSTRING_INDEX(\`${s}\`, ' ', 1) AS DECIMAL(9,3)), 0)), 4) AS \`avg_${s}\``,
  ).join(",\n      ");
  const hasTime = ATR_SEGMENTS.filter((s) => /Finish$/.test(s)).map((s) => `(\`${s}\` IS NOT NULL AND \`${s}\` <> '')`).join(" OR ");
  const build = async (name, withGoing) => {
    await q(db, `DROP TABLE IF EXISTS ${name}_next`);
    // ATR calls both Newmarket courses "Newmarket"; the July course hosts every
    // meeting from late June to the end of August, the Rowley Mile the rest
    const track = `CASE WHEN TRIM(Racename) = 'Newmarket'
        THEN IF(MONTH(STR_TO_DATE(Date, '%d-%m-%Y')) BETWEEN 6 AND 8, 'Newmarket (July)', 'Newmarket (Rowley)')
        ELSE TRIM(Racename) END`;
    await q(db, `
      CREATE TABLE ${name}_next AS
      SELECT
        ${track}                                                        AS track,
        NULL                                                            AS distance_f,
        ${withGoing ? "TRIM(Ground) AS going," : ""}
        ROUND(AVG(NULLIF(CAST(\`Horse Finish %\` AS DECIMAL(6,2)), 0)), 2)  AS avg_fsp,
        COUNT(*)                                                        AS runs,
        MIN(STR_TO_DATE(Date, '%d-%m-%Y'))                              AS from_date,
        MAX(STR_TO_DATE(Date, '%d-%m-%Y'))                              AS to_date,
        ${segAvg},
        TRIM(Distance)                                                  AS distance
      FROM attheraces
      WHERE Racename IS NOT NULL AND Racename NOT LIKE '%(%'
        AND Distance IS NOT NULL AND Distance <> ''
        ${withGoing ? "AND Ground IS NOT NULL AND Ground <> ''" : ""}
        AND (${hasTime})
      GROUP BY ${track}, TRIM(Distance)${withGoing ? ", TRIM(Ground)" : ""}
    `);
    await q(db, `ALTER TABLE ${name}_next MODIFY distance_f DECIMAL(6,2) NULL`);
    const labels = await q(db, `SELECT DISTINCT distance FROM ${name}_next`);
    for (const { distance } of labels) {
      await q(db, `UPDATE ${name}_next SET distance_f = ? WHERE distance = ?`, [distanceToFurlongs(distance), distance]);
    }
    await q(db, `DELETE FROM ${name}_next WHERE distance_f IS NULL`);
    await q(db, `DROP TABLE IF EXISTS ${name}`);
    await q(db, `RENAME TABLE ${name}_next TO ${name}`);
    const [{ n }] = await q(db, `SELECT COUNT(*) AS n FROM ${name}`);
    return { table: name, rows: n };
  };
  const all = await build("report_track_pars_atr", false);
  const going = await build("report_track_pars_atr_going", true);
  return { all, going };
}

export async function rebuildTrackPars(db) {
  const tf = await buildTimeformPars(db);
  const rtv = await buildRtvPars(db);
  const atr = await buildAtrPars(db);
  return { tf, rtv, atr };
}
