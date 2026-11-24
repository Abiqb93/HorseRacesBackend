/**
 * The middleware that stamps each change (profile/stamp.mjs). server.jsx
 * registers it ahead of every route, so it sees every change the site makes.
 */
import { cleanId, sameUser, describe, NAME_BY_ID, UNSTAMPED } from "./stamp.mjs";

const GRANTS_TTL_MS = 60_000;

export function makeStampMiddleware(db, { now = () => Date.now() } = {}) {
  let grants = { at: -Infinity, keys: new Set() };
  const loadGrants = () =>
    new Promise((resolve) => {
      if (now() - grants.at < GRANTS_TTL_MS) return resolve(grants.keys);
      db.query("SELECT owner_user_id, delegate_user_id FROM profile_access", (err, rows) => {
        if (!err) {
          grants = {
            at: now(),
            keys: new Set((rows || []).map((r) => `${String(r.owner_user_id).toLowerCase()}|${String(r.delegate_user_id).toLowerCase()}`)),
          };
        }
        resolve(grants.keys);
      });
    });

  return function stampChanges(req, res, next) {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !req.path.startsWith("/api/") || UNSTAMPED.test(req.path)) return next();
    const profile = cleanId(req.get("X-Profile-User"));
    if (!profile) return next();
    const acting = cleanId(req.get("X-Acting-User")) || profile;

    const stamp = () => {
      res.on("finish", () => {
        if (res.statusCode >= 400) return;
        const { area, action, target } = describe(req.method, req.path, req.body);
        const write = (named) =>
          db.query(
            "INSERT INTO profile_activity (profile_user_id, acting_user_id, method, path, area, action, target) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [profile, acting, req.method, req.path.slice(0, 255), area, action, (named || target || "").slice(0, 255) || null],
            (err) => { if (err) console.error("profile_activity insert failed:", err.message); }
          );
        const lookup = NAME_BY_ID[area];
        const id = /^#(\d+)$/.exec(target || "")?.[1];
        if (!lookup || !id) return write();
        // The table and column are this module's own constants, never the request's.
        db.query(`SELECT \`${lookup[1]}\` AS name FROM \`${lookup[0]}\` WHERE id = ? LIMIT 1`, [id], (err, rows) => {
          const name = !err && rows?.[0]?.name ? String(rows[0].name).trim() : "";
          write(name || null);
        });
      });
      next();
    };

    if (sameUser(profile, acting)) return stamp();
    // Someone working in another profile: only where they have been given access.
    loadGrants().then((keys) => {
      if (!keys.has(`${profile.toLowerCase()}|${acting.toLowerCase()}`)) {
        return res.status(403).json({ error: `${acting} has no access to ${profile}'s profile` });
      }
      stamp();
    });
  };
}
