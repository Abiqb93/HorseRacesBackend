/**
 * French trainer statistics and form (26 November 2026: "From all data we hold. Can we generate statistics and
 * performance on French trainers? Don't use timeform as the coverage on france is not good ... Flag which trainers are
 * in form vs. out of form. Like we do for UK and Ireland sales").
 *
 * Off the France Galop and PMU feed alone (sourceSystem = 'FRANCE': Flat, thoroughbreds, runners with a result), which
 * carries no Timeform figure. For each yard over everything held:
 *
 *   runs, wins, places      the record, and the win and place strike rates
 *   ae                      wins over the wins its starting prices expected (each runner's 1/SP, normalised so a
 *                           race's chances sum to one), so 1.00 is par
 *   iv                      its win rate over the population's
 *   prizePerRun             euros won per run, over the runs the feed states prize money for (few: else a dash)
 *   fp                      finish percentile: 1 for a winner, 0 for last, the field's size taken into account
 *
 * and the same over the last 30 days. Form is the last 30 days' finish percentile against the yard's own before them,
 * as a z-score on the population's spread: in form at +1.5 or more, out of form at -1.5 or less, with at least 10
 * runs in the 30 days and 30 before. Tested on 13 weekly cut-offs, August to October 2026: in the 30 days after, the
 * yards flagged in form had runners finish 2.9 points of the field above their own norm and win at 1.10 of their
 * prices' expectation; out of form, 3.6 points below and 0.78; steady, 1.00.
 *
 * The feed starts in September 2025 and is thin from November 2025 to February 2026 and in July 2026: `heldFrom` and
 * the run counts say what a yard's figures rest on.
 */

const TABLE = "report_trainer_form_fr";
export const FORM_DAYS = 30;
export const MIN_RECENT = 10;
export const MIN_BEFORE = 30;
export const Z = 1.5;

const q = (db, sql, params = []) =>
  new Promise((resolve, reject) => db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

/** The yard's name without the feed's "(S)" mark: "FH. GRAFFARD (S)" -> "FH. GRAFFARD". */
export const frenchTrainer = (name) => String(name ?? "").replace(/\s*\(\s*s\s*\)\s*$/i, "").replace(/\s+/g, " ").trim();

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const r = (v, dp) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp);

/** The table's rows from the runs, pure: `runs` are { trainer, date (YYYY-MM-DD), race, pos, runners, sp, prize }. */
export function trainerFormRows(runs, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const valid = runs.filter((x) => x.trainer && x.runners >= 2 && x.pos >= 1);
  // each runner's chance by its starting price, normalised within the race
  const byRace = new Map();
  for (const x of valid) (byRace.get(x.race) || byRace.set(x.race, []).get(x.race)).push(x);
  for (const rs of byRace.values()) {
    const s = rs.reduce((t, x) => t + (x.sp > 1 ? 1 / x.sp : 0), 0);
    for (const x of rs) x.ep = x.sp > 1 && s > 0 ? 1 / x.sp / s : null;
  }
  for (const x of valid) x.fp = 1 - (x.pos - 1) / (x.runners - 1);
  const cut = new Date(Date.parse(today) - FORM_DAYS * 86400000).toISOString().slice(0, 10);
  const winRate = mean(valid.map((x) => (x.pos === 1 ? 1 : 0)));
  const sdFp = Math.sqrt(mean(valid.map((x) => x.fp ** 2)) - mean(valid.map((x) => x.fp)) ** 2);
  const byTrainer = new Map();
  for (const x of valid) (byTrainer.get(x.trainer) || byTrainer.set(x.trainer, []).get(x.trainer)).push(x);
  const rows = [];
  for (const [trainer, rs] of byTrainer) {
    if (rs.length < MIN_RECENT) continue;
    const recent = rs.filter((x) => x.date >= cut);
    const before = rs.filter((x) => x.date < cut);
    const stats = (set) => {
      const wins = set.filter((x) => x.pos === 1).length;
      const exp = set.reduce((t, x) => t + (x.ep ?? 0), 0);
      return {
        runs: set.length, wins, winPct: set.length ? (100 * wins) / set.length : null,
        plcPct: set.length ? (100 * set.filter((x) => x.pos <= 3).length) / set.length : null,
        ae: exp > 0 ? wins / exp : null, fp: mean(set.map((x) => x.fp)),
        // the feed states prize money on few runs: per run over those that state it, else a dash
        prizePerRun: set.some((x) => x.prize !== null) ? mean(set.filter((x) => x.prize !== null).map((x) => x.prize)) : null,
      };
    };
    const all = stats(rs);
    const r30 = stats(recent);
    const b = stats(before);
    let z = null;
    let form = null;
    if (recent.length >= MIN_RECENT && before.length >= MIN_BEFORE && sdFp > 0) {
      z = (r30.fp - b.fp) / (sdFp / Math.sqrt(recent.length));
      form = z >= Z ? "in form" : z <= -Z ? "out of form" : "steady";
    }
    rows.push({
      trainer, heldFrom: rs.map((x) => x.date).sort()[0], lastRun: rs.map((x) => x.date).sort().at(-1),
      runs: all.runs, wins: all.wins, winPct: r(all.winPct, 1), plcPct: r(all.plcPct, 1), ae: r(all.ae, 2),
      iv: r(winRate ? all.wins / all.runs / winRate : null, 2), prizePerRun: r(all.prizePerRun, 0), fp: r(all.fp, 3),
      runs30: r30.runs, wins30: r30.wins, winPct30: r(r30.winPct, 1), plcPct30: r(r30.plcPct, 1), ae30: r(r30.ae, 2),
      fp30: r(r30.fp, 3), fpBefore: r(b.fp, 3), z: r(z, 2), form,
    });
  }
  return rows.sort((a, b2) => b2.runs - a.runs);
}

