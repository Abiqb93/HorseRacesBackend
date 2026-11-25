/**
 * A stallion's mare list made whole (25 November 2026: "we need to get these
 * tables 100% complete and data populated"). The return leaves gaps that
 * other records the backend holds can fill, and gaps nothing can fill yet;
 * this fills the first and names the reason for the second.
 *
 * From the worldwide runners file (breeding_horses, every horse that ran
 * from the 2014-2024 crops):
 *   her own record     her class where the return gives none, or "Unr" for
 *                      a mare of those crops who never ran (the file holds
 *                      every runner, so a mare it does not hold did not
 *                      run); her dam where the return leaves it out
 *   her produce        her best foal's class as of the covering (foals two
 *                      or older by then), and her runners before it where
 *                      the return holds fewer (foals bred abroad)
 *   his foal by her    the foal of the covering, by name and sex: a foal
 *                      that ran proves a live foal
 * From our results table (his runners, as the night's summaries keep them):
 *   the foal's best Timeform figure, for crops the return has no result for.
 *
 * What none of these can hold is left to a note the page writes as words:
 * the foal of a covering this year or last is not born or not returned yet,
 * and a foal younger than two has not run.
 */
import { CLASSES, classFromRunners, nameKey, splitName } from "./books.mjs";

const rankOf = (c) => (c ? CLASSES.indexOf(c) : -1);
const better = (a, b) => (rankOf(a) >= rankOf(b) ? a : b);
const foalSex = (s) => ({ F: "F", M: "F", C: "C", G: "C", H: "C", R: "C" })[String(s ?? "").toUpperCase()] ?? null;

/** The runners file's crops: a mare of these crops not in it never ran. */
export const RUNNERS_CROPS = [2014, 2024];

/**
 * Fill `out` (maresOf's answer) in place.
 *   mareRecords  Map "name|yob" -> runners-file row of the mare herself
 *   produce      Map "name" -> [runners-file rows of foals out of a mare of that name]
 *   sireFoals    Map "dam name|foal year" -> runners-file row of his foal
 *   ratings      Map "dam name|foal year" -> { name, best, sex } from our results table
 *   parents      Map "name" -> [{ sire_key, dam_key }] from the parent map (horse_parents),
 *                the dam of a mare the runners file does not hold, matched on her sire
 *   year         the year now; lastReturnYear the latest covering year with a return
 */
