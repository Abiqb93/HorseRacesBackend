/**
 * The pedigree source, called slowly and one at a time.
 *
 * A parse.bot scraper sitting over a pedigree database. Two things about it
 * shape every decision here:
 *
 *   1. It is slow — 20 to 38 seconds for a pedigree, measured across a dozen
 *      calls. Nothing can wait on it synchronously without the caller
 *      noticing, and nothing should call it that does not have to.
 *   2. It is protected. It answered one request during development with
 *      "Site protection is currently blocking all proxies; retry later",
 *      recovering a few minutes on. Hammering it is how that becomes
 *      permanent.
 *
 * So requests are serialised through a single queue with a deliberate gap
 * between them, and a block backs the whole queue off rather than just the
 * request that hit it. Being slow is the design, not a limitation of it: a
 * pedigree never changes, so everything here runs once per horse ever, and
 * the cache in store.mjs answers everything after that.
 */

/**
 * Which parse.bot resource we call.
 *
 * An id, in configuration, because it is somebody else's identifier and it has
 * already moved once. parse.bot's own SDK example reaches Equineline through a
 * *named* API — `parse_apis.equineline_com_api`, `client.horses.search(...)`,
 * `client.pedigrees.get(reference_number=...)` — while this UUID is a personal
 * scraper instance created for us. On 11 September calls to it began returning
 * "Scraper with ID 28f5d3ac-… not found", intermittently, between successes:
 * exactly what a resource being retired underneath us looks like.
 *
 * Probing api.parse.bot without a key shows `/scraper/{id}/{endpoint}` is the
 * only route family it serves — `/api/...`, `/v1/...` and the rest are 404 —
 * so the SDK sits on this same surface with a different id. Switching to it is
 * therefore a change of one environment variable rather than a deploy, and
 * the two can be compared without touching code:
 *
 *   PARSE_SCRAPER_ID=equineline_com_api
 *
 * The default stays the UUID we have always used, so nothing changes until
 * someone sets it.
 */
const SCRAPER = process.env.PARSE_SCRAPER_ID || "28f5d3ac-8f20-4d52-93f4-51720c4e6496";
const BASE = `https://api.parse.bot/scraper/${SCRAPER}`;

/**
 * The gap between two upstream calls.
 *
 * Deliberately longer than the call itself. A pedigree takes ~25 seconds, so
 * a 45-second floor means the source sees roughly one request a minute from
 * us at absolute most — slower than a person clicking through the site, which
 * is the bar worth clearing. Raise it with PEDIGREE_MIN_INTERVAL_MS; there is
 * no reason to lower it.
 */
/*
 * Read at each use rather than at import, so a test can wind the clock down
 * without waiting three quarters of a minute per case. Reading them once at
 * module load made the suite take minutes and would have got it skipped.
 */
const num = (name, fallback) => Number(process.env[name]) || fallback;

const minIntervalMs = () => num("PEDIGREE_MIN_INTERVAL_MS", 45_000);

/** Added to every gap, so our calls do not arrive on a metronome. */
const jitterMs = () => num("PEDIGREE_JITTER_MS", 15_000);

/** After a block, wait this long before the next attempt, then double. */
const blockBackoffMs = () => num("PEDIGREE_BLOCK_BACKOFF_MS", 5 * 60_000);
const BLOCK_BACKOFF_MAX_MS = 60 * 60_000;

const requestTimeoutMs = () => num("PEDIGREE_TIMEOUT_MS", 120_000);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The source is blocking us; this is not the request's fault. */
export class BlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "BlockedError";
    this.blocked = true;
  }
}

/** The request named a horse the source could not resolve to exactly one. */
export class AmbiguousError extends Error {
  constructor(message) {
    super(message);
    this.name = "AmbiguousError";
    this.ambiguous = true;
    // The horses it could have meant, where the source listed them, so a
    // caller can offer the choice instead of repeating the sentence.
    const { count, matches } = ambiguousMatches(message);
    this.count = count;
    this.matches = matches;
  }
}

/** Split on a separator, but never inside brackets: "(IRE)" is part of a name. */
function splitOutside(s, sep) {
  const out = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === sep && depth === 0) {
      out.push(s.slice(from, i));
      from = i + 1;
    }
  }
  out.push(s.slice(from));
  return out;
}

/** The "(" that the ")" at `close` shuts, or -1. */
function openingParen(s, close) {
  let depth = 0;
  for (let i = close; i >= 0; i -= 1) {
    if (s[i] === ")") depth += 1;
    else if (s[i] === "(" && --depth === 0) return i;
  }
  return -1;
}

const SEX_WORD = /^(horse|mare|gelding|colt|filly|ridgling|rig|stallion|male|female)$/i;
const blank = (s) => {
  const t = String(s ?? "").trim();
  return !t || /^(none|null|unknown|n\/a|\?)$/i.test(t) ? null : t;
};

/**
 * The horses an ambiguous answer names, in the shape `search_horses` lists
 * them.
 *
 * The source does not just refuse a name that fits several horses, it says
 * which ones:
 *
 *   2 horses matched; disambiguate with reference_number, foaling_year or
 *   dam_name: =Antisana (GB) (2015, Mare, Dubawi (IRE) x =Lava Flow (IRE),
 *   reference_number=9924938); Antisana (1933, Mare, *Snob II x *Musidora,
 *   reference_number=15240)
 *
 * That list is what a person needs to pick the right horse, and it came with
 * the refusal, so reading it costs nothing. Asking `search_horses` for the
 * same list would be another place in the queue and most of a minute.
 *
 * Only an entry carrying its reference number is kept: the reference is what
 * the second request sends, and an entry without one could not be picked.
 * Names, sires and dams keep their sigils and country suffixes as the source
 * writes them, as `search_horses` does. `count` is the number the source says
 * matched, which can be more than it listed; a wording this does not
 * recognise gives no matches, never wrong ones.
 */
