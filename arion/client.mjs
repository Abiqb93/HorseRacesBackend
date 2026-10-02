/**
 * Arion's pedigree reports, searched and bought from inside the site.
 *
 * The desk holds an annual Arion subscription (arion.co.nz): catalogue-style
 * pedigree pages, standard pedigrees, pedigree grids and the rest, each
 * priced in credits (1 credit = NZ$1). Until now a report meant leaving the
 * site, logging in to Arion and searching for the horse again. This drives
 * Arion's own Pedigree Reports page from the server with the company login,
 * so the site can offer the same searches and the same reports in place.
 *
 * ## The login
 *
 * Only from the environment — ARION_USERNAME and ARION_PASSWORD, set on the
 * server (Railway) — never in code and never in the browser. Without them
 * every call answers `configured: false` and the site offers Arion's own page
 * in a new tab instead. The password goes to Arion and nowhere else: it is
 * never logged, never returned, and no error message carries it.
 *
 * ## How Arion works, and so how this does
 *
 * Arion is an ASP.NET WebForms site. A page is one form, and every button
 * posts the whole form back to the page with its hidden state (__VIEWSTATE,
 * __EVENTVALIDATION) and the control that was pressed (__EVENTTARGET, or a
 * submit button's own name). Each step here is therefore what a person does:
 * take the form the last page handed back, fill in what they would, name the
 * control they would press, post it, and read the page that comes back.
 *
 *   - The bare host, arion.co.nz. www.arion.co.nz sits behind a Cloudflare
 *     challenge that a server cannot answer; the bare host serves the same
 *     site without it. A challenge, should one appear, is reported as such.
 *   - One cookie jar per process, holding Arion's session and the cookie its
 *     first answer sets (a 302 back to the same page, to see cookies work).
 *   - One step at a time. Each step posts back the page state the last one
 *     left, so two people's searches must not interleave.
 *   - A session that has timed out shows as the login form where the report
 *     page should be: the client logs in again and repeats the step, once.
 *
 * ## What costs money
 *
 * Searching costs nothing. A report costs its price in credits, from Arion's
 * price list (the General tab of the same page, read afresh as the page is
 * read, REPORTS below until then). A report is only asked for with
 * `confirm: true` and the price the person was shown, and only while the day's
 * count is under ARION_DAILY_LIMIT (25 unless set), so a slip cannot empty
 * the account.
 *
 * ## What is known and what is not
 *
 * The public page shows the form, the report menu, the price list and the
 * five report tabs a generated report lands in (a file name, a "Save As HTML"
 * link and Arion's print page, /PrintReport.aspx?FileName=). The search
 * results and a filled report tab are only seen logged in, so they are read
 * generously: any row of the search dialog that carries a postback is a
 * candidate, and any address a report tab names is a report. `describePage`
 * reports a page's shape — fields, controls, links, never values — so the
 * first live run can be checked (GET /api/arion/diagnose).
 */

export const ORIGIN = "https://arion.co.nz";
export const REPORTS_PATH = "/PedigreeReports/PedigreeReports.aspx";
const LOGIN_PATH = "/Login.aspx";
const UA = "Mozilla/5.0 (compatible; BlandfordBloodstock/1.0; +https://www.blandfordbloodstock.tech)";

/**
 * The reports the Pedigree Reports page offers, by the id of their menu entry,
 * with the price its General tab gives (October 2026). Prices are re-read from
 * the page whenever it is fetched.
 */
