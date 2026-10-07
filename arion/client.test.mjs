import test from "node:test";
import assert from "node:assert/strict";

import {
  ArionError,
  LOGIN_PAUSE_MS,
  REPORTS,
  asksForLogin,
  createClient,
  decodeHtml,
  describePage,
  isChallenge,
  loginFailure,
  parseCandidates,
  parseForm,
  parsePrices,
  parseReportFiles,
  pricedReports,
  printFrame,
  relayHtml,
  showsLoggedIn,
} from "./client.mjs";

/* Pages shaped like Arion's (ASP.NET WebForms), written for the tests. */

const hidden = (name, value = "") => `<input type="hidden" name="${name}" id="${name.replace(/\$/g, "_")}" value="${value}" />`;
const STATE = [hidden("__EVENTTARGET"), hidden("__EVENTARGUMENT"), hidden("__VIEWSTATE", "vs1"), hidden("__EVENTVALIDATION", "ev1")].join("");
// Every page's header: a login-status panel (empty when no one is logged in)
// and a login box, which Arion may show even to someone logged in.
const STATUS = (who = "") =>
  `<div id="ctl00_ucArionLoginStatus_updArionLoginStatus">${who ? `<span>Welcome ${who}</span> <a id="ctl00_ucArionLoginStatus_lnkLogout" href="javascript:__doPostBack('ctl00$ucArionLoginStatus$lnkLogout','')">Logout</a>` : ""}</div>`;
const LOGIN_TOP = `<table id="ctl00_LoginTop"><tr><td><div id="ctl00_LoginTop_pnlLogin" style="display:none;">
  <input name="ctl00$LoginTop$UserName" type="text" /><input name="ctl00$LoginTop$Password" type="password" />
  <div class="row error"><span id="ctl00_LoginTop_FailureText"></span></div>
  <input type="submit" name="ctl00$LoginTop$btnLoginDefault" value="" /></div></td></tr></table>`;
const HEADER = (who = "") => `${who ? "" : `<a id="ctl00_btnLogin" href="javascript:__doPostBack('ctl00$btnLogin','')">Login</a>`}${STATUS(who)}${LOGIN_TOP}`;
const PRICES = `
  <table><tr><td class="name"><span class='childProduct'>WI style</span></td><td class="detail">Inglis</td><td class="cost">40</td></tr>
  <tr><td class="name"><span class='childProduct'>Standard pedigree</span></td><td class="detail">Std</td><td class="cost">36</td></tr>
  <tr><td class="name"><span class='childProduct'>4x4</span></td><td class="detail">Grid</td><td class="cost">1</td></tr></table>`;
const reportsPage = ({ loggedIn = true, extra = "", menu = "PED01|I#3S_a" } = {}) => `<!DOCTYPE html><html><head><title>Arion</title></head><body>
<form method="post" action="PedigreeReports.aspx" id="aspnetForm">${STATE}
${HEADER(loggedIn ? "Desk" : "")}
${hidden("ctl00$MainContentArea$hiddenMenuItemId", menu)}
<input name="ctl00$MainContentArea$txtNamedHorse" type="text" />
<input type="submit" name="ctl00$MainContentArea$btnSearchNamedHorseDefault" value="" />
<input name="ctl00$MainContentArea$txtSireName" type="text" /><input name="ctl00$MainContentArea$txtDamName" type="text" />
<input type="submit" name="ctl00$MainContentArea$btnSearchDamHorseDefault" value="" />
<input type="checkbox" name="ctl00$Remember" /><input type="checkbox" name="ctl00$Keep" checked="checked" value="yes" />
<select name="ctl00$Country"><option value="NZ">NZ</option><option value="GB" selected>GB</option></select>
${PRICES}
<div id="ctl00_MainContentArea_tabbedReport_tabs_TabMyReports"><table>
  <tr><th>Horse</th><th>Report</th></tr>
  <tr><td>FRANKEL (GB) 2008</td><td>WI style</td><td><a href="/Reports/Saved/abc.pdf">Open</a></td></tr>
  <tr><td>ENABLE (GB) 2014</td><td>4x4</td><td><a href="javascript:__doPostBack('ctl00$MainContentArea$gvMy','Open$1')">Open</a></td></tr>
</table></div>
${extra}
</form></body></html>`;
const SEARCH_DIALOG = `<div id="ctl00_ModalDialogArea_ArionNamedHorseSearchControl_pnl"><table>
  <tr><th>Name</th><th>Year</th></tr>
  <tr><td>FRANKEL (GB)</td><td>2008</td><td>Galileo - Kind</td><td><a href="javascript:__doPostBack('ctl00$ModalDialogArea$ArionNamedHorseSearchControl$gvHorses','Select$0')">Select</a></td></tr>
  <tr><td>FRANKEL (AUS)</td><td>1999</td><td><a href="javascript:WebForm_DoPostBackWithOptions(new WebForm_PostBackOptions(&quot;ctl00$ModalDialogArea$ArionNamedHorseSearchControl$gvHorses&quot;, &quot;Select$1&quot;, true, &quot;&quot;, &quot;&quot;, false, true))">Select</a></td></tr>
  <tr><td><a href="javascript:__doPostBack('ctl00$ModalDialogArea$ArionNamedHorseSearchControl$lnkClose','')">Close</a></td></tr>
</table></div>`;
const CONFIRM = `<div class="modal"><span>This report will cost 40 credits.</span>
  <a href="javascript:__doPostBack('ctl00$btnYes','')">Yes</a><a href="javascript:__doPostBack('ctl00$btnNo','')">No</a></div>`;
