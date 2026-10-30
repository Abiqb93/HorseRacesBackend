/**
 * Builds every user's home page lists ahead of time and keeps them in
 * home_dashboards, so the page shows them the moment it opens.
 *
 * A round reads the six race feeds and the last three days of results once,
 * through the same routes the page reads them through (so the lists cannot
 * differ from the page's own), then builds each user's lists in turn from
 * their tracking (home/dashboard.mjs). Rounds run at 04:00 London, at 07:00
 * once the morning scrape is in, and every two hours to 21:00; one user's lists
 * are built again a few seconds after they change what they track.
 *
 * "Today" is London's: the feeds are cut at London's date, and the dates are
 * worked out on a clock set to midday of that day, so a round at any hour
 * files a race under the same day the page would.
 */

import { RACE_FEED_NAMES, buildAux, buildDash } from "./dashboard.mjs";

export const TABLE = "home_dashboards";
/** Bumped when the stored shape changes, so the page ignores an older copy. */
export const VERSION = 1;
/** A user's own rebuild reuses the round's feeds while they are this fresh. */
export const FEEDS_FRESH_MS = 30 * 60 * 1000;
/** A change waits this long for any further change before the rebuild. */
export const DEBOUNCE_MS = 5000;

export const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    user_id VARCHAR(191) NOT NULL PRIMARY KEY,
    day DATE NOT NULL,
    built_at DATETIME NOT NULL,
    took_ms INT NULL,
    body LONGTEXT NOT NULL
  )
`;

const LONDON_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });

/** London's date as YYYY-MM-DD, `offset` days on. */
export const londonDay = (at = new Date(), offset = 0) => {
  const day = LONDON_DAY.format(at);
  if (!offset) return day;
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

/**
 * `fetchJson(path)` reads one of this server's own routes ("/api/...") and
 * gives its JSON; `offspring(kind, names)` is results/offspring.mjs's lookup.
 */
export function createHomeBuilder({ runQuery, fetchJson, offspring, clock = () => new Date(), log = console }) {
  let globals = null; // { day, at, feeds, results, shares }
  let round = null;
  const timers = new Map();
  const status = { lastRound: null, lastRoundWhy: null, lastRoundMs: null, users: 0, failed: [], building: false, error: null };

  let tableReady = null;
  const ensureTable = () => {
    if (!tableReady) {
      tableReady = runQuery(CREATE_TABLE_SQL, []);
      tableReady.catch(() => { tableReady = null; });
    }
    return tableReady;
  };

  const loadGlobals = async () => {
    const day = londonDay(clock());
    const [feeds, results, shares] = await Promise.all([
      Promise.all(RACE_FEED_NAMES.map((name) => fetchJson(`/api/${name}?from=${day}`))),
      Promise.all([0, -1, -2].map(async (offset) => {
        const date = londonDay(clock(), offset);
        const json = await fetchJson(`/api/APIData_Table2?meetingDate=${date}`);
        return { date, records: json?.data || [] };
      })),
      fetchJson(`/api/horse_tracking_shares`),
    ]);
    globals = { day, at: Date.now(), feeds, results, shares: shares?.data || [] };
    return globals;
  };

  const freshGlobals = async () => {
    const day = londonDay(clock());
    if (globals && globals.day === day && Date.now() - globals.at < FEEDS_FRESH_MS) return globals;
    return loadGlobals();
  };

  const buildUser = async (userId, g) => {
    const started = Date.now();
    const u = encodeURIComponent(userId);
    const [tracking, reviewed, sires, dams, owners, jockeys] = await Promise.all([
      fetchJson(`/api/horseTracking?user=${u}`),
      fetchJson(`/api/reviewed_results?user_id=${u}`),
      fetchJson(`/api/sire_tracking?user=${u}`),
      fetchJson(`/api/dam_tracking?user=${u}`),
      fetchJson(`/api/owner_tracking?user=${u}`),
      fetchJson(`/api/jockey_tracking?user=${u}`),
    ]);
    const [sireHorses, damHorses] = await Promise.all([
      offspring("sire", (sires?.data || []).map((s) => s?.sireName).filter(Boolean)),
      offspring("dam", (dams?.data || []).map((d) => d?.damName).filter(Boolean)),
    ]);
    // Midday of London's day on this server's clock: see the note at the top.
    const now = new Date(`${g.day}T12:00:00`);
    const aux = buildAux({
      userId, feeds: g.feeds, reviewed: reviewed?.data, shares: g.shares, sires: sires?.data,
      dams: dams?.data, owners: owners?.data, jockeys: jockeys?.data, sireHorses, damHorses, now,
    });
    const dash = buildDash({ trackingRows: tracking?.data || [], feeds: g.feeds, results: g.results, aux, now });
    const builtAt = new Date();
    const body = JSON.stringify({ version: VERSION, userId, day: g.day, builtAt: builtAt.toISOString(), aux, dash });
    await runQuery(
      `INSERT INTO ${TABLE} (user_id, day, built_at, took_ms, body) VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE day = VALUES(day), built_at = VALUES(built_at), took_ms = VALUES(took_ms), body = VALUES(body)`,
      [String(userId), g.day, builtAt, Date.now() - started, body],
    );
  };

  /** Every user's lists, from feeds read once for the round. */
  const buildAll = (why) => {
    if (round) return round;
    round = (async () => {
      const started = Date.now();
      Object.assign(status, { building: true, error: null });
      try {
        await ensureTable();
        const g = await loadGlobals();
        const users = (await runQuery(`SELECT DISTINCT user_id FROM UserAccounts WHERE user_id IS NOT NULL`, []))
          .map((r) => String(r.user_id))
          .filter(Boolean);
        const failed = [];
        for (const userId of users) {
          try {
            await buildUser(userId, g);
          } catch (err) {
            failed.push(userId);
            log.warn(`[home] ${userId} not built: ${err.message}`);
          }
        }
        Object.assign(status, {
          lastRound: new Date().toISOString(), lastRoundWhy: why, lastRoundMs: Date.now() - started,
          users: users.length - failed.length, failed,
        });
        log.log(`[home] ${why}: ${users.length - failed.length} of ${users.length} users built in ${Date.now() - started}ms`);
      } catch (err) {
        status.error = err.message;
        log.warn(`[home] ${why} round failed: ${err.message}`);
      } finally {
        status.building = false;
        round = null;
      }
    })();
    return round;
  };

  /** One user's lists again, a moment after their last change. */
  const rebuildSoon = (userId) => {
    if (!userId) return;
    const key = String(userId);
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(async () => {
      timers.delete(key);
      try {
        await ensureTable();
        await buildUser(key, await freshGlobals());
      } catch (err) {
        log.warn(`[home] ${key} not rebuilt: ${err.message}`);
      }
    }, DEBOUNCE_MS));
  };

  /** The stored lists for `userId`, or null. */
  const read = async (userId) => {
    await ensureTable();
    const rows = await runQuery(`SELECT body FROM ${TABLE} WHERE user_id = ? LIMIT 1`, [String(userId)]);
    return rows?.[0]?.body ? JSON.parse(rows[0].body) : null;
  };

  /** Whether today's round has run, for a start part-way through the day. */
  const builtToday = async () => {
    await ensureTable();
    const rows = await runQuery(`SELECT COUNT(*) AS n FROM ${TABLE} WHERE day = ?`, [londonDay(clock())]);
    return Number(rows?.[0]?.n) > 0;
  };

  return { buildAll, buildUser, rebuildSoon, read, builtToday, status: () => ({ ...status }) };
}
