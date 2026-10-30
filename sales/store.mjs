/**
 * The sale lots table, and the record of every import into it.
 *
 * One row per lot per sale (sales/normalise.mjs gives the shape). A lot is
 * identified by its sale, year, lot number and dam, so reading a sale again
 * updates its rows rather than adding to them. Each row says which source
 * it came from; where a sale house's own results and a workbook both hold a
 * sale-year, the house's are kept and the workbook's dropped for it
 * (dropSuperseded), because the house is the record of what happened.
 */
import crypto from "node:crypto";

export const LOTS_TABLE = "sale_lots";
export const IMPORTS_TABLE = "sale_imports";

export const CREATE_LOTS = `
  CREATE TABLE IF NOT EXISTS ${LOTS_TABLE} (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    lot_hash CHAR(40) NOT NULL,
    source VARCHAR(24) NOT NULL,
    company VARCHAR(48) NULL,
    sale_key VARCHAR(24) NOT NULL,
    sale_name VARCHAR(96) NULL,
    sale_label VARCHAR(96) NULL,
    sale_tier TINYINT NULL,
    region CHAR(3) NULL,
    year SMALLINT NOT NULL,
    sale_month CHAR(7) NULL,
    sale_type VARCHAR(12) NOT NULL,
    lot VARCHAR(16) NULL,
    horse VARCHAR(96) NULL,
    sire VARCHAR(96) NULL,
    sire_key VARCHAR(96) NULL,
    dam VARCHAR(96) NULL,
    dam_key VARCHAR(96) NULL,
    sex VARCHAR(8) NULL,
    foaling_year SMALLINT NULL,
    vendor VARCHAR(191) NULL,
    buyer VARCHAR(191) NULL,
    status VARCHAR(12) NOT NULL,
    after_sale TINYINT(1) NOT NULL DEFAULT 0,
    price DECIMAL(14,2) NULL,
    bid DECIMAL(14,2) NULL,
    currency CHAR(3) NULL,
    price_gbp INT NULL,
    record JSON NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_sale_lot (lot_hash),
    KEY idx_sl_sire (sire_key, sale_type, year),
    KEY idx_sl_dam (dam_key),
    KEY idx_sl_sale (sale_key, year),
    KEY idx_sl_type (sale_type, region, year)
  )`;

export const CREATE_IMPORTS = `
  CREATE TABLE IF NOT EXISTS ${IMPORTS_TABLE} (
    id INT AUTO_INCREMENT PRIMARY KEY,
    source VARCHAR(24) NOT NULL,
    sale_key VARCHAR(24) NULL,
    sale_label VARCHAR(96) NULL,
    year SMALLINT NULL,
    lots INT NOT NULL DEFAULT 0,
    sold INT NOT NULL DEFAULT 0,
    reconcile JSON NULL,
    note VARCHAR(255) NULL,
    error TEXT NULL,
    at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_si_sale (source, sale_label, year)
  )`;

export async function ensureSalesSchema(runQuery) {
  await runQuery(CREATE_LOTS, []);
  await runQuery(CREATE_IMPORTS, []);
}

/** A lot's identity, hashed: sale, year, the sale's own label, lot number, dam. */
export const lotHash = (l) =>
  crypto.createHash("sha1").update(`${l.sale_key}|${l.year}|${l.sale_label ?? ""}|${l.lot ?? ""}|${l.dam_key ?? ""}`).digest("hex");

const COLUMNS = [
  "lot_hash", "source", "company", "sale_key", "sale_name", "sale_label", "sale_tier", "region", "year", "sale_month", "sale_type", "lot",
  "horse", "sire", "sire_key", "dam", "dam_key", "sex", "foaling_year", "vendor", "buyer", "status", "after_sale", "price", "bid", "currency",
  "price_gbp", "record",
];
const cut = (v, n) => (v === null || v === undefined ? null : String(v).slice(0, n));

