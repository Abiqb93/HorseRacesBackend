import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BROWSER_NAMES,
  CHROMIUM_PATHS,
  FILE_MAX,
  SEARCH_GRID,
  frameFor,
  madeAs,
  reportParts,
  asCandidate,
  asSavedReport,
  closeSession,
  fetchFiles,
  filesFrom,
  horseIdFrom,
  idOf,
  isHorseRow,
  pickCandidate,
  pickChromium,
  sameReport,
  searchKey,
  sessionKept,
  warmSession,
  withSession,
} from "./browser.mjs";
import { REPORTS_PATH } from "./client.mjs";

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

/* ------------------------------------------------------------------------ */
/* My Reports, as a live run read gvMyReport. The old parser reported this   */
/* same grid as an empty list while the account held seventeen pages of it.  */
/* ------------------------------------------------------------------------ */
const OPEN = (n) => [{ id: `gvMyReport_ctl0${n}_lnkOpen`, text: "Open" }];

test("a row of My Reports becomes a report", () => {
  const r = asSavedReport(["Starspangledbanner", "Catalogue Style Unedited", "WI style", "06/11/2026"], OPEN(2));
  assert.deepEqual(r, {
    horse: "Starspangledbanner",
    type: "Catalogue Style Unedited",
    style: "WI style",
    expires: "06/11/2026",
    link: "gvMyReport_ctl02_lnkOpen",
    label: "Starspangledbanner · Catalogue Style Unedited · WI style",
  });
});

test("a style of '-' is no style, and is left out of the label", () => {
  const r = asSavedReport(["Con Te Partiro", "Research Document", "-", "06/11/2026"], OPEN(3));
  assert.equal(r.style, null);
  assert.equal(r.label, "Con Te Partiro · Research Document");
});

test("the header and the pager are not reports", () => {
  assert.equal(asSavedReport(["Horse Name", "Report Type", "Report Style", "Expiry Date"], []), null);
  assert.equal(asSavedReport(["Page 1 of 17", "12345678910", "1", "2"], []), null);
  assert.equal(asSavedReport([], OPEN(2)), null);
  // The pager's row of page numbers sits in this same grid and looks like any
  // other row. Eight of them reached a live listing of 390 before this.
  assert.equal(asSavedReport(["1", "2", "3", "4"], []), null);
  assert.equal(asSavedReport(["9", "10", "11", "12"], []), null);
  // but a horse whose name merely starts with a digit is a horse
  assert.ok(asSavedReport(["7 Brothers", "Research Document", "-", "06/11/2026"], OPEN(2)));
});

test("a pager number is not a way to open a report", () => {
  // the pager's links live in the same grid, and open nothing
  const r = asSavedReport(["Starspangledbanner", "Catalogue Style Unedited", "WI style", "06/11/2026"], [
    { id: "gvMyReport_ctl28_btnNum_2", text: "2" },
    { id: "gvMyReport_ctl28_ibtnNext", text: ">" },
  ]);
  assert.equal(r.link, null, "no link rather than the wrong one");
});

test("a report is the same report by its four columns, not by a row id", () => {
  const a = asSavedReport(["Starspangledbanner", "Catalogue Style Unedited", "WI style", "06/11/2026"], OPEN(2));
  // the same report, read again in a later visit where it sits on another row
  const later = asSavedReport(["Starspangledbanner", "Catalogue Style Unedited", "WI style", "06/11/2026"], OPEN(7));
  assert.equal(sameReport(a, later), true, "the row moved; the report did not");

  // a different style of the same horse's report is a different report
  const other = asSavedReport(["Starspangledbanner", "Catalogue Style Unedited", "MM style", "06/11/2026"], OPEN(3));
  assert.equal(sameReport(a, other), false);
  // and so is the same one after it was made again, with a later expiry
  const renewed = asSavedReport(["Starspangledbanner", "Catalogue Style Unedited", "WI style", "06/12/2026"], OPEN(2));
  assert.equal(sameReport(a, renewed), false);
  assert.equal(sameReport(a, null), false);
});

/* ------------------------------------------------- the browser jobs share */

const CREDS = { ARION_USERNAME: "desk", ARION_PASSWORD: "pw" };