export function ambiguousMatches(message) {
  const text = String(message ?? "");
  const said = text.match(/(\d+)\s+horses?\s+matched/i);
  const count = said ? Number(said[1]) : null;
  const matches = [];
  for (const chunk of splitOutside(text, ";")) {
    const ref = /reference_number\s*[=:]\s*(\d+)\s*\)/i.exec(chunk);
    if (!ref) continue;
    const open = openingParen(chunk, ref.index + ref[0].length - 1);
    if (open < 0) continue;
    // The sentence in front of the first entry ends in a colon, and a horse's
    // name cannot contain one.
    const name = blank(chunk.slice(0, open).split(":").pop());
    if (!name) continue;
    let foalingYear = null;
    let sex = null;
    let sire = null;
    let dam = null;
    for (const field of splitOutside(chunk.slice(open + 1, ref.index), ",")) {
      const f = field.trim();
      if (foalingYear === null && /^\d{4}$/.test(f)) foalingYear = Number(f);
      else if (sex === null && SEX_WORD.test(f)) sex = f;
      else if (sire === null && dam === null && f.includes(" x ")) {
        const at = f.indexOf(" x ");
        sire = blank(f.slice(0, at));
        dam = blank(f.slice(at + 3));
      }
    }
    matches.push({ name, foaling_year: foalingYear, sex, sire, dam, reference_number: Number(ref[1]) });
  }
  return { count, matches };
}

const isBlockMessage = (m) =>
  /site protection|blocking all proxies|rate.?limit|too many requests/i.test(String(m ?? ""));

/**
 * One queue for the whole process.
 *
 * Serialised rather than rate-limited-in-parallel: two concurrent requests
 * that each respect a delay still arrive together, which is exactly the shape
 * a bot filter is looking for. Every caller waits its turn.
 */
class Throttle {
  constructor() {
    this.tail = Promise.resolve();
    this.lastCall = 0;
    this.blockedUntil = 0;
    this.backoff = null;
  }

  /** Forget any backoff and any gap. For tests, not for production code. */
  reset() {
    this.lastCall = 0;
    this.blockedUntil = 0;
    this.backoff = null;
  }

  /** How long a caller would wait right now, for an honest 503 body. */
  waitEstimateMs() {
    const gap = Math.max(0, this.lastCall + minIntervalMs() - Date.now());
    const block = Math.max(0, this.blockedUntil - Date.now());
    return Math.max(gap, block);
  }

  get isBlocked() {
    return Date.now() < this.blockedUntil;
  }

  run(fn) {
    const turn = this.tail.then(async () => {
      const blockWait = this.blockedUntil - Date.now();
      if (blockWait > 0) await sleep(blockWait);

      const gap =
        this.lastCall + minIntervalMs() + Math.random() * jitterMs() - Date.now();
      if (gap > 0) await sleep(gap);

      this.lastCall = Date.now();
      try {
        const out = await fn();
        // A clean answer means we are welcome again; reset the escalation.
        this.backoff = null;
        return out;
      } catch (err) {
        if (err instanceof BlockedError) {
          const wait = this.backoff ?? blockBackoffMs();
          this.blockedUntil = Date.now() + wait;
          this.backoff = Math.min(wait * 2, BLOCK_BACKOFF_MAX_MS);
        }
        throw err;
      } finally {
        this.lastCall = Date.now();
      }
    });
    // The queue must survive a failed request, or one error stops everything
    // behind it forever.
    this.tail = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }
}

export const throttle = new Throttle();

function apiKey() {
  const k = process.env.PARSE_API_KEY;
  if (!k) {
    const err = new Error("PARSE_API_KEY is not configured on this server");
    err.unconfigured = true;
    throw err;
  }
  return k;
}

/**
 * One call, already inside the queue.
 *
 * The key travels in a header and is never put in the URL, so nothing that
 * logs a URL can leak it.
 */
async function call(endpoint, params, { fetchImpl = fetch } = {}) {
  const key = apiKey();
  const url = new URL(`${BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  const res = await fetchImpl(url, {
    headers: { "X-API-Key": key },
    signal: AbortSignal.timeout(requestTimeoutMs()),
  });
  const text = await res.text();

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    if (isBlockMessage(text)) throw new BlockedError("upstream is blocking requests");
    throw new Error(`${endpoint}: HTTP ${res.status}, unparseable body`);
  }

  const message = body?.error?.message ?? body?.error ?? null;
  if (isBlockMessage(message)) throw new BlockedError(String(message));
  if (res.status === 429 || res.status === 503) {
    throw new BlockedError(`upstream returned HTTP ${res.status}`);
  }
  if (message && /reference_number/.test(String(message))) {
    throw new AmbiguousError(String(message));
  }
  if (!res.ok || body?.status === "error") {
    throw new Error(`${endpoint}: ${message ?? `HTTP ${res.status}`}`);
  }
  return body.data;
}

export function searchHorses({ name, year, dam }, opts = {}) {
  return throttle.run(() =>
    call("search_horses", { horse_name: name, foaling_year: year, dam_name: dam }, opts),
  );
}

export function getPedigree({ name, year, dam, ref }, opts = {}) {
  return throttle.run(() =>
    call(
      "get_pedigree",
      { horse_name: name, foaling_year: year, dam_name: dam, reference_number: ref },
      opts,
    ),
  );
}
