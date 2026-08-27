/**
 * Scraper for france-galop.com.
 *
 * France Galop is the *spine* of this integration: it defines the true French
 * fixture list. PMU only prices a subset — on 22 Aug 2026 France ran four
 * thoroughbred meetings and PMU carried one of them, the other three being PMH
 * (on-course betting only). Anything built on PMU alone silently loses most of
 * the French programme.
 *
 * Access model, verified live:
 *   - /fr/racing/yesterday, /fr/racing/today, /fr/courses/demain are anonymous
 *   - arbitrary dates are NOT addressable (`?date=` ignored, /fr/racing/{date} 404s)
 *   - historical meeting pages return a Microsoft CIAM login whose entire body
 *     is "Sign in to your account"
 *
 * So this client only ever reads the public three-day window. History comes
 * from PMU. See docs/france-integration-spec.md §3.5 for why we deliberately
 * do not automate the logged-in session.
 */

import * as cheerio from "cheerio";
import { sleep } from "./pmuClient.mjs";

const BASE = "https://www.france-galop.com";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** France Galop is a small organisation's website. Be a good citizen. */
const MIN_INTERVAL_MS = 1000;
let lastFetch = 0;

export class AuthWallError extends Error {
  constructor(url) {
    super(`France Galop served a login wall for ${url} — outside the public window`);
    this.url = url;
  }
}

async function getHtml(path, { retries = 3, timeoutMs = 35000 } = {}) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastFetch);
    if (wait > 0) await sleep(wait);
    lastFetch = Date.now();

    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();

      // The login wall returns 200 with a body that is only this string, and a
      // client-side redirect to ciamlogin.com. Detect it explicitly rather than
      // letting an empty parse look like an empty meeting.
      if (/ciamlogin\.com|Sign in to your account/.test(html) && !/race__list|raceTable|table course/.test(html)) {
        throw new AuthWallError(url);
      }
      return html;
    } catch (err) {
      if (err instanceof AuthWallError) throw err;
      if (attempt === retries) throw err;
      await sleep(2 ** attempt * 1000);
    }
  }
  return null;
}

const txt = (el) => (el ? el.text().replace(/\s+/g, " ").trim() : "");

/**
 * France Galop is not consistent about separators, and the inconsistency is
 * per-field rather than per-page:
 *
 *   "3.400" metres, "16.000" prize   -> dot is a THOUSANDS separator
 *   "59,5 kg" weight, "(4,2)" going  -> comma is the DECIMAL separator
 *   "43.5" Valeur rating             -> dot is a DECIMAL separator
 *
 * So a dot is disambiguated by what follows it: exactly three digits (and no
 * more digits after) means thousands; one or two means a decimal. Getting this
 * wrong either divides prize money by a thousand or truncates every rating.
 */
