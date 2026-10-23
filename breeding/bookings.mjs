/**
 * Nominations, breeding rights and bookings: the season's book.
 *
 * (23 October 2026: "these are Richard's nominations and bookings for 2025
 * and 2026. We would need to build this into the platform and have full
 * suite of functionality to replicate it and also recommend matings.")
 *
 * The book is kept today as a workbook with one row per mare per season,
 * grouped under the client who owns her or the nomination she is using:
 * her last cover, where she stands (maiden, barren, rested, in foal and
 * due, tested in foal, aborted), the stallion this season, his stud, when
 * the booking was requested and confirmed and by what means, the fee and
 * its currency, the terms (1st October special live foal, live foal, 48
 * hours, refundable, free return, foal share), the commission to an agent,
 * and the contract by its reference and how far it has got (contracted,
 * signed, signed and returned by both sides, signed online). A separate
 * sheet lists the breeding rights held — a stallion, a numbered right, the
 * partners and their shares — and the mares put to each.
 *
 * Everything the workbook carries has a column here, so nothing is lost in
 * the move; what the workbook leaves to memory (what is outstanding, what a
 * partner is owed, which rights are unused, which mare has no booking)
 * becomes a question the tables can answer.
 *
 * The parsers turn the workbook's cells into those columns. They are pure
 * and tested, because a cell like "due 07/02", "TIF 29.05", "1st Oct SLF",
 * "RB95 - €5,000 commission to OSL" or "Zarak (20% Thurso 20% Whatton 60%
 * H Bozo)" is exactly the kind of thing that is read wrongly in a way
 * nobody sees until a mare is missed.
 */

/* ----------------------------------------------------------------- schema */

export const RIGHTS_TABLE = "breeding_rights";
export const BOOKINGS_TABLE = "mare_bookings";

export const CREATE_RIGHTS = `
  CREATE TABLE IF NOT EXISTS ${RIGHTS_TABLE} (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    stallion VARCHAR(191) NOT NULL,
    stallion_key VARCHAR(191) NOT NULL,
    label VARCHAR(255) NULL,
    number SMALLINT NULL,
    reference VARCHAR(64) NULL,
    stud VARCHAR(191) NULL,
    season SMALLINT NULL,
    partners JSON NULL,
    qty SMALLINT NOT NULL DEFAULT 1,
    bonus TINYINT(1) NOT NULL DEFAULT 0,
    free_return TINYINT(1) NOT NULL DEFAULT 0,
    return_pct SMALLINT NULL,
    own_share DECIMAL(6,2) NULL,
    notes TEXT NULL,
    source VARCHAR(32) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_br_user (user_id, season),
    KEY idx_br_stallion (user_id, stallion_key)
  )`;

export const CREATE_BOOKINGS = `
  CREATE TABLE IF NOT EXISTS ${BOOKINGS_TABLE} (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    season SMALLINT NOT NULL,
    mare_id INT NULL,
    mare_name VARCHAR(191) NOT NULL,
    mare_key VARCHAR(191) NOT NULL,
    owner VARCHAR(255) NULL,
    ownership JSON NULL,
    section VARCHAR(255) NULL,
    right_id INT NULL,
    right_label VARCHAR(255) NULL,
    last_cover VARCHAR(191) NULL,
    mare_status VARCHAR(24) NULL,
    status_date DATE NULL,
    status_raw VARCHAR(255) NULL,
    stallion VARCHAR(191) NULL,
    stallion_key VARCHAR(191) NULL,
    stud VARCHAR(191) NULL,
    stage VARCHAR(24) NOT NULL DEFAULT 'planned',
    requested_on DATE NULL,
    requested_raw VARCHAR(255) NULL,
    confirmed_on DATE NULL,
    confirmed_via VARCHAR(24) NULL,
    confirmed_by VARCHAR(191) NULL,
    confirmed_raw VARCHAR(255) NULL,
    fee DECIMAL(12,2) NULL,
    fee_raw VARCHAR(64) NULL,
    currency CHAR(3) NULL,
    terms VARCHAR(24) NULL,
    terms_raw VARCHAR(191) NULL,
    commission_pct DECIMAL(6,3) NULL,
    commission_amount DECIMAL(12,2) NULL,
    commission_currency CHAR(3) NULL,
    commission_to VARCHAR(191) NULL,
    commission_raw VARCHAR(191) NULL,
    contract_ref VARCHAR(32) NULL,
    contract_state VARCHAR(24) NULL,
    contract_raw VARCHAR(255) NULL,
    added_to_description TINYINT(1) NOT NULL DEFAULT 0,
    notes TEXT NULL,
    source VARCHAR(32) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_mb_user_season (user_id, season),
    KEY idx_mb_mare (user_id, mare_key),
    KEY idx_mb_stallion (user_id, season, stallion_key)
  )`;

