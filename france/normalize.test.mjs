/**
 * Unit tests for the France normaliser and matcher.
 *
 * Run: node --test scripts/france/
 *
 * No network. Every fixture below is a real payload shape taken from the
 * live PMU API or from our own APIData_Table2 rows.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { blackTypeFrom, normalizeCourseName, toFurlongs, normalizeRunner, marginToLengths, goingToEnglish, deriveRaceFields } from "./normalize.mjs";
import { matchHorse, DECISION, enrichmentFor } from "./matchHorse.mjs";

test("black type reads categorieParticularite first", () => {
  assert.deepEqual(blackTypeFrom({ categorieParticularite: "GROUPE_I", libelle: "PRIX JACQUES LE MAROIS" }), { group: 1, listed: 0 });
  assert.deepEqual(blackTypeFrom({ categorieParticularite: "GROUPE_II", libelle: "PRIX PAUL DE MOUSSAC" }), { group: 2, listed: 0 });
  assert.deepEqual(blackTypeFrom({ categorieParticularite: "GROUPE_III", libelle: "PRIX DE REUX" }), { group: 3, listed: 0 });
});

test("black type falls back to the label for Listed, which PMU does not flag", () => {
  assert.deepEqual(blackTypeFrom({ categorieParticularite: "COURSE_A_CONDITIONS", libelle: "PRIX NUREYEV (Listed)" }), { group: null, listed: 1 });
});

test("ordinary races are not black type", () => {
  for (const c of ["HANDICAP_DIVISE", "A_RECLAMER", "INCONNU", "COURSE_A_CONDITION_QUALIF_HP"]) {
    assert.deepEqual(blackTypeFrom({ categorieParticularite: c, libelle: "PRIX DE HERISSON" }), { group: null, listed: 0 });
  }
});

test("course names reconcile with how the platform stores them", () => {
  assert.equal(normalizeCourseName("HIPPODROME DE DEAUVILLE"), "DEAUVILLE");
  assert.equal(normalizeCourseName("ParisLongchamp"), "LONGCHAMP");
  assert.equal(normalizeCourseName("CAGNES/MER"), "CAGNES-SUR-MER");
});

test("distance converts metres to furlongs", () => {
  assert.ok(Math.abs(toFurlongs(1600) - 7.95) < 0.01);
  assert.ok(Math.abs(toFurlongs(2000) - 9.94) < 0.01);
  assert.equal(toFurlongs(null), null);
});

test("units: prize stays euros, career earnings convert from centimes, weight from tenths of a kilo", () => {
  const row = normalizeRunner({
    isoDate: "2026-08-16",
    meeting: { numOfficiel: 1, hippodrome: { libelleCourt: "DEAUVILLE", libelleLong: "HIPPODROME DE DEAUVILLE" } },
    course: {
      numExterne: 3,
      libelle: "PRIX JACQUES LE MAROIS",
      categorieParticularite: "GROUPE_I",
      montantPrix: 1000000,
      montantOffert1er: 571400,
      distance: 1600,
      discipline: "PLAT",
      typePiste: "HERBE",
      nombreDeclaresPartants: 10,
      penetrometre: { intitule: "Good To Soft", valeurMesure: "3,4" },
    },
    participant: {
      idCheval: 12345,
      nom: "ZEUS OLYMPIOS",
      pays: "Royaume-Uni",
      age: 4,
      sexe: "MALES",
      race: "PUR-SANG",
      handicapPoids: 595,
      ordreArrivee: 2,
      gainsParticipant: { gainsCarriere: 38139300 },
      nomPere: "KINGMAN",
      nomMere: "UNDER OFFER",
    },
  });

  assert.equal(row.prizeFund, 1_000_000, "montantPrix is already euros");
  assert.equal(row.careerEarnings, 381_393, "gainsCarriere is centimes");
  assert.equal(row.weightKg, 59.5, "handicapPoids is tenths of a kilo");
  assert.equal(row.foalingYear, 2022);
  assert.equal(row.horseCountry, "GBR");
  assert.equal(row.courseName, "DEAUVILLE");
  assert.equal(row.Group, 1);
  assert.equal(row.going, "Good To Soft", "French going is stored in the platform’s vocabulary");
  assert.equal(row.positionOfficial, 2);
});

/* ---------------- matcher ---------------- */

const royallyIncoming = {
  horseName: "ROYALLY", sireName: "KINGMAN", damName: "UNDER OFFER",
  foalingYear: 2024, horseCountry: "FR", horseGender: "c",
};

