import assert from "node:assert/strict";
import { test } from "node:test";

import { BROWSER_NAMES, CHROMIUM_PATHS, SEARCH_GRID, asCandidate, filesFrom, horseIdFrom, idOf, isHorseRow, pickCandidate, pickChromium, withSession } from "./browser.mjs";

test("a control's id is its name with the dollars swapped for underscores", () => {
  assert.equal(idOf("ctl00$MainContentArea$txtNamedHorse"), "#ctl00_MainContentArea_txtNamedHorse");
  assert.equal(idOf("ctl00$MainContentArea$btnSearchNamedHorse"), "#ctl00_MainContentArea_btnSearchNamedHorse");
});

test("ARION_CHROMIUM_PATH wins, and a wrong one is reported rather than worked around", () => {
  const isExecutable = (p) => p === "/opt/chrome" || p === "/usr/bin/chromium";
  assert.deepEqual(
    pickChromium({ env: { ARION_CHROMIUM_PATH: "/opt/chrome" }, isExecutable }),
    { path: "/opt/chrome", from: "ARION_CHROMIUM_PATH" },
  );
  // a named path that is not there does NOT quietly fall through to another
  // browser: launching a different one than was asked for hides the mistake
  assert.deepEqual(
    pickChromium({ env: { ARION_CHROMIUM_PATH: "/opt/gone" }, isExecutable }),
    { path: null, from: "ARION_CHROMIUM_PATH", missing: "/opt/gone" },
  );
});

test("a browser in the image is found, by fixed path or on PATH", () => {
  assert.equal(pickChromium({ env: {}, isExecutable: (p) => p === "/usr/bin/chromium" }).path, "/usr/bin/chromium");
  // Nix symlinks its packages onto PATH from somewhere unpredictable
  assert.deepEqual(
    pickChromium({ env: { PATH: "/nix/store/abc123-chromium/bin:/usr/local/bin" }, isExecutable: (p) => p === "/nix/store/abc123-chromium/bin/chromium" }),
    { path: "/nix/store/abc123-chromium/bin/chromium", from: "the image" },
  );
  // a trailing slash on a PATH entry does not produce a doubled one
  const seen = [];
  pickChromium({ env: { PATH: "/opt/bin/" }, isExecutable: (p) => { seen.push(p); return false; } });
  assert.ok(seen.includes("/opt/bin/chromium"), seen.join(" "));
  assert.ok(!seen.some((p) => p.includes("//")), "no doubled slash");
});

test("no browser anywhere is reported, not thrown: playwright may still have its own", () => {
  assert.deepEqual(
    pickChromium({ env: {}, isExecutable: () => false }),
    { path: null, from: "playwright's own download" },
  );
});

test("the places looked in cover a Nix image and a Debian one", () => {
  assert.ok(CHROMIUM_PATHS.some((p) => p.includes("nix")), "Railway's image is Nix-based");
  assert.ok(CHROMIUM_PATHS.includes("/usr/bin/chromium"));
  assert.ok(BROWSER_NAMES.includes("chromium"));
});

/* ------------------------------------------------------------------------ */
/* Arion's own answer to a search for "Starspangledbanner", copied from a    */
/* live run of /api/arion/browser-check. Not invented: the fixtures this     */
/* client used to be tested against named a `gvHorses` grid that does not    */
/* exist on the page, which is how it came to report every search as empty.  */
/* ------------------------------------------------------------------------ */
const LINK = (n) => `${SEARCH_GRID}_ctl0${n}_lnkHorseName`;
const LIVE_ROWS = [
  { cells: ["Horse", "Country", "Year of", "Sire", "Dam"], posts: [] },
  { cells: ["Starspangledbanner", "SAF", "2008", "Indigo Magic", "Enchanting Queen"], posts: [LINK(2)] },
  { cells: ["Starspangledbanner", "AUS", "2006", "Choisir", "Gold Anthem", "S"], posts: [LINK(3)] },
  { cells: ["Starspangledbertie", "USA", "2007", "Dixie Union", "De Bertie", "M"], posts: [LINK(4)] },
  { cells: ["Starspangledboy", "GB", "1995", "Durgam", "Hejera"], posts: [LINK(5)] },
];
const asHorses = () => LIVE_ROWS.filter(isHorseRow).map((r) => asCandidate(r.cells, r.posts[0]));