export async function ensureBookingsSchema(runQuery) {
  await runQuery(CREATE_RIGHTS, []);
  await runQuery(CREATE_BOOKINGS, []);
}

/* ---------------------------------------------------------------- helpers */

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
export const nameKey = (s) =>
  clean(s)
    .replace(/\s*\([A-Za-z]{2,3}\)\s*$/, "")
    .toUpperCase();

/** "07/02", "07/02/26", "29.05", "2026-02-07" → ISO date; a day and month take the season's year. */
export function parseDate(text, { year = null } = {}) {
  const s = clean(text);
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = s.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  let y = m[3] ? Number(m[3]) : year;
  if (y !== null && y !== undefined && y < 100) y += 2000;
  if (!y) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/* ----------------------------------------------------------- the parsers */

/** The words a mare's season can be in, as the workbook writes them. */
export const MARE_STATUS = ["maiden", "barren", "rested", "in_foal", "tested_in_foal", "aborted", "foaled", "slipped", "not_in_foal", "unknown"];

/**
 * The year a bare day-and-month belongs to. A season's book is written from
 * the autumn before it to the summer of it: a due date falls in the season
 * itself (January to June), a cover or a scan in the summer before it, and
 * a booking email or a confirmation in the autumn or winter either side of
 * New Year. "foaling" and "cover" say which; "booking" takes the month's
 * side of New Year.
 */
export function yearOf(month, season, kind = "booking") {
  const y = Number(season);
  if (!y) return null;
  if (kind === "foaling") return y;
  if (kind === "cover") return y - 1;
  return month >= 8 ? y - 1 : y;
}

const monthOf = (text) => {
  const m = clean(text).match(/\d{1,2}[./-](\d{1,2})/);
  return m ? Number(m[1]) : null;
};

/** A day-and-month from a column, dated by what the column records. */
export function parseSeasonDate(text, { season = null, kind = "booking" } = {}) {
  const s = clean(text);
  if (/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2}/.test(s)) return parseDate(s);
  const month = monthOf(s);
  if (!month) return null;
  return parseDate(s, { year: yearOf(month, season, kind) });
}

/**
 * "MAIDEN", "BARREN", "RESTED", "due 07/02", "TIF 29.05", "aborted",
 * "foaled 24/02", "slipped", "not in foal", "21/05" (a service date alone,
 * the summer before the season).
 */
export function parseMareStatus(text, { season = null } = {}) {
  const raw = clean(text);
  if (!raw) return { status: null, date: null, raw: null };
  const s = raw.toLowerCase();
  const cover = (t) => parseSeasonDate(t, { season, kind: "cover" });
  const foaling = (t) => parseSeasonDate(t, { season, kind: "foaling" });
  if (/maiden/.test(s)) return { status: "maiden", date: null, raw };
  if (/barren|empty/.test(s)) return { status: "barren", date: null, raw };
  if (/rested|rest\b/.test(s)) return { status: "rested", date: null, raw };
  if (/abort|slipped|lost/.test(s)) return { status: /slip/.test(s) ? "slipped" : "aborted", date: parseSeasonDate(s, { season }), raw };
  if (/not in foal|nif\b/.test(s)) return { status: "not_in_foal", date: null, raw };
  if (/\btif\b|tested in foal|in foal/.test(s)) return { status: "tested_in_foal", date: cover(s), raw };
  if (/\bdue\b/.test(s)) return { status: "in_foal", date: foaling(s), raw };
  if (/foaled|foal\b/.test(s)) return { status: "foaled", date: foaling(s), raw };
  const date = cover(s);
  if (date) return { status: "in_foal", date, raw };
  if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.test(s)) return { status: "in_foal", date: null, raw };
  return { status: "unknown", date: null, raw };
}

/** "150,000", "€80,000", "60/65 KN", "PP BR 15" → a number where there is one plainly. */
export function parseMoney(text) {
  const s = clean(text);
  if (!s) return null;
  if (/\bBR\b/i.test(s) && !/\d{3}/.test(s.replace(/\bBR\s*\d+/i, ""))) return null;
  const m = s.replace(/[£€$,]/g, "").match(/\d+(?:\.\d+)?\s*k?/i);
  if (!m) return null;
  const k = /k$/i.test(m[0].trim());
  const n = Number(m[0].replace(/k/i, "").trim());
  if (!Number.isFinite(n)) return null;
  return k ? n * 1000 : n;
}

