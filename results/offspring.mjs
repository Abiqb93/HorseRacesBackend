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
 * Here the read is the names alone, on an index of (sireName, horseName) or
 * (damName, horseName) once it is there, each name's answer kept for twelve
 * hours, and at most DB_SLOTS of these reads run at once across every request,
 * so however many pages ask, most of the pool stays free for everything else.
 */

import { TABLE, nameKey } from "./indexes.mjs";

export const KINDS = {
  sire: { column: "sireName", index: { name: "idx_sire_horse", columns: ["sireName", "horseName"] } },
  dam: { column: "damName", index: { name: "idx_dam_horse", columns: ["damName", "horseName"] } },
};

export const CACHE_MS = 12 * 60 * 60 * 1000;
export const DB_SLOTS = 2;
export const BATCH = 100;
/** Names asked for in one request, per kind. */
export const MAX_NAMES = 500;

/** Up to `slots` tasks at a time; the rest wait their turn. */
export const createGate = (slots) => {
  let active = 0;
  const waiting = [];
  const next = () => {
    if (active >= slots || !waiting.length) return;
    active += 1;
    const { task, resolve, reject } = waiting.shift();
    task().then(resolve, reject).finally(() => { active -= 1; next(); });
  };
  return (task) => new Promise((resolve, reject) => { waiting.push({ task, resolve, reject }); next(); });
};

/**
 * `indexFor(kind)` gives the name of the kind's index when it is there, or
 * null; the read is forced onto it when there is one.
 */
export function createOffspring({ runQuery, indexFor = () => null, now = () => Date.now(), slots = DB_SLOTS }) {
  const gate = createGate(slots);
  const cache = new Map(); // "sire:frankel" -> { at, horses }
  const pending = new Map(); // "sire:frankel" -> Promise<horses>

  const read = (kind, names) => gate(async () => {
    const { column } = KINDS[kind];
    const index = indexFor(kind);
    const rows = await runQuery(
      `SELECT /*+ MAX_EXECUTION_TIME(120000) */ DISTINCT ${column} AS parent, horseName
         FROM ${TABLE}${index ? ` FORCE INDEX (\`${index}\`)` : ""}
        WHERE ${column} IN (${names.map(() => "?").join(",")})`,
      names,
    );
    const found = new Map(names.map((n) => [nameKey(n), new Set()]));
    for (const r of rows) {
      if (r.horseName) found.get(nameKey(r.parent))?.add(r.horseName);
    }
    return found;
  });

  /** { [name as asked]: [horse names] } for each of `names`. */
  const lookup = async (kind, names) => {
    if (!KINDS[kind]) throw new Error(`unknown kind ${kind}`);
    const asked = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))].slice(0, MAX_NAMES);
    const t = now();
    const missing = [];
    for (const n of asked) {
      const key = `${kind}:${nameKey(n)}`;
      const hit = cache.get(key);
      if ((hit && t - hit.at < CACHE_MS) || pending.has(key)) continue;
      missing.push(n);
    }
    const byKey = new Map();
    for (const n of missing) byKey.set(nameKey(n), n);
    const unique = [...byKey.values()];
    for (let i = 0; i < unique.length; i += BATCH) {
      const batch = unique.slice(i, i + BATCH);
      const done = read(kind, batch);
      for (const n of batch) {
        const key = `${kind}:${nameKey(n)}`;
        const one = done.then((found) => {
          const horses = [...(found.get(nameKey(n)) ?? [])].sort();
          cache.set(key, { at: now(), horses });
          return horses;
        }).finally(() => pending.delete(key));
        one.catch(() => {});
        pending.set(key, one);
      }
    }
    const out = {};
    await Promise.all(asked.map(async (n) => {
      const key = `${kind}:${nameKey(n)}`;
      out[n] = pending.has(key) ? await pending.get(key) : cache.get(key).horses;
    }));
    return out;
  };

  return { lookup };
}