test("a header row is not a horse: nothing in it can be clicked", () => {
  assert.equal(isHorseRow(LIVE_ROWS[0]), false);
  assert.equal(isHorseRow(LIVE_ROWS[1]), true);
  assert.equal(asHorses().length, 4);
});

test("a row becomes a horse, with the year as a number and the sex kept", () => {
  const [saf, aus] = asHorses();
  assert.deepEqual(
    { ...saf, cells: undefined },
    { name: "Starspangledbanner", country: "SAF", year: 2008, sire: "Indigo Magic", dam: "Enchanting Queen", sex: null, link: LINK(2), label: "Starspangledbanner (SAF) 2008", cells: undefined },
  );
  assert.equal(aus.year, 2006);
  assert.equal(aus.sire, "Choisir");
  assert.equal(aus.sex, "S");
  assert.equal(aus.label, "Starspangledbanner (AUS) 2006");
});

test("a name is not a horse: Arion holds two Starspangledbanners", () => {
  // the whole reason the year and country are carried through the link
  const byName = pickCandidate(asHorses(), { name: "Starspangledbanner" });
  assert.equal(byName.one, null, "a bare name does not resolve, and is not guessed at");
  assert.equal(byName.among.length, 2);
  assert.deepEqual(byName.among.map((h) => h.country), ["SAF", "AUS"]);

  // the stallion, named as the breeding pages name him
  const byYear = pickCandidate(asHorses(), { name: "Starspangledbanner", year: 2006 });
  assert.equal(byYear.one?.sire, "Choisir");
  const byCountry = pickCandidate(asHorses(), { name: "Starspangledbanner", country: "AUS" });
  assert.equal(byCountry.one?.year, 2006);
});

test("the tie-break is name, then year, then country — and a miss does not throw it away", () => {
  const horses = asHorses();
  // an exact name wins over Arion's near matches
  assert.equal(pickCandidate(horses, { name: "Starspangledboy" }).one?.year, 1995);
  // a year Arion does not hold falls back to the name's rows rather than none
  const wrongYear = pickCandidate(horses, { name: "Starspangledbanner", year: 1999 });
  assert.equal(wrongYear.one, null);
  assert.equal(wrongYear.among.length, 2, "both are still offered to choose between");
  // country is only reached once the year has not settled it
  assert.equal(pickCandidate(horses, { name: "Starspangledbanner", year: 2008, country: "AUS" }).one?.country, "SAF",
    "the year settles it first, so the wrong country does not override it");
});

test("asCandidate refuses a row with no name, and a year that is not one", () => {
  assert.equal(asCandidate([], null), null);
  assert.equal(asCandidate(["", "AUS", "2006"], "x"), null);
  assert.equal(asCandidate(["Dam Of", "AUS", "n/a"], "x").year, null);
  assert.equal(asCandidate(["Dam Of", "AUS", "12"], "x").year, null, "a page number is not a foaling year");
});

/* ------------------------------------------------------------------------ */
/* The finished report, as a live run reported it.                          */
/* ------------------------------------------------------------------------ */
const LIVE_HIDDEN =
  "<PdfFileName>Starspangledbanner_Pedigreesreport-3_134357747794695177.pdf</PdfFileName>" +
  "<RtfFileName>Starspangledbanner_Pedigreesreport-3_134357747794695177.rtf</RtfFileName>";

test("the report's two files are read out of the hidden field Arion fills in", () => {
  const files = filesFrom(LIVE_HIDDEN);
  assert.deepEqual(files.map((f) => f.kind), ["pdf", "rtf"]);
  assert.equal(files[0].url, "https://arion.co.nz/files/reports/Starspangledbanner_Pedigreesreport-3_134357747794695177.pdf");
  // which is where the page's own "Save As RTF" points
  assert.equal(files[1].url.endsWith(".rtf"), true);
});

