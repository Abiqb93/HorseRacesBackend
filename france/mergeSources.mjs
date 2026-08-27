/**
 * Reconciles France Galop and PMU into one canonical set of French races and
 * runners.
 *
 * The two sources overlap only partially. On 22 Aug 2026 France ran four
 * thoroughbred meetings; PMU priced one. So the merge is not "PMU with France
 * Galop as a fallback" — France Galop defines the fixture list, and PMU adds
 * what only it has (starting price, in-running comment, per-runner time) to
 * the subset it covers.
 *
 * Conflict rule: France Galop wins. It is the governing body, and its figures
 * are the official ones.
 */

import { normName } from "./matchHorse.mjs";
import { normalizeCourseName } from "./normalize.mjs";

/**
 * Race key. Race titles are worded differently by each source ("PRIX DE LA
 * PLACE MORNY" vs "PRIX MORNY"), so they are useless as a key. Course, date
 * and distance are stable across both; race number is not always (PMU numbers
 * within its own meeting, France Galop uses the official programme number).
 */
export function raceKey(row) {
  // Race number is what actually identifies a race across the two sources —
  // verified aligned 1..8 at Clairefontaine on 21 Aug 2026, with matching
  // field sizes. Distance alone collides whenever a card runs two races over
  // the same trip, which is common. Times cannot be used: France Galop
  // publishes local Paris time and PMU publishes UTC.
  return [
    row.meetingDate,
    normalizeCourseName(row.courseName),
    row.raceNumber ?? `d${row.distanceMetres ?? ""}`,
  ].join("|");
}

/** Runner key within a race. Cloth number is the only stable cross-source id. */
export function runnerKey(row) {
  return `${row.clothNumber ?? normName(row.horseName)}`;
}

/** Prefer a real value over null/undefined/empty, with `a` winning ties. */
const pick = (a, b) => {
  if (a !== null && a !== undefined && a !== "") return a;
  if (b !== null && b !== undefined && b !== "") return b;
  return null;
};

/**
 * Group rows by race, so a source's runners can be compared as a field rather
 * than row by row.
 */
function groupByRace(rows) {
  const races = new Map();
  for (const row of rows) {
    const key = raceKey(row);
    if (!races.has(key)) races.set(key, []);
    races.get(key).push(row);
  }
  return races;
}

/**
 * Merge one France Galop runner with its PMU counterpart.
 *
 * France Galop leads on identity, ratings and money. PMU contributes only what
 * it uniquely holds — nothing of PMU's overwrites a France Galop value.
 */
export function mergeRunner(fg, pmu) {
  if (!fg) return { ...pmu, sourceSystem: "PMU", sources: ["PMU"] };
  if (!pmu) return { ...fg, sources: ["FG"] };

  return {
    ...fg,
    sources: ["FG", "PMU"],

    // Identity anchors. Only the France Galop id is a true surrogate key;
    // PMU's is the composite "NAME-DAM-SIRE", so it joins reliably but proves
    // nothing the matcher does not already know.
    fgHorseId: fg.sourceHorseId ?? null,
    pmuIdCheval: pmu.sourceHorseId ?? null,

    // France Galop is authoritative, but take PMU where FG is silent
    sireName: pick(fg.sireName, pmu.sireName),
    damName: pick(fg.damName, pmu.damName),
    damsireName: pick(fg.damsireName, pmu.damsireName),
    breederName: pick(fg.breederName, pmu.breederName),
    horseGender: pick(fg.horseGender, pmu.horseGender),
    horseColour: pick(fg.horseColour, pmu.horseColour),
    foalingYear: pick(fg.foalingYear, pmu.foalingYear),
    officialRating: pick(fg.officialRating, pmu.officialRating),
    formString: pick(fg.formString, pmu.formString),
    positionOfficial: pick(fg.positionOfficial, pmu.positionOfficial),
    draw: pick(fg.draw, pmu.draw),
    weightKg: pick(fg.weightKg, pmu.weightKg),

    // PMU only
    ispDecimal: pmu.ispDecimal ?? null,
    favourite: pmu.favourite ?? null,
    public_comments: pmu.public_comments ?? null, // DATAHIPPIQUE in-running note
    finishingTimeSeconds: pmu.finishingTimeSeconds ?? null,
    careerRuns: pmu.careerRuns ?? null,
    careerWins: pmu.careerWins ?? null,
    careerPlaces: pmu.careerPlaces ?? null,
    careerEarnings: pmu.careerEarnings ?? null,
    silkUrl: pmu.silkUrl ?? null,
    nonRunner: pmu.nonRunner ?? null,
    incident: pmu.incident ?? null,
  };
}

