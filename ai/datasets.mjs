/**
 * The published datasets, held in memory.
 *
 * BlandfordAI reads the site's static JSON - the sectional ratings board, the
 * stallion roster, the prospects index - the same way the pages do, over HTTP.
 * It used to fetch the file afresh on every call: a question that read the
 * sectional board one cohort at a time pulled the same 2.5 MB file eighteen
 * times in one turn, parsing it each time, and the turn's clock was mostly
 * that. The files change once a night. So each one is kept here after its
 * first read and served from memory for a while; after that it is asked for
 * again with If-None-Match, and a 304 costs a round-trip and no bytes.
 *
 * Two calls for the same file at the same moment - the model asks for several
 * slices in parallel - share one fetch.
 */

/** How long a file is served from memory before the site is asked whether it changed. */
export const DATASET_FRESH_MS = 15 * 60_000;

const FETCH_TIMEOUT_MS = 30_000;

/** url -> { json, etag, lastModified, fetchedAt, bytes } */
const cache = new Map();
/** url -> Promise, for a fetch in flight */
const inflight = new Map();

/** Between tests, and if a file is known to have changed under the process. */
export function resetDatasetCache() {
  cache.clear();
  inflight.clear();
}

/** What is held, for the status endpoint and for tests. */
export function datasetCacheStatus() {
  return [...cache.entries()].map(([url, e]) => ({
    url,
    bytes: e.bytes,
    etag: e.etag || undefined,
    fetchedAt: new Date(e.fetchedAt).toISOString(),
  }));
}

async function fetchJson(url, { etag, lastModified } = {}, fetchImpl, now) {
  const headers = {};
  if (etag) headers["If-None-Match"] = etag;
  else if (lastModified) headers["If-Modified-Since"] = lastModified;
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (res.status === 304) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return {
    json: JSON.parse(text),
    bytes: text.length,
    etag: res.headers.get("etag") || "",
    lastModified: res.headers.get("last-modified") || "",
    fetchedAt: now(),
  };
}

/**
 * The parsed file at `url`: from memory while fresh, revalidated with the
 * site once it is not, and fetched outright the first time. Returns the JSON
 * value and whether it came from memory.
 *
 * `fetchImpl` and `now` exist for tests.
 */
export async function loadDataset(url, { fetchImpl = fetch, now = Date.now, freshMs = DATASET_FRESH_MS } = {}) {
  const held = cache.get(url);
  if (held && now() - held.fetchedAt < freshMs) return { json: held.json, cached: true };

  if (inflight.has(url)) return inflight.get(url);

  const work = (async () => {
    try {
      const fresh = await fetchJson(url, held || {}, fetchImpl, now);
      if (fresh === null) {
        // Unchanged. The copy we hold is good for another window.
        held.fetchedAt = now();
        return { json: held.json, cached: true, revalidated: true };
      }
      cache.set(url, fresh);
      return { json: fresh.json, cached: false };
    } catch (err) {
      // A stale copy beats no copy: the site being briefly unreachable at the
      // moment a file turns 15 minutes old should not fail the question.
      if (held) return { json: held.json, cached: true, stale: err.message };
      throw err;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, work);
  return work;
}

/* ------------------------------------------------------------------ shape */

const SHORT = 48;
const short = (s) => (s.length > SHORT ? `${s.slice(0, SHORT - 3)}...` : s);

/**
 * The shape of a JSON value, compactly: keys and what sits under them, an
 * array's length and the shape of its first item, example values for the
 * leaves. Deep enough to see the row fields of an array four levels down
 * (windows.w7.<cohort>[].horse is where the sectional board keeps them), and
 * bounded so that a file of twenty thousand keys describes itself in a few
 * hundred bytes.
 *
 * This is what describe_dataset returns. Without it the model had only a
 * one-line description to go on and guessed its way into the files - a path
 * that did not exist, then one cohort at a time.
 */
export function describeShape(value, depth = 5, { maxKeys = 24, listKeys = 12 } = {}) {
  if (value === null || typeof value !== "object") return typeof value === "string" ? short(value) : value;

  if (Array.isArray(value)) {
    if (depth <= 0) return `array[${value.length}]`;
    return { array: value.length, item: value.length ? describeShape(value[0], depth - 1, { maxKeys, listKeys }) : null };
  }

  const keys = Object.keys(value);
  if (depth <= 0) return `object{${keys.length} keys}`;
  if (keys.length > maxKeys) {
    // A dictionary rather than a record: the keys are data (horse names,
    // course|distance cells), so list a few and describe one entry.
    return {
      object: keys.length,
      keys: keys.slice(0, listKeys),
      item: describeShape(value[keys[0]], depth - 1, { maxKeys, listKeys }),
    };
  }
  return Object.fromEntries(keys.map((k) => [k, describeShape(value[k], depth - 1, { maxKeys, listKeys })]));
}

/**
 * The shape as text the model can read, kept under `limit` characters by
 * describing less deeply when the file is wide.
 */
export function describeShapeText(value, limit = 6000) {
  for (let depth = 5; depth >= 1; depth--) {
    const text = JSON.stringify(describeShape(value, depth));
    if (text.length <= limit) return text;
  }
  return JSON.stringify(describeShape(value, 1)).slice(0, limit);
}

/* ----------------------------------------------------------------- groups */

/**
 * An object of arrays - one per cohort, one per window - as one array, each
 * row carrying which group it came from as `_group`. The sectional board is
 * laid out as windows.w7.<cohort>[]; a question over "every cohort in the last
 * 7 days" is one select over the flattened window rather than six calls.
 *
 * Anything that is not an object whose values are all arrays is returned as
 * it is.
 */
export function flattenGroups(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const entries = Object.entries(value);
  if (!entries.length || !entries.every(([, v]) => Array.isArray(v))) return value;
  const out = [];
  for (const [group, rows] of entries) {
    for (const row of rows) {
      out.push(row && typeof row === "object" && !Array.isArray(row) ? { _group: group, ...row } : { _group: group, value: row });
    }
  }
  return out;
}
