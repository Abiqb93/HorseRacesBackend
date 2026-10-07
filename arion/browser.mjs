/**
 * Chromium for Arion.
 *
 * Arion is an ASP.NET WebForms site and its search results arrive in a modal
 * dialog that the page's own script opens. A scripted form post therefore gets
 * the unchanged page back, which the fetch client read as "Arion found
 * nothing" — for every search, including ones Arion certainly answers. A real
 * browser runs that script and can see the dialog.
 *
 * Nothing here is imported at boot. `playwright-core` is loaded on first use
 * and the browser binary is found at runtime, so a service with neither still
 * starts and serves every other route: only Arion goes dark, and it says why.
 * `playwright-core` is deliberate — it ships no browser of its own, so no
 * install step can block a deploy of the rest of the site.
 */

import { statSync } from "node:fs";

import { ArionError, LOGIN_PATH, ORIGIN, REPORTS_PATH } from "./client.mjs";

/** ASP.NET writes a control's name with $ and its id with _. */
export const idOf = (name) => `#${String(name).replace(/\$/g, "_")}`;

/**
 * Where Chromium might be. ARION_CHROMIUM_PATH wins, then the places a Nix or
 * Debian image leaves one; a miss is reported rather than guessed at, because
 * launching the wrong binary fails later and further from the cause.
 */
export const BROWSER_NAMES = ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"];
export const CHROMIUM_PATHS = [
  "/root/.nix-profile/bin/chromium",
  "/nix/var/nix/profiles/default/bin/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
];

export function pickChromium({ env = process.env, isExecutable, paths = CHROMIUM_PATHS } = {}) {
  const named = String(env.ARION_CHROMIUM_PATH ?? "").trim();
  if (named) return isExecutable(named) ? { path: named, from: "ARION_CHROMIUM_PATH" } : { path: null, from: "ARION_CHROMIUM_PATH", missing: named };
  // Nix puts its packages somewhere unpredictable and symlinks them onto PATH,
  // so PATH is searched as well as the usual fixed places.
  const onPath = String(env.PATH ?? "")
    .split(":")
    .filter(Boolean)
    .flatMap((dir) => BROWSER_NAMES.map((n) => `${dir.replace(/\/$/, "")}/${n}`));
  for (const p of [...paths, ...onPath]) if (isExecutable(p)) return { path: p, from: "the image" };
  // null means "let playwright-core look for its own", which works where a
  // browser was downloaded into PLAYWRIGHT_BROWSERS_PATH
  return { path: null, from: "playwright's own download" };
}

const executable = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Start the Chromium this image carries. */
export async function launchChromium({ env = process.env } = {}) {
  const chosen = pickChromium({ env, isExecutable: executable });
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    ...(chosen.path ? { executablePath: chosen.path } : {}),
    // Chromium runs as root in a container, where its sandbox cannot start
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  return { browser, chosen };
}

const VIEWPORT = { width: 1280, height: 900 };

/**
 * One Chromium, launched for one job and closed after it. The diagnostic's:
 * it must see Arion from cold, and must not disturb the browser jobs keep.
 */
