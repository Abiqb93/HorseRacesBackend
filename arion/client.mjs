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
 * ARION_USERNAME is the account's email address: Arion's login form asks for
 * "Email Address" and checks it is one, so anything else is not sent. The
 * login is what a person does on Arion's login page: fill both boxes and
 * press Log In. Arion then sends the browser on; refused, it shows the form
 * again with its reason, and the next try waits LOGIN_PAUSE_MS (15 minutes),
 * so a wrong password cannot be retried until Arion locks the account.
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
 *   - A session that has timed out shows as the header's login box, with no
 *     one shown logged in, where the report page should be: the client logs
 *     in again and repeats the step, once.
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

/**
 * The three searches the page offers, by the boxes filled and the Search a
 * person presses: a link that posts the form back (`link`). The hidden
 * submit beside it (`button`) is what Enter presses; it is used only on a
 * page without the link.
 */
export const SEARCHES = {
  // a horse by its name
  named: {
    fields: { name: "ctl00$MainContentArea$txtNamedHorse" },
    link: "ctl00$MainContentArea$btnSearchNamedHorse",
    button: "ctl00$MainContentArea$btnSearchNamedHorseDefault",
  },
  // an unnamed horse, found by its dam
  dam: {
    fields: { dam: "ctl00$MainContentArea$txtUnnamedHorse" },
    link: "ctl00$MainContentArea$btnSearchUnnamedHorse",
    button: "ctl00$MainContentArea$btnSearchUnnamedHorseDefault",
  },
  // a theoretical horse: a sire and a dam that have not been mated. Arion
  // then asks which sire, and which dam, each in its horse-search dialog.
  theoretical: {
    fields: { sire: "ctl00$MainContentArea$txtSireName", dam: "ctl00$MainContentArea$txtDamName" },
    link: "ctl00$MainContentArea$btnSearchDamHorse",
    button: "ctl00$MainContentArea$btnSearchDamHorseDefault",
  },
};

/**
 * The report menu is chosen in the browser alone: a click puts the report's
 * id in this hidden field and sends nothing. Arion makes the report when a
 * search or a pick is sent with it filled, so every step that must not buy
 * sends it empty.
 */
const MENU_FIELD = "ctl00$MainContentArea$hiddenMenuItemId";
const LOGIN_FIELDS = {
  // Arion logs in with the account's email address ("Email Address:", checked
  // by the page's own email validator)
  user: "ctl00$MainContentArea$lvLogin$Login1$UserName",
  password: "ctl00$MainContentArea$lvLogin$Login1$Password",
  // the "Log In" a person presses: a link that posts the form back
  link: "ctl00$MainContentArea$lvLogin$Login1$LoginButton",
  // the hidden submit that Enter presses, for a page without the link
  button: "ctl00$MainContentArea$lvLogin$Login1$btnLoginDefault",
};
/** After Arion refuses the login, this long before it is tried again: repeated
 * refusals can lock the account. A redeploy (as changing the variables on
 * Railway does) starts afresh at once. */
export const LOGIN_PAUSE_MS = 15 * 60 * 1000;
const looksLikeEmail = (s) => /^[^\s@"']+@[^\s@"']+\.[^\s@"']+$/.test(s);

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

/** What an element holds, by its id: the markup between its tags, nested ones included. */
export function innerOf(html, id) {
  const s = String(html ?? "");
  const safe = String(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const open = s.match(new RegExp(`<(div|span|table|td|p)\\b[^>]*\\bid\\s*=\\s*["']${safe}["'][^>]*>`, "i"));
  if (!open) return null;
  const start = open.index + open[0].length;
  const re = new RegExp(`<(/?)${open[1]}\\b[^>]*>`, "gi");
  re.lastIndex = start;
  let depth = 1;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return s.slice(start, m.index);
  }
  return s.slice(start);
}

