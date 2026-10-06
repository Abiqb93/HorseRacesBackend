import test from "node:test";
import assert from "node:assert/strict";

import {
  ArionError,
  LOGIN_PAUSE_MS,
  REPORTS,
  asksForLogin,
  createClient,
  describePage,
  isChallenge,
  loginFailure,
  parseCandidates,
  parseForm,
  parseMyReports,
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

test("My Reports: each row, opened by a link or a postback", () => {
  const rows = parseMyReports(reportsPage());
  assert.equal(rows.length, 2);
  assert.equal(rows[0].label, "FRANKEL (GB) 2008 · WI style · Open");
  assert.equal(rows[0].url, "https://arion.co.nz/Reports/Saved/abc.pdf");
  assert.equal(rows[1].target, "ctl00$MainContentArea$gvMy");
  assert.equal(rows[1].argument, "Open$1");
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
  await assert.rejects(c.search({ name: "Frankel" }), (e) => e instanceof ArionError && e.code === "unconfigured" && e.status === 503);
  assert.equal(arion.calls.length, 0);
});

test("a refused login says so, and the password goes nowhere but the login form", async () => {
  const arion = fakeArion({ password: "other" });
  const c = createClient({ fetch: arion.fetch, env: ENV });
  await assert.rejects(c.search({ name: "Frankel" }), (e) => e.code === "login" && e.status === 401 && /not successful/.test(e.message) && !e.message.includes("s3cret"));
  const carrying = arion.calls.filter((x) => JSON.stringify(x).includes("s3cret"));
  assert.equal(carrying.length, 1);
  assert.equal(carrying[0].path.split("?")[0], "/Login.aspx");
});

test("search, choose, and read the report — a search never names a report", async () => {
  const arion = fakeArion();
  const c = createClient({ fetch: arion.fetch, env: ENV });
  const found = await c.search({ kind: "named", name: "Frankel" });
  assert.equal(found.candidates.length, 2);
  assert.match(found.candidates[0].label, /^FRANKEL \(GB\)/);
  const searchPost = arion.calls.find((x) => x.form?.["ctl00$MainContentArea$txtNamedHorse"] === "Frankel");
  assert.equal(searchPost.form["ctl00$MainContentArea$hiddenMenuItemId"], "", "the search posts no report, so it cannot buy one");
  assert.match(searchPost.cookie, /ASP\.NET_SessionId=abc/);
  assert.match(searchPost.cookie, /\.ASPXAUTH=tok/);
  assert.equal(c.status().loggedIn, true);

  const wi = c.status().reports.find((r) => r.label === "WI style");
  // No price to confirm: the desk's subscription is not metered, so a report
  // is made on asking. An unknown report is still refused, and still without
  // troubling Arion.
  const before = arion.calls.length;
  await assert.rejects(c.report({ token: found.candidates[0].token, reportId: "no-such-report" }), (e) => e.code === "input" && e.status === 400);
  assert.equal(arion.calls.length, before, "a refused order asks nothing of Arion");

  const bought = await c.report({ token: found.candidates[0].token, reportId: wi.id });
  const pick = arion.calls.find((x) => /gvHorses$/.test(x.form?.__EVENTTARGET ?? ""));
  assert.equal(pick.form.__EVENTARGUMENT, "Select$0");
  assert.equal(pick.form["ctl00$MainContentArea$hiddenMenuItemId"], wi.id);
  assert.ok(arion.calls.some((x) => x.form?.__EVENTTARGET === "ctl00$btnYes"), "Arion's own are-you-sure is answered");
  assert.equal(bought.report.credits, 40);
  assert.equal(bought.horse, "FRANKEL (GB)");
  assert.deepEqual(bought.files.map((f) => f.kind), ["print", "html"]);
  assert.equal(c.status().usedToday, 1);

  const pdf = await c.file(bought.files[0].id);
  assert.equal(pdf.type, "application/pdf");
  assert.equal(pdf.body.toString(), "%PDF-1.4 r1", "the print page is followed to the report it frames");
  await assert.rejects(c.file("nope"), (e) => e.status === 404);
  await assert.rejects(c.report({ token: found.candidates[0].token, reportId: wi.id }), (e) => e.code === "expired", "a choice buys once");
});

// Not a credit cap — nothing is metered. It stops something retrying in a
// loop against someone else's site, so the message says so.
test("the day's ceiling stops a loop, and says that is what it is", async () => {
  const arion = fakeArion({ menuNeedsConfirm: false });
  const c = createClient({ fetch: arion.fetch, env: { ...ENV, ARION_DAILY_LIMIT: "1" } });
  const found = await c.search({ name: "Frankel" });
  const grid = c.status().reports.find((r) => r.label === "4x4");
  await c.report({ token: found.candidates[0].token, reportId: grid.id });
  await assert.rejects(
    c.report({ token: found.candidates[1].token, reportId: grid.id }),
    (e) => e.code === "limit" && e.status === 429 && /loop/.test(e.message) && !/credit/i.test(e.message),
  );
});

test("the ceiling sits far above a day's work unless it is set", () => {
  const c = createClient({ fetch: fakeArion().fetch, env: ENV });
  assert.equal(c.status().dailyLimit, 200);
});

// This test used to assert the opposite: that a search returning no list was a
// horse so unambiguous Arion needed no choice, and that the token it handed
// back could be spent. On the live site no search returns a list at all — the
// results arrive in a dialog this transport never opens — so every search took
// that branch and every mating the page offered to build was a guess worth 35
// to 45 credits. A search that comes back without a list now sells nobody.
test("a search Arion did not answer with a list sells nobody", async () => {
  const arion = fakeArion();
  const c = createClient({ fetch: arion.fetch, env: ENV });
  const found = await c.search({ kind: "theoretical", sire: "Frankel", dam: "Enable" });
  assert.equal(found.candidates.length, 0);
  assert.equal(found.found, false);
  assert.equal(found.reason, "unconfirmed");
  assert.equal(found.direct, undefined, "no token: there is nothing here to buy");
  assert.ok(found.text, "but it still says what came back, so the page can show it");
  // the search itself still happened, and still posted an empty report menu,
  // so nothing was ordered on Arion's side either
  const posts = arion.calls.filter((x) => x.form?.["ctl00$MainContentArea$txtSireName"] === "Frankel");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].form["ctl00$MainContentArea$hiddenMenuItemId"], "");
  await assert.rejects(c.search({ kind: "theoretical", sire: "Frankel" }), (e) => e.code === "input" && e.status === 400);
});