export async function withBrowser(fn, { env = process.env, launch = launchChromium } = {}) {
  const { browser, chosen } = await launch({ env });
  try {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    return await fn(page, { chromium: chosen, version: browser.version() });
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * What a page holds, for checking this client against the live site: the ids
 * of anything that looks like a search dialog or a report grid, whether it is
 * on screen, and the rows inside it. Values of form fields are never read.
 */
export async function shapeOf(page) {
  return page.evaluate(() => {
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const c = getComputedStyle(el);
      return c.visibility !== "hidden" && c.display !== "none";
    };
    const words = (el) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
    const rowsOf = (el) =>
      [...el.querySelectorAll("tr")].slice(0, 15).map((tr) => ({
        cells: [...tr.querySelectorAll("td, th")].map(words).filter(Boolean).slice(0, 8),
        posts: [...tr.querySelectorAll("a[href*='PostBack'], input[type=radio], input[type=submit]")].map((a) => a.id || a.name || a.getAttribute("href")?.slice(0, 90)).slice(0, 4),
      }));

    // Where Arion puts an answer, whatever it calls the container: every table
    // on screen that has rows. Guessing a control's name is what made the
    // old parsers blind, so nothing is assumed about the id here.
    const tables = [...document.querySelectorAll("table")]
      .filter((t) => t.querySelectorAll("tr").length > 0)
      .slice(0, 14)
      .map((t) => ({
        id: t.id || null,
        within: t.closest("[id]")?.id ?? null,
        shown: shown(t),
        rows: t.querySelectorAll("tr").length,
        sample: rowsOf(t),
      }));

    // A modal backdrop means Arion answered with a dialog. Which one, and
    // what is in it.
    const modals = [...document.querySelectorAll('[class*="modal"], [class*="Modal"]')]
      .slice(0, 12)
      .map((el) => ({ id: el.id || null, cls: el.className, shown: shown(el), text: words(el).slice(0, 300) }));

    return {
      url: location.pathname,
      title: document.title,
      fields: [...document.querySelectorAll("input, select, textarea")].map((el) => el.id).filter(Boolean).slice(0, 60),
      loginShown: [...document.querySelectorAll('input[type="password"]')].some(shown),
      // the page as a person reads it: the one thing that says whether a
      // search resolved a horse
      text: words(document.body).slice(0, 2500),
      tables,
      modals,
    };
  });
}

/**
 * The report Arion has on screen: where its content is and how it is taken
 * away.
 *
 * The page carries hdnReportFileName per tab, and the report area offers
 * Email, Save As RTF and Add to Stallion. Which of those names the file this
 * client should serve is the last thing about this flow nobody has seen, so
 * it reports all of them rather than choosing in advance.
 */
export async function reportOn(page) {
  return page.evaluate(() => {
    const abs = (h) => {
      try {
        return new URL(h, location.href).href;
      } catch {
        return h;
      }
    };
    return {
      // the hidden field each report tab fills in once its report is built
      files: [...document.querySelectorAll('input[id*="hdnReportFileName"]')]
        .map((el) => ({ id: el.id, value: el.value || null }))
        .filter((f) => f.value),
      // the tab strip, so the horse's own tab can be told from General
      tabs: [...document.querySelectorAll('[id*="tabbedReport_tabs"] span, [id*="__tab_"]')]
        .map((el) => (el.textContent ?? "").trim())
        .filter(Boolean)
        .slice(0, 8),
      // Email | Save As RTF | Add to Stallion, and anything else offered
      actions: [...document.querySelectorAll("a")]
        .filter((a) => /save as|email|add to stallion|print|pdf|download/i.test(a.textContent ?? ""))
        .map((a) => ({ text: (a.textContent ?? "").trim(), id: a.id || null, href: (a.getAttribute("href") ?? "").slice(0, 120) }))
        .slice(0, 12),
      // a report rendered in a frame is fetched by its address, not scraped
      frames: [...document.querySelectorAll("iframe, embed, object")]
        .map((f) => abs(f.getAttribute("src") ?? f.getAttribute("data") ?? ""))
        .filter(Boolean)
        .slice(0, 6),
      loading: /Loading Report/i.test(document.body.textContent ?? ""),
    };
  });
}

/**
 * Is there a session, as Arion itself shows it?
 *
 * Not "is a password box on screen". Arion keeps its login form in the page
 * at all times and reveals it from a Login button in the header, so a page
 * with no visible password box is a logged-OUT page just as often as a
 * logged-in one. That mistake had the probe searching as a guest and calling
 * it a session: the search worked, because Arion lets anyone search, and
 * choosing a horse then answered "Options for Not logged in users".
 *
 * The header is the honest signal: Register | Login when there is no session,
 * My Account | Logout | Hi <name> when there is.
 */
export async function signedIn(page) {
  return page.evaluate(() => {
    const onScreen = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    const bits = [...document.querySelectorAll("a, input, span, div")];
    const says = (re) => bits.some((el) => onScreen(el) && re.test((el.textContent ?? el.value ?? "").trim()));
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    return {
      yes: says(/^log\s*out$/i),
      offersLogin: says(/^log\s*in$/i),
      greeting: (text.match(/Hi\s+[A-Za-z]+/) ?? [null])[0],
      failure: (document.getElementById("ctl00_LoginTop_FailureText")?.textContent ?? "").trim() || null,
      // what the header actually offers, so the control to press is a fact
      header: bits
        .filter((el) => el.matches("a, input, button") && /^(log\s*in|register|log\s*out|my account)$/i.test((el.textContent ?? el.value ?? "").trim()))
        .map((el) => ({ tag: el.tagName.toLowerCase(), id: el.id || null, href: (el.getAttribute("href") ?? "").slice(0, 90) || null, text: (el.textContent ?? el.value ?? "").trim() }))
        .slice(0, 10),
    };
  });
}

/**
 * The login forms Arion renders, best first.
 *
 * It renders one or the other, not both: logged out, the reports page carries
 * the header's `ctl00$LoginTop` box and no inline one, which is what defeated
 * the previous attempt — it filled `lvLogin`, found nothing, and posted
 * nothing.
 */
export const LOGIN_FORMS = [
  { user: "ctl00_LoginTop_UserName", password: "ctl00_LoginTop_Password", button: "ctl00$LoginTop$LoginButton" },
  {
    user: "ctl00_MainContentArea_lvLogin_Login1_UserName",
    password: "ctl00_MainContentArea_lvLogin_Login1_Password",
    button: "ctl00$MainContentArea$lvLogin$Login1$LoginButton",
  },
];

/**
 * Sign in by filling whichever of Arion's login forms is on the page and
 * firing its own __doPostBack.
 *
 * Four attempts were lost to visibility before this: the header Login is a
 * postback that reloads the page out from under the fill, the header panel is
 * styled shut, /Login.aspx shows no box either, and the inline form is not
 * rendered at all when logged out. Nothing here asks anything to be on
 * screen, and nothing assumes which form Arion chose to render.
 *
 * It returns which form it used, or the input ids it found instead, so a
 * failure names itself rather than arriving as a timeout.
 */
export async function signIn(page, user, password) {
  await page.goto(`${ORIGIN}${REPORTS_PATH}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  const sent = await page.evaluate(
    ({ u, p, forms }) => {
      for (const form of forms) {
        const name = document.getElementById(form.user);
        const word = document.getElementById(form.password);
        if (!name || !word) continue;
        name.value = u;
        word.value = p;
        // Arion's __doPostBack is not reachable as a global from here, so do
        // what it does: name the control in __EVENTTARGET and submit the
        // form. Both hidden fields are on the page, and this is the whole of
        // an ASP.NET postback — there is nothing else in that function.
        if (typeof window.__doPostBack === "function") {
          window.__doPostBack(form.button, "");
          return { posted: true, used: form.button, by: "__doPostBack" };
        }
        const aspnet = document.forms.aspnetForm ?? document.forms[0];
        if (!aspnet) return { posted: false, why: "the page has no form to post" };
        const target = document.getElementById("__EVENTTARGET");
        const argument = document.getElementById("__EVENTARGUMENT");
        if (!target) return { posted: false, why: "the page has no __EVENTTARGET to name a control in" };
        target.value = form.button;
        if (argument) argument.value = "";
        aspnet.submit();
        return { posted: true, used: form.button, by: "form.submit" };
      }
      return { posted: false, inputs: [...document.querySelectorAll("input")].map((e) => e.id).filter(Boolean).slice(0, 40) };
    },
    { u: user, p: password, forms: LOGIN_FORMS },
  );
  await page.waitForLoadState("load", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return sent;
}

/**
 * Log in and run one search, reading Arion's answer from the live DOM.
 *
 * It fills a search box and presses the button a person presses, then waits
 * for a dialog to appear. It never touches the report menu
 * (hiddenMenuItemId), so it cannot order anything: searching on Arion is free
 * and this stays free.
 */
export async function probe({ env = process.env, name = "Frankel", kind = "named", sire = "", dam = "", year = null, country = "", shot = false } = {}) {
  const user = env.ARION_USERNAME;
  const password = env.ARION_PASSWORD;
  if (!user || !password) return { ok: false, stage: "login", why: "ARION_USERNAME and ARION_PASSWORD are not set on this service" };

  const before = process.memoryUsage().rss;
  return withBrowser(async (page, { chromium, version }) => {
    const out = { ok: false, chromium: { ...chromium, version }, rss: { before } };
    try {
      await page.goto(`${ORIGIN}${REPORTS_PATH}`, { waitUntil: "domcontentloaded", timeout: 45000 });

      out.signedInBefore = await signedIn(page);
      if (!out.signedInBefore.yes) out.sent = await signIn(page, user, password);
      const after = await signedIn(page);
      out.loggedIn = after.yes;
      out.greeting = after.greeting;
      out.landed = new URL(page.url()).pathname;
      if (!out.loggedIn) {
        return { ...out, stage: "login", why: `Arion's header still offers Login after the login was sent${after.failure ? `: ${after.failure}` : ""}` };
      }

      // Arion sends a fresh login to /Home.aspx whatever page asked for it, so
      // the reports page has to be asked for a second time now there is a
      // session. Without this the search box simply is not on the page.
      if (new URL(page.url()).pathname !== REPORTS_PATH) {
        await page.goto(`${ORIGIN}${REPORTS_PATH}`, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(800);
      }
      out.reached = new URL(page.url()).pathname;
      out.beforeSearch = await shapeOf(page);
      if (out.reached !== REPORTS_PATH) {
        return { ...out, stage: "reports", why: `Arion would not stay on ${REPORTS_PATH}; it is on ${out.reached}` };
      }

      // One search, run the way the client runs it, so the probe and the
      // client cannot drift apart.
      try {
        await runSearch(page, { kind, name, sire, dam });
      } catch (err) {
        return { ...out, stage: "search", why: err.message };
      }

      out.afterSearch = await shapeOf(page);
      // The one moment worth looking at. Reading a DOM through a selector is
      // how the old parsers came to describe a page nobody had seen.
      if (shot) out.screenshot = (await page.screenshot({ type: "jpeg", quality: 45 })).toString("base64");

      // Arion's answer, as horses
      const horses = await candidatesOn(page);
      out.candidates = horses === null ? null : horses.map((h) => ({ ...h, cells: undefined }));
      // A sire x dam search answers with a list of sires, so for that one the
      // sire is who to look for — the year and country belong to the mare and
      // mean nothing here.
      const want = kind === "theoretical" ? { name: sire } : { name, year, country };
      const picked = pickCandidate(horses ?? [], want);
      out.wanted = want;
      out.picked = picked.one ? { ...picked.one, cells: undefined } : null;
      out.among = picked.among.map((h) => h.label);

      // Choosing from Arion's own dialog costs nothing — the report menu
      // (hiddenMenuItemId) is still untouched, so nothing is ordered. What
      // follows is the half of the flow this client has never seen.
      if (picked.one?.link) {
        try {
          await page.click(`#${picked.one.link}`, { timeout: 15000 });
          // Selecting a horse opens a tab named after it and starts the
          // report at once — the last run caught it saying "Loading
          // Report...". Wait for that to go, rather than guessing at a delay.
          await page
            .waitForFunction(() => !/Loading Report/i.test(document.body.textContent ?? ""), null, { timeout: 60000, polling: 500 })
            .catch(() => {});
          await page.waitForTimeout(2000);
          out.afterSelect = await shapeOf(page);
          out.report = await reportOn(page);
          if (shot) out.selectShot = (await page.screenshot({ type: "jpeg", quality: 40 })).toString("base64");
        } catch (err) {
          out.selectWhy = err.message;
        }
      }

      // The search leaves Arion's own modal open, and its backdrop
      // (div.modalBg) swallows every other click on the page — which is how
      // the previous run discovered the dialog had opened at all. Close it
      // before anything else is tried.
      try {
        const close = page
          .locator([
            idOf("ctl00$ModalDialogArea$ArionNamedHorseSearchControl$lnkClose"),
            idOf("ctl00$ModalDialogArea$ArionNamedHorseSearchControl$imgClose"),
          ].join(", "))
          .first();
        out.dialogWasOpen = await close.isVisible().catch(() => false);
        if (out.dialogWasOpen) {
          await close.click({ timeout: 8000 });
          await page.waitForTimeout(1200);
        }
      } catch (err) {
        out.dialogCloseWhy = err.message;
      }

      // My Reports in the same visit. That grid reads as empty through the
      // old client although the page's own pager advertises nine pages of it,
      // so its real shape is needed too, and gathering it here saves a deploy.
      // Opening a tab touches no report menu.
      try {
        const tab = page.getByText(/^\s*my reports\s*$/i).first();
        const there = Boolean(await tab.count());
        if (there) {
          await tab.click({ timeout: 10000 });
          await page.waitForTimeout(2000);
        }
        out.myReportsTab = { opened: there, ...(await shapeOf(page)) };
      } catch (err) {
        // a tab that will not open is worth knowing about, not worth failing for
        out.myReportsTab = { opened: false, why: err.message };
      }

      out.rss.after = process.memoryUsage().rss;
      return { ...out, ok: true, stage: "search", searched: { kind, name } };
    } catch (err) {
      return { ...out, stage: out.loggedIn ? "search" : "login", why: err.message, rss: { ...out.rss, after: process.memoryUsage().rss } };
    }
  }, { env });
}

