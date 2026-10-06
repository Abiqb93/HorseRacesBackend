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

/** One Chromium, launched for one job and closed after it. */
export async function withBrowser(fn, { env = process.env } = {}) {
  const chosen = pickChromium({ env, isExecutable: executable });
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    ...(chosen.path ? { executablePath: chosen.path } : {}),
    // Chromium runs as root in a container, where its sandbox cannot start
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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
export async function probe({ env = process.env, name = "Frankel", kind = "named", year = null, country = "", shot = false } = {}) {
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

      // the box, then the button a person presses — not the hidden Enter-key
      // submit the fetch client was pressing
      const box = idOf(`ctl00$MainContentArea$${{ named: "txtNamedHorse", dam: "txtUnnamedHorse" }[kind] ?? "txtNamedHorse"}`);
      if (!(await page.locator(box).count())) {
        return { ...out, stage: "search", why: `the reports page has no ${box}; the fields it does have are listed under beforeSearch` };
      }
      await page.fill(box, name, { timeout: 15000 });
      await page.click(idOf(`ctl00$MainContentArea$btnSearch${kind === "dam" ? "UnnamedHorse" : "NamedHorse"}`));

      // a dialog, or the page settling without one
      await page
        .waitForSelector('[id*="SearchControl"] tr, [id*="gvHorses"] tr', { state: "visible", timeout: 20000 })
        .catch(() => {});
      await page.waitForTimeout(1200);

      out.afterSearch = await shapeOf(page);
      // The one moment worth looking at. Reading a DOM through a selector is
      // how the old parsers came to describe a page nobody had seen.
      if (shot) out.screenshot = (await page.screenshot({ type: "jpeg", quality: 45 })).toString("base64");

      // Arion's answer, as horses
      const horses = await candidatesOn(page);
      out.candidates = horses === null ? null : horses.map((h) => ({ ...h, cells: undefined }));
      const picked = pickCandidate(horses ?? [], { name, year, country });
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
 * A logged-in Arion on the reports page, for the length of one job.
 *
 * One browser, one page, closed when the job ends. Arion is driven as a
 * person drives it — fill the box, press the button the page offers, click
 * the horse in the dialog — because that is the only version of this site
 * that works. Six attempts at reproducing its form posts by hand are the
 * evidence.
 */
export async function withSession(fn, { env = process.env } = {}) {
  if (!env.ARION_USERNAME || !env.ARION_PASSWORD) {
    throw new ArionError("Arion is not connected: ARION_USERNAME and ARION_PASSWORD are not set on this service", { status: 503, code: "unconfigured" });
  }
  return withBrowser(async (page, info) => {
    await page.goto(`${ORIGIN}${REPORTS_PATH}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (!(await signedIn(page)).yes) {
      await signIn(page, env.ARION_USERNAME, env.ARION_PASSWORD);
      const now = await signedIn(page);
      if (!now.yes) {
        throw new ArionError(`Arion refused the desk's login${now.failure ? `: ${now.failure}` : ""}`, { status: 401, code: "login" });
      }
    }
    // Arion sends a fresh login to /Home.aspx whatever asked for it
    if (new URL(page.url()).pathname !== REPORTS_PATH) {
      await page.goto(`${ORIGIN}${REPORTS_PATH}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    }
    return fn(page, info);
  }, { env });
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
    await page.fill(idOf(`ctl00$MainContentArea$${box}`), v, { timeout: 15000 });
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
export const searchHorses = ({ env = process.env, ...values } = {}) =>
  withSession((page) => runSearch(page, values), { env });

export async function makeReport({ env = process.env, values = {}, horse = {}, label = "" } = {}) {
  return withSession(async (page) => {
    const again = (await runSearch(page, values)) ?? [];
    const found = again.find((h) => h.name === horse.name && h.year === horse.year && h.country === horse.country);
    if (!found) {
      throw new ArionError(`Arion no longer offers ${horse.label ?? horse.name} for that search; search again`, { status: 409, code: "session" });
    }
    await openHorse(page, found.link);
    // Arion starts a report in whatever style the sidebar already holds, so
    // the one that was asked for is chosen after the horse, not before.
    const chose = await chooseReport(page, label);
    const built = await reportOn(page);
    return {
      chose,
      tabs: built.tabs,
      horseId: horseIdFrom(built.frames),
      files: built.files.flatMap((f) => filesFrom(f.value)),
    };
  }, { env });
}
