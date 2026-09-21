/**
 * A broodmare band, and what is planned for it.
 *
 * `my_mares` already held a mare's identity — who she is, who her parents
 * are, and the stud book reference that lets a pedigree be fetched for her.
 * What a bloodstock desk actually works from is three things that identity
 * cannot carry:
 *
 *   the band     whose mares these are, and where each one stands
 *   the season   what she was covered by this year, whether she held, when
 *                she was last served, and what she foaled
 *   the plan     which stallions are suggested for next year, which were
 *                ruled out and why, and the four paragraphs a client reads
 *
 * Those are one table each, because each answers a different question and
 * because the band index has to be read for thirty mares in one query. A
 * season is a row, not a JSON field, so "what she went to last year" and
 * "what she is going to next year" are two rows rather than a diff.
 *
 * ## Season means the covering year
 *
 * `mare_seasons.season = 2026` is the year she was covered in, so her foal
 * arrives in 2027. `foaled_date` on that same row is the foal born in 2026 —
 * the produce of the *previous* year's cover. This is how the desk's own
 * index reads ("Foaled 2026" beside "2026 MATING PLAN") and getting it
 * backwards would silently misdate every mare in the band.
 *
 * ## The parsers are here, and they are pure
 *
 * A mating pack arrives as prose: "i/f FRANKEL lsd 24/02/26", "Not This
 * Time / Night of Thunder", "BARREN (to Justify)". Turning that into rows is
 * the part that can be wrong in ways nobody notices, so it lives in exported
 * functions with tests rather than inside a route or a one-off script.
 */

/* ------------------------------------------------------------------ schema */

/**
 * Columns added to `my_mares` after the fact.
 *
 * MySQL has no `ADD COLUMN IF NOT EXISTS`, and the table is live, so each one
 * is checked against INFORMATION_SCHEMA and added only when absent — the same
 * arrangement `france/store.mjs` uses on APIData_Table2.
 */
export const MARE_COLUMNS = {
  damsire_name: "VARCHAR(191) NULL",
  // The band. A client's mares are grouped by this and nothing else; the name
  // matches bloodstock_clients.name where the desk keeps a client there.
  client_name: "VARCHAR(255) NULL",
  client_id: "INT NULL",
  // Where she stands — a stud farm, not a country. country_code already holds
  // where she was foaled.
  location: "VARCHAR(255) NULL",
  // A band contains fillies still in training who are not yet broodmares. They
  // belong to the client and appear on the index, but they have no plan.
  role: "VARCHAR(24) NOT NULL DEFAULT 'broodmare'",
  physical: "TEXT NULL",
  updated_at: "DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
};

export const MARE_INDEXES = {
  idx_my_mares_client: "(user_id, client_name)",
};

export const CREATE_MARE_SEASONS = `
  CREATE TABLE IF NOT EXISTS mare_seasons (
    id INT AUTO_INCREMENT PRIMARY KEY,
    mare_id INT NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    season SMALLINT NOT NULL,
    status VARCHAR(16) NULL,
    covering_sire VARCHAR(191) NULL,
    last_service_date DATE NULL,
    foaled_date DATE NULL,
    foal_sex CHAR(1) NULL,
    foal_by VARCHAR(191) NULL,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_mare_season (mare_id, season),
    KEY idx_ms_user_season (user_id, season)
  )`;

/**
 * One plan per mare per season per version.
 *
 * Versions exist because a plan is sent to a client. Once it has been, the
 * copy they hold must stay readable exactly as they read it, so a `final`
 * plan is never edited in place — an edit writes version n+1 and the old one
 * remains. `stats_snapshot` is the figures the prose was written from, kept
 * for the same reason: a report re-opened next March must not quietly restate
 * itself with this March's numbers.
 */
export const CREATE_MATING_PLANS = `
  CREATE TABLE IF NOT EXISTS mating_plans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    mare_id INT NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    season SMALLINT NOT NULL,
    version SMALLINT NOT NULL DEFAULT 1,
    status VARCHAR(8) NOT NULL DEFAULT 'draft',
    author VARCHAR(64) NULL,
    preferences JSON NULL,
    ruled_out JSON NULL,
    brief JSON NULL,
    race_record TEXT NULL,
    pedigree TEXT NULL,
    produce_record TEXT NULL,
    analysis TEXT NULL,
    stats_snapshot JSON NULL,
    draft_meta JSON NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_plan_version (mare_id, season, version),
    KEY idx_mp_user (user_id, season)
  )`;