/* ------------------------------------------------- reading Arion's answer */

/**
 * Arion's search dialog, as horses rather than as cells.
 *
 * Its grid is `ArionNamedHorseSearchControl_HorseSearchResultGridView`, whose
 * columns are Horse, Country, Year of Birth, Sire, Dam and sometimes a sex.
 * Each row's name is a link whose id ends `_ctlNN_lnkHorseName`, and clicking
 * that is how a horse is chosen. None of this was guessable: the fixtures
 * this client used to be written against named a `gvHorses` that does not
 * exist.
 */
export const SEARCH_GRID = "ctl00_ModalDialogArea_ArionNamedHorseSearchControl_HorseSearchResultGridView";

export function asCandidate(cells = [], link = null) {
  const [name, country, year, sire, dam, sex] = cells.map((c) => String(c ?? "").trim());
  if (!name) return null;
  const y = Number(year);
  return {
    name,
    country: country || null,
    year: Number.isFinite(y) && y > 1700 && y < 2100 ? y : null,
    sire: sire || null,
    dam: dam || null,
    sex: sex || null,
    link,
    label: [name, country ? `(${country})` : null, Number.isFinite(y) ? y : null].filter(Boolean).join(" "),
    cells,
  };
}

/** A row is a header, not a horse, when nothing in it can be clicked. */
export const isHorseRow = (row) => Boolean(row?.posts?.length) && Boolean(row?.cells?.[0]);

/**
 * Which of Arion's rows is the horse that was meant.
 *
 * Name first, then year, then country — the same order the pedigree cache
 * uses, and the reason it exists is on screen here: a search for
 * Starspangledbanner returns two horses of that name, SAF 2008 by Indigo
 * Magic and AUS 2006 by Choisir. One of them is the stallion; taking
 * whichever Arion listed first would be a coin toss.
 *
 * Returns `{ one }` when a single row survives, and `{ among }` when several
 * do. It never breaks a tie by position: an unresolved name is reported, not
 * guessed at.
 */
export function pickCandidate(rows, { name = "", year = null, country = "" } = {}) {
  const same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
  const asked = String(name).trim().toLowerCase();
  let live = rows.filter((r) => r && r.name);
  if (asked) {
    const exact = live.filter((r) => same(r.name, asked));
    // Nothing of that name. The year and the country describe the horse that
    // was asked for, so running them over a list it is not in picks a
    // stranger: "Starspangledbanner x Lady Vivian" once resolved to Star
    // Sparsh (IND) 2022, on the strength of the mare's foaling year alone.
    if (!exact.length) return { one: null, among: live, matched: false };
    live = exact;
  }
  if (live.length > 1 && Number(year)) {
    const byYear = live.filter((r) => Number(r.year) === Number(year));
    if (byYear.length) live = byYear;
  }
  if (live.length > 1 && country) {
    const byCountry = live.filter((r) => same(r.country, country));
    if (byCountry.length) live = byCountry;
  }
  return live.length === 1 ? { one: live[0], among: live } : { one: null, among: live };
}