export function enrichMares(out, { mareRecords = new Map(), produce = new Map(), sireFoals = new Map(), ratings = new Map(), parents = new Map(), year = new Date().getUTCFullYear(), lastReturnYear = null } = {}) {
  if (!out?.mares) return out;
  // her earlier coverings in his list alone do not say she is no maiden, so
  // the list is read for whether she had any covering before (any stallion)
  for (const r of out.mares) {
    const mk = nameKey(r.mare);
    const rec = mareRecords.get(`${mk}|${r.myob ?? ""}`) ?? null;

    if (!r.mdam && rec?.dam) {
      r.mdam = splitName(rec.dam).name;
      r.mdamSrc = "runners";
    }
    if (!r.mdam) {
      // a namesake by another sire is not her
      const p = (parents.get(mk) ?? []).find((x) => x.dam_key && r.msire && nameKey(x.sire_key) === nameKey(r.msire));
      if (p) {
        r.mdam = splitName(p.dam_key).name;
        r.mdamSrc = "pedigrees";
      }
    }
    if (!r.mf) {
      const cls = rec ? classFromRunners(rec) : null;
      if (cls) {
        r.mf = cls;
        r.mfSrc = "runners";
      } else if (!rec && Number(r.myob) >= RUNNERS_CROPS[0] && Number(r.myob) <= RUNNERS_CROPS[1] - 2) {
        r.mf = "Unr";
        r.mfSrc = "never ran";
      }
    }

    // her foals two or older by the covering year, any sire, anywhere
    const foals = (produce.get(mk) ?? []).filter((f) => {
      const fy = Number(f.foaling_year);
      return fy >= Number(r.myob ?? 0) + 3 && fy <= r.y - 2;
    });
    const ran = foals.filter((f) => Number(f.runs) > 0);
    const fileBest = ran.reduce((b, f) => better(b, classFromRunners(f)), null);
    if (fileBest && rankOf(fileBest) > rankOf(r.mbp)) {
      r.mbp = fileBest;
      r.mbpSrc = "runners";
    }
    const b = r.before ?? (r.before = { foals: 0, runners: 0, best: null, r95: 0 });
    if (ran.length > b.runners) {
      b.runners = ran.length;
      b.foals = Math.max(b.foals, ran.length);
      b.src = "runners";
    }
    const bornBefore = (produce.get(mk) ?? []).some((f) => Number(f.foaling_year) <= r.y && Number(f.foaling_year) >= Number(r.myob ?? 0) + 3);
    if (!b.foals) b.note = r.covered || bornBefore ? "none of age" : "maiden";
    if (!r.mbp) r.mbpNote = b.note ?? (b.runners ? "no class" : "none of age");

    // his foal of this covering, born the year after
    const fy = r.y + 1;
    const f = sireFoals.get(`${mk}|${fy}`) ?? null;
    const g = ratings.get(`${mk}|${fy}`) ?? null;
    if (f || g) {
      r.foal = { name: splitName(f?.horse_name ?? g?.name ?? "").name || null, cls: f ? classFromRunners(f) : null };
      if (!r.ret) {
        r.ret = "foal";
        r.retSrc = "ran";
      }
      if (!r.fsex) r.fsex = foalSex(f?.sex ?? g?.sex);
    }
    if (!r.rt && g?.best) {
      r.rt = g.best;
      r.rtSrc = "results";
      r.ran = true;
      r.r95 = g.best >= 95;
      r.r105 = g.best >= 105;
      r.r115 = g.best >= 115;
    }

    // what nothing holds yet, as the page will say it
    if (!r.ret) r.retNote = fy > year ? `due ${fy}` : lastReturnYear !== null && r.y > lastReturnYear ? "no return yet" : null;
    // the return's "ran" stands only for crops it has read; a younger crop
    // may have run since, and its figure is ours to give or not
    if (!r.rt) {
      const noFoal = ["barren", "slipped", "dead", "abortion"].includes(r.ret);
      r.rtNote = noFoal
        ? "no foal"
        : fy + 2 > year
          ? `runs from ${fy + 2}`
          : r.readable
            ? r.ran
              ? "no figure"
              : "unraced"
            : f
              ? "no figure"
              : "not run yet";
    }
  }
  return out;
}

/** Rows into the maps enrichMares reads. */
export function mapsFrom({ mares = [], foals = [], sireFoals = [], ratings = [], parents = [] } = {}) {
  const mareRecords = new Map(mares.map((h) => [`${nameKey(h.horse_name)}|${h.foaling_year}`, h]));
  const produce = new Map();
  for (const f of foals) {
    const k = nameKey(f.dam_key ?? f.dam);
    (produce.get(k) ?? produce.set(k, []).get(k)).push(f);
  }
  const byDam = new Map(sireFoals.map((f) => [`${nameKey(f.dam_key ?? f.dam)}|${f.foaling_year}`, f]));
  const rated = new Map();
  for (const h of ratings) {
    if (!h?.dam || !h.foalingYear) continue;
    const k = `${nameKey(h.dam)}|${h.foalingYear}`;
    if (!rated.has(k) || (h.best ?? 0) > (rated.get(k).best ?? 0)) rated.set(k, h);
  }
  const byName = new Map();
  for (const p of parents) {
    const k = nameKey(p.horse_key);
    (byName.get(k) ?? byName.set(k, []).get(k)).push(p);
  }
  return { mareRecords, produce, sireFoals: byDam, ratings: rated, parents: byName };
}
