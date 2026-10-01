/**
 * French racecards from Sporting Life, for the meetings PMU has not published.
 *
 * PMU is the racecards' source and stays so: it carries the full declared
 * field with draws, weights in kilos and PMU's own race ids. But it publishes
 * a weekend's big cards late and in stages. At 11:26 London on Thursday
 * 1 October 2026 PMU's Saturday programme held Cabourg, Laval, Amiens and
 * Beaumont but not ParisLongchamp, while Racing Post was already showing the
 * Arc Saturday field -- Diego Ventura and Fallen Angel in the Prix Daniel
 * Wildenstein among them -- and the Tracker and Dashboard showed nothing.
 *
 * Sporting Life had that card, runners and all, from its public JSON. So a
 * meeting Sporting Life lists and PMU does not is written from Sporting Life,
 * and as soon as PMU publishes the meeting PMU's rows replace it: the merge is
 * by meeting, PMU first, and every pass rewrites the date.
 *
 * Two things that differ from PMU and are written as they are rather than
 * converted into something the source did not say:
 *
 *   - Times. Sporting Life's `time` is UTC (Salisbury's 1.30pm is "12:30",
 *     Argentan's 12.23pm in France is "10:23"), so it is read as UTC and
 *     stated in Paris time, like every other French row.
 *   - Weight and distance. Sporting Life gives British forms ("9-2",
 *     "7f 209y"); they are kept, because the kilo and the metre are not on
 *     the page to be read.
 */

import { normalizeCourseName } from "./normalize.mjs";
import { sleep } from "./pmuClient.mjs";
import { FRANCE_CARD_SOURCE, fetchCardsForDate, fixtureDateOf, raceTimeOf, sessionOf } from "./racecards.mjs";

const BASE = "https://www.sportinglife.com/api/horse-racing";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function getJson(url, { timeoutMs = 30000 } = {}) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Sporting Life ${res.status} for ${url}`);
  return res.json();
}

const SEX = { c: "C", f: "F", g: "G", h: "C", m: "F", r: "C" };

/** A meeting in France, by the country Sporting Life files it under. */
export const isFrenchMeeting = (meeting) =>
  /^france$/i.test(String(meeting?.meeting_summary?.course?.country?.long_name || "").trim());

/** The same course however a source spells it: "ParisLongchamp" = "LONGCHAMP". */
export const trackKey = (name) =>
  normalizeCourseName(name).replace(/[^A-Z0-9]/g, "");

/** "2026-10-03" + "15:35" (UTC) -> epoch millis. */
export function offEpoch(isoDate, utcClock) {
  const m = String(utcClock || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ""))) return null;
  const [y, mo, d] = isoDate.split("-").map(Number);
  return Date.UTC(y, mo - 1, d, Number(m[1]), Number(m[2]));
}

const slugOf = (s) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");

const euros = (text) => {
  const n = Number(String(text || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? `€${Math.round(n).toLocaleString("en-GB")}` : null;
};

/** One Sporting Life ride, in RacesAndEntries' own column names. */
export function slCardRowFor({ meeting, race, ride, isoDate, seq, prize = null }) {
  const summary = race?.race_summary ?? race;
  const course = meeting?.meeting_summary?.course?.name || summary?.course_name;
  const off = offEpoch(summary?.date || isoDate, summary?.time);
  const raceId = summary?.race_summary_reference?.id;
  const horse = ride?.horse ?? {};
  const slug = horse.slug ? `https://www.sportinglife.com/racing/profiles/horse/${horse.slug}` : null;

  return {
    "No.": ride?.cloth_number != null ? String(ride.cloth_number) : null,
    No_Draw: ride?.draw_number ? String(ride.draw_number) : null,
    Horse: horse.name || null,
    Rider: ride?.jockey?.name || null,
    Age: horse.age != null ? String(horse.age) : null,
    Sex: SEX[String(horse.sex?.type || "").toLowerCase()] || null,
    Rating: ride?.official_rating != null ? String(ride.official_rating) : null,
    Weight: ride?.handicap || null,
    Trainer: ride?.trainer?.name || null,
    Owner: ride?.owner?.name || null,
    RaceTime: raceTimeOf(off),
    RaceID: raceId != null ? `SL:${raceId}` : null,
    RaceTitle: summary?.name || null,
    Distance: summary?.distance || null,
    AgeGroup: summary?.age || null,
    Prize: prize,
    SF_MF: null,
    FSL: null,
    Entries: summary?.ride_count != null ? String(summary.ride_count) : null,
    Status: ride?.ride_status === "NON_RUNNER" ? "Non-runner" : "Runners published",
    RaceURL: raceId != null
      ? `https://www.sportinglife.com/racing/racecards/${isoDate}/${slugOf(course)}/racecard/${raceId}/${slugOf(summary?.name)}`
      : slug,
    FixtureTrack: normalizeCourseName(course),
    FixtureDate: fixtureDateOf(isoDate),
    RaceType: `Flat / ${summary?.course_surface?.surface === "ALL_WEATHER" ? "All Weather" : "Turf"}`,
    Session: sessionOf(off),
    seq: String(seq),
    fixture_url: `https://www.sportinglife.com/racing/racecards/${isoDate}`,
    source: FRANCE_CARD_SOURCE,
  };
}

/** Every runner Sporting Life lists at a French meeting on a date. */
export async function fetchSlFrenchCardsForDate(isoDate, { delayMs = 250, log = () => {} } = {}) {
  const meetings = (await getJson(`${BASE}/v2/racing/racecards/${isoDate}`)) || [];
  const rows = [];
  for (const meeting of meetings.filter(isFrenchMeeting)) {
    let seq = 0;
    for (const race of meeting.races || []) {
      const id = race?.race_summary_reference?.id;
      if (id == null) continue;
      const card = await getJson(`${BASE}/race/${id}`);
      const prize = euros(card?.prizes?.prize?.find((p) => p.position === 1)?.prize);
      for (const ride of card?.rides || []) {
        rows.push(slCardRowFor({ meeting, race: card.race_summary ?? race, ride, isoDate, seq, prize }));
      }
      seq += 1;
      await sleep(delayMs);
    }
    log(`${isoDate} ${meeting.meeting_summary?.course?.name} (Sporting Life): ${seq} races`);
  }
  return rows;
}

/**
 * PMU's rows, plus Sporting Life's for any meeting PMU does not have.
 *
 * By meeting rather than by race, so a card is never half one source and half
 * the other: the two name races differently and would both show.
 */
export function mergeCardSources(pmuRows = [], slRows = []) {
  const pmuTracks = new Set(pmuRows.map((r) => trackKey(r.FixtureTrack)));
  const added = slRows.filter((r) => !pmuTracks.has(trackKey(r.FixtureTrack)));
  return { rows: [...pmuRows, ...added], fromSportingLife: added.length };
}

/**
 * A date's French cards from both sources, PMU first.
 *
 * Either source failing leaves the other's rows standing rather than failing
 * the date: Sporting Life is the stopgap, and PMU being down is exactly when
 * the stopgap is wanted.
 */
export async function fetchAllCardsForDate(isoDate, { log = () => {} } = {}) {
  let pmu = [];
  let sl = [];
  try {
    pmu = await fetchCardsForDate(isoDate, { log });
  } catch (err) {
    log(`${isoDate} PMU failed: ${err.message}`);
  }
  try {
    sl = await fetchSlFrenchCardsForDate(isoDate, { log });
  } catch (err) {
    log(`${isoDate} Sporting Life failed: ${err.message}`);
  }
  return mergeCardSources(pmu, sl);
}