test("a field with no report in it yields no files, and a path is not a file name", () => {
  assert.deepEqual(filesFrom(""), []);
  assert.deepEqual(filesFrom(null), []);
  assert.deepEqual(filesFrom("<PdfFileName></PdfFileName>"), []);
  // Arion names a file, never a place; anything that walks is refused rather
  // than fetched
  assert.deepEqual(filesFrom("<PdfFileName>../../web.config</PdfFileName>"), []);
  assert.deepEqual(filesFrom("<PdfFileName>/etc/passwd</PdfFileName>"), []);
});

test("Arion's own id for the horse is kept from the report frame", () => {
  assert.equal(
    horseIdFrom([
      "https://arion.co.nz/ReportLoader.aspx?HorseName=Starspangledbanner&HorseId=103364639&Class=pedigreeReportFrame1&ReportType=PED01&Style=I",
      "https://arion.co.nz/HabrokRefresh.aspx",
    ]),
    "103364639",
    "a name is not a horse; this number is",
  );
  assert.equal(horseIdFrom(["https://arion.co.nz/PedigreeReports/PedigreeReports.aspx"]), null);
  assert.equal(horseIdFrom([]), null);
});

test("a session refuses to start without the desk's login, before any browser is launched", async () => {
  await assert.rejects(
    withSession(() => {}, { env: {} }),
    (e) => e.code === "unconfigured" && e.status === 503,
  );
});

test("a name that matches nothing narrows nothing: the year must not pick a stranger", () => {
  // Live: a sire x dam search for Starspangledbanner x Lady Vivian answers
  // with a list of SIRES, and the year and country the page sends are the
  // MARE's. Running them over that list once resolved to Star Sparsh (IND)
  // 2022 — a horse nobody asked about — on the strength of a foaling year.
  const sires = [
    asCandidate(["Starspangledbanner", "AUS", "2006", "Choisir", "Gold Anthem", "S"], "a"),
    asCandidate(["Star Sparsh", "IND", "2022", "Air Support", "Shining Star", "S"], "b"),
    asCandidate(["Star Spangled Day", "USA", "1993", "Decoration Day", "Miss Canela", "S"], "c"),
  ];
  const wrong = pickCandidate(sires, { name: "Lady Vivian", year: 2022, country: "IRE" });
  assert.equal(wrong.one, null, "no Lady Vivian here, so no horse here");
  assert.equal(wrong.matched, false);
  assert.equal(wrong.among.length, 3, "the whole list is still offered to choose from");

  // and a name that does match still narrows as before
  const right = pickCandidate(sires, { name: "Starspangledbanner", year: 2006 });
  assert.equal(right.one?.sire, "Choisir");
});

test("with no name asked for, the year and country still narrow", () => {
  const rows = [
    asCandidate(["Lady Vivian", "IRE", "2022", "Camelot", "Ceol an Ghra", "R"], "a"),
    asCandidate(["Lady Vivian", "FR", "2014", "Born to Sea", "Lilac Moon", "M"], "b"),
  ];
  assert.equal(pickCandidate(rows, { year: 2022 }).one?.country, "IRE");
  assert.equal(pickCandidate(rows, { country: "FR" }).one?.year, 2014);
});

test("the Wathnan mare is told from the other Lady Vivians", () => {
  // all four, as Arion listed them
  const rows = [
    asCandidate(["Lady Vivian", "IRE", "2022", "Camelot", "Ceol an Ghra", "R"], "a"),
    asCandidate(["Lady Vivian", "FR", "2014", "Born to Sea", "Lilac Moon", "M"], "b"),
    asCandidate(["Lady Vivian", "USA", "2000", "Dumaani", "Lover's Hour", "M"], "c"),
    asCandidate(["Lady Vivien", "GB", "2006", "Kyllachy", "Elsie Plunkett", "M"], "d"),
  ];
  const got = pickCandidate(rows, { name: "Lady Vivian", year: 2022, country: "IRE" });
  assert.equal(got.one?.sire, "Camelot");
  assert.equal(got.one?.dam, "Ceol an Ghra");
  // the bare name leaves three of them, and does not guess
  assert.equal(pickCandidate(rows, { name: "Lady Vivian" }).one, null);
  assert.equal(pickCandidate(rows, { name: "Lady Vivian" }).among.length, 3);
});