const FILLED_TAB = `<div id="ctl00_MainContentArea_tabbedReport_tabs_TabHorseReport1">
  <span id="__tab_ctl00_MainContentArea_tabbedReport_tabs_TabHorseReport1">FRANKEL - WI style</span>
  <a id="ctl00_MainContentArea_tabbedReport_tabs_TabHorseReport1_ctl01_ucArionReportContainerControl1_hlSaveAsHtml" href="/Reports/Temp/r1.html" target="_blank">Save As HTML</a>
  ${hidden("ctl00$MainContentArea$tabbedReport$tabs$TabHorseReport1$ctl01$ucArionReportContainerControl1$hdnReportFileName", "r1.pdf")}
  <iframe id="ctl00_MainContentArea_tabbedReport_tabs_TabHorseReport1_ctl01_reportFrame1" src="https://evil.example/x.pdf"></iframe>
</div>`;
// Arion's login page as it is: the header (whose empty failure box comes
// first), then the page's own form, which asks for an email address and is
// sent by its Log In link; the error line is plain text in a div.
const LOGIN_PAGE = (failure = "", { emailShown = false } = {}) => `<html><body><form method="post" action="Login.aspx?ReturnUrl=%2fPedigreeReports%2fPedigreeReports.aspx" id="aspnetForm">${STATE}
${HEADER()}
<table id="ctl00_MainContentArea_lvLogin_Login1" class="loginCtl"><tr><td><div id="ctl00_MainContentArea_lvLogin_Login1_pnlLoginPage">
<label for="ctl00_MainContentArea_lvLogin_Login1_UserName">Email Address:</label>
<input name="ctl00$MainContentArea$lvLogin$Login1$UserName" type="text" maxlength="256" />
<span id="ctl00_MainContentArea_lvLogin_Login1_UserNameRequired" title="User Name is required." style="color:Red;visibility:hidden;">*</span>
<span id="ctl00_MainContentArea_lvLogin_Login1_revEmailAddress" style="color:Red;${emailShown ? "" : "display:none;"}">Invalid Email Address</span>
<input name="ctl00$MainContentArea$lvLogin$Login1$Password" type="password" />
<span id="ctl00_MainContentArea_lvLogin_Login1_PasswordRequired" title="Password is required." style="color:Red;visibility:hidden;">*</span>
<input id="ctl00_MainContentArea_lvLogin_Login1_RememberMe" type="checkbox" name="ctl00$MainContentArea$lvLogin$Login1$RememberMe" />
<div class="p error">${failure}</div>
<a id="ctl00_MainContentArea_lvLogin_Login1_LoginButton" href="javascript:WebForm_DoPostBackWithOptions(new WebForm_PostBackOptions(&quot;ctl00$MainContentArea$lvLogin$Login1$LoginButton&quot;, &quot;&quot;, true, &quot;Login1&quot;, &quot;&quot;, false, true))">Log In</a>
<input type="submit" name="ctl00$MainContentArea$lvLogin$Login1$btnLoginDefault" value="" style="display:none" />
</div></td></tr></table>
</form></body></html>`;

/* ------------------------------------------------------------ the parsers */


/* ------------------------------------------------------------------------ */
/* Arion in a browser, stood in for.                                         */
/*                                                                           */
/* The seam is the two calls the client makes — searchHorses and makeReport  */
/* — and the horses are the ones a live run of /api/arion/browser-check      */
/* actually returned for "Starspangledbanner". Two of that name, which is    */
/* the whole reason the client carries a year and a country.                 */
/* ------------------------------------------------------------------------ */
const { pickCandidate } = await import("./browser.mjs");

const LIVE_HORSES = [
  { name: "Starspangledbanner", country: "SAF", year: 2008, sire: "Indigo Magic", dam: "Enchanting Queen", sex: null,
    link: "grid_ctl02_lnkHorseName", label: "Starspangledbanner (SAF) 2008", cells: ["Starspangledbanner", "SAF", "2008"] },
  { name: "Starspangledbanner", country: "AUS", year: 2006, sire: "Choisir", dam: "Gold Anthem", sex: "S",
    link: "grid_ctl03_lnkHorseName", label: "Starspangledbanner (AUS) 2006", cells: ["Starspangledbanner", "AUS", "2006"] },
];
const LIVE_FILES = [
  { kind: "pdf", name: "Starspangledbanner_Pedigreesreport-3_1343.pdf", url: "https://arion.co.nz/files/reports/Starspangledbanner_Pedigreesreport-3_1343.pdf" },
  { kind: "rtf", name: "Starspangledbanner_Pedigreesreport-3_1343.rtf", url: "https://arion.co.nz/files/reports/Starspangledbanner_Pedigreesreport-3_1343.rtf" },
];

const LIVE_DAMS = [
  { name: "Lady Vivian", country: "IRE", year: 2022, sire: "Camelot", dam: "Ceol an Ghra", sex: "R",
    link: "grid_ctl02_lnkHorseName", label: "Lady Vivian (IRE) 2022", cells: ["Lady Vivian", "IRE", "2022"] },
  { name: "Lady Vivian", country: "FR", year: 2014, sire: "Born to Sea", dam: "Lilac Moon", sex: "M",
    link: "grid_ctl03_lnkHorseName", label: "Lady Vivian (FR) 2014", cells: ["Lady Vivian", "FR", "2014"] },
];

// Two rows as a live run read them off gvMyReport, which the old parser
// reported as an empty list while the account held seventeen pages.
const LIVE_MINE = [
  { horse: "Starspangledbanner", type: "Catalogue Style Unedited", style: "WI style", expires: "06/11/2026",
    link: "gvMyReport_ctl02_lnkOpen", label: "Starspangledbanner · Catalogue Style Unedited · WI style" },
  { horse: "Con Te Partiro", type: "Research Document", style: null, expires: "06/11/2026",
    link: "gvMyReport_ctl03_lnkOpen", label: "Con Te Partiro · Research Document" },
];

