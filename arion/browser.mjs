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
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    const interesting = [...document.querySelectorAll('[id*="SearchControl"], [id*="ModalDialog"], [id*="gvHorses"], [id*="gvMyReport"]')];
    return {
      url: location.pathname,
      title: document.title,
      // the login box is markup on every page; it only means something when shown
      loginShown: [...document.querySelectorAll('input[type="password"]')].some(visible),
      found: interesting.map((el) => {
        const rows = [...el.querySelectorAll("tr")];
        return {
          id: el.id,
          tag: el.tagName.toLowerCase(),
          visible: visible(el),
          rows: rows.length,
          // every row's cells, so a candidate's name, year and parents can be
          // read however Arion lays them out
          sample: rows.slice(0, 12).map((tr) => ({
            cells: [...tr.querySelectorAll("td, th")].map((td) => td.innerText.trim()).filter(Boolean),
            posts: [...tr.querySelectorAll("a[href*='__doPostBack'], a[href*='WebForm_DoPostBack'], input[type=radio]")].length,
          })),
        };
      }),
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
export async function probe({ env = process.env, name = "Frankel", kind = "named" } = {}) {
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

      out.beforeSearch = await shapeOf(page);

      // the box, then the button a person presses — not the hidden Enter-key
      // submit the fetch client was pressing
      const box = { named: "txtNamedHorse", dam: "txtUnnamedHorse" }[kind] ?? "txtNamedHorse";
      await page.fill(idOf(`ctl00$MainContentArea$${box}`), name);
      await page.click(idOf(`ctl00$MainContentArea$btnSearch${kind === "dam" ? "UnnamedHorse" : "NamedHorse"}`));

      // a dialog, or the page settling without one
      await page
        .waitForSelector('[id*="SearchControl"] tr, [id*="gvHorses"] tr', { state: "visible", timeout: 20000 })
        .catch(() => {});
      await page.waitForTimeout(1200);

      out.afterSearch = await shapeOf(page);

      // My Reports in the same visit. The fetch client reads that grid as
      // empty although the page's own pager advertises nine pages of it, so
      // its real shape is needed too — and gathering it here saves a second
      // deploy to come back for it. Opening a tab touches no report menu.
      try {
        const tab = page.getByText(/^\s*my reports\s*$/i).first();
        if (await tab.count()) {
          await tab.click({ timeout: 8000 });
          await page.waitForTimeout(1800);
        }
        out.myReportsTab = { opened: Boolean(await tab.count()), ...(await shapeOf(page)) };
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