/** Group rows by canonical course name. */
function groupByCourse(rows) {
  const courses = new Map();
  for (const row of rows) {
    const key = normalizeCourseName(row.courseName);
    if (!courses.has(key)) courses.set(key, []);
    courses.get(key).push(row);
  }
  return courses;
}

/**
 * Reconcile the two sources' names for the same racecourse.
 *
 * The sources do not agree on what a track is called. France Galop runs
 * "LA TESTE-BASSIN ARCACHON"; PMU calls the same fixture "HIPPODROME DE LA
 * TESTE DE BUCH". Neither string reduces to the other, and a hand-maintained
 * alias table would need a new entry every time France opens a course or
 * either source rewords one — silently duplicating every runner at that
 * meeting until somebody noticed.
 *
 * So the match is made on the runners instead. A horse runs once a day, so two
 * same-date meetings that share runners are the same meeting; there is no
 * innocent way for distinct fixtures to overlap. Containment is measured
 * against the smaller field, because the sources routinely disagree on how many
 * races they carry — France Galop had races 1,2,3,4,6,8 at La Teste on
 * 26 Aug 2026 where PMU had all eight.
 *
 * Returns canonical PMU course name -> canonical France Galop course name, for
 * the pairs that are confidently the same place.
 */
export function reconcileCourseNames(fgRows, pmuRows, { minOverlap = 0.5, minHorses = 3 } = {}) {
  const fgCourses = groupByCourse(fgRows);
  const pmuCourses = groupByCourse(pmuRows);

  const namesOf = (rows) => new Set(rows.map((r) => normName(r.horseName)).filter(Boolean));

  const unmatchedFg = [...fgCourses.keys()].filter((k) => !pmuCourses.has(k));
  const unmatchedPmu = [...pmuCourses.keys()].filter((k) => !fgCourses.has(k));

  const scored = [];
  for (const pmuName of unmatchedPmu) {
    const pmuNames = namesOf(pmuCourses.get(pmuName));
    for (const fgName of unmatchedFg) {
      const fgNames = namesOf(fgCourses.get(fgName));
      const smaller = Math.min(pmuNames.size, fgNames.size);
      if (smaller < minHorses) continue;

      let shared = 0;
      for (const name of pmuNames) if (fgNames.has(name)) shared += 1;
      const containment = shared / smaller;
      if (containment >= minOverlap) scored.push({ pmuName, fgName, containment, shared });
    }
  }

  // Greedy best-first; each course is claimed once.
  scored.sort((a, b) => b.containment - a.containment || b.shared - a.shared);
  const aliases = new Map();
  const claimedFg = new Set();
  for (const pair of scored) {
    if (aliases.has(pair.pmuName) || claimedFg.has(pair.fgName)) continue;
    aliases.set(pair.pmuName, {
      courseName: pair.fgName,
      containment: Number(pair.containment.toFixed(3)),
      shared: pair.shared,
    });
    claimedFg.add(pair.fgName);
  }
  return aliases;
}

/**
 * Merge a day.
 *
 * @param {object[]} fgRows   platform-shaped rows from normalizeFG
 * @param {object[]} pmuRows  platform-shaped rows from normalize (PMU)
 * @returns {{rows, stats}}
 */