test("a token from My Reports cannot be spent again", async () => {
  const arion = fakeArion();
  const c = createClient({ fetch: arion.fetch, env: ENV });
  const mine = await c.myReports();
  const saved = mine.find((row) => row.open?.token);
  assert.ok(saved, "one of the fixture's rows opens by postback");
  const std = c.status().reports.find((r) => r.label === "Standard pedigree");
  await assert.rejects(
    c.report({ token: saved.open.token, reportId: std.id }),
    (e) => e.code === "input" && e.status === 400,
  );
  // and it still opens, which is all it was ever for
  assert.ok(await c.openSaved(saved.open.token));
});

test("the day's count survives a restart when a store keeps it", async () => {
  const kept = { date: new Date().toISOString().slice(0, 10), count: 2 };
  const store = { read: async () => kept, write: async (v) => Object.assign(kept, v) };
  const arion = fakeArion();
  const c = createClient({ fetch: arion.fetch, env: { ...ENV, ARION_DAILY_LIMIT: "3" }, store });
  const found = await c.search({ kind: "named", name: "Frankel" });
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
  const arion = fakeArion();
  const c = createClient({ fetch: arion.fetch, env: { ...ENV, ARION_DAILY_LIMIT: "1" }, store, log: (m) => said.push(m) });
  const found = await c.search({ kind: "named", name: "Frankel" });
  const grid = c.status().reports.find((r) => r.label === "Standard pedigree");
  await c.report({ token: found.candidates[0].token, reportId: grid.id });
  await assert.rejects(
    c.report({ token: found.candidates[1].token, reportId: grid.id }),
    (e) => e.code === "limit" && e.status === 429,
    "the limit is loosened to this process's tally, never removed",
  );
  assert.ok(said.some((m) => /count could not be read/.test(m)), "and it says so");
});

test("My Reports: links open directly, postbacks through the page", async () => {
  const arion = fakeArion();
  const c = createClient({ fetch: arion.fetch, env: ENV });
  const rows = await c.myReports();
  assert.equal(rows.length, 2);
  const direct = await c.file(rows[0].open.file.id);
  assert.equal(direct.body.toString(), "%PDF-1.4 abc");
  const opened = await c.openSaved(rows[1].open.token);
  assert.equal(opened.files.length, 2);
});

test("a session that has timed out is logged in again, once", async () => {
  const arion = fakeArion();
  const c = createClient({ fetch: arion.fetch, env: ENV });
  await c.check();
  arion.expire();
  const found = await c.search({ name: "Frankel" });
  assert.equal(found.candidates.length, 2);
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
    c.search({ name: "Frankel" }),
    (e) => e.code === "login" && e.status === 401 && /"Your login attempt was not successful\. Please try again\."/.test(e.message) && /until 14:15 UTC/.test(e.message),
  );
  assert.equal(loginPosts(arion).length, 1);
  assert.equal(c.status().loginPausedUntil, "2026-10-02T14:15:00.000Z");
  t += 5 * 60 * 1000;
  await assert.rejects(c.search({ name: "Frankel" }), (e) => e.code === "login" && /not successful/.test(e.message) && /until 14:15 UTC/.test(e.message));
  await assert.rejects(c.check(), (e) => e.code === "login");
  assert.equal(loginPosts(arion).length, 1, "nothing goes to Arion while the login waits");
  t += LOGIN_PAUSE_MS;
  assert.equal(c.status().loginPausedUntil, null);
  await assert.rejects(c.search({ name: "Frankel" }), (e) => e.code === "login");
  assert.equal(loginPosts(arion).length, 2, "after the wait, one more try");
});

test("a username that is not an email address is not sent: Arion logs in by email", async () => {
  for (const [ARION_USERNAME, said] of [["desk", /email address/], ['"desk@example.com"', /quotes/]]) {
    const arion = fakeArion();
    const c = createClient({ fetch: arion.fetch, env: { ...ENV, ARION_USERNAME } });
    await assert.rejects(c.search({ name: "Frankel" }), (e) => e.code === "login" && said.test(e.message) && /Nothing was sent/.test(e.message));
    assert.equal(arion.calls.length, 0);
  }
});

test("a password with a stray space is pointed out, and never shown", async () => {
  const arion = fakeArion();
  const c = createClient({ fetch: arion.fetch, env: { ...ENV, ARION_PASSWORD: "s3cret " } });
  await assert.rejects(c.search({ name: "Frankel" }), (e) => e.code === "login" && /begins or ends with a space/.test(e.message) && !e.message.includes("s3cret"));
});

test("a login Arion takes, on a page that still shows no one logged in, is told apart from a refusal", async () => {
  const arion = fakeArion({ staysAnonymous: true });
  const c = createClient({ fetch: arion.fetch, env: ENV });
  await assert.rejects(
    c.search({ name: "Frankel" }),
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