/** The login page's own form (Login.aspx), as opposed to the box every page's header carries. */
const LOGIN_PAGE_FORM = /\$Login1\$Password["']/;

/**
 * Whether a page shows someone logged in: a way to log out, or the header's
 * login-status panel with something in it. Logged out, Arion leaves that panel
 * empty and offers only the header's login box.
 */
export function showsLoggedIn(html) {
  const s = String(html ?? "");
  if (/<a\b[^>]*>\s*(?:<[^>]+>\s*)*(?:log\s*-?\s*out|sign\s*-?\s*out|log\s*-?\s*off)\b/i.test(s)) return true;
  if (/href\s*=\s*["'][^"']*\blog-?(?:out|off)\b[^"']*["']/i.test(s)) return true;
  return [...s.matchAll(/\bid\s*=\s*["']([^"']*LoginStatus[^"']*)["']/gi)].some((m) => {
    const t = textOf(innerOf(s, m[1]) ?? "");
    return t && !/^log\s*-?\s*in\.?$/i.test(t);
  });
}

/**
 * Whether the page asks for a password: the login page's form (logged out, or
 * the login refused), or the header's login box on a page that shows no one
 * logged in. The header box alone is not enough: it may be on every page.
 */
export function asksForLogin(html) {
  const s = String(html ?? "");
  if (!(/type\s*=\s*["']?password/i.test(s) && /\$Password["']/i.test(s))) return false;
  if (LOGIN_PAGE_FORM.test(s)) return true;
  return !showsLoggedIn(s);
}

/**
 * The message Arion gives a refused login, if any: a failure text with
 * something in it (the header's box has one too, empty, ahead of the form's),
 * the login form's error line, or a validator it shows (the email check).
 */
export function loginFailure(html) {
  const s = String(html ?? "");
  const scope = innerOf(s, "ctl00_MainContentArea_lvLogin_Login1") ?? s;
  const said = [];
  for (const m of s.matchAll(/\bid\s*=\s*["']([^"']*FailureText[^"']*)["']/gi)) said.push(textOf(innerOf(s, m[1]) ?? ""));
  for (const m of scope.matchAll(/<div\b[^>]*class\s*=\s*["'][^"']*\berror\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)) said.push(textOf(m[1]));
  for (const m of scope.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi)) {
    const a = attrs(`<span ${m[1]}>`);
    const style = String(a.style ?? "").replace(/\s+/g, "").toLowerCase();
    if (!/color:red/.test(style) || /visibility:hidden|display:none/.test(style)) continue;
    const t = textOf(m[2]);
    said.push(t && t !== "*" ? t : a.title ?? "");
  }
  const out = [...new Set(said.map((t) => t.trim()).filter(Boolean))];
  return out.length ? out.join(" ").slice(0, 300) : null;
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
 * The horse-search dialog Arion opens to have a horse picked, whatever fills
 * it: the named-horse list, or the sire's and then the dam's for a mating.
 * The page around it has postback rows of its own (My Reports) that are not
 * search results.
 */
export function dialogScope(html) {
  const s = String(html ?? "");
  let start = s.search(/id\s*=\s*["']ctl00_ModalDialogArea_(?:updSearchModalDialog|pnlHorseSearch)["']/i);
  if (start < 0) start = s.search(/ArionNamedHorseSearchControl/i);
  if (start < 0) return "";
  const rest = s.slice(start);
  const end = rest.search(/ModalDialogArea[_$]btnLaunchModal|TabMyReports|tabbedReport_tabs_TabHorseReport|<\/form>/i);
  return end > 0 ? rest.slice(0, end) : rest;
}

/** What the dialog asks for, in its own heading: "Please select a horse", a sire, a dam. */
export function dialogPrompt(html) {
  const h = dialogScope(html).match(/<h\d\b[^>]*>([\s\S]*?)<\/h\d>/i);
  return h ? textOf(h[1]) || null : null;
}

/**
 * The search dialog's choices: each row of the dialog that carries a
 * postback, with the row's own text — a horse's name, year, country and
 * parents, however Arion lays them out. Radio buttons count too.
 */
export function parseCandidates(html) {
  const scope = dialogScope(html);
  if (!scope) return [];
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
 * What Arion's own message box says, when it says anything: its title and
 * message. The box (with its Yes and No) is in every page's markup, empty
 * and hidden; Arion fills it to ask "are you sure" or to tell something.
 */
export function popupMessage(html) {
  const box = innerOf(html, "modalPopupBlock");
  if (box === null) return null;
  const title = textOf(box.match(/<div\b[^>]*class\s*=\s*["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");
  const message = textOf(box.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bmessage\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");
  return [title, message].filter(Boolean).join(": ") || null;
}

/**
 * Whether a message from Arion asks to go ahead — a question, as its "are
 * you sure" is — rather than tells (a charge made, credits short).
 */
export const asksToGoAhead = (said) =>
  Boolean(said) &&
  !/insufficient|not enough|unable|error|failed|not found|no (?:horse|match|result)/i.test(said) &&
  /\?|are you sure|do you (?:wish|want)|would you like|(?:click|press|select) yes/i.test(said);

/**
 * A page's parts that say what Arion did, for checking the client against
 * the live site: the message box, the horse-search dialog, the first report
 * tab, My Reports, the search area's text and the scripts that show or load
 * any of them. Form state (__VIEWSTATE and the like) is left out.
 */
export function excerptPage(html) {
  const s = String(html ?? "");
  const clean = (h, max) =>
    String(h ?? "")
      .replace(/<input\b[^>]*\bname\s*=\s*["']__[A-Z]+["'][^>]*>/gi, "")
      .replace(/\bvalue\s*=\s*("[^"]{200,}"|'[^']{200,}')/gi, 'value="(long)"')
      .replace(/\s+/g, " ")
      .slice(0, max);
  const scripts = [...s.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap((m) => m[1].split(/\n|;(?=\s*(?:\$create|Sys\.|\$find|window\.|document\.))/))
    .map((l) => l.trim())
    .filter((l) => /TabHorseReport|reportFrame|loadReport|window\.open|modalPopupMessage|HorseSearchModalPopupExtender|\.show\(|PrintReport/i.test(l))
    .map((l) => l.slice(0, 400))
    .slice(0, 40);
  return {
    popup: popupMessage(s),
    dialog: { prompt: dialogPrompt(s), choices: parseCandidates(s).map((c) => c.label).slice(0, 30), html: clean(dialogScope(s), 8000) },
    reportTab: clean(innerOf(s, "ctl00_MainContentArea_tabbedReport_tabs_TabHorseReport1"), 5000),
    reportTabs: parseReportTabs(s),
    reportFiles: parseReportFiles(s).map((f) => ({ kind: f.kind, path: new URL(f.url).pathname + new URL(f.url).search, tab: f.tab })),
    myReports: clean(innerOf(s, "ctl00_MainContentArea_tabbedReport_tabs_TabMyReports"), 8000),
    searchArea: textOf(innerOf(s, "ctl00_MainContentArea_updSearch") ?? "").slice(0, 1500),
    scripts,
  };
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
  let landed = null; // where the last login went on to
  let refused = null; // { at, message, page }: the last refusal, which pauses the next try
  let queue = Promise.resolve();
  // token -> { search, steps, choice, prompt, page, at }: a search, the picks
  // already made in Arion's dialogs, and the choice this token stands for
  // (none once the dialogs are done and a report can be made)
  const picks = new Map();
  const files = new Map(); // id -> { url, label, at }
  const pages = []; // excerpts of the last pages Arion answered, for diagnose
  const keep = (step, res) => {
    if (res?.html === undefined) return;
    pages.push({ at: new Date(now()).toISOString(), step, path: new URL(res.url).pathname, ...excerptPage(res.html) });
    while (pages.length > 8) pages.shift();
  };
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

  const clock = (t) => `${new Date(t).toISOString().slice(11, 16)} UTC`;
  const pausedUntil = () => (refused && now() - refused.at < LOGIN_PAUSE_MS ? refused.at + LOGIN_PAUSE_MS : null);
  const loginError = (message, { status = 401, code = "login", page = null } = {}) => Object.assign(new ArionError(message, { status, code }), { page });

  /** What is wrong with the username as set, if it can be seen without asking Arion. */
  const userProblem = (user) => {
    if (/^["'].*["']$/.test(user)) return "ARION_USERNAME on the server is wrapped in quotes; enter the address without them";
    if (!looksLikeEmail(user)) return "Arion logs in with the account's email address, and ARION_USERNAME on the server is not one";
    return null;
  };
  /** What may be wrong with the password as set: never the password itself. */
  const passwordHints = () => {
    const p = String(env.ARION_PASSWORD ?? "");
    const hints = [];
    if (p !== p.trim()) hints.push("the password set on the server begins or ends with a space");
    if (/^(["']).+\1$/.test(p.trim())) hints.push("the password set on the server is wrapped in quotes");
    return hints;
  };

  /**
   * Log in as a person does on Arion's login page: fill the email address and
   * password and press Log In. Arion then sends the browser on (to the page
   * the login was asked for); refused, it shows the login form again, with its
   * reason. A refusal pauses the next try for LOGIN_PAUSE_MS.
   */
  async function login() {
    if (!configured()) throw new ArionError("Arion is not set up: ARION_USERNAME and ARION_PASSWORD are not set on the server.", { status: 503, code: "unconfigured" });
    const user = String(env.ARION_USERNAME).trim();
    const problem = userProblem(user);
    if (problem) throw loginError(`${problem}. Nothing was sent to Arion.`);
    if (pausedUntil()) {
      throw loginError(`${refused.message} Not trying again until ${clock(pausedUntil())}, so repeated tries cannot lock the account; a redeploy, as changing the variables on Railway does, allows a try at once.`, { page: refused.page });
    }
    jar.clear();
    loggedInAt = 0;
    landed = null;
    const page = await request(`${LOGIN_PATH}?ReturnUrl=${encodeURIComponent(REPORTS_PATH)}`);
    const { action, fields } = parseForm(page.html);
    const link = postbacks(page.html).some((p) => p.target === LOGIN_FIELDS.link);
    const button = buttonValue(page.html, LOGIN_FIELDS.button);
    if (!(LOGIN_FIELDS.user in fields) || !(LOGIN_FIELDS.password in fields) || !(link || button !== null)) {
      throw loginError("Arion's login page is not the shape this client knows, so the login was not sent. Turn on ARION_DIAGNOSE and open /api/arion/diagnose to see it.", {
        status: 502,
        code: "login-shape",
        page: describePage(page.html),
      });
    }
    const form = {
      ...fields,
      [LOGIN_FIELDS.user]: user,
      [LOGIN_FIELDS.password]: env.ARION_PASSWORD,
      ...(link ? { __EVENTTARGET: LOGIN_FIELDS.link, __EVENTARGUMENT: "" } : { [LOGIN_FIELDS.button]: button }),
    };
    const after = await request(action ? new URL(action, page.url).href : page.url, { form });
    const where = new URL(after.url).pathname;
    if (where.toLowerCase() === LOGIN_PATH.toLowerCase() && LOGIN_PAGE_FORM.test(after.html)) {
      const why = loginFailure(after.html);
      const hints = passwordHints();
      const message = `Arion refused the login${why ? `: "${why}"` : ", without saying why"}. Check ARION_USERNAME (the account's email address) and ARION_PASSWORD on the server${hints.length ? `: ${hints.join(", and ")}` : ""}.`;
      refused = { at: now(), message, page: describePage(after.html) };
      log(`[arion] login refused${why ? `: ${why}` : ", no reason shown"}`);
      throw loginError(`${message} Not trying again until ${clock(pausedUntil())}, so repeated tries cannot lock the account.`, { page: refused.page });
    }
    refused = null;
    landed = where;
    loggedInAt = now();
    log(`[arion] logged in (Arion went on to ${where})`);
    return after;
  }

  /** The report page, logged in: logs in when it must, at most once. */
  async function reportPage() {
    let fresh = false;
    if (!loggedInAt) {
      await login();
      fresh = true;
    }
    let page = await request(REPORTS_PATH);
    if (asksForLogin(page.html) && !fresh) {
      await login();
      fresh = true;
      page = await request(REPORTS_PATH);
    }
    if (asksForLogin(page.html)) {
      loggedInAt = 0;
      throw loginError(
        `Arion took the login (it went on to ${landed ?? "another page"}), but its Pedigree Reports page still shows the login box, so this client cannot tell it is logged in. Turn on ARION_DIAGNOSE and open /api/arion/diagnose to see the page.`,
        { status: 502, code: "login-shape", page: describePage(page.html) },
      );
    }
    reports = pricedReports(page.html);
    return page;
  }

  /**
   * Post a page's form back with these fields set and this control pressed.
   * `page` is a page ({ html }) or a form already read from one ({ fields }).
   */
  async function postBack(page, { set = {}, button = null, target = null, argument = "", step = "postback" } = {}) {
    const fields = page.fields ?? parseForm(page.html).fields;
    const form = { ...fields, ...set, __EVENTTARGET: target ?? "", __EVENTARGUMENT: target ? argument : "" };
    if (button) form[button] = (page.html !== undefined ? buttonValue(page.html, button) : null) ?? "Search";
    const next = await request(REPORTS_PATH, { form });
    keep(step, next);
    if (asksForLogin(next.html)) {
      loggedInAt = 0;
      throw new ArionError("Arion's session ended mid-step; search again", { status: 409, code: "session" });
    }
    return next;
  }

  /** Press a search's Search as a person does: its link, or on a page without one, the hidden submit. */
  const pressSearch = (page, how) =>
    page.html !== undefined && !postbacks(page.html).some((p) => p.target === how.link) && buttonValue(page.html, how.button) !== null
      ? { button: how.button }
      : { target: how.link };

  /** Send one pick from Arion's dialog: its row's postback, or its radio button. */
  const sendPick = (page, choice, menu, step) =>
    choice.target
      ? postBack(page, { set: { [MENU_FIELD]: menu }, target: choice.target, argument: choice.argument ?? "", step })
      : postBack(page, { set: { [MENU_FIELD]: menu, [choice.radio.name]: choice.radio.value }, target: choice.radio.name, step });

  /**
   * Answer Arion's own "are you sure" for a paid report — the person already
   * said yes — only when its message box is actually asking. The box and its
   * Yes are in every page's markup; pressing Yes when nothing was asked is
   * not ours to do.
   */
  async function confirmed(result, menu) {
    const said = popupMessage(result.html);
    if (parseReportFiles(result.html).length || !asksToGoAhead(said)) return { result, said };
    const next = await postBack(result, { set: { [MENU_FIELD]: menu }, target: "ctl00$btnYes", step: "yes" });
    return { result: next, said: popupMessage(next.html), answered: said };
  }

  /**
   * What a search or a pick led to: Arion's dialog asking for a horse (with
   * its own heading, and the choices it lists), or nothing more to pick.
   * `before` is the picks already made; each choice gets a token that
   * carries them.
   */
  const sameList = (found, list) => Boolean(list) && found.length === list.length && found.every((c, i) => c.label === list[i]);

  function nextStep(search, before, result) {
    const said = popupMessage(result.html);
    const found = parseCandidates(result.html);
    const prompt = dialogPrompt(result.html);
    // a list just like the one last picked from is that list left in the
    // page, not a new question
    if (found.length && !sameList(found, before[before.length - 1]?.list)) {
      const fields = parseForm(result.html).fields;
      return {
        step: { number: before.length + 1, prompt },
        chosen: before.map((b) => ({ prompt: b.prompt, label: b.label })),
        message: said,
        candidates: found.map((choice) => {
          const t = token();
          picks.set(t, { search, steps: before, choice, prompt, list: found.map((c) => c.label), page: { fields }, at: now() });
          return { token: t, label: choice.label, cells: choice.cells };
        }),
      };
    }
    // nothing (more) to pick: the search and its picks are the horse, and a
    // report is made by sending them again with the report named
    const t = token();
    picks.set(t, { search, steps: before, choice: null, at: now() });
    return {
      candidates: [],
      chosen: before.map((b) => ({ prompt: b.prompt, label: b.label })),
      message: said,
      direct: { token: t },
      text: textOf(result.html.replace(/<head\b[\s\S]*?<\/head>/i, "")).slice(0, 400),
    };
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
        loginPausedUntil: pausedUntil() ? new Date(pausedUntil()).toISOString() : null,
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
        const result = await postBack(page, { set: { ...set, [MENU_FIELD]: "" }, ...pressSearch(page, how), step: `search:${kind}` });
        return nextStep({ kind, set }, [], result);
      }),

    /**
     * Pick one of the horses Arion's dialog lists, and say what Arion asks
     * next: another pick (the dam, after the sire) or nothing, when a report
     * can be made. Free: the report menu goes empty.
     */
    choose: (t) =>
      serial(async () => {
        tidy();
        const pick = picks.get(String(t));
        if (!pick?.choice) throw new ArionError("That list has expired; search again", { status: 410, code: "expired" });
        const result = await sendPick(pick.page, pick.choice, "", `pick:${pick.steps.length + 1}`);
        const steps = [...pick.steps, { prompt: pick.prompt, label: pick.choice.label, cells: pick.choice.cells, list: pick.list }];
        return nextStep(pick.search, steps, result);
      }),

    /**
     * Buy one report for one horse: a search, and the picks made in Arion's
     * dialogs. Refused unless `confirm` is true, `credits` is the price the
     * person was shown, and the day has room. Arion makes a report when the
     * search or a pick is sent with the report named, so the search is sent
     * again with it, and each pick in turn, found by its label in the list
     * Arion shows again; a list that no longer holds it stops the order.
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

        const steps = pick.choice ? [...pick.steps, { prompt: pick.prompt, label: pick.choice.label, cells: pick.choice.cells, list: pick.list }] : pick.steps;
        const changed = (what) => new ArionError(`${what}, so nothing was ordered; search again`, { status: 409, code: "changed" });
        const page = await reportPage();
        let result = await postBack(page, { set: { ...pick.search.set, [MENU_FIELD]: r.id }, ...pressSearch(page, SEARCHES[pick.search.kind]), step: "order:search" });
        for (const [i, s] of steps.entries()) {
          if (parseReportFiles(result.html).length || asksToGoAhead(popupMessage(result.html))) break; // Arion went ahead sooner
          const row = parseCandidates(result.html).find((c) => c.label === s.label);
          if (!row) throw changed(`Arion no longer lists ${s.label}${s.prompt ? ` (${s.prompt})` : ""}`);
          result = await sendPick(result, row, r.id, `order:pick:${i + 1}`);
        }
        const more = parseCandidates(result.html);
        if (!parseReportFiles(result.html).length && !asksToGoAhead(popupMessage(result.html)) && more.length && !sameList(more, steps[steps.length - 1]?.list)) {
          throw changed(`Arion asks for another pick${dialogPrompt(result.html) ? ` (${dialogPrompt(result.html)})` : ""}`);
        }
        const { result: done, said, answered } = await confirmed(result, r.id);
        day.count += 1;
        picks.delete(String(t));
        const found = parseReportFiles(done.html);
        const horse = steps.length ? steps.map((s) => s.cells?.[0] ?? s.label).join(" x ") : Object.values(pick.search.set).join(" x ");
        const label = `${r.label} · ${horse}`;
        log(`[arion] report ordered: ${r.label} (${r.credits} credits) for ${horse}, ${found.length} file(s)${answered ? `, answered "${answered}"` : ""}${said ? `, Arion said "${said}"` : ""}`);
        return {
          report: { id: r.id, label: r.label, credits: r.credits },
          horse,
          files: found.map((f) => remember(f, label)),
          tabs: parseReportTabs(done.html),
          answered: answered ?? null,
          message: said ?? null,
          note: found.length
            ? null
            : `No report came back from Arion${said ? `, which said: "${said}"` : ""}. If Arion made one, it is under My Reports; look there before ordering again.`,
        };
      }),

    /** The My Reports tab: what the account has bought, each with a way to open it. */
    myReports: () =>
      serial(async () => {
        tidy();
        const page = await reportPage();
        keep("my-reports", page);
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
        // a report already bought: the menu goes empty, so opening it cannot order another
        const result = await postBack({ fields: pick.search.fields }, { set: { [MENU_FIELD]: "" }, target: pick.choice.target, argument: pick.choice.argument, step: "open-saved" });
        picks.delete(String(t));
        return { files: parseReportFiles(result.html).map((f) => remember(f, pick.choice.label)), message: popupMessage(result.html) };
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

    /**
     * The live pages' shape, for checking the parsers (names, never values).
     * A login that fails says why, with the shape of the page it ended on.
     * `last` asks nothing of Arion: it gives the parts of the last pages
     * Arion answered (searches, picks, orders) that say what Arion did.
     */
    diagnose: ({ name = "Frankel", last = false } = {}) =>
      serial(async () => {
        if (last) return { pages: [...pages] };
        let page;
        try {
          page = await reportPage();
        } catch (err) {
          if (!/^login/.test(err.code ?? "")) throw err;
          return { login: { ok: false, code: err.code, message: err.message, landed, page: err.page ?? null } };
        }
        const out = { login: { ok: true, landed }, reportsPage: describePage(page.html) };
        if (name) {
          const result = await postBack(page, { set: { [SEARCHES.named.fields.name]: name, [MENU_FIELD]: "" }, ...pressSearch(page, SEARCHES.named), step: "diagnose:search" });
          out.search = { ...describePage(result.html), ...excerptPage(result.html) };
        }
        return out;
      }),
  };
}