export function parseCurrency(text, fallback = null) {
  const s = clean(text);
  if (/€|eur/i.test(s)) return "EUR";
  if (/£|gbp/i.test(s)) return "GBP";
  if (/\$|usd/i.test(s)) return "USD";
  if (/\bgns?\b|guineas/i.test(s)) return "GNS";
  return fallback;
}

export const TERMS = {
  oct1_slf: "1st Oct, special live foal",
  oct1_refundable: "1st Oct, refundable",
  oct1_free_return: "1st Oct, free return",
  jan1_slf: "1st Jan, special live foal",
  live_foal: "Live foal",
  live_foal_48h: "Live foal, 48 hours",
  foal_share: "Foal share",
  free: "Free",
  other: "Other",
};

/** "1st Oct SLF", "1st Oct (SLF)", "LIVE FOAL 48 hrs", "1st Oct refundable", "Foal Share". */
export function parseTerms(text) {
  const raw = clean(text);
  if (!raw) return { terms: null, raw: null };
  const s = raw.toLowerCase();
  let terms = "other";
  if (/48/.test(s)) terms = "live_foal_48h";
  else if (/foal share/.test(s)) terms = "foal_share";
  else if (/free return/.test(s)) terms = "oct1_free_return";
  else if (/refund/.test(s)) terms = "oct1_refundable";
  else if (/1st jan|1 jan/.test(s)) terms = "jan1_slf";
  else if (/slf|special live|1st oct|1 oct/.test(s)) terms = "oct1_slf";
  else if (/live foal|lf\b/.test(s)) terms = "live_foal";
  else if (/^free$|foc|no fee/.test(s)) terms = "free";
  return { terms, raw };
}

export const CONTRACT_STATES = ["none", "contracted", "signed", "fully_signed", "signed_online"];

/** "RB95 fully S&R", "RB78 contracted - MARE IS BARREN", "RB3 signed online", "RB80 - 4 mares to go". */
export function parseContract(text) {
  const raw = clean(text);
  if (!raw) return { ref: null, state: null, raw: null };
  const ref = (raw.match(/\bRB\s?(\d+)\b/i) ?? [])[1] ? `RB${raw.match(/\bRB\s?(\d+)\b/i)[1]}` : null;
  const s = raw.toLowerCase();
  let state = ref ? "contracted" : "none";
  if (/fully s\s*&\s*r|fully signed/.test(s)) state = "fully_signed";
  else if (/signed online/.test(s)) state = "signed_online";
  else if (/s\s*&\s*r|signed/.test(s)) state = "signed";
  else if (/contracted/.test(s)) state = "contracted";
  return { ref, state, raw };
}

/** "RB Zoom 17/12/24", "TG email 27/11/25", "Henri Bozo email 23/10", "02/04/26", "check fee with OSL", "via OSL". */
export function parseConfirmed(text, { season = null } = {}) {
  const raw = clean(text);
  if (!raw) return { date: null, via: null, by: null, raw: null };
  const s = raw.toLowerCase();
  const via = /zoom/.test(s) ? "zoom" : /whatsapp/.test(s) ? "whatsapp" : /telephone|phone|call/.test(s) ? "telephone" : /e-?mail/.test(s) ? "email" : null;
  const date = parseSeasonDate(raw, { season, kind: "booking" });
  const by = clean(raw.replace(/\b(zoom|whatsapp|telephone|phone|call|e-?mail)\b/gi, "").replace(/\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?/g, "").replace(/^(via|see|check fee with)\s+/i, "")) || null;
  return { date, via, by: by && by.length <= 60 ? by : null, raw };
}

/** "5%", "NO", "€7.5k", "£1,000 to Ed Sackville", "5% TG", "OSL", "2k TG". */
export function parseCommission(text, { currency = null } = {}) {
  const raw = clean(text);
  if (!raw) return { pct: null, amount: null, currency: null, to: null, raw: null };
  const s = raw.toLowerCase();
  if (/^(no|none|nil|n\/a)\b/.test(s)) return { pct: null, amount: null, currency: null, to: null, raw, none: true };
  const pct = (s.match(/(\d+(?:\.\d+)?)\s*%/) ?? [])[1];
  const amount = pct ? null : parseMoney(raw);
  const ccy = parseCurrency(raw, amount !== null ? currency : null);
  const to = clean(raw.replace(/\d+(?:\.\d+)?\s*%|[£€$][\d,.]+k?|\b\d[\d,.]*k?\b|\bto\b|\*/gi, "")) || null;
  return { pct: pct ? Number(pct) : null, amount, currency: ccy, to: to && to.length <= 60 ? to : null, raw };
}

