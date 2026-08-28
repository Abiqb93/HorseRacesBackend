/**
 * French racecards for the RacesAndEntries table.
 *
 * The platform's racecards come from a United Kingdom feed that has never
 * carried France, so the Racecards page has shown no French fixture ever. PMU
 * publishes its programme several days ahead with the full declared field, so
 * the same table can hold French cards written in its own shape.
 *
 * RacesAndEntries is all strings, laid out for display rather than for
 * queries, so the job here is formatting rather than modelling. Two places
 * where matching the British column exactly would misstate the racing:
 *
 *   - Weight. British racing carries stones and pounds, French carries
 *     kilos, and those are different facts about the horse -- "9st 9lb"
 *     against a French runner would be a conversion nobody asked for. The
 *     kilo is written as the kilo it is.
 *   - Prize. Euros, marked as euros.
 *
 *   - Distance. Metres, as the race is run and described. The column is
 *     display-only on the racecards page, and rounding 2100m into "10f"
 *     would quietly lose 90 metres of a trip.
 *
 * Off times are Europe/Paris. PMU sends epoch millis and reading them as UTC
 * put Deauville's opener at 11.58am in the Morning session when it goes off
 * at 1.58pm.
 */

import { fetchProgramme, fetchParticipants, isThoroughbredRace, sleep } from "./pmuClient.mjs";
import { normalizeCourseName, raceTypeOf } from "./normalize.mjs";

export const FRANCE_CARD_SOURCE = "France";

const SEX = { MALES: "C", FEMELLES: "F", HONGRES: "G" };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];

/**
 * PMU shouts its people: "M.ANDRIANTSOA RATSIMIHAH", "J.MOUTARD". The initial
 * needs its own space or the surname keeps the lower case that follows the
 * dot -- "J.moutard".
 */
const titleCase = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\.(?=\S)/g, ". ")
    .replace(/(^|[\s\-'.])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();

/** "2026-08-28" -> "Friday 28  August 2026", the double space and all. */
export function fixtureDateOf(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}  ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The hour and minute a French race goes off, in France. */
function parisClock(epochMs) {
  if (!epochMs) return null;
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const at = (t) => Number(parts.find((x) => x.type === t)?.value);
  const hour = at("hour") % 24; // en-GB can render midnight as 24
  return { hour, minute: at("minute") };
}

/** Epoch millis -> "2.00pm", matching the British rows. */
export function raceTimeOf(epochMs) {
  const c = parisClock(epochMs);
  if (!c) return null;
  const suffix = c.hour < 12 ? "am" : "pm";
  const h12 = c.hour % 12 === 0 ? 12 : c.hour % 12;
  return `${h12}.${String(c.minute).padStart(2, "0")}${suffix}`;
}

export function sessionOf(epochMs) {
  const c = parisClock(epochMs);
  if (!c) return null;
  if (c.hour < 12) return "Morning";
  if (c.hour < 17) return "Afternoon";
  return "Evening";
}

/** "Flat / Turf", "Hurdle / Turf" -- the discipline and what it is run on. */
export function raceTypeLabelOf(course) {
  const type = raceTypeOf(course);
  const surface = course?.typePiste === "PSF" ? "All Weather" : "Turf";
  return `${type} / ${surface}`;
}

/** The age and sex conditions, as the card states them. */
export function ageGroupOf(course) {
  const raw = course?.conditions || course?.conditionAge || "";
  const m = String(raw).match(/\b(\d)\s*(?:ET|A|À|-)\s*(\d)\s*ANS\b/i);
  if (m) return `${m[1]}-${m[2]}YO`;
  const one = String(raw).match(/\b(\d)\s*ANS\b/i);
  if (one) return `${one[1]}YO`;
  const plus = String(raw).match(/\b(\d)\s*ANS\s*ET\s*PLUS\b/i);
  if (plus) return `${plus[1]}YO+`;
  return null;
}

const euros = (n) =>
  Number.isFinite(Number(n)) ? `€${Number(n).toLocaleString("en-GB")}` : null;

/** One declared runner, in the table's own column names. */
export function cardRowFor({ meeting, course, participant, isoDate, seq }) {
  const p = participant;
  const off = course?.heureDepart ?? null;
  const track = normalizeCourseName(meeting.hippodrome?.libelleLong || meeting.hippodrome?.libelleCourt);
  const reunion = meeting.numOfficiel;
  const num = course.numExterne;

  return {
    "No.": p.numPmu != null ? String(p.numPmu) : null,
    No_Draw: p.placeCorde != null ? String(p.placeCorde) : null,
    Horse: titleCase(p.nom),
    Rider: titleCase(p.driver),
    Age: p.age != null ? String(p.age) : null,
    Sex: SEX[p.sexe] || null,
    Rating: p.handicapValeur != null ? String(p.handicapValeur) : null,
    // Kilos, because that is what a French runner carries.
    Weight: Number.isFinite(p.handicapPoids) ? `${(p.handicapPoids / 10).toFixed(1)}kg` : null,
    Trainer: titleCase(p.entraineur),
    Owner: titleCase(p.proprietaire),
    RaceTime: raceTimeOf(off),
    RaceID: `${isoDate}:R${reunion}:C${num}`,
    RaceTitle: titleCase(course.libelle),
    Distance: course.distance ? `${course.distance}m` : null,
    AgeGroup: ageGroupOf(course),
    Prize: euros(course.montantPrix),
    SF_MF: null, // British feed's own fields; France has no equivalent
    FSL: null,
    Entries: course.nombreDeclaresPartants != null ? String(course.nombreDeclaresPartants) : null,
    Status: p.statut === "NON_PARTANT" ? "Non-runner" : "Runners published",
    RaceURL: `https://www.pmu.fr/turf/${isoDate.split("-").reverse().join("")}/R${reunion}/C${num}`,
    FixtureTrack: track,
    FixtureDate: fixtureDateOf(isoDate),
    RaceType: raceTypeLabelOf(course),
    Session: sessionOf(off),
    seq: String(seq),
    fixture_url: `https://www.pmu.fr/turf/${isoDate.split("-").reverse().join("")}/R${reunion}`,
    source: FRANCE_CARD_SOURCE,
  };
}

/** Every declared French runner on a date, as racecard rows. */
export async function fetchCardsForDate(isoDate, { delayMs = 150, log = () => {} } = {}) {
  const programme = await fetchProgramme(isoDate);
  const meetings = (programme?.reunions || []).filter(
    (r) => r?.pays?.code === "FRA" && (r.courses || []).some(isThoroughbredRace),
  );

  const rows = [];
  for (const meeting of meetings) {
    let seq = 0;
    for (const course of meeting.courses || []) {
      if (!isThoroughbredRace(course)) continue;
      const participants = await fetchParticipants(isoDate, meeting.numOfficiel, course.numExterne);
      for (const participant of participants) {
        rows.push(cardRowFor({ meeting, course, participant, isoDate, seq }));
      }
      seq += 1;
      await sleep(delayMs);
    }
    log(`${isoDate} ${meeting.hippodrome?.libelleCourt}: ${seq} races`);
  }
  return rows;
}
