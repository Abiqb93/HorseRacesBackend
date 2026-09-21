/**
 * The foal on the ground.
 *
 * A mating plan ends at a covering. What the desk actually wants to know a
 * year later is what turned up: the date, the sex, the markings, how it walks,
 * and whether it is worth repeating the dose. That is a record that gets made
 * standing in a paddock on a phone, in ten seconds, or it does not get made.
 *
 * ## What this does not do
 *
 * It does not hold photographs or video. There is no object store behind this
 * server and inventing one inside a MySQL column would be a bad answer to a
 * real problem: a 4 MB image per foal in a `LONGBLOB` is a table nobody can
 * back up and a page nobody can load. What it holds instead is a list of
 * links, to wherever the pack already lives — the shared drive the
 * conformation photos and walking videos came from. The record is here; the
 * media stays where it is and is named from here.
 *
 * When a bucket exists, the shape does not change: a link is a link.
 */

export const FOALS_TABLE = "mare_foals";

export const CREATE_FOALS = `
  CREATE TABLE IF NOT EXISTS ${FOALS_TABLE} (
    id INT AUTO_INCREMENT PRIMARY KEY,
    mare_id INT NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    season SMALLINT NOT NULL,
    foaled_date DATE NULL,
    sex CHAR(1) NULL,
    sire VARCHAR(191) NULL,
    name VARCHAR(191) NULL,
    markings TEXT NULL,
    physical TEXT NULL,
    notes TEXT NULL,
    media JSON NULL,
    recorded_by VARCHAR(64) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_mf_mare (mare_id, season),
    KEY idx_mf_user (user_id, season)
  )`;

/**
 * The season a foal belongs to is the season his dam was covered.
 *
 * He is born the following spring, so a foal on the ground in February 2026
 * is the 2025 season's. Filing him under the year on his birth certificate
 * would file him against the wrong plan, which is the one thing this record
 * exists to be read beside.
 */
export const seasonOfFoaling = (foaledDate) => {
  const m = String(foaledDate ?? "").match(/^(\d{4})/);
  return m ? Number(m[1]) - 1 : null;
};

/**
 * A DATE column as the day it names.
 *
 * The driver hands back a `Date` built at *local* midnight, so the obvious
 * `toISOString().slice(0, 10)` is a day early wherever the server is east of
 * Greenwich in summer — and `String(date).slice(0, 10)` is not a date at all,
 * it is "Sat Feb 07". Read the local parts, which is what the driver wrote.
 */
export const dateOnly = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const pad = (n) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

const SEXES = new Set(["c", "f", "g"]);

/** "Colt", "COLT", "c" — one letter, or nothing at all. */
export const parseSex = (raw) => {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith("colt")) return "c";
  if (s.startsWith("fill")) return "f";
  if (s.startsWith("geld")) return "g";
  return SEXES.has(s[0]) ? s[0] : null;
};

const HTTP = /^https?:\/\//i;

/**
 * The media list, cleaned.
 *
 * Only `http` and `https`. A `javascript:` or `data:` URL in a field that the
 * report renders as a link is a script running in the desk's browser under
 * our own origin, and the fact that only the desk can write here is not a
 * reason to store one: the person typing is not always the person who
 * supplied the text.
 */
export function cleanMedia(list) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const url = String(item?.url ?? item ?? "").trim();
    if (!HTTP.test(url) || url.length > 1000) continue;
    const kind = ["photo", "video", "document"].includes(item?.kind) ? item.kind : "photo";
    const caption = String(item?.caption ?? "").trim().slice(0, 200) || null;
    out.push({ url, kind, caption });
    if (out.length >= 24) break;
  }
  return out;
}

/** The columns a write may set, and what each one is called in a body. */
export const FOAL_FIELDS = {
  season: "season",
  foaledDate: "foaled_date",
  sex: "sex",
  sire: "sire",
  name: "name",
  markings: "markings",
  physical: "physical",
  notes: "notes",
  recordedBy: "recorded_by",
};

/**
 * A body as columns.
 *
 * `undefined` means "not mentioned" and is left out entirely, so a PATCH from
 * a phone that sends one field does not blank the other eight. An explicit
 * `null` or `""` clears.
 */
export function foalColumns(body = {}) {
  const cols = {};
  for (const [field, column] of Object.entries(FOAL_FIELDS)) {
    if (!(field in body)) continue;
    let value = body[field];
    if (value === "" ) value = null;
    if (column === "sex") value = parseSex(value);
    if (column === "season" && value !== null) {
      const n = Number(value);
      value = Number.isFinite(n) && n > 1900 && n < 2200 ? n : null;
    }
    if (column === "foaled_date" && value) value = dateOnly(value);
    cols[column] = value;
  }
  if ("media" in body) cols.media = JSON.stringify(cleanMedia(body.media));
  // A record with a date and no season files itself.
  if (cols.foaled_date && (cols.season === null || cols.season === undefined) && !("season" in body)) {
    cols.season = seasonOfFoaling(cols.foaled_date);
  }
  return cols;
}

/** A row on its way out, with the JSON column parsed. */
export function foalOut(row) {
  if (!row) return null;
  let media = [];
  try {
    media = row.media ? (typeof row.media === "string" ? JSON.parse(row.media) : row.media) : [];
  } catch {
    media = [];
  }
  return {
    id: row.id,
    mareId: row.mare_id,
    season: row.season,
    foaledDate: dateOnly(row.foaled_date),
    sex: row.sex ?? null,
    sire: row.sire ?? null,
    name: row.name ?? null,
    markings: row.markings ?? null,
    physical: row.physical ?? null,
    notes: row.notes ?? null,
    media: Array.isArray(media) ? media : [],
    recordedBy: row.recorded_by ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

/** "a bay colt by Frankel, foaled 7 February" — the line a list shows. */
export function foalLine(foal) {
  if (!foal) return "";
  const sex = { c: "colt", f: "filly", g: "gelding" }[foal.sex] ?? "foal";
  const bits = [foal.name ? `${foal.name},` : null, sex, foal.sire ? `by ${foal.sire}` : null];
  if (foal.foaledDate) {
    const d = new Date(`${foal.foaledDate}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      bits.push(
        `foaled ${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}`,
      );
    }
  }
  return bits.filter(Boolean).join(" ");
}
