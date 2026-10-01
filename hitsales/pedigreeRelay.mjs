/**
 * The sale catalogue's pedigree pages, relayed so they open in a browser.
 *
 * The desk, 1 October 2026 (a screen recording): clicking a lot's "Pedigree
 * page" downloaded 379.pdf instead of showing it. Tattersalls serves its
 * catalogue pages with `Content-Disposition: attachment`, so a browser saves
 * them rather than opening them; and neither Tattersalls nor Arqana sends CORS
 * headers, so the site cannot fetch the pages to page through them or to merge
 * a filtered list's pages into one PDF.
 *
 * This fetches one catalogue page from the sale house and hands it on
 * `inline`, with the site's CORS (server.jsx). It relays nothing else. The
 * address must be https, on Tattersalls' or Arqana's own host, in the folder
 * each keeps its catalogue pages in, and a .pdf (or Tattersalls' .jpg of the
 * same page); no query, no fragment, no port, no credentials. A redirect is
 * refused rather than followed, so the relay can only ever have fetched the
 * address it checked.
 *
 * Pages are kept in memory for an hour, up to 40 MB in all, so paging back and
 * forth through a list, or building a pack of it, asks the sale house once.
 */

/** Where each sale house keeps its catalogue pages. */
export const SOURCES = [
  // https://www.tattersalls.com/cat/autumnhit/2026/379.pdf, and the page as a picture, 379.jpg
  { house: "tattersalls", host: "www.tattersalls.com", path: /^\/cat\/[a-z0-9_-]+\/\d{4}\/[a-z0-9_-]+\.(pdf|jpg)$/i },
  // https://www.arqana.com/upload/pedigrees/vente414/fra/6.pdf
  { house: "arqana", host: "www.arqana.com", path: /^\/upload\/pedigrees\/[a-z0-9_-]+\/(?:[a-z]{2,3}\/)?[a-z0-9_-]+\.pdf$/i },
];

const TYPES = { pdf: "application/pdf", jpg: "image/jpeg" };
const MAX_PAGE_BYTES = 10 * 1024 * 1024;

/** The address as a URL when it is a catalogue page this relays, else null. */
export function pedigreeUrl(raw) {
  if (typeof raw !== "string" || raw.length > 500) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash) return null;
  const source = SOURCES.find((s) => s.host === u.hostname.toLowerCase() && s.path.test(u.pathname));
  return source ? u : null;
}

const extOf = (url) => url.pathname.toLowerCase().split(".").pop();

/** The headers a relayed page goes out with: shown in the browser, named for its lot. */
export function inlineHeaders(url) {
  const name = url.pathname.split("/").pop();
  return {
    "Content-Type": TYPES[extOf(url)],
    "Content-Disposition": `inline; filename="${name}"`,
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
}

class RelayError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/**
 * A relay with its own memory: `relay(url)` resolves to `{ body, type }` for
 * an address pedigreeUrl has passed, from the cache where it can.
 */
export function createRelay({ fetchImpl = fetch, maxBytes = 40 * 1024 * 1024, ttlMs = 60 * 60 * 1000, timeoutMs = 15000, now = Date.now } = {}) {
  const cache = new Map();
  let held = 0;
  const forget = (key) => {
    const hit = cache.get(key);
    if (!hit) return;
    held -= hit.body.length;
    cache.delete(key);
  };

  return async function relay(url) {
    const key = url.href;
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) {
      // most recently used goes to the back of the queue
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    forget(key);

    let res;
    try {
      res = await fetchImpl(key, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "Blandford Bloodstock catalogue reader" } });
    } catch (err) {
      throw new RelayError(`The sale house did not answer: ${err.message}`);
    }
    if (res.status === 404) throw new RelayError("The sale house has no such catalogue page", 404);
    if (res.status !== 200) throw new RelayError(`The sale house answered ${res.status}`);
    const want = TYPES[extOf(url)];
    const type = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (type && type !== want) throw new RelayError(`The sale house sent ${type}, not ${want}`);
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_PAGE_BYTES) throw new RelayError("The catalogue page is larger than a catalogue page should be");

    const page = { body, type: want, at: now() };
    cache.set(key, page);
    held += body.length;
    for (const k of cache.keys()) {
      if (held <= maxBytes) break;
      forget(k);
    }
    return page;
  };
}
