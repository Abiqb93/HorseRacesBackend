import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { asMatch, chooseCandidate, createGridFetcher, parseGrid, parseSubject, pathOf, payloadFor, referenceFor, splitName } from "./pedigreeGrid.mjs";
import * as store from "../pedigree/store.mjs";

/* Arion's 5x5 grid for Prudenzia (IRE) 2005, as the page came back on 22 October 2026. */
const PAGE = readFileSync(new URL("./fixtures/prudenzia-5x5.html", import.meta.url), "utf8");

test("the page reads as five full generations, in the cache's order", () => {
  const { ancestors } = parseGrid(PAGE);
  assert.equal(ancestors.length, 62);
  const at = (path) => ancestors.find((a) => a.path === path);
  assert.equal(at("S").name, "Dansili (GB)");
  assert.equal(at("D").name, "Platonic (GB)");
  assert.equal(at("SS").name, "Danehill");
  assert.equal(at("SD").name, "Hasili");
  assert.equal(at("DS").name, "Zafonic");
  assert.equal(at("DD").name, "Puce");
  assert.equal(at("SDS").name, "Kahyasi");
  assert.equal(at("SSSS").name, "Northern Dancer");
  assert.equal(at("SSSSS").name, "Nearctic");
  assert.equal(at("SSSSD").name, "Natalma");
  assert.equal(at("DDDDD").name, ancestors[61].name, "the last of the fifth generation is the dam line's end");
  // every position of every generation, once
  for (let g = 1; g <= 5; g++) {
    const gen = ancestors.filter((a) => a.generation === g).map((a) => a.position).sort((a, b) => a - b);
    assert.deepEqual(gen, [...Array(2 ** g).keys()], `generation ${g}`);
  }
});

test("the first three generations carry colour and year; the last two are names only", () => {
  const { ancestors } = parseGrid(PAGE);
  const at = (path) => ancestors.find((a) => a.path === path);
  assert.deepEqual([at("S").color, at("S").foaling_year, at("S").year_short], ["b", 1996, "96"]);
  assert.deepEqual([at("SDD").color, at("SDD").foaling_year], ["ch", 1984]);
  assert.equal(at("S").record, "GW 5 wins");
  assert.deepEqual(at("S").progeny, { foals: 1487, runners: 1262, winners: 909, stakes_winners: 154 });
  assert.equal(at("SSSS").foaling_year, null);
  assert.equal(at("SSSS").color, null);
  assert.equal(at("SSSSS").reference_number, null);
  assert.equal(at("SSSSS").on_file, false);
});

test("the subject, her parents and Arion's inbreeding lines are read from around the grid", () => {
  const parsed = parseGrid(PAGE);
  assert.deepEqual(parsed.subject, { name: "Prudenzia", country: "IRE", year: 2005, colour: "Bay", sex: "filly", sire: "Dansili", dam: "Platonic", damsire: "Zafonic" });
  assert.equal(parsed.inbreeding[0].ancestor, "Northern Dancer (CAN) 1961");
  assert.equal(parsed.inbreeding[0].crosses_text, "4m x 5m");
  assert.match(parsed.inbreedingText, /Natalma \(USA\) 1957: 5m 5f x/);
});

test("a page that is not a full grid is refused rather than filed", () => {
  assert.throws(() => parseGrid(PAGE.replace("<td>Nearctic</td>", "<td></td>")), /61 ancestors/);
  assert.throws(() => parseGrid("<html><body><p>Arion Report</p></body></html>"), /0 ancestors/);
});

test("names are read as the page writes them, less the shouting", () => {
  assert.deepEqual(splitName("DANSILI (GB)"), { name: "Dansili", country: "GB" });
  assert.deepEqual(splitName("Pas de Nom"), { name: "Pas de Nom", country: null });
  assert.deepEqual(splitName("ADMIRAL'S VOYAGE"), { name: "Admiral's Voyage", country: null });
  assert.equal(pathOf(1, 1), "D");
  assert.equal(pathOf(3, 2), "SDS");
  assert.equal(pathOf(5, 31), "DDDDD");
});

test("the payload is the cache's shape, keyed by a reference of our own that is stable and fits", () => {
  const payload = payloadFor(parseGrid(PAGE), { name: "Prudenzia", year: 2005, country: "IRE", sex: "M" });
  assert.equal(payload.source, "arion");
  assert.equal(payload.horse.name, "Prudenzia (IRE)");
  assert.equal(payload.horse.sex, "Filly");
  assert.equal(payload.horse.foaled, "2005");
  assert.deepEqual([payload.horse.sire, payload.horse.dam, payload.horse.damsire], ["Dansili", "Platonic", "Zafonic"]);
  assert.equal(payload.ancestors.length, 62);
  const ref = payload.horse.reference_number;
  assert.match(ref, /^arion:[0-9a-f]{24}$/);
  assert.ok(ref.length <= 32, "fits the cache's reference column");
  assert.equal(ref, referenceFor({ name: "PRUDENZIA (IRE)", year: 2005 }), "the same horse keys the same");
  assert.notEqual(ref, referenceFor({ name: "Prudenzia (IRE)", year: 1987 }), "a namesake of another year does not");
  const row = store.rowFor(payload);
  assert.equal(row.reference, ref);
  assert.equal(row.name_key, "prudenzia");
  assert.equal(row.foaling_year, 2005);
  assert.equal(row.sex, "Filly");
  assert.equal(JSON.parse(row.payload).ancestors.length, 62);
});