export async function buildTrainerFormFrance(db, { today } = {}) {
  const raw = await q(db, `
    SELECT trainerFullName, meetingDate, courseName, raceNumber, positionOfficial, numberOfRunners, ispDecimal, prizeMoneyWon
    FROM APIData_Table2
    WHERE sourceSystem = 'FRANCE' AND raceType = 'Flat' AND (breed = 'PS' OR breed IS NULL)
      AND (nonRunner = 0 OR nonRunner IS NULL) AND positionOfficial IS NOT NULL
      AND trainerFullName IS NOT NULL AND trainerFullName <> ''
  `);
  const day = (d) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
  const runs = raw.map((x) => ({
    trainer: frenchTrainer(x.trainerFullName), date: day(x.meetingDate), race: `${day(x.meetingDate)}|${x.courseName}|${x.raceNumber}`,
    pos: Number(x.positionOfficial), runners: Number(x.numberOfRunners), sp: Number(x.ispDecimal) || null, prize: x.prizeMoneyWon === null || x.prizeMoneyWon === undefined ? null : Number(x.prizeMoneyWon),
  }));
  const rows = trainerFormRows(runs, { today });
  await q(db, `DROP TABLE IF EXISTS ${TABLE}_next`);
  await q(db, `CREATE TABLE ${TABLE}_next (
    trainer VARCHAR(255), heldFrom VARCHAR(10), lastRun VARCHAR(10), runs INT, wins INT, winPct DECIMAL(5,1), plcPct DECIMAL(5,1),
    ae DECIMAL(6,2), iv DECIMAL(6,2), prizePerRun INT, fp DECIMAL(5,3), runs30 INT, wins30 INT, winPct30 DECIMAL(5,1),
    plcPct30 DECIMAL(5,1), ae30 DECIMAL(6,2), fp30 DECIMAL(5,3), fpBefore DECIMAL(5,3), z DECIMAL(6,2), form VARCHAR(16))`);
  const cols = ["trainer", "heldFrom", "lastRun", "runs", "wins", "winPct", "plcPct", "ae", "iv", "prizePerRun", "fp", "runs30", "wins30", "winPct30", "plcPct30", "ae30", "fp30", "fpBefore", "z", "form"];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await q(db, `INSERT INTO ${TABLE}_next (${cols.join(",")}) VALUES ${chunk.map(() => `(${cols.map(() => "?").join(",")})`).join(",")}`,
      chunk.flatMap((row) => cols.map((c) => row[c])));
  }
  await q(db, `DROP TABLE IF EXISTS ${TABLE}`);
  await q(db, `RENAME TABLE ${TABLE}_next TO ${TABLE}`);
  const counts = rows.reduce((m, x) => ((m[x.form || "unrated"] = (m[x.form || "unrated"] || 0) + 1), m), {});
  return { table: TABLE, runs: runs.length, rows: rows.length, form: counts };
}
