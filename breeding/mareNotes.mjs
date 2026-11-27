/**
 * Matings notes: a free note per mare per season, kept for the user to come
 * back to the next year (27 November 2026: "User wants to make a note that
 * they can refer to next year or lookup work already done").
 *
 * A note is keyed by the mare's name and foaling year rather than her row on
 * My Mares, so a note can be written for any mare whose profile is open, on
 * the user's list or not. Every save that changes a note keeps the text it
 * replaces in the history table, so a note written over by mistake can be
 * read back.
 */
import { nameKey } from "../rom/books.mjs";

export const NOTES_TABLE = "mare_mating_notes";
export const HISTORY_TABLE = "mare_mating_note_history";
export const MAX_NOTE = 20000;
export const SEASON_MIN = 2000;
export const SEASON_MAX = 2100;

export const CREATE_NOTES = `CREATE TABLE IF NOT EXISTS ${NOTES_TABLE} (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  mare_key VARCHAR(191) NOT NULL,
  mare_name VARCHAR(191) NULL,
  season SMALLINT NOT NULL,
  body TEXT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_mare_note (user_id, mare_key, season),
  KEY idx_mare_note_user (user_id, mare_key)
)`;

export const CREATE_HISTORY = `CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  mare_key VARCHAR(191) NOT NULL,
  season SMALLINT NOT NULL,
  body TEXT NULL,
  replaced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_mare_note_hist (user_id, mare_key, season)
)`;

export async function ensureNotesSchema(run) {
  await run(CREATE_NOTES, []);
  await run(CREATE_HISTORY, []);
}

/** The key a mare's notes are held under: her name without its country, and her foaling year where known. */
export function mareKey(name, year = null) {
  const k = nameKey(name ?? "");
  if (!k) return null;
  const y = Number(year);
  return Number.isInteger(y) && y > 1900 && y < 2100 ? `${k}|${y}` : k;
}

/** A season to file a note under, or null. */
export function seasonOf(v) {
  const s = Number(v);
  return Number.isInteger(s) && s >= SEASON_MIN && s <= SEASON_MAX ? s : null;
}

/** A save request read and checked: throws with the reason a request is refused. */
export function readSave(body = {}) {
  const key = mareKey(body.mare, body.year);
  if (!key) throw new Error("mare is required");
  const season = seasonOf(body.season);
  if (!season) throw new Error(`season must be a year from ${SEASON_MIN} to ${SEASON_MAX}`);
  const text = typeof body.body === "string" ? body.body.replace(/\r\n/g, "\n") : "";
  if (text.length > MAX_NOTE) throw new Error(`a note is ${MAX_NOTE.toLocaleString("en-GB")} characters at most`);
  return { key, name: String(body.mare).trim().slice(0, 191), season, body: text };
}

/** A row as the page reads it. */
export const noteOut = (row) => ({
  season: Number(row.season),
  body: row.body ?? "",
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
});

/** Every season's note for one mare, newest season first. */
export async function listNotes(run, userId, key) {
  const rows = await run(`SELECT season, body, updated_at FROM ${NOTES_TABLE} WHERE user_id = ? AND mare_key = ? ORDER BY season DESC`, [userId, key]);
  return (rows ?? []).map(noteOut);
}

/**
 * Save one season's note. The text it replaces goes to the history first, when it differs. An empty note is kept as an
 * empty row rather than deleted, so its history still hangs off a season.
 */
export async function saveNote(run, userId, { key, name, season, body }) {
  const prev = await run(`SELECT body FROM ${NOTES_TABLE} WHERE user_id = ? AND mare_key = ? AND season = ?`, [userId, key, season]);
  const old = prev?.[0]?.body ?? null;
  if (old !== null && old !== body && old.trim() !== "") {
    await run(`INSERT INTO ${HISTORY_TABLE} (user_id, mare_key, season, body) VALUES (?, ?, ?, ?)`, [userId, key, season, old]);
  }
  await run(
    `INSERT INTO ${NOTES_TABLE} (user_id, mare_key, mare_name, season, body) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE body = VALUES(body), mare_name = VALUES(mare_name)`,
    [userId, key, name, season, body],
  );
  const rows = await run(`SELECT season, body, updated_at FROM ${NOTES_TABLE} WHERE user_id = ? AND mare_key = ? AND season = ?`, [userId, key, season]);
  return rows?.[0] ? noteOut(rows[0]) : { season, body, updatedAt: null };
}