/* --------------------------------------------------------- choosing hers */

const PRUDENZIAS = [
  { token: "a", label: "Prudenzia (IRE) 2005", cells: ["Prudenzia", "IRE", "2005", "Dansili", "Platonic", "M"] },
  { token: "b", label: "Prudenzio (FR) 1987", cells: ["Prudenzio", "FR", "1987", "Miller's Mate", "Piastrella", ""] },
  { token: "c", label: "Prudenzia (USA) 2005", cells: ["Prudenzia", "USA", "2005", "Storm Cat", "Prudence", "M"] },
];

test("Arion's own pick is taken; otherwise her year, country and sire decide, and a tie is not guessed at", () => {
  assert.equal(chooseCandidate(PRUDENZIAS.map((c, i) => ({ ...c, best: i === 2 })), { name: "Prudenzia" }).one.token, "c");
  assert.equal(chooseCandidate(PRUDENZIAS, { name: "Prudenzia", year: 2005, country: "IRE" }).one.token, "a");
  assert.equal(chooseCandidate(PRUDENZIAS, { name: "Prudenzia", sire: "Storm Cat" }).one.token, "c");
  const tie = chooseCandidate(PRUDENZIAS, { name: "Prudenzia", year: 2005 });
  assert.equal(tie.one, null);
  assert.equal(tie.among.length, 2);
  assert.equal(chooseCandidate(PRUDENZIAS, { name: "Prudenzia", year: 1999 }).among.length, 0, "the wrong year matches nobody");
  assert.deepEqual(asMatch(PRUDENZIAS[0]), { name: "Prudenzia (IRE)", foaling_year: 2005, sex: "Mare", sire: "Dansili", dam: "Platonic", reference_number: null, arion: "Prudenzia (IRE) 2005" });
});

/* ------------------------------------------------------------- the fetch */

/** An Arion client as the fetcher sees it, with every call recorded. */
function fakeArion({ candidates = PRUDENZIAS, page = PAGE, configured = true } = {}) {
  const calls = [];
  const client = {
    configured: () => configured,
    search: async (q) => (calls.push(["search", q]), candidates.length ? { found: true, candidates } : { found: false, candidates: [], text: "Arion holds no horse by that name." }),
    report: async (q) => (calls.push(["report", q]), { files: [{ id: "pdf1", kind: "pdf" }, { id: "html1", kind: "html" }] }),
    file: async (id) => (calls.push(["file", id]), { type: "text/html; charset=ISO-8859-1", body: Buffer.from(page, "latin1") }),
  };
  return { calls, loadArion: async () => ({ client }) };
}

test("a mare is searched, her 5x5 made, the page read, and the payload is hers", async () => {
  const { calls, loadArion } = fakeArion();
  const f = createGridFetcher({ loadArion, log: { log: () => {} } });
  const payload = await f.fetchGrid({ name: "Prudenzia", year: 2005, country: "IRE", userId: "desk" });
  assert.equal(payload.horse.name, "Prudenzia (IRE)");
  assert.equal(payload.horse.sex, "Filly");
  assert.equal(payload.ancestors.length, 62);
  assert.deepEqual(calls.map((c) => c[0]), ["search", "report", "file"]);
  assert.deepEqual(calls[1][1], { token: "a", reportId: "PED05|55#10D_a", userId: "desk" });
  assert.equal(calls[2][1], "html1");
});

test("a horse Arion does not hold, a tie it cannot break, and a server without Arion each say so", async () => {
  await assert.rejects(createGridFetcher({ loadArion: fakeArion({ candidates: [] }).loadArion }).fetchGrid({ name: "Nobody" }), (e) => e.notFound && /no horse/.test(e.message));
  await assert.rejects(createGridFetcher({ loadArion: fakeArion().loadArion }).fetchGrid({ name: "Prudenzia", year: 2005 }), (e) => e.ambiguous && e.count === 2 && e.matches.length === 2);
  await assert.rejects(createGridFetcher({ loadArion: fakeArion().loadArion }).fetchGrid({ name: "Prudenzia", year: 1999 }), (e) => e.notFound && /lists no Prudenzia foaled 1999/.test(e.message));
  await assert.rejects(createGridFetcher({ loadArion: fakeArion({ configured: false }).loadArion }).fetchGrid({ name: "Prudenzia" }), (e) => e.unconfigured);
});

test("a page for another horse is never filed under hers", async () => {
  const other = PAGE.replace("<b>PRUDENZIA (IRE) 2005 Bay filly</b>", "<b>PRUDENZIO (FR) 1987 Bay horse</b>");
  await assert.rejects(
    createGridFetcher({ loadArion: fakeArion({ page: other, candidates: [{ ...PRUDENZIAS[0], best: true }] }).loadArion }).fetchGrid({ name: "Prudenzia", year: 2005 }),
    /grid is for Prudenzio, not Prudenzia/,
  );
});

test("the heading is optional: a grid without one still reads, named from the search", () => {
  const headless = PAGE.replace(/<p style="text-align: center; font-size: large">[\s\S]*?<\/p>/, "");
  assert.equal(parseSubject(headless), null);
  const payload = payloadFor(parseGrid(headless), { name: "Prudenzia", year: 2005, country: "IRE", sex: "M" });
  assert.equal(payload.horse.name, "Prudenzia (IRE)");
  assert.equal(payload.horse.sex, "Mare");
  assert.equal(payload.horse.sire, "Dansili (GB)");
});
