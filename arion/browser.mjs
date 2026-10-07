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

import { ArionError, LOGIN_PATH, ORIGIN, REPORTS_PATH, relayHtml } from "./client.mjs";

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

/**
 * Make one report and look at every step of it, for checking the client
 * against the live site. `mode` is the order tried:
 *
 *   before — the report chosen in the sidebar on a clean page, then the
 *            search, then the horse opened
 *   after  — the horse opened, then the report chosen (Arion's "are you
 *            sure" answered yes if it asks)
 *   field  — the sidebar's hidden field written just before the horse is
 *            opened, the way the horse's own postback would carry it
 *
 * Each step reports what the sidebar holds, the files and frames on the page,
 * any box on screen, and a screenshot. It makes real reports — the desk's
 * subscription is not metered — in a browser of its own, so the one jobs keep
 * is not disturbed.
 */
export async function reportProbe({ env = process.env, mode = "after", kind = "theoretical", name = "", sire = "", dam = "", year = null, country = "", reportId = "", label = "" } = {}) {
  if (!env.ARION_USERNAME || !env.ARION_PASSWORD) return { ok: false, why: "ARION_USERNAME and ARION_PASSWORD are not set on this service" };
  return withBrowser(async (page) => {
    const steps = [];
    const captured = await keepReportFiles(page);
    const look = async (step, extra = {}) => {
      const built = await reportOn(page).catch(() => ({ files: [], frames: [], loading: null }));
      const shape = await shapeOf(page).catch(() => ({ modals: [] }));
      steps.push({
        step,
        at: new Date().toISOString(),
        menu: await menuHolds(page),
        named: built.files.flatMap((f) => filesFrom(f.value)).map((f) => f.name),
        frames: await framesNow(page, built.frames),
        loading: built.loading,
        modals: shape.modals.filter((m) => m.shown).map((m) => m.text.slice(0, 160)),
        ...extra,
        shot: (await page.screenshot({ type: "jpeg", quality: 40 }).catch(() => Buffer.from(""))).toString("base64"),
      });
    };
    try {
      await page.goto(`${ORIGIN}${REPORTS_PATH}`, { waitUntil: "load", timeout: 45000 });
      if (!(await signedIn(page)).yes) await signIn(page, env.ARION_USERNAME, env.ARION_PASSWORD);
      await reloadReports(page);
      const item = menuItem(page, label);
      const clicked = await item
        .evaluate((el) => ({
          tag: el.tagName,
          id: el.id || null,
          cls: String(el.className || "") || null,
          href: (el.getAttribute("href") || el.closest("a")?.getAttribute("href") || "").slice(0, 200),
          onclick: (el.getAttribute("onclick") || el.closest("[onclick]")?.getAttribute("onclick") || "").slice(0, 200),
        }))
        .catch((err) => ({ missing: err.message.slice(0, 120) }));
      await look("signed in", { clicked });

      if (mode === "before" || mode === "watch") {
        await chooseReport(page, label);
        await look("chose before opening");
      }
      const values = { kind, name, sire, dam };
      const found = kind === "theoretical" ? await matingDialog(page, values) : { candidates: (await runSearch(page, values)) ?? [] };
      const horses = found.candidates ?? [];
      const pick = pickCandidate(horses, { name: kind === "theoretical" ? dam : name, year, country }).one ?? horses[0] ?? null;
      if (!pick) {
        await look("no horse", { stage: found.stage ?? null });
        return { ok: false, why: "Arion listed no horse to open", mode, steps };
      }
      await look("searched", { horse: pick.label });
      if (mode === "field") await holdReport(page, reportId);
      await openHorse(page, pick.link);
      await look("opened");

      if (mode === "watch") {
        // Every two seconds for two minutes: what the hidden field says, what
        // each frame is showing and whether it has finished, and whether the
        // files the field names can actually be had yet.
        const timeline = [];
        const t0 = Date.now();
        let doneAt = null;
        for (let i = 0; i < 60; i += 1) {
          const state = await frameStates(page);
          const urls = [
            ...state.fields.flatMap((v) => filesFrom(v).map((f) => f.url)),
            ...state.frames.map((f) => f.href).filter((h) => /\/files\/reports\//i.test(h)),
          ];
          const fetched = [];
          for (const u of [...new Set(urls)]) {
            const res = await page.request.get(u, { timeout: 15000 }).catch(() => null);
            fetched.push({ file: u.split("/").pop(), status: res ? res.status() : "error", type: res ? res.headers()["content-type"] ?? null : null });
          }
          const kept = [...captured].map(([u, got]) => ({ file: u.split("/").pop(), status: got.status, type: got.type, bytes: got.body?.length ?? 0 }));
          timeline.push({ s: Math.round((Date.now() - t0) / 1000), ...state, fetched, kept, error: onArionError(page) });
          const ready =
            kept.some((k) => k.status === 200 && /\.pdf$/i.test(k.file)) ||
            state.frames.some((f) => /ReportLoader/i.test(f.href) && f.ready === "complete" && !f.loading && f.text > 200) ||
            onArionError(page);
          if (ready && doneAt === null) doneAt = i;
          if (doneAt !== null && i - doneAt >= 3) break; // three more looks after it is done
          await page.waitForTimeout(2000);
        }
        const frame = page.locator('iframe[src*="ReportLoader"]').first();
        const frameShot = (await frame.screenshot({ type: "jpeg", quality: 50 }).catch(() => Buffer.from(""))).toString("base64");
        await look("watched", { timeline, frameShot });
      }

      if (mode === "after") {
        await chooseReport(page, label);
        const want = reportParts(reportId);
        let asked = false;
        for (let i = 0; i < 60; i += 1) {
          if (want && (await reportShown(page, want, null))) break;
          const yes = asked ? null : await shownYes(page);
          if (yes) {
            await yes.click({ timeout: 10000 }).catch(() => {});
            asked = true;
          }
          await page.waitForTimeout(300);
        }
        await look("chose after opening", { asked });
      }
      return { ok: true, mode, steps };
    } catch (err) {
      await look("failed", { why: err.message }).catch(() => {});
      return { ok: false, why: err.message, mode, steps };
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
      const captured = await keepReportFiles(page);
      kept = { browser, page, info: { chromium: chosen, version: browser.version() }, timer: null, showing: null, captured };
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
  await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {});
  await settled(page);
  await page.waitForTimeout(1200);
  if (onArionError(page)) {
    throw new ArionError("Arion answered opening that horse with its own error page; try again", { status: 502, code: "arion-error" });
  }
  return steadily(page, () => reportOn(page));
}

/** Arion's own error page, which a postback it could not handle lands on. */
export const onArionError = (page) => /ArionError\.aspx/i.test(String(page.url?.() ?? ""));

/**
 * Read the page, and read it again if a navigation took the first try away.
 * Opening a horse can reload the whole page under a read in progress.
 */
export async function steadily(page, read, { tries = 3 } = {}) {
  for (let i = 1; ; i += 1) {
    try {
      return await read();
    } catch (err) {
      if (i >= tries || !/context was destroyed|because of a navigation|frame was detached/i.test(String(err?.message ?? err))) throw err;
      await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
  }
}

/**
 * Keep a copy of every report file the page itself loads.
 *
 * Arion hands a report's PDF to the frame that shows it and to nothing else:
 * on the live site the same address, asked for again by the same session a
 * second later, answered 404 for as long as anyone asked, while the frame was
 * showing it — the 404 the desk saw. The RTF, which no frame loads, answers
 * normally. So the frame's own request goes through as it is, its answer is
 * handed on unchanged, and a copy is kept.
 */
export async function keepReportFiles(page, store = new Map(), { max = 24 } = {}) {
  await page.route(/\/files\/reports\//i, async (route) => {
    try {
      const res = await route.fetch();
      const body = await res.body();
      store.set(route.request().url(), {
        status: res.status(),
        type: String(res.headers()["content-type"] ?? "").split(";")[0].trim(),
        body,
        at: Date.now(),
      });
      while (store.size > max) store.delete(store.keys().next().value);
      await route.fulfill({ response: res, body });
    } catch {
      await route.continue().catch(() => {});
    }
  });
  return store;
}

/** A kept copy of a file the page loaded, waited for a moment if it is not there yet. */
export async function keptFile(store, wanted, { wait = 8000, poll = 250 } = {}) {
  const until = Date.now() + wait;
  for (;;) {
    for (const [url, got] of store) {
      if (got.status === 200 && got.body?.length && wanted(url, got)) {
        const name = decodeURIComponent(url.split("?")[0].split("/").pop());
        return { kind: /\.rtf$/i.test(name) ? "rtf" : "pdf", name, url, type: got.type || "application/pdf", body: got.body, from: "frame" };
      }
    }
    if (Date.now() >= until) return null;
    await new Promise((r) => setTimeout(r, poll));
  }
}

/**
 * Choose a report from the sidebar by the name Arion prints there, which is
 * the same name REPORTS carries. Clicking the menu is what sets
 * hiddenMenuItemId; nothing here writes that field by hand.
 */
/** The sidebar's entry for a report, by the name Arion prints there. */
export const menuItem = (page, label) =>
  page
    .locator("a, span, li, td")
    .filter({ hasText: new RegExp(`^\\s*${String(label ?? "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i") })
    .first();

export async function chooseReport(page, label) {
  const wanted = String(label ?? "").trim();
  if (!wanted) return { chosen: false, why: "no report named" };
  const item = menuItem(page, wanted);
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
 * The page printed to one PDF page the size of what it shows, as it looks on
 * screen — a pedigree is wider than A4, and paper sizes would cut it up — or
 * null when it shows a login, or next to nothing.
 */
async function printed(p, { name, url }) {
  const looks = await p.evaluate(() => ({
    words: (document.body?.textContent ?? "").replace(/\s+/g, " ").trim().length,
    login: Boolean(document.querySelector('input[type="password"]')),
  }));
  if (looks.login || looks.words < 200) return null;
  await p.emulateMedia({ media: "screen" }).catch(() => {});
  const size = await p.evaluate(() => ({
    w: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
    h: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
  }));
  const px = (v, lo, hi) => `${Math.min(Math.max(Math.ceil(v) + 32, lo), hi)}px`;
  const body = await p.pdf({ width: px(size.w, 600, 4000), height: px(size.h, 400, 8000), printBackground: true, pageRanges: "1" });
  return { kind: "pdf", name: `${name}.pdf`, url, type: "application/pdf", body, from: "drawn" };
}

/**
 * A report Arion draws rather than files — the Internet pedigrees — taken
 * from its frame as drawn, and printed. Loading the frame's address afresh
 * does not work: on the live site it never finished drawing on its own. The
 * copy is made at Arion's own address, so its styles and pictures come with
 * the session, and with its scripts taken out, so nothing in it starts over.
 */
export async function drawnAsFile(page, src, { name = "arion-report" } = {}) {
  const frame = page.frames().find((f) => f.url() === src) ?? page.frames().find((f) => /ReportLoader\.aspx/i.test(f.url()));
  if (!frame) return null;
  const html = await frame.content().catch(() => null);
  if (!html) return null;
  const p = await page.context().newPage();
  try {
    await p.goto(new URL("/robots.txt", frame.url()).href, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await p.setContent(relayHtml(html, frame.url()), { waitUntil: "load", timeout: 30000 });
    await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    return await printed(p, { name, url: src });
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

/**
 * The report area as it stands: the hidden file fields' raw values, and each
 * frame's address (attribute and live), whether its document has finished,
 * how much text it holds, and whether it still says "Loading Report".
 */
export async function frameStates(page) {
  return page
    .evaluate(() => ({
      fields: [...document.querySelectorAll('input[id*="hdnReportFileName"]')].map((el) => el.value || "").filter(Boolean),
      frames: [...document.querySelectorAll("iframe")].map((f) => {
        let href = null;
        let doc = null;
        try {
          href = f.contentWindow.location.href;
          doc = f.contentDocument;
        } catch {
          /* another site's frame */
        }
        const text = (doc?.body?.textContent ?? "").replace(/\s+/g, " ").trim();
        return {
          src: (f.getAttribute("src") || "").slice(0, 220),
          href: (href || "").slice(0, 220),
          ready: doc?.readyState ?? null,
          text: text.length,
          loading: /Loading Report/i.test(text),
          head: text.slice(0, 120),
        };
      }),
      pageLoading: /Loading Report/i.test(document.body?.textContent ?? ""),
    }))
    .catch((err) => ({ fields: [], frames: [], why: String(err?.message ?? err).slice(0, 120) }));
}

/** Arion's own "are you sure", if it is on screen. */
async function shownYes(page) {
  const all = page.locator(`${idOf("ctl00$btnYes")}, a:text-is("Yes"), button:text-is("Yes"), input[value="Yes"]`);
  const n = await all.count().catch(() => 0);
  for (let i = 0; i < n; i += 1) if (await all.nth(i).isVisible().catch(() => false)) return all.nth(i);
  return null;
}

/**
 * Has the report been built, and how? "file" when the report frame has gone
 * on to the file carrying the report's menu number — the catalogue styles
 * are written to PDF, and the frame shows it once it is written — or "drawn"
 * when a report frame of its type has finished drawing and holds a report,
 * which is all an Internet pedigree ever is. Otherwise null.
 *
 * The hidden field's file names are no sign: Arion writes them about ten
 * seconds before the files exist, and they answer 404 until then.
 */
async function builtNow(page, { type, value, n }) {
  return page
    .evaluate(
      ({ type, value, n }) => {
        const mine = new RegExp(`report-${n}_`, "i");
        for (const f of document.querySelectorAll("iframe")) {
          let href = "";
          let doc = null;
          try {
            href = f.contentWindow.location.href;
            doc = f.contentDocument;
          } catch {
            /* another site's frame */
          }
          const src = href && href !== "about:blank" ? href : f.getAttribute("src") || "";
          if (/\/files\/reports\//i.test(src) && mine.test(src)) return "file";
          if (!/ReportLoader\.aspx/i.test(src)) continue;
          let q;
          try {
            q = new URL(src, location.href).searchParams;
          } catch {
            continue;
          }
          const v = q.get("MainParameterValue") ?? q.get("Style");
          if ((q.get("ReportType") || "").toUpperCase() !== type || (v !== null && v !== value)) continue;
          const text = (doc?.body?.textContent ?? "").replace(/\s+/g, " ").trim();
          if (doc?.readyState === "complete" && !/Loading Report/i.test(text) && text.length > 200) return "drawn";
        }
        return null;
      },
      { type, value, n },
    )
    .catch(() => null);
}

/**
 * Wait for the report asked for to be built, not for a clock: Arion shows
 * "Loading Report..." for as long as it takes. A report that is drawn and
 * filed both is given a moment for its files, which are the better copy.
 * Arion's "are you sure" is answered yes if it ever asks: the desk said yes
 * by pressing Generate.
 */
export async function waitForBuilt(page, reportId, { timeout = 60000, poll = 400, grace = 3000, captured = null, since = 0 } = {}) {
  const want = reportParts(reportId);
  if (!want) return { built: null, asked: false };
  const mine = new RegExp(`report-${want.n}_`, "i");
  let asked = false;
  let drawnAt = null;
  const until = Date.now() + timeout;
  for (;;) {
    if (onArionError(page)) return { built: "error", asked };
    // a copy of the report's own file, kept as the frame loaded it
    if (captured && [...captured].some(([url, got]) => got.at >= since && got.status === 200 && mine.test(url))) return { built: "file", asked };
    const now = await builtNow(page, want);
    if (now === "file") return { built: "file", asked };
    if (now === "drawn") {
      drawnAt ??= Date.now();
      if (Date.now() - drawnAt >= grace) return { built: "drawn", asked };
    }
    if (!asked) {
      const yes = await shownYes(page);
      if (yes) {
        await yes.click({ timeout: 10000 }).catch(() => {});
        asked = true;
        continue;
      }
    }
    if (Date.now() >= until) return { built: drawnAt ? "drawn" : null, asked };
    await page.waitForTimeout(poll);
  }
}

/**
 * Put a report in the sidebar's hands, as clicking its menu entry does.
 *
 * Arion builds whatever report the sidebar holds at the moment a horse is
 * opened, and does not build again when the sidebar changes afterwards: seen
 * on the live site, a Standard pedigree chosen after opening left the WI
 * style on screen with nothing rebuilt, while the same choice made before
 * opening — by the menu, or by this field — built the Standard pedigree. The
 * field is written because the search's dialog may still be open over the
 * menu. It is read back, so a page that would not take it says so.
 */
export async function holdReport(page, reportId) {
  return page
    .evaluate((id) => {
      const f = document.querySelector('input[id*="hiddenMenuItemId"]');
      if (!f) return null;
      f.value = id;
      return f.value;
    }, reportId)
    .catch(() => null);
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
    // Arion builds the report its sidebar holds at the moment a horse is
    // opened, and does not build again when the sidebar changes after: on the
    // live site a Standard pedigree chosen after opening left the WI style on
    // screen, while the same choice made first built it. Writing the
    // sidebar's field by hand instead once landed on Arion's error page. So
    // the report is chosen in Arion's own menu, before the horse is opened.
    const showing = s.showing;
    s.showing = null; // opening a horse closes the dialog, whatever follows
    const before = await menuHolds(page);
    // The search's dialog is used only if the sidebar already holds the
    // report — the menu cannot be reached past the dialog — and only if it is
    // the same search and lists this horse now, by name, year and country,
    // read off the page: never a control id from before.
    let found = null;
    if (before === reportId && showing && showing.key === searchKey(values, sire) && Date.now() - showing.at < STAY_MS) {
      found = ((await candidatesOn(page)) ?? []).find((h) => sameHorse(h, horse)) ?? null;
      if (found && !(await page.locator(`#${found.link}`).isVisible().catch(() => false))) found = null;
    }
    lap("check");

    let since = Date.now();
    let opened = null;
    if (found) {
      opened = await openHorse(page, found.link);
      lap("open");
      // The dialog looked right and opened nothing — no report frame, no
      // file — so it is done the long way, once. Any frame will not do: a
      // banner is a frame too.
      if (!opened.files.length && !frameFor(await framesNow(page, opened.frames), null)) opened = null;
    }
    const reused = Boolean(opened);
    let chose = { chosen: before === reportId, already: before === reportId };
    if (!opened) {
      await reloadReports(page, s);
      if ((await menuHolds(page)) !== reportId) {
        chose = await chooseReport(page, label);
        if (!chose.chosen) throw new ArionError(`Arion's menu offers no "${label}"`, { status: 409, code: "menu" });
      }
      lap("choose");
      // A control id from another visit means nothing in this one, so the
      // search is run and the same horse found by name, year and country.
      const again =
        values.kind === "theoretical"
          ? (await matingDialog(page, { ...values, sireIs: sire })).candidates
          : (await runSearch(page, values)) ?? [];
      const one = again.find((h) => sameHorse(h, horse));
      if (!one) {
        throw new ArionError(`Arion no longer offers ${horse.label ?? horse.name} for that search; search again`, { status: 409, code: "session" });
      }
      lap("search");
      since = Date.now();
      opened = await openHorse(page, one.link);
      lap("open");
    }
    const held = await steadily(page, () => menuHolds(page));

    const waited = await waitForBuilt(page, reportId, { captured: s.captured, since });
    lap("build");
    if (waited.built === "error") {
      throw new ArionError("Arion answered with its own error page while building the report; try again", { status: 502, code: "arion-error" });
    }
    const built = await steadily(page, () => reportOn(page));
    built.frames = await framesNow(page, built.frames);
    const names = new Set();
    const named = [...built.files.flatMap((f) => filesFrom(f.value)), ...filesShown(built.frames)].filter((f) => !names.has(f.name) && names.add(f.name));
    const ours = (name) => madeAs(name, reportId);
    // The PDF as the frame was handed it — the only copy Arion gives out —
    // and the rest by address, now that they are written.
    const pdf = await keptFile(s.captured, (url, got) => got.at >= since && /\.pdf(\?|$)/i.test(url) && ours(decodeURIComponent(url.split("?")[0].split("/").pop())), {
      wait: waited.built === "file" ? 8000 : 0,
    });
    const tried = await fetchFiles(page, named.filter((f) => ours(f.name) && !(pdf && f.kind === "pdf")));
    let files = [pdf, ...tried.filter((f) => f.body)].filter(Boolean);
    lap("files");
    // No file: a report Arion only draws is printed from its frame, as drawn.
    const frame = files.length ? null : frameFor(built.frames, reportId);
    if (frame && waited.built === "drawn") {
      const subject = sire ? `${sire.label} x ${horse.label}` : horse.label ?? horse.name;
      const drawn = await drawnAsFile(page, frame, { name: fileName(`${subject} - ${label}`) });
      if (drawn) files = [drawn];
      lap("draw");
    }
    return {
      chose,
      tabs: built.tabs,
      horseId: horseIdFrom(built.frames),
      files,
      reused,
      steps: lap.spent,
      menu: { before, held },
      // what Arion offered, so a report that comes back without a file says why
      seen: {
        waited,
        modals: waited.built ? undefined : (await shapeOf(page)).modals.filter((m) => m.shown).map((m) => m.text.slice(0, 200)),
        named: named.map((f) => f.name),
        kept: [...s.captured].filter(([, got]) => got.at >= since).map(([url, got]) => ({ file: url.split("/").pop(), status: got.status, bytes: got.body?.length ?? 0 })),
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
  return withSession(async (page, info, s) => {
    // Newest first, so a report made lately is a page or two in, not eighteen.
    const found = (await myReportsOn(page, { until: (r) => sameReport(r, report) }))?.found ?? null;
    if (!found) {
      throw new ArionError(`${report.label ?? report.horse} is no longer under My Reports; open the list again`, { status: 409, code: "session" });
    }
    if (!found.link) {
      throw new ArionError(`Arion offers no way to open ${found.label} from its list; open it on Arion`, { status: 409, code: "session" });
    }
    const since = Date.now();
    await page.click(`#${found.link}`, { timeout: 20000 });
    await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {});
    await settled(page);
    if (onArionError(page)) throw new ArionError("Arion answered opening that report with its own error page; try again", { status: 502, code: "arion-error" });
    // The PDF as the frame was handed it, which is the only copy Arion gives
    // out; the RTF by its address.
    const pdf = await keptFile(s.captured, (url, got) => got.at >= since && /\.pdf(\?|$)/i.test(url), { wait: 30000 });
    const built = await steadily(page, () => reportOn(page));
    built.frames = await framesNow(page, built.frames);
    const rtf = (await fetchFiles(page, built.files.flatMap((f) => filesFrom(f.value)).filter((f) => f.kind === "rtf"))).filter((f) => f.body);
    let files = [pdf, ...rtf].filter(Boolean);
    if (!files.length) {
      const frame = frameFor(built.frames, null);
      const drawn = frame ? await drawnAsFile(page, frame, { name: fileName(found.label) }) : null;
      if (drawn) files = [drawn];
    }
    return { files, tabs: built.tabs };
  }, { env });
}
