import test from "node:test";
import assert from "node:assert/strict";
import { cleanId, describe, stampText, bodyName, UNSTAMPED } from "./stamp.mjs";

test("the stamp names the profile, then who made the change if someone else did", () => {
  assert.equal(stampText("Stuart Boman", "Eleanor Niel", "StuartBoman", "eleanorniel"), "Stuart Boman / Eleanor Niel");
  assert.equal(stampText("Stuart Boman", "Stuart Boman", "StuartBoman", "stuartboman"), "Stuart Boman");
  assert.equal(stampText("", "", "StuartBoman", "eleanorniel"), "StuartBoman / eleanorniel");
});

test("ids from headers are cleaned and anything odd is refused", () => {
  assert.equal(cleanId(" eleanorniel "), "eleanorniel");
  assert.equal(cleanId("a b"), "");
  assert.equal(cleanId("x".repeat(65)), "");
  assert.equal(cleanId(undefined), "");
});

test("a change is named in the site's words", () => {
  assert.deepEqual(describe("PATCH", "/api/review_horses/812/notes", { notes: "x" }), { area: "Review List", action: "notes changed", target: "#812" });
  assert.deepEqual(describe("POST", "/api/review_horse_actions", { horse_name: "KON TIKI" }), { area: "Review List actions", action: "added", target: "KON TIKI" });
  assert.deepEqual(describe("DELETE", "/api/horseTracking/KON%20TIKI", {}), { area: "Tracked horses", action: "removed", target: "KON TIKI" });
  assert.deepEqual(describe("POST", "/api/sire_tracking", { sireName: "Frankel" }), { area: "Tracked sires", action: "added", target: "Frankel" });
  assert.deepEqual(describe("PATCH", "/api/daily_notifications_all_users/55/done", {}), { area: "Daily Watch List", action: "done changed", target: "#55" });
  assert.equal(describe("PUT", "/api/hitsales/lists/StuartBoman/tatts-dec-mares-2026", {}).target, "tatts-dec-mares-2026");
  assert.equal(describe("POST", "/api/some_new_thing", { horseName: "X" }).area, "some new thing");
});

test("the name comes from the body where it carries one", () => {
  assert.equal(bodyName({ horseName: " Kon Tiki " }), "Kon Tiki");
  assert.equal(bodyName([1, 2]), "");
  assert.equal(bodyName(null), "");
});

test("signing in and the AI chat are not stamped", () => {
  for (const p of ["/api/login", "/api/change-password", "/api/chat/send", "/api/ai/ask", "/api/notifications/seen"]) assert.ok(UNSTAMPED.test(p), p);
  assert.ok(!UNSTAMPED.test("/api/airline"));
  assert.ok(!UNSTAMPED.test("/api/review_horses/1/notes"));
});