function fakeBrowser({ horses = LIVE_HORSES, files = LIVE_FILES, menu = true, stage = "horse", sire = null, mine = LIVE_MINE, pages = 1, read = 1 } = {}) {
  const calls = [];
  const mod = {
    pickCandidate,
    searchHorses: async (args) => {
      calls.push({ searchHorses: args });
      return { stage, sire, candidates: horses };
    },
    makeReport: async (args) => {
      calls.push({ makeReport: args });
      return {
        chose: { chosen: menu },
        tabs: ["General", args.horse.name],
        horseId: "103364639",
        files: menu ? files : [],
        reused: false,
        steps: { check: 0, search: 1500, open: 4200, choose: 3100, files: 600 },
      };
    },
    warmSession: async (args) => {
      calls.push({ warmSession: args });
      return { warm: true, already: false };
    },
    listMyReports: async (args) => {
      calls.push({ listMyReports: args });
      return { rows: mine, pages, read };
    },
    openSavedReport: async (args) => {
      calls.push({ openSavedReport: args });
      if (!mine.some((r) => r.horse === args.report.horse && r.expires === args.report.expires)) {
        const e = new Error("gone from My Reports");
        e.code = "session";
        e.status = 409;
        throw e;
      }
      return { files, tabs: ["General", "My Reports"] };
    },
  };
  return { mod, calls, load: async () => mod };
}


test("the form as a browser posts it: hidden and text fields, checked boxes, chosen options, no buttons", () => {
  const { action, fields } = parseForm(reportsPage());
  assert.equal(action, "PedigreeReports.aspx");
  assert.equal(fields.__VIEWSTATE, "vs1");
  assert.equal(fields["ctl00$MainContentArea$hiddenMenuItemId"], "PED01|I#3S_a");
  assert.equal(fields["ctl00$MainContentArea$txtNamedHorse"], "");
  assert.equal(fields["ctl00$Keep"], "yes");
  assert.equal("ctl00$Remember" in fields, false, "an unchecked box is not sent");
  assert.equal(fields["ctl00$Country"], "GB");
  assert.equal("ctl00$MainContentArea$btnSearchNamedHorseDefault" in fields, false, "only the pressed button is sent");
});

test("the price list is read from the page, and stands in for the defaults", () => {
  const prices = parsePrices(reportsPage());
  assert.equal(prices.get("wi style"), 40);
  assert.equal(prices.get("standard pedigree"), 36);
  const priced = pricedReports(reportsPage());
  assert.equal(priced.find((r) => r.label === "Standard pedigree").credits, 36, "the page's price wins");
  assert.equal(priced.find((r) => r.label === "Tatts style").credits, 40, "a report the page does not price keeps its default");
  assert.equal(priced.length, REPORTS.length);
});

test("search results: each row with a postback is a choice; the dialog's own controls are not", () => {
  const c = parseCandidates(reportsPage({ extra: SEARCH_DIALOG }));
  assert.equal(c.length, 2);
  assert.equal(c[0].label, "FRANKEL (GB) · 2008 · Galileo - Kind · Select");
  assert.equal(c[0].target, "ctl00$ModalDialogArea$ArionNamedHorseSearchControl$gvHorses");
  assert.equal(c[0].argument, "Select$0");
  assert.equal(c[1].argument, "Select$1", "WebForm_PostBackOptions with entities is read too");
  assert.deepEqual(parseCandidates(reportsPage()), []);
});

test("a filled report tab names its files on Arion's host only", () => {
  const files = parseReportFiles(reportsPage({ extra: FILLED_TAB }));
  assert.deepEqual(
    files.map((f) => [f.kind, f.url, f.tab]),
    [
      ["print", "https://arion.co.nz/PrintReport.aspx?FileName=r1.pdf", 1],
      ["html", "https://arion.co.nz/Reports/Temp/r1.html", 1],
    ],
  );
});

test("login, refusal and Cloudflare are told apart", () => {
  assert.equal(asksForLogin(reportsPage({ loggedIn: false })), true);
  assert.equal(asksForLogin(reportsPage()), false);
  assert.equal(loginFailure(LOGIN_PAGE("Your login attempt was not successful.")), "Your login attempt was not successful.");
  assert.equal(isChallenge(403, "<title>Just a moment...</title>"), true);
  assert.equal(isChallenge(200, "<title>Just a moment...</title>"), false);
});

test("the header's login box is no prompt when someone is shown logged in; the form's reason is found behind the header's empty one", () => {
  assert.equal(showsLoggedIn(reportsPage()), true);
  assert.equal(showsLoggedIn(reportsPage({ loggedIn: false })), false);
  assert.equal(showsLoggedIn(LOGIN_PAGE()), false);
  assert.equal(asksForLogin(LOGIN_PAGE()), true);
  assert.equal(loginFailure(LOGIN_PAGE()), null, "nothing is said before a try");
  assert.equal(loginFailure(LOGIN_PAGE("Your login attempt was not successful. Please try again.")), "Your login attempt was not successful. Please try again.");
  assert.equal(loginFailure(LOGIN_PAGE("", { emailShown: true })), "Invalid Email Address", "Arion's own email check");
});

test("the print page is followed to its report; relayed HTML keeps Arion's addresses and loses its scripts", () => {
  assert.equal(printFrame('<iframe id="printingFrame" onload="x()" src="/Reports/Temp/r1.pdf"></iframe>'), "/Reports/Temp/r1.pdf");
  assert.equal(printFrame('<iframe id="printingFrame" src=""></iframe>'), null);
  const out = relayHtml("<html><head><title>x</title><script>alert(1)</script></head><body><img src='/img/a.png'></body></html>", "https://arion.co.nz/Reports/Temp/r1.html");
  assert.match(out, /<head><base href="https:\/\/arion\.co\.nz\/Reports\/Temp\/">/);
  assert.doesNotMatch(out, /<script/);
});

test("a page's shape for checking, with no values and no password field", () => {
  const d = describePage(reportsPage({ loggedIn: false, extra: SEARCH_DIALOG }));
  assert.equal(d.loginForm, true);
  assert.ok(d.fields.includes("ctl00$MainContentArea$txtNamedHorse"));
  assert.ok(!d.fields.some((f) => /Password/i.test(f)));
  assert.ok(!JSON.stringify(d).includes("vs1"), "no field values");
  assert.equal(d.candidates.length, 2);
});

/* ------------------------------------------------------------ the flow, against a stand-in Arion */