test("a real name collision is never linked", () => {
  // The 2006 Verglas horse we already hold, against today's Kingman juvenile.
  const existing = { horseName: "ROYALLY", sireName: "VERGLAS", damName: "ROYAL LADY", foalingDate: "2006-04-01", horseCountry: "GBR", horseGender: "f", horseCode: 290555 };
  const r = matchHorse(royallyIncoming, [existing]);
  assert.equal(r.decision, DECISION.CREATE);
  assert.match(r.reason, /collision/i);
});

test("sire and dam agreeing is a link", () => {
  const existing = { horseName: "ROYALLY", sireName: "KINGMAN", damName: "UNDER OFFER", foalingDate: "2024-03-11", horseCountry: "FR", horseGender: "c", horseCode: 1 };
  assert.equal(matchHorse(royallyIncoming, [existing]).decision, DECISION.LINK);
});

test("a missing dam on our side is absence, not contradiction", () => {
  const existing = { horseName: "ROYALLY", sireName: "KINGMAN", damName: null, foalingDate: "2024-03-11", horseCountry: "FR", horseGender: "c", horseCode: 1 };
  const r = matchHorse(royallyIncoming, [existing]);
  assert.equal(r.decision, DECISION.LINK, "sire + year corroborate; the null dam must not block");
  assert.equal(enrichmentFor(royallyIncoming, existing).damName, "UNDER OFFER", "and we can fill the dam in");
});

test("a colt later gelded still matches", () => {
  // HOLLYWOOD AFRICANS: "c" on his 2024 form, HONGRES on today's card.
  const incoming = { horseName: "HOLLYWOOD AFRICANS", sireName: "MARTINBOROUGH", damName: "GARDEN CITY", foalingYear: 2019, horseCountry: "FR", horseGender: "g" };
  const existing = { horseName: "HOLLYWOOD AFRICANS", sireName: "MARTINBOROUGH", damName: "GARDEN CITY", foalingDate: "2019-01-12", horseCountry: "FR", countryCode: "FRA", horseGender: "c", horseCode: 545334 };
  assert.equal(matchHorse(incoming, [existing]).decision, DECISION.LINK);
});

test("FR and FRA are the same country", () => {
  const incoming = { horseName: "X", sireName: "A", damName: "B", foalingYear: 2020, horseCountry: "FR", horseGender: "c" };
  const existing = { horseName: "X", sireName: "A", damName: "B", foalingDate: "2020-01-01", countryCode: "FRA", horseGender: "c", horseCode: 2 };
  assert.equal(matchHorse(incoming, [existing]).decision, DECISION.LINK);
});

test("name match with nothing else known goes to review, not link", () => {
  const existing = { horseName: "ROYALLY", sireName: null, damName: null, foalingDate: null, horseCountry: null, horseGender: null, horseCode: 3 };
  assert.equal(matchHorse(royallyIncoming, [existing]).decision, DECISION.REVIEW);
});

test("no candidate means create", () => {
  assert.equal(matchHorse(royallyIncoming, []).decision, DECISION.CREATE);
});

/* ---------------------------------------------- beaten margins & flags */

test("reads French margin vocabulary, short heads and fractions alike", () => {
  const lengths = (identifiant, libelleCourt) =>
    marginToLengths({ identifiant, libelleCourt });
  assert.equal(lengths("UN_NEZ", "NEZ"), 0.05);
  assert.equal(lengths("ENCOLURE", "ENCOLURE"), 0.3);
  assert.equal(lengths("TROIS_QUARTS_DE_LONGUEUR", "3/4 L"), 0.75);
  assert.equal(lengths("UNE_LONGUEUR", "1 L"), 1);
  assert.equal(lengths("UNE_LONGUEUR_ET_DEMIE", "1 L 1/2"), 1.5);
  assert.equal(lengths("SEPT_LONGUEURS", "7 L"), 7);
});

test("leaves a distanced runner unmeasured rather than inventing a margin", () => {
  assert.equal(marginToLengths({ identifiant: "LOIN", libelleCourt: "LOIN" }), null);
  assert.equal(marginToLengths(null), null);
});

test("accumulates PMU's gap-to-the-horse-in-front into lengths behind the winner", () => {
  const gap = (id, text) => ({ identifiant: id, libelleCourt: text });
  const rows = [
    { positionOfficial: 1, marginToPrevious: null },
    { positionOfficial: 2, marginToPrevious: gap("UNE_LONGUEUR", "1 L") },
    { positionOfficial: 3, marginToPrevious: gap("DEMI_LONGUEUR", "1/2 L") },
    { positionOfficial: 4, marginToPrevious: gap("UNE_TETE", "TETE") },
  ];
  deriveRaceFields(rows);
  assert.deepEqual(rows.map((r) => r.distanceBeaten), [0, 1, 1.5, 1.6]);
});

