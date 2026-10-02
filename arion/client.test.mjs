import test from "node:test";
import assert from "node:assert/strict";

import {
  ArionError,
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
} from "./client.mjs";

/* Pages shaped like Arion's (ASP.NET WebForms), written for the tests. */

const hidden = (name, value = "") => `<input type="hidden" name="${name}" id="${name.replace(/\$/g, "_")}" value="${value}" />`;
const STATE = [hidden("__EVENTTARGET"), hidden("__EVENTARGUMENT"), hidden("__VIEWSTATE", "vs1"), hidden("__EVENTVALIDATION", "ev1")].join("");
const LOGIN_TOP = `<input name="ctl00$LoginTop$UserName" type="text" /><input name="ctl00$LoginTop$Password" type="password" /><input type="submit" name="ctl00$LoginTop$btnLoginDefault" value="" />`;
const PRICES = `
  <table><tr><td class="name"><span class='childProduct'>WI style</span></td><td class="detail">Inglis</td><td class="cost">40</td></tr>
  <tr><td class="name"><span class='childProduct'>Standard pedigree</span></td><td class="detail">Std</td><td class="cost">36</td></tr>
  <tr><td class="name"><span class='childProduct'>4x4</span></td><td class="detail">Grid</td><td class="cost">1</td></tr></table>`;
const reportsPage = ({ loggedIn = true, extra = "", menu = "PED01|I#3S_a" } = {}) => `<!DOCTYPE html><html><head><title>Arion</title></head><body>
<form method="post" action="PedigreeReports.aspx" id="aspnetForm">${STATE}
${loggedIn ? '<a href="/Logout.aspx">Logout</a>' : LOGIN_TOP}
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
const LOGIN_PAGE = (failure = "") => `<html><body><form method="post" action="Login.aspx?ReturnUrl=%2fPedigreeReports%2fPedigreeReports.aspx" id="aspnetForm">${STATE}
${LOGIN_TOP}
<input name="ctl00$MainContentArea$lvLogin$Login1$UserName" type="text" />
<input name="ctl00$MainContentArea$lvLogin$Login1$Password" type="password" />
<input type="submit" name="ctl00$MainContentArea$lvLogin$Login1$btnLoginDefault" value="" />
${failure ? `<span id="ctl00_MainContentArea_lvLogin_Login1_FailureText">${failure}</span>` : ""}
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

function fakeArion({ password = "s3cret", menuNeedsConfirm = true } = {}) {
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
      if (form["ctl00$MainContentArea$lvLogin$Login1$Password"] !== password) return res(200, LOGIN_PAGE("Your login attempt was not successful."));
      sessionOk = true;
      return res(302, "", { location: "/PedigreeReports/PedigreeReports.aspx", "set-cookie": ".ASPXAUTH=tok; path=/; HttpOnly" });
    }
    if (u.pathname === "/PedigreeReports/PedigreeReports.aspx") {
      if (!sessionOk || !/\.ASPXAUTH=tok/.test(cookie)) return res(200, reportsPage({ loggedIn: false }));
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

test("search, choose, confirm the price, and read the report — a search never names a report", async () => {
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
  await assert.rejects(c.report({ token: found.candidates[0].token, reportId: wi.id, credits: 40 }), (e) => e.code === "confirm" && e.status === 402);
  await assert.rejects(c.report({ token: found.candidates[0].token, reportId: wi.id, credits: 35, confirm: true }), (e) => e.code === "confirm");
  const before = arion.calls.length;
  assert.equal(arion.calls.length, before, "a refused order asks nothing of Arion");

  const bought = await c.report({ token: found.candidates[0].token, reportId: wi.id, credits: 40, confirm: true });
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
  await assert.rejects(c.report({ token: found.candidates[0].token, reportId: wi.id, credits: 40, confirm: true }), (e) => e.code === "expired", "a choice buys once");
});

test("the day's ceiling holds", async () => {
  const arion = fakeArion({ menuNeedsConfirm: false });
  const c = createClient({ fetch: arion.fetch, env: { ...ENV, ARION_DAILY_LIMIT: "1" } });
  const found = await c.search({ name: "Frankel" });
  const grid = c.status().reports.find((r) => r.label === "4x4");
  await c.report({ token: found.candidates[0].token, reportId: grid.id, credits: 1, confirm: true });
  await assert.rejects(c.report({ token: found.candidates[1].token, reportId: grid.id, credits: 1, confirm: true }), (e) => e.code === "limit" && e.status === 429);
});

test("a theoretical horse has no list: the search is repeated with the report named", async () => {
  const arion = fakeArion();
  const c = createClient({ fetch: arion.fetch, env: ENV });
  const found = await c.search({ kind: "theoretical", sire: "Frankel", dam: "Enable" });
  assert.equal(found.candidates.length, 0);
  assert.ok(found.direct?.token);
  const std = c.status().reports.find((r) => r.label === "Standard pedigree");
  assert.equal(std.credits, 36, "priced from the page");
  const bought = await c.report({ token: found.direct.token, reportId: std.id, credits: 36, confirm: true });
  const posts = arion.calls.filter((x) => x.form?.["ctl00$MainContentArea$txtSireName"] === "Frankel");
  assert.equal(posts.length, 2);
  assert.equal(posts[0].form["ctl00$MainContentArea$hiddenMenuItemId"], "");
  assert.equal(posts[1].form["ctl00$MainContentArea$hiddenMenuItemId"], std.id);
  assert.equal(bought.files.length, 2);
  await assert.rejects(c.search({ kind: "theoretical", sire: "Frankel" }), (e) => e.code === "input" && e.status === 400);
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