function fakeArion({ password = "s3cret", menuNeedsConfirm = true, staysAnonymous = false } = {}) {
  const calls = [];
  let sessionOk = false;
  let expireOnce = false;
  const res = (status, body, headers = {}) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const form = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null;
    const cookie = init.headers?.Cookie ?? "";
    calls.push({ method: init.method ?? "GET", path: u.pathname + u.search, form, cookie });
    if (u.pathname === "/Login.aspx" && !form) return res(200, LOGIN_PAGE(), { "set-cookie": "ASP.NET_SessionId=abc; path=/; HttpOnly" });
    if (u.pathname === "/Login.aspx" && form) {
      // only the Log In link logs in, and the page's email check runs first
      if (form.__EVENTTARGET !== "ctl00$MainContentArea$lvLogin$Login1$LoginButton") return res(200, LOGIN_PAGE());
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form["ctl00$MainContentArea$lvLogin$Login1$UserName"] ?? "")) return res(200, LOGIN_PAGE("", { emailShown: true }));
      if (form["ctl00$MainContentArea$lvLogin$Login1$Password"] !== password) return res(200, LOGIN_PAGE("Your login attempt was not successful. Please try again."));
      sessionOk = true;
      return res(302, "", { location: "/PedigreeReports/PedigreeReports.aspx", "set-cookie": ".ASPXAUTH=tok; path=/; HttpOnly" });
    }
    if (u.pathname === "/PedigreeReports/PedigreeReports.aspx") {
      if (!sessionOk || !/\.ASPXAUTH=tok/.test(cookie) || staysAnonymous) return res(200, reportsPage({ loggedIn: false }));
      if (expireOnce) {
        expireOnce = false;
        sessionOk = false;
        return res(200, reportsPage({ loggedIn: false }));
      }
      if (!form) return res(200, reportsPage());
      if (form["ctl00$MainContentArea$btnSearchNamedHorseDefault"] !== undefined) return res(200, reportsPage({ extra: SEARCH_DIALOG, menu: form["ctl00$MainContentArea$hiddenMenuItemId"] }));
      if (form["ctl00$MainContentArea$btnSearchDamHorseDefault"] !== undefined) {
        // a theoretical horse: no list, the page is the choice; a report named with it is made
        return res(200, reportsPage({ extra: form["ctl00$MainContentArea$hiddenMenuItemId"] ? FILLED_TAB : "" }));
      }
      if (/gvHorses$/.test(form.__EVENTTARGET)) return res(200, reportsPage({ extra: menuNeedsConfirm ? CONFIRM : FILLED_TAB }));
      if (form.__EVENTTARGET === "ctl00$btnYes") return res(200, reportsPage({ extra: FILLED_TAB }));
      if (form.__EVENTTARGET === "ctl00$MainContentArea$gvMy") return res(200, reportsPage({ extra: FILLED_TAB }));
    }
    if (u.pathname === "/PrintReport.aspx") return res(200, '<html><body onload="printReport()"><iframe id="printingFrame" src="/Reports/Temp/r1.pdf"></iframe></body></html>');
    if (u.pathname === "/Reports/Temp/r1.pdf") return new Response(Buffer.from("%PDF-1.4 r1"), { status: 200, headers: { "content-type": "application/pdf" } });
    if (u.pathname === "/Reports/Saved/abc.pdf") return new Response(Buffer.from("%PDF-1.4 abc"), { status: 200, headers: { "content-type": "application/pdf" } });
    return res(404, "not found");
  };
  return { fetch, calls, expire: () => (expireOnce = true) };
}
const ENV = { ARION_USERNAME: "desk@example.com", ARION_PASSWORD: "s3cret" };

test("without the login set, nothing is asked of Arion", async () => {
  const arion = fakeArion();
  const c = createClient({ fetch: arion.fetch, env: {} });
  assert.equal(c.status().configured, false);
  await assert.rejects(c.check(), (e) => e instanceof ArionError && e.code === "unconfigured" && e.status === 503);
  assert.equal(arion.calls.length, 0);
});

test("a refused login says so, and the password goes nowhere but the login form", async () => {
  const arion = fakeArion({ password: "other" });
  const c = createClient({ fetch: arion.fetch, env: ENV });
  await assert.rejects(c.check(), (e) => e.code === "login" && e.status === 401 && /not successful/.test(e.message) && !e.message.includes("s3cret"));
  const carrying = arion.calls.filter((x) => JSON.stringify(x).includes("s3cret"));
  assert.equal(carrying.length, 1);
  assert.equal(carrying[0].path.split("?")[0], "/Login.aspx");
});

test("search hands back a token per horse, and says which one was meant", async () => {
  const browser = fakeBrowser();
  const c = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: browser.load });
  const found = await c.search({ kind: "named", name: "Starspangledbanner", year: 2006, country: "AUS" });

  assert.equal(found.found, true);
  assert.equal(found.candidates.length, 2, "both are offered; the desk still chooses");
  assert.equal(found.best, "Starspangledbanner (AUS) 2006", "and the one asked for is named");
  assert.deepEqual(found.candidates.map((x) => x.best), [false, true]);
  assert.deepEqual(browser.calls[0].searchHorses.kind, "named");
});

test("a report is made for the horse the token remembers, not for a control id", async () => {
  const browser = fakeBrowser();
  const c = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: browser.load });
  const found = await c.search({ kind: "named", name: "Starspangledbanner", year: 2006, country: "AUS" });
  const wi = c.status().reports.find((r) => r.label === "WI style");

  await assert.rejects(c.report({ token: found.candidates[1].token, reportId: "no-such-report" }), (e) => e.code === "input" && e.status === 400);

  const made = await c.report({ token: found.candidates[1].token, reportId: wi.id });
  const asked = browser.calls.find((x) => x.makeReport).makeReport;
  assert.deepEqual(
    { name: asked.horse.name, year: asked.horse.year, country: asked.horse.country },
    { name: "Starspangledbanner", year: 2006, country: "AUS" },
    "the horse travels by name, year and country — a link id from the last visit means nothing in the next",
  );
  assert.equal(asked.label, "WI style", "and the report is named as Arion's menu prints it");
  assert.equal(made.horse, "Starspangledbanner (AUS) 2006");
  assert.equal(made.horseId, "103364639", "Arion's own id for the horse is kept: a number is a horse, a name is not");
  assert.deepEqual(made.files.map((f) => f.kind), ["pdf", "rtf"]);
  assert.equal(made.note, null);
  assert.equal(c.status().usedToday, 1);

  await assert.rejects(c.report({ token: found.candidates[1].token, reportId: wi.id }), (e) => e.code === "expired", "a choice is spent once");
});

