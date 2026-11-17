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

export function createProfiles({ runQuery }) {
  let ready = null;
  const ensure = () => {
    ready = ready ?? Promise.all([runQuery(STALLION_PROFILES), runQuery(MARE_PHOTOS)]).catch((err) => {
      ready = null;
      throw err;
    });
    return ready;
  };

  /** Every stallion's description, by id: a few hundred short rows at most, read once by a page. */
  async function stallionProfiles() {
    await ensure();
    const rows = await runQuery("SELECT stallion_id, stallion_name, physical, updated_by, updated_at FROM stallion_profiles WHERE physical IS NOT NULL", []);
    const out = {};
    for (const r of rows) out[r.stallion_id] = { name: r.stallion_name, physical: r.physical, updatedBy: r.updated_by, updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null };
    return out;
  }

  /** Write (or, with an empty description, clear) a stallion's description. */
  async function saveStallion({ id, name = null, physical, userId }) {
    if (!stallionIdOk(id)) return { status: 400, error: "that is not a stallion id" };
    if (!userId) return { status: 400, error: "userId is required" };
    const p = readPhysical(physical);
    if (p.error) return { status: 400, error: p.error };
    await ensure();
    const at = new Date();
    if (p.value === null) {
      await runQuery("DELETE FROM stallion_profiles WHERE stallion_id = ?", [String(id)]);
      return { status: 200, body: { id: String(id), physical: null } };
    }
    await runQuery(
      `INSERT INTO stallion_profiles (stallion_id, stallion_name, physical, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE stallion_name = COALESCE(VALUES(stallion_name), stallion_name), physical = VALUES(physical), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`,
      [String(id), name ? String(name).slice(0, 191) : null, p.value, String(userId).slice(0, 64), at],
    );
    return { status: 200, body: { id: String(id), physical: p.value, updatedBy: String(userId), updatedAt: at.toISOString() } };
  }

  /** The mare, if she is this user's. */
  const mareOf = async (userId, mareId) => {
    const rows = await runQuery("SELECT id FROM my_mares WHERE id = ? AND user_id = ? LIMIT 1", [Number(mareId), String(userId)]);
    return rows?.[0] ?? null;
  };

  async function saveMarePhoto({ userId, mareId, data }) {
    const photo = readPhoto(data);
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
