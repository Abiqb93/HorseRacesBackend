import test from "node:test";
import assert from "node:assert/strict";

import { MAX_PHYSICAL, createProfiles, readPhoto, readPhysical, stallionIdOk } from "./profiles.mjs";

/** The two tables and the mares, in memory, as the module sees them. */
function fakeDb({ mares = [{ id: 104, user_id: "richardbrown1" }] } = {}) {
  const stallions = new Map();
  const photos = new Map();
  const runQuery = async (sql, args = []) => {
    if (/^CREATE TABLE/.test(sql)) return {};
    if (/^SELECT stallion_id/.test(sql)) return [...stallions.values()].filter((r) => r.physical !== null);
    if (/^INSERT INTO stallion_profiles/.test(sql)) {
      const [stallion_id, stallion_name, physical, updated_by, updated_at] = args;
      const old = stallions.get(stallion_id);
      stallions.set(stallion_id, { stallion_id, stallion_name: stallion_name ?? old?.stallion_name ?? null, physical, updated_by, updated_at });
      return {};
    }
    if (/^DELETE FROM stallion_profiles/.test(sql)) return stallions.delete(args[0]), {};
    if (/^SELECT id FROM my_mares/.test(sql)) return mares.filter((m) => m.id === args[0] && m.user_id === args[1]);
    if (/^INSERT INTO mare_photos/.test(sql)) {
      const [mare_id, user_id, type, bytes, content, updated_at] = args;
      photos.set(mare_id, { mare_id, user_id, type, bytes, content, updated_at });
      return {};
    }
    if (/^SELECT type, content/.test(sql)) return [...photos.values()].filter((p) => p.mare_id === args[0] && p.user_id === args[1]);
    if (/^DELETE FROM mare_photos/.test(sql)) {
      const p = photos.get(args[0]);
      if (p && p.user_id === args[1]) photos.delete(args[0]);
      return {};
    }
    if (/^SELECT mare_id, updated_at/.test(sql)) return [...photos.values()].filter((p) => p.user_id === args[0]);
    throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
  };
  return { runQuery, stallions, photos };
}

const JPEG = `data:image/jpeg;base64,${Buffer.from("not really a jpeg").toString("base64")}`;

test("a description is trimmed, cleared when empty, and refused when it is a document", () => {
  assert.deepEqual(readPhysical("  16.2, deep girth  "), { value: "16.2, deep girth" });
  assert.deepEqual(readPhysical(""), { value: null });
  assert.deepEqual(readPhysical(null), { value: null });
  assert.match(readPhysical(undefined).error, /required/);
  assert.match(readPhysical("x".repeat(MAX_PHYSICAL + 1)).error, /at most/);
});

test("a picture is a JPEG, PNG or WebP data URL of a sensible size", () => {
  const ok = readPhoto(JPEG);
  assert.equal(ok.type, "image/jpeg");
  assert.equal(ok.body.toString(), "not really a jpeg");
  assert.match(readPhoto("https://example.com/a.jpg").error, /data URL/);
  assert.match(readPhoto("data:image/gif;base64,R0lG").error, /JPEG, PNG or WebP/);
  assert.match(readPhoto(`data:image/png;base64,${Buffer.alloc(3.5 * 1024 * 1024).toString("base64")}`).error, /at most 3 MB/);
});

test("stallion ids are the roster's, and nothing else gets near the query", () => {
  assert.ok(stallionIdOk("427637"));
  assert.ok(stallionIdOk("add-powerful-glory-2022"));
  assert.ok(!stallionIdOk("1; DROP TABLE"));
  assert.ok(!stallionIdOk(""));
});

test("a stallion's description is shared, says who wrote it, and an empty one clears it", async () => {
  const db = fakeDb();
  const p = createProfiles(db);
  const saved = await p.saveStallion({ id: "425259", name: "Belardo", physical: "Strong, 15.3½, good bone", userId: "richardbrown1" });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.updatedBy, "richardbrown1");
  const all = await p.stallionProfiles();
  assert.deepEqual(Object.keys(all), ["425259"]);
  assert.equal(all["425259"].physical, "Strong, 15.3½, good bone");
  assert.equal(all["425259"].name, "Belardo");
  // another user's edit replaces it, and the name is kept when not sent
  await p.saveStallion({ id: "425259", physical: "Strong; plain head", userId: "TomWilson" });
  const again = await p.stallionProfiles();
  assert.equal(again["425259"].updatedBy, "TomWilson");
  assert.equal(again["425259"].name, "Belardo");
  await p.saveStallion({ id: "425259", physical: "", userId: "TomWilson" });
  assert.deepEqual(await p.stallionProfiles(), {});
  assert.equal((await p.saveStallion({ id: "bad id!", physical: "x", userId: "u" })).status, 400);
  assert.equal((await p.saveStallion({ id: "1", physical: "x" })).status, 400, "who wrote it is required");
});

test("a mare's picture is hers: saved, read and deleted only by her owner", async () => {
  const db = fakeDb();
  const p = createProfiles(db);
  assert.equal((await p.saveMarePhoto({ userId: "TomWilson", mareId: 104, data: JPEG })).status, 404, "not his mare");
  const saved = await p.saveMarePhoto({ userId: "richardbrown1", mareId: 104, data: JPEG });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.type, "image/jpeg");
  assert.equal((await p.marePhoto({ userId: "richardbrown1", mareId: 104 })).body.toString(), "not really a jpeg");
  assert.equal(await p.marePhoto({ userId: "TomWilson", mareId: 104 }), null);
  assert.deepEqual([...(await p.photoTimes("richardbrown1")).keys()], [104]);
  await p.deleteMarePhoto({ userId: "TomWilson", mareId: 104 });
  assert.ok(await p.marePhoto({ userId: "richardbrown1", mareId: 104 }), "another user cannot delete it");
  await p.deleteMarePhoto({ userId: "richardbrown1", mareId: 104 });
  assert.equal(await p.marePhoto({ userId: "richardbrown1", mareId: 104 }), null);
  assert.equal((await p.saveMarePhoto({ userId: "richardbrown1", mareId: 104, data: "nope" })).status, 400);
});