/**
 * Chromium as far as a session sees it: a page that loads addresses, answers
 * "signed in?" from a flag, and turns a posted login into a session. It counts
 * what was launched, loaded and logged in, which is what these tests are about.
 */
function fakeLauncher({ acceptLogin = true } = {}) {
  const seen = { launched: [], loads: 0, logins: 0, signedIn: false };
  const launch = async () => {
    let url = "about:blank";
    const page = {
      goto: async (u) => {
        seen.loads += 1;
        url = u;
      },
      url: () => url,
      // signedIn() asks with no argument; signIn() posts the login with one
      evaluate: async (fn, arg) => {
        if (arg?.forms) {
          seen.logins += 1;
          if (acceptLogin) seen.signedIn = true;
          return { posted: true };
        }
        return { yes: seen.signedIn };
      },
      waitForLoadState: async () => {},
      waitForTimeout: async () => {},
    };
    const browser = {
      closed: false,
      isConnected() {
        return !this.closed;
      },
      newContext: async () => ({ newPage: async () => page }),
      close: async () => {
        browser.closed = true;
      },
      version: () => "fake",
    };
    seen.launched.push(browser);
    return { browser, chosen: { path: "/fake/chromium" } };
  };
  return { launch, seen };
}

test("the browser is launched and signed in once, and kept for the next job", async () => {
  await closeSession();
  const { launch, seen } = fakeLauncher();
  const pages = [];
  assert.equal(await withSession(async (page) => (pages.push(page), "one"), { env: CREDS, launch }), "one");
  assert.equal(await withSession(async (page) => (pages.push(page), "two"), { env: CREDS, launch }), "two");
  assert.equal(seen.launched.length, 1);
  assert.equal(seen.logins, 1);
  assert.equal(pages[0], pages[1]);
  assert.equal(new URL(pages[1].url()).pathname, REPORTS_PATH);
  assert.equal(sessionKept(), true);
  await closeSession();
  assert.equal(sessionKept(), false);
});

test("every job but one that stays starts from a fresh load of the reports page", async () => {
  await closeSession();
  const { launch, seen } = fakeLauncher();
  await withSession(async () => {}, { env: CREDS, launch });
  const before = seen.loads;
  await withSession(async () => {}, { env: CREDS, launch });
  assert.equal(seen.loads, before + 1, "a job clears whatever the last one left open");
  // a job that stays finds the page as it was, to check and use
  await withSession(async () => {}, { env: CREDS, launch, stay: true });
  assert.equal(seen.loads, before + 1);
  await closeSession();
});

test("a job that fails closes the browser, and the next job starts another", async () => {
  await closeSession();
  const { launch, seen } = fakeLauncher();
  await assert.rejects(
    withSession(async () => {
      throw new Error("Arion did something nobody has seen");
    }, { env: CREDS, launch }),
    /nobody has seen/,
  );
  assert.equal(seen.launched[0].closed, true);
  assert.equal(sessionKept(), false);
  await withSession(async () => {}, { env: CREDS, launch });
  assert.equal(seen.launched.length, 2);
  await closeSession();
});

test("a browser left idle past its time is closed", async () => {
  await closeSession();
  const { launch, seen } = fakeLauncher();
  await withSession(async () => {}, { env: CREDS, launch, idleMs: 10 });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(seen.launched[0].closed, true);
  assert.equal(sessionKept(), false);
});

test("a session Arion has dropped is signed into again, in the same browser", async () => {
  await closeSession();
  const { launch, seen } = fakeLauncher();
  await withSession(async () => {}, { env: CREDS, launch });
  seen.signedIn = false; // Arion timed the desk out between jobs
  await withSession(async () => {}, { env: CREDS, launch });
  assert.equal(seen.launched.length, 1);
  assert.equal(seen.logins, 2);
  await closeSession();
});

test("a refused login is said, and the browser is not kept", async () => {
  await closeSession();
  const { launch, seen } = fakeLauncher({ acceptLogin: false });
  await assert.rejects(withSession(async () => {}, { env: CREDS, launch }), (e) => e.code === "login" && e.status === 401);
  assert.equal(seen.launched[0].closed, true);
  assert.equal(sessionKept(), false);
});