test("a report Arion built no file for says so, and says whether its menu knew the style", async () => {
  const browser = fakeBrowser({ menu: false });
  const c = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: browser.load });
  const found = await c.search({ kind: "named", name: "Starspangledbanner" });
  const wi = c.status().reports.find((r) => r.label === "WI style");
  const made = await c.report({ token: found.candidates[0].token, reportId: wi.id });
  assert.deepEqual(made.files, []);
  assert.match(made.note, /menu offers no "WI style"/);
  // nothing was built, so there is nothing under My Reports to look for
  assert.match(made.note, /Choose another report/);
});

test("a report built with no file to hand over says so, and points at Arion", async () => {
  const browser = fakeBrowser({ files: [] });
  const c = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: browser.load });
  const found = await c.search({ kind: "named", name: "Starspangledbanner" });
  const std = c.status().reports.find((r) => r.label === "Standard pedigree");
  const made = await c.report({ token: found.candidates[0].token, reportId: std.id });
  assert.deepEqual(made.files, []);
  assert.match(made.note, /no file/);
  assert.match(made.note, /Open it on Arion/);
});

test("a search Arion answered without a list sells nobody", async () => {
  // null is "Arion gave no dialog at all", which is not the same as an empty
  // one, and neither is a horse
  for (const [horses, reason] of [[null, "no-dialog"], [[], "none"]]) {
    const browser = fakeBrowser({ horses });
    const c = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: browser.load });
    const found = await c.search({ kind: "theoretical", sire: "Frankel", dam: "Enable" });
    assert.equal(found.found, false);
    assert.equal(found.reason, reason);
    assert.equal(found.candidates.length, 0);
    assert.equal(found.direct, undefined, "no token: there is nothing here to make");
    assert.ok(found.text, "but it still says what happened, so the page can show it");
  }
});

test("a token from My Reports cannot be spent on a new report", async () => {
  const arion = fakeArion();
  const c = createClient({ fetch: arion.fetch, env: ENV, loadBrowser: fakeBrowser().load });
  const { reports: mine } = await c.myReports();
  const saved = mine.find((row) => row.open?.token);
  assert.ok(saved, "every row of My Reports opens");
  const std = c.status().reports.find((r) => r.label === "Standard pedigree");
  await assert.rejects(
    c.report({ token: saved.open.token, reportId: std.id }),
    (e) => e.code === "input" && e.status === 400,
  );
  assert.ok(await c.openSaved(saved.open.token), "and it still opens, which is all it was ever for");
});

// Not a credit cap — nothing is metered. It stops something retrying in a
// loop against someone else's site, so the message says so.
test("the day's ceiling stops a loop, and says that is what it is", async () => {
  const c = createClient({ fetch: fakeArion().fetch, env: { ...ENV, ARION_DAILY_LIMIT: "1" }, loadBrowser: fakeBrowser().load });
  const found = await c.search({ kind: "named", name: "Starspangledbanner" });
  const grid = c.status().reports.find((r) => r.label === "4x4");
  await c.report({ token: found.candidates[0].token, reportId: grid.id });
  await assert.rejects(
    c.report({ token: found.candidates[1].token, reportId: grid.id }),
    (e) => e.code === "limit" && e.status === 429 && /loop/.test(e.message) && !/credit/i.test(e.message),
  );
});

test("the ceiling sits far above a day's work unless it is set", () => {
  assert.equal(createClient({ fetch: fakeArion().fetch, env: ENV }).status().dailyLimit, 200);
});

test("the day's count survives a restart when a store keeps it", async () => {
  const kept = { date: new Date().toISOString().slice(0, 10), count: 2 };
  const store = { read: async () => kept, write: async (v) => Object.assign(kept, v) };
  const c = createClient({ fetch: fakeArion().fetch, env: { ...ENV, ARION_DAILY_LIMIT: "3" }, store, loadBrowser: fakeBrowser().load });
  const found = await c.search({ kind: "named", name: "Starspangledbanner" });
  const grid = c.status().reports.find((r) => r.label === "Standard pedigree");
  await c.report({ token: found.candidates[0].token, reportId: grid.id });
  assert.equal(kept.count, 3, "the third of three went through and was written down");
  await assert.rejects(
    c.report({ token: found.candidates[1].token, reportId: grid.id }),
    (e) => e.code === "limit" && e.status === 429,
    "a fresh process does not get a fresh allowance",
  );
});

test("a store that cannot be read falls back to this process's own count", async () => {
  const store = { read: async () => { throw new Error("table is gone"); }, write: async () => {} };
  const said = [];
  const c = createClient({ fetch: fakeArion().fetch, env: { ...ENV, ARION_DAILY_LIMIT: "1" }, store, loadBrowser: fakeBrowser().load, log: (m) => said.push(m) });
  const found = await c.search({ kind: "named", name: "Starspangledbanner" });
  const grid = c.status().reports.find((r) => r.label === "Standard pedigree");
  await c.report({ token: found.candidates[0].token, reportId: grid.id });
  await assert.rejects(
    c.report({ token: found.candidates[1].token, reportId: grid.id }),
    (e) => e.code === "limit" && e.status === 429,
    "the limit is loosened to this process's tally, never removed",
  );
  assert.ok(said.some((m) => /count could not be read/.test(m)), "and it says so");
});

