/**
 * A mare's pedigree, fetched in the background the moment she is added.
 *
 * A mare added from our racing data arrived as a name, a year and a rating,
 * and sat on the list as "no Equineline reference" until somebody found the
 * Pedigrees page and pressed a button there; one added from Equineline had
 * her chart fetched, but only by the page that added her, and only while that
 * tab stayed open. Prudenzia (2005) was the first kind. Now the server does
 * it, for every way a mare is added — the page, the stallion-prospects
 * picker, the seed script — and goes on doing it after the tab is closed.
 *
 * The source is slow and queued (a call takes ~25 seconds and the client
 * leaves 45 seconds between calls, so the source sees us arriving slower than
 * a person would), so the add answers at once and the fetch runs behind it.
 * What became of it is kept here per mare, in memory: pending, then held,
 * ambiguous (the source named several horses and none was plainly hers) or
 * failed (with the real reason, which until now was lost). A restart forgets
 * it, which is fine: whether the chart is held is read from the cache, and a
 * fetch can be asked for again.
 *
 * Two sources. Equineline first, through the scraper, because its record is
 * the richer (reference numbers, dosage, nicking); then Arion's 5x5 grid
 * (`arion/pedigreeGrid.mjs`), which holds the same five generations and
 * answers in seconds on the desk's unmetered subscription. A key the
 * scraper rejects is remembered for a while, so the mares added after it
 * go straight to Arion rather than each waiting a turn in the scraper's
 * queue to be told the same thing. A fetch can also be asked of one source
 * by name (`source: "arion"`), as the row's "try Arion" does.
 *
 * Everything that talks to the database or the sources is handed in, so this
 * can be tested without either.
 */

/** A country out of "=Antisana (GB)" or "Lady Vivian (IRE) 2022": the bracketed code, if any. */
const countryOf = (s) => String(s ?? "").match(/\(([A-Za-z]{2,3})\)/)?.[1]?.toUpperCase() ?? null;

const year = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 1700 ? n : null;
};

/** The bare name, without the source's sigils and country suffix. */
const bare = (s) =>
  String(s ?? "")
    .replace(/^[=*]+/, "")
    .replace(/\s*\([A-Za-z]{2,3}\)\s*$/, "")
    .trim()
    .toLowerCase();

const FEMALE = /^(mare|filly|female)$/i;

/**
 * Which of the horses the source named is this mare.
 *
 * Her foaling year must agree where both are known; so must the country, and
 * the sire's name, where both are known; and a horse the source calls a colt,
 * horse or gelding is not a mare. One left is hers; none or several is not a
 * guess to make — a wrong chart attached to the right mare is invisible, and
 * the page can offer the choice instead.
 */
export function pickHers(matches = [], mare = {}) {
  const wantYear = year(mare.foaling_year);
  const wantCountry = String(mare.country_code ?? "").toUpperCase() || null;
  const wantSire = bare(mare.sire_name) || null;
  const fits = matches.filter((m) => {
    if (!m?.reference_number) return false;
    const y = year(m.foaling_year);
    if (wantYear && y && y !== wantYear) return false;
    const c = countryOf(m.name);
    if (wantCountry && c && c !== wantCountry) return false;
    const s = bare(m.sire) || null;
    if (wantSire && s && s !== wantSire) return false;
    if (m.sex && !FEMALE.test(String(m.sex))) return false;
    return true;
  });
  return fits.length === 1 ? fits[0] : null;
}

/** What a failure is called on the mare's row, in the desk's words. */
export function describeFailure(err) {
  if (err?.rejectedKey) return "the pedigree source is rejecting the server's API key (PARSE_API_KEY needs replacing)";
  if (err?.unconfigured) return String(err.message ?? "pedigree lookup is not configured on this server");
  if (err?.blocked) return "the pedigree source is throttling us; it will be tried again";
  const m = String(err?.message ?? "the lookup failed");
  // "get_pedigree: No horse matched" is the source's sentence; the prefix is ours
  return m.replace(/^get_pedigree:\s*/i, "");
}

