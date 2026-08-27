/**
 * Resolves a French runner against the horses the platform already holds.
 *
 * Why this is not just a name lookup: a live sample of 89 French runners
 * (Deauville, 22 Aug 2026) matched 55 horses by name, and one of those was
 * wrong — ROYALLY, a 2026 two-year-old by Kingman, collided with a 2006
 * horse by Verglas already in the database. Names are reused in France, so
 * name-only matching silently welds two horses' form together.
 *
 * The scoring below therefore separates three states per attribute:
 *   AGREE      both sides have a value and they match
 *   ABSENT     one side has no value — no evidence either way
 *   CONTRADICT both sides have a value and they differ
 *
 * That distinction matters because the platform's French rows are often
 * missing `damName` (20 of 55 in the sample). Treating those as mismatches
 * would reject good matches; treating them as matches would accept bad ones.
 */

/** Strips accents, country suffixes and punctuation for comparison. */
export function normName(value) {
  if (!value) return "";
  return String(value)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s*\([A-Z]{2,4}\)\s*$/, "") // trailing (FR), (GB), (IRE)
    .replace(/[^A-Z0-9]+/g, "");
}

const AGREE = "AGREE";
const ABSENT = "ABSENT";
const CONTRADICT = "CONTRADICT";

function compare(a, b) {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return ABSENT;
  return na === nb ? AGREE : CONTRADICT;
}

function compareYear(a, b, tolerance = 1) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return ABSENT;
  return Math.abs(a - b) <= tolerance ? AGREE : CONTRADICT;
}

/**
 * The platform stores country inconsistently — `horseCountry` holds "FR"
 * while `countryCode` on the same row holds "FRA". Canonicalise before
 * comparing or every French horse looks like a contradiction.
 */
const COUNTRY_CANON = {
  FR: "FR", FRA: "FR",
  GB: "GB", GBR: "GB", UK: "GB",
  IRE: "IRE", IRL: "IRE",
  GER: "GER", DEU: "GER", GE: "GER",
  USA: "USA", US: "USA",
  ITY: "ITY", ITA: "ITY",
  SPA: "SPA", ESP: "SPA",
  JPN: "JPN", JAP: "JPN",
};

function compareCountry(a, b) {
  const ca = COUNTRY_CANON[normName(a)] ?? normName(a);
  const cb = COUNTRY_CANON[normName(b)] ?? normName(b);
  if (!ca || !cb) return ABSENT;
  return ca === cb ? AGREE : CONTRADICT;
}

/**
 * Sex is not stable: a colt gelded mid-career is recorded "c" on his old
 * form and "g" on today's racecard. Only a mare/filly against a male is a
 * genuine contradiction — and even that is worth no more than one point.
 */
function compareSex(a, b) {
  const sa = normName(a).toLowerCase();
  const sb = normName(b).toLowerCase();
  if (!sa || !sb) return ABSENT;
  if (sa === sb) return AGREE;
  const male = new Set(["c", "g", "h", "r"]); // colt, gelding, horse, rig
  if (male.has(sa) && male.has(sb)) return AGREE; // c -> g is normal ageing
  return CONTRADICT;
}

/**
 * Weights. Dam is worth more than sire: a popular sire covers 150 mares a
 * year, so "same sire" is weak evidence, whereas a dam produces one foal a
 * year and "same sire AND dam" is close to unique.
 */
const WEIGHTS = { sire: 2, dam: 3, damsire: 1, year: 3, country: 1, sex: 1 };

/** A contradiction on these is disqualifying however good the rest looks. */
const HARD_FIELDS = new Set(["sire", "dam", "year"]);

export const DECISION = {
  LINK: "LINK", // same horse — attach the French form
  REVIEW: "REVIEW", // plausible but unproven — queue for a human
  CREATE: "CREATE", // no credible candidate — create a new horse
};

/**
 * @param {object} incoming normalized PMU runner (see normalize.js)
 * @param {object[]} candidates existing platform horse rows sharing the name
 * @returns {{decision, candidate, score, maxScore, evidence, reason}}
 */
export function matchHorse(incoming, candidates) {
  if (!candidates || candidates.length === 0) {
    return {
      decision: DECISION.CREATE,
      candidate: null,
      score: 0,
      maxScore: 0,
      evidence: {},
      reason: "No existing horse with this name",
    };
  }

  const scored = candidates.map((candidate) => {
    const evidence = {
      sire: compare(incoming.sireName, candidate.sireName),
      dam: compare(incoming.damName, candidate.damName),
      damsire: compare(incoming.damsireName, candidate.damsireName ?? candidate.damSireName),
      year: compareYear(
        incoming.foalingYear,
        candidate.foalingDate ? Number(String(candidate.foalingDate).slice(0, 4)) : null,
      ),
      country: compareCountry(incoming.horseCountry, candidate.horseCountry ?? candidate.countryCode),
      sex: compareSex(incoming.horseGender, candidate.horseGender),
    };

    let score = 0;
    let maxScore = 0; // only counts attributes where evidence actually exists
    let hardContradiction = null;

    for (const [field, weight] of Object.entries(WEIGHTS)) {
      const state = evidence[field];
      if (state === ABSENT) continue;
      maxScore += weight;
      if (state === AGREE) score += weight;
      else if (HARD_FIELDS.has(field)) hardContradiction = field;
    }

    return { candidate, evidence, score, maxScore, hardContradiction };
  });

  scored.sort((a, b) => b.score - a.score || b.maxScore - a.maxScore);
  const best = scored[0];

  if (best.hardContradiction) {
    return {
      ...best,
      decision: DECISION.CREATE,
      reason: `Name collision: ${best.hardContradiction} contradicts (PMU ${
        incoming.sireName
      } x ${incoming.damName} vs DB ${best.candidate.sireName} x ${best.candidate.damName})`,
    };
  }

  // Nothing but the name agreed — exactly the ROYALLY failure mode.
  if (best.maxScore === 0) {
    return {
      ...best,
      decision: DECISION.REVIEW,
      reason: "Name matches but no pedigree, year, country or sex on either side to corroborate",
    };
  }

  const ratio = best.score / best.maxScore;
  const strong =
    best.evidence.dam === AGREE ||
    (best.evidence.sire === AGREE && best.evidence.year === AGREE);

  if (ratio === 1 && strong) {
    return { ...best, decision: DECISION.LINK, reason: "Corroborated by pedigree and/or foaling year" };
  }
  if (ratio >= 0.6) {
    return { ...best, decision: DECISION.REVIEW, reason: "Partial corroboration only" };
  }
  return { ...best, decision: DECISION.CREATE, reason: "Candidate too weak to link" };
}

/**
 * Fields the incoming French row can fill in on an existing horse without
 * overwriting anything. Used for the large "sire matches, dam missing"
 * bucket — the platform gains pedigree it did not have.
 */
export function enrichmentFor(incoming, candidate) {
  const fillable = ["damName", "damsireName", "breederName", "horseColour", "horseCountry"];
  const patch = {};
  for (const field of fillable) {
    const existing = candidate?.[field];
    if ((existing === null || existing === undefined || existing === "") && incoming[field]) {
      patch[field] = incoming[field];
    }
  }
  return patch;
}