test("My Reports lists what the account has, and opens one by its columns", async () => {
  const browser = fakeBrowser();
  const c = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: browser.load });
  const got = await c.myReports();
  const rows = got.reports;
  assert.equal(rows.length, 2);
  assert.equal(got.complete, true, "one page of one, so the list is whole");
  assert.equal(rows[0].label, "Starspangledbanner · Catalogue Style Unedited · WI style");
  assert.deepEqual(rows[1].cells, ["Con Te Partiro", "Research Document", "06/11/2026"], "a style of '-' is no style");

  const opened = await c.openSaved(rows[0].open.token);
  assert.deepEqual(opened.files.map((f) => f.kind), ["pdf", "rtf"]);
  const asked = browser.calls.find((x) => x.openSavedReport).openSavedReport.report;
  assert.deepEqual(
    { horse: asked.horse, type: asked.type, style: asked.style, expires: asked.expires },
    { horse: "Starspangledbanner", type: "Catalogue Style Unedited", style: "WI style", expires: "06/11/2026" },
    "a report is found again by its four columns, not by a row id from the last visit",
  );
  await assert.rejects(c.openSaved(rows[0].open.token), (e) => e.code === "expired", "a token opens once");
});

test("a report that has left My Reports says so rather than opening something else", async () => {
  const browser = fakeBrowser();
  const c = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: browser.load });
  const { reports: rows } = await c.myReports();
  // it expired between the list and the open, which is what an expiry date is for
  browser.mod.listMyReports = async () => [];
  browser.mod.openSavedReport = async () => {
    const e = new Error("Starspangledbanner · Catalogue Style Unedited · WI style is no longer under My Reports; open the list again");
    e.code = "session";
    e.status = 409;
    throw e;
  };
  await assert.rejects(c.openSaved(rows[0].open.token), (e) => e.code === "session" && e.status === 409);
});

test("a session that has timed out is logged in again, once", async () => {
  const arion = fakeArion();
  const c = createClient({ fetch: arion.fetch, env: ENV });
  await c.check();
  arion.expire();
  await c.check();
  assert.equal(arion.calls.filter((x) => x.path.startsWith("/Login.aspx") && x.form).length, 2);
});

const loginPosts = (arion) => arion.calls.filter((x) => x.path.startsWith("/Login.aspx") && x.form);

test("the login is what a person does: the email address, the password, and Log In pressed", async () => {
  const arion = fakeArion();
  const c = createClient({ fetch: arion.fetch, env: { ...ENV, ARION_USERNAME: "  desk@example.com " } });
  await c.check();
  const [post] = loginPosts(arion);
  assert.equal(post.path, "/Login.aspx?ReturnUrl=%2fPedigreeReports%2fPedigreeReports.aspx", "posted where the page's form posts");
  assert.equal(post.form.__EVENTTARGET, "ctl00$MainContentArea$lvLogin$Login1$LoginButton");
  assert.equal(post.form.__EVENTARGUMENT, "");
  assert.equal("ctl00$MainContentArea$lvLogin$Login1$btnLoginDefault" in post.form, false, "Log In is pressed, not the hidden Enter button");
  assert.equal(post.form["ctl00$MainContentArea$lvLogin$Login1$UserName"], "desk@example.com", "spaces around the address are dropped");
  assert.equal(post.form["ctl00$LoginTop$Password"], "", "the header's box goes empty, as a browser sends it");
  assert.equal(c.status().loggedIn, true, "logged in, though the header still carries its login box");
});

test("Arion's reason for a refusal is passed on, and the login then waits, so retries cannot lock the account", async () => {
  let t = Date.parse("2026-10-02T14:00:00Z");
  const arion = fakeArion({ password: "other" });
  const c = createClient({ fetch: arion.fetch, env: ENV, now: () => t });
  await assert.rejects(
    c.check(),
    (e) => e.code === "login" && e.status === 401 && /"Your login attempt was not successful\. Please try again\."/.test(e.message) && /until 14:15 UTC/.test(e.message),
  );
  assert.equal(loginPosts(arion).length, 1);
  assert.equal(c.status().loginPausedUntil, "2026-10-02T14:15:00.000Z");
  t += 5 * 60 * 1000;
  await assert.rejects(c.check(), (e) => e.code === "login" && /not successful/.test(e.message) && /until 14:15 UTC/.test(e.message));
  await assert.rejects(c.check(), (e) => e.code === "login");
  assert.equal(loginPosts(arion).length, 1, "nothing goes to Arion while the login waits");
  t += LOGIN_PAUSE_MS;
  assert.equal(c.status().loginPausedUntil, null);
  await assert.rejects(c.check(), (e) => e.code === "login");
  assert.equal(loginPosts(arion).length, 2, "after the wait, one more try");
});

test("a username that is not an email address is not sent: Arion logs in by email", async () => {
  for (const [ARION_USERNAME, said] of [["desk", /email address/], ['"desk@example.com"', /quotes/]]) {
    const arion = fakeArion();
    const c = createClient({ fetch: arion.fetch, env: { ...ENV, ARION_USERNAME } });
    await assert.rejects(c.check(), (e) => e.code === "login" && said.test(e.message) && /Nothing was sent/.test(e.message));
    assert.equal(arion.calls.length, 0);
  }
});

test("a password with a stray space is pointed out, and never shown", async () => {
  const arion = fakeArion();
  const c = createClient({ fetch: arion.fetch, env: { ...ENV, ARION_PASSWORD: "s3cret " } });
  await assert.rejects(c.check(), (e) => e.code === "login" && /begins or ends with a space/.test(e.message) && !e.message.includes("s3cret"));
});

test("a login Arion takes, on a page that still shows no one logged in, is told apart from a refusal", async () => {
  const arion = fakeArion({ staysAnonymous: true });
  const c = createClient({ fetch: arion.fetch, env: ENV });
  await assert.rejects(
    c.check(),
    (e) => e.code === "login-shape" && e.status === 502 && /took the login \(it went on to \/PedigreeReports\/PedigreeReports\.aspx\)/.test(e.message),
  );
  assert.equal(loginPosts(arion).length, 1, "logged in once, not again on the spot");
  assert.equal(c.status().loginPausedUntil, null, "not a refusal, so no wait");
});

