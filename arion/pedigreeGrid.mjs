/**
 * A pedigree from Arion: its "5x5 pedigree grid" report, read into the
 * shape the pedigree cache holds.
 *
 * The cache was filled from Equineline, through a scraper whose key the
 * source now rejects; until it is replaced nothing new can be fetched that
 * way. Arion holds the same five generations — the 5x5 grid is one HTML
 * table with all 62 ancestors — and the desk's subscription is not metered,
 * so a mare's chart can come from there instead, in about ten seconds.
 *
 * What the grid has that Equineline's record has not: nothing. What it
 * lacks: Equineline's reference numbers (so an Arion chart is keyed by a
 * reference of our own, made from her name and year), country and year on
 * the fourth and fifth generations (names only there), and Equineline's
 * dosage, nicking and auction fields. Inbreeding is worked out on the site
 * from the names, so that is unaffected.
 *
 * The page lays the grid out with rowspans — 16 for the parents, 8 for the
 * grandparents, 4, 2, and 1 for the fifth generation — and in document
 * order the ancestors of each generation come top to bottom, which is the
 * order the cache numbers them. Between the names sit small cells: an
 * inbreeding marker before some, a count of appearances after the fifth
 * generation's. They hold digits or nothing; a horse's name has letters.
 */

import { createHash } from "node:crypto";

import { decodeHtml } from "./client.mjs";
import { normaliseName } from "../pedigree/store.mjs";

/** Arion's menu entry for the five-generation grid. */
export const GRID_REPORT = "PED05|55#10D_a";

