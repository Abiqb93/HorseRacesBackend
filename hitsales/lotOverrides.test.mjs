import test from "node:test";
import assert from "node:assert/strict";
import { mergeLotOverride, cleanLinks, cleanField } from "./lotOverrides.mjs";

test("a change lays over the stored record: fields set and cleared, links replaced, a web address or nothing", () => {
  const first = mergeLotOverride(null, { fields: { bhaLatest: "102", tfMax: 110, name: " Segall " }, links: [{ label: "France Galop", url: "https://www.france-galop.com/x" }] }, { by: "tom", at: "2026-10-16T10:00:00Z" });
  assert.deepEqual(first, { fields: { bhaLatest: 102, tfMax: 110, name: "Segall" }, links: [{ label: "France Galop", url: "https://www.france-galop.com/x" }], by: "tom", at: "2026-10-16T10:00:00Z" });
  const second = mergeLotOverride(first, { fields: { tfMax: null, masterLatest: 99.5 } }, { by: "charlie", at: "2026-10-16T11:00:00Z" });
  assert.deepEqual(second.fields, { bhaLatest: 102, name: "Segall", masterLatest: 99.5 });
  assert.deepEqual(second.links, first.links, "links not given stand");
  assert.equal(second.by, "charlie");
  const third = mergeLotOverride(second, { links: [{ url: "javascript:alert(1)" }, { url: "https://www.galopp-sieger.de/h/1" }, { url: "https://www.galopp-sieger.de/h/1", label: "twice" }] });
  assert.deepEqual(third.links, [{ label: "www.galopp-sieger.de/h/1", url: "https://www.galopp-sieger.de/h/1" }]);
  assert.equal(mergeLotOverride(null, { fields: { "bad key": 1, ["x".repeat(50)]: 2 }, links: [] }), null, "nothing kept is no record");
  assert.equal(cleanField(" 95 "), 95); assert.equal(cleanField("abc"), "abc"); assert.equal(cleanField(""), null); assert.equal(cleanField(Infinity), undefined);
  assert.deepEqual(cleanLinks("nope"), []);
});
