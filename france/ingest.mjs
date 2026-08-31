/**
 * France ingestion: fetch, merge, stage, resolve identity, promote.
 *
 * The shape of this is set by one measured fact. PMU does not carry most
 * French racing -- on 22 Aug 2026 France ran four thoroughbred meetings and
 * PMU priced one, because the other three were PMH fixtures with on-course
 * betting only. 42% of that day's runners existed only in the France Galop
 * scrape. So France Galop is the spine that defines the fixture list, and PMU
 * supplies history plus what only it holds: starting price, in-running
 * comments, per-runner times.
 *
 * The two sources also split by time. France Galop publishes a rolling
 * three-day public window and returns a Microsoft login page for anything
 * older, so all backfill goes through PMU, which reaches back to 2013.
 */

import { fetchFrenchDay, fetchFixtures, AuthWallError } from "./franceGalopClient.mjs";
import { normalizeFGDay, isThoroughbred } from "./normalizeFG.mjs";
import { fetchFrenchRunnersForDate } from "./pmuClient.mjs";
import { normalizeDay } from "./normalize.mjs";
import { mergeDay } from "./mergeSources.mjs";
import { matchHorse, DECISION } from "./matchHorse.mjs";
import { FranceStore } from "./store.mjs";

/** France Galop's public window is only these three days. */
export const DAYS = ["yesterday", "today", "tomorrow"];