test("stops measuring once a gap is unmeasurable, rather than guessing past it", () => {
  const rows = [
    { positionOfficial: 1, marginToPrevious: null },
    { positionOfficial: 2, marginToPrevious: { identifiant: "DEUX_LONGUEURS", libelleCourt: "2 L" } },
    { positionOfficial: 3, marginToPrevious: { identifiant: "LOIN", libelleCourt: "LOIN" } },
    { positionOfficial: 4, marginToPrevious: { identifiant: "UNE_LONGUEUR", libelleCourt: "1 L" } },
  ];
  deriveRaceFields(rows);
  assert.deepEqual(rows.map((r) => r.distanceBeaten), [0, 2, null, null]);
});

test("derives the win and black-type flags the platform aggregates on", () => {
  const rows = [
    { positionOfficial: 1, Group: 1, Listed: 0 },
    { positionOfficial: 2, Group: 1, Listed: 0 },
    { positionOfficial: null, Group: 1, Listed: 0 },
  ];
  deriveRaceFields(rows);
  assert.deepEqual(rows[0], {
    positionOfficial: 1, Group: 1, Listed: 0, distanceBeaten: 0,
    Win: 1, Group1: 1, Stakes: 1, Group_Win: 1, Group1_Win: 1, Stakes_Win: 1,
  });
  assert.equal(rows[1].Win, 0);
  assert.equal(rows[1].Stakes, 1);
  assert.equal(rows[1].Group1_Win, 0);
  // A non-runner has no result, so it is not a loser either.
  assert.equal(rows[2].Win, null);
});

test("a handicap winner is a win but never black type", () => {
  const rows = [{ positionOfficial: 1, Group: 0, Listed: 0 }];
  deriveRaceFields(rows);
  assert.equal(rows[0].Win, 1);
  assert.equal(rows[0].Stakes, 0);
  assert.equal(rows[0].Stakes_Win, 0);
  assert.equal(rows[0].Group_Win, 0);
});

/* ------------------------------------------------ course names & going */

test("keeps the article French contracts into the preposition", () => {
  // The platform stores LA TESTE, LE MANS, LE TOUQUET. Dropping the article
  // filed each of those under two names at once.
  assert.equal(normalizeCourseName("HIPPODROME DE LA TESTE DE BUCH"), "LA TESTE");
  assert.equal(normalizeCourseName("HIPPODROME DU MANS"), "LE MANS");
  assert.equal(normalizeCourseName("HIPPODROME DU TOUQUET"), "LE TOUQUET");
  assert.equal(normalizeCourseName("HIPPODROME DES SABLES D OLONNE"), "LES SABLES-D'OLONNE");
  assert.equal(normalizeCourseName("HIPPODROME DU LION D'ANGERS"), "LE LION-D'ANGERS");
});

test("strips a bare preposition, which carries no article", () => {
  assert.equal(normalizeCourseName("HIPPODROME DE DEAUVILLE"), "DEAUVILLE");
  assert.equal(normalizeCourseName("HIPPODROME D'ENGHIEN"), "ENGHIEN");
});

test("does not mistake a course name beginning in LA for the article", () => {
  // "DE LA" matching inside "DE LANGON" turned Langon-Libourne into
  // "LA NGON-LIBOURNE".
  assert.equal(normalizeCourseName("HIPPODROME DE LANGON-LIBOURNE"), "LANGON-LIBOURNE");
  assert.equal(normalizeCourseName("HIPPODROME DE LAVAL"), "LAVAL");
  assert.equal(normalizeCourseName("HIPPODROME DE LISIEUX"), "LISIEUX");
});

test("states French going in the platform's own vocabulary", () => {
  assert.equal(goingToEnglish("Bon"), "Good");
  assert.equal(goingToEnglish("Bon souple"), "Good To Soft");
  assert.equal(goingToEnglish("Souple"), "Soft");
  assert.equal(goingToEnglish("Très souple"), "Soft To Heavy"); // accents and all
  assert.equal(goingToEnglish("Lourd"), "Heavy");
});

test("passes through an all-weather surface state rather than mistranslating it", () => {
  // "PSF STANDARD" describes a synthetic surface, and no British going means
  // that, so inventing one would be worse than saying what France said.
  assert.equal(goingToEnglish("PSF STANDARD"), "PSF STANDARD");
  assert.equal(goingToEnglish(null), null);
});
