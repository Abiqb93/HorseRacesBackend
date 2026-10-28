/**
 * The names of the horses each sire or dam has had run in APIData_Table2,
 * for many sires and dams in one request.
 *
 * The home page needs only this, to mark the runners on the cards that are
 * by a tracked sire or out of a tracked dam, and was asking
 * /api/APIData_Table2/sire for each tracked sire in turn: every run of every
 * horse by it, all columns, with the Racing Post ratings joined on. Frankel
 * and Dubawi each ran past 90 s on 28 October, eight at a time from every
 * open home page, and the pool's ten connections went with them: sign-in
 * took 9 s and a one-row lookup 35 s while they ran.
 *
 * Read by sire, the answer is slow however it is asked: a sire's runners are
 * scattered across a table written a day at a time, and the same morning
 * Frankel and Dubawi's names alone ran into a two-minute cap. Read by date it
 * is cheap, because a month's rows sit together. So the whole list of
 * (sire, dam, horse) is read here a month at a time, through the date index,
 * on one connection with a pause between months, newest first, and kept in
 * memory; it answers once the latest year is in, the older months filling in
 * behind, and the recent months are read again every few hours. Every answer
 * after that is a lookup in memory.
 */

import { TABLE, nameKey } from "./indexes.mjs";

export const KINDS = { sire: "sireName", dam: "damName" };

/** How often the latest two months are read again. */
export const REFRESH_MS = 6 * 60 * 60 * 1000;
/** A pause between months, so other reads are not queued behind the walk. */
export const PAUSE_MS = 200;
/** The list answers once this many of the latest months are read. */
export const READY_MONTHS = 12;
/** A month that runs longer than this is read in halves. */
export const SLICE_CAP_MS = 120000;
/** Names asked for in one request, per kind. */
export const MAX_NAMES = 500;

const ymd = (d) => d.toISOString().slice(0, 10);
const monthStart = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const addMonths = (d, n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
const asDate = (v) => (v instanceof Date ? v : new Date(String(v).replace(" ", "T") + (String(v).length <= 10 ? "T00:00:00Z" : "Z")));

export function createOffspring({ runQuery, now = () => Date.now(), pauseMs = PAUSE_MS, readyMonths = READY_MONTHS, log = console }) {
  const bySire = new Map(); // nameKey(sire) -> Set(horse names)
  const byDam = new Map();
  const status = {
    state: "not built", complete: false, monthsRead: 0, monthsTotal: null, reading: null,
    slowestMonthMs: null, horses: 0, sires: 0, dams: 0, builtAt: null, tookMs: null, error: null,
  };
  let builtAt = null;
  let building = null;
  let firstReady = null;

  const add = (map, parent, horse) => {
    if (!parent || !horse) return;
    const key = nameKey(parent);
    let set = map.get(key);
    if (!set) map.set(key, (set = new Set()));
    set.add(horse);
  };

  const count = () => {
    const horses = new Set();
    for (const set of bySire.values()) for (const h of set) horses.add(h);
    Object.assign(status, { horses: horses.size, sires: bySire.size, dams: byDam.size });
  };

  /** One slice of dates; a slice that fails is cut in two and asked again, down to a week. */
  const readSlice = async (from, to) => {
    try {
      return await runQuery(
        `SELECT /*+ MAX_EXECUTION_TIME(${SLICE_CAP_MS}) */ DISTINCT sireName, damName, horseName
           FROM ${TABLE}
          WHERE meetingDate >= ? AND meetingDate < ?`,
        [ymd(from), ymd(to)],
      );
    } catch (err) {
      const span = to - from;
      if (span <= 7 * 86_400_000) throw err;
      const mid = new Date(from.getTime() + Math.floor(span / 2 / 86_400_000) * 86_400_000);
      return [...(await readSlice(from, mid)), ...(await readSlice(mid, to))];
    }
  };

  /**
   * Newest month first, so the horses running now are in hand soonest: the
   * list answers once `readyMonths` are read and the older months fill in
   * behind it.
   */
  const walk = async (from, onReady) => {
    const started = now();
    const [range] = await runQuery(`SELECT MIN(meetingDate) AS lo, MAX(meetingDate) AS hi FROM ${TABLE}`, []);
    if (!range?.lo) throw new Error(`${TABLE} holds no dates`);
    const lo = monthStart(asDate(range.lo));
    const first = from && from > lo ? from : lo;
    const months = [];
    for (let m = monthStart(asDate(range.hi)); m >= first; m = addMonths(m, -1)) months.push(m);
    if (!from) Object.assign(status, { monthsTotal: months.length, monthsRead: 0 });
    let read = 0;
    for (const month of months) {
      const t = now();
      if (!from) status.reading = ymd(month).slice(0, 7);
      const rows = await readSlice(month, addMonths(month, 1));
      for (const r of rows) {
        add(bySire, r.sireName, r.horseName);
        add(byDam, r.damName, r.horseName);
      }
      read += 1;
      if (!from) {
        status.monthsRead = read;
        status.slowestMonthMs = Math.max(status.slowestMonthMs ?? 0, now() - t);
        if (read === readyMonths) { count(); onReady(); }
      }
      if (pauseMs) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
    count();
    Object.assign(status, { reading: null, tookMs: now() - started, error: null });
    if (!from) status.complete = true;
    onReady();
    log.log(`[offspring] ${read} months read: ${status.sires} sires, ${status.dams} dams, ${status.horses} horses, ${now() - started}ms`);
  };

  /** Starts a walk unless one is running: the whole table, or from `from`. */
  const start = (from) => {
    if (building) return firstReady ?? building;
    let resolveReady = null;
    let rejectReady = null;
    let pending = null;
    if (!builtAt) {
      status.state = "building";
      pending = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      pending.catch(() => {});
      firstReady = pending;
    }
    const onReady = () => {
      if (builtAt) return;
      builtAt = now();
      Object.assign(status, { state: "ready", builtAt: new Date(builtAt).toISOString() });
      resolveReady?.();
    };
    building = walk(from, onReady)
      .catch((err) => {
        Object.assign(status, { error: err.message, reading: null });
        if (!builtAt) {
          status.state = "failed";
          rejectReady?.(err);
        }
        log.warn(`[offspring] not read: ${err.message}`);
      })
      .finally(() => { building = null; firstReady = null; });
    return pending ?? building;
  };

  /** Resolves once the list answers; a stale one answers while its latest months are read again. */
  const ready = async () => {
    if (!builtAt) return start(null);
    if (now() - builtAt > REFRESH_MS && !building) {
      builtAt = now();
      start(addMonths(monthStart(new Date(now())), -1));
    }
  };

  /** { [name as asked]: [horse names] } for each of `names`. */
  const lookup = async (kind, names) => {
    if (!KINDS[kind]) throw new Error(`unknown kind ${kind}`);
    const asked = [...new Set((names || []).map((n) => String(n).trim()).filter(Boolean))].slice(0, MAX_NAMES);
    if (!asked.length) return {};
    await ready();
    const map = kind === "sire" ? bySire : byDam;
    return Object.fromEntries(asked.map((n) => [n, [...(map.get(nameKey(n)) ?? [])].sort()]));
  };

  return { lookup, start, status: () => ({ ...status }) };
}
