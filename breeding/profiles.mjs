/**
 * What the team writes about a horse by looking at him: a stallion's physical
 * description, and a mare's picture (17 November 2026: "It would be great if
 * we could add in stallion physical descriptions somewhere that we can fill
 * in"; on All Of Me's page, "so that we got a picture and a description and
 * all the rest of it of her").
 *
 * A stallion's description is shared: everyone sees the same one, with who
 * wrote it last and when. A mare's picture belongs to the user whose mare she
 * is, as her row does; her description is the row's own `physical` column.
 *
 * Everything that talks to the database is handed in, so this can be tested
 * without it.
 */

export const STALLION_PROFILES = `CREATE TABLE IF NOT EXISTS stallion_profiles (
  stallion_id VARCHAR(64) NOT NULL PRIMARY KEY,
  stallion_name VARCHAR(191) NULL,
  physical TEXT NULL,
  updated_by VARCHAR(64) NULL,
  updated_at DATETIME NOT NULL
)`;

/** His height in inches, set by hand where the stud's own figure is missing or wrong (18 November 2026). */
export const STALLION_HEIGHT_COLUMN = "ALTER TABLE stallion_profiles ADD COLUMN height_in SMALLINT NULL";
/**
 * Who looked at him and when, beside the description ("RB", "Nov 2026"),
 * and half inches in his height (15.2½): the appraisals given on 20 November
 * 2026 carry both.
 */
export const STALLION_APPRAISAL_COLUMNS = [
  "ALTER TABLE stallion_profiles ADD COLUMN appraiser VARCHAR(64) NULL",
  "ALTER TABLE stallion_profiles ADD COLUMN appraised VARCHAR(32) NULL",
];
export const STALLION_HALF_INCH = "ALTER TABLE stallion_profiles MODIFY COLUMN height_in DECIMAL(4,1) NULL";

export const MARE_PHOTOS = `CREATE TABLE IF NOT EXISTS mare_photos (
  mare_id INT NOT NULL PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  type VARCHAR(40) NOT NULL,
  bytes INT NOT NULL,
  content MEDIUMBLOB NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY user_id (user_id)
)`;

/** A description longer than this is a mistake (a pasted document), not a description. */
export const MAX_PHYSICAL = 4000;
/** The page shrinks a picture to 1,200 pixels before sending it; this is the ceiling after that. */
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** A stallion's id as the roster index writes it ("427637", "add-big-mojo-2022"). */
export const stallionIdOk = (id) => /^[A-Za-z0-9-]{1,64}$/.test(String(id ?? ""));

/** The description as stored: trimmed, null when empty; an error when too long. */
export function readPhysical(v) {
  if (v === undefined) return { error: "physical is required (an empty string clears it)" };
  const s = v === null ? "" : String(v).replace(/\r\n/g, "\n").trim();
  if (s.length > MAX_PHYSICAL) return { error: `a description is at most ${MAX_PHYSICAL} characters` };
  return { value: s || null };
}

/**
 * A height as stored, in inches: 65, "65", 62.5, "16.1", "16.1hh", "16 hh",
 * or with a half inch, "15.2½", "15.2 1/2" or "15.2.5" (a hand is four
 * inches, so 16.1 is sixty-five and 15.2½ is sixty-two and a half).
 * Undefined leaves it as it is; null or "" clears it; anything outside 14.0hh
 * to 18.3½hh, or not a whole or half inch, is refused.
 */
export function readHeight(v) {
  if (v === undefined) return { leave: true };
  if (v === null || String(v).trim() === "") return { value: null };
  const s = String(v).trim().replace(/\s+/g, " ");
  let inches = null;
  if (/^\d{2}(?:\.[05])?$/.test(s) && Number(s) >= 56) inches = Number(s);
  else {
    const m = s.match(/^(\d{2})(?:\.(\d))?\s*(½|1\/2|\.5)?\s*(?:hh|h|hands)?$/i);
    if (m && Number(m[2] ?? 0) <= 3) inches = Number(m[1]) * 4 + Number(m[2] ?? 0) + (m[3] ? 0.5 : 0);
  }
  if (!Number.isFinite(inches) || inches * 2 !== Math.round(inches * 2) || inches < 56 || inches > 75.5) {
    return { error: "a height in hands, such as 16.1 or 15.2½ (14.0 to 18.3½)" };
  }
  return { value: inches };
}

