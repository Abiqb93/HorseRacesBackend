/**
 * Maps a scraped France Galop race + runner onto the same platform shape that
 * `normalize.js` produces for PMU, so the two sources are directly comparable
 * and can be merged field by field.
 *
 * France Galop carries several things PMU does not, and they are the reason it
 * is the spine rather than a fallback:
 *   - the country suffix on the horse name  (CANTAVIR (GB))
 *   - the official `Valeur` handicap rating
 *   - `prime éleveur`, the French breeder premium
 *   - entries/forfeits counts
 *   - a stable France Galop horse id, at /fr/cheval/{id}
 */

import { toFurlongs, normalizeCourseName } from "./normalize.mjs";

/** France Galop going labels, as they appear on the fixture and race pages. */
const GOING = {
  "TRES LEGER": "Very Firm",
  LEGER: "Firm",
  BON: "Good",
  "BON SOUPLE": "Good To Soft",
  "TRES SOUPLE": "Soft",
  "TR SOUPLE": "Soft",
  SOUPLE: "Soft",
  COLLANT: "Holding",
  "TRES COLLANT": "Very Holding",
  LOURD: "Heavy",
  "TRES LOURD": "Very Heavy",
  PSF: "Standard",
};

const stripAccents = (s) =>
  String(s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");

export function normalizeGoing(label) {
  if (!label) return null;
  const key = stripAccents(label).toUpperCase().replace(/\s+/g, " ").trim();
  return GOING[key] || label;
}

/**
 * `disciplineLetter` is P (Plat) or O (Obstacle); `speciality` refines the
 * jumps code — S steeple-chase, H haies (hurdles), C cross-country.
 */
export function normalizeRaceType(race) {
  if (race.disciplineLetter === "O") return "Jumps";
  const spec = String(race.speciality || "").trim().toUpperCase();
  if (/^[SHC]\b/.test(spec)) return "Jumps";
  return "Flat";
}

/**
 * Black type from the France Galop category, which spells the group out.
 * PMU's `categorieParticularite` is authoritative for Pattern races and this
 * agrees with it; France Galop additionally names Listed races, which PMU does
 * not flag at all.
 */
export function blackTypeFromFG(race) {
  const s = `${race.raceCategory || ""} ${race.raceTitle || ""}`.toUpperCase();
  if (/\bGROUPE?\s*(?:I{1,3}|[123])\b/.test(s)) {
    if (/\bGROUPE?\s*(?:III|3)\b/.test(s)) return { group: 3, listed: 0 };
    if (/\bGROUPE?\s*(?:II|2)\b/.test(s)) return { group: 2, listed: 0 };
    return { group: 1, listed: 0 };
  }
  if (/\bLISTED\b/.test(s)) return { group: null, listed: 1 };
  return { group: null, listed: 0 };
}

/** One platform-shaped row per France Galop runner. */
export function normalizeFGRunner({ fixture, race, runner }) {
  const bt = blackTypeFromFG(race);
  const season = Number(String(race.meetingDate || fixture?.meetingDate || "").slice(0, 4));

  return {
    // ---- provenance ------------------------------------------------
    sourceSystem: "FG",
    sourceHorseId: runner.fgHorseId ?? null,
    sourceRaceId: race.raceCode ?? null,

    // ---- identity --------------------------------------------------
    horseName: runner.horseName,
    horseNameRaw: runner.horseNameRaw ?? runner.horseName,
    horseCountry: runner.country || "FR", // no suffix means French-bred
    countryCode: runner.country || "FR",
    horseAge: runner.age ?? null,
    foalingYear: Number.isFinite(runner.age) && season ? season - runner.age : null,
    horseGender: runner.sex ?? null,
    breed: runner.breed ?? null, // PS = Pur-Sang; AQPS is not a thoroughbred

    // ---- pedigree --------------------------------------------------
    sireName: runner.sireName ?? null,
    damName: runner.damName ?? null,
    damsireName: runner.damsireName ?? null,
    breederName: runner.breederName ?? null,

    // ---- connections -----------------------------------------------
    trainerFullName: runner.trainerFullName ?? null,
    jockeyFullName: runner.jockeyFullName ?? null,
    ownerFullName: runner.ownerFullName ?? null,
    trainingArea: runner.trainingArea ?? null,

    // ---- race ------------------------------------------------------
    raceCountry: "FRA",
    meetingDate: race.meetingDate ?? fixture?.meetingDate ?? null,
    courseName: normalizeCourseName(race.courseName || fixture?.courseName),
    raceNumber: race.raceNumber ?? null,
    officialRaceNumber: race.officialRaceNumber ?? null,
    raceTitle: race.raceTitle ?? null,
    raceType: normalizeRaceType(race),
    raceCategory: race.raceCategory ?? null,
    raceClass: race.raceClass ?? null,
    raceConditions: race.raceConditions ?? null,
    distance: toFurlongs(race.distanceMetres),
    distanceMetres: race.distanceMetres ?? null,
    going: normalizeGoing(race.goingLabel ?? fixture?.goingLabel),
    goingValue: race.goingValue ?? fixture?.goingValue ?? null,
    railSide: race.railSide ?? null,
    scheduledTimeOfRaceLocal:
      race.meetingDate && race.startTime ? `${race.meetingDate}T${race.startTime}:00` : null,
    numberOfRunners: race.fieldCounts?.declared ?? race.declaredRunners ?? null,
    prizeFund: race.prizeFund ?? null, // euros
    Group: bt.group,
    Listed: bt.listed,
    isPremium: race.isPremium ?? fixture?.isPremium ?? null,

    // ---- entries (France Galop only) --------------------------------
    entered: race.fieldCounts?.entered ?? null,
    forfeits: race.fieldCounts?.forfeits ?? null,
    supplemented: race.fieldCounts?.supplemented ?? null,
    notDeclared: race.fieldCounts?.notDeclared ?? null,

    // ---- runner in race ---------------------------------------------
    clothNumber: runner.clothNumber ?? null,
    draw: runner.draw ?? null,
    weightKg: runner.weightKg ?? null,
    weightBeforeClaim: runner.weightBeforeClaim ?? null,
    headGear: runner.headGear ?? null,
    officialRating: runner.officialRating ?? null, // the French `Valeur`
    positionOfficial: runner.positionOfficial ?? null,
    beatenMargin: runner.beatenMargin ?? null,
    prizeMoneyWon: runner.prizeMoneyWon ?? null,
    primeProprietaire: runner.primeProprietaire ?? null,
    primeEleveur: runner.primeEleveur ?? null,
    formString: runner.formString ?? null,
    winnerTime: race.winnerTime ?? null,
    isResult: Boolean(race.isResult),
  };
}

/** Flattens a whole scraped day into platform-shaped rows. */
export function normalizeFGDay(days) {
  const rows = [];
  for (const { fixture, races } of days) {
    for (const race of races) {
      for (const runner of race.runners) {
        rows.push(normalizeFGRunner({ fixture, race, runner }));
      }
    }
  }
  return rows;
}

/**
 * Thoroughbred filter. France Galop cards include AQPS races (*autre que
 * pur-sang*), which are not thoroughbreds and are out of scope unless
 * explicitly enabled.
 */
export function isThoroughbred(row) {
  return !row.breed || row.breed === "PS";
}
