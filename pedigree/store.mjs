/**
 * The pedigree cache.
 *
 * A pedigree never changes. Once fetched it is right forever, so this table is
 * append-only in practice and every row saves a 25-second upstream call that
 * the source would rather we did not make.
 *
 * What is stored is the source's untouched response. Turning that into a grid,
 * an inbreeding list and a dosage profile is the frontend's job, done by a
 * module that is already tested there — copying it here would give the project
 * two normalisers to keep in step, and they would not stay in step.
 */

/** A name reduced to what identifies the horse. Mirrors the frontend's rule. */
export const normaliseName = (raw) =>
  String(raw ?? "")
    .trim()
    .replace(/^[*=$]+/, "")
    .replace(/\s*\([A-Za-z]{2,3}\)\s*$/, "")
    .toLowerCase()
    .replace(/[''`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The foaling year out of "February 11,2008". */
export const foalingYearOf = (foaled) => {
  const m = String(foaled ?? "").match(/\b(1[89]\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : null;
};

export const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS pedigree_cache (
  reference VARCHAR(32) NOT NULL PRIMARY KEY,
  name_key VARCHAR(191) NOT NULL,
  display VARCHAR(191),
  foaling_year SMALLINT NULL,
  sex VARCHAR(16),
  payload LONGTEXT NOT NULL,
  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pedigree_name (name_key, foaling_year)
)`;

/**
 * Find a cached pedigree.
 *
 * The identity rule is the frontend script's, and for the same reason: a name
 * is not an identity. Night of Thunder (IRE) and Night of Thunder (ARG) are
 * different horses foaled in the same year, and a lookup keyed on name alone
 * would serve one under the other's name. A reference number decides on its
 * own; otherwise the years must agree.
 */
export function findQuery({ name, year, ref }) {
  if (ref) {
    return { sql: "SELECT * FROM pedigree_cache WHERE reference = ? LIMIT 1", args: [String(ref)] };
  }
  const key = normaliseName(name);
  if (!key) return null;
  if (Number.isFinite(year)) {
    return {
      sql: "SELECT * FROM pedigree_cache WHERE name_key = ? AND foaling_year = ? LIMIT 1",
      args: [key, year],
    };
  }
  // No year given: the request as asked is answered by any horse of the name.
  // Newest first, so an unqualified name lands on the horse most likely meant.
  return {
    sql: "SELECT * FROM pedigree_cache WHERE name_key = ? ORDER BY foaling_year DESC LIMIT 1",
    args: [key],
  };
}

/** The row to write for a freshly fetched payload, or null if unusable. */
export function rowFor(payload) {
  const horse = payload?.horse ?? {};
  const reference = horse.reference_number ? String(horse.reference_number) : null;
  const display = String(horse.name ?? "").trim();
  if (!reference || !display) return null;
  return {
    reference,
    name_key: normaliseName(display),
    display: display.slice(0, 191),
    foaling_year: foalingYearOf(horse.foaled),
    sex: horse.sex ? String(horse.sex).slice(0, 16) : null,
    payload: JSON.stringify(payload),
  };
}

export const UPSERT = `INSERT INTO pedigree_cache
  (reference, name_key, display, foaling_year, sex, payload)
  VALUES (?, ?, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE
    name_key = VALUES(name_key), display = VALUES(display),
    foaling_year = VALUES(foaling_year), sex = VALUES(sex),
    payload = VALUES(payload), fetched_at = CURRENT_TIMESTAMP`;

export const upsertArgs = (row) => [
  row.reference, row.name_key, row.display, row.foaling_year, row.sex, row.payload,
];