/** Every horse in the dialog Arion has open, read from the live page. */
export async function candidatesOn(page) {
  const rows = await page.evaluate((gridId) => {
    const grid = document.getElementById(gridId);
    if (!grid) return null;
    return [...grid.querySelectorAll("tr")].map((tr) => ({
      cells: [...tr.querySelectorAll("td, th")].map((td) => (td.textContent ?? "").replace(/\s+/g, " ").trim()),
      posts: [...tr.querySelectorAll("a[id], a[href*='PostBack']")].map((a) => a.id).filter(Boolean),
    }));
  }, SEARCH_GRID);
  if (rows === null) return null; // no dialog at all, which is not an empty one
  return rows.filter(isHorseRow).map((r) => asCandidate(r.cells, r.posts[0])).filter(Boolean);
}

/* ------------------------------------------------------ the finished report */

/**
 * The files Arion built, from the hidden field its report tab fills in.
 *
 * That field holds a scrap of XML rather than a name:
 *
 *   <PdfFileName>Horse_Pedigreesreport-3_1343….pdf</PdfFileName>
 *   <RtfFileName>Horse_Pedigreesreport-3_1343….rtf</RtfFileName>
 *
 * and the files themselves sit under /files/reports/, which is where the
 * page's own "Save As RTF" points. Both are read: the PDF is what the desk
 * wants to look at, the RTF is what it wants to edit.
 */
export const REPORT_FILES = "/files/reports/";

export function filesFrom(value, { origin = ORIGIN } = {}) {
  const s = String(value ?? "");
  const out = [];
  const take = (tag, kind) => {
    const name = s.match(new RegExp(`<${tag}>([^<]+)</${tag}>`, "i"))?.[1]?.trim();
    // a name with a slash in it is a path, not a file Arion built here
    if (!name || /[\\/\\\\]/.test(name)) return;
    out.push({ kind, name, url: `${origin}${REPORT_FILES}${encodeURIComponent(name)}` });
  };
  take("PdfFileName", "pdf");
  take("RtfFileName", "rtf");
  return out;
}

/**
 * Arion's own id for the horse a report was built for, from the address of
 * the frame the report is rendered in:
 *
 *   /ReportLoader.aspx?HorseName=…&HorseId=103364639&ReportType=PED01&Style=I…
 *
 * Worth keeping. A name is not a horse — Arion holds two Starspangledbanners
 * — but this number is one, and it is Arion's own.
 */
export function horseIdFrom(frames = []) {
  for (const f of frames) {
    const id = String(f ?? "").match(/[?&]HorseId=(\d+)/i)?.[1];
    if (id) return id;
  }
  return null;
}

/* ---------------------------------------------------------------- a session */

/**
 * How long a signed-in browser waits for the next job before it is closed.
 *
 * Launching Chromium, loading Arion three times and posting the login took
 * about 8.5 of the 10 seconds a search took, and all of it was thrown away
 * when the search ended. Fifteen minutes covers a desk working down a list;
 * past that the browser goes, and Arion's own session has likely lapsed too.
 */
export const IDLE_MS = 15 * 60 * 1000;

// The browser jobs share: { browser, page, info, timer, showing }. `showing`
// is the search whose dialog the page still has open.
let kept = null;

/** Close the kept browser, if there is one. */
export async function closeSession() {
  const was = kept;
  kept = null;
  if (!was) return;
  clearTimeout(was.timer);
  await was.browser.close().catch(() => {});
}

/** Is a browser kept, and still connected? */
export const sessionKept = () => Boolean(kept?.browser.isConnected());

async function keptBrowser({ env, launch }) {
  if (kept && !kept.browser.isConnected()) await closeSession();
  if (!kept) {
    const { browser, chosen } = await launch({ env });
    try {
      const context = await browser.newContext({ viewport: VIEWPORT });
      const page = await context.newPage();
      kept = { browser, page, info: { chromium: chosen, version: browser.version() }, timer: null, showing: null };
    } catch (err) {
      await browser.close().catch(() => {});
      throw err;
    }
  }
  clearTimeout(kept.timer);
  return kept;
}

/** Start the idle clock again; when it runs out, the browser goes. */
function rest(s, idleMs) {
  clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    if (kept === s) closeSession();
  }, idleMs);
  s.timer.unref?.();
}

const onReports = (page) => {
  try {
    return new URL(page.url()).pathname === REPORTS_PATH;
  } catch {
    return false;
  }
};

/**
 * How long the reports page is left to finish setting itself up after it
 * loads. A search pressed on a page reloaded a moment earlier found nothing,
 * every time, and waited out its 30 seconds doing it — while every search run
 * on a page that had just signed in, which always waited this long, worked.
 */
export const SETTLE_MS = 2500;