/**
 * Create the two tables and widen `my_mares`, once, at boot.
 *
 * Every step is checked rather than attempted-and-swallowed: a genuine
 * failure should still be an error, and only "already there" is a no-op.
 */
export async function ensureMareSchema(runQuery, { log = console } = {}) {
  const added = [];
  for (const ddl of [CREATE_MARE_SEASONS, CREATE_MATING_PLANS]) await runQuery(ddl, []);

  const columns = await runQuery(
    `SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'my_mares'`,
    [],
  );
  const have = new Set(columns.map((r) => r.name));
  for (const [column, definition] of Object.entries(MARE_COLUMNS)) {
    if (have.has(column)) continue;
    await runQuery(`ALTER TABLE my_mares ADD COLUMN \`${column}\` ${definition}`, []);
    added.push(column);
  }

  for (const [name, definition] of Object.entries(MARE_INDEXES)) {
    const found = await runQuery(
      `SELECT INDEX_NAME AS name FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'my_mares' AND INDEX_NAME = ? LIMIT 1`,
      [name],
    );
    if (found.length) continue;
    try {
      await runQuery(`ALTER TABLE my_mares ADD INDEX ${name} ${definition}`, []);
      added.push(name);
    } catch (err) {
      // A caller can time out mid-ALTER while MySQL carries on; the retry
      // then sees no index and tries again.
      if (!/Duplicate key name/i.test(err.message)) throw err;
    }
  }

  if (added.length) log.log?.(`mare schema: added ${added.join(", ")}`);
  return { added };
}

/* ------------------------------------------------------------------- names */

/**
 * The same reduction `pedigree/store.mjs` and `server.jsx` use, so a mare
 * row, a cached pedigree and a search hit all agree on what one name is.
 *
 * Duplicated rather than imported because server.jsx needs it synchronously
 * from CommonJS; `mares.test.mjs` pins the two against each other.
 */
