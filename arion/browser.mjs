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

import { ORIGIN, REPORTS_PATH } from "./client.mjs";

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

      if (await page.locator('input[type="password"]:visible').count()) {
        await page.fill(idOf("ctl00$MainContentArea$lvLogin$Login1$UserName"), user);
        await page.fill(idOf("ctl00$MainContentArea$lvLogin$Login1$Password"), password);
        await Promise.all([
          page.waitForLoadState("load", { timeout: 45000 }).catch(() => {}),
          page.click(idOf("ctl00$MainContentArea$lvLogin$Login1$LoginButton")),
        ]);
        await page.waitForTimeout(1500);
      }
      out.loggedIn = !(await page.locator('input[type="password"]:visible').count());
      out.landed = new URL(page.url()).pathname;
      if (!out.loggedIn) return { ...out, stage: "login", why: "Arion still shows its login box after the login was sent" };

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
          await page.waitForTimeout(3000);
          out.afterSelect = await shapeOf(page);
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
    if (exact.length) live = exact;
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
