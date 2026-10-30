// Copied from horses-website-deployed src/utils/racecardFields.js, which the home page uses; keep
// the two the same, so the lists built here match what the page would build.

/**
 * Reading a racecard row the way a racecard prints it.
 *
 * The entries feeds carry the facts a runner is described by, but in the shapes
 * the racing authorities publish them in: a class buried inside a race title, a
 * distance written "1m 3f 39y", a declaration state expressed as one of six
 * status strings. These turn each into the one value a table column shows.
 *
 * Every one of them returns null rather than a guess. A race with no class is
 * an Irish or French race, which genuinely has none — printing "Cl 0" there
 * would be inventing a fact about someone else's programme book.
 */

/** "(Class 4)" inside a title -> "Cl 4". British racing only. */
export const raceClass = (raceTitle) => {
  const m = String(raceTitle ?? "").match(/\(Class\s*(\d)\)/i);
  return m ? `Cl ${m[1]}` : null;
};

/**
 * "5f 182y" -> "5f182y", "1m 3f 39y" -> "1m3f39y", "1m" -> "1m".
 * A racecard closes the gaps up; the feed does not.
 */
export const raceDistance = (distance) => {
  const t = String(distance ?? "").trim();
  return t ? t.replace(/\s+/g, "") : null;
};

/**
 * Has this horse been declared to run, or is it only entered?
 *
 * The feeds use six different words for three states, and the difference
 * matters to anyone reading the list: a declaration is a horse that will run
 * tomorrow, an entry is one that might run next week.
 *
 *   "declared"    it is in the race
 *   "entered"     it is entered, declarations are not in yet
 *   "non-runner"  it was declared and has been taken out
 *   null          the feed did not say
 */
export const declarationState = (status) => {
  const t = String(status ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t.includes("non-runner") || t.includes("non runner")) return "non-runner";
  if (t.includes("runners published") || t.startsWith("declaration")) return "declared";
  if (t.includes("open for declarations") || t.includes("entries published")) return "entered";
  return null;
};

/**
 * Is this horse a non-runner?
 *
 * The feeds say so in two places and they do not agree. Most withdrawals set
 * the status to "Non-runner", but some leave the status reading "Runners
 * published" and write "Non Runner" into the jockey field instead — on the day
 * I checked, 7 rows the first way and 2 the second, with **no overlap**.
 * Reading only the status leaves those two on the dashboard as live runners
 * with a jockey called Non Runner.
 */
export const isNonRunner = (row) => {
  if (!row) return false;
  if (declarationState(row.entryStatus ?? row.Status) === "non-runner") return true;
  const rider = String(row.jockeyName ?? row.Rider ?? row.jockey ?? "").trim();
  return /^non[\s-]?runner$/i.test(rider);
};