test("diagnose says why a login failed and what the page held, with no values", async () => {
  const arion = fakeArion({ password: "other" });
  const d = await createClient({ fetch: arion.fetch, env: ENV }).diagnose({ name: "" });
  assert.equal(d.login.ok, false);
  assert.equal(d.login.code, "login");
  assert.equal(d.login.page.loginForm, true);
  assert.match(d.login.page.text, /not successful/);
  assert.ok(!JSON.stringify(d).includes("s3cret") && !JSON.stringify(d).includes("vs1"));
  const ok = await createClient({ fetch: fakeArion().fetch, env: ENV }).diagnose({ name: "" });
  assert.deepEqual(ok.login, { ok: true, landed: "/PedigreeReports/PedigreeReports.aspx" });
});

test("a mating is a dialog in two steps: the sire first, then the mares", async () => {
  // Arion answers a sire x dam search with SIRES, and only once one is chosen
  // does it offer the dams. A list of sires is not a mating, and the mare's
  // year and country mean nothing against it.
  const atSire = fakeBrowser({ stage: "sire", horses: LIVE_HORSES });
  const c1 = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: atSire.load });
  const sires = await c1.search({ kind: "theoretical", sire: "Starspangledbanner", dam: "Lady Vivian", year: 2022, country: "IRE" });
  assert.equal(sires.stage, "sire");
  assert.equal(sires.best, null, "the mare's 2022 must not pick a stallion");
  assert.equal(sires.candidates.length, 2, "the desk is asked which sire is meant");

  // the sire settled, the same grid now holds the mares
  const settled = { ...LIVE_HORSES[1] };
  const atDam = fakeBrowser({ stage: "dam", sire: settled, horses: LIVE_DAMS });
  const c2 = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: atDam.load });
  const dams = await c2.search({ kind: "theoretical", sire: "Starspangledbanner", dam: "Lady Vivian", year: 2022, country: "IRE" });
  assert.equal(dams.stage, "dam");
  assert.equal(dams.sire, "Starspangledbanner (AUS) 2006");
  assert.equal(dams.best, "Lady Vivian (IRE) 2022", "here the mare's year and country are exactly what narrows it");

  const std = c2.status().reports.find((r) => r.label === "Standard pedigree");
  const made = await c2.report({ token: dams.candidates[0].token, reportId: std.id });
  const asked = atDam.calls.find((x) => x.makeReport).makeReport;
  assert.equal(asked.sire.name, "Starspangledbanner", "the settled sire is replayed, not searched for again");
  assert.equal(asked.horse.country, "IRE");
  assert.equal(made.horse, "Starspangledbanner (AUS) 2006 × Lady Vivian (IRE) 2022", "a mating is named as a mating");
  assert.equal(made.theoretical, true, "and is marked as a foal that does not exist");
  assert.match(made.files[0].label, /Starspangledbanner \(AUS\) 2006 × Lady Vivian \(IRE\) 2022/,
    "the file the desk keeps and sends on names both parents, not just the mare");
});

test("a list that did not reach the end of Arion's pager says so", async () => {
  // Two runs minutes apart once came back with 426 rows and 50, the second a
  // strict subset of the first, and nothing in either said which was whole.
  const said = [];
  const browser = fakeBrowser({ pages: 17, read: 2 });
  const c = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: browser.load, log: (m) => said.push(m) });
  const got = await c.myReports();
  assert.equal(got.complete, false);
  assert.equal(got.pages, 17);
  assert.equal(got.read, 2);
  assert.ok(got.reports.length, "what was read is still handed over");
  assert.ok(said.some((m) => /read 2 of 17 pages/.test(m)), "and it is written down");
});

test("a grid that is not there at all is not an account with nothing in it", async () => {
  const browser = fakeBrowser();
  browser.mod.listMyReports = async () => null;
  const c = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: browser.load });
  const got = await c.myReports();
  assert.deepEqual(got.reports, []);
  assert.equal(got.pages, 0);
  assert.equal(got.complete, false, "nothing was read, so nothing is claimed");
});

/* ------------------------------------------------ what is kept, and where */

/** The record as the server keeps it in MySQL, kept here in memory. */
function fakeArchive({ failSave = false } = {}) {
  const reports = [];
  const files = new Map();
  let seq = 0;
  return {
    reports,
    files,
    save: async ({ report, files: fs }) => {
      if (failSave) throw new Error("the database is down");
      let id = null;
      if (report) {
        id = (seq += 1);
        reports.unshift({ ...report, id, files: fs.map((f) => ({ id: f.id, kind: f.kind })) });
      }
      for (const f of fs) files.set(f.id, { ...f, report: id });
      return { id };
    },
    list: async ({ limit }) => reports.slice(0, limit),
    file: async (id) => files.get(id) ?? null,
  };
}

// The files as the session fetched them: the report's bytes, not its address.
const FETCHED = LIVE_FILES.map((f) => ({ ...f, type: f.kind === "pdf" ? "application/pdf" : "application/rtf", body: Buffer.from(`${f.kind} of the report`) }));

async function makeMating(c) {
  const found = await c.search({ kind: "theoretical", sire: "Starspangledbanner", dam: "Lady Vivian" });
  const std = c.status().reports.find((r) => r.label === "Standard pedigree");
  return c.report({ token: found.candidates[0].token, reportId: std.id, userId: "richardbrown1" });
}

test("a report made here is kept, under both parents' names, and listed newest first", async () => {
  const archive = fakeArchive();
  const browser = fakeBrowser({ horses: LIVE_DAMS, stage: "dam", sire: LIVE_HORSES[1], files: FETCHED });
  const c = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: browser.load, archive });
  const made = await makeMating(c);

  assert.equal(made.made.subject, "Starspangledbanner (AUS) 2006 × Lady Vivian (IRE) 2022");
  assert.equal(made.made.report, "Standard pedigree");
  assert.equal(made.made.by, "richardbrown1");
  assert.equal(made.made.theoretical, true);
  assert.deepEqual(made.made.files.map((f) => f.kind), ["pdf", "rtf"]);
  // the file the page opens now is the one the record keeps
  assert.deepEqual(made.made.files.map((f) => f.id), made.files.map((f) => f.id));
  // the browser was told which report, so it can tell its files from another build's
  assert.match(browser.calls.find((x) => x.makeReport).makeReport.reportId, /^PED02\|/);

  const { reports } = await c.made();
  assert.equal(reports.length, 1);
  assert.equal(reports[0].label, "Starspangledbanner (AUS) 2006 × Lady Vivian (IRE) 2022 · Standard pedigree");
});

