import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { makeStampMiddleware } from "./middleware.mjs";

const fakeDb = (grants = [["StuartBoman", "eleanorniel"]]) => {
  const inserts = [];
  return {
    inserts,
    query(sql, args, cb) {
      if (typeof args === "function") { cb = args; args = []; }
      if (/FROM profile_access/.test(sql)) return cb(null, grants.map(([o, d]) => ({ owner_user_id: o, delegate_user_id: d })));
      if (/INSERT INTO profile_activity/.test(sql)) { inserts.push(args); return cb?.(null); }
      if (/FROM `review_horses` WHERE id/.test(sql)) return cb(null, args[0] === "812" ? [{ name: "KON TIKI" }] : []);
      cb(new Error("unexpected " + sql));
    },
  };
};

function run(mw, { method = "PATCH", path = "/api/review_horses/812/notes", headers = {}, body = {}, status = 200 } = {}) {
  return new Promise((resolve) => {
    const res = new EventEmitter();
    res.statusCode = status;
    res.status = (s) => { res.statusCode = s; return res; };
    res.json = (j) => resolve({ blocked: true, status: res.statusCode, json: j });
    const req = { method, path, body, get: (h) => headers[h] ?? headers[h.toLowerCase()] };
    mw(req, res, () => { res.emit("finish"); setImmediate(() => resolve({ blocked: false })); });
  });
}

test("Eleanor's change in Stuart's profile is stamped with both of them", async () => {
  const db = fakeDb();
  const out = await run(makeStampMiddleware(db), { headers: { "X-Profile-User": "StuartBoman", "X-Acting-User": "eleanorniel" } });
  assert.equal(out.blocked, false);
  assert.deepEqual(db.inserts, [["StuartBoman", "eleanorniel", "PATCH", "/api/review_horses/812/notes", "Review List", "notes changed", "KON TIKI"]]);
});

test("a user's change in their own profile is stamped with them alone", async () => {
  const db = fakeDb();
  await run(makeStampMiddleware(db), { method: "POST", path: "/api/review_horse_actions", body: { horse_name: "KON TIKI" }, headers: { "X-Profile-User": "StuartBoman" } });
  assert.deepEqual(db.inserts[0].slice(0, 2), ["StuartBoman", "StuartBoman"]);
  assert.equal(db.inserts[0][6], "KON TIKI");
});

test("working in a profile without access is refused and nothing is written", async () => {
  const db = fakeDb();
  const out = await run(makeStampMiddleware(db), { headers: { "X-Profile-User": "TomWilson", "X-Acting-User": "eleanorniel" } });
  assert.equal(out.blocked, true);
  assert.equal(out.status, 403);
  assert.equal(db.inserts.length, 0);
});

test("reads, failed changes, sign-in and requests with no profile are not stamped", async () => {
  const db = fakeDb();
  const mw = makeStampMiddleware(db);
  const h = { "X-Profile-User": "StuartBoman" };
  await run(mw, { method: "GET", headers: h });
  await run(mw, { headers: h, status: 500 });
  await run(mw, { method: "POST", path: "/api/login", headers: h });
  await run(mw, {});
  assert.equal(db.inserts.length, 0);
});

test("access is matched whatever the case of the ids", async () => {
  const db = fakeDb();
  const out = await run(makeStampMiddleware(db), { headers: { "X-Profile-User": "stuartboman", "X-Acting-User": "EleanorNiel" } });
  assert.equal(out.blocked, false);
  assert.equal(db.inserts.length, 1);
});

test("a row saved by number keeps its number when the name cannot be found", async () => {
  const db = fakeDb();
  await run(makeStampMiddleware(db), { path: "/api/review_horses/999/notes", headers: { "X-Profile-User": "StuartBoman" } });
  assert.equal(db.inserts[0][6], "#999");
});
