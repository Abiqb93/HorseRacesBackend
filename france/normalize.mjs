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
  "LE LION D'ANGERS": "LE LION-D'ANGERS",
  "PONT DE VIVAUX": "MARSEILLE-PONT-DE-VIVAUX",
  "LA TESTE": "LA TESTE",
  "LA TESTE DE BUCH": "LA TESTE", // PMU spells out the commune, the platform does not
  "MONT DE MARSAN": "MONT-DE-MARSAN",
  "SAINT MALO": "SAINT-MALO",
  "LES SABLES D OLONNE": "LES SABLES-D'OLONNE",
  "LES SABLES D'OLONNE": "LES SABLES-D'OLONNE",
};

export function normalizeCourseName(pmuName) {
  // PMU's long label is "HIPPODROME DE DEAUVILLE"; the platform stores
  // "DEAUVILLE". Strip the prefix before aliasing or nothing lines up.
  //
  // The article has to survive that strip, though, and French contracts it
  // into the preposition: "du" is de+le and "des" is de+les, so HIPPODROME DU
  // TOUQUET is Le Touquet and HIPPODROME DES SABLES D'OLONNE is Les Sables.
  // Dropping the article outright split five courses in two -- the platform
  // stores LA TESTE, LE MANS, LE TOUQUET, LE LION-D'ANGERS and LES
  // SABLES-D'OLONNE, and PMU rows were arriving as TESTE DE BUCH, MANS,
  // TOUQUET, LION D'ANGERS and SABLES D OLONNE. La Teste's card of 26 August
  // was filed under two names at once because of it. "de" and "d'" carry no
  // article and are stripped whole.
  const ARTICLE = { "DE LA": "LA ", DU: "LE ", DES: "LES " };
  const raw = String(pmuName || "")
    .trim()
    .toUpperCase()
    // The whitespace after a word preposition is required, or "DE LA" matches
    // inside "DE LANGON" and Langon-Libourne becomes "LA NGON-LIBOURNE".
    .replace(/^HIPPODROME\s+(?:(DE\s+LA|DES|DU|DE)\s+|(D')\s*)/,
             (m, word) => (word ? ARTICLE[word.replace(/\s+/g, " ")] || "" : ""))
    .trim();
  return COURSE_ALIASES[raw] || raw;
}

/**
 * French going, in the platform's own vocabulary.
 *
 * The going column is read straight onto the race header next to British
 * cards, and "Bon souple" beside "Good To Soft" reads as a different scale
 * rather than the same one described in another language. These are the
 * standard equivalences racing media use either way across the Channel. The
 * penetrometer reading is kept alongside untranslated, which is the precise
 * number and the thing France actually measures.
 */
const GOING_EN = {
  // Left column: what France Galop and PMU say. Right: the platform's own
  // vocabulary, which is Timeform's -- Good, Gd/Frm, Gd/Sft, Soft, Heavy,
  // Firm, Fast on turf and Std, Slow, Fast on the all-weather. Checked
  // against what the table actually holds; inventing "Good To Soft" put a
  // value in the going column that no other row on the platform uses and no
  // filter matches.
  "TRES LEGER": "Firm",
  LEGER: "Gd/Frm",
  "BON LEGER": "Gd/Frm",
  BON: "Good",
  "BON SOUPLE": "Gd/Sft",
  SOUPLE: "Soft",
  // French racing grades below Souple more finely than Timeform does, and
  // Timeform has nothing between Soft and Heavy. Tres souple takes the softer
  // of the two it sits between rather than being promoted to Heavy, which is
  // reserved for the going that genuinely is.
  "TRES SOUPLE": "Soft",
  COLLANT: "Heavy",
  LOURD: "Heavy",
  "TRES LOURD": "Heavy",

  // The all-weather tracks report a surface state, and this one does map:
  // Timeform grades synthetic surfaces Std / Slow / Fast, which is the same
  // three-step scale PSF uses.
  "PSF STANDARD": "Std",
  "PSF LENTE": "Slow",
  "PSF RAPIDE": "Fast",
};

export function goingToEnglish(intitule) {
  if (!intitule) return null;
  const key = String(intitule)
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // "Tres souple" -> "TRES SOUPLE"
  // Anything unrecognised is passed through as France said it rather than
  // guessed at -- a foreign going is better than a wrong one.
  return GOING_EN[key] || String(intitule).trim();
}

/** "Bon souple" -> "Gd/Sft"; the numeric penetrometer is kept alongside. */
function goingFrom(course) {
  const p = course?.penetrometre;
  if (!p) return { going: null, goingValue: null };
  return {
    going: goingToEnglish(p.intitule),
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
/**
 * PMU states a beaten margin as the gap to the horse IN FRONT, in French
 * racing's own vocabulary ("3/4 L", "1 L 1/2", "ENCOLURE"). The platform
 * stores distanceBeaten as lengths behind the WINNER, so the gaps have to be
 * parsed and then accumulated down the finishing order.
 */
const SHORT_MARGINS = {
  "UN_NEZ": 0.05,
  "COURTE_TETE": 0.08,
  "UNE_TETE": 0.1,
  "COURTE_ENCOLURE": 0.2,
  "ENCOLURE": 0.3,
  "DEAD_HEAT": 0,
};

export function marginToLengths(gap) {
  if (!gap) return null;
  if (gap.identifiant && gap.identifiant in SHORT_MARGINS) return SHORT_MARGINS[gap.identifiant];
  // "LOIN" is French for the British "DIST" -- beaten so far the judge stopped
  // measuring. There is no true value to record, so it is left unmeasured
  // rather than invented, and the runners behind it inherit the same gap.
  if (gap.identifiant === "LOIN") return null;
  const text = String(gap.libelleCourt || "").trim().toUpperCase();
  const m = text.match(/^(?:(\d+)\s*L)?\s*(?:(\d+)\/(\d+))?\s*L?$/);
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  const whole = Number(m[1] || 0);
  const frac = m[2] ? Number(m[2]) / Number(m[3]) : 0;
  return whole + frac;
}

/**
 * Fills in the per-race fields that only exist once the whole field is known:
 * the margin behind the winner, and the win / black-type flags the rest of the
 * platform aggregates on. Timeform supplies these on its own rows; derived
 * here, French rows answer the same queries instead of dropping out of them.
 */
export function deriveRaceFields(rows) {
  const finishers = rows
    .filter((r) => Number.isFinite(r.positionOfficial))
    .sort((a, b) => a.positionOfficial - b.positionOfficial);

  let cumulative = 0;
  let measured = true;
  for (const row of finishers) {
    if (row.positionOfficial === 1) {
      row.distanceBeaten = 0;
      continue;
    }
    const gap = marginToLengths(row.marginToPrevious);
    if (gap === null) measured = false; // an unmeasured gap makes every
    if (!measured) { row.distanceBeaten = null; continue; } // later one unknowable
    cumulative += gap;
    row.distanceBeaten = Number(cumulative.toFixed(2));
  }

  for (const row of rows) {
    const won = row.positionOfficial === 1 ? 1 : 0;
    const black = row.Group ? "group" : row.Listed ? "listed" : null;
    row.Win = row.positionOfficial === null ? null : won;
    row.Group1 = row.Group === 1 ? 1 : 0;
    row.Stakes = black ? 1 : 0;
    row.Group_Win = black === "group" ? won : 0;
    row.Group1_Win = row.Group === 1 ? won : 0;
    row.Stakes_Win = black ? won : 0;
    delete row.marginToPrevious;
  }
  return rows;
}

/** Every word PMU uses for jumps racing, at either level of the payload. */
const JUMPS = new Set(["OBSTACLE", "HAIE", "HAIES", "STEEPLECHASE", "STEEPLE-CHASE", "CROSS"]);

/**
 * raceType in the platform's vocabulary, which is Flat / Hurdle / Chase /
 * Bumper across every Timeform row on the site. Writing a French "Jumps" into
 * it put French jumping outside every race-type filter on the platform while
 * appearing to be populated.
 *
 * Cross-country races are filed as chases, which is how Timeform treats them:
 * they are run over fixed obstacles, and there is no separate code for them.
 */
const RACE_TYPE = {
  HAIE: "Hurdle",
  HAIES: "Hurdle",
  STEEPLECHASE: "Chase",
  "STEEPLE-CHASE": "Chase",
  CROSS: "Chase",
};

export function raceTypeOf(course) {
  const specific = RACE_TYPE[course?.discipline] || RACE_TYPE[course?.specialite];
  if (specific) return specific;
  // A card that only says OBSTACLE has told us it is jumping but not which
  // kind. Hurdle is the commoner of the two and is the safer default, but the
  // exact word is kept on raceSubType either way.
  if (JUMPS.has(course?.specialite) || JUMPS.has(course?.discipline)) return "Hurdle";
  return "Flat";
}

/**
 * How many runs the form string accounts for.
 *
 * A "musique" is one entry per run, newest first -- a finishing position (a
 * digit, or a letter for a non-completion: T tombé, A arrêté, D disqualifié,
 * R retiré) followed by the discipline it was run in (p plat, h haies, s
 * steeple, c cross, a attelé, m monté). "(25)" separates the seasons and is
 * not a run. It is a floor on the career, not the career itself: PMU
 * truncates it to the recent past.
 */
export function formRunCount(musique) {
  if (!musique) return 0;
  return (String(musique).match(/(?:\d+|[ADRT])[apmshc]/gi) || []).length;
}

/**
 * The career record, or nothing.
 *
 * PMU sometimes returns a zeroed record -- no runs, no wins, no earnings --
 * for a horse whose own form string shows a season of racing. It is rare on
 * the Flat (1 runner in 651 sampled) and not rare over jumps (5 in 87). The
 * zero is an absent record, not a fact about the horse, and writing it down
 * as one is worse than leaving the field empty: career runs and prize money
 * are two of the factors prospects are scored on, so a false zero marks a
 * proven horse as unraced and scores it accordingly.
 *
 * A horse with no form string and no record is genuinely unraced, and keeps
 * its zeroes.
 */
export function careerRecordOf(p) {
  const gains = p.gainsParticipant || {};
  const record = {
    careerRuns: p.nombreCourses ?? null,
    careerWins: p.nombreVictoires ?? null,
    careerPlaces: p.nombrePlaces ?? null,
    careerEarnings: centimesToEuros(gains.gainsCarriere),
    earningsThisYear: centimesToEuros(gains.gainsAnneeEnCours),
  };
  const claimsUnraced = !Number(record.careerRuns) && !Number(record.careerEarnings);
  if (claimsUnraced && formRunCount(p.musique) > 0) {
    for (const key of Object.keys(record)) record[key] = null;
  }
  return record;
}

export function normalizeRunner({ meeting, course, participant, isoDate }) {
  const p = participant;
  const { going, goingValue } = goingFrom(course);
  const bt = blackTypeFrom(course);

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
    // Read off specialite, not discipline: a jumps race calls its discipline
    // HAIE or STEEPLECHASE, never OBSTACLE, so testing discipline filed every
    // French hurdle and chase as Flat.
    raceType: raceTypeOf(course),
    raceSubType: course.discipline || null, // PLAT / HAIE / STEEPLECHASE / CROSS
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
    marginToPrevious: p.distanceChevalPrecedent || null, // consumed by deriveRaceFields
    ispDecimal: p.dernierRapportReference?.rapport ?? p.dernierRapportDirect?.rapport ?? null,
    favourite: Boolean(p.dernierRapportReference?.favoris ?? p.dernierRapportDirect?.favoris),

    // ---- form / career --------------------------------------------
    formString: p.musique || null, // French "musique", e.g. "0p1p0p(25)4p"
    ...careerRecordOf(p),

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
    // Per race, because distanceBeaten and the black-type flags are properties
    // of the finishing order, not of a runner on its own.
    const race = participants.map((participant) =>
      normalizeRunner({ meeting, course, participant, isoDate }));
    rows.push(...deriveRaceFields(race));
  }
  return rows;
}
