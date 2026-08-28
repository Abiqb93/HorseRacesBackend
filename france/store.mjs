/**
 * MySQL storage for French racing.
 *
 * This replaces the SQLite store the standalone prototype used. It writes into
 * the same database the rest of the platform reads, which is the whole point:
 * French form is only useful once it sits beside the Timeform form in
 * APIData_Table2, where the horse, sire and dam pages already look for it.
 *
 * Two rules govern everything here, because this database holds years of form
 * that nothing else can reproduce:
 *
 *   1. French rows are always tagged. Every row promoted into APIData_Table2
 *      carries sourceSystem = 'FRANCE' plus the identifiers it came from, so
 *      the entire feed can be found, audited or deleted without touching a
 *      single Timeform row.
 *
 *   2. Re-running a day corrects it rather than duplicating it. Promotion
 *      deletes that race's French rows and re-inserts them, scoped by
 *      sourceSystem, so a second pass over an amended result converges instead
 *      of stacking. French results are amended after the fact -- non-runners,
 *      disqualifications, stewards' decisions -- so re-running is normal, not
 *      exceptional.
 *
 * Column names in APIData_Table2 are discovered at runtime rather than
 * hardcoded. The table has grown over years and this module has no business
 * asserting what is in it; it writes the intersection of what it knows and
 * what is actually there, and reports the fields it had to drop.
 */

import mysql from "mysql2/promise";

