/**
 * Trainer form — is the yard hot or cold right now, against its own normal?
 *
 * For each UK/IRE flat trainer, three rolling windows over their most recent
 * runs (last 25 / 300 / 1000, within the last five years):
 *
 *   rtf   run-to-form: mean of (performanceRating - preRaceMasterRating),
 *         i.e. how far each run lands from the horse's own rating going in.
 *         Almost every yard is negative on average (most runs are below a
 *         horse's best); what matters is the 25-run window against the
 *         1000-run baseline — a yard well below its own norm is out of form.
 *   srPlc placed strike rate (first three home), percent
 *   iv    impact value: the yard's win rate over the win rate of the whole
 *         population in the same five years, so 1.0 = par
 *
 * One generated table, rebuilt daily with the track pars. The idea comes
 * from the racing2 platform's Trainer Ratings export; the windows and the
 * three measures are kept, computed fresh from the results table.
 */

const TABLE = "report_trainer_form";

const q = (db, sql, params = []) =>
  new Promise((resolve, reject) =>
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))),
  );

export async function buildTrainerForm(db) {
  const [{ overallWinRate }] = await q(db, `
    SELECT AVG(positionOfficial = 1) AS overallWinRate
    FROM APIData_Table2
    WHERE raceType = 'Flat'
      AND countryCode IN ('GBR','IRE')
      AND meetingDate >= DATE_SUB(CURDATE(), INTERVAL 5 YEAR)
      AND positionOfficial IS NOT NULL
  `);

  await q(db, `DROP TABLE IF EXISTS ${TABLE}_next`);
  await q(db, `
    CREATE TABLE ${TABLE}_next AS
    WITH runs AS (
      SELECT
        trainerFullName AS trainer,
        positionOfficial AS pos,
        CASE WHEN performanceRating REGEXP '^[0-9.]+$' AND preRaceMasterRating REGEXP '^[0-9.]+$'
                  AND CAST(performanceRating AS DECIMAL(6,1)) BETWEEN 10 AND 199
                  AND CAST(preRaceMasterRating AS DECIMAL(6,1)) BETWEEN 10 AND 199
             THEN CAST(performanceRating AS DECIMAL(6,1)) - CAST(preRaceMasterRating AS DECIMAL(6,1))
             END AS rtf,
        ROW_NUMBER() OVER (PARTITION BY trainerFullName ORDER BY meetingDate DESC) AS rn
      FROM APIData_Table2
      WHERE raceType = 'Flat'
        AND countryCode IN ('GBR','IRE')
        AND meetingDate >= DATE_SUB(CURDATE(), INTERVAL 5 YEAR)
        AND trainerFullName IS NOT NULL AND trainerFullName <> ''
        AND positionOfficial IS NOT NULL
    )
    SELECT
      trainer,
      COUNT(*) AS runs5y,
      ROUND(AVG(CASE WHEN rn <= 25 THEN rtf END), 1)    AS rtf25,
      ROUND(AVG(CASE WHEN rn <= 300 THEN rtf END), 1)   AS rtf300,
      ROUND(AVG(CASE WHEN rn <= 1000 THEN rtf END), 1)  AS rtf1000,
      ROUND(100 * AVG(CASE WHEN rn <= 25 THEN pos <= 3 END), 1)   AS srPlc25,
      ROUND(100 * AVG(CASE WHEN rn <= 300 THEN pos <= 3 END), 1)  AS srPlc300,
      ROUND(100 * AVG(CASE WHEN rn <= 1000 THEN pos <= 3 END), 1) AS srPlc1000,
      ROUND(AVG(CASE WHEN rn <= 25 THEN pos = 1 END) / ${Number(overallWinRate)}, 2)   AS iv25,
      ROUND(AVG(CASE WHEN rn <= 300 THEN pos = 1 END) / ${Number(overallWinRate)}, 2)  AS iv300,
      ROUND(AVG(CASE WHEN rn <= 1000 THEN pos = 1 END) / ${Number(overallWinRate)}, 2) AS iv1000
    FROM runs
    GROUP BY trainer
    HAVING COUNT(*) >= 25
  `);
  await q(db, `DROP TABLE IF EXISTS ${TABLE}`);
  await q(db, `RENAME TABLE ${TABLE}_next TO ${TABLE}`);
  const [{ n }] = await q(db, `SELECT COUNT(*) AS n FROM ${TABLE}`);
  return { table: TABLE, rows: n, overallWinRate: Number(overallWinRate) };
}