/**
 * A nomination line: "Havana Grey 2 (33% Eclipse, 33% Oliver St Lawrence)",
 * "Zarak (20% Thurso 20% Whatton 60% H Bozo)", "Siyouni (50% Whatton)",
 * "Modern Games (50% Thurso, 50% Whatton) BONUS", "Ardad (3 ownership
 * entitlement for RB)". The partners named are the others; the balance is
 * the holder's own. Returns null for a line that is not a nomination (a
 * client's name heads a section the same way).
 */
export function parseRightLine(text, { holder = null } = {}) {
  const raw = clean(text);
  if (!raw) return null;
  const bonus = /\bbonus\b/i.test(raw);
  const freeReturn = /free return/i.test(raw);
  // "50% return" is a clause of the right (half the fee back if she is
  // empty), not a partner's share.
  const returnPct = Number((raw.match(/(\d{1,3})\s*%\s*return/i) ?? [])[1] ?? 0) || null;
  const body = raw.replace(/\d{1,3}\s*%\s*return/gi, " ");
  const head = body
    .replace(/\(.*?\)/g, " ")
    .replace(/\(.*$/, " ")
    .replace(/\b(bonus|free return)\b/gi, " ")
    .replace(/\s*-\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const [first, ...rest] = head.split(/\s+-\s+/);
  const m = clean(first).match(/^(.+?)(?:\s+(\d{1,2}))?$/);
  if (!m) return null;
  const stallion = clean(m[1]);
  const number = m[2] ? Number(m[2]) : null;
  const note = rest.length ? clean(rest.join(" - ")) : null;
  const partners = [];
  for (const p of body.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%\s*([^,()%]+?)(?=\s*,|\s*\)|\s+\d{1,3}(?:\.\d+)?\s*%|$)/g)) {
    const name = clean(p[2]).replace(/^(with|each|by)\s+/i, "").replace(/\?$/, "").replace(/\s*&$/, "");
    if (!name || /^(return|bonus)$/i.test(name)) continue;
    partners.push({ name, pct: Number(p[1]) });
  }
  // The line names the other partners and leaves the holder's own share
  // as the balance; where it names the holder too, that is the share.
  const shares = partners.length > 0;
  let ownShare = null;
  if (holder) {
    const i = partners.findIndex((p) => nameKey(p.name) === nameKey(holder));
    if (i >= 0) {
      ownShare = partners[i].pct;
      partners.splice(i, 1);
    }
  }
  const others = partners.reduce((a, p) => a + p.pct, 0);
  if (ownShare === null) ownShare = others < 100 ? Math.round((100 - others) * 100) / 100 : 0;
  return { stallion, number, partners, ownShare, shares, bonus, freeReturn, returnPct, note, raw };
}

/**
 * The Breeding Rights sheet: one nomination a line, the stallion in the
 * first column ("Havana Grey (1)") and the partners' shares in the next
 * ones ("(50% Whatton)"). Its first row names the holder: "THURSO NOMS".
 */
export function parseRightsSheet(rows, { season = null, holder = null } = {}) {
  const rights = [];
  let holderName = holder;
  for (const raw of rows ?? []) {
    const cells = (raw ?? []).map(clean);
    const head = cells[0];
    if (!head) continue;
    const noms = head.match(/^(.+?)\s+NOMS$/i);
    if (noms) {
      if (!holderName) holderName = clean(noms[1]);
      continue;
    }
    if (/partner|^stallion$|^right$/i.test(head)) continue;
    const line = [head.replace(/\((\d{1,2})\)/, " $1"), ...cells.slice(1).filter(Boolean)].join(" ");
    const parsed = parseRightLine(line, { holder: holderName });
    if (!parsed) continue;
    rights.push({ ...parsed, label: line, season, qty: 1, source: "workbook" });
  }
  return { rights, holder: holderName };
}

/* ----------------------------------------------------------- the workbook */

/** The book's columns, left to right, as the 2025 and 2026 sheets carry them. */
export const BOOK_COLUMNS = ["section", "mare", "added_to_description", "last_cover", "status", "stallion", "notes", "stud", "requested", "confirmed", "fee", "currency", "terms", "commission", "contract"];