export function parseFrInt(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[^\d.]/g, "").replace(/\.(?=\d{3}\b)/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** "54,5" -> 54.5, "4,2" -> 4.2, "43.5" -> 43.5, "1.400" -> 1400. */
export function parseFrDecimal(value) {
  if (value === null || value === undefined) return null;
  const m = String(value).match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const raw = m[0];
  // A dot with exactly three digits after it is a thousands separator.
  const n = Number(/\.\d{3}$/.test(raw) ? raw.replace(".", "") : raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** "13h23" -> "13:23" */
function parseHeure(value) {
  const m = String(value || "").match(/(\d{1,2})h(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/* ------------------------------------------------------------------ */
/* Day listing                                                        */
/* ------------------------------------------------------------------ */

/** Only these three are public. Anything else needs a session. */
export const DAY_PATHS = {
  yesterday: "/fr/racing/yesterday",
  today: "/fr/racing/today",
  tomorrow: "/fr/courses/demain",
};

/**
 * Fixtures for one of the three public days.
 *
 * Returns foreign meetings too (France Galop lists York, Saratoga…), flagged
 * so the caller can drop them — they carry no runner detail.
 */
export async function fetchFixtures(day) {
  const path = DAY_PATHS[day];
  if (!path) throw new Error(`day must be one of ${Object.keys(DAY_PATHS).join(", ")}`);

  const html = await getHtml(path);
  if (!html) return [];
  const $ = cheerio.load(html);

  const fixtures = [];
  $("#race__list .card.event").each((_, el) => {
    const card = $(el);
    const link = card.find('a[href*="/fr/courses/reunion/"]').first().attr("href") || "";
    const m = link.match(/\/fr\/courses\/reunion\/(\d{8})\/([^/?#]+)/);
    if (!m) return;

    const prog = txt(card.find("p.prog"));
    const flat = prog.match(/Plat\s*:\s*(\d+)/);
    const jumps = prog.match(/Obstacle\s*:\s*(\d+)/);
    const terrain = txt(card.find("p.start span.terrain"));
    const going = terrain.match(/Terrain\s+([^(]+?)\s*\(/);

    fixtures.push({
      source: "FG",
      meetingDate: `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`,
      dateCompact: m[1],
      courseCode: m[2], // stable PER RACECOURSE, not per meeting
      courseName: txt(card.find("h2")),
      startTime: parseHeure(txt(card.find("p.start"))),
      goingLabel: going ? going[1].trim() : null,
      goingValue: terrain ? parseFrDecimal(terrain.match(/\(([\d,]+)\)/)?.[1]) : null,
      isPremium: card.hasClass("premium") || card.find("p.start span.prem").length > 0,
      flatRaces: flat ? Number(flat[1]) : 0,
      jumpRaces: jumps ? Number(jumps[1]) : 0,
      url: `${BASE}${link}`,
    });
  });
  return fixtures;
}

/* ------------------------------------------------------------------ */
/* Meeting page                                                       */
/* ------------------------------------------------------------------ */

/**
 * Races on one meeting card.
 *
 * `dateCompact` + `courseCode` builds the URL. The code is stable per
 * racecourse (Deauville is the same string on consecutive days), so once the
 * registry is built these are constructible — but historical dates still hit
 * the login wall.
 */
export async function fetchMeeting(dateCompact, courseCode) {
  const html = await getHtml(`/fr/courses/reunion/${dateCompact}/${courseCode}`);
  if (!html) return null;
  const $ = cheerio.load(html);

  const heading = txt($("h1.page-header"));
  const terrain = txt($(".fiche.courses_reunion p").first());
  const programmePdf = $('a[href*="/pgm/"]').first().attr("href") || null;

  const races = [];
  $("div.table.course table tbody tr").each((_, el) => {
    const td = $(el).find("td");
    if (td.length < 5) return;

    const detailHref = $(el).find('a[href*="/fr/course/detail/"]').first().attr("href") || "";
    const dm = detailHref.match(/\/fr\/course\/detail\/(\d{4})\/([A-Z])\/([^/?#]+)/);

    // "08 Parts - Classe 4". Which column holds it moves between a future
    // card and a settled one (the arrival column takes over), so scan the row.
    let cat = "";
    td.each((__, c) => {
      const t = txt($(c));
      if (!cat && /\d+\s*Parts?/i.test(t)) cat = t;
    });
    const parts = cat.match(/(\d+)\s*Parts?/i);
    const speciality = txt(td.eq(3)); // "P (3 ans)" | "S (4 ans)"

    races.push({
      source: "FG",
      startTime: parseHeure(txt(td.eq(0))),
      raceNumber: Number(txt(td.eq(1))) || null,
      raceTitle: txt($(el).find("td.numProgramme a")) || txt(td.eq(2)),
      speciality,
      disciplineLetter: dm ? dm[2] : speciality.slice(0, 1).toUpperCase(),
      distanceMetres: parseFrInt(txt(td.eq(4))),
      category: cat || null,
      declaredRunners: parts ? Number(parts[1]) : null,
      winner: txt(td.eq(7)) || null,
      prize: parseFrInt(txt(td.eq(8))),
      raceCode: dm ? dm[3] : null,
      raceYear: dm ? dm[1] : null,
      url: detailHref ? `${BASE}${detailHref}` : null,
    });
  });

  return {
    courseName: heading.replace(/^.*?-\s*/, "").trim(),
    goingLabel: terrain.match(/Terrain\s+([^(]+?)\s*\(/)?.[1]?.trim() ?? null,
    goingValue: parseFrDecimal(terrain.match(/\(([\d,]+)\)/)?.[1]),
    programmePdf,
    races,
  };
}

/* ------------------------------------------------------------------ */
/* Race page                                                          */
/* ------------------------------------------------------------------ */

/**
 * Thoroughbred country suffixes. Needed as a whitelist because the result page
 * drops the parentheses, so a bare trailing token is only a country if we
 * recognise it — otherwise a horse genuinely named "... IRE" loses a word.
 */
const COUNTRY_SUFFIXES = new Set([
  "GB", "IRE", "FR", "USA", "GER", "ITY", "SPA", "JPN", "AUS", "NZ", "CAN",
  "ARG", "BRZ", "CHI", "PER", "URU", "SAF", "UAE", "TUR", "IND", "KOR", "HK",
  "SIN", "SWE", "DEN", "NOR", "POL", "CZE", "HUN", "GRE", "BEL", "NED", "SWI",
  "SAU", "QA", "MEX", "PAN", "VEN", "ZIM", "MOR", "TUN",
]);

/**
 * "EL PROFESSOR CHOP H.PS. 6 a."   -> no suffix
 * "CANTAVIR (GB) M.PS. 2 a."       -> racecard format, parenthesised
 * "HEMATITE IRE F.PS. 4 a."        -> result format, bare
 *
 * The two page types genuinely differ, so both are handled.
 */
export function parseHorseCell(raw) {
  // The markup is lowercase — "daring prince (gb) m.ps. 5 a." — and only looks
  // uppercase because of CSS text-transform. Casing also varies between page
  // types, so normalise before matching anything.
  const s = String(raw || "").replace(/\s+/g, " ").trim().toUpperCase();
  const m = s.match(/^(.*?)\s*([MFH])\.([A-Z]{1,4})\.\s*(\d+)\s*a\.?$/i);
  if (!m) {
    return { horseName: s.toUpperCase(), horseNameRaw: s.toUpperCase(), country: null, sex: null, breed: null, age: null };
  }

  let name = m[1].trim();
  let country = null;

  const paren = name.match(/^(.*?)\s*\(([A-Z]{2,4})\)$/);
  if (paren) {
    name = paren[1].trim();
    country = paren[2];
  } else {
    const bare = name.match(/^(.*?)\s+([A-Z]{2,4})$/);
    if (bare && COUNTRY_SUFFIXES.has(bare[2])) {
      name = bare[1].trim();
      country = bare[2];
    }
  }

  return {
    horseName: name.toUpperCase(),
    // Kept because the bare-suffix strip is a whitelist guess: a horse really
    // called "DUKE OF IRE" would come back as "DUKE OF" + IRE. Nothing is
    // discarded, so the matcher can fall back to the unstripped form.
    horseNameRaw: m[1].trim().toUpperCase(),
    country, // FG gives the suffix; PMU does not
    sex: { M: "c", F: "f", H: "g" }[m[2].toUpperCase()] || null,
    breed: m[3].toUpperCase(),
    age: Number(m[4]),
  };
}

/** "Par: VALE OF YORK et MA VICTORYAN (KHELEYF)" -> sire, dam, damsire */
export function parsePedigreeCell(raw) {
  const s = String(raw || "").replace(/\s+/g, " ").trim();
  const m = s.match(/Par\s*:\s*(.+?)\s+et\s+(.+?)(?:\s*\(([^)]+)\))?\s*$/i);
  if (!m) return { sireName: null, damName: null, damsireName: null };
  return {
    sireName: m[1].trim().toUpperCase() || null,
    damName: m[2].trim().toUpperCase() || null,
    damsireName: m[3] ? m[3].trim().toUpperCase() : null,
  };
}

/**
 * Entry/forfeit counts from the race header.
 * "19 Engagés. 8 Forfaits. 1 Non-Déclaré-Partant. 10 Partants Définitifs."
 */
export function parseFieldCounts(header) {
  const s = String(header || "");
  const grab = (re) => {
    const m = s.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    entered: grab(/(\d+)\s*Engag/i),
    forfeits: grab(/(\d+)\s*Forfait/i),
    supplemented: grab(/(\d+)\s*Suppl[ée]mentaire/i),
    notDeclared: grab(/(\d+)\s*Non-D[ée]clar/i),
    declared: grab(/(\d+)\s*Partants?\s*D[ée]finitifs?/i),
    nonRunners: grab(/(\d+)\s*Non-?Partants?\b/i),
  };
}

/**
 * One race: header attributes, field counts, and every runner.
 *
 * The runner table has DIFFERENT COLUMNS before and after the race, so columns
 * are resolved by their <thead> label rather than by index. This is the single
 * most likely source of silent breakage if anyone rewrites it.
 */
export async function fetchRace(raceUrl) {
  const html = await getHtml(raceUrl);
  if (!html) return null;
  const $ = cheerio.load(html);

  const fiche = $(".fiche").first();
  const header = fiche.length ? txt(fiche) : txt($("div.region-content"));

  // "… 17h45, CLAIREFONTAINE PLAT , 1.400 mètres" — the discipline word trails
  // the course name, so stop the capture at it or the name will not match the
  // same course as it is spelled by PMU or by the platform.
  const dt = header.match(
    /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2})h(\d{2}),\s*([A-ZÀ-ÿ'\- ]+?)\s*(?:PLAT|OBSTACLE|STEEPLE[- ]?CHASE|HAIES|CROSS)?\s*,/i,
  );
  // "8ème(P/ 5118)" — but the opener is "1ère", so both ordinals must match or
  // race 1 silently loses its number and cannot be keyed against PMU.
  const meta = header.match(/(\d+)\s*(?:[èe]me|[èe]re|er)\s*\(\s*([PO])\s*\/\s*(\d+)\s*\)/i);
  const dist = header.match(/([\d.]+)\s*m[èe]tres/i);
  const terrain = header.match(/Terrain\s+([A-Za-zÀ-ÿ ]+?)\s*\(\s*([\d,]+)/i);
  const corde = header.match(/Corde\s+à\s+([A-ZÀ-ÿ]+)/i);
  const allocation = header.match(/([\d.]+)\s*\(/);
  const temps = header.match(/Temps du 1er\s*:\s*([\d.:]+)/i);

  const isResult = /ARRIVEE\s+OFFICIELLE/i.test(header);

  // Column map from the header row.
  const cols = {};
  $("div.table.raceTable table thead th").each((i, th) => {
    cols[txt($(th)).toLowerCase()] = i;
  });
  const col = (...labels) => {
    for (const l of labels) {
      const key = Object.keys(cols).find((c) => c.includes(l));
      if (key !== undefined) return cols[key];
    }
    return -1;
  };

  const iPlace = col("place");
  const iHorse = col("cheval");
  const iNum = col("n°", "no");
  const iPed = col("père/mère", "pere/mere");
  const iGap = col("écart", "ecart", "corde");
  const iOwner = col("propriétaire", "proprietaire");
  const iTrainer = col("entraineur", "entraîneur");
  const iDept = col("dép.", "dep.");
  const iJockey = col("jockey");
  const iWeight = col("poids");
  const iGain = col("gain");
  const iPrimeProp = col("prim. prop");
  const iPrimeElev = col("prim. elev");
  const iRating = col("valeur");
  const iForm = col("performances");
  const iEquip = col("equipement", "équipement");
  const iBreeder = col("éleveur", "eleveur");

  const runners = [];
  $("div.table.raceTable table tbody tr").each((_, el) => {
    const td = $(el).find("td");
    if (!td.length) return;

    const cell = (i) => (i >= 0 && i < td.length ? txt(td.eq(i)) : null);
    const horseCell = iHorse >= 0 ? txt(td.eq(iHorse)) : "";
    if (!horseCell) return;

    const fgHorseId =
      (iHorse >= 0 ? td.eq(iHorse).find('a[href*="/fr/cheval/"]').attr("href") : "")?.match(
        /\/fr\/cheval\/([^/?#]+)/,
      )?.[1] ?? null;

    // One cell carries both: "(Corde:10)" for the winner, "1.L (Corde:04)"
    // for the rest. Take the draw out, and whatever remains is the margin.
    const gap = cell(iGap) || "";
    const drawMatch = gap.match(/Corde\s*:\s*(\d+)/i);
    const margin = gap.replace(/\(\s*Corde\s*:\s*\d+\s*\)/i, "").trim();

    // "56 kg (58,5 kg)" — the bracketed figure is the weight before a claim.
    const weightRaw = cell(iWeight) || "";
    const weights = [...weightRaw.matchAll(/([\d,]+)\s*kg/gi)].map((x) => parseFrDecimal(x[1]));

    const equipment = [];
    if (iEquip >= 0) {
      td.eq(iEquip)
        .find("span[data-title]")
        .each((__, s) => equipment.push($(s).attr("data-title")));
    }

    runners.push({
      source: "FG",
      ...parseHorseCell(horseCell),
      fgHorseId,
      clothNumber: Number(cell(iNum)) || null,
      ...parsePedigreeCell(cell(iPed)),
      positionOfficial: iPlace >= 0 ? Number(cell(iPlace)) || null : null,
      draw: drawMatch ? Number(drawMatch[1]) : null,
      beatenMargin: margin || null,
      ownerFullName: cell(iOwner),
      trainerFullName: cell(iTrainer),
      trainingArea: cell(iDept) || null,
      jockeyFullName: cell(iJockey),
      weightKg: weights[0] ?? null,
      weightBeforeClaim: weights[1] ?? null,
      prizeMoneyWon: parseFrInt(cell(iGain)),
      primeProprietaire: parseFrInt(cell(iPrimeProp)),
      primeEleveur: parseFrInt(cell(iPrimeElev)), // France-specific breeder premium
      officialRating: iRating >= 0 ? parseFrDecimal(cell(iRating)) : null,
      formString: cell(iForm) || null,
      headGear: equipment.length ? equipment.join(", ") : null,
      breederName: cell(iBreeder),
    });
  });

  return {
    source: "FG",
    url: raceUrl,
    raceCode: raceUrl.match(/\/fr\/course\/detail\/\d{4}\/[A-Z]\/([^/?#]+)/)?.[1] ?? null,
    meetingDate: dt ? `${dt[3]}-${dt[2]}-${dt[1]}` : null,
    startTime: dt ? `${dt[4].padStart(2, "0")}:${dt[5]}` : null,
    courseName: dt
      ? dt[6].replace(/\s+(PLAT|OBSTACLE|STEEPLE[- ]?CHASE|HAIES|CROSS)\s*$/i, "").trim()
      : null,
    raceNumber: meta ? Number(meta[1]) : null,
    disciplineLetter: meta ? meta[2] : null,
    officialRaceNumber: meta ? Number(meta[3]) : null,
    raceType: /OBSTACLE|STEEPLE|HAIES|CROSS/i.test(header) || meta?.[2] === "O" ? "Jumps" : "Flat",
    distanceMetres: dist ? parseFrInt(dist[1]) : null,
    goingLabel: terrain ? terrain[1].trim() : null,
    goingValue: terrain ? parseFrDecimal(terrain[2]) : null,
    railSide: corde ? corde[1] : null,
    prizeFund: allocation ? parseFrInt(allocation[1]) : null,
    winnerTime: temps ? temps[1] : null,
    // The conditions paragraph always opens "Pour <horses> …" after the race
    // category line; anchor on that rather than on the category keywords,
    // which also appear inside the page furniture.
    raceConditions: header.match(/\bPour\s+(?:chevaux|poulains|pouliches|juments|male|m[âa]les)[^.]*\.(?:[^.]*\.)?/i)?.[0]?.trim() ?? null,
    // "Classe 3" (the class) and "HANDICAP CATEG DIVISE" (the category) both
    // appear in the header and mean different things — capture each.
    raceClass: header.match(/\bClasse\s+(\d+)\b/i)?.[1] ?? null,
    raceCategory:
      header.match(/\b(?:HANDICAP(?:\s+(?:CATEG|CATEGORIE|DE\s+CATEGORIE))?(?:\s+DIVISE)?|COURSE\s+A\s+CONDITIONS?|A\s+R[EÉ]CLAMER|IN[EÉ]DITS|GROUPE\s+[I]+|LISTED)\b/i)?.[0]
        ?.replace(/\s+/g, " ")
        .trim() ?? null,
    isPremium: /Course Premium/i.test(header),
    isResult,
    fieldCounts: parseFieldCounts(header),
    runners,
  };
}

/**
 * A foreign fixture has no runner detail —
 * "ETRANGER: partants et arrivées sont diffusés par le pays organisateur".
 */
export function isForeignMeeting(html) {
  return /ETRANGER\s*:/i.test(html);
}

/**
 * Everything France Galop has for one public day: fixtures, their races and
 * every runner. Foreign meetings are dropped.
 */
export async function fetchFrenchDay(day, { onProgress } = {}) {
  const fixtures = await fetchFixtures(day);
  const out = [];

  for (const fixture of fixtures) {
    const meeting = await fetchMeeting(fixture.dateCompact, fixture.courseCode);
    if (!meeting || meeting.races.length === 0) continue;

    // Foreign cards list races but serve no runners; detected by every race
    // lacking a detail link, or by the ETRANGER notice on the race page.
    const races = [];
    for (const race of meeting.races) {
      if (!race.url) continue;
      const detail = await fetchRace(race.url);
      if (!detail || detail.runners.length === 0) continue;
      races.push({ ...race, ...detail });
      onProgress?.({ fixture, race });
    }
    if (races.length === 0) continue;

    out.push({ fixture: { ...fixture, ...meeting, races: undefined }, races });
  }
  return out;
}
