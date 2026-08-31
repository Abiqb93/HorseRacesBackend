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
import { FRANCE_CARD_SOURCE } from "./racecards.mjs";

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

  // Metadata PMU supplies on every runner that the table had nowhere to put,
  // so promoteToApiData was dropping it silently into skippedFields: a French
  // row reached the site with no silks, no rating, no form and no career
  // record, and read as a thinner horse than the Timeform rows beside it.
  // Timeform's own columns are left alone -- these sit alongside them, so a
  // French row answers the same questions without ever overwriting a
  // Timeform-sourced value.
  silkUrl: "VARCHAR(255) NULL",
  officialRating: "SMALLINT NULL",
  formString: "VARCHAR(64) NULL",
  careerRuns: "SMALLINT NULL",
  careerWins: "SMALLINT NULL",
  careerPlaces: "SMALLINT NULL",
  careerEarnings: "DECIMAL(12,2) NULL",
  earningsThisYear: "DECIMAL(12,2) NULL",
  breederName: "VARCHAR(160) NULL",
  damsireName: "VARCHAR(120) NULL",
  weightKg: "DECIMAL(5,2) NULL",
  headGear: "VARCHAR(32) NULL",
  clothNumber: "SMALLINT NULL",
  raceCategory: "VARCHAR(64) NULL",
  // The runner's breed. French racing mixes thoroughbreds with Arabians,
  // Anglo-Arabians and AQPS on the same cards -- the Qatar Arabian World Cup
  // shares the Arc card -- and nothing downstream can tell them apart
  // without this. Stored in one vocabulary (see CANONICAL_BREED below);
  // Timeform's own rows leave it NULL, which reads as "thoroughbred feed".
  breed: "VARCHAR(32) NULL",
  distanceMetres: "SMALLINT NULL",
  nonRunner: "TINYINT NULL",
  incident: "VARCHAR(32) NULL",
};

/**
 * The indexes France's own writes depend on.
 *
 * idx_country_date carries the only read France needs to be fast:
 * "everything that ran in France between these dates".
 *
 * The other two carry promoteToApiData's delete. Without them each ingested
 * race scans APIData_Table2 whole and takes a next-key lock on every row it
 * examines, so one ingest locks the table against the next and every
 * subsequent run dies on "Lock wait timeout exceeded" -- which is exactly
 * what happened once a course rename made the sourceRaceId branch matter.
 */
export const REQUIRED_API_INDEXES = {
  idx_country_date: "(raceCountry, meetingDate)",
  idx_fr_source_race: "(sourceSystem, sourceRaceId)",
  idx_fr_source_fixture: "(sourceSystem, meetingDate, courseName, raceNumber)",
};

export const FRANCE_SOURCE = "FRANCE";

/**
 * One vocabulary for the breed column, whichever source wrote the row. PMU
 * says "PUR-SANG" / "ARABE" / "ANGLO ARABE"; France Galop's sheets say "PS" /
 * "AQPS". Both arrive verbatim in the staged payloads -- the translation
 * happens here at promotion, the same boundary that renames finishingTime,
 * so a repromoted 2025 payload and tomorrow's ingest write the same value.
 * Only evidenced spellings are mapped; an unmapped value is stored uppercased
 * rather than guessed at.
 */
const CANONICAL_BREED = {
  "PUR-SANG": "PS", "PUR SANG": "PS", PS: "PS",
  ARABE: "AR", AR: "AR",
  "ANGLO ARABE": "AA", "ANGLO-ARABE": "AA", AA: "AA",
  AQPS: "AQPS",
};
export function canonicalBreed(value) {
  if (value == null || value === "") return null;
  const key = String(value).trim().toUpperCase();
  return CANONICAL_BREED[key] ?? key;
}

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

/**
 * meetingDate as APIData_Table2 actually stores it: "YYYY-MM-DD 00:00:00".
 * The column holds strings, and every query on the table filters with
 * `meetingDate BETWEEN '<date> 00:00:00' AND '<date> 23:59:59'`. A bare
 * "YYYY-MM-DD" sorts *below* that lower bound, so rows written in the short
 * form are invisible to every date query the platform makes -- day pulls,
 * the review list, the prospects index build -- even though they are in the
 * table and readable by horse name.
 */