/** A lot as the row's values, in COLUMNS order. */
export function rowValues(l) {
  return [
    lotHash(l), cut(l.source, 24), cut(l.company, 48), cut(l.sale_key, 24), cut(l.sale_name, 96), cut(l.sale_label, 96), l.sale_tier ?? null,
    cut(l.region, 3), l.year, cut(l.sale_month, 7), cut(l.sale_type, 12), cut(l.lot, 16), cut(l.horse, 96), cut(l.sire, 96), cut(l.sire_key, 96),
    cut(l.dam, 96), cut(l.dam_key, 96), cut(l.sex, 8), l.foaling_year ?? null, cut(l.vendor, 191), cut(l.buyer, 191), cut(l.status, 12),
    l.after_sale ? 1 : 0, l.price ?? null, l.bid ?? null, cut(l.currency, 3), l.price_gbp ?? null, l.record ? JSON.stringify(l.record) : null,
  ];
}

/** Lots written in batches, each one replacing its earlier reading. Returns how many were written. */
export async function upsertLots(runQuery, lots, { batch = 500 } = {}) {
  const update = COLUMNS.filter((c) => c !== "lot_hash").map((c) => `${c} = VALUES(${c})`).join(", ");
  let n = 0;
  for (let i = 0; i < lots.length; i += batch) {
    const chunk = lots.slice(i, i + batch);
    const holes = chunk.map(() => `(${COLUMNS.map(() => "?").join(", ")})`).join(", ");
    await runQuery(`INSERT INTO ${LOTS_TABLE} (${COLUMNS.join(", ")}) VALUES ${holes} ON DUPLICATE KEY UPDATE ${update}`, chunk.flatMap(rowValues));
    n += chunk.length;
  }
  return n;
}

/** A sale-year read from the house itself replaces any workbook's reading of it. */
/**
 * A sale read again replaces its own rows. The lot's identity includes its
 * sale key, so when the rule that files a sale changes (sales/goffs.mjs: the
 * Autumn Sale's yearlings), reading it again would otherwise leave its old
 * rows standing beside the new ones and count those horses twice. For each
 * sale label in `lots`, this drops that source's rows of the label and year
 * under any key the new reading did not use.
 */
export async function dropRekeyed(runQuery, { source, lots }) {
  const bySale = new Map();
  for (const l of lots) {
    if (!l.sale_label || !l.year) continue;
    const k = `${l.sale_label}\u0000${l.year}`;
    (bySale.get(k) ?? bySale.set(k, new Set()).get(k)).add(l.sale_key);
  }
  let dropped = 0;
  for (const [k, keys] of bySale) {
    const [label, year] = k.split("\u0000");
    const list = [...keys];
    const done = await runQuery(
      `DELETE FROM ${LOTS_TABLE} WHERE source = ? AND sale_label = ? AND year = ? AND sale_key NOT IN (${list.map(() => "?").join(", ")})`,
      [source, label, Number(year), ...list],
    );
    dropped += Number(done?.affectedRows ?? 0);
  }
  return dropped;
}

export async function dropSuperseded(runQuery, { saleKey, year, source }) {
  const done = await runQuery(`DELETE FROM ${LOTS_TABLE} WHERE sale_key = ? AND year = ? AND source <> ?`, [saleKey, year, source]);
  return done?.affectedRows ?? 0;
}

export async function logImport(runQuery, entry) {
  await runQuery(
    `INSERT INTO ${IMPORTS_TABLE} (source, sale_key, sale_label, year, lots, sold, reconcile, note, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cut(entry.source, 24), cut(entry.saleKey, 24), cut(entry.saleLabel, 96), entry.year ?? null, entry.lots ?? 0, entry.sold ?? 0,
      entry.reconcile ? JSON.stringify(entry.reconcile) : null, cut(entry.note, 255), entry.error ?? null,
    ],
  );
}

export default { LOTS_TABLE, IMPORTS_TABLE, CREATE_LOTS, CREATE_IMPORTS, ensureSalesSchema, lotHash, rowValues, upsertLots, dropSuperseded, logImport };