test("warming launches and signs in once, and leaves a kept browser as it is", async () => {
  await closeSession();
  const { launch, seen } = fakeLauncher();
  assert.deepEqual(await warmSession({ env: CREDS, launch }), { warm: true, already: false });
  const loads = seen.loads;
  // the kept page may hold the dialog a report is about to start from
  assert.deepEqual(await warmSession({ env: CREDS, launch }), { warm: true, already: true });
  assert.equal(seen.loads, loads);
  assert.equal(seen.launched.length, 1);
  await closeSession();
});

test("a search's dialog is known by the search, whatever its case or spacing", () => {
  const a = searchKey({ kind: "named", name: "Frankel" });
  assert.equal(searchKey({ kind: "named", name: "  frankel " }), a);
  assert.notEqual(searchKey({ kind: "named", name: "Frankel II" }), a);
  assert.notEqual(searchKey({ kind: "dam", dam: "Frankel" }), a);
});

test("a mating's dialog is known by the sire Arion settled on, too", () => {
  const values = { kind: "theoretical", sire: "Starspangledbanner", dam: "Lady Vivian" };
  const aus = { name: "Starspangledbanner", year: 2006, country: "AUS" };
  const saf = { name: "Starspangledbanner", year: 2008, country: "SAF" };
  // the same two names, but the dams on screen are a different sire's
  assert.notEqual(searchKey(values, aus), searchKey(values, saf));
  assert.equal(searchKey(values, aus), searchKey({ ...values }, { ...aus }));
  assert.notEqual(searchKey(values, aus), searchKey(values, null));
});

/** page.request as a session sees it: an answer per address. */
const fakeRequests = (answers) => ({
  request: {
    get: async (url) => {
      const a = answers[url];
      if (a instanceof Error) throw a;
      return {
        ok: () => a.status < 400,
        status: () => a.status,
        headers: () => ({ "content-type": a.type }),
        body: async () => Buffer.from(a.body),
      };
    },
  },
});

test("a report's files are fetched with the session, and what is not a file stays an address", async () => {
  const files = [
    { kind: "pdf", name: "a.pdf", url: "https://arion.co.nz/files/reports/a.pdf" },
    { kind: "rtf", name: "a.rtf", url: "https://arion.co.nz/files/reports/a.rtf" },
    { kind: "pdf", name: "b.pdf", url: "https://arion.co.nz/files/reports/b.pdf" },
    { kind: "pdf", name: "c.pdf", url: "https://arion.co.nz/files/reports/c.pdf" },
  ];
  const page = fakeRequests({
    [files[0].url]: { status: 200, type: "application/pdf", body: "%PDF-1.4 the report" },
    [files[1].url]: { status: 200, type: "application/octet-stream", body: "{\\rtf1 the report}" },
    // a login page where a report should be is not the report
    [files[2].url]: { status: 200, type: "text/html; charset=utf-8", body: "<html>Login</html>" },
    [files[3].url]: new Error("connection reset"),
  });
  const got = await fetchFiles(page, files);
  assert.equal(got[0].type, "application/pdf");
  assert.equal(got[0].body.toString(), "%PDF-1.4 the report");
  assert.equal(got[1].body.toString(), "{\\rtf1 the report}");
  assert.equal(got[2].body, undefined);
  assert.equal(got[2].url, files[2].url);
  assert.equal(got[3].body, undefined);
  assert.equal(got[3].url, files[3].url);
});

test("a file too big to keep is left as its address", async () => {
  const f = { kind: "pdf", name: "huge.pdf", url: "https://arion.co.nz/files/reports/huge.pdf" };
  const page = fakeRequests({ [f.url]: { status: 200, type: "application/pdf", body: "x".repeat(FILE_MAX + 1) } });
  const [got] = await fetchFiles(page, [f]);
  assert.equal(got.body, undefined);
});

/* --------------------------------------------- which file is the report */

test("a report id is read into its type, its style and its menu number", () => {
  assert.deepEqual(reportParts("PED02|0#5D_a"), { type: "PED02", value: "0", n: "5" });
  assert.deepEqual(reportParts("PED01|I#3S_a"), { type: "PED01", value: "I", n: "3" });
  assert.deepEqual(reportParts("PED01|ZTT#30S_a"), { type: "PED01", value: "ZTT", n: "30" });
  assert.equal(reportParts(""), null);
  assert.equal(reportParts("Standard pedigree"), null);
});