export const mareNameKey = (raw) =>
  String(raw ?? "")
    .trim()
    .replace(/^[*=$]+/, "")
    .replace(/\s*\([A-Za-z]{2,3}\)\s*$/, "")
    .toLowerCase()
    .replace(/['’`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** A horse as the stud book writes her: upper case, no country, no sigil. */
export const studName = (raw) =>
  String(raw ?? "")
    .trim()
    .replace(/^[*=$]+/, "")
    .replace(/\s*\([A-Za-z]{2,3}\)\s*$/, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

/* ------------------------------------------------------------------- dates */

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * A date as a mating pack writes it, to ISO.
 *
 * Four forms appear in one document: "24 Feb 26", "25 Mar 2026", "07.02.26"
 * and "2026-02-24". A two-digit year is this century — these are service and
 * foaling dates for a season in hand, never 1926 — and a day-first reading is
 * forced, because "07.02.26" is the seventh of February to a British desk and
 * nothing in the string says so.
 */
export function parseDate(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return s;

  const named = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{2,4})$/);
  if (named) {
    const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (!month) return null;
    return isoOf(Number(named[1]), month, Number(named[3]));
  }

  const dotted = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
  if (dotted) return isoOf(Number(dotted[1]), Number(dotted[2]), Number(dotted[3]));

  return null;
}

function isoOf(day, month, year) {
  const y = year < 100 ? 2000 + year : year;
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The short form the desk writes a service date in: 24/02/26. */
export const shortDate = (iso) => {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : null;
};

/* ------------------------------------------------------------------ status */

export const STATUSES = ["in_foal", "not_in_foal", "maiden", "barren", "slipped"];

/**
 * The status line at the top of a mare's report, read.
 *
 *   "Status: i/f FRANKEL lsd 24/02/26"   in foal to Frankel, served 24 Feb
 *   "I/f to JUSTIFY lsd 20/05/26"        the same, written differently
 *   "MAIDEN"                             never covered
 *   "BARREN (to Justify)"                covered and did not hold
 *   "In foal" + a separate LSD column     the index's form
 *
 * "Barren" and "not in foal" are the same fact from two documents and are
 * kept apart deliberately: the desk writes BARREN when she was covered and
 * failed, and the index writes "Not in foal" for the same mare. Both map to
 * `barren` when a covering sire is named, because that is the fact — she went
 * to a stallion and is empty.
 */
export function parseStatus(raw) {
  const line = String(raw ?? "").replace(/^status:\s*/i, "").trim();
  if (!line) return null;

  const out = { status: null, coveringSire: null, lastServiceDate: null };

  const lsd = line.match(/\blsd\.?\s*:?\s*([0-9]{1,2}[./][0-9]{1,2}[./][0-9]{2,4}|[0-9]{1,2}\s+[A-Za-z]{3,}\.?\s+[0-9]{2,4})/i);
  if (lsd) out.lastServiceDate = parseDate(lsd[1]);

  if (/\bmaiden\b/i.test(line)) {
    out.status = "maiden";
    return out;
  }

  const barren = line.match(/\bbarren\b\s*(?:\(\s*to\s+([^)]+)\))?/i);
  if (barren) {
    out.status = "barren";
    if (barren[1]) out.coveringSire = studName(barren[1]);
    return out;
  }

  if (/\bslipped\b/i.test(line)) {
    out.status = "slipped";
    return out;
  }

  if (/\bnot\s+in\s+foal\b/i.test(line)) {
    out.status = "barren";
    return out;
  }

  // "i/f", "I/f to", "in foal to" — the sire runs to the end of the clause,
  // which is either the lsd marker or the end of the line.
  const inFoal = line.match(/\b(?:i\s*\/\s*f|in\s+foal)\b\s*(?:to\s+)?([^,(]*?)(?=\s*\blsd\b|\s*$)/i);
  if (inFoal) {
    out.status = "in_foal";
    const sire = inFoal[1].trim();
    if (sire) out.coveringSire = studName(sire);
    return out;
  }

  return out.status || out.lastServiceDate ? out : null;
}

/** The inverse: how the desk writes a season back out. */
export function statusLine({ status, coveringSire, lastServiceDate } = {}) {
  if (status === "maiden") return "MAIDEN";
  if (status === "barren") return coveringSire ? `BARREN (to ${titleCase(coveringSire)})` : "BARREN";
  if (status === "slipped") return coveringSire ? `SLIPPED (to ${titleCase(coveringSire)})` : "SLIPPED";
  if (status === "in_foal") {
    const parts = [`i/f ${studName(coveringSire) || "?"}`];
    const lsd = shortDate(lastServiceDate);
    if (lsd) parts.push(`lsd ${lsd}`);
    return parts.join(" ");
  }
  return null;
}

/** "NOT THIS TIME" as prose wants it: "Not This Time". */
export const titleCase = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/(^|[\s'\-(])([a-z])/g, (m, p, c) => p + c.toUpperCase())
    .replace(/\bDe\b/g, "de")
    .replace(/\bOf\b/g, "of")
    .replace(/\bThe\b/g, "The");

/* -------------------------------------------------------------- preferences */

const ALIASES = { NTT: "NOT THIS TIME", SSB: "STARSPANGLEDBANNER", STS: "SEA THE STARS", LDV: "LOPE DE VEGA", NOT: "NOT THIS TIME", TDH: "TOO DARN HOT" };

/**
 * A suggestion, read into ranked preferences.
 *
 * The same text means two different things depending on where it was written,
 * which is why `sameRank` exists rather than being guessed:
 *
 *   index   "Not This Time/ Night of Thunder"   first choice, then second
 *   report  "1st preference: Not This Time / Nyquist"   two firsts
 *
 * In the index a separator ranks; in a report's preference line it offers
 * alternatives at one rank. Reading the report's line as a ranking would
 * promote a mare's second string to a decision nobody made.
 *
 * A trailing bracket is a note about the mating, not part of the name:
 * "Night of Thunder (3x3 Galileo)" is one stallion and one tag.
 */
export function parseSuggestion(raw, { rank = 1, region = null, sameRank = false } = {}) {
  const text = String(raw ?? "").trim();
  if (!text || text === "-") return [];

  const out = [];
  let next = rank;
  for (const part of text.split(/\s*(?:\/|\bor\b|,|;)\s*/i)) {
    const piece = part.trim();
    if (!piece || /^-+$/.test(piece)) continue;
    const tagged = piece.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    const name = studName(tagged ? tagged[1] : piece);
    if (!name) continue;
    out.push({
      rank: next,
      stallion: ALIASES[name] ?? name,
      region,
      tag: tagged ? tagged[2].trim() : null,
    });
    if (!sameRank) next += 1;
  }
  return out;
}

/**
 * The preference lines of one report, read together.
 *
 * `1st preference USA: Not This Time` and `1st preference EU: Frankel` are
 * the same rank in two jurisdictions — a mare standing in Kentucky and one
 * coming home are different matings, and the desk writes both.
 */
export function parsePreferenceLines(lines = []) {
  const out = [];
  for (const raw of lines) {
    const m = String(raw ?? "").match(/^\s*(\d)(?:st|nd|rd|th)\s+preference\s*(USA|EU|US|EUROPE)?\s*:\s*(.+)$/i);
    if (!m) continue;
    const region = m[2] ? m[2].toUpperCase().replace("EUROPE", "EU").replace("US", "USA").replace("USAA", "USA") : null;
    out.push(...parseSuggestion(m[3], { rank: Number(m[1]), region, sameRank: true }));
  }
  return out;
}

/* ------------------------------------------------------------------- rows */

const trimmed = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

const num = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A season row from a request body, with the empty string meaning unset. */
export function seasonRowFrom(body = {}) {
  const status = trimmed(body.status);
  if (status && !STATUSES.includes(status)) {
    throw new Error(`status must be one of ${STATUSES.join(", ")}`);
  }
  const date = (key) => {
    const raw = trimmed(body[key]);
    if (!raw) return null;
    const iso = parseDate(raw);
    if (!iso) throw new Error(`${key} is not a date I can read: ${raw}`);
    return iso;
  };
  const sex = trimmed(body.foalSex);
  return {
    status,
    covering_sire: studName(body.coveringSire) || null,
    last_service_date: date("lastServiceDate"),
    foaled_date: date("foaledDate"),
    foal_sex: sex ? sex[0].toLowerCase() : null,
    foal_by: studName(body.foalBy) || null,
    notes: trimmed(body.notes),
  };
}

/**
 * A fixture row merged onto what the database already holds.
 *
 * The fixture wins, because it is the desk's own index and the database's
 * copy came from a results feed that does not know a mare's parents when she
 * raced abroad. What the database holds and the fixture leaves blank is kept.
 */
export function mergeMareRow(existing = {}, fixture = {}) {
  const pick = (a, b) => (trimmed(a) ?? trimmed(b));
  return {
    horse_name: pick(fixture.name, existing.horse_name),
    country_code: pick(fixture.foaledIn, existing.country_code),
    foaling_year: num(fixture.yob) ?? num(existing.foaling_year) ?? null,
    sire_name: pick(fixture.sire, existing.sire_name),
    dam_name: pick(fixture.dam, existing.dam_name),
    damsire_name: pick(fixture.damsire, existing.damsire_name),
    client_name: pick(fixture.client, existing.client_name),
    location: pick(fixture.location, existing.location),
    role: pick(fixture.role, existing.role) ?? "broodmare",
    physical: pick(fixture.physical, existing.physical),
    best_rating: num(existing.best_rating),
    pedigree_reference: pick(existing.pedigree_reference, fixture.pedigreeReference),
  };
}

/**
 * Which search hit is this mare.
 *
 * A name is not an identity: three of the twenty-eight mares in one band
 * share a name with a different horse in our results data, and one of those
 * namesakes is by a different stallion in a different country. So a hit is
 * accepted only when the foaling year agrees and the sire either agrees or is
 * unknown to us — and a disagreement returns null rather than the best of a
 * bad set, because a wrong rating attached to the right mare is invisible.
 */
export function pickSearchHit(hits = [], { year = null, sire = null } = {}) {
  const wantSire = studName(sire);
  const candidates = hits.filter((h) => {
    if (year != null && num(h.foaling_year) !== num(year)) return false;
    const has = studName(h.sire_name);
    if (wantSire && has && has !== wantSire) return false;
    return true;
  });
  if (candidates.length !== 1) return null;
  return candidates[0];
}
