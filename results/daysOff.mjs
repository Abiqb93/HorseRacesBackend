/**
 * Each runner's days since its previous run held in APIData_Table2.
 *
 * The lookup wants, for each of a day's horses, its latest run before that
 * day and that run's horseCode (about one name in forty belongs to two
 * horses). Through the (horseName, meetingDate) index alone, horseCode means
 * a read of every earlier run's full row, and a horse's runs are scattered
 * across the table a day's insert at a time: 96 horses took 52 s and a full
 * day ran past two and a half minutes on the live table (28 October 2026),
 * well beyond the five-second cap the query carried. An index holding all
 * three columns answers it from the index alone.
 *
 * So the lookup runs only once that index is there, forced onto it, and the
 * response waits for it a few seconds at most, timed here rather than by the
 * database: a cap on execution time does not count the wait for a
 * connection, and a cap the database misses (a forty-minute cap ran 87
 * minutes on 26 October) does not hold the page.
 */

export const TABLE = "APIData_Table2";
export const INDEX_NAME = "idx_days_off";
export const INDEX_COLUMNS = ["horseName", "horseCode", "meetingDate"];

/** How long a response waits for days off before going out without them. */
export const DAYS_OFF_WAIT_MS = 4000;

/** How long the index build waits for the table's lock before trying later. */
export const LOCK_WAIT_SECONDS = 2;

/** Days off are read for this many horses a query. */
export const CHUNK = 250;

/**
 * The name of an index whose leading columns are horseName, horseCode,
 * meetingDate in full (no prefix: a prefix cannot answer from the index), or
 * null. Any name will do, so an index someone added by hand counts.
 */
export async function findDaysOffIndex(runQuery) {
  const rows = await runQuery(
    `SELECT INDEX_NAME AS name, SEQ_IN_INDEX AS seq, COLUMN_NAME AS col, SUB_PART AS part
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    [TABLE],
  );
  const byIndex = new Map();
  for (const r of rows ?? []) {
    const list = byIndex.get(r.name) ?? [];
    list[Number(r.seq) - 1] = r.part == null ? String(r.col).toLowerCase() : null;
    byIndex.set(r.name, list);
  }
  const want = INDEX_COLUMNS.map((c) => c.toLowerCase());
  for (const [name, cols] of byIndex) {
    if (want.every((c, i) => cols[i] === c)) return name;
  }
  return null;
}

/**
 * Make sure the index is there, adding it where it is missing.
 *
 * Added online (INPLACE, LOCK=NONE), so the scraper's inserts carry on while
 * it builds. The build still needs the table's metadata lock for a moment at
 * each end, and while it waits for one every later read of the table queues
 * behind it, so it gives up after LOCK_WAIT_SECONDS rather than hold the site
 * up behind a long read; the caller tries again later.
 *
 * `withConnection(fn)` hands fn a query function on one connection of its
 * own, so the lock wait set here touches no other query.
 */
export async function ensureDaysOffIndex({ runQuery, withConnection, log = console }) {
  const found = await findDaysOffIndex(runQuery);
  if (found) return { index: found, added: false };

  log.log(`[days off] adding ${INDEX_NAME} (${INDEX_COLUMNS.join(", ")}) to ${TABLE}`);
  const started = Date.now();
  try {
    await withConnection(async (query) => {
      await query(`SET SESSION lock_wait_timeout = ${LOCK_WAIT_SECONDS}`, []);
      await query(
        `ALTER TABLE ${TABLE} ADD INDEX ${INDEX_NAME} (${INDEX_COLUMNS.join(", ")}), ALGORITHM=INPLACE, LOCK=NONE`,
        [],
      );
    });
  } catch (err) {
    // A build an earlier start began can finish first.
    if (!/Duplicate key name/i.test(err.message)) throw err;
  }
  const index = await findDaysOffIndex(runQuery);
  if (!index) throw new Error(`${INDEX_NAME} not found after it was added`);
  log.log(`[days off] ${index} ready in ${Math.round((Date.now() - started) / 1000)}s`);
  return { index, added: true };
}

/** A name as the table's collation compares it: no case, no accents. */
const nameKey = (name) =>
  String(name).normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

/** The calendar day as the driver read it (in the server's own time zone). */
const dayOf = (v) => {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
};

/** Each horse's latest runs before `before`, keyed by name, one per horseCode. */
async function lastRuns(runQuery, index, names, before, late) {
  const last = new Map();
  for (let i = 0; i < names.length && !late.past; i += CHUNK) {
    const chunk = names.slice(i, i + CHUNK);
    const found = await runQuery(
      `SELECT /*+ MAX_EXECUTION_TIME(${DAYS_OFF_WAIT_MS}) */ horseName, horseCode, MAX(meetingDate) AS lastRun
         FROM ${TABLE} FORCE INDEX (\`${index}\`)
        WHERE horseName IN (${chunk.map(() => "?").join(",")}) AND meetingDate < ?
        GROUP BY horseName, horseCode`,
      [...chunk, before],
    );
    for (const f of found) {
      const key = nameKey(f.horseName);
      const list = last.get(key) ?? [];
      list.push({ code: f.horseCode, at: dayOf(f.lastRun) });
      last.set(key, list);
    }
  }
  return last;
}

/**
 * Sets `daysOff` on each row (null on a first run) and says how it went:
 * "added", "no-index", "timed-out" or "failed". Rows are left as they are on
 * anything but "added"; the response goes out either way.
 */
export async function attachDaysOff(rows, { runQuery, index, waitMs = DAYS_OFF_WAIT_MS, log = console }) {
  if (!index) return "no-index";
  const starts = rows.map((r) => dayOf(r.meetingDate)).filter((t) => t !== null);
  const names = [...new Set(rows.map((r) => r.horseName).filter(Boolean))];
  if (!starts.length || !names.length) return "added";
  const before = new Date(Math.max(...starts)).toISOString().slice(0, 10);

  // Past the deadline the lookup asks for no more chunks, and what it does
  // after is nobody's: its failure is caught here, not left unhandled.
  const late = { past: false };
  const lookup = lastRuns(runQuery, index, names, before, late);
  lookup.catch(() => {});
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => { late.past = true; resolve(null); }, waitMs); });
  let last;
  try {
    last = await Promise.race([lookup, deadline]);
  } catch (err) {
    log.warn(`[days off] not added: ${err.message}`);
    return "failed";
  } finally {
    clearTimeout(timer);
  }
  if (!last) {
    log.warn(`[days off] not added: ${names.length} horses took over ${waitMs}ms`);
    return "timed-out";
  }

  for (const r of rows) {
    const today = dayOf(r.meetingDate);
    const runs = (last.get(nameKey(r.horseName)) ?? []).filter(
      (x) => x.at !== null && x.at < today && (r.horseCode == null || x.code == null || String(x.code) === String(r.horseCode)),
    );
    const prev = runs.length ? Math.max(...runs.map((x) => x.at)) : null;
    r.daysOff = prev === null || today === null ? null : Math.round((today - prev) / 86_400_000);
  }
  return "added";
}