/** Load the reports page afresh, and let it settle. Whatever dialog was open is gone. */
export async function reloadReports(page, s = null) {
  if (s) s.showing = null;
  await page.goto(`${ORIGIN}${REPORTS_PATH}`, { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(SETTLE_MS);
}

/**
 * A logged-in Arion on the reports page, kept between jobs.
 *
 * Arion is driven as a person drives it — fill the box, press the button the
 * page offers, click the horse in the dialog — because that is the only
 * version of this site that works. Six attempts at reproducing its form posts
 * by hand are the evidence.
 *
 * The browser is launched and signed in once, then kept for IDLE_MS. Each job
 * starts from a fresh load of the reports page, because a dialog the last job
 * left open would sit over the boxes, and signs in again only when Arion shows
 * no session. A job that asks to `stay` gets the page as the last one left it,
 * and must check what is on it before using it.
 *
 * Any failure closes the browser: a page in a state nobody has looked at is
 * not handed to the next job. One job at a time is the client's to ensure,
 * and it does — every call goes through one queue.
 */
export async function withSession(fn, { env = process.env, launch = launchChromium, idleMs = IDLE_MS, stay = false } = {}) {
  if (!env.ARION_USERNAME || !env.ARION_PASSWORD) {
    throw new ArionError("Arion is not connected: ARION_USERNAME and ARION_PASSWORD are not set on this service", { status: 503, code: "unconfigured" });
  }
  const s = await keptBrowser({ env, launch });
  try {
    const { page } = s;
    if (!stay || !onReports(page)) await reloadReports(page, s);
    if (!(await signedIn(page)).yes) {
      s.showing = null;
      await signIn(page, env.ARION_USERNAME, env.ARION_PASSWORD);
      const now = await signedIn(page);
      if (!now.yes) {
        throw new ArionError(`Arion refused the desk's login${now.failure ? `: ${now.failure}` : ""}`, { status: 401, code: "login" });
      }
    }
    // Arion sends a fresh login to /Home.aspx whatever asked for it
    if (!onReports(page)) await reloadReports(page, s);
    const out = await fn(page, s.info, s);
    rest(s, idleMs);
    return out;
  } catch (err) {
    if (kept === s) await closeSession();
    throw err;
  }
}

/**
 * Launch and sign in ahead of the first job, so it happens while the desk is
 * still typing. A browser already kept is left as it is — its page may hold
 * the dialog a report is about to be made from — and only its clock restarts.
 */
export async function warmSession({ env = process.env, launch = launchChromium, idleMs = IDLE_MS } = {}) {
  if (sessionKept()) {
    rest(kept, idleMs);
    return { warm: true, already: true };
  }
  return withSession(async () => ({ warm: true, already: false }), { env, launch, idleMs });
}

/** The three searches the page offers, by the boxes each one fills. */
export const SEARCH_FIELDS = {
  named: { boxes: { txtNamedHorse: "name" }, button: "btnSearchNamedHorse" },
  dam: { boxes: { txtUnnamedHorse: "dam" }, button: "btnSearchUnnamedHorse" },
  theoretical: { boxes: { txtSireName: "sire", txtDamName: "dam" }, button: "btnSearchDamHorse" },
};

/** Run one search and read Arion's answer. Searching costs nothing. */
export async function runSearch(page, { kind = "named", ...values } = {}) {
  const how = SEARCH_FIELDS[kind];
  if (!how) throw new ArionError(`Unknown search: ${kind}`, { status: 400, code: "input" });
  for (const [box, key] of Object.entries(how.boxes)) {
    const v = String(values[key] ?? "").trim();
    if (!v || v.length > 60) throw new ArionError(`Give the ${key === "name" ? "horse's name" : key}`, { status: 400, code: "input" });
    const sel = idOf(`ctl00$MainContentArea$${box}`);
    await page.fill(sel, v, { timeout: 15000 });
    // a box the page's own script set back to empty searches for nothing:
    // look once more before pressing, and fill it again if it is gone
    await page.waitForTimeout(250);
    if ((await page.inputValue(sel).catch(() => v)) !== v) await page.fill(sel, v, { timeout: 15000 });
  }
  await page.click(idOf(`ctl00$MainContentArea$${how.button}`), { timeout: 20000 });
  // the dialog arrives by async postback, so wait for a row rather than a clock
  await page.waitForSelector(`#${SEARCH_GRID} tr`, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  return candidatesOn(page);
}

/** Wait for Arion to stop saying it is building something. */
export const settled = (page, ms = 90000) =>
  page
    .waitForFunction(() => !/Loading Report/i.test(document.body.textContent ?? ""), null, { timeout: ms, polling: 500 })
    .catch(() => {});

/**
 * Open one horse from the dialog. Arion opens a tab named after it and starts
 * building the report in the style the sidebar already has chosen, so this is
 * also where a report begins.
 */
export async function openHorse(page, link) {
  await page.click(`#${link}`, { timeout: 20000 });
  await settled(page);
  await page.waitForTimeout(1200);
  return reportOn(page);
}

/**
 * Choose a report from the sidebar by the name Arion prints there, which is
 * the same name REPORTS carries. Clicking the menu is what sets
 * hiddenMenuItemId; nothing here writes that field by hand.
 */
export async function chooseReport(page, label) {
  const wanted = String(label ?? "").trim();
  if (!wanted) return { chosen: false, why: "no report named" };
  const item = page
    .locator("a, span, li, td")
    .filter({ hasText: new RegExp(`^\\s*${wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i") })
    .first();
  if (!(await item.count())) return { chosen: false, why: `Arion's menu offers no "${wanted}"` };
  await item.click({ timeout: 20000 }).catch(() => {});
  await settled(page);
  await page.waitForTimeout(1200);
  return { chosen: true };
}

/* ------------------------------------------- what the client actually calls */

/**
 * The two jobs the client needs, each a whole visit to Arion.
 *
 * Keeping the seam this narrow matters: the client knows "search Arion" and
 * "make this report", not which control opens a dialog. Everything above is
 * how, and how has changed six times in one afternoon.
 */
/** The same horse, found again in a list that was fetched afresh. */
export const sameHorse = (a, b) => Boolean(a) && Boolean(b) && a.name === b.name && a.year === b.year && a.country === b.country;

/**
 * A sire x dam mating, which Arion asks for in two steps.
 *
 * It answers the search with a list of SIRES — "Please select a horse" — and
 * only once one is chosen does it refill the same grid with DAMS, saying
 * "Please select a dam from the list below". The foal's report is built after
 * both. Reading that first list as the mating is how a search for
 * Starspangledbanner x Lady Vivian came back claiming Star Sparsh.
 */
export async function matingDialog(page, { sire = "", dam = "", sireIs = null } = {}) {
  const sires = (await runSearch(page, { kind: "theoretical", sire, dam })) ?? [];
  if (!sires.length) return { stage: "sire", candidates: [] };
  const chosen = sireIs ? { one: sires.find((h) => sameHorse(h, sireIs)) ?? null, among: sires } : pickCandidate(sires, { name: sire });
  // Arion's own list could not be narrowed to one sire, so the desk picks.
  if (!chosen.one) return { stage: "sire", candidates: chosen.among };
  await page.click(`#${chosen.one.link}`, { timeout: 20000 });
  await page.waitForSelector(`#${SEARCH_GRID} tr`, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(900);
  return { stage: "dam", sire: chosen.one, candidates: (await candidatesOn(page)) ?? [] };
}

/**
 * What names the dialog a search leaves open: the search itself, and for a
 * mating the sire Arion settled on, because the dams it lists are that sire's.
 */
export const searchKey = (values = {}, sire = null) =>
  JSON.stringify([
    values.kind ?? "named",
    ...["name", "sire", "dam"].map((k) => String(values[k] ?? "").trim().toLowerCase()),
    sire ? [sire.name, sire.year ?? null, sire.country ?? null] : null,
  ]);

/** How long a search's open dialog may be used to start a report from. */
export const STAY_MS = 10 * 60 * 1000;

export const searchHorses = ({ env = process.env, ...values } = {}) =>
  withSession(async (page, info, s) => {
    const answer =
      values.kind === "theoretical"
        ? await matingDialog(page, values)
        : { stage: "horse", candidates: (await runSearch(page, values)) ?? null };
    // The dialog stays open on the kept page, so a report for a horse in it
    // can start right here rather than from a second search.
    s.showing = { key: searchKey(values, answer.sire ?? null), at: Date.now() };
    return answer;
  }, { env });

/** Milliseconds spent on each step of a job, for the line that reports it. */
function stopwatch() {
  const spent = {};
  let last = Date.now();
  const lap = (step) => {
    const t = Date.now();
    spent[step] = (spent[step] ?? 0) + (t - last);
    last = t;
  };
  lap.spent = spent;
  return lap;
}

/** Which report Arion's sidebar holds, as its own hidden field says. */
const menuHolds = (page) =>
  page.evaluate(() => document.querySelector('input[id*="hiddenMenuItemId"]')?.value || null).catch(() => null);

/**
 * The files a report was built into, fetched with the page's own cookies —
 * no second login — so the desk can open them again later without Arion. A
 * file that cannot be had, or a login page where a report should be, is left
 * as its address, which is all it was before.
 */
export const FILE_MAX = 15 * 1024 * 1024;

export async function fetchFiles(page, files = [], { retryMs = 1500 } = {}) {
  const get = async (f) => {
    const res = await page.request.get(f.url, { timeout: 30000 });
    return { res, type: String(res.headers()["content-type"] ?? "").split(";")[0].trim() };
  };
  return Promise.all(
    files.map(async (f) => {
      try {
        let { res, type } = await get(f);
        // a file still being written is not yet there: one more look
        if (res.status() === 404 && retryMs) {
          await new Promise((r) => setTimeout(r, retryMs));
          ({ res, type } = await get(f));
        }
        if (!res.ok()) return { ...f, status: res.status() };
        if (/html/i.test(type)) return { ...f, status: "html" };
        const body = await res.body();
        if (!body.length || body.length > FILE_MAX) return { ...f, status: body.length ? "too big" : "empty" };
        return { ...f, type: type || (f.kind === "pdf" ? "application/pdf" : "application/rtf"), body, status: res.status() };
      } catch (err) {
        return { ...f, status: String(err?.message ?? err).slice(0, 80) };
      }
    }),
  );
}

/**
 * A report id as Arion's menu writes it — PED02|0#5D_a — in its parts: the
 * report type, the style or depth it is drawn in, and the menu item's number.
 */
export function reportParts(id) {
  const m = String(id ?? "").match(/^([A-Z0-9]+)\|([^#]+)#(\d+)/i);
  return m ? { type: m[1].toUpperCase(), value: m[2], n: m[3] } : null;
}

/**
 * Is this file the report that was asked for? Arion names a file after the
 * menu item it was built from — WI style (#3) into …_Pedigreesreport-3_…,
 * Tatts style (#30) into …-30_… — so a name carrying another number belongs
 * to another build: the style the sidebar held when the horse was opened.
 * Handing that over is how a Standard pedigree came back as a dead link.
 */
export function madeAs(name, id) {
  const n = reportParts(id)?.n;
  if (!n) return true; // nothing to check against
  return new RegExp(`report-${n}_`, "i").test(String(name ?? ""));
}

/**
 * The frame a report is drawn in, for the report that was asked for:
 *
 *   ReportLoader.aspx?…&ReportType=PED01&Style=I&…&MainParameterValue=I&…
 *
 * The same type and style first, then the same type; anything else is some
 * other report and is not taken.
 */
export function frameFor(frames = [], id) {
  const want = reportParts(id);
  const drawn = frames
    .map((src) => {
      try {
        const u = new URL(src);
        if (!/ReportLoader\.aspx$/i.test(u.pathname)) return null;
        const q = (k) => [...u.searchParams].find(([key]) => key.toLowerCase() === k)?.[1] ?? null;
        return { src, type: (q("reporttype") ?? "").toUpperCase(), value: q("mainparametervalue") ?? q("style") };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (!want) return drawn.at(-1)?.src ?? null;
  const same = drawn.filter((d) => d.type === want.type);
  return (same.find((d) => d.value === want.value) ?? same.at(-1))?.src ?? null;
}

/**
 * A report Arion draws on its own page rather than into a file — the Internet
 * pedigrees do — taken from the frame it is drawn in: as the PDF the frame
 * serves, or printed to PDF by this browser from the page it shows. Either
 * way the desk gets a file to keep. A login page, or a frame with next to
 * nothing in it, is not taken for a report.
 */
export async function frameAsFile(page, url, { name = "arion-report" } = {}) {
  const p = await page.context().newPage();
  try {
    const res = await p.goto(url, { waitUntil: "load", timeout: 45000 });
    if (!res?.ok()) return null;
    const type = String(res.headers()["content-type"] ?? "").split(";")[0].trim();
    if (/pdf/i.test(type)) {
      const body = await res.body();
      return body.length && body.length <= FILE_MAX ? { kind: "pdf", name: `${name}.pdf`, url, type: "application/pdf", body, from: "frame" } : null;
    }
    await settled(p, 60000);
    await p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    const looks = await p.evaluate(() => ({
      words: (document.body?.textContent ?? "").replace(/\s+/g, " ").trim().length,
      login: Boolean(document.querySelector('input[type="password"]')),
    }));
    if (looks.login || looks.words < 200) return null;
    const body = await p.pdf({ format: "A4", printBackground: true, margin: { top: "10mm", bottom: "10mm", left: "8mm", right: "8mm" } });
    return { kind: "pdf", name: `${name}.pdf`, url, type: "application/pdf", body, from: "drawn" };
  } catch {
    return null;
  } finally {
    await p.close().catch(() => {});
  }
}

/**
 * Every frame on the page, by where it is now and by what its markup says.
 * Arion can move a frame on by script, which leaves its src attribute behind.
 */
export async function framesNow(page, attrs = []) {
  const live = page.frames().map((f) => f.url()).filter((u) => /^https?:/i.test(u));
  return [...new Set([...live, ...attrs])];
}

/**
 * Is the chosen report on screen yet? A file carrying its menu number — in
 * the hidden field, or as the address a frame has gone on to — or a report
 * frame of its type that is not the one there before (`not`).
 */
async function reportShown(page, { type, value, n }, not) {
  return page
    .evaluate(
      ({ type, value, n, not }) => {
        const mine = new RegExp(`report-${n}_`, "i");
        const named = [...document.querySelectorAll('input[id*="hdnReportFileName"]')].map((el) => el.value || "");
        if (named.some((v) => mine.test(v))) return true;
        const where = [];
        for (const f of document.querySelectorAll("iframe")) {
          where.push(f.getAttribute("src") || "");
          try {
            where.push(f.contentWindow.location.href);
          } catch {
            /* another site's frame */
          }
        }
        return where.some((src) => {
          if (!src || src === not) return false;
          if (/\/files\/reports\//i.test(src)) return mine.test(src);
          if (!/ReportLoader\.aspx/i.test(src)) return false;
          try {
            const q = new URL(src, location.href).searchParams;
            const v = q.get("MainParameterValue") ?? q.get("Style");
            return (q.get("ReportType") || "").toUpperCase() === type && (v === null || v === value);
          } catch {
            return false;
          }
        });
      },
      { type, value, n, not },
    )
    .catch(() => false);
}

/** Arion's own "are you sure", if it is on screen. */
async function shownYes(page) {
  const all = page.locator(`${idOf("ctl00$btnYes")}, a:text-is("Yes"), button:text-is("Yes"), input[value="Yes"]`);
  const n = await all.count().catch(() => 0);
  for (let i = 0; i < n; i += 1) if (await all.nth(i).isVisible().catch(() => false)) return all.nth(i);
  return null;
}

/**
 * Wait for Arion to show the report that was chosen, not for a clock.
 *
 * Choosing a style asks first — Arion's own "are you sure", a Yes/No box in
 * every page's markup — and builds nothing until it is answered. Nothing here
 * answered it, so a Standard pedigree chosen after the horse had opened in WI
 * style sat unbuilt behind the box for as long as anyone waited, and the WI
 * style's files were all there was to read. The desk said yes by pressing
 * Generate, so the box is answered yes; and until the report comes the page
 * goes on showing the last one, so it is the report that is waited for.
 */
export async function waitForReport(page, reportId, { not = null, timeout = 30000, poll = 300 } = {}) {
  const want = reportParts(reportId);
  if (!want) return { arrived: false, asked: false };
  let asked = false;
  const until = Date.now() + timeout;
  for (;;) {
    if (await reportShown(page, want, not)) return { arrived: true, asked };
    if (!asked) {
      const yes = await shownYes(page);
      if (yes) {
        await yes.click({ timeout: 10000 }).catch(() => {});
        asked = true;
        await settled(page, 60000);
        continue;
      }
    }
    if (Date.now() >= until) return { arrived: false, asked };
    await page.waitForTimeout(poll);
  }
}

/** The files a frame shows directly, as the hidden field would name them. */
export const filesShown = (frames = []) =>
  frames
    .filter((src) => /\/files\/reports\/[^/?#]+\.(pdf|rtf)$/i.test(src))
    .map((src) => {
      const name = decodeURIComponent(src.split("/").pop());
      return { kind: /\.rtf$/i.test(name) ? "rtf" : "pdf", name, url: src };
    });

/** A name safe to give a file, from what the report is of. */
const fileName = (s) =>
  String(s ?? "").replace(/×/g, "x").replace(/[^A-Za-z0-9 ().-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "arion-report";

export async function makeReport({ env = process.env, values = {}, horse = {}, sire = null, label = "", reportId = "" } = {}) {
  return withSession(async (page, info, s) => {
    const lap = stopwatch();
    // The search's dialog may still be open on the kept page. It is used only
    // if it is the same search and it lists this horse now — by name, year
    // and country, read off the page — never a control id from before.
    const showing = s.showing;
    s.showing = null; // opening a horse closes the dialog, whatever follows
    let found = null;
    if (showing && showing.key === searchKey(values, sire) && Date.now() - showing.at < STAY_MS) {
      found = ((await candidatesOn(page)) ?? []).find((h) => sameHorse(h, horse)) ?? null;
      if (found && !(await page.locator(`#${found.link}`).isVisible().catch(() => false))) found = null;
    }
    lap("check");

    let opened = null;
    if (found) {
      opened = await openHorse(page, found.link);
      lap("open");
      // The dialog looked right and opened nothing — no report frame, no
      // file — so it is done the long way, once. Any frame will not do: a
      // banner is a frame too.
      if (!opened.files.length && !frameFor(opened.frames, null)) opened = null;
    }
    const reused = Boolean(opened);
    if (!opened) {
      // A control id from another visit means nothing in this one, so the
      // search is run again and the same horse found by name, year and country.
      await reloadReports(page, s);
      const again =
        values.kind === "theoretical"
          ? (await matingDialog(page, { ...values, sireIs: sire })).candidates
          : (await runSearch(page, values)) ?? [];
      const one = again.find((h) => sameHorse(h, horse));
      if (!one) {
        throw new ArionError(`Arion no longer offers ${horse.label ?? horse.name} for that search; search again`, { status: 409, code: "session" });
      }
      lap("search");
      opened = await openHorse(page, one.link);
      lap("open");
    }
    const held = await menuHolds(page);
    const before = frameFor(await framesNow(page, opened.frames), null);
    // Arion builds whatever style the sidebar already holds when a horse is
    // opened. If that is the report asked for — the menu's own id says so,
    // exactly — it is already there. If not, the one asked for is chosen now,
    // and waited for: Arion asks first, and the last report stays on screen
    // until the new one comes.
    let chose = { chosen: true, already: true };
    let waited = null;
    if (held !== reportId) {
      chose = await chooseReport(page, label);
      if (chose.chosen) waited = await waitForReport(page, reportId, { not: before });
    }
    lap("choose");
    const built = await reportOn(page);
    built.frames = await framesNow(page, built.frames);
    // Only the files built for this report, and only those Arion actually
    // hands over: a name in a hidden field is not a file. A frame that has
    // gone on to show a file names it too.
    const names = new Set();
    const named = [...built.files.flatMap((f) => filesFrom(f.value)), ...filesShown(built.frames)].filter((f) => !names.has(f.name) && names.add(f.name));
    const tried = await fetchFiles(page, named.filter((f) => madeAs(f.name, reportId)));
    let files = tried.filter((f) => f.body);
    lap("files");
    // No file: the report is drawn on Arion's page, so it is taken from there.
    const frame = files.length ? null : frameFor(built.frames, reportId);
    if (frame) {
      const subject = sire ? `${sire.label} x ${horse.label}` : horse.label ?? horse.name;
      const drawn = await frameAsFile(page, frame, { name: fileName(`${subject} - ${label}`) });
      if (drawn) files = [drawn];
      lap("draw");
    }
    return {
      chose,
      tabs: built.tabs,
      horseId: horseIdFrom(built.frames),
      files,
      reused,
      // where the time went, and what the sidebar held before and after the
      // choice — the measurement a skipped second build would rest on
      steps: lap.spent,
      menu: { before: held, after: await menuHolds(page) },
      // what Arion offered, so a report that comes back without a file says why
      seen: {
        waited,
        before,
        // what Arion had up when the report did not come
        modals: waited && !waited.arrived ? (await shapeOf(page)).modals.filter((m) => m.shown).map((m) => m.text.slice(0, 200)) : undefined,
        named: named.map((f) => f.name),
        fetched: tried.map((f) => ({ name: f.name, status: f.status })),
        frames: built.frames,
        frame,
      },
    };
  }, { env, stay: true });
}

/* ------------------------------------------------------------- My Reports */

/**
 * The account's own reports, which the old client read as empty.
 *
 * Its grid is gvMyReport, under the My Reports tab, with Horse Name, Report
 * Type, Report Style and Expiry Date, and a pager reading "Page 1 of 17".
 * The rows are in the page whether or not the tab is open, but the tab is
 * opened anyway: a grid rendered on demand would otherwise be missed.
 */
export const MY_REPORTS_GRID =
  "ctl00_MainContentArea_tabbedReport_tabs_TabMyReports_ctl01_ucArionMyReportsControl_lvMyReports_gvMyReport";

/** A row of that grid, as a report rather than as cells. */
export function asSavedReport(cells = [], links = []) {
  const [horse, type, style, expires] = cells.map((c) => String(c ?? "").trim());
  if (!horse) return null;
  if (/^horse\s*name$/i.test(horse)) return null; // the header
  if (/^page\s+\d+\s+of\s+\d+/i.test(horse)) return null; // the pager's caption
  // and the pager's own row of page numbers, which lives in this same grid
  // and looks like any other row: ["1","2","3","4"]. No horse is called 7.
  if (/^\d{1,3}$/.test(horse)) return null;
  // the pager's own numbers live in this grid too, and open nothing
  const open = links.find((l) => l.id && !/btnNum_|ibtn(Next|Last|Prev|First)/i.test(l.id)) ?? null;
  const kept = style && style !== "-" ? style : null;
  return {
    horse,
    type: type || null,
    style: kept,
    expires: expires || null,
    link: open?.id ?? null,
    label: [horse, type, kept].filter(Boolean).join(" · "),
  };
}

/**
 * The same report, found again in a list fetched afresh. Four columns rather
 * than a row id, for the same reason a horse travels by name, year and
 * country: the id belongs to the visit, the report does not.
 */
export const sameReport = (a, b) =>
  Boolean(a) && Boolean(b) && a.horse === b.horse && a.type === b.type && a.style === b.style && a.expires === b.expires;

async function myReportsPage(page) {
  return page.evaluate((gridId) => {
    const grid = document.getElementById(gridId);
    if (!grid) return null;
    const words = (el) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
    const where = words(grid).match(/Page\s+(\d+)\s+of\s+(\d+)/i);
    return {
      page: where ? Number(where[1]) : 1,
      pages: where ? Number(where[2]) : 1,
      rows: [...grid.querySelectorAll("tr")].map((tr) => ({
        cells: [...tr.querySelectorAll("td, th")].map(words).filter(Boolean),
        links: [...tr.querySelectorAll("a[id]")].map((a) => ({ id: a.id, text: words(a) })),
      })),
    };
  }, MY_REPORTS_GRID);
}

/** Open the My Reports tab, if the page offers one. */
export async function openMyReportsTab(page) {
  const tab = page.getByText(/^\s*my reports\s*$/i).first();
  if (!(await tab.count())) return false;
  await tab.click({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1800);
  return true;
}

/**
 * Every page of My Reports.
 *
 * The pager posts back, and waiting a fixed moment for it was not enough: two
 * runs minutes apart returned 426 rows and 50, the second a strict subset of
 * the first, with nothing to say it was short. So each turn of the page waits
 * for the caption to actually change, presses again if it has not, and the
 * walk reports how far it got.
 *
 * Returns { rows, pages, read }, or null when the grid is not there at all —
 * which is not the same as an account with nothing in it. Given `until`, the
 * walk stops at the first row it accepts and says so in `found`; that row's
 * link is good on the page the grid is showing.
 */
export async function myReportsOn(page, { maxPages = 40, tries = 3, until = null } = {}) {
  await openMyReportsTab(page);
  const rows = [];
  let pages = 1;
  let read = 0;
  for (let i = 0; i < maxPages; i += 1) {
    const got = await myReportsPage(page);
    if (!got) return rows.length ? { rows, pages, read } : null;
    pages = got.pages;
    read += 1;
    for (const row of got.rows) {
      const saved = asSavedReport(row.cells, row.links);
      if (!saved) continue;
      rows.push(saved);
      if (until?.(saved)) return { rows, pages, read, found: saved };
    }
    if (got.page >= got.pages) break;

    const next = page.locator('[id*="gvMyReport"][id*="ibtnNext"]').first();
    if (!(await next.count())) break;
    const was = got.page;
    let moved = false;
    for (let t = 0; t < tries && !moved; t += 1) {
      await next.click({ timeout: 15000 }).catch(() => {});
      moved = await page
        .waitForFunction(
          ({ gridId, from }) => {
            const g = document.getElementById(gridId);
            const m = (g?.textContent ?? "").replace(/\s+/g, " ").match(/Page\s+(\d+)\s+of\s+\d+/i);
            return Boolean(m) && Number(m[1]) !== from;
          },
          { gridId: MY_REPORTS_GRID, from: was },
          { timeout: 15000, polling: 300 },
        )
        .then(() => true)
        .catch(() => false);
    }
    if (!moved) break; // said in `read`, never passed off as the whole list
  }
  return { rows, pages, read };
}

export const listMyReports = ({ env = process.env } = {}) => withSession((page) => myReportsOn(page), { env });

/**
 * Open a report the account already has. The report menu is never touched,
 * so this cannot make a second copy of something already made.
 */
export async function openSavedReport({ env = process.env, report = {} } = {}) {
  return withSession(async (page) => {
    // Newest first, so a report made lately is a page or two in, not eighteen.
    const found = (await myReportsOn(page, { until: (r) => sameReport(r, report) }))?.found ?? null;
    if (!found) {
      throw new ArionError(`${report.label ?? report.horse} is no longer under My Reports; open the list again`, { status: 409, code: "session" });
    }
    if (!found.link) {
      throw new ArionError(`Arion offers no way to open ${found.label} from its list; open it on Arion`, { status: 409, code: "session" });
    }
    await page.click(`#${found.link}`, { timeout: 20000 });
    await settled(page);
    await page.waitForTimeout(1200);
    const built = await reportOn(page);
    let files = (await fetchFiles(page, built.files.flatMap((f) => filesFrom(f.value)))).filter((f) => f.body);
    if (!files.length) {
      const frame = frameFor(built.frames, null);
      const drawn = frame ? await frameAsFile(page, frame, { name: fileName(found.label) }) : null;
      if (drawn) files = [drawn];
    }
    return { files, tabs: built.tabs };
  }, { env });
}