export function mergeDay(fgRows, pmuRows) {
  // Settle the course names before anything is keyed on them. Otherwise the
  // same meeting lands twice under two spellings and every horse there gets
  // two rows for one run.
  const aliases = reconcileCourseNames(fgRows, pmuRows);
  const alignedPmu = aliases.size
    ? pmuRows.map((row) => {
        const alias = aliases.get(normalizeCourseName(row.courseName));
        if (!alias) return row;
        return { ...row, courseName: alias.courseName, courseNameAsPublished: row.courseName };
      })
    : pmuRows;

  const fgRaces = groupByRace(fgRows);
  const pmuRaces = groupByRace(alignedPmu);

  const rows = [];
  const stats = {
    races: 0,
    racesBoth: 0,
    racesFgOnly: 0,
    racesPmuOnly: 0,
    runners: 0,
    runnersBoth: 0,
    runnersFgOnly: 0,
    runnersPmuOnly: 0,
    fgOnlyCourses: new Set(),
    conflicts: [],
    // Course names the two sources spell differently, resolved by runner
    // overlap. Reported rather than applied silently: a wrong pairing here
    // would fold two meetings into one, so it should be visible in the run log.
    courseAliases: [...aliases].map(([pmuName, alias]) => ({
      pmu: pmuName,
      fg: alias.courseName,
      containment: alias.containment,
      sharedRunners: alias.shared,
    })),
  };

  for (const [key, fgRunners] of fgRaces) {
    const pmuRunners = pmuRaces.get(key) ?? [];
    stats.races += 1;
    if (pmuRunners.length) stats.racesBoth += 1;
    else {
      stats.racesFgOnly += 1;
      stats.fgOnlyCourses.add(fgRunners[0]?.courseName);
    }

    const pmuByKey = new Map(pmuRunners.map((r) => [runnerKey(r), r]));

    for (const fg of fgRunners) {
      const pmu = pmuByKey.get(runnerKey(fg)) ?? null;
      if (pmu) {
        pmuByKey.delete(runnerKey(fg));
        stats.runnersBoth += 1;

        // Disagreement on a settled result is worth surfacing, not silently
        // resolving — it usually means the runner keys lined up wrongly.
        if (
          fg.positionOfficial &&
          pmu.positionOfficial &&
          fg.positionOfficial !== pmu.positionOfficial
        ) {
          stats.conflicts.push({
            race: key,
            horse: fg.horseName,
            field: "positionOfficial",
            fg: fg.positionOfficial,
            pmu: pmu.positionOfficial,
          });
        }
      } else {
        stats.runnersFgOnly += 1;
      }
      rows.push(mergeRunner(fg, pmu));
    }

    // PMU rows with no France Galop counterpart: keep them rather than drop.
    for (const leftover of pmuByKey.values()) {
      stats.runnersPmuOnly += 1;
      rows.push(mergeRunner(null, leftover));
    }
  }

  // Races PMU has that France Galop does not. Should be rare — a France Galop
  // scrape failure, or a course-name alias we have not mapped. Worth alerting.
  for (const [key, pmuRunners] of pmuRaces) {
    if (fgRaces.has(key)) continue;
    stats.races += 1;
    stats.racesPmuOnly += 1;
    for (const r of pmuRunners) {
      stats.runnersPmuOnly += 1;
      rows.push(mergeRunner(null, r));
    }
  }

  stats.runners = rows.length;
  stats.fgOnlyCourses = [...stats.fgOnlyCourses];
  return { rows, stats };
}

/**
 * Completeness check that works from our own data: a race is short whenever we
 * hold fewer runners than the field size the source reported.
 */
export function findIncompleteRaces(rows) {
  const byRace = groupByRace(rows);
  const short = [];
  for (const [key, runners] of byRace) {
    const expected = runners[0]?.numberOfRunners;
    if (Number.isFinite(expected) && runners.length < expected) {
      short.push({
        race: key,
        courseName: runners[0].courseName,
        raceTitle: runners[0].raceTitle,
        held: runners.length,
        expected,
      });
    }
  }
  return short;
}