const isHeaderRow = (r) => /\bmare\b/i.test(r[1] ?? "") && /mating|stallion/i.test((r[5] ?? "") + (r[3] ?? ""));

/**
 * Whether a line in the first column is a nomination (a stallion, with the
 * partners who share him) or an owner (a client, a stud, a partnership that
 * owns the mares beneath). The sheet writes both the same way, so the
 * stallion column decides: a nomination names the stallion the row, or the
 * next mare's row, is booked to. A roster of known stallions settles the
 * rest.
 */
const sameName = (a, b) => a === b || a.startsWith(b + " ") || b.startsWith(a + " ");

function headIsRight(parsed, rows, i, { stallions = null, labels = null } = {}) {
  if (!parsed) return false;
  const key = nameKey(parsed.stallion);
  if (!key) return false;
  if (stallions?.has(key)) return true;
  if (labels?.has(parsed.raw)) return true;
  const r = rows[i] ?? [];
  const sireHere = nameKey(r[5]);
  if (sireHere) return sameName(sireHere, key);
  // A mare on the line and no stallion named: the line is her owner's.
  if (r[1]) return false;
  // No mare on the line. A client's name carries no shares and no number;
  // a nomination nobody is booked on yet carries one or the other, and the
  // next mare under it, if there is one, is booked to him.
  if (!parsed.shares && parsed.number === null && !parsed.bonus && !parsed.freeReturn && !parsed.returnPct) return false;
  if (parsed.stallion.split(" ").length > 4) return false;
  let after = false;
  for (let j = i + 1; j < Math.min(rows.length, i + 4); j += 1) {
    after = true;
    const n = rows[j] ?? [];
    if (!n.some(Boolean)) continue;
    if (n[0]) return true;
    const sire = nameKey(n[5]);
    if (sire) return sameName(sire, key);
    if (n[1]) return false;
  }
  return after;
}

