/**
 * Minimal client for the PMU "turfinfo" JSON API.
 *
 * The API is public and unauthenticated. It is the same feed that powers
 * pmu.fr, so it carries every French meeting that PMU prices — which in
 * practice is the whole France Galop fixture list plus the trotting
 * (Le Trot) programme we deliberately filter out.
 *
 * Endpoints (date is DDMMYYYY):
 *   /programme/{date}                                   full day
 *   /programme/{date}/R{n}/C{m}                         one race
 *   /programme/{date}/R{n}/C{m}/participants            runners + result
 *
 * Verified live against 2013-2026 dates, so it backfills as well as it
 * runs forward.
 */

const HOST = "https://offline.turfinfo.api.pmu.fr/rest/client/7";

/**
 * Disciplines we care about. TROT is harness racing and is out of scope.
 *
 * PMU names the discipline at two levels and they do not use the same words.
 * A meeting's `disciplinesMere` says OBSTACLE; the races inside it say HAIE,
 * STEEPLECHASE or CROSS. Matching a race against the meeting's vocabulary
 * dropped every French jumps race ever run -- 40 of 341 thoroughbred races
 * over a sample month, none of which reached the platform.
 *
 * `specialite` is the field that does not have this problem: it is a clean
 * four-value enum (PLAT / OBSTACLE / TROT_ATTELE / TROT_MONTE) present on
 * every race, so it is what decides inclusion, with `discipline` kept as a
 * fallback for a payload that somehow lacks it.
 */
export const THOROUGHBRED_DISCIPLINES = new Set([
  "PLAT",
  "OBSTACLE",
  "HAIE",
  "STEEPLECHASE",
  "CROSS",
]);

export const THOROUGHBRED_SPECIALITES = new Set(["PLAT", "OBSTACLE"]);

/** Is this one race thoroughbred racing rather than trotting? */
export function isThoroughbredRace(course) {
  if (course?.specialite) return THOROUGHBRED_SPECIALITES.has(course.specialite);
  return THOROUGHBRED_DISCIPLINES.has(course?.discipline);
}

/** PMU wants DDMMYYYY; we work in ISO everywhere else. */
export function toPmuDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}${m}${y}`;
}

class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
    this.url = url;
  }
}

/**
 * GET with backoff. The PMU edge occasionally 502s under load and rate
 * limits bursts, so we retry those rather than dropping a race.
 */
async function getJson(path, { retries = 4, timeoutMs = 30000 } = {}) {
  const url = `${HOST}${path}`;
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (res.status === 404) return null; // no programme published for that date
      if (!res.ok) throw new HttpError(res.status, url);
      return await res.json();
    } catch (err) {
      lastErr = err;
      // A 404 is an answer, not a failure; anything else is worth retrying.
      if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
      if (attempt === retries) break;
      await sleep(2 ** attempt * 1000);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Whole day's programme, or null when PMU published nothing. */
export async function fetchProgramme(isoDate) {
  const body = await getJson(`/programme/${toPmuDate(isoDate)}`);
  return body?.programme ?? null;
}

/**
 * French thoroughbred meetings only.
 *
 * `pays.code === "FRA"` drops the foreign cards PMU also prices (York,
 * Saratoga, Munich…), and the discipline filter drops trotting. Without
 * both filters a day's pull is roughly 3x too big and mixes breeds.
 */
export function frenchThoroughbredMeetings(programme) {
  if (!programme?.reunions) return [];
  return programme.reunions.filter(
    (r) =>
      r?.pays?.code === "FRA" &&
      (r.disciplinesMere || []).some((d) => THOROUGHBRED_DISCIPLINES.has(d)),
  );
}

/**
 * Runners for one race, including the finishing position once the race has
 * been run. Before the off `ordreArrivee` is null on every runner, which is
 * how we tell a racecard from a result.
 */
export async function fetchParticipants(isoDate, reunionNo, courseNo) {
  const body = await getJson(
    `/programme/${toPmuDate(isoDate)}/R${reunionNo}/C${courseNo}/participants`,
  );
  return body?.participants ?? [];
}

/** Race detail, used for the official finishing order and race status. */
export async function fetchCourse(isoDate, reunionNo, courseNo) {
  const body = await getJson(
    `/programme/${toPmuDate(isoDate)}/R${reunionNo}/C${courseNo}`,
  );
  return body?.course ?? body ?? null;
}

/**
 * Every French thoroughbred runner on a date, with its meeting and race
 * attached. Sequential with a small delay: the API is free and we would
 * rather stay well inside its tolerance than win a few seconds.
 */
export async function fetchFrenchRunnersForDate(isoDate, { delayMs = 150 } = {}) {
  const programme = await fetchProgramme(isoDate);
  const meetings = frenchThoroughbredMeetings(programme);
  const rows = [];

  for (const meeting of meetings) {
    for (const course of meeting.courses || []) {
      // A meeting can mix disciplines (a mixed PLAT/OBSTACLE card), so the
      // race decides inclusion, not the meeting.
      if (!isThoroughbredRace(course)) continue;

      const participants = await fetchParticipants(
        isoDate,
        meeting.numOfficiel,
        course.numExterne,
      );
      rows.push({ meeting, course, participants });
      await sleep(delayMs);
    }
  }
  return rows;
}