test("a fetched file opens from this process, and from the record after a restart", async () => {
  const archive = fakeArchive();
  const browser = fakeBrowser({ files: FETCHED });
  const first = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: browser.load, archive });
  const made = await makeMating(first);
  const pdf = made.files.find((f) => f.kind === "pdf");

  const now = await first.file(pdf.id);
  assert.equal(now.type, "application/pdf");
  assert.equal(now.body.toString(), "pdf of the report");

  // a deploy: a new process, nothing in memory, the same database
  const after = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: browser.load, archive });
  const later = await after.file(pdf.id);
  assert.equal(later.body.toString(), "pdf of the report");
  assert.match(later.label, /Standard pedigree/);
  await assert.rejects(after.file("no-such-id"), (e) => e.status === 404 && e.code === "file");
});

test("a report the record could not keep is still handed over, and says it was not kept", async () => {
  const lines = [];
  const browser = fakeBrowser({ files: FETCHED });
  const c = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: browser.load, archive: fakeArchive({ failSave: true }), log: (l) => lines.push(l) });
  const made = await makeMating(c);
  assert.equal(made.files.length, 2);
  assert.equal(made.made, null);
  assert.ok(lines.some((l) => /not kept: the database is down/.test(l)));
});

test("a file Arion would not hand over is not kept as if it were", async () => {
  const archive = fakeArchive();
  // addresses only: the session could not fetch them
  const browser = fakeBrowser({ files: LIVE_FILES });
  const c = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: browser.load, archive });
  const made = await makeMating(c);
  assert.deepEqual(made.made.files, []);
  assert.equal(archive.files.size, 0);
});

test("without a record there is nothing listed, and it says so", async () => {
  const c = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: fakeBrowser().load });
  assert.deepEqual(await c.made(), { reports: [], kept: false });
});

test("the report says where its time went", async () => {
  const lines = [];
  const browser = fakeBrowser({ files: FETCHED });
  const c = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: browser.load, archive: fakeArchive(), log: (l) => lines.push(l) });
  const made = await makeMating(c);
  assert.equal(made.took.open, 4200);
  assert.ok(lines.some((l) => /report made: Standard pedigree .* — check 0\.0s, search 1\.5s, open 4\.2s, choose 3\.1s, files 0\.6s/.test(l)));
});

test("Arion's own list is walked once and answered from there until it is due again", async () => {
  let t = 1_000_000;
  const browser = fakeBrowser();
  const c = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: browser.load, now: () => t });
  const walks = () => browser.calls.filter((x) => x.listMyReports).length;

  // before any walk, a cached read answers at once, with nothing
  assert.equal((await c.myReports({ cached: true })).reports, null);
  assert.equal(walks(), 0);

  const first = await c.myReports();
  assert.equal(first.reports.length, 2);
  assert.equal(walks(), 1);
  assert.equal((await c.myReports()).reports.length, 2);
  assert.equal(walks(), 1, "the second load is answered from the kept list");
  assert.equal((await c.myReports({ cached: true })).at, first.at);

  await c.myReports({ fresh: true });
  assert.equal(walks(), 2, "asked for fresh, it walks again");

  t += 31 * 60 * 1000; // past LIST_TTL
  await c.myReports();
  assert.equal(walks(), 3);
});

test("a row answered from the kept list still opens, long after it was first listed", async () => {
  let t = 1_000_000;
  const browser = fakeBrowser();
  const c = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: browser.load, now: () => t });
  await c.myReports();
  t += 25 * 60 * 1000; // past the 20-minute life of a token
  const { reports } = await c.myReports({ cached: true });
  assert.ok(await c.openSaved(reports[0].open.token));
});

test("a short list is answered, saying it is short, but not kept", async () => {
  const browser = fakeBrowser({ pages: 18, read: 2 });
  const c = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: browser.load });
  assert.equal((await c.myReports()).complete, false);
  assert.equal((await c.myReports({ cached: true })).reports, null);
});

test("warming hands the browser its login and nothing else", async () => {
  const browser = fakeBrowser();
  const c = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: browser.load });
  assert.deepEqual(await c.warm(), { warm: true, already: false });
  assert.deepEqual(browser.calls.map((x) => Object.keys(x)[0]), ["warmSession"]);
});

test("a file kept in the record is not also held in memory, and still opens", async () => {
  const archive = fakeArchive();
  const reads = [];
  const real = archive.file;
  archive.file = async (id) => (reads.push(id), real(id));
  const c = createClient({ fetch: fakeArion().fetch, env: ENV, loadBrowser: fakeBrowser({ files: FETCHED }).load, archive });
  const made = await makeMating(c);
  const pdf = made.files.find((f) => f.kind === "pdf");
  assert.equal((await c.file(pdf.id)).body.toString(), "pdf of the report");
  assert.deepEqual(reads, [pdf.id], "read back from the record, not from memory");
});

test("an HTML report is read in the encoding it says it is in", () => {
  // Arion's Standard pedigree: ISO-8859-1 in a meta tag, a half as the byte 0xBD
  const page = Buffer.concat([
    Buffer.from('<html><head><META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=ISO-8859-1" /></head><body>2 wins at 12', "latin1"),
    Buffer.from([0xbd]),
    Buffer.from("f, 2d Sandown</body></html>", "latin1"),
  ]);
  assert.match(decodeHtml(page), /at 12½f, 2d Sandown/);
  assert.doesNotMatch(decodeHtml(page), /�/);
  // the Content-Type's charset wins over the page's own
  assert.match(decodeHtml(Buffer.from("<p>£5</p>", "utf8"), "text/html; charset=utf-8"), /£5/);
  // nothing said: UTF-8 if it is UTF-8, Windows-1252 if it is not
  assert.match(decodeHtml(Buffer.from("<p>€1</p>", "utf8")), /€1/);
  assert.match(decodeHtml(Buffer.from([0x3c, 0x70, 0x3e, 0x80, 0x31])), /€1/);
});