export const KEEP_MS = 6 * 60 * 60 * 1000;
/** After the scraper rejects the key, this long before it is asked again. */
export const SKIP_EQUINELINE_MS = 15 * 60 * 1000;

/**
 * The fetcher: one per process.
 *
 * `queue(mare)` says at once whether her chart is held, and if not starts the
 * fetch and answers "pending". `statusOf(id)` is what the list shows beside
 * her. `retry(mare, { ref })` runs it again, with the horse the desk picked
 * when the source could not tell.
 */
export function createMareFetcher({ runQuery, queryOne, loadClient, loadStore, loadGrid = null, log = console, now = () => Date.now(), keep = KEEP_MS }) {
  const jobs = new Map(); // mare id -> { state, message, matches, reference, source, at }
  let keyRejectedAt = 0;

  const tidy = () => {
    for (const [k, v] of jobs) if (v.at < now() - keep) jobs.delete(k);
  };
  const set = (id, patch) => {
    const next = { state: null, message: null, matches: null, reference: null, source: null, ...(jobs.get(String(id)) ?? {}), ...patch, at: now() };
    jobs.set(String(id), next);
    return next;
  };
  const statusOf = (id) => {
    const j = jobs.get(String(id));
    return j
      ? { state: j.state, message: j.message, matches: j.matches, reference: j.reference, source: j.source, blocked: Boolean(j.blocked), rejectedKey: Boolean(j.rejectedKey), at: new Date(j.at).toISOString() }
      : null;
  };

  /** The reference of a chart already held for her, by the same rule the list uses. */
  async function heldFor(mare) {
    if (mare.pedigree_reference) {
      const r = await queryOne("SELECT reference FROM pedigree_cache WHERE reference = ? LIMIT 1", [String(mare.pedigree_reference)]);
      if (r) return String(r.reference);
    }
    const y = year(mare.foaling_year);
    if (!y) return null;
    const store = await loadStore();
    const q = store.findQuery({ name: mare.horse_name, year: y });
    const r = q ? await queryOne(q.sql, q.args) : null;
    return r ? String(r.reference) : null;
  }

  const link = (id, reference) =>
    runQuery("UPDATE my_mares SET pedigree_reference = ? WHERE id = ? AND pedigree_reference IS NULL", [String(reference), id]);

  /**
   * Her chart from Equineline. A name the source cannot settle is settled
   * by her year, country and sire; when they cannot either, the error is
   * thrown on with `undecided` and the source's matches, for the desk.
   */
  async function fromEquineline(mare, ref) {
    const client = await loadClient();
    const y = year(mare.foaling_year);
    // A reference alone is not a query the source accepts; it goes with the name.
    const ask = { name: mare.horse_name, year: y, ref: ref ? String(ref) : null };
    try {
      return await client.getPedigree(ask);
    } catch (err) {
      if (!err?.ambiguous || ref) throw err;
      const hers = pickHers(err.matches ?? [], mare);
      if (!hers) {
        err.undecided = true;
        throw err;
      }
      return client.getPedigree({ ...ask, ref: String(hers.reference_number) });
    }
  }

  /** Her chart from Arion's 5x5 grid, when the server has Arion. */
  async function fromArion(mare) {
    if (!loadGrid) {
      const err = new Error("Arion is not wired on this server");
      err.unconfigured = true;
      throw err;
    }
    const grid = await loadGrid();
    return grid.fetchGrid({ name: mare.horse_name, year: year(mare.foaling_year), country: mare.country_code ?? null, sire: mare.sire_name ?? null, userId: mare.user_id ?? null });
  }

  /**
   * The fetch itself, already decided on. Never throws: the outcome is
   * recorded. `source` names one source to use; otherwise Equineline is
   * tried first and Arion when it fails.
   */
  async function run(mare, { ref = null, source = null } = {}) {
    const id = String(mare.id);
    const y = year(mare.foaling_year);
    // what each source said when it did not answer: one failure reads as
    // itself, two read side by side
    const failures = [];
    const said = (f) => (f.err?.undecided ? `${f.err.count ?? "several"} horses of the name, none plainly hers` : describeFailure(f.err));
    let payload = null;
    let via = null;
    let undecided = null;
    try {
      const store = await loadStore();
      if (source !== "arion") {
        const skip = !source && loadGrid && keyRejectedAt && keyRejectedAt > now() - SKIP_EQUINELINE_MS;
        if (skip) {
          failures.push({ via: "Equineline", err: Object.assign(new Error("the server's key was rejected a moment ago, so the source was not asked again"), { unconfigured: true, rejectedKey: true }) });
        } else {
          try {
            payload = await fromEquineline(mare, ref);
            via = "equineline";
          } catch (err) {
            if (err?.rejectedKey) keyRejectedAt = now();
            if (err?.undecided) undecided = err;
            failures.push({ via: "Equineline", err });
          }
        }
      }
      if (!payload && source !== "equineline" && (loadGrid || source === "arion")) {
        try {
          payload = await fromArion(mare);
          via = "arion";
        } catch (err) {
          if (err?.ambiguous && !undecided) undecided = err;
          failures.push({ via: "Arion", err });
        }
      }
      if (!payload) {
        if (undecided) {
          set(id, { state: "ambiguous", message: failures.length > 1 ? failures.map((f) => `${f.via}: ${said(f)}`).join("; ") : String(undecided.message ?? ""), matches: undecided.matches ?? [], source: null });
          log.log(`mares: ${mare.horse_name} (${y ?? "?"}) is ${undecided.count ?? "several"} horses to the source; the desk must choose`);
          return statusOf(id);
        }
        if (failures.length === 1) throw failures[0].err;
        const err = new Error(failures.map((f) => `${f.via}: ${said(f)}`).join("; ") || "no pedigree source answered");
        err.blocked = failures.length > 0 && failures.every((f) => f.err?.blocked);
        throw err;
      }
      const row = store.rowFor(payload);
      if (!row) {
        set(id, { state: "failed", message: "the source answered without a reference number, so the chart could not be filed", source: via });
        return statusOf(id);
      }
      await runQuery(store.UPSERT, store.upsertArgs(row));
      await link(id, row.reference);
      set(id, { state: "held", reference: row.reference, message: null, matches: null, source: via, blocked: false, rejectedKey: false });
      log.log(`mares: fetched the pedigree of ${mare.horse_name} (${y ?? "?"}) from ${via}, ref ${row.reference}${failures.length ? ` (${failures.map((f) => `${f.via}: ${said(f)}`).join("; ")})` : ""}`);
    } catch (err) {
      set(id, { state: "failed", message: describeFailure(err), matches: null, source: null, blocked: Boolean(err?.blocked), rejectedKey: Boolean(err?.rejectedKey) });
      log.error(`mares: pedigree of ${mare.horse_name} not fetched: ${err?.message ?? err}`);
    }
    return statusOf(id);
  }

  /**
   * Start, unless there is nothing to do. Answers "held" (and links the row
   * to the chart it already had) or "pending"; the fetch runs on.
   */
  async function queue(mare, { ref = null, again = false, source = null } = {}) {
    tidy();
    const id = String(mare.id);
    const have = ref ? null : await heldFor(mare).catch(() => null);
    if (have) {
      if (!mare.pedigree_reference) await link(id, have).catch(() => null);
      set(id, { state: "held", reference: have, message: null, matches: null, source: /^arion:/.test(have) ? "arion" : "equineline" });
      return "held";
    }
    const current = jobs.get(id);
    if (current?.state === "pending" && !again) return "pending";
    set(id, { state: "pending", message: null, matches: null, source: null });
    // Not awaited: the add answers now, the sources are slow.
    run(mare, { ref, source }).catch(() => null);
    return "pending";
  }

  return { queue, statusOf, run, pickHers, heldFor, size: () => jobs.size, keyRejectedAt: () => keyRejectedAt };
}