export function isoForDay(day, now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(12, 0, 0, 0);
  if (day === "yesterday") d.setUTCDate(d.getUTCDate() - 1);
  if (day === "tomorrow") d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

/**
 * Decide, for every runner on the card, whether it is a horse we already hold
 * or one we have never seen.
 *
 * The matcher is three-state -- AGREE, ABSENT, CONTRADICT -- rather than a
 * similarity score, because our own rows are patchy: 20 of 55 name matches in
 * the sample had a null dam. Absent evidence must not read as disagreement, or
 * every incomplete record blocks its own match. Only a contradiction blocks.
 *
 * Roughly 8% of runners land in REVIEW. That is the number worth watching: it
 * is a person's queue, not a failure rate.
 */
export async function resolveIdentities(store, rows, { log = console.error } = {}) {
  const resolved = new Map();
  const counts = { link: 0, create: 0, review: 0 };
  const candidateCache = new Map();

  for (const row of rows) {
    if (!row.horseName) continue;

    let candidates = candidateCache.get(row.horseName);
    if (!candidates) {
      candidates = await store.findHorseCandidates(row.horseName);
      candidateCache.set(row.horseName, candidates);
    }

    const result = matchHorse(row, candidates);

    if (result.decision === DECISION.LINK && result.candidate) {
      resolved.set(row, { horseCode: result.candidate.horseCode, decision: "link" });
      counts.link += 1;
    } else if (result.decision === DECISION.REVIEW) {
      resolved.set(row, { horseCode: null, decision: "review" });
      counts.review += 1;
      await store.queueReview(row, result);
    } else {
      // A horse we do not hold. The row still lands in APIData_Table2 with no
      // horseCode -- it is a real run and belongs in the record whether or not
      // we already knew the horse.
      resolved.set(row, { horseCode: null, decision: "create" });
      counts.create += 1;
    }
  }

  log(
    `  identity: ${counts.link} linked, ${counts.create} new, ${counts.review} for review`,
  );
  return { resolved, counts };
}

/**
 * Fetch one day from both sources and merge.
 *
 * France Galop failing is not fatal: PMU still covers the meetings it prices,
 * and a partial day beats none. The failure is recorded on the run so the gap
 * is visible rather than silent.
 */
async function collectDay({ day, iso, useFg = true, usePmu = true, log }) {
  const summary = { day: day ?? null, iso, fg: 0, pmu: 0, fgError: null };
  let fgRows = [];
  let fixtures = [];

  if (useFg && day) {
    try {
      fixtures = await fetchFixtures(day);
      fgRows = normalizeFGDay(await fetchFrenchDay(day)).filter(isThoroughbred);
    } catch (err) {
      summary.fgError = err instanceof AuthWallError ? "auth wall" : err.message;
      log(`  France Galop failed for ${day}: ${summary.fgError}`);
    }
  }

  const pmuRows = usePmu ? normalizeDay(await fetchFrenchRunnersForDate(iso), iso) : [];
  summary.fg = fgRows.length;
  summary.pmu = pmuRows.length;

  const { rows, stats } = mergeDay(fgRows, pmuRows);
  return { summary, rows, stats, fixtures };
}

/**
 * The full pipeline for one date. Everything else here is a wrapper around it.
 *
 * `dryRun` stops short of writing to APIData_Table2 but still does the fetch,
 * the merge and the identity resolution against real candidates, so the counts
 * it reports are the counts a live run would produce.
 */
export async function ingest(
  store,
  { day = null, iso = null, useFg = true, usePmu = true, dryRun = false, log = console.error } = {},
) {
  const targetIso = iso ?? isoForDay(day);
  if (!isIso(targetIso)) throw new Error(`ingest needs a date, got ${targetIso}`);

  const runId = await store.startRun(day ? `day:${day}:${targetIso}` : `date:${targetIso}`);
  const stats = { iso: targetIso, dryRun };

  try {
    const { summary, rows, stats: mergeStats, fixtures } = await collectDay({
      day,
      iso: targetIso,
      useFg,
      usePmu,
      log,
    });
    Object.assign(stats, summary, { merge: mergeStats, merged: rows.length });

    if (!rows.length) {
      log(`  ${targetIso}: no French thoroughbred racing found`);
      await store.finishRun(runId, { ok: true, stats });
      return stats;
    }

    if (fixtures.length) await store.upsertCourseRegistry(fixtures);
    stats.staged = await store.stageRows(rows);

    const { resolved, counts } = await resolveIdentities(store, rows, { log });
    stats.identity = counts;

    if (dryRun) {
      log(`  ${targetIso}: dry run — ${rows.length} rows not written`);
      await store.finishRun(runId, { ok: true, stats });
      return stats;
    }

    stats.promoted = await store.promoteToApiData(rows, { resolved });

    // The existing France page reads FranceRaceRecords, so keep it current.
    // Clearing the date first is what makes a re-run idempotent for that table,
    // which has no natural key to upsert on.
    await store.clearFranceRaceRecordsForDate(targetIso);
    stats.franceRaceRecords = await store.writeFranceRaceRecords(rows);

    log(
      `  ${targetIso}: ${stats.promoted.inserted} rows into APIData_Table2 ` +
        `(${stats.promoted.races} races, ${stats.promoted.deleted} replaced)`,
    );

    await store.finishRun(runId, { ok: true, stats });
    return stats;
  } catch (err) {
    await store.finishRun(runId, { ok: false, stats, error: err.message });
    throw err;
  }
}

export const ingestDay = (store, day, opts = {}) => ingest(store, { ...opts, day });
export const ingestDate = (store, iso, opts = {}) => ingest(store, { ...opts, iso, useFg: false });

/**
 * Walk a date range through PMU. Resumable by construction: staging upserts on
 * natural keys and promotion replaces a race rather than appending to it, so
 * re-running a range corrects it in place.
 */
export async function backfill(store, from, to, { log = console.error, dryRun = false } = {}) {
  if (!isIso(from) || !isIso(to)) throw new Error("backfill needs YYYY-MM-DD dates");

  const results = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);

  while (cursor <= end) {
    const iso = cursor.toISOString().slice(0, 10);
    try {
      results.push(await ingestDate(store, iso, { log, dryRun }));
    } catch (err) {
      log(`  ${iso} failed: ${err.message}`);
      results.push({ iso, error: err.message });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return results;
}

/**
 * Re-pull the recent past.
 *
 * Not optional. French results are amended after the fact -- disqualifications,
 * non-runners, stewards' decisions -- so a single pass at result time drifts
 * away from the official record within days.
 */
/**
 * Rebuilds France's rows in APIData_Table2 from France's own staged tables.
 *
 * Something else that maintains APIData_Table2 refreshes a window of recent
 * dates and deletes French rows as it goes: on 31 August the results for the
 * 27th onward were gone while the 24th to 26th, which had aged out of that
 * window, survived. Re-ingesting from PMU puts them back, but takes minutes a
 * day and cannot sensibly run often enough to keep the gap short.
 *
 * This repairs from fr_raw_runner instead, which France owns and which nothing
 * else touches. The staged payload is the normalised row, so the repair is a
 * read, an identity resolve and a write -- no network at all -- which is cheap
 * enough to run hourly.
 *
 * It is a repair, not an ingest: it will not invent a day France never staged,
 * and a date with nothing staged is reported rather than silently skipped.
 */
export async function repromote(store, { from, to, dryRun = false, log = console.error } = {}) {
  const staged = await store.stagedRowsBetween(from, to);
  const before = await store.apiDataCountsByDate(from, to);

  const byDate = new Map();
  for (const row of staged) {
    const iso = String(row.meetingDate).slice(0, 10);
    if (!byDate.has(iso)) byDate.set(iso, []);
    byDate.get(iso).push(row);
  }

  const dates = [...byDate.keys()].sort();
  const results = [];
  for (const iso of dates) {
    const rows = byDate.get(iso);
    const held = before[iso] ?? 0;
    if (dryRun) {
      results.push({ date: iso, staged: rows.length, held, wouldWrite: rows.length !== held });
      continue;
    }
    // Only rewrite a day that has actually lost rows. A day already whole is
    // left alone, so the hourly pass costs one count query on a normal day.
    if (held === rows.length) {
      results.push({ date: iso, staged: rows.length, held, repaired: false });
      continue;
    }
    const { resolved } = await resolveIdentities(store, rows, { log });
    const promoted = await store.promoteToApiData(rows, { resolved });
    results.push({ date: iso, staged: rows.length, held, repaired: true, ...promoted });
    log(`  repromote ${iso}: held ${held}, staged ${rows.length}, wrote ${promoted.inserted}`);
  }

  const repaired = results.filter((r) => r.repaired).length;
  return { from, to, dates: dates.length, repaired, results };
}

export async function reconcile(store, days = 7, { log = console.error } = {}) {
  const results = [];
  for (let i = 1; i <= days; i += 1) {
    const d = new Date();
    d.setUTCHours(12, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    try {
      results.push(await ingestDate(store, iso, { log }));
    } catch (err) {
      log(`  reconcile ${iso} failed: ${err.message}`);
    }
  }
  return results;
}

/** Convenience for callers that do not want to manage a store instance. */
export function createStore() {
  return new FranceStore();
}
