/**
 * What the rest of the team has been asking about.
 *
 * A bloodstock desk is a handful of people looking at the same market from
 * different angles, and the most useful thing an assistant can say is often not
 * a number at all: "Stuart asked about this horse on Monday" is a piece of
 * intelligence no query against the warehouse will ever return, because it is
 * not in the warehouse - it is in the questions people asked it.
 *
 * So every question put to BlandfordAI is written down, and the assistant can
 * search them. That is the whole mechanism: no inference about intent, no
 * profile of anybody, just the questions and who asked them.
 *
 * Scope, deliberately: this is one small internal team who already share a
 * tracker, a client list and a review list. Their questions are shared on the
 * same basis. Nothing here reaches outside the account.
 */

export const TEAM_MEMORY_TABLE = "ai_questions";

export const TEAM_MEMORY_DDL = `CREATE TABLE IF NOT EXISTS ${TEAM_MEMORY_TABLE} (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  question TEXT NOT NULL,
  asked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_aiq_asked (asked_at),
  KEY idx_aiq_user (user_id, asked_at)
)`;

/** A question longer than this is stored truncated; nobody reads past it anyway. */
export const MAX_QUESTION_CHARS = 2000;

/**
 * A horse's name arrives written several ways - "PABORUS (FR)", "Paborus",
 * "paborus" - and the search has to find all of them from any of them. Country
 * suffixes and punctuation go; letters, digits, spaces, apostrophes and hyphens
 * stay, because "Ol' Man River" and "Al-Nayyir" are names.
 */
export function normaliseSubject(raw) {
  return String(raw ?? "")
    .replace(/\((?:[A-Za-z]{2,4})\)/g, " ")
    .replace(/[^\p{L}\p{N}\s'\-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Too short a subject matches every question ever asked, which is worse than
 * no answer: it would have the assistant announce a coincidence as a
 * connection. Three characters is the floor.
 */
export function isSearchableSubject(raw) {
  return normaliseSubject(raw).length >= 3;
}

/** How long ago, said the way a person would say it. */
export function describeAge(askedAt, now = new Date()) {
  const then = askedAt instanceof Date ? askedAt : new Date(askedAt);
  if (Number.isNaN(then.getTime())) return "at an unknown time";
  const days = Math.floor((startOfDay(now) - startOfDay(then)) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 31) return `${Math.round(days / 7)} weeks ago`;
  if (days < 60) return "last month";
  return `${Math.round(days / 30)} months ago`;
}

const startOfDay = (d) => {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.getTime();
};

/**
 * Split what came back into what colleagues asked and what this user asked
 * themselves. Both are worth having, and they are worth having apart: "you
 * asked this last week" is a different remark from "Stuart asked this last
 * week", and running them together would let the assistant claim a colleague's
 * interest that is really the reader's own.
 */
export function splitByAsker(rows, { userId, now = new Date() } = {}) {
  const me = String(userId ?? "").trim().toLowerCase();
  const colleagues = [];
  const you = [];
  for (const r of rows || []) {
    const asker = String(r.user_id ?? "").trim();
    const entry = {
      asked_by: asker,
      when: describeAge(r.asked_at, now),
      asked_at: r.asked_at instanceof Date ? r.asked_at.toISOString() : String(r.asked_at ?? ""),
      question: String(r.question ?? ""),
    };
    if (me && asker.toLowerCase() === me) you.push(entry);
    else colleagues.push(entry);
  }
  return { colleagues, you };
}

/**
 * Who has been asking, most recently first, so the assistant can name a person
 * rather than a count: "Stuart has asked about him twice this week".
 */
export function askerSummary(entries) {
  const byAsker = new Map();
  for (const e of entries || []) {
    const k = e.asked_by || "someone";
    if (!byAsker.has(k)) byAsker.set(k, { asked_by: k, times: 0, most_recent: e.when });
    byAsker.get(k).times += 1;
  }
  return [...byAsker.values()];
}