/** Tables this module owns outright and may create. */
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS fr_raw_race (
     id            BIGINT AUTO_INCREMENT PRIMARY KEY,
     source        ENUM('FG','PMU','MERGED') NOT NULL,
     meeting_date  DATE NOT NULL,
     course_name   VARCHAR(80) NOT NULL,
     race_number   SMALLINT NULL,
     race_code     VARCHAR(64) NULL,
     payload       JSON NOT NULL,
     fetched_at    DATETIME NOT NULL,
     UNIQUE KEY uq_fr_raw_race (source, meeting_date, course_name, race_number),
     KEY idx_fr_raw_race_date (meeting_date)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS fr_raw_runner (
     id            BIGINT AUTO_INCREMENT PRIMARY KEY,
     raw_race_id   BIGINT NOT NULL,
     source        ENUM('FG','PMU','MERGED') NOT NULL,
     cloth_number  SMALLINT NULL,
     horse_name    VARCHAR(120) NOT NULL,
     pmu_id_cheval VARCHAR(160) NULL,
     payload       JSON NOT NULL,
     UNIQUE KEY uq_fr_raw_runner (raw_race_id, cloth_number, horse_name),
     KEY idx_fr_raw_runner_name (horse_name)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS fr_course_registry (
     course_name   VARCHAR(80) PRIMARY KEY,
     course_code   VARCHAR(64) NOT NULL,
     last_seen     DATE NOT NULL
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS fr_match_review (
     id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
     horse_name           VARCHAR(120) NOT NULL,
     meeting_date         DATE NULL,
     incoming             JSON NOT NULL,
     candidate_horse_code BIGINT NULL,
     score                INT NULL,
     max_score            INT NULL,
     evidence             JSON NULL,
     reason               VARCHAR(255) NULL,
     status               ENUM('pending','linked','created','rejected') NOT NULL DEFAULT 'pending',
     created_at           DATETIME NOT NULL,
     decided_by           VARCHAR(64) NULL,
     decided_at           DATETIME NULL,
     KEY idx_fr_review_status (status),
     KEY idx_fr_review_name (horse_name)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS fr_ingest_run (
     id            BIGINT AUTO_INCREMENT PRIMARY KEY,
     target        VARCHAR(32) NOT NULL,
     started_at    DATETIME NOT NULL,
     finished_at   DATETIME NULL,
     ok            TINYINT(1) NOT NULL DEFAULT 0,
     stats         JSON NULL,
     error         TEXT NULL,
     KEY idx_fr_run_started (started_at)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

/**
 * The columns France needs on APIData_Table2. Without raceCountry there is no
 * way to ask for French racing except by guessing from courseName; without
 * sourceSystem there is no way to separate this feed from Timeform again.
 */
export const REQUIRED_API_COLUMNS = {
  raceCountry: "CHAR(3) NULL",
  sourceSystem: "VARCHAR(16) NULL",
  sourceRaceId: "VARCHAR(64) NULL",
  sourceHorseId: "VARCHAR(160) NULL",
};

export const FRANCE_SOURCE = "FRANCE";

/**
 * A pool of its own rather than the callback-style `mysql` pool server.jsx
 * uses, because everything here is async/await. Same credentials, same
 * database -- only the driver differs.
 */
export function createFrancePool() {
  // Only the three credentials are genuinely required. The database name is
  // not a secret and Railway does not set it, so default it exactly as the
  // main pool in server.jsx does -- demanding it here is what left every
  // France route erroring on a service that was otherwise healthy.
  const missing = ["DB_HOST", "DB_USER", "DB_PASSWORD"].filter((n) => !process.env[n]);
  if (missing.length) {
    throw new Error(
      `France ingestion needs database environment variable(s): ${missing.join(", ")}`,
    );
  }
  return mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "horseprofileshub",
    port: Number(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit: Number(process.env.FRANCE_DB_CONNECTION_LIMIT) || 4,
    charset: "utf8mb4",
  });
}

let sharedPool = null;
export function francePool() {
  if (!sharedPool) sharedPool = createFrancePool();
  return sharedPool;
}

const isoOf = (value) => String(value ?? "").slice(0, 10) || null;

export class FranceStore {
  constructor(pool = null) {
    this._pool = pool;
    this._apiColumns = null;
    this._franceRecordColumns = null;
  }

  /**
   * Lazy, so constructing a store never throws. A missing database variable
   * should surface when a request actually needs the database, not while a
   * route handler is still validating its arguments — otherwise a bad `day`
   * parameter reports a configuration error instead of the real mistake.
   */
  get pool() {
    if (!this._pool) this._pool = francePool();
    return this._pool;
  }

  query(sql, params = []) {
    return this.pool.query(sql, params).then(([rows]) => rows);
  }

  async columnsOf(table) {
    const rows = await this.query(
      `SELECT COLUMN_NAME AS name
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    return new Set(rows.map((r) => r.name));
  }

  async tableExists(table) {
    const rows = await this.query(
      `SELECT 1 AS present
         FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
      [table],
    );
    return rows.length > 0;
  }

  /**
   * Creates the France-owned tables and adds the four columns APIData_Table2
   * needs. Adding a column is checked rather than attempted-and-swallowed, so
   * a genuine failure is still an error.
   */
  async ensureSchema() {
    const created = [];
    for (const ddl of SCHEMA) {
      await this.query(ddl);
      created.push(/CREATE TABLE IF NOT EXISTS (\w+)/.exec(ddl)[1]);
    }

    const added = [];
    if (await this.tableExists("APIData_Table2")) {
      const existing = await this.columnsOf("APIData_Table2");
      for (const [column, definition] of Object.entries(REQUIRED_API_COLUMNS)) {
        if (existing.has(column)) continue;
        await this.query(`ALTER TABLE APIData_Table2 ADD COLUMN \`${column}\` ${definition}`);
        added.push(column);
      }
      if (added.length) this._apiColumns = null;

      // One index carries the only query France actually needs to be fast:
      // "everything that ran in France between these dates".
      const indexes = await this.query(
        `SELECT INDEX_NAME AS name FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'APIData_Table2'
            AND INDEX_NAME = 'idx_country_date' LIMIT 1`,
      );
      if (!indexes.length) {
        await this.query(
          "ALTER TABLE APIData_Table2 ADD INDEX idx_country_date (raceCountry, meetingDate)",
        );
        added.push("idx_country_date");
      }
    }

    return { tables: created, apiColumnsAdded: added };
  }

  async apiColumns() {
    if (!this._apiColumns) this._apiColumns = await this.columnsOf("APIData_Table2");
    return this._apiColumns;
  }

  // ---------------------------------------------------------------- staging

  /**
   * Keeps the source payloads verbatim. When a parse turns out to be wrong --
   * and over five days of building this scraper, six of them were -- the fix
   * can be re-applied to stored HTML and JSON instead of re-scraping a public
   * window that has already rolled past.
   */
  async stageRows(rows, { source = "MERGED", fetchedAt = new Date() } = {}) {
    const byRace = new Map();
    for (const row of rows) {
      const key = `${isoOf(row.meetingDate)}|${row.courseName}|${row.raceNumber ?? ""}`;
      if (!byRace.has(key)) byRace.set(key, []);
      byRace.get(key).push(row);
    }

    let races = 0;
    let runners = 0;

    for (const group of byRace.values()) {
      const head = group[0];
      const [result] = await this.pool.query(
        `INSERT INTO fr_raw_race
           (source, meeting_date, course_name, race_number, race_code, payload, fetched_at)
         VALUES (?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE payload = VALUES(payload), fetched_at = VALUES(fetched_at),
                                 id = LAST_INSERT_ID(id)`,
        [
          source,
          isoOf(head.meetingDate),
          head.courseName,
          head.raceNumber ?? null,
          head.sourceRaceId ?? null,
          JSON.stringify({
            raceTitle: head.raceTitle ?? null,
            raceType: head.raceType ?? null,
            distanceMetres: head.distanceMetres ?? null,
            going: head.going ?? null,
            prizeFund: head.prizeFund ?? null,
            numberOfRunners: head.numberOfRunners ?? null,
            scheduledTimeOfRaceLocal: head.scheduledTimeOfRaceLocal ?? null,
          }),
          fetchedAt,
        ],
      );
      const rawRaceId = result.insertId;
      races += 1;

      for (const row of group) {
        await this.query(
          `INSERT INTO fr_raw_runner
             (raw_race_id, source, cloth_number, horse_name, pmu_id_cheval, payload)
           VALUES (?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE payload = VALUES(payload),
                                   pmu_id_cheval = VALUES(pmu_id_cheval)`,
          [
            rawRaceId,
            source,
            row.clothNumber ?? null,
            row.horseName,
            row.sourceHorseId ?? null,
            JSON.stringify(row),
          ],
        );
        runners += 1;
      }
    }

    return { races, runners };
  }

  async upsertCourseRegistry(fixtures = []) {
    let n = 0;
    for (const fixture of fixtures) {
      if (!fixture?.courseName || !fixture?.courseCode) continue;
      await this.query(
        `INSERT INTO fr_course_registry (course_name, course_code, last_seen)
         VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE course_code = VALUES(course_code), last_seen = VALUES(last_seen)`,
        [fixture.courseName, fixture.courseCode, isoOf(fixture.date) ?? isoOf(new Date().toISOString())],
      );
      n += 1;
    }
    return n;
  }

  // --------------------------------------------------------------- identity

  /**
   * Candidates for one incoming French horse. Deliberately name-only: the
   * matcher decides, and it needs to see every horse sharing the name so it
   * can rule out the wrong ones. ROYALLY is the case that proves it -- a 2024
   * Kingman juvenile on today's card, and a 2006 Verglas horse already in the
   * database under horseCode 290555.
   */
  async findHorseCandidates(horseName) {
    const columns = await this.apiColumns();
    const wanted = [
      "horseCode",
      "horseName",
      "sireName",
      "damName",
      "damsireName",
      "foalingDate",
      "foalingYear",
      "horseCountry",
      "countryCode",
      "horseGender",
    ].filter((c) => columns.has(c));

    if (!columns.has("horseName")) return [];

    // Only rows that carry a horseCode are candidates.
    //
    // Without this, the second pass over a day matches France's own rows
    // against themselves: they are in the table by then, under the same names,
    // so every runner "links" to the run we just wrote and a couple land in the
    // review queue on every reconcile. A row with no horseCode is a run, not a
    // horse record, and cannot confer identity on anything.
    //
    // A French row does become a candidate once someone works the review queue
    // and assigns it a horseCode, which is exactly the behaviour wanted.
    const identified = columns.has("horseCode") ? " AND horseCode IS NOT NULL" : "";

    return this.query(
      `SELECT DISTINCT ${wanted.map((c) => `\`${c}\``).join(", ")}
         FROM APIData_Table2
        WHERE horseName = ?${identified}
        LIMIT 25`,
      [horseName],
    );
  }

  async queueReview(incoming, result) {
    await this.query(
      `INSERT INTO fr_match_review
         (horse_name, meeting_date, incoming, candidate_horse_code, score, max_score,
          evidence, reason, status, created_at)
       VALUES (?,?,?,?,?,?,?,?, 'pending', NOW())`,
      [
        incoming.horseName,
        isoOf(incoming.meetingDate),
        JSON.stringify(incoming),
        result?.candidate?.horseCode ?? null,
        result?.score ?? null,
        result?.maxScore ?? null,
        JSON.stringify(result?.evidence ?? null),
        result?.reason ? String(result.reason).slice(0, 255) : null,
      ],
    );
  }

  async pendingReviews(limit = 100) {
    return this.query(
      `SELECT id, horse_name, meeting_date, candidate_horse_code, score, max_score,
              reason, status, created_at
         FROM fr_match_review
        WHERE status = 'pending'
        ORDER BY created_at DESC
        LIMIT ?`,
      [Number(limit) || 100],
    );
  }

  // -------------------------------------------------------------- promotion

  /**
   * Writes merged French runners into APIData_Table2.
   *
   * Scoped delete-then-insert per race: every French row for that race is
   * removed and rewritten, and the delete is filtered on sourceSystem so it can
   * never reach a Timeform row even if the race key collides. This is why a
   * unique index is not required on the incoming keys -- correctness comes from
   * the scope of the delete, not from an index that may not exist.
   */
  async promoteToApiData(rows, { resolved = new Map() } = {}) {
    const columns = await this.apiColumns();
    if (!columns.has("sourceSystem")) {
      throw new Error(
        "APIData_Table2 has no sourceSystem column -- run ensureSchema() before promoting.",
      );
    }

    // Only write fields the table actually has. Everything else is reported
    // rather than silently dropped.
    const sample = rows[0] ?? {};
    const writable = Object.keys(sample).filter((k) => columns.has(k));
    const skipped = Object.keys(sample).filter((k) => !columns.has(k));

    const byRace = new Map();
    for (const row of rows) {
      const key = `${isoOf(row.meetingDate)}|${row.courseName}|${row.raceNumber ?? ""}`;
      if (!byRace.has(key)) byRace.set(key, []);
      byRace.get(key).push(row);
    }

    let deleted = 0;
    let inserted = 0;

    for (const group of byRace.values()) {
      const head = group[0];

      const [del] = await this.pool.query(
        `DELETE FROM APIData_Table2
          WHERE sourceSystem = ?
            AND meetingDate = ?
            AND courseName = ?
            AND ${head.raceNumber == null ? "raceNumber IS NULL" : "raceNumber = ?"}`,
        head.raceNumber == null
          ? [FRANCE_SOURCE, isoOf(head.meetingDate), head.courseName]
          : [FRANCE_SOURCE, isoOf(head.meetingDate), head.courseName, head.raceNumber],
      );
      deleted += del.affectedRows || 0;

      for (const row of group) {
        const payload = {};
        for (const key of writable) payload[key] = row[key] ?? null;

        payload.sourceSystem = FRANCE_SOURCE;
        if (columns.has("raceCountry")) payload.raceCountry = "FRA";
        if (columns.has("meetingDate")) payload.meetingDate = isoOf(row.meetingDate);

        // A confident identity match writes the existing horse's code onto the
        // French row, which is the join that puts French form on that horse's
        // page. An unresolved horse is left null rather than guessed.
        const decision = resolved.get(row);
        if (columns.has("horseCode")) {
          payload.horseCode = decision?.horseCode ?? null;
        }

        const names = Object.keys(payload);
        await this.query(
          `INSERT INTO APIData_Table2 (${names.map((n) => `\`${n}\``).join(", ")})
           VALUES (${names.map(() => "?").join(", ")})`,
          names.map((n) => payload[n]),
        );
        inserted += 1;
      }
    }

    return { inserted, deleted, races: byRace.size, skippedFields: skipped };
  }

  /** Everything France holds in APIData_Table2, for an audit or a rollback. */
  async franceRowCount() {
    const rows = await this.query(
      "SELECT COUNT(*) AS n FROM APIData_Table2 WHERE sourceSystem = ?",
      [FRANCE_SOURCE],
    );
    return rows[0]?.n ?? 0;
  }

  // ------------------------------------------------- legacy France page feed

  /**
   * The existing France page reads FranceRaceRecords with its own column
   * names. Keeping it fed means that page keeps working untouched while the
   * richer data lands in APIData_Table2 alongside it.
   */
  async franceRecordColumns() {
    if (!this._franceRecordColumns) {
      this._franceRecordColumns = await this.columnsOf("FranceRaceRecords");
    }
    return this._franceRecordColumns;
  }

  async clearFranceRaceRecordsForDate(isoDate) {
    if (!(await this.tableExists("FranceRaceRecords"))) return 0;
    const [res] = await this.pool.query("DELETE FROM FranceRaceRecords WHERE `Date` = ?", [
      isoOf(isoDate),
    ]);
    return res.affectedRows || 0;
  }

  async writeFranceRaceRecords(rows) {
    if (!(await this.tableExists("FranceRaceRecords"))) return 0;
    const columns = await this.franceRecordColumns();

    const byRace = new Map();
    for (const row of rows) {
      const key = `${isoOf(row.meetingDate)}|${row.courseName}|${row.raceNumber ?? ""}`;
      if (!byRace.has(key)) byRace.set(key, []);
      byRace.get(key).push(row);
    }

    let written = 0;
    for (const group of byRace.values()) {
      const head = group[0];
      const ordered = [...group].sort(
        (a, b) =>
          (a.positionOfficial ?? 99) - (b.positionOfficial ?? 99) ||
          (a.clothNumber ?? 0) - (b.clothNumber ?? 0),
      );
      const winner = ordered.find((r) => r.positionOfficial === 1);

      for (const row of ordered) {
        const record = {
          Date: isoOf(head.meetingDate),
          Racecourse: head.courseName,
          "#": head.raceNumber ?? null,
          Race: head.raceTitle ?? null,
          Start: head.scheduledTimeOfRaceLocal?.slice(11, 16) ?? null,
          Discipline: head.raceType ?? null,
          Distance: head.distanceMetres ? `${head.distanceMetres}m` : null,
          Prizemoney: head.prizeFund ?? null,
          Conditions: head.raceConditions ?? head.raceCategory ?? null,
          Winner: winner?.horseName ?? null,
          "Runners / Finishing order": ordered
            .map((r) => `${r.positionOfficial ?? "-"} ${r.horseName}`)
            .join(", "),
          "To note": head.Group ? `Group ${head.Group}` : head.Listed ? "Listed" : null,
          "N°": row.clothNumber ?? null,
          Horse: row.horseName,
          "Sire/Dam": row.sireName && row.damName ? `${row.sireName} / ${row.damName}` : null,
          Owner: row.ownerFullName ?? null,
          Trainer: row.trainerFullName ?? null,
          Jockey: row.jockeyFullName ?? null,
          Weight: row.weightKg ? `${row.weightKg} kg` : null,
          Earnings: row.careerEarnings ?? null,
          Form: row.formString ?? null,
          Rating: row.officialRating ?? null,
          "Equipment(s)": row.headGear ?? null,
          Breeders: row.breederName ?? null,
        };

        const names = Object.keys(record).filter((n) => columns.has(n));
        if (!names.length) return written;

        await this.query(
          `INSERT INTO FranceRaceRecords (${names.map((n) => `\`${n}\``).join(", ")})
           VALUES (${names.map(() => "?").join(", ")})`,
          names.map((n) => record[n]),
        );
        written += 1;
      }
    }
    return written;
  }

  // ------------------------------------------------------------- run record

  async startRun(target) {
    const [res] = await this.pool.query(
      "INSERT INTO fr_ingest_run (target, started_at) VALUES (?, NOW())",
      [String(target).slice(0, 32)],
    );
    return res.insertId;
  }

  async finishRun(id, { ok, stats, error }) {
    if (!id) return;
    await this.query(
      `UPDATE fr_ingest_run
          SET finished_at = NOW(), ok = ?, stats = ?, error = ?
        WHERE id = ?`,
      [ok ? 1 : 0, stats ? JSON.stringify(stats) : null, error ? String(error).slice(0, 4000) : null, id],
    );
  }

  async recentRuns(limit = 20) {
    return this.query(
      `SELECT id, target, started_at, finished_at, ok, stats, error
         FROM fr_ingest_run ORDER BY started_at DESC LIMIT ?`,
      [Number(limit) || 20],
    );
  }

  async stats() {
    const [runners] = await this.query("SELECT COUNT(*) AS n FROM fr_raw_runner");
    const [races] = await this.query("SELECT COUNT(*) AS n FROM fr_raw_race");
    const [pending] = await this.query(
      "SELECT COUNT(*) AS n FROM fr_match_review WHERE status = 'pending'",
    );
    return {
      stagedRaces: races?.n ?? 0,
      stagedRunners: runners?.n ?? 0,
      pendingReviews: pending?.n ?? 0,
      apiDataFranceRows: await this.franceRowCount(),
    };
  }
}