test("a file is the report asked for only if it carries that report's menu number", () => {
  // names as Arion wrote them: WI style is menu item 3, Tatts style 30
  const wi = "Starspangledbanner_Pedigreesreport-3_134357747794695177.pdf";
  const tatts = "LadyVivian_Pedigreesreport-30_134326401125740412.pdf";
  assert.equal(madeAs(wi, "PED01|I#3S_a"), true);
  assert.equal(madeAs(tatts, "PED01|ZTT#30S_a"), true);
  // 3 is not 30, and 30 is not 3
  assert.equal(madeAs(wi, "PED01|ZTT#30S_a"), false);
  assert.equal(madeAs(tatts, "PED01|I#3S_a"), false);
  // the dead link: a Standard pedigree (#5) handed the files of the style the
  // sidebar held when the horse was opened
  assert.equal(madeAs(wi, "PED02|0#5D_a"), false);
  // with no id to check against, nothing is thrown away
  assert.equal(madeAs(wi, ""), true);
});

const FRAME_WI =
  "https://arion.co.nz/ReportLoader.aspx?HorseName=Starspangledbanner&HorseId=103364639&Class=pedigreeReportFrame1&ReportType=PED01&Style=I&ProductType=Pedigrees&MainParameterTypeName=Style&MainParameterValue=I&SubParameter=[Depth]0[/Depth]&";

test("the frame taken is the one drawing the report asked for", () => {
  const internet = "https://arion.co.nz/ReportLoader.aspx?HorseName=Starspangledbanner&Class=pedigreeReportFrame1&ReportType=PED02&ProductType=Pedigrees&MainParameterTypeName=Depth&MainParameterValue=0&";
  const frames = ["https://arion.co.nz/Images/banner.swf", FRAME_WI, internet];
  assert.equal(frameFor(frames, "PED02|0#5D_a"), internet);
  assert.equal(frameFor(frames, "PED01|I#3S_a"), FRAME_WI);
  // the same type in another style is the next best thing
  assert.equal(frameFor([FRAME_WI], "PED01|M#2S_a"), FRAME_WI);
  // another type is another report, and is not taken
  assert.equal(frameFor([FRAME_WI], "PED05|55#10D_a"), null);
  assert.equal(frameFor(["https://arion.co.nz/Images/banner.swf"], "PED01|I#3S_a"), null);
  assert.equal(frameFor([], "PED01|I#3S_a"), null);
});

test("a saved report, with no menu id, takes the last report frame there is", () => {
  assert.equal(frameFor(["https://arion.co.nz/Images/banner.swf", FRAME_WI], null), FRAME_WI);
  assert.equal(frameFor(["not a url"], null), null);
});

test("a 404 is looked at once more, and still a 404 is said, not hidden", async () => {
  const f = { kind: "pdf", name: "Horse_Pedigreesreport-5_1.pdf", url: "https://arion.co.nz/files/reports/Horse_Pedigreesreport-5_1.pdf" };
  let asked = 0;
  const page = {
    request: {
      get: async () => {
        asked += 1;
        return { ok: () => false, status: () => 404, headers: () => ({ "content-type": "text/html" }), body: async () => Buffer.from("") };
      },
    },
  };
  const [got] = await fetchFiles(page, [f], { retryMs: 1 });
  assert.equal(asked, 2);
  assert.equal(got.body, undefined);
  assert.equal(got.status, 404);
});

test("a file written a moment late is still had", async () => {
  const f = { kind: "pdf", name: "Horse_Pedigreesreport-3_1.pdf", url: "https://arion.co.nz/files/reports/Horse_Pedigreesreport-3_1.pdf" };
  let asked = 0;
  const page = {
    request: {
      get: async () => {
        asked += 1;
        return asked === 1
          ? { ok: () => false, status: () => 404, headers: () => ({}), body: async () => Buffer.from("") }
          : { ok: () => true, status: () => 200, headers: () => ({ "content-type": "application/pdf" }), body: async () => Buffer.from("%PDF") };
      },
    },
  };
  const [got] = await fetchFiles(page, [f], { retryMs: 1 });
  assert.equal(got.body.toString(), "%PDF");
});