/** Generation by the rowspan the page gives its cells. */
const BY_ROWSPAN = { 16: 1, 8: 2, 4: 3, 2: 4, 1: 5 };
export const FULL_ANCESTOR_COUNT = 62;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const unescape = (s) =>
  String(s ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

/** The words of a scrap of markup. */
const clean = (html) => unescape(String(html ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** "DANSILI (GB)" → { name: "Dansili", country: "GB" }; the page shouts the parents' names. */
export function splitName(raw) {
  const s = clean(raw);
  const m = s.match(/^(.*?)\s*\(([A-Za-z]{2,3})\)\s*$/);
  const bare = (m ? m[1] : s).trim();
  const name = bare === bare.toUpperCase() && /[A-Z]/.test(bare) ? titleCase(bare) : bare;
  return { name, country: m ? m[2].toUpperCase() : null };
}

// "ADMIRAL'S VOYAGE" → "Admiral's Voyage": a word starts after a space, a bracket or a hyphen, not an apostrophe
const titleCase = (s) =>
  s.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (_, before, c) => before + c.toUpperCase());

const withCountry = ({ name, country }) => (country ? `${name} (${country})` : name);

/** The path to a position: generation 2, position 1 is SD (the sire's dam). */
export const pathOf = (generation, position) =>
  position.toString(2).padStart(generation, "0").replace(/0/g, "S").replace(/1/g, "D");

/** "B. 1996" → { color: "b", year: 1996 }; a line that is something else is left alone. */
const colourYear = (line) => {
  const m = String(line ?? "").match(/^([A-Za-z][A-Za-z. /]*?)\s*(1[89]\d\d|20\d\d)$/);
  if (!m) return null;
  return { color: m[1].replace(/\.$/, "").trim().toLowerCase(), year: Number(m[2]) };
};

/** "f:1487 r:1262 w:909 SW:154": what the sire line's horses have had. */
const progenyOf = (line) => {
  const m = String(line ?? "").match(/f:(\d+)\s+r:(\d+)\s+w:(\d+)\s+SW:(\d+)/i);
  return m ? { foals: Number(m[1]), runners: Number(m[2]), winners: Number(m[3]), stakes_winners: Number(m[4]) } : null;
};

/** The ancestors on the page, in the cache's order and shape. */
export function parseAncestors(html) {
  const counts = [0, 0, 0, 0, 0, 0];
  const out = [];
  for (const m of String(html ?? "").matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)) {
    const rowspan = Number(/rowspan\s*=\s*"?(\d+)/i.exec(m[1])?.[1] ?? 1);
    const generation = BY_ROWSPAN[rowspan];
    const lines = m[2].split(/<br\s*\/?>/i).map(clean).filter(Boolean);
    // the marker and count cells hold digits or nothing; a horse has letters
    if (!generation || !lines.length || !/[A-Za-z]/.test(lines[0])) continue;
    const { name, country } = splitName(lines[0]);
    const cy = colourYear(lines[1]);
    const rest = lines.slice(cy ? 2 : 1);
    const progeny = rest.map(progenyOf).find(Boolean) ?? null;
    const record = rest.find((l) => !progenyOf(l)) ?? null;
    const position = counts[generation]++;
    const display = withCountry({ name, country });
    out.push({
      generation,
      position,
      path: pathOf(generation, position),
      display_name: display,
      name: display,
      on_file: false,
      prefix: null,
      year_short: cy ? String(cy.year).slice(2) : null,
      foaling_year: cy?.year ?? null,
      color: cy?.color ?? null,
      reference_number: null,
      ...(record ? { record } : {}),
      ...(progeny ? { progeny } : {}),
    });
  }
  return out;
}

/** The horse the page is for, from its heading: "PRUDENZIA (IRE) 2005 Bay filly / by Dansili - Platonic, by Zafonic". */
export function parseSubject(html) {
  // the heading sits above the grid; the grid's own bold cell is the sire
  const above = String(html ?? "").split(/<table\b/i)[0];
  const h = above.match(/<b>\s*([^<]+?)\s*<\/b>\s*(?:<br\s*\/?>\s*)?(by\s+[^<]+)?/i);
  if (!h) return null;
  const head = clean(h[1]).match(/^(.+?)(?:\s+\(([A-Za-z]{2,3})\))?(?:\s+(1[89]\d\d|20\d\d))?(?:\s+(.*))?$/);
  if (!head || !head[1]) return null;
  const words = clean(head[4]).split(" ").filter(Boolean);
  const sex = words.length ? words[words.length - 1].toLowerCase() : null;
  const colour = words.length > 1 ? words.slice(0, -1).join(" ") : null;
  const parents = clean(h[2] ?? "").match(/^by\s+(.+?)\s+-\s+(.+?)(?:,\s*by\s+(.+?))?$/i);
  return {
    name: splitName(head[1]).name,
    country: head[2] ? head[2].toUpperCase() : null,
    year: head[3] ? Number(head[3]) : null,
    colour,
    sex: /^(filly|mare|colt|horse|gelding|rig)$/.test(sex ?? "") ? sex : null,
    sire: parents?.[1] ?? null,
    dam: parents?.[2] ?? null,
    damsire: parents?.[3] ?? null,
  };
}

/** Arion's own inbreeding lines after the grid: "Northern Dancer (CAN) 1961 : 4m x 5m". */
export function parseInbreeding(html) {
  const after = String(html ?? "").split(/<\/table>/i)[1] ?? "";
  const out = [];
  for (const m of after.matchAll(/<span[^>]*>([^<]+)<\/span>\s*:\s*([^<]+)/g)) {
    const ancestor = clean(m[1]);
    const crosses = clean(m[2]);
    if (ancestor && crosses) out.push({ ancestor, crosses_text: crosses });
  }
  return out;
}

/**
 * The whole page. Throws when it does not read as five full generations:
 * a page that is not the grid, or a grid Arion cut short, must not be filed
 * as a chart.
 */
export function parseGrid(html) {
  const ancestors = parseAncestors(html);
  const perGeneration = [1, 2, 3, 4, 5].map((g) => ancestors.filter((a) => a.generation === g).length);
  if (ancestors.length !== FULL_ANCESTOR_COUNT || perGeneration.some((n, i) => n !== 2 ** (i + 1))) {
    throw new Error(`Arion's page did not read as a five-generation grid (${ancestors.length} ancestors, ${perGeneration.join("/")} by generation)`);
  }
  const inbreeding = parseInbreeding(html);
  return {
    subject: parseSubject(html),
    ancestors,
    inbreeding,
    inbreedingText: inbreeding.map((i) => `${i.ancestor}: ${i.crosses_text}`).join("; ") || null,
  };
}

/**
 * The cache key for a chart from Arion: ours, since Arion gives none that
 * lasts (its search tokens are a session's). Her name and year, hashed to
 * fit the column; stable, so fetching her again overwrites rather than
 * duplicates.
 */
export const referenceFor = ({ name, year = null }) =>
  `arion:${createHash("sha1").update(`${normaliseName(name)}|${year ?? ""}`).digest("hex").slice(0, 24)}`;

const SEX_WORD = { f: "Filly", filly: "Filly", m: "Mare", mare: "Mare", c: "Colt", colt: "Colt", h: "Horse", horse: "Horse", g: "Gelding", gelding: "Gelding", r: "Rig", rig: "Rig" };
export const sexWord = (s) => SEX_WORD[String(s ?? "").trim().toLowerCase()] ?? null;

/** The payload the cache stores and the site reads, in Equineline's shape with Arion's content. */
export function payloadFor(parsed, { name = "", year = null, country = null, sex = null } = {}) {
  const subject = parsed?.subject ?? {};
  const bare = subject.name || splitName(name).name;
  const cc = subject.country ?? splitName(name).country ?? (country ? String(country).toUpperCase() : null);
  const display = withCountry({ name: bare, country: cc });
  const foaled = subject.year ?? (Number.isFinite(Number(year)) && Number(year) > 1700 ? Number(year) : null);
  const sire = parsed.ancestors.find((a) => a.path === "S") ?? null;
  const dam = parsed.ancestors.find((a) => a.path === "D") ?? null;
  const damsire = parsed.ancestors.find((a) => a.path === "DS") ?? null;
  return {
    source: "arion",
    report: "5x5",
    horse: {
      name: display,
      reference_number: referenceFor({ name: display, year: foaled }),
      color: subject.colour ?? null,
      sex: sexWord(subject.sex) ?? sexWord(sex),
      foaled: foaled ? String(foaled) : null,
      foaled_in: null,
      sire: subject.sire ?? sire?.name ?? null,
      dam: subject.dam ?? dam?.name ?? null,
      damsire: subject.damsire ?? damsire?.name ?? null,
      starts: null,
      highlight: null,
    },
    ancestors: parsed.ancestors,
    inbreeding: parsed.inbreeding ?? [],
    inbreeding_text: parsed.inbreedingText ?? null,
    breeder: null,
  };
}

/* ------------------------------------------------------------- the fetch */

const bareKey = (s) => normaliseName(splitName(s).name);

/**
 * Which of the horses Arion listed is the one asked for.
 *
 * Arion's own narrowing (`best`) is taken when it made one. Otherwise the
 * name must match, and her year, country and sire must agree where both
 * sides know them; one left is hers, none or several is not a guess to make.
 * A row's cells are name, country, year, sire, dam, sex.
 */
export function chooseCandidate(candidates = [], { name = "", year = null, country = null, sire = null } = {}) {
  const best = candidates.find((c) => c?.best);
  if (best) return { one: best, among: candidates };
  const wantKey = bareKey(name);
  const wantYear = Number(year) > 1700 ? Number(year) : null;
  const wantCountry = country ? String(country).trim().toUpperCase() : null;
  const wantSire = sire ? bareKey(sire) : null;
  const among = candidates.filter((c) => {
    const cells = c?.cells ?? [];
    if (bareKey(cells[0] ?? c?.label ?? "") !== wantKey) return false;
    const y = Number(cells[2]);
    if (wantYear && y > 1700 && y !== wantYear) return false;
    const cc = String(cells[1] ?? "").trim().toUpperCase();
    if (wantCountry && cc && cc !== wantCountry) return false;
    const s = cells[3] ? bareKey(cells[3]) : null;
    if (wantSire && s && s !== wantSire) return false;
    return true;
  });
  return { one: among.length === 1 ? among[0] : null, among };
}

/** A candidate as the mare pages list a namesake: the shape Equineline's matches take. */
export const asMatch = (c) => {
  const cells = c?.cells ?? [];
  return {
    name: withCountry({ name: splitName(cells[0] ?? c?.label ?? "").name, country: cells[1] ? String(cells[1]).toUpperCase() : null }),
    foaling_year: Number(cells[2]) > 1700 ? Number(cells[2]) : null,
    sex: sexWord(cells[5]),
    sire: cells[3] || null,
    dam: cells[4] || null,
    reference_number: null,
    arion: c?.label ?? null,
  };
};

/**
 * The fetcher. `loadArion` hands back `{ client }`, the Arion client the
 * server already runs (one browser session, one queue); nothing here talks
 * to Arion on its own.
 */
export function createGridFetcher({ loadArion, log = console }) {
  async function fetchGrid({ name, year = null, country = null, sire = null, userId = null } = {}) {
    if (!String(name ?? "").trim()) throw new Error("a name is needed to ask Arion for a pedigree");
    const { client } = await loadArion();
    if (typeof client.configured === "function" && !client.configured()) {
      const err = new Error("Arion is not configured on this server (ARION_USERNAME and ARION_PASSWORD)");
      err.unconfigured = true;
      throw err;
    }
    const found = await client.search({ kind: "named", name, year: year ?? null, country: country ?? "" });
    if (!found?.found || !found.candidates?.length) {
      const err = new Error(found?.text || `Arion holds no horse called ${name}`);
      err.notFound = true;
      throw err;
    }
    const pick = chooseCandidate(found.candidates, { name, year, country, sire });
    if (!pick.one) {
      const err = new Error(
        pick.among.length
          ? `Arion lists ${pick.among.length} horses called ${name}${year ? ` foaled ${year}` : ""}; her country or sire would tell them apart`
          : `Arion lists no ${name}${year ? ` foaled ${year}` : ""}${country ? ` in ${country}` : ""}; ${found.candidates.length} other horse${found.candidates.length === 1 ? "" : "s"} of the name`,
      );
      err.ambiguous = pick.among.length > 1;
      err.notFound = pick.among.length === 0;
      err.count = pick.among.length;
      err.matches = pick.among.map(asMatch);
      throw err;
    }
    const out = await client.report({ token: pick.one.token, reportId: GRID_REPORT, userId });
    const page = (out?.files ?? []).find((f) => f.kind === "html");
    if (!page) throw new Error(out?.note || "Arion built the 5x5 grid but handed over no page for it");
    const got = await client.file(page.id);
    const html = typeof got?.body === "string" ? got.body : decodeHtml(got?.body ?? Buffer.alloc(0), got?.type ?? "");
    const parsed = parseGrid(html);
    if (parsed.subject?.name && normaliseName(parsed.subject.name) !== bareKey(name)) {
      throw new Error(`Arion's grid is for ${parsed.subject.name}, not ${name}`);
    }
    log.log?.(`[arion] 5x5 grid read for ${pick.one.label}: ${parsed.ancestors.length} ancestors`);
    return payloadFor(parsed, { name, year, country, sex: (pick.one.cells ?? [])[5] ?? null });
  }
  return { fetchGrid, chooseCandidate };
}
