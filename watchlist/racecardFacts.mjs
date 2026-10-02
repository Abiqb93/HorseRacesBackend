/**
 * A watch-list item, read the way the racecard prints it.
 *
 * The Daily Watch List keeps each item as the morning job wrote it: the horse,
 * its race's title, day, time and course, and its connections. It never kept
 * the racecard's own columns: the distance, the official rating, and whether
 * the horse has been declared or taken out. The Dashboard's entries table
 * prints all three, and the watch list is laid out in that table.
 *
 * A new column would need the morning job changed and every stored row
 * backfilled. Instead the facts are read off RacesAndEntries when the list is
 * asked for. That table is the British racecard, current to its last scrape,
 * so a horse declared or withdrawn since the morning reads as it now stands.
 *
 * Everything here is pure. The server hands in the watch-list rows and the
 * racecard rows it read, and gets back the rows with what matched. A row that
 * matches nothing comes back as it went in, and a value the row already holds
 * is never overwritten.
 */

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const pad = (n) => String(n).padStart(2, "0");

/**
 * A race day as "YYYY-MM-DD", from any of the shapes the tables hold:
 * "Friday 2  October 2026", "2026-10-02", "2026-10-02T00:00:00.000Z",
 * "02-10-2026", or a Date (a DATE column, read at local midnight). Anything
 * else, including MySQL's "0000-00-00", is "".
 */
export const dayKey = (value) => {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime())
      ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
      : "";
  }
  const s = String(value ?? "").trim();
  if (!s) return "";
  const at = (y, m, d) => {
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
      ? `${y}-${pad(m)}-${pad(d)}`
      : "";
  };
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return at(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return at(Number(m[3]), Number(m[2]), Number(m[1]));
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/);
  if (m) {
    const month = MONTHS.findIndex((name) => name.startsWith(m[2].toLowerCase().slice(0, 3)));
    if (month >= 0) return at(Number(m[3]), month + 1, Number(m[1]));
  }
  return "";
};

/**
 * A race time as 24-hour "HH:MM", from "3.00pm", "3:00 PM", "05:18 PM",
 * "15:00" or "15:00:00". A racecard time with no am or pm and a one-figure
 * hour is an afternoon race: "1.50" is ten to two in the afternoon. A
 * zero-padded or seconds-bearing time, "09:30:00", is the 24-hour clock.
 */
export const clockKey = (value) => {
  const m = String(value ?? "").trim().toLowerCase().match(/^(\d{1,2})[.:](\d{2})(:\d{2})?\s*(am|pm)?$/);
  if (!m) return "";
  let h = Number(m[1]);
  if (m[4] === "pm" && h < 12) h += 12;
  else if (m[4] === "am" && h === 12) h = 0;
  else if (!m[4] && !m[3] && m[1].length === 1) h += 12;
  return h > 23 || Number(m[2]) > 59 ? "" : `${pad(h)}:${m[2]}`;
};

/** A horse's name for matching: "Drymee", " DRYMEE " and "Drymee (IRE)" are one horse. */
export const nameKey = (value) =>
  String(value ?? "").replace(/\s*\([A-Z]{2,3}\)\s*$/i, "").trim().replace(/\s+/g, " ").toLowerCase();

/** A course for matching: "Kempton Park" and "KEMPTON PARK" are one course. */
export const trackKey = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();

const titleKey = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

const present = (v) => v !== null && v !== undefined && String(v).trim() !== "" && String(v).trim() !== "--";

/** Fill what the row lacks, never what it holds. */
const fill = (row, facts) => {
  const out = { ...row };
  for (const [key, value] of Object.entries(facts)) {
    if (present(value) && !present(out[key])) out[key] = String(value).trim();
  }
  return out;
};

/** Of several racecard rows for one item, the one at its course and time. */
const best = (candidates, track, clock) => {
  if (candidates.length < 2) return candidates[0] || null;
  const score = (c) => (trackKey(c.FixtureTrack) === track ? 2 : 0) + (clockKey(c.RaceTime) === clock ? 1 : 0);
  return candidates.reduce((a, c) => (score(c) > score(a) ? c : a));
};

/**
 * Horse items (daily_notifications_all_users rows): each gains the distance,
 * official rating and declaration state of its runner on the racecard, and
 * the racecard's own title for its race, which carries the class.
 *
 * Matched on the horse and the day, then the course and time where a horse
 * holds two racecard rows that day (the scrape stores some races twice, once
 * under each of its date formats).
 */
export function attachRunnerFacts(rows = [], cards = []) {
  const byRunner = new Map();
  for (const card of cards) {
    const key = `${nameKey(card.Horse)}|${dayKey(card.FixtureDate)}`;
    if (!byRunner.has(key)) byRunner.set(key, []);
    byRunner.get(key).push(card);
  }
  return rows.map((row) => {
    const day = dayKey(row.raceDateStr) || dayKey(row.raceDate);
    const name = nameKey(row.horseName);
    if (!name || !day) return row;
    const card = best(byRunner.get(`${name}|${day}`) || [], trackKey(row.track), clockKey(row.raceSortTime) || clockKey(row.raceTime));
    if (!card) return row;
    return fill(row, {
      distance: card.Distance,
      officialRating: card.Rating,
      entryStatus: card.Status,
      racecardTitle: card.RaceTitle,
    });
  });
}

/**
 * Race items (race_watchlist rows): each gains its race's distance and the
 * racecard's title, matched on the course, day and time, or failing that on
 * the title and day.
 */
export function attachRaceFacts(races = [], cards = []) {
  const bySlot = new Map();
  const byTitle = new Map();
  for (const card of cards) {
    const day = dayKey(card.FixtureDate);
    if (!day) continue;
    const slot = `${trackKey(card.FixtureTrack)}|${day}|${clockKey(card.RaceTime)}`;
    if (!bySlot.has(slot)) bySlot.set(slot, card);
    const title = `${titleKey(card.RaceTitle)}|${day}`;
    if (!byTitle.has(title)) byTitle.set(title, card);
  }
  return races.map((race) => {
    const day = dayKey(race.race_date);
    if (!day) return race;
    const card = bySlot.get(`${trackKey(race.track)}|${day}|${clockKey(race.race_time)}`)
      || byTitle.get(`${titleKey(race.race_title)}|${day}`);
    if (!card) return race;
    return fill(race, { distance: card.Distance, racecardTitle: card.RaceTitle });
  });
}

/** The courses a list of race items names, as RacesAndEntries writes them. */
export const raceTracks = (races = []) =>
  [...new Set(races.map((r) => trackKey(r.track)).filter(Boolean))];

/** The horses a list of horse items names, for the racecard query (which ignores case). */
export const runnerNames = (rows = []) =>
  [...new Set(rows.map((r) => String(r.horseName ?? "").replace(/\s*\([A-Z]{2,3}\)\s*$/i, "").trim()).filter(Boolean))];