/** A racecard shows the time as it is called: "2.12pm" -> "2:12". */
export const raceClock = (raceTime) => {
  const t = String(raceTime ?? "").trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})[.:](\d{2})\s*(am|pm)?$/i);
  if (!m) return t;
  let h = Number(m[1]);
  const suffix = (m[3] || "").toLowerCase();
  if (suffix === "pm" && h < 12) h += 12;
  if (suffix === "am" && h === 12) h = 0;
  // Racecards print afternoon times without the 24-hour hour: 2:12, not 14:12.
  const shown = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${shown}:${m[2]}`;
};

/**
 * A race day, read as the day it is printed on — never shifted by a timezone.
 *
 * ## The bug this exists to end
 *
 * The feeds write a race day two ways: `"2026-09-10"` and
 * `"Thursday 10  September 2026"`. Handed to `new Date`, those two disagree:
 * a bare `YYYY-MM-DD` is parsed as **UTC midnight** while the prose form is
 * parsed as **local midnight**. In Britain, where this product is used, UTC
 * midnight on the 10th is 1am on the 10th — but read back the other way, local
 * midnight on the 10th is 11pm on the **9th**.
 *
 * That one hour cost a day twice over, in opposite directions:
 *
 *   Entries & Declarations  The day heading was built from
 *                           `localMidnight.toISOString()` and read back with
 *                           `getUTCDate()`, so every runner was filed under
 *                           yesterday.
 *   Tracker                 `new Date(Date.parse("2026-09-10"))` landed on the
 *                           9th once `setHours(0,0,0,0)` pulled it to local
 *                           midnight, so the day's ISO-dated runners went into
 *                           the Past bucket and vanished from Today. The prose
 *                           rows were unaffected, which is why the page looked
 *                           right apart from the horses that were missing.
 *
 * A race day is a **calendar day, not an instant**. These two functions are the
 * only place that idea is turned into a Date or a string, so the two halves
 * cannot drift apart again.
 */

/** The months as the feeds spell them, long and short, English. */
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * A printed race day -> a Date at LOCAL midnight on that day.
 *
 * Local, because every "is this today?" test in the app compares against a
 * local midnight, and the two have to be on the same clock to be subtracted.
 * Returns null rather than a guess: a day we cannot read is not a day we should
 * invent.
 */
export const parseRaceDay = (raw) => {
  if (raw instanceof Date) {
    return Number.isFinite(raw.getTime())
      ? new Date(raw.getFullYear(), raw.getMonth(), raw.getDate())
      : null;
  }
  const s = String(raw ?? "").trim();
  if (!s) return null;

  const at = (y, m, d) => {
    const date = new Date(y, m, d);
    // Rejects "2026-02-31", which JS would roll forward to 3 March.
    return date.getFullYear() === y && date.getMonth() === m && date.getDate() === d
      ? date
      : null;
  };

  // "2026-09-10", and the same with a time or a Z after it — the day is the
  // first ten characters and the rest is somebody else's timezone problem.
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return at(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  // "10/09/2026" and "10-09-2026" — day first, as every British and French
  // feed here writes it.
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return at(Number(m[3]), Number(m[2]) - 1, Number(m[1]));

  // "Thursday 10  September 2026", "Wednesday, 10th September 2026",
  // "10 September 2026" — a weekday and an ordinal are both optional, and the
  // spacing is whatever the PDF left behind.
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/);
  if (m) {
    const month = MONTHS.findIndex((name) => name.startsWith(m[2].toLowerCase().slice(0, 3)));
    if (month >= 0) return at(Number(m[3]), month, Number(m[1]));
  }

  return null;
};

/**
 * A race day -> the stamp the day heading reads: `"2026-09-10T00:00:00.000Z"`.
 *
 * Midnight **UTC**, because `raceDayHeading` below reads it with `getUTCDate`.
 * Never `toISOString()` on a local-midnight Date: that is the bug above, and it
 * is silent everywhere east of Greenwich.
 */
export const raceDayStamp = (raw) => {
  const d = parseRaceDay(raw);
  if (!d) return null;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}T00:00:00.000Z`;
};

/** The plain `YYYY-MM-DD` of a race day, from a stamp or from anything else. */
export const raceDayYMD = (raw) => raceDayStamp(raw)?.slice(0, 10) ?? "";

/** A day heading the way a racecard writes it: "Tuesday, 08 September, 2026". */
export const raceDayHeading = (iso) => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "Unknown date";
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = d.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  return `${weekday}, ${day} ${month}, ${d.getUTCFullYear()}`;
};

/** Title case for the feeds' shouted course names: "CARLISLE" -> "Carlisle". */
export const courseName = (v) =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\s+/g, " ") || null;

/**
 * The Race Details link for a runner-table row.
 *
 * The page needs the day as well as the title: a results link without
 * `meetingDate` cannot ask the results feed for its day, and falls through to
 * the generic records view, which fails. The course goes along so two races
 * of the same name on one day open the right one. A row that never learned
 * its feed (`encodedUrl`) has no race to open, and gets no link.
 */
export const raceDetailsHref = (row = {}) => {
  if (!row.encodedUrl) return null;
  const title = row.encodedRaceTitle || encodeURIComponent(String(row.raceTitle || "").trim());
  let href = `/dashboard/racedetails?url=${row.encodedUrl}&RaceTitle=${title}`;
  const day = raceDayYMD(row.raceDateISO || row.dateStr || row.date);
  if (day) href += `&meetingDate=${day}`;
  const course = String(row.raceTrack || row.track || "").trim();
  if (course && course !== "-") href += `&courseName=${encodeURIComponent(course)}`;
  return href;
};
