/**
 * Working in another user's profile, and the stamp every change carries.
 *
 * (24 November 2026: "Eleanor Niel is often working in Stuart Boman's profile.
 * Can we set up the site so that Eleanor can work through Stuarts Profile.
 * Review horses, update horses, add comments etc. But whenever she does that it
 * leaves a user stamp on who made the change e.g. Stuart Boman / Eleanor Niel.")
 *
 * The site sends two headers on every change it makes: X-Profile-User, the
 * profile the change is made in, and X-Acting-User, the person signed in.
 * They differ only while someone works in a profile they have been given
 * access to (profile_access). Each change that succeeds is written to
 * profile_activity with both ids, so the stamp reads "Stuart Boman / Eleanor
 * Niel" for Eleanor's changes and "Stuart Boman" for Stuart's own.
 */

/** A user id as the headers carry it: trimmed, at most 64 characters, or "". */
export function cleanId(value) {
  const s = String(value ?? "").trim();
  return /^[A-Za-z0-9_.@-]{1,64}$/.test(s) ? s : "";
}

export const sameUser = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

/** "Stuart Boman / Eleanor Niel", or one name when the profile's owner made the change. */
export function stampText(profileName, actingName, profileId, actingId) {
  const owner = profileName || profileId || "";
  if (!actingId || sameUser(profileId, actingId)) return owner;
  return `${owner} / ${actingName || actingId}`;
}

// What each change is, in the site's words. First match wins; `what` names the
// field where the path does.
const AREAS = [
  [/^\/api\/review_horses\/([^/]+)\/(notes|reason_to_track|assign_action|reviewStatus|tagged_users)$/, "Review List", (m) => ({ id: m[1], what: FIELD[m[2]] })],
  [/^\/api\/review_horse_actions(?:\/([^/]+))?(?:\/status)?$/, "Review List actions", (m) => ({ id: m[1] })],
  [/^\/api\/potential_stallion\/([^/]+)\/(notes|reviewStatus)$/, "Potential stallions", (m) => ({ id: m[1], what: FIELD[m[2]] })],
  [/^\/api\/daily_notifications_all_users\/([^/]+)\/(done|bookmark|notes|invite)$/, "Daily Watch List", (m) => ({ id: m[1], what: FIELD[m[2]] })],
  [/^\/api\/race_watchlist(?:\/([^/]+))?(?:\/(done|bookmark|notes|notify))?$/, "Race watch list", (m) => ({ id: m[1], what: FIELD[m[2]] })],
  [/^\/api\/horseTracking(?:\/([^/]+))?(?:\/(type|dslr-review))?$/, "Tracked horses", (m) => ({ name: m[1], what: FIELD[m[2]] })],
  [/^\/api\/(sire|dam|owner|jockey)_tracking(?:\/([^/]+))?$/, null, (m) => ({ area: `Tracked ${m[1]}s`, id: m[2] })],
  [/^\/api\/reviewed_results/, "Reviewed results", () => ({})],
  [/^\/api\/mares\/[^/]+\/([^/]+)(?:\/([a-z-]+))?/, "My Mares", (m) => ({ id: m[1], what: m[2] ? m[2].replace(/-/g, " ") : undefined })],
  [/^\/api\/mares$/, "My Mares", () => ({})],
  [/^\/api\/bookings\/[^/]+(?:\/([^/]+))?/, "Bookings", (m) => ({ id: m[1] })],
  [/^\/api\/hitsales\/lists\/[^/]+\/([^/]+)$/, "Sale lists", (m) => ({ name: m[1] })],
  [/^\/api\/hitsales\/columns\//, "Column layouts", () => ({})],
  [/^\/api\/bloodstock_clients(?:\/([^/]+))?$/, "Client List", (m) => ({ id: m[1] })],
  [/^\/api\/horse_tracking_shares/, "Shared horses", () => ({})],
];

const FIELD = {
  notes: "notes",
  reason_to_track: "reason to track",
  assign_action: "action",
  reviewStatus: "review status",
  tagged_users: "tagged users",
  done: "done",
  bookmark: "bookmark",
  invite: "invite",
  notify: "notify",
  type: "tracking type",
  "dslr-review": "days since last run review",
};

const VERB = { POST: "added", PUT: "saved", PATCH: "changed", DELETE: "removed" };

/** The horse, mare or other name a change body carries, if any. */
export function bodyName(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  for (const k of ["horseName", "horse_name", "HorseName", "mareName", "mare_name", "sireName", "damName", "ownerName", "jockeyName", "name"]) {
    const v = body[k];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 120);
  }
  return "";
}

const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

/**
 * One activity row for a change: area (the page, as the sidebar names it),
 * action ("notes changed"), target (a horse's name or the record id).
 */
export function describe(method, path, body) {
  const verb = VERB[method] || method.toLowerCase();
  for (const [re, area, read] of AREAS) {
    const m = re.exec(path);
    if (!m) continue;
    const got = read(m) || {};
    const target = bodyName(body) || (got.name ? decode(got.name) : "") || (got.id ? `#${decode(got.id)}` : "");
    return {
      area: got.area || area,
      action: got.what ? `${got.what} ${verb}` : verb,
      target: target.slice(0, 255),
    };
  }
  const seg = /^\/api\/([^/]+)/.exec(path)?.[1] || path;
  return { area: seg.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"), action: verb, target: bodyName(body) };
}

/**
 * Writes that are not work on the profile's horses: signing in and account
 * settings, the AI chat, and marking notifications seen.
 */
export const UNSTAMPED = /^\/api\/(login|register|change-password|forgot-password|update-mobile|chat|ai|notifications)(\/|$)/;
