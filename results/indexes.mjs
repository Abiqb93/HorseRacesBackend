/**
 * Indexes APIData_Table2 needs for reads that would otherwise fetch a full row
 * for every match, each looked for by its columns and added online where
 * missing.
 *
 * The table's rows go in a day at a time, so one horse's runs, or one sire's
 * runners, are scattered across it, and a read that needs a column its index
 * does not hold fetches every one of them from disk. An index holding all the
 * columns the read asks for answers it from the index alone.
 */

export const TABLE = "APIData_Table2";

/** How long a build waits for the table's lock before trying later. */
export const LOCK_WAIT_SECONDS = 2;

/**
 * The name of an index whose leading columns are `columns`, in order and in
 * full (no prefix: a prefix cannot answer from the index), or null. Any name
 * will do, so an index someone added by hand counts.
 */
export async function findIndex(runQuery, columns) {
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
  const want = columns.map((c) => c.toLowerCase());
  for (const [name, cols] of byIndex) {
    if (want.every((c, i) => cols[i] === c)) return name;
  }
  return null;
}

/**
 * Make sure an index on `columns` is there, adding it as `name` where missing.
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
export async function ensureIndex({ runQuery, withConnection, name, columns, log = console }) {
  const found = await findIndex(runQuery, columns);
  if (found) return { index: found, added: false };

  log.log(`[indexes] adding ${name} (${columns.join(", ")}) to ${TABLE}`);
  const started = Date.now();
  try {
    await withConnection(async (query) => {
      await query(`SET SESSION lock_wait_timeout = ${LOCK_WAIT_SECONDS}`, []);
      await query(
        `ALTER TABLE ${TABLE} ADD INDEX ${name} (${columns.join(", ")}), ALGORITHM=INPLACE, LOCK=NONE`,
        [],
      );
    });
  } catch (err) {
    // A build an earlier start began can finish first.
    if (!/Duplicate key name/i.test(err.message)) throw err;
  }
  const index = await findIndex(runQuery, columns);
  if (!index) throw new Error(`${name} not found after it was added`);
  log.log(`[indexes] ${index} ready in ${Math.round((Date.now() - started) / 1000)}s`);
  return { index, added: true };
}

/** A name as the table's collation compares it: no case, no accents. */
export const nameKey = (name) =>
  String(name).normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