/** Who appraised him ("RB") or when ("Nov 2026"), as stored; undefined leaves it, "" clears it. */
export function readNote(v, max, what) {
  if (v === undefined) return { leave: true };
  const s = v === null ? "" : String(v).replace(/\s+/g, " ").trim();
  if (s.length > max) return { error: `${what} is at most ${max} characters` };
  return { value: s || null };
}

/** "data:image/jpeg;base64,..." to its type and bytes, or an error the page can show. */
export function readPhoto(dataUrl) {
  const m = String(dataUrl ?? "").match(/^data:([a-z/+-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) return { error: "send the picture as a data URL (data:image/jpeg;base64,...)" };
  const type = m[1].toLowerCase();
  if (!TYPES.has(type)) return { error: "a JPEG, PNG or WebP picture, please" };
  const body = Buffer.from(m[2].replace(/\s+/g, ""), "base64");
  if (!body.length) return { error: "the picture is empty" };
  if (body.length > MAX_PHOTO_BYTES) return { error: `the picture is ${(body.length / 1048576).toFixed(1)} MB; at most ${MAX_PHOTO_BYTES / 1048576} MB` };
  return { type, body };
}

/** A column that is there already is fine (1060). */
const already = (err) => (err?.errno === 1060 || /duplicate column/i.test(String(err?.message)) ? null : Promise.reject(err));

export function createProfiles({ runQuery }) {
  let ready = null;
  const ensure = () => {
    ready =
      ready ??
      Promise.all([runQuery(STALLION_PROFILES), runQuery(MARE_PHOTOS)])
        // the height column on a table made before it; there already is fine (1060)
        .then(() => runQuery(STALLION_HEIGHT_COLUMN).catch(already))
        .then(() => Promise.all(STALLION_APPRAISAL_COLUMNS.map((sql) => runQuery(sql).catch(already))))
        .then(() => runQuery(STALLION_HALF_INCH))
        .catch((err) => {
          ready = null;
          throw err;
        });
    return ready;
  };

  const shapeStallion = (r) => ({
    name: r.stallion_name ?? null,
    physical: r.physical ?? null,
    height: r.height_in !== null && r.height_in !== undefined && Number.isFinite(Number(r.height_in)) ? Number(r.height_in) : null,
    appraiser: r.appraiser ?? null,
    appraised: r.appraised ?? null,
    updatedBy: r.updated_by ?? null,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  });

  /** Every stallion's description and hand-set height, by id: a few hundred short rows at most, read once by a page. */
  async function stallionProfiles() {
    await ensure();
    const rows = await runQuery(
      "SELECT stallion_id, stallion_name, physical, height_in, appraiser, appraised, updated_by, updated_at FROM stallion_profiles WHERE physical IS NOT NULL OR height_in IS NOT NULL",
      [],
    );
    const out = {};
    for (const r of rows) out[r.stallion_id] = shapeStallion(r);
    return out;
  }

  /**
   * Write a stallion's description, his height, who appraised him and when,
   * or any of them; an empty one clears it. A field not sent is left as it
   * is, so setting his height keeps his description. Clearing the
   * description clears who wrote it and when.
   */
  async function saveStallion({ id, name = null, physical, height, appraiser, appraised, userId }) {
    if (!stallionIdOk(id)) return { status: 400, error: "that is not a stallion id" };
    if (!userId) return { status: 400, error: "userId is required" };
    if ([physical, height, appraiser, appraised].every((v) => v === undefined)) return { status: 400, error: "send physical, height or both" };
    const p = physical === undefined ? { leave: true } : readPhysical(physical);
    if (p.error) return { status: 400, error: p.error };
    const h = readHeight(height);
    if (h.error) return { status: 400, error: h.error };
    let a = readNote(appraiser, 64, "the appraiser");
    if (a.error) return { status: 400, error: a.error };
    let w = readNote(appraised, 32, "when he was seen");
    if (w.error) return { status: 400, error: w.error };
    if (!p.leave && p.value === null) {
      a = { value: null };
      w = { value: null };
    }
    await ensure();
    const at = new Date();
    const keep = (col, r) => (r.leave ? col : `VALUES(${col})`);
    await runQuery(
      `INSERT INTO stallion_profiles (stallion_id, stallion_name, physical, height_in, appraiser, appraised, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE stallion_name = COALESCE(VALUES(stallion_name), stallion_name),
         physical = ${keep("physical", p)}, height_in = ${keep("height_in", h)},
         appraiser = ${keep("appraiser", a)}, appraised = ${keep("appraised", w)},
         updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`,
      [
        String(id),
        name ? String(name).slice(0, 191) : null,
        p.leave ? null : p.value,
        h.leave ? null : h.value,
        a.leave ? null : a.value,
        w.leave ? null : w.value,
        String(userId).slice(0, 64),
        at,
      ],
    );
    // a row with nothing left on it goes
    await runQuery("DELETE FROM stallion_profiles WHERE stallion_id = ? AND physical IS NULL AND height_in IS NULL", [String(id)]);
    const rows = await runQuery("SELECT stallion_id, stallion_name, physical, height_in, appraiser, appraised, updated_by, updated_at FROM stallion_profiles WHERE stallion_id = ? LIMIT 1", [String(id)]);
    const row = rows?.[0] ? shapeStallion(rows[0]) : { physical: null, height: null, appraiser: null, appraised: null, updatedBy: null, updatedAt: null };
    return { status: 200, body: { id: String(id), ...row, updatedBy: row.updatedBy ?? String(userId), updatedAt: row.updatedAt ?? at.toISOString() } };
  }

  /** The mare, if she is this user's. */
  const mareOf = async (userId, mareId) => {
    const rows = await runQuery("SELECT id FROM my_mares WHERE id = ? AND user_id = ? LIMIT 1", [Number(mareId), String(userId)]);
    return rows?.[0] ?? null;
  };

  async function saveMarePhoto({ userId, mareId, data = null, bytes = null }) {
    // a data URL from the page, or bytes the server fetched itself (the Matings App's picture)
    const photo = bytes
      ? TYPES.has(String(bytes.type).toLowerCase().split(";")[0]) && bytes.body?.length && bytes.body.length <= MAX_PHOTO_BYTES
        ? { type: String(bytes.type).toLowerCase().split(";")[0], body: bytes.body }
        : { error: "that picture is not a JPEG, PNG or WebP under 3 MB" }
      : readPhoto(data);
    if (photo.error) return { status: 400, error: photo.error };
    await ensure();
    if (!(await mareOf(userId, mareId))) return { status: 404, error: "no such mare on your list" };
    const at = new Date();
    await runQuery(
      `INSERT INTO mare_photos (mare_id, user_id, type, bytes, content, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), type = VALUES(type), bytes = VALUES(bytes), content = VALUES(content), updated_at = VALUES(updated_at)`,
      [Number(mareId), String(userId), photo.type, photo.body.length, photo.body, at],
    );
    return { status: 200, body: { mareId: Number(mareId), type: photo.type, bytes: photo.body.length, photoAt: at.toISOString() } };
  }

  async function marePhoto({ userId, mareId }) {
    await ensure();
    const rows = await runQuery("SELECT type, content, updated_at FROM mare_photos WHERE mare_id = ? AND user_id = ? LIMIT 1", [Number(mareId), String(userId)]);
    const r = rows?.[0];
    return r ? { type: r.type, body: r.content, at: r.updated_at } : null;
  }

  async function deleteMarePhoto({ userId, mareId }) {
    await ensure();
    await runQuery("DELETE FROM mare_photos WHERE mare_id = ? AND user_id = ?", [Number(mareId), String(userId)]);
    return { status: 200, body: { mareId: Number(mareId), photoAt: null } };
  }

  /** When each of a user's mares last had her picture changed, by mare id: the list marks who has one. */
  async function photoTimes(userId) {
    await ensure();
    const rows = await runQuery("SELECT mare_id, updated_at FROM mare_photos WHERE user_id = ?", [String(userId)]);
    return new Map(rows.map((r) => [Number(r.mare_id), r.updated_at ? new Date(r.updated_at).toISOString() : null]));
  }

  return { stallionProfiles, saveStallion, saveMarePhoto, marePhoto, deleteMarePhoto, photoTimes };
}
