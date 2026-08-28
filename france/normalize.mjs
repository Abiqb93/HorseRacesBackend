/**
 * Maps a PMU race + runner onto the shape the platform already stores in
 * APIData_Table2, so French rows sit alongside the Timeform rows the rest
 * of the app already knows how to render.
 *
 * Unit traps, all confirmed against live PMU payloads:
 *   - `montantPrix` / `montantOffert1er` are EUROS
 *   - `gainsParticipant.*` are CENTIMES (divide by 100)
 *   - `handicapPoids` is tenths of a kilo (595 -> 59.5kg)
 *   - `tempsObtenu` is milliseconds, and is frequently null on the Flat
 *   - `distance` is metres; the platform stores furlongs
 */

const METRES_PER_FURLONG = 201.168;

/** PMU returns country display names, not codes, on the runner. */
const COUNTRY_BY_FRENCH_NAME = {
  // ISO-3 throughout, matching countryCode across the rest of the platform
  // (twenty years of French results are stored as "FRA"). France was the one
  // ISO-2 entry here, which put every ingested French run outside every
  // country filter on the site. `horseCountry` is separately ISO-2 -- see
  // matchHorse.mjs -- and is unaffected.
  France: "FRA",
  "Royaume-Uni": "GBR",
  Irlande: "IRE",
  Allemagne: "GER",
  "États-Unis": "USA",
  "Etats-Unis": "USA",
  Japon: "JPN",
  Italie: "ITY",
  Espagne: "SPA",
  Belgique: "BEL",
  "Pays-Bas": "NED",
  Suisse: "SWI",
  "République tchèque": "CZE",
  Pologne: "POL",
  Suède: "SWE",
  Danemark: "DEN",
  Norvège: "NOR",
  Canada: "CAN",
  Australie: "AUS",
  "Nouvelle-Zélande": "NZ",
  Argentine: "ARG",
  Brésil: "BRZ",
  "Afrique du Sud": "SAF",
  Turquie: "TUR",
  "Émirats arabes unis": "UAE",
};

/** Platform stores a single-letter gender, as Timeform does. */
const GENDER = { MALES: "c", FEMELLES: "f", HONGRES: "g" };

const SURFACE = {
  HERBE: "Turf",
  PSF: "All Weather",
  MACHEFER: "Dirt",
  SABLE: "All Weather",
};

export const toFurlongs = (metres) =>
  Number.isFinite(metres) ? Number((metres / METRES_PER_FURLONG).toFixed(2)) : null;

const centimesToEuros = (v) => (Number.isFinite(v) ? v / 100 : null);

/**
 * Course names differ between PMU and the platform's Timeform rows
 * ("ParisLongchamp" vs "LONGCHAMP", "CAGNES/MER" vs "CAGNES-SUR-MER").
 * Anything not listed falls through to an uppercased PMU name, which is
 * already correct for the majority of tracks.
 */
const COURSE_ALIASES = {
  PARISLONGCHAMP: "LONGCHAMP",
  "CAGNES/MER": "CAGNES-SUR-MER",
  "LYON PARILLY": "LYON-PARILLY",
  "LYON-PARILLY": "LYON-PARILLY",
  "MAISONS-LAFFITTE": "MAISONS-LAFFITTE",
  "SAINT-CLOUD": "SAINT-CLOUD",
  "SAINT CLOUD": "SAINT-CLOUD",
  "LE LION D ANGERS": "LE LION-D'ANGERS",
  "PONT DE VIVAUX": "MARSEILLE-PONT-DE-VIVAUX",
  "LA TESTE": "LA TESTE",
  "MONT DE MARSAN": "MONT-DE-MARSAN",
  "SAINT MALO": "SAINT-MALO",
  "LES SABLES D OLONNE": "LES SABLES-D'OLONNE",
};