export const REPORTS = [
  { id: "PED02|0#5D_a", label: "Standard pedigree", group: "Internet pedigree", credits: 35 },
  { id: "PED02|9#22D_a", label: "Standard Pedigree (wide)", group: "Internet pedigree", credits: 35 },
  { id: "PED01|I#3S_a", label: "WI style", group: "Catalogue style", credits: 40 },
  { id: "PED01|I4N#25S_a", label: "WI style (wide)", group: "Catalogue style", credits: 40 },
  { id: "PED01|S#21S_a", label: "WI style (with sales data)", group: "Catalogue style", credits: 45 },
  { id: "PED01|I4#24S_a", label: "WI style (wide + sales data)", group: "Catalogue style", credits: 45 },
  { id: "PED01|M#2S_a", label: "MM style", group: "Catalogue style", credits: 40 },
  { id: "PED01|M4#23S_a", label: "MM style (wide)", group: "Catalogue style", credits: 40 },
  { id: "PED01|M4S#36S_a", label: "MM style (wide + sales data)", group: "Catalogue style", credits: 40 },
  { id: "PED01|N#1S_a", label: "NZB style", group: "Catalogue style", credits: 40 },
  { id: "PED01|N4#26S_a", label: "NZB style (wide)", group: "Catalogue style", credits: 40 },
  { id: "PED01|I4N#27S_a", label: "WI 6 generation", group: "Catalogue style", credits: 40 },
  { id: "PED01|A4#28S_a", label: "Mare Book pedigree", group: "Catalogue style", credits: 40 },
  { id: "PED01|ZTT#30S_a", label: "Tatts style", group: "Catalogue style", credits: 40 },
  { id: "PED05|44#9D_a", label: "4x4", group: "Pedigree grid", credits: 1 },
  { id: "PED05|55#10D_a", label: "5x5", group: "Pedigree grid", credits: 1 },
  { id: "PED05|66#11D_a", label: "6x6", group: "Pedigree grid", credits: 2 },
  { id: "PED05|77#12D_a", label: "7x7", group: "Pedigree grid", credits: 3 },
];

/** The three searches the page offers, by the box filled and the button pressed. */
export const SEARCHES = {
  // a horse by its name
  named: { fields: { name: "ctl00$MainContentArea$txtNamedHorse" }, button: "ctl00$MainContentArea$btnSearchNamedHorseDefault" },
  // an unnamed horse, found by its dam
  dam: { fields: { dam: "ctl00$MainContentArea$txtUnnamedHorse" }, button: "ctl00$MainContentArea$btnSearchUnnamedHorseDefault" },
  // a theoretical horse: a sire and a dam that have not been mated
  theoretical: {
    fields: { sire: "ctl00$MainContentArea$txtSireName", dam: "ctl00$MainContentArea$txtDamName" },
    button: "ctl00$MainContentArea$btnSearchDamHorseDefault",
  },
};

const MENU_FIELD = "ctl00$MainContentArea$hiddenMenuItemId";
const LOGIN_FIELDS = {
  user: "ctl00$MainContentArea$lvLogin$Login1$UserName",
  password: "ctl00$MainContentArea$lvLogin$Login1$Password",
  button: "ctl00$MainContentArea$lvLogin$Login1$btnLoginDefault",
};