/** The owner's own line: the name and the shares of anyone named beside it. */
function parseOwnerLine(text) {
  const raw = clean(text);
  if (!raw) return { owner: null, ownership: null };
  const owner = raw.replace(/\(.*?\)/g, " ").replace(/\(.*$/, " ").replace(/\s+/g, " ").trim() || raw;
  const parsed = parseRightLine(raw);
  const ownership = parsed?.partners?.length ? { own: parsed.ownShare, partners: parsed.partners } : null;
  return { owner, ownership };
}

/**
 * The book's sheet as rows for the tables.
 *
 * `rows` is the sheet as a matrix of trimmed strings in the order of
 * BOOK_COLUMNS. A row with a name in the first column and nothing in the
 * mare column heads a section: a nomination line (becomes a right, and the
 * mares beneath it are booked on it) or a client's name (the mares beneath
 * it are his). A row with a mare is a booking. "THURSO NOMS" and the like
 * are markers, kept as the section's name.
 */
export function parseBook(rows, { season, stallions = null, holder = null } = {}) {
  const rights = [];
  const bookings = [];
  const skipped = [];
  const notes = [];
  const clean2 = (rows ?? []).map((raw) => Array.from({ length: BOOK_COLUMNS.length }, (_, i) => clean(raw?.[i])));
  let section = null;
  let owner = null;
  let ownership = null;
  let right = null;
  let holderName = holder;
  const rightLabels = new Set();
  // The same nomination line twice is one right with room for two mares.
  const rightFor = (head, r) => {
    const found = rights.find((x) => x.label === head);
    if (found) {
      found.qty += 1;
      return found;
    }
    const parsed = parseRightLine(head, { holder: holderName });
    const made = { ...parsed, label: head, stud: r[7] || null, notes: [parsed.note, r[6]].filter(Boolean).join(" · ") || null, season, qty: 1, source: "workbook" };
    rights.push(made);
    rightLabels.add(head);
    return made;
  };
  for (let i = 0; i < clean2.length; i += 1) {
    const r = clean2[i];
    if (!r.some(Boolean) || isHeaderRow(r)) continue;
    const mare = r[1];
    const head = r[0];
    // "THURSO NOMS" heads the nominations and names who holds them.
    const noms = head.match(/^(.+?)\s+NOMS$/i);
    if (noms && !mare) {
      if (!holderName) holderName = clean(noms[1]);
      section = head;
      owner = null;
      ownership = null;
      right = null;
      continue;
    }
    if (head) {
      const parsed = parseRightLine(head, { holder: holderName });
      if (headIsRight(parsed, clean2, i, { stallions, labels: rightLabels })) {
        right = rightFor(head, r);
        section = head;
        owner = null;
        ownership = null;
      } else {
        const line = parseOwnerLine(head);
        section = head;
        owner = line.owner;
        ownership = line.ownership;
        right = null;
        if (!mare && !r[5]) {
          // A client's name heading a section, or a note with nothing booked
          // on it: kept as words so nothing in the sheet is lost.
          const next = clean2[i + 1] ?? [];
          if (!next[1] && (next[0] || i + 1 >= clean2.length)) notes.push({ row: i, text: r.filter(Boolean).join(" · ") });
          continue;
        }
      }
      if (!mare) {
        if (!r[5] && !r[7]) continue;
        // A nomination with nobody booked on it yet.
        if (right) continue;
        skipped.push({ row: r, why: "no mare" });
        continue;
      }
    }
    if (!mare) {
      skipped.push({ row: r, why: "no mare" });
      continue;
    }
    const rowRight = right;
    const status = parseMareStatus(r[4], { season });
    const currency = parseCurrency(r[11], parseCurrency(r[10], null));
    const terms = parseTerms(r[12]);
    const contract = parseContract(r[14]);
    const confirmed = parseConfirmed(r[9], { season });
    const requested = parseConfirmed(r[8], { season });
    const commission = parseCommission(r[13], { currency });
    const count = (mare.match(/^(\d+)\s*mares?\b/i) ?? [])[1];
    bookings.push({
      season,
      mare_name: count ? `${count} mares` : mare,
      mare_key: nameKey(count ? `${count} mares (${section ?? "unnamed"})` : mare),
      owner: rowRight ? null : owner,
      ownership: rowRight ? null : ownership,
      section,
      right_label: rowRight?.label ?? null,
      last_cover: r[3] || null,
      mare_status: status.status,
      status_date: status.date,
      status_raw: status.raw,
      stallion: r[5] || rowRight?.stallion || null,
      stallion_key: nameKey(r[5] || rowRight?.stallion || "") || null,
      stud: r[7] || rowRight?.stud || null,
      stage: stageOf({ contract, confirmed, requested, stallion: r[5] || rowRight?.stallion }),
      requested_on: requested.date,
      requested_raw: requested.raw,
      confirmed_on: confirmed.date,
      confirmed_via: confirmed.via,
      confirmed_by: confirmed.by,
      confirmed_raw: confirmed.raw,
      fee: parseMoney(r[10]),
      fee_raw: r[10] || null,
      currency,
      terms: terms.terms,
      terms_raw: terms.raw,
      commission_pct: commission.pct,
      commission_amount: commission.amount,
      commission_currency: commission.currency,
      commission_to: commission.to,
      commission_raw: commission.raw,
      contract_ref: contract.ref,
      contract_state: contract.state,
      contract_raw: contract.raw,
      added_to_description: /y|x|✓/i.test(r[2]) ? 1 : 0,
      notes: r[6] || null,
      source: "workbook",
    });
  }
  return { rights, bookings, skipped, notes, holder: holderName };
}

/** Where a booking has got to, from what the book says of it. */
export const STAGES = ["planned", "requested", "confirmed", "contracted", "signed", "complete", "cancelled"];
export function stageOf({ contract, confirmed, requested, stallion } = {}) {
  if (contract?.state === "fully_signed" || contract?.state === "signed_online") return "signed";
  if (contract?.state === "signed") return "signed";
  if (contract?.ref || contract?.state === "contracted") return "contracted";
  if (confirmed?.date || confirmed?.via) return "confirmed";
  if (requested?.date || requested?.raw) return "requested";
  return stallion ? "planned" : "planned";
}

/**
 * What a row's stage is, from its columns, for a row whose stage was never
 * set by hand. A stage set by hand (complete, cancelled) stands.
 */
export function stageFromRow(row = {}) {
  return stageOf({
    contract: { ref: row.contract_ref, state: row.contract_state },
    confirmed: { date: row.confirmed_on, via: row.confirmed_via },
    requested: { date: row.requested_on, raw: row.requested_raw },
    stallion: row.stallion,
  });
}

export const DERIVED_STAGES = new Set(["planned", "requested", "confirmed", "contracted", "signed"]);

/**
 * Words typed into a cell on the page, read the way the sheet's are:
 * `status_text`, `terms_text`, `contract_text`, `confirmed_text`,
 * `requested_text`, `fee_text`, `commission_text` become their columns.
 */
export function readTyped(body = {}, { season = null } = {}) {
  const out = {};
  if ("status_text" in body) {
    const st = parseMareStatus(body.status_text, { season });
    Object.assign(out, { mare_status: st.status, status_date: st.date, status_raw: st.raw });
  }
  if ("terms_text" in body) {
    const t = parseTerms(body.terms_text);
    Object.assign(out, { terms: t.terms, terms_raw: t.raw });
  }
  if ("contract_text" in body) {
    const c = parseContract(body.contract_text);
    Object.assign(out, { contract_ref: c.ref, contract_state: c.state, contract_raw: c.raw });
  }
  if ("confirmed_text" in body) {
    const c = parseConfirmed(body.confirmed_text, { season });
    Object.assign(out, { confirmed_on: c.date, confirmed_via: c.via, confirmed_by: c.by, confirmed_raw: c.raw });
  }
  if ("requested_text" in body) {
    const c = parseConfirmed(body.requested_text, { season });
    Object.assign(out, { requested_on: c.date, requested_raw: c.raw });
  }
  if ("fee_text" in body) {
    out.fee = parseMoney(body.fee_text);
    out.fee_raw = clean(body.fee_text) || null;
    const ccy = parseCurrency(body.fee_text, null);
    if (ccy) out.currency = ccy;
  }
  if ("commission_text" in body) {
    const c = parseCommission(body.commission_text, { currency: body.currency ?? out.currency ?? null });
    Object.assign(out, { commission_pct: c.pct, commission_amount: c.amount, commission_currency: c.currency, commission_to: c.to, commission_raw: c.raw });
  }
  return out;
}

/* ------------------------------------------------------------ the columns */

export const BOOKING_FIELDS = [
  "season", "mare_id", "mare_name", "owner", "ownership", "section", "right_id", "right_label", "last_cover",
  "mare_status", "status_date", "status_raw", "stallion", "stud", "stage", "requested_on", "requested_raw",
  "confirmed_on", "confirmed_via", "confirmed_by", "confirmed_raw", "fee", "fee_raw", "currency", "terms", "terms_raw",
  "commission_pct", "commission_amount", "commission_currency", "commission_to", "commission_raw",
  "contract_ref", "contract_state", "contract_raw", "added_to_description", "notes", "source",
];

const DATE_FIELDS = new Set(["status_date", "requested_on", "confirmed_on"]);
const NUMBER_FIELDS = new Set(["mare_id", "right_id", "fee", "commission_pct", "commission_amount", "season"]);
const JSON_FIELDS = new Set(["ownership"]);
const FLAG_FIELDS = new Set(["added_to_description"]);

/** A body as columns, each coerced to what its column holds; unknown fields are dropped. */
export function bookingColumns(body = {}) {
  const out = {};
  for (const f of BOOKING_FIELDS) {
    if (!(f in body)) continue;
    let v = body[f];
    if (v === "") v = null;
    if (v !== null && v !== undefined) {
      if (DATE_FIELDS.has(f)) v = parseDate(v) ?? null;
      else if (NUMBER_FIELDS.has(f)) {
        const n = Number(v);
        v = Number.isFinite(n) ? n : null;
      } else if (JSON_FIELDS.has(f)) v = typeof v === "string" ? v : JSON.stringify(v);
      else if (FLAG_FIELDS.has(f)) v = v ? 1 : 0;
      else v = clean(v).slice(0, f === "notes" ? 4000 : 255) || null;
    }
    out[f] = v ?? null;
  }
  if ("mare_name" in out && out.mare_name) out.mare_key = nameKey(out.mare_name);
  if ("stallion" in out) out.stallion_key = out.stallion ? nameKey(out.stallion) : null;
  if ("mare_status" in out && out.mare_status && !MARE_STATUS.includes(out.mare_status)) out.mare_status = "unknown";
  if ("terms" in out && out.terms && !(out.terms in TERMS)) out.terms = "other";
  if ("contract_state" in out && out.contract_state && !CONTRACT_STATES.includes(out.contract_state)) out.contract_state = "none";
  if ("stage" in out && out.stage && !STAGES.includes(out.stage)) out.stage = "planned";
  return out;
}

export const RIGHT_FIELDS = ["stallion", "label", "number", "reference", "stud", "season", "partners", "qty", "bonus", "free_return", "return_pct", "own_share", "notes", "source"];

export function rightColumns(body = {}) {
  const out = {};
  for (const f of RIGHT_FIELDS) {
    if (!(f in body)) continue;
    let v = body[f];
    if (v === "") v = null;
    if (v !== null && v !== undefined) {
      if (f === "partners") v = typeof v === "string" ? v : JSON.stringify(v);
      else if (f === "number" || f === "qty" || f === "season" || f === "return_pct" || f === "own_share") {
        const n = Number(v);
        v = Number.isFinite(n) ? n : null;
      } else if (f === "bonus" || f === "free_return") v = v ? 1 : 0;
      else v = clean(v).slice(0, f === "notes" ? 4000 : 255) || null;
    }
    out[f] = v ?? null;
  }
  if ("stallion" in out && out.stallion) out.stallion_key = nameKey(out.stallion);
  if ("qty" in out && (out.qty === null || out.qty < 1)) out.qty = 1;
  return out;
}

/** A row from either table, as the page reads it. */
export function rowOut(r) {
  if (!r) return null;
  const out = { ...r };
  for (const k of ["ownership", "partners"]) {
    if (typeof out[k] === "string") {
      try {
        out[k] = JSON.parse(out[k]);
      } catch {
        out[k] = null;
      }
    }
  }
  for (const k of ["fee", "commission_pct", "commission_amount", "own_share"]) if (out[k] !== null && out[k] !== undefined) out[k] = Number(out[k]);
  for (const k of ["bonus", "free_return", "added_to_description"]) if (k in out) out[k] = Boolean(Number(out[k]));
  for (const k of ["status_date", "requested_on", "confirmed_on"]) {
    if (out[k] instanceof Date) out[k] = out[k].toISOString().slice(0, 10);
    else if (typeof out[k] === "string" && out[k].length > 10) out[k] = out[k].slice(0, 10);
  }
  return out;
}

/* ------------------------------------------------------------ the summary */

/**
 * What the book adds up to: fees by currency, where every booking stands,
 * the rights and how many mares each carries, the mares without a
 * stallion, the contracts still out.
 */
export function summarise(bookings = [], rights = []) {
  const fees = {};
  const stages = Object.fromEntries(STAGES.map((s) => [s, 0]));
  const statuses = {};
  let unbooked = 0;
  let contractsOut = 0;
  for (const b of bookings) {
    stages[b.stage ?? "planned"] = (stages[b.stage ?? "planned"] ?? 0) + 1;
    if (b.mare_status) statuses[b.mare_status] = (statuses[b.mare_status] ?? 0) + 1;
    if (!b.stallion) unbooked += 1;
    if (b.contract_ref && b.contract_state !== "fully_signed" && b.contract_state !== "signed_online") contractsOut += 1;
    const has = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));
    if (has(b.fee) && b.currency) {
      const c = fees[b.currency] ?? { count: 0, total: 0, commission: 0 };
      c.count += 1;
      c.total += Number(b.fee);
      if (has(b.commission_pct)) c.commission += (Number(b.fee) * Number(b.commission_pct)) / 100;
      else if (has(b.commission_amount) && (!b.commission_currency || b.commission_currency === b.currency)) c.commission += Number(b.commission_amount);
      fees[b.currency] = c;
    }
  }
  const used = new Map();
  for (const b of bookings) {
    const k = b.right_id ?? b.right_label;
    if (!k) continue;
    used.set(k, (used.get(k) ?? 0) + 1);
  }
  const rightsOut = rights.map((r) => {
    const mares = used.get(r.id) ?? used.get(r.label) ?? 0;
    return { id: r.id ?? null, label: r.label, stallion: r.stallion, qty: r.qty ?? 1, mares, unused: Math.max(0, (r.qty ?? 1) - mares) };
  });
  return {
    bookings: bookings.length,
    stages,
    statuses,
    unbooked,
    contractsOut,
    fees,
    rights: rightsOut,
    rightsUnused: rightsOut.reduce((a, r) => a + r.unused, 0),
  };
}

export default {
  RIGHTS_TABLE, BOOKINGS_TABLE, CREATE_RIGHTS, CREATE_BOOKINGS, ensureBookingsSchema, nameKey, parseDate, MARE_STATUS,
  yearOf, parseSeasonDate, parseMareStatus, parseMoney, parseCurrency, TERMS, parseTerms, CONTRACT_STATES, parseContract, parseConfirmed, parseCommission,
  parseRightLine, parseRightsSheet, BOOK_COLUMNS, parseBook, STAGES, stageOf, stageFromRow, DERIVED_STAGES, readTyped,
  BOOKING_FIELDS, bookingColumns, RIGHT_FIELDS, rightColumns, rowOut, summarise,
};