export function normalizeCourseName(pmuName) {
  // PMU's long label is "HIPPODROME DE DEAUVILLE"; the platform stores
  // "DEAUVILLE". Strip the prefix before aliasing or nothing lines up.
  const raw = String(pmuName || "")
    .trim()
    .toUpperCase()
    .replace(/^HIPPODROME\s+(DE\s+LA\s+|DE\s+|D'|DU\s+|DES\s+)?/, "")
    .trim();
  return COURSE_ALIASES[raw] || raw;
}

/** "Bon souple" -> the going string; the numeric penetrometer is kept too. */
function goingFrom(course) {
  const p = course?.penetrometre;
  if (!p) return { going: null, goingValue: null };
  return {
    going: p.intitule || null,
    goingValue: p.valeurMesure ? Number(String(p.valeurMesure).replace(",", ".")) : null,
  };
}

/**
 * Black-type detection.
 *
 * `categorieParticularite` is authoritative for Pattern races — it returns
 * GROUPE_I / GROUPE_II / GROUPE_III — so we trust it first. It does *not*
 * flag Listed races (they come back as COURSE_A_CONDITIONS or INCONNU),
 * so Listed still has to be read off the label.
 */
const GROUP_BY_CATEGORY = { GROUPE_I: 1, GROUPE_II: 2, GROUPE_III: 3 };

export function blackTypeFrom(course) {
  // Accept either the course object or a bare label.
  const category = typeof course === "object" ? course?.categorieParticularite : null;
  const libelle = typeof course === "object" ? course?.libelle : course;

  const fromCategory = GROUP_BY_CATEGORY[String(category || "").toUpperCase()];
  if (fromCategory) return { group: fromCategory, listed: 0 };

  const s = String(libelle || "").toUpperCase();
  if (/\bGROUPE?\s*(1|I)\b|\(GROUP 1\)|\bG1\b/.test(s)) return { group: 1, listed: 0 };
  if (/\bGROUPE?\s*(2|II)\b|\(GROUP 2\)|\bG2\b/.test(s)) return { group: 2, listed: 0 };
  if (/\bGROUPE?\s*(3|III)\b|\(GROUP 3\)|\bG3\b/.test(s)) return { group: 3, listed: 0 };
  if (/\bLISTED\b/.test(s)) return { group: null, listed: 1 };
  return { group: null, listed: 0 };
}

/**
 * One platform-shaped row per runner.
 *
 * `positionOfficial` stays null until the race is run, which is exactly how
 * the app distinguishes a racecard entry from a result.
 */
export function normalizeRunner({ meeting, course, participant, isoDate }) {
  const p = participant;
  const { going, goingValue } = goingFrom(course);
  const bt = blackTypeFrom(course);
  const gains = p.gainsParticipant || {};

  const nonRunner = p.statut === "NON_PARTANT";
  const finished = Number.isFinite(p.ordreArrivee) ? p.ordreArrivee : null;

  return {
    // ---- identity -------------------------------------------------
    sourceSystem: "PMU",
    // PMU's idCheval is NOT an opaque surrogate key: it is the composite
    // string "NAME-DAM-SIRE" (e.g. "WHISKEY BENT-ANSWER ME-HELLO YOUMZAIN").
    // Deterministic and fine as a join key, but it encodes the very fields the
    // matcher compares, so it is never independent evidence of identity — and
    // it changes if PMU corrects a pedigree.
    sourceHorseId: p.idCheval ?? null,
    sourceRaceId: `${isoDate}:R${meeting.numOfficiel}:C${course.numExterne}`,

    horseName: String(p.nom || "").trim().toUpperCase(),
    // Two different things, and APIData_Table2 keeps them apart:
    // horseCountry is where the horse was bred (PMU gives it per runner),
    // countryCode is where the RACE was run. Every runner at Southwell is
    // countryCode GBR and every runner at Navan is IRE, whatever their
    // breeding -- so a French fixture is FRA for all of them. Writing the
    // breeding country here instead made a British-bred horse at Deauville
    // look like a British runner and left French cards outside every
    // "raced in France" query.
    horseCountry: COUNTRY_BY_FRENCH_NAME[p.pays] || null,
    countryCode: "FRA",
    foalingYear: Number.isFinite(p.age) ? Number(isoDate.slice(0, 4)) - p.age : null,
    horseAge: p.age ?? null,
    horseGender: GENDER[p.sexe] || null,
    horseColour: p.robe?.libelleLong || null,
    breed: p.race || null, // PUR-SANG = thoroughbred; AQPS etc. are not

    // ---- pedigree (this is what makes matching safe) --------------
    sireName: p.nomPere ? String(p.nomPere).trim().toUpperCase() : null,
    damName: p.nomMere ? String(p.nomMere).trim().toUpperCase() : null,
    damsireName: p.nomPereMere ? String(p.nomPereMere).trim().toUpperCase() : null,
    breederName: p.eleveur || null,

    // ---- connections ---------------------------------------------
    trainerFullName: p.entraineur || null,
    jockeyFullName: p.driver || null,
    ownerFullName: p.proprietaire || null,
    trainingCountry: p.paysEntrainement || null,

    // ---- race ------------------------------------------------------
    meetingDate: isoDate,
    courseName: normalizeCourseName(meeting.hippodrome?.libelleLong || meeting.hippodrome?.libelleCourt),
    raceNumber: course.numExterne ?? null,
    raceTitle: String(course.libelle || "").trim(),
    raceType: course.discipline === "OBSTACLE" ? "Jumps" : "Flat",
    raceSubType: course.specialite || null, // PLAT / HAIES / STEEPLE-CHASE / CROSS
    raceCategory: course.categorieParticularite || null, // HANDICAP_DIVISE, A_RECLAMER, GROUPE_I…
    raceSurfaceName: SURFACE[course.typePiste] || course.typePiste || null,
    distance: toFurlongs(course.distance),
    distanceMetres: course.distance ?? null,
    going,
    goingValue,
    scheduledTimeOfRaceLocal: course.heureDepart ? new Date(course.heureDepart).toISOString() : null,
    numberOfRunners: course.nombreDeclaresPartants ?? null,
    prizeFund: course.montantPrix ?? null, // euros
    prizeFundWinner: course.montantOffert1er ?? null, // euros
    Group: bt.group,
    Listed: bt.listed,

    // ---- runner in race -------------------------------------------
    clothNumber: p.numPmu ?? null, // the saddle-cloth number, and the only
                                   // stable key for matching a runner to the
                                   // same runner in the France Galop card
    draw: p.placeCorde ?? null,
    weightKg: Number.isFinite(p.handicapPoids) ? p.handicapPoids / 10 : null,
    headGear: p.oeilleres && p.oeilleres !== "SANS_OEILLERES" ? p.oeilleres : null,
    officialRating: p.handicapValeur ?? null,
    positionOfficial: finished,
    nonRunner,
    incident: p.incident || null,
    finishingTimeSeconds: Number.isFinite(p.tempsObtenu) ? p.tempsObtenu / 1000 : null,
    ispDecimal: p.dernierRapportReference?.rapport ?? p.dernierRapportDirect?.rapport ?? null,
    favourite: Boolean(p.dernierRapportReference?.favoris ?? p.dernierRapportDirect?.favoris),

    // ---- form / career --------------------------------------------
    formString: p.musique || null, // French "musique", e.g. "0p1p0p(25)4p"
    careerRuns: p.nombreCourses ?? null,
    careerWins: p.nombreVictoires ?? null,
    careerPlaces: p.nombrePlaces ?? null,
    careerEarnings: centimesToEuros(gains.gainsCarriere),
    earningsThisYear: centimesToEuros(gains.gainsAnneeEnCours),

    // Post-race analyst comment, French, from DATAHIPPIQUE. The platform
    // already has a public_comments column that renders in the form table.
    public_comments: p.commentaireApresCourse?.texte || null,
    silkUrl: p.urlCasaque || null,
  };
}

/** Flattens a whole day's fetch into platform-shaped rows. */
export function normalizeDay(fetched, isoDate) {
  const rows = [];
  for (const { meeting, course, participants } of fetched) {
    for (const participant of participants) {
      rows.push(normalizeRunner({ meeting, course, participant, isoDate }));
    }
  }
  return rows;
}