export class ArionError extends Error {
  constructor(message, { status = 502, code = "arion" } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ------------------------------------------------------------ reading pages */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
export const decode = (s) =>
  String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Visible text of a fragment, on one line. */
export const textOf = (html) =>
  decode(
    String(html ?? "")
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();

/** A tag's attributes, lower-cased names, decoded values. */
export function attrs(tag) {
  const out = {};
  for (const m of String(tag).matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g)) {
    const name = m[1].toLowerCase();
    if (name === tag.match(/^<\s*([a-zA-Z0-9]+)/)?.[1]?.toLowerCase()) continue;
    const raw = m[2] ?? "";
    out[name] = decode(raw.replace(/^["']|["']$/g, ""));
  }
  return out;
}

/**
 * The page's form as a browser would post it: every hidden and text field
 * with its value, checked boxes, chosen options — but no button, since only
 * the one pressed is sent.
 */
export function parseForm(html) {
  const s = String(html ?? "");
  const form = s.match(/<form\b[^>]*>/i);
  const fields = {};
  for (const m of s.matchAll(/<input\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (!a.name) continue;
    const type = (a.type || "text").toLowerCase();
    if (["submit", "button", "image", "reset", "file"].includes(type)) continue;
    if ((type === "checkbox" || type === "radio") && !("checked" in a)) continue;
    fields[a.name] = a.value ?? (type === "checkbox" ? "on" : "");
  }
  for (const m of s.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const a = attrs(`<select ${m[1]}>`);
    if (!a.name) continue;
    const opts = [...m[2].matchAll(/<option\b[^>]*>/gi)].map((o) => attrs(o[0]));
    const chosen = opts.find((o) => "selected" in o) ?? opts[0];
    if (chosen) fields[a.name] = chosen.value ?? "";
  }
  for (const m of s.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const a = attrs(`<textarea ${m[1]}>`);
    if (a.name) fields[a.name] = decode(m[2]);
  }
  return { action: form ? attrs(form[0]).action ?? null : null, fields };
}

/** A submit button's own value, which goes with its name when it is pressed. */
export function buttonValue(html, name) {
  for (const m of String(html ?? "").matchAll(/<input\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (a.name === name) return a.value ?? "";
  }
  return null;
}

/** Whether the page asks for a password: logged out, or the login was refused. */
export const asksForLogin = (html) => /type\s*=\s*["']?password/i.test(String(html ?? "")) && /\$Password["']/i.test(String(html ?? ""));

/** The message Arion gives a refused login, if any. */
export function loginFailure(html) {
  const m = String(html ?? "").match(/<[^>]+id="[^"]*FailureText[^"]*"[^>]*>([\s\S]*?)<\//i);
  const t = m ? textOf(m[1]) : "";
  return t || null;
}

/** A Cloudflare challenge rather than Arion's page. */
export const isChallenge = (status, html, headers = {}) =>
  (status === 403 || status === 503) &&
  (/cf-chl|challenge-platform|Just a moment|Attention Required|cf_chl_opt/i.test(String(html ?? "")) || Boolean(headers["cf-ray"] || headers["cf-mitigated"]));

/**
 * Every postback a page offers, with the text around it: __doPostBack('t','a')
 * in links, and WebForm_DoPostBackWithOptions(new WebForm_PostBackOptions("t",
 * "a", ...)) in buttons and links.
 */
export function postbacks(html) {
  const s = decode(String(html ?? ""));
  const out = [];
  const re = /__doPostBack\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)|WebForm_PostBackOptions\(\s*"([^"]*)"\s*,\s*"([^"]*)"/g;
  for (const m of s.matchAll(re)) {
    out.push({ target: m[1] ?? m[3], argument: m[2] ?? m[4] ?? "", at: m.index });
  }
  return out;
}

/**
 * The search dialog's choices: each row of the dialog that carries a
 * postback, with the row's own text — a horse's name, year, country and
 * parents, however Arion lays them out. Radio buttons count too.
 */
export function parseCandidates(html) {
  const s = String(html ?? "");
  // only inside the search dialog: the page around it has postback rows of
  // its own (My Reports) that are not search results
  const start = s.search(/ArionNamedHorseSearchControl/i);
  if (start < 0) return [];
  const rest = s.slice(start);
  const end = rest.search(/ModalDialogArea[_$]btnLaunchModal|TabMyReports|tabbedReport_tabs_TabHorseReport|<\/form>/i);
  const scope = end > 0 ? rest.slice(0, end) : rest;
  const out = [];
  const seen = new Set();
  for (const row of scope.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const pb = postbacks(row[1]).find((p) => !/btnYes|btnNo|lnkClose|imgClose|btnLaunchModal|Page\$|Sort\$/i.test(p.target + p.argument));
    const radio = [...row[1].matchAll(/<input\b[^>]*type\s*=\s*["']?radio[^>]*>/gi)].map((r) => attrs(r[0]))[0];
    if (!pb && !radio) continue;
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => textOf(c[1])).filter(Boolean);
    const label = cells.join(" · ") || textOf(row[1]);
    if (!label) continue;
    const key = pb ? `pb:${pb.target}|${pb.argument}` : `radio:${radio.name}|${radio.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, cells, ...(pb ? { target: pb.target, argument: pb.argument } : { radio: { name: radio.name, value: radio.value } }) });
  }
  return out;
}

/** The price list on the General tab: each report's name and its credits. */
export function parsePrices(html) {
  const out = new Map();
  for (const row of String(html ?? "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const name = row[1].match(/<td\b[^>]*class="name"[^>]*>([\s\S]*?)<\/td>/i);
    const cost = row[1].match(/<td\b[^>]*class="cost"[^>]*>([\s\S]*?)<\/td>/i);
    if (!name || !cost) continue;
    const credits = Number(textOf(cost[1]));
    const label = textOf(name[1]);
    if (label && Number.isFinite(credits) && textOf(cost[1]) !== "") out.set(label.toLowerCase(), credits);
  }
  return out;
}

/** REPORTS with the prices the page now gives. */
export function pricedReports(html) {
  const prices = parsePrices(html);
  return REPORTS.map((r) => ({ ...r, credits: prices.get(r.label.toLowerCase()) ?? r.credits }));
}

/**
 * The reports a page holds: every address a report tab names — its file
 * (through Arion's print page), its "Save As" links and its frame — as
 * absolute addresses on Arion's host.
 */
export function parseReportFiles(html) {
  const s = String(html ?? "");
  const files = [];
  const add = (kind, href, tab) => {
    if (!href || /^javascript:/i.test(href) || href === "#") return;
    let u;
    try {
      u = new URL(href, `${ORIGIN}${REPORTS_PATH}`);
    } catch {
      return;
    }
    if (u.hostname !== new URL(ORIGIN).hostname) return;
    if (!files.some((f) => f.url === u.href)) files.push({ kind, url: u.href, tab });
  };
  for (const m of s.matchAll(/<input\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const tab = a.name?.match(/TabHorseReport(\d+)/)?.[1];
    if (/hdnReportFileName$/.test(a.name ?? "") && a.value) add("print", `/PrintReport.aspx?FileName=${encodeURIComponent(a.value)}`, Number(tab));
  }
  for (const m of s.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const a = attrs(m[0].match(/<a\b[^>]*>/i)[0]);
    const tab = a.id?.match(/TabHorseReport(\d+)/)?.[1];
    if (tab && /hlSave|hlView|hlOpen|hlDownload/i.test(a.id ?? "")) add(/html/i.test(a.id + textOf(m[1])) ? "html" : "file", a.href, Number(tab));
  }
  for (const m of s.matchAll(/<iframe\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const tab = a.id?.match(/TabHorseReport(\d+)/)?.[1];
    if (tab && a.src) add("frame", a.src, Number(tab));
  }
  return files;
}

/** The report tabs' own titles: the horse and report each holds. */
export function parseReportTabs(html) {
  const out = [];
  for (const m of String(html ?? "").matchAll(/id="__tab_[^"]*TabHorseReport(\d+)"[^>]*>([\s\S]*?)<\/span>/gi)) {
    const title = textOf(m[2]);
    if (title) out.push({ tab: Number(m[1]), title });
  }
  return out;
}

/**
 * The My Reports tab: each row with its text and whatever opens it — a link
 * on Arion's host, or a postback.
 */
export function parseMyReports(html) {
  const s = String(html ?? "");
  const start = s.search(/id="[^"]*TabMyReports"/i);
  if (start < 0) return [];
  const rest = s.slice(start);
  const end = rest.slice(1).search(/id="[^"]*tabbedReport_tabs_Tab(?!MyReports)[A-Za-z0-9]+"|<\/form>/i);
  const scope = end > 0 ? rest.slice(0, end + 1) : rest;
  const out = [];
  for (const row of scope.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    if (/<th\b/i.test(row[1])) continue;
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => textOf(c[1])).filter(Boolean);
    if (!cells.length) continue;
    const link = [...row[1].matchAll(/<a\b[^>]*>/gi)].map((a) => attrs(a[0])).find((a) => a.href && !/^javascript:/i.test(a.href));
    const pb = postbacks(row[1])[0];
    let url = null;
    if (link) {
      try {
        const u = new URL(link.href, `${ORIGIN}${REPORTS_PATH}`);
        if (u.hostname === new URL(ORIGIN).hostname) url = u.href;
      } catch {
        /* not an address */
      }
    }
    out.push({ cells, label: cells.join(" · "), url, ...(pb ? { target: pb.target, argument: pb.argument } : {}) });
  }
  return out;
}

/**
 * A page's shape, for checking the client against the live site: its form's
 * field names (never their values), the postback controls and the links it
 * offers, the report tabs, and a little of its visible text.
 */
export function describePage(html) {
  const s = String(html ?? "");
  const { action, fields } = parseForm(s);
  const title = textOf(s.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const body = textOf(s.replace(/<head\b[\s\S]*?<\/head>/i, ""));
  return {
    title,
    action,
    loginForm: asksForLogin(s),
    fields: Object.keys(fields).filter((n) => !/Password/i.test(n)),
    buttons: [...s.matchAll(/<input\b[^>]*type\s*=\s*["']?(?:submit|image)[^>]*>/gi)].map((m) => attrs(m[0]).name).filter(Boolean),
    postbacks: [...new Set(postbacks(s).map((p) => p.target))].slice(0, 80),
    links: [...new Set([...s.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#][^"']*)["']/gi)].map((m) => decode(m[1])).filter((h) => !/^javascript:|^mailto:|^https?:\/\/(?!arion)/i.test(h)))].slice(0, 80),
    candidates: parseCandidates(s).map((c) => c.label).slice(0, 20),
    reportTabs: parseReportTabs(s),
    reportFiles: parseReportFiles(s).map((f) => ({ kind: f.kind, path: new URL(f.url).pathname, tab: f.tab })),
    myReports: parseMyReports(s).length,
    text: body.slice(0, 600),
  };
}

/* ------------------------------------------------------------ the session */

/** A cookie jar for one host: name=value pairs, as Set-Cookie leaves them. */
export class Jar {
  constructor() {
    this.cookies = new Map();
  }
  take(headers) {
    const list = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get?.("set-cookie")].filter(Boolean);
    for (const line of list) {
      const [pair, ...attrsList] = String(line).split(";");
      const i = pair.indexOf("=");
      if (i <= 0) continue;
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrsList.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a) || (/^\s*expires=/i.test(a) && Date.parse(a.split("=")[1]) < Date.now()));
      if (expired || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  clear() {
    this.cookies.clear();
  }
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Arion's print page wraps a report in a frame and prints it on load; the
 * report itself is the frame's address.
 */
export function printFrame(html) {
  const m = String(html ?? "").match(/<iframe\b[^>]*id\s*=\s*["']printingFrame["'][^>]*>/i);
  const src = m ? attrs(m[0]).src : null;
  return src ? src : null;
}

/**
 * A relayed HTML report: its own addresses kept pointing at Arion (a <base>),
 * and nothing in it allowed to run where it is shown.
 */
export function relayHtml(html, url) {
  const base = `<base href="${new URL(".", url).href}">`;
  const s = String(html ?? "").replace(/<script\b[\s\S]*?<\/script>/gi, "");
  return /<head\b[^>]*>/i.test(s) ? s.replace(/<head\b[^>]*>/i, (h) => `${h}${base}`) : `${base}${s}`;
}

export const RELAY_HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "sandbox; default-src 'none'; img-src https: data:; style-src https: 'unsafe-inline'; font-src https: data:",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, max-age=3600",
};

/**
 * The client: one per process, one Arion session, one step at a time.
 *
 * `fetch` and the environment are passed in so the tests can stand in for
 * Arion; in the server they are the real ones.
 */
export function createClient({ fetch: doFetch = globalThis.fetch, env = process.env, now = () => Date.now(), log = () => {} } = {}) {
  const jar = new Jar();
  let loggedInAt = 0;
  let queue = Promise.resolve();
  const picks = new Map(); // token -> { search, choice, at }
  const files = new Map(); // id -> { url, label, at }
  const day = { date: today(), count: 0 };
  const LIMIT = Number(env.ARION_DAILY_LIMIT) > 0 ? Number(env.ARION_DAILY_LIMIT) : 25;
  const TOKEN_TTL = 20 * 60 * 1000;
  let reports = REPORTS;
  let seq = 0;

  const configured = () => Boolean(env.ARION_USERNAME && env.ARION_PASSWORD);
  const serial = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };
  const token = () => `${(seq += 1).toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const tidy = () => {
    for (const [k, v] of picks) if (v.at < now() - TOKEN_TTL) picks.delete(k);
    for (const [k, v] of files) if (v.at < now() - 6 * 60 * 60 * 1000) files.delete(k);
  };

  /** One request to Arion, following its redirects by hand so every cookie is kept. */
  async function request(path, { form = null } = {}) {
    let url = new URL(path, ORIGIN);
    let method = form ? "POST" : "GET";
    let body = form ? new URLSearchParams(form).toString() : undefined;
    for (let hop = 0; hop < 6; hop += 1) {
      if (url.hostname !== new URL(ORIGIN).hostname) throw new ArionError("Arion sent us somewhere else", { code: "redirect" });
      const res = await doFetch(url.href, {
        method,
        redirect: "manual",
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
          ...(jar.header() ? { Cookie: jar.header() } : {}),
          ...(body ? { "Content-Type": "application/x-www-form-urlencoded", Referer: url.href } : {}),
        },
        body,
      });
      jar.take(res.headers);
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        url = new URL(res.headers.get("location"), url);
        method = "GET";
        body = undefined;
        continue;
      }
      const type = res.headers.get("content-type") ?? "";
      if (/text\/html|text\/plain|xml/i.test(type) || !type) {
        const html = await res.text();
        const headers = Object.fromEntries([...res.headers].map(([k, v]) => [k.toLowerCase(), v]));
        if (isChallenge(res.status, html, headers)) {
          throw new ArionError("Arion's site is behind a Cloudflare check that a server cannot pass just now. Open Arion in a new tab instead.", { code: "challenge", status: 503 });
        }
        if (res.status >= 400) throw new ArionError(`Arion answered ${res.status}`, { status: res.status === 404 ? 404 : 502 });
        return { url: url.href, status: res.status, type, html };
      }
      if (res.status >= 400) throw new ArionError(`Arion answered ${res.status}`, { status: res.status === 404 ? 404 : 502 });
      return { url: url.href, status: res.status, type, body: Buffer.from(await res.arrayBuffer()), disposition: res.headers.get("content-disposition") };
    }
    throw new ArionError("Arion kept redirecting", { code: "redirect" });
  }

  async function login() {
    if (!configured()) throw new ArionError("Arion is not set up: ARION_USERNAME and ARION_PASSWORD are not set on the server.", { status: 503, code: "unconfigured" });
    jar.clear();
    loggedInAt = 0;
    const path = `${LOGIN_PATH}?ReturnUrl=${encodeURIComponent(REPORTS_PATH)}`;
    const page = await request(path);
    const { fields } = parseForm(page.html);
    const form = {
      ...fields,
      [LOGIN_FIELDS.user]: env.ARION_USERNAME,
      [LOGIN_FIELDS.password]: env.ARION_PASSWORD,
      [LOGIN_FIELDS.button]: buttonValue(page.html, LOGIN_FIELDS.button) ?? "Login",
    };
    const after = await request(path, { form });
    if (asksForLogin(after.html)) {
      const why = loginFailure(after.html);
      throw new ArionError(`Arion refused the login${why ? `: ${why}` : ""}. Check ARION_USERNAME and ARION_PASSWORD on the server.`, { status: 401, code: "login" });
    }
    loggedInAt = now();
    log("[arion] logged in");
    return after;
  }

  /** The report page, logged in: logs in when it must, once. */
  async function reportPage() {
    if (!loggedInAt) await login();
    let page = await request(REPORTS_PATH);
    if (asksForLogin(page.html)) {
      await login();
      page = await request(REPORTS_PATH);
      if (asksForLogin(page.html)) throw new ArionError("Arion keeps asking for the login", { status: 401, code: "login" });
    }
    reports = pricedReports(page.html);
    return page;
  }

  /**
   * Post a page's form back with these fields set and this control pressed.
   * `page` is a page ({ html }) or a form already read from one ({ fields }).
   */
  async function postBack(page, { set = {}, button = null, target = null, argument = "" } = {}) {
    const fields = page.fields ?? parseForm(page.html).fields;
    const form = { ...fields, ...set, __EVENTTARGET: target ?? "", __EVENTARGUMENT: target ? argument : "" };
    if (button) form[button] = (page.html !== undefined ? buttonValue(page.html, button) : null) ?? "Search";
    const next = await request(REPORTS_PATH, { form });
    if (asksForLogin(next.html)) {
      loggedInAt = 0;
      throw new ArionError("Arion's session ended mid-step; search again", { status: 409, code: "session" });
    }
    return next;
  }

  /** Answer Arion's own "are you sure" for a paid report: the person already said yes. */
  async function confirmed(result) {
    if (postbacks(result.html).some((p) => p.target === "ctl00$btnYes") && !parseReportFiles(result.html).length) {
      return postBack(result, { target: "ctl00$btnYes" });
    }
    return result;
  }

  const remember = (file, label) => {
    const id = token();
    files.set(id, { url: file.url, label, at: now() });
    return { id, kind: file.kind, tab: file.tab ?? null, label };
  };

  return {
    configured,

    status() {
      return {
        configured: configured(),
        loggedIn: Boolean(loggedInAt),
        reports,
        dailyLimit: LIMIT,
        usedToday: day.date === today() ? day.count : 0,
        open: `${ORIGIN}${REPORTS_PATH}`,
      };
    },

    /** Log in (or check the session) and say what the page offers. */
    check: () =>
      serial(async () => {
        const page = await reportPage();
        return { ok: true, reports, myReports: parseMyReports(page.html).length };
      }),

    /**
     * Search as the page does: `kind` is named (a horse's name), dam (an
     * unnamed horse by its dam) or theoretical (a sire and a dam). The report
     * menu is posted empty, so a search can never buy a report, even one that
     * lands straight on a single horse.
     */
    search: ({ kind = "named", name = "", sire = "", dam = "" } = {}) =>
      serial(async () => {
        tidy();
        const how = SEARCHES[kind];
        if (!how) throw new ArionError(`Unknown search: ${kind}`, { status: 400, code: "input" });
        const values = { name, sire, dam };
        const set = {};
        for (const [k, field] of Object.entries(how.fields)) {
          const v = String(values[k] ?? "").trim();
          if (!v || v.length > 60) throw new ArionError(`Give the ${k === "name" ? "horse's name" : k}`, { status: 400, code: "input" });
          set[field] = v;
        }
        const page = await reportPage();
        const result = await postBack(page, { set: { ...set, [MENU_FIELD]: "" }, button: how.button });
        const search = { kind, set, fields: parseForm(result.html).fields };
        const found = parseCandidates(result.html);
        if (found.length) {
          return {
            candidates: found.map((choice) => {
              const t = token();
              picks.set(t, { search, choice, at: now() });
              return { token: t, label: choice.label, cells: choice.cells };
            }),
          };
        }
        // no list to choose from: the search is the choice (a single horse,
        // or a theoretical one), repeated with the report named when bought
        const t = token();
        picks.set(t, { search, choice: null, at: now() });
        return { candidates: [], direct: { token: t }, text: textOf(result.html.replace(/<head\b[\s\S]*?<\/head>/i, "")).slice(0, 400) };
      }),

    /**
     * Buy one report for one search result. Refused unless `confirm` is true,
     * `credits` is the price the person was shown, and the day has room.
     */
    report: ({ token: t, reportId, confirm = false, credits = null } = {}) =>
      serial(async () => {
        tidy();
        const pick = picks.get(String(t));
        if (!pick) throw new ArionError("That search has expired; search again", { status: 410, code: "expired" });
        const r = reports.find((x) => x.id === reportId);
        if (!r) throw new ArionError("Unknown report", { status: 400, code: "input" });
        if (confirm !== true || Number(credits) !== r.credits) {
          throw new ArionError(`This report costs ${r.credits} credits; confirm the price to buy it`, { status: 402, code: "confirm" });
        }
        if (day.date !== today()) Object.assign(day, { date: today(), count: 0 });
        if (day.count >= LIMIT) throw new ArionError(`Today's limit of ${LIMIT} Arion reports is reached (ARION_DAILY_LIMIT)`, { status: 429, code: "limit" });

        const menu = { [MENU_FIELD]: r.id };
        const { search, choice } = pick;
        let result;
        if (choice?.target) {
          result = await postBack({ fields: search.fields }, { set: menu, target: choice.target, argument: choice.argument });
        } else if (choice?.radio) {
          result = await postBack({ fields: search.fields }, { set: { ...menu, [choice.radio.name]: choice.radio.value }, target: choice.radio.name });
        } else {
          const page = await reportPage();
          result = await postBack(page, { set: { ...search.set, ...menu }, button: SEARCHES[search.kind].button });
        }
        result = await confirmed(result);
        day.count += 1;
        picks.delete(String(t));
        const found = parseReportFiles(result.html);
        const horse = choice?.cells?.[0] ?? choice?.label ?? Object.values(search.set).join(" x ");
        const label = `${r.label} · ${horse}`;
        log(`[arion] report bought: ${r.label} (${r.credits} credits), ${found.length} file(s)`);
        return {
          report: { id: r.id, label: r.label, credits: r.credits },
          horse,
          files: found.map((f) => remember(f, label)),
          tabs: parseReportTabs(result.html),
          note: found.length ? null : "Arion took the order but its page did not name the report: look under My Reports.",
        };
      }),

    /** The My Reports tab: what the account has bought, each with a way to open it. */
    myReports: () =>
      serial(async () => {
        tidy();
        const page = await reportPage();
        const fields = parseForm(page.html).fields;
        return parseMyReports(page.html).map((row) => {
          let open = null;
          if (row.url) open = { file: remember({ url: row.url, kind: "file" }, row.label) };
          else if (row.target) {
            const t = token();
            picks.set(t, { search: { fields }, choice: { target: row.target, argument: row.argument, label: row.label, saved: true }, at: now() });
            open = { token: t };
          }
          return { label: row.label, cells: row.cells, open };
        });
      }),

    /** Open a report from My Reports that opens by postback: one already bought. */
    openSaved: (t) =>
      serial(async () => {
        const pick = picks.get(String(t));
        if (!pick?.choice?.saved) throw new ArionError("That list has expired; open My Reports again", { status: 410, code: "expired" });
        const result = await postBack({ fields: pick.search.fields }, { target: pick.choice.target, argument: pick.choice.argument });
        picks.delete(String(t));
        return { files: parseReportFiles(result.html).map((f) => remember(f, pick.choice.label)) };
      }),

    /**
     * A report file this client was handed, fetched with the session; Arion's
     * print page is followed to the report it frames.
     */
    file: (id) =>
      serial(async () => {
        const f = files.get(String(id));
        if (!f) throw new ArionError("No such report here; open it from the list again", { status: 404, code: "file" });
        let got = await request(f.url);
        if (got.html !== undefined && asksForLogin(got.html)) {
          await login();
          got = await request(f.url);
        }
        const framed = got.html !== undefined ? printFrame(got.html) : null;
        if (framed) {
          const inner = new URL(framed, got.url);
          if (inner.hostname !== new URL(ORIGIN).hostname) throw new ArionError("The report is not on Arion's own site", { code: "file" });
          got = await request(inner.href);
        }
        return { ...got, label: f.label };
      }),

    /** The live pages' shape, for checking the parsers (names, never values). */
    diagnose: ({ name = "Frankel" } = {}) =>
      serial(async () => {
        const page = await reportPage();
        const out = { reportsPage: describePage(page.html) };
        if (name) {
          const result = await postBack(page, { set: { [SEARCHES.named.fields.name]: name, [MENU_FIELD]: "" }, button: SEARCHES.named.button });
          out.search = describePage(result.html);
        }
        return out;
      }),
  };
}