const apiDateOf = (value) => {
  const iso = isoOf(value);
  return iso ? `${iso} 00:00:00` : null;
};

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

      for (const [name, definition] of Object.entries(REQUIRED_API_INDEXES)) {
        const found = await this.query(
          `SELECT INDEX_NAME AS name FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'APIData_Table2'
              AND INDEX_NAME = ? LIMIT 1`,
          [name],
        );
        if (found.length) continue;
        // Adding an index to a table this size takes long enough that a
        // caller can time out mid-ALTER while MySQL carries on. A retry then
        // sees no index yet and tries again, so treat "already exists" as the
        // success it is rather than failing the whole schema call.
        try {
          await this.query(`ALTER TABLE APIData_Table2 ADD INDEX ${name} ${definition}`);
          added.push(name);
        } catch (err) {
          if (!/Duplicate key name/i.test(err.message)) throw err;
        }
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

  /**
   * Queues a horse whose identity the matcher would not decide on its own.
   *
   * Once per horse per meeting, however many times the date is ingested. The
   * insert used to be unconditional, and re-ingesting a date is routine --
   * French results are amended after the fact, and any schema change means
   * re-running the recent past. That had two costs. The queue filled with
   * copies of the same horse, 315 reviews becoming 959 over an afternoon of
   * re-runs. And, worse, a horse someone had already linked or rejected came
   * back as pending on the next run, so the queue quietly asked again for a
   * decision that had been made.
   *
   * The guard therefore matches on any existing review, not just a pending
   * one: a decided horse must not be re-asked. NULL-safe equality on the date
   * because a review can carry none.
   */
  async queueReview(incoming, result) {
    await this.query(
      `INSERT INTO fr_match_review
         (horse_name, meeting_date, incoming, candidate_horse_code, score, max_score,
          evidence, reason, status, created_at)
       SELECT ?,?,?,?,?,?,?,?, 'pending', NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM fr_match_review r
           WHERE r.horse_name = ? AND r.meeting_date <=> ?
        )`,
      [
        incoming.horseName,
        isoOf(incoming.meetingDate),
        JSON.stringify(incoming),
        result?.candidate?.horseCode ?? null,
        result?.score ?? null,
        result?.maxScore ?? null,
        JSON.stringify(result?.evidence ?? null),
        result?.reason ? String(result.reason).slice(0, 255) : null,
        incoming.horseName,
        isoOf(incoming.meetingDate),
      ],
    );
  }

  /**
   * Collapses the duplicate reviews the unguarded insert already created.
   *
   * One row survives per horse per meeting, and a decided row always outlives
   * a pending one -- someone's answer is worth more than a fresh question
   * about the same horse.
   */
  async dedupeReviews() {
    const [before] = await this.pool.query("SELECT COUNT(*) AS n FROM fr_match_review");
    await this.pool.query(
      `DELETE r FROM fr_match_review r
         JOIN (
           SELECT horse_name, meeting_date,
                  MIN(CASE WHEN status <> 'pending' THEN id END) AS decided,
                  MIN(id) AS earliest
             FROM fr_match_review
            GROUP BY horse_name, meeting_date
         ) keep
           ON keep.horse_name = r.horse_name
          AND keep.meeting_date <=> r.meeting_date
        WHERE r.id <> COALESCE(keep.decided, keep.earliest)`,
    );
    const [after] = await this.pool.query("SELECT COUNT(*) AS n FROM fr_match_review");
    return { before: before[0].n, after: after[0].n, removed: before[0].n - after[0].n };
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

    // A withdrawn horse has no result, and APIData_Table2 is the results
    // table: across 1,591 Timeform rows sampled, not one carries a null
    // finishing position. Writing non-runners here put them in the race as
    // runners with a blank position -- Great Barrier Reef appearing as an
    // eighth runner in a Prix Morny that eight declared and seven contested.
    // They are still declared on the racecard, which is where a withdrawal
    // belongs and where RacesAndEntries already marks them "Non-runner".
    //
    // A horse that fell or was pulled up is NOT withdrawn: it ran, so it
    // stays, with its incident recorded rather than left as a bare blank.
    const runners = rows.filter((row) => !row.nonRunner);
    const withdrawn = rows.length - runners.length;

    const byRace = new Map();
    for (const row of runners) {
      const key = `${isoOf(row.meetingDate)}|${row.courseName}|${row.raceNumber ?? ""}`;
      if (!byRace.has(key)) byRace.set(key, []);
      byRace.get(key).push(row);
    }

    let deleted = 0;
    let inserted = 0;

    for (const group of byRace.values()) {
      const head = group[0];

      // Two ways of naming the same race, and the delete has to try both --
      // but as two statements, never as one OR.
      //
      // sourceRaceId ("2026-08-26:R4:C3") is PMU's own meeting and race
      // number, so it survives anything that changes how the course is
      // spelled. That matters: correcting La Teste's name from TESTE DE BUCH
      // left every previous row of that fixture invisible to a delete scoped
      // on courseName, and re-ingesting the day doubled it rather than
      // replacing it. Matching the id as well makes a rename self-healing.
      //
      // Written as one `A OR B` across different columns, though, MySQL can
      // use an index for neither, and a full scan of APIData_Table2 takes a
      // next-key lock on every row it examines. Every subsequent ingest then
      // died on "Lock wait timeout exceeded" -- on the one date where the id
      // branch actually had to match, which is exactly the date the rename
      // broke. Two statements each get their own index.
      //
      // The date/course/number form stays for rows written before
      // sourceRaceId existed, and matches both date forms because earlier
      // runs wrote a bare "YYYY-MM-DD".
      if (head.sourceRaceId) {
        const [byId] = await this.pool.query(
          "DELETE FROM APIData_Table2 WHERE sourceSystem = ? AND sourceRaceId = ?",
          [FRANCE_SOURCE, head.sourceRaceId],
        );
        deleted += byId.affectedRows || 0;
      }

      const [del] = await this.pool.query(
        `DELETE FROM APIData_Table2
          WHERE sourceSystem = ?
            AND meetingDate IN (?, ?)
            AND courseName = ?
            AND ${head.raceNumber == null ? "raceNumber IS NULL" : "raceNumber = ?"}`,
        head.raceNumber == null
          ? [FRANCE_SOURCE, apiDateOf(head.meetingDate), isoOf(head.meetingDate), head.courseName]
          : [FRANCE_SOURCE, apiDateOf(head.meetingDate), isoOf(head.meetingDate),
             head.courseName, head.raceNumber],
      );
      deleted += del.affectedRows || 0;

      for (const row of group) {
        const payload = {};
        for (const key of writable) payload[key] = row[key] ?? null;

        payload.sourceSystem = FRANCE_SOURCE;
        if (columns.has("raceCountry")) payload.raceCountry = "FRA";

        // Two fields the platform already has a column for under another
        // name. Renaming them here rather than in the normaliser keeps that
        // module describing PMU's own vocabulary.
        if (columns.has("finishingTime") && row.finishingTimeSeconds != null) {
          payload.finishingTime = row.finishingTimeSeconds;
        }
        // French racing grades a race by its condition (HANDICAP_DIVISE,
        // A_RECLAMER, GROUPE_I) where British racing grades it by class. It is
        // the same column's job on the race card, so the category fills it
        // when the row has no class of its own.
        if (columns.has("raceClass") && !payload.raceClass && row.raceCategory) {
          payload.raceClass = String(row.raceCategory).replace(/_/g, " ");
        }
        if (columns.has("meetingDate")) payload.meetingDate = apiDateOf(row.meetingDate);
        if (columns.has("breed")) payload.breed = canonicalBreed(row.breed);

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

    return { inserted, deleted, withdrawn, races: byRace.size, skippedFields: skipped };
  }

  /**
   * Writes French racecards into RacesAndEntries.
   *
   * Scoped delete-then-insert per fixture date, filtered on source, so a
   * re-run replaces that day's French cards and can never touch the British
   * feed's rows. Declarations change up to the off -- non-runners, jockey
   * changes -- so re-running a date is the normal case, not the exception.
   *
   * The tag columns are left out of the write on purpose: taggedBy,
   * taggedUser and tagComments are the user's, not the feed's. A re-run of a
   * date does clear them along with the row, which is the same behaviour the
   * British feed already has.
   */
  async writeRacecards(rows) {
    if (!rows.length) return { inserted: 0, deleted: 0, dates: 0, skippedFields: [] };

    const [cols] = await this.pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'RacesAndEntries'`,
    );
    const columns = new Set(cols.map((c) => c.COLUMN_NAME));
    const writable = Object.keys(rows[0]).filter((k) => columns.has(k));
    const skipped = Object.keys(rows[0]).filter((k) => !columns.has(k));
    if (!columns.has("source")) {
      throw new Error("RacesAndEntries has no source column -- cannot separate French cards from the British feed.");
    }

    const byDate = new Map();
    for (const row of rows) {
      if (!byDate.has(row.FixtureDate)) byDate.set(row.FixtureDate, []);
      byDate.get(row.FixtureDate).push(row);
    }

    let inserted = 0;
    let deleted = 0;
    for (const [fixtureDate, group] of byDate) {
      const [del] = await this.pool.query(
        "DELETE FROM RacesAndEntries WHERE source = ? AND FixtureDate = ?",
        [FRANCE_CARD_SOURCE, fixtureDate],
      );
      deleted += del.affectedRows || 0;

      for (const row of group) {
        const payload = {};
        for (const key of writable) payload[key] = row[key] ?? null;
        const names = Object.keys(payload);
        await this.query(
          `INSERT INTO RacesAndEntries (${names.map((n) => `\`${n}\``).join(", ")})
           VALUES (${names.map(() => "?").join(", ")})`,
          names.map((n) => payload[n]),
        );
        inserted += 1;
      }
    }
    return { inserted, deleted, dates: byDate.size, skippedFields: skipped };
  }

  /**
   * The staged rows for a date range, exactly as they were normalised.
   *
   * fr_raw_runner.payload holds the whole normalised runner, which is what
   * promoteToApiData consumes, so France can rebuild its own rows in
   * APIData_Table2 from its own tables without going back to PMU. That
   * matters because something else maintaining that table deletes French
   * rows for recent dates: a repair that had to re-scrape would take minutes
   * per day and hammer PMU, where this is a single indexed read.
   */
  async stagedRowsBetween(fromIso, toIso, { source = "MERGED" } = {}) {
    const rows = await this.query(
      `SELECT r.payload, ra.fetched_at, ra.race_code, ra.meeting_date,
              ra.course_name, ra.race_number
         FROM fr_raw_runner r
         JOIN fr_raw_race ra ON ra.id = r.raw_race_id
        WHERE ra.meeting_date BETWEEN ? AND ?
          AND r.source = ?
        ORDER BY ra.fetched_at ASC, ra.meeting_date, ra.course_name, ra.race_number`,
      [fromIso, toIso, source],
    );

    // Staging keeps a race under every name it has ever been filed as, because
    // its key includes the course name: correcting La Teste from TESTE DE BUCH
    // left both staged for the same fixture, which is why 26 August stages 266
    // runners for a card of 164. Promotion collapses them anyway -- both share
    // a sourceRaceId, so the second group's delete removes the first group's
    // inserts -- but re-promoting the stale copy is wasted work and makes the
    // staged total useless as a measure of what a day should hold.
    //
    // Newest staging wins, per race and horse.
    const seen = new Map();
    for (const r of rows) {
      let row;
      try {
        row = typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload;
      } catch { continue; }
      if (!row) continue;
      const raceKey = r.race_code
        || `${isoOf(r.meeting_date)}|${r.course_name}|${r.race_number ?? ""}`;
      seen.set(`${raceKey}|${row.horseName}`, row);
    }
    return [...seen.values()];
  }

  /** What France holds in APIData_Table2 per day, to see what has gone. */
  async apiDataCountsByDate(fromIso, toIso) {
    const rows = await this.query(
      // Formatted in SQL rather than DATE(): the driver hands a DATE column
      // back as a JS Date, and isoOf stringifies that to "Mon Aug 25" rather
      // than "2026-08-25", so every key missed and every day looked empty. A
      // day that looks empty is a day this rewrites, which would have turned
      // the hourly repair into an hourly rewrite of the whole window.
      `SELECT DATE_FORMAT(meetingDate, '%Y-%m-%d') AS d, COUNT(*) AS n
         FROM APIData_Table2
        WHERE sourceSystem = ? AND meetingDate BETWEEN ? AND ?
        GROUP BY d ORDER BY d`,
      [FRANCE_SOURCE, `${fromIso} 00:00:00`, `${toIso} 23:59:59`],
    );
    return Object.fromEntries(rows.map((r) => [String(r.d), Number(r.n)]));
  }

  /** Everything France holds in APIData_Table2, for an audit or a rollback. */
  async franceRowCount() {
    // Lead with raceCountry so this uses idx_country_date. sourceSystem has
    // no index of its own, and APIData_Table2 holds millions of rows going
    // back to 2006 -- filtering on it alone is a full table scan that hangs
    // the request and holds one of the few France pool connections open.
    // Every row this ingest writes carries both columns, so the pair is
    // equivalent to the sourceSystem filter it replaces.
    const rows = await this.query(
      "SELECT COUNT(*) AS n FROM APIData_Table2 WHERE raceCountry = ? AND sourceSystem = ?",
      ["FRA", FRANCE_SOURCE],
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
