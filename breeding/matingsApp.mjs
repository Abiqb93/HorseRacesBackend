/**
 * The team's Matings App (nominations.blandfordbloodstock.com), read for a
 * mare's picture and physical description (17 November 2026, on All Of Me:
 * "have her pull in the matings app that we have so that we got a picture
 * and a description and all the rest of it of her").
 *
 * The app is a WordPress site behind a login. Each horse has a page at
 * /horses/<slug>/ with a header (name, country, year and sex, sire - dam,
 * location, status, covering sire) and a news feed of posts: "ALL OF ME
 * DESCRIPTION – 04.12.18" carries the description, "ALL OF ME PHOTO –
 * 10.06.20" the picture, which the Images section lists too.
 *
 * The login comes from MATINGS_APP_USER and MATINGS_APP_PASSWORD; it is never
 * written down here. What is filled is only what a mare's row lacks: a
 * description or a picture the user already has is never replaced.
 */

export const ORIGIN = "https://nominations.blandfordbloodstock.com";
const UA = "Mozilla/5.0 (compatible; BlandfordBloodstock/1.0)";

export const decode = (s) =>
  String(s ?? "")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&#8220;|&ldquo;/g, "“")
    .replace(/&#8221;|&rdquo;/g, "”")
    .replace(/&#215;|&times;/g, "×")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

/** Text out of a piece of markup: paragraphs on their own lines, tags gone. */
export const textOf = (html) =>
  decode(
    String(html ?? "")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/p>\s*/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

/** "All Of Me" -> "all-of-me", "Madonna Dell'Orto" -> "madonna-dellorto": WordPress's own slugs. */
export const slugFor = (name) =>
  String(name ?? "")
    .toLowerCase()
    .replace(/\s*\([a-z]{2,3}\)\s*$/, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** A post title's own date, "… – 04.12.18" -> "2018-12-04", or null. */
export function titleDate(title) {
  const m = String(title ?? "").match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s*$/);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
}

/** One horse's page: its header, its posts and its images. Null for a page that is not a horse. */
export function parseHorsePage(html) {
  const h = String(html ?? "");
  const nameM = h.match(/<p class="horse-name">\s*<a[^>]*>([\s\S]*?)<\/a>/);
  if (!nameM) return null;
  const country = (nameM[1].match(/horse-country">\s*\(([A-Z]{2,3})\)/) ?? [])[1] ?? null;
  const name = textOf(nameM[1].replace(/<span class="horse-country">[\s\S]*?<\/span>/, ""));
  const ys = h.match(/<p>\s*(\d{4})\s+([MFCGHR])\s*<\/p>/);
  const label = (k) => {
    const m = h.match(new RegExp(`<span class="mare-label[^"]*">${k}</span>\\s*(?:<span>)?([^<]*)`));
    return m ? decode(m[1]).trim() || null : null;
  };
  const posts = [];
  const re = /<h2 class="title">([\s\S]*?)<\/h2>[\s\S]*?<div class="post-main-content">([\s\S]*?)<\/div>\s*((?:<img[^>]*>\s*(?:<span>[^<]*<\/span>)?\s*)*)/g;
  for (let m; (m = re.exec(h)); ) {
    const title = textOf(m[1]);
    const images = [...m[3].matchAll(/<img[^>]*src="([^"]+)"/g)].map((x) => x[1]).filter((u) => /\/wp-content\/uploads\//.test(u));
    posts.push({ title, date: titleDate(title), text: textOf(m[2]), images });
  }
  const imagesBlock = (h.match(/<div class="accordion-content[^"]*accordion-images">([\s\S]*?)<div id="acc-/) ?? [])[1] ?? "";
  const images = [...imagesBlock.matchAll(/<img[^>]*src="([^"]+)"[^>]*>\s*(?:<p class="img-caption">([^<]*)<\/p>)?/g)].map((x) => ({ url: x[1], caption: decode(x[2] ?? "").trim() || null }));
  return {
    name,
    country,
    year: ys ? Number(ys[1]) : null,
    sex: ys ? ys[2] : null,
    location: label("Location"),
    status: label("Status"),
    coveringSire: label("Covering Sire"),
    posts,
    images,
  };
}

const newestFirst = (a, b) => String(b.date ?? "").localeCompare(String(a.date ?? ""));

/**
 * Her description: the newest "DESCRIPTION" post, its words as written with
 * her name and the ":-" that follows it taken off the front, and the date in
 * the post's title at the end so a reader knows how old the look at her is.
 */
export function descriptionOf(page) {
  const posts = (page?.posts ?? []).filter((p) => /\bDESCRIPTION\b/i.test(p.title) && p.text).sort(newestFirst);
  const p = posts[0];
  if (!p) return null;
  const name = String(page?.name ?? "").trim();
  let text = p.text;
  if (name) text = text.replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?:\\([A-Z]{2,3}\\))?\\s*:?-?\\s*`, "i"), "");
  text = text.replace(/^:-\s*/, "").trim();
  if (!text) return null;
  const when = p.date ? new Date(`${p.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null;
  return when ? `${text}\n(Matings App, ${when})` : text;
}

/** Her picture: the newest "PHOTO" post's, else the first in her Images. */
export function photoOf(page) {
  const posts = (page?.posts ?? []).filter((p) => /\bPHOTO\b/i.test(p.title) && p.images.length).sort(newestFirst);
  return posts[0]?.images[0] ?? page?.images?.[0]?.url ?? null;
}

/** Does the page's horse look like this mare: the name, and the year where both are known. */
export function sameMare(page, mare) {
  if (!page) return false;
  const k = (s) => String(s ?? "").toLowerCase().replace(/\s*\([a-z]{2,3}\)\s*$/, "").replace(/[^a-z0-9]/g, "");
  if (k(page.name) !== k(mare?.horse_name ?? mare?.name)) return false;
  const y = Number(mare?.foaling_year ?? mare?.year);
  return !page.year || !Number.isFinite(y) || y < 1900 || page.year === y;
}

/** A logged-in session on the app: cookies kept between calls. */
export function createMatingsAppClient({ user, password, fetchImpl = globalThis.fetch, origin = ORIGIN } = {}) {
  const cookies = new Map();
  const keep = (res) => {
    const all = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
    for (const c of all) {
      const [pair] = String(c).split(";");
      const i = pair.indexOf("=");
      if (i > 0) cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  };
  const header = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  let loggedIn = false;

  async function login() {
    if (!user || !password) {
      const err = new Error("MATINGS_APP_USER and MATINGS_APP_PASSWORD are not set on this server");
      err.unconfigured = true;
      throw err;
    }
    cookies.set("wordpress_test_cookie", "WP%20Cookie%20check");
    const body = new URLSearchParams({ log: user, pwd: password, rememberme: "forever", "wp-submit": "Log In", redirect_to: `${origin}/`, testcookie: "1" });
    const res = await fetchImpl(`${origin}/login/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, Cookie: header() },
      body,
      redirect: "manual",
    });
    keep(res);
    loggedIn = [...cookies.keys()].some((k) => k.startsWith("wordpress_logged_in"));
    if (!loggedIn) throw new Error("the Matings App refused the login");
  }

  async function get(url, { binary = false } = {}) {
    if (!loggedIn) await login();
    const res = await fetchImpl(url, { headers: { "User-Agent": UA, Cookie: header() }, redirect: "follow" });
    keep(res);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`the Matings App answered ${res.status} for ${url}`);
    return binary ? { type: res.headers.get("content-type") ?? "image/jpeg", body: Buffer.from(await res.arrayBuffer()) } : res.text();
  }

  return {
    login,
    /** Her page, parsed, or null when the app has no page of that name. */
    horse: async (name) => {
      const html = await get(`${origin}/horses/${slugFor(name)}/`);
      return html ? parseHorsePage(html) : null;
    },
    image: (url) => get(url, { binary: true }),
  };
}

/**
 * Fill each mare's empty description and missing picture from the app.
 * `mares` are rows of my_mares; `photoAt` maps mare id to when her picture
 * was set (none: not in it). `savePhysical(mare, text)` and
 * `savePhoto(mare, { type, body })` write them. Returns a line per mare.
 */
export async function importFromApp({ mares = [], photoAt = new Map(), client, savePhysical, savePhoto, pause = () => new Promise((r) => setTimeout(r, 1500)) }) {
  const report = [];
  for (const m of mares) {
    const line = { id: m.id, name: m.horse_name, found: false, description: "kept", photo: "kept" };
    try {
      const page = await client.horse(m.horse_name);
      if (!sameMare(page, m)) {
        line.found = false;
        report.push(line);
        await pause();
        continue;
      }
      line.found = true;
      if (!String(m.physical ?? "").trim()) {
        const d = descriptionOf(page);
        if (d) {
          await savePhysical(m, d);
          line.description = "filled";
        } else line.description = "none in the app";
      }
      if (!photoAt.has(Number(m.id))) {
        const url = photoOf(page);
        if (url) {
          const img = await client.image(url);
          if (img) {
            await savePhoto(m, img);
            line.photo = "filled";
          }
        } else line.photo = "none in the app";
      }
    } catch (err) {
      line.error = err.message;
    }
    report.push(line);
    await pause();
  }
  return report;
}
