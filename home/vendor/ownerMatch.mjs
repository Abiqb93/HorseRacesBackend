// Copied from horses-website-deployed src/utils/ownerMatch.js, which the home page uses; keep
// the two the same, so the lists built here match what the page would build.

/**
 * Deciding whether a race row belongs to a tracked owner.
 *
 * Owner tracking stores a snapshot of horse names taken when the owner was
 * tracked, and nothing revisits it, so a horse sold on stays on the list. The
 * row itself knows better: every entry and every result carries the owner the
 * horse is running for. These helpers are how that is read and compared.
 *
 * Kept out of the page so the comparison is testable — it is the part most
 * likely to be subtly wrong, and getting it wrong in either direction is
 * visible: too strict and an owner loses their own runners, too loose and the
 * bug this fixes comes back.
 */

/**
 * The owner named on a row, whichever feed it came from. RacesAndEntries
 * writes `Owner`, the results table `ownerFullName`, France `ownerName`.
 */
export function getEntryOwner(row) {
  return (
    row?.ownerName ||
    row?.ownerFullName ||
    row?.Owner ||
    row?.owner ||
    row?.ownerLatest ||
    ""
  );
}

/** Uppercase words, punctuation gone, `&` spelled out so it can be compared. */
export function ownerWords(name) {
  return String(name || "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Whether two spellings name the same owner.
 *
 * The feeds do not agree on case, punctuation, or how much of a partnership
 * they spell out. A Doncaster racecard says "SPRING COTTAGE SYNDICATE" where
 * the results table says "Spring Cottage Syndicate & Joseph Bell"; Wathnan
 * Racing arrives as both "Wathnan Racing" and "WATHNAN RACING". So the
 * comparison is on normalised words, and the shorter name matches the longer
 * when it is a whole-word prefix of it — which is how a partnership reads when
 * one feed lists only the lead partner.
 *
 * Two words minimum for the prefix rule. One word would let "Godolphin" match
 * "Godolphin Management", which is right, and "Mr" match half the owners in
 * Britain, which is not — so a single word only matches a single word.
 */
const TITLES = new Set(["MR", "MRS", "MISS", "MS", "DR", "SIR", "LADY", "LORD", "MESSRS", "THE"]);

/** The same words with any leading honorific removed. */
const withoutTitle = (words) => {
  let i = 0;
  while (i < words.length && TITLES.has(words[i])) i++;
  return i && i < words.length ? words.slice(i) : words;
};

const prefixMatch = (x, y) => {
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length !== long.length && short.length < 2) return false;
  return short.every((word, i) => word === long[i]);
};

export function sameOwner(a, b) {
  const x = ownerWords(a);
  const y = ownerWords(b);
  if (!x.length || !y.length) return false;
  if (prefixMatch(x, y)) return true;

  // The Irish and French cards drop titles the British results keep: Needle
  // Match at Leopardstown is filed under "Saeed Suhail" against a tracker
  // holding "Mr Saeed Suhail". A leading honorific is not part of the name.
  //
  // This second pass wants full equality rather than the prefix rule, so two
  // loose comparisons never compound. It does mean "Mr K Abdullah" and
  // "Mrs K Abdullah" read as one owner — a real if uncommon cost, taken
  // knowingly, because hiding somebody's own runner is the worse failure.
  const bare = [withoutTitle(x), withoutTitle(y)];
  if (bare[0].length !== bare[1].length) return false;
  return bare[0].every((word, i) => word === bare[1][i]);
}

/**
 * Does this row still belong to the owner whose tracking listed the horse?
 *
 * A row that names no owner at all falls back to the snapshot: the French feed
 * frequently records none, and rejecting those would lose every French runner
 * an owner has.
 */
export function rowBelongsToTrackedOwner(row, trackedOwner) {
  const onRow = getEntryOwner(row);
  if (!onRow) return true;
  return sameOwner(onRow, trackedOwner);
}
