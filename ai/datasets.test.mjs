import test from "node:test";
import assert from "node:assert/strict";
import {
  loadDataset, resetDatasetCache, datasetCacheStatus, describeShape, describeShapeText, flattenGroups,
} from "./datasets.mjs";

/** A fetch that serves one JSON body, counts its calls, and honours If-None-Match. */
function fakeSite(body, { etag = 'W/"abc"' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, headers: init.headers || {} });
    if (init.headers?.["If-None-Match"] === etag) {
      return { status: 304, ok: false, headers: new Headers(), text: async () => "" };
    }
    return {
      status: 200,
      ok: true,
      headers: new Headers({ etag }),
      text: async () => JSON.stringify(body),
    };
  };
  return { calls, fetchImpl };
}

test.beforeEach(() => resetDatasetCache());

test("a dataset is fetched once and then served from memory", async () => {
  const site = fakeSite({ rows: [1, 2, 3] });
  const first = await loadDataset("https://x/a.json", { fetchImpl: site.fetchImpl });
  const second = await loadDataset("https://x/a.json", { fetchImpl: site.fetchImpl });
  assert.deepEqual(first.json, { rows: [1, 2, 3] });
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(site.calls.length, 1, "the second read must not touch the site");
  assert.equal(datasetCacheStatus().length, 1);
});

test("two reads of the same file at the same moment share one fetch", async () => {
  const site = fakeSite({ n: 1 });
  const [a, b] = await Promise.all([
    loadDataset("https://x/b.json", { fetchImpl: site.fetchImpl }),
    loadDataset("https://x/b.json", { fetchImpl: site.fetchImpl }),
  ]);
  assert.deepEqual(a.json, b.json);
  assert.equal(site.calls.length, 1);
});

test("once stale it is revalidated with the ETag, and a 304 keeps the copy", async () => {
  const site = fakeSite({ v: "same" });
  let clock = 0;
  const now = () => clock;
  await loadDataset("https://x/c.json", { fetchImpl: site.fetchImpl, now, freshMs: 100 });
  clock = 200;
  const again = await loadDataset("https://x/c.json", { fetchImpl: site.fetchImpl, now, freshMs: 100 });
  assert.equal(site.calls.length, 2);
  assert.equal(site.calls[1].headers["If-None-Match"], 'W/"abc"');
  assert.equal(again.revalidated, true);
  assert.deepEqual(again.json, { v: "same" });
  // Fresh again for another window.
  clock = 250;
  await loadDataset("https://x/c.json", { fetchImpl: site.fetchImpl, now, freshMs: 100 });
  assert.equal(site.calls.length, 2);
});

test("a site that cannot be reached serves the copy held rather than failing", async () => {
  const site = fakeSite({ v: 1 });
  let clock = 0;
  const now = () => clock;
  await loadDataset("https://x/d.json", { fetchImpl: site.fetchImpl, now, freshMs: 100 });
  clock = 500;
  const down = async () => { throw new Error("ECONNRESET"); };
  const got = await loadDataset("https://x/d.json", { fetchImpl: down, now, freshMs: 100 });
  assert.deepEqual(got.json, { v: 1 });
  assert.equal(got.stale, "ECONNRESET");
});

test("the first read of an unreachable file is an error, not a crash", async () => {
  const down = async () => ({ status: 503, ok: false, headers: new Headers(), text: async () => "" });
  await assert.rejects(loadDataset("https://x/e.json", { fetchImpl: down }), /HTTP 503/);
});

test("the shape shows where the rows are and what a row holds", () => {
  const board = {
    generatedAt: "2026-10-22T07:04:36.146Z",
    windows: {
      w7: { "ukire-2yo-2026": [{ horse: "Night In Vegas", rating: 106.5, zS: 0.6 }, { horse: "B", rating: 1, zS: 0 }] },
    },
  };
  const shape = describeShape(board);
  assert.equal(shape.windows.w7["ukire-2yo-2026"].array, 2);
  assert.equal(shape.windows.w7["ukire-2yo-2026"].item.horse, "Night In Vegas");
  assert.equal(shape.windows.w7["ukire-2yo-2026"].item.rating, 106.5);
});

test("a dictionary of thousands of keys is described by a few of them and one entry", () => {
  const horses = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`HORSE ${i}`, [{ d: "2026-10-02", c: "Ascot" }]]));
  const shape = describeShape(horses);
  assert.equal(shape.object, 5000);
  assert.equal(shape.keys.length, 12);
  assert.deepEqual(shape.item, { array: 1, item: { d: "2026-10-02", c: "Ascot" } });
  assert.ok(JSON.stringify(shape).length < 600);
});

test("the text form stays within its limit by describing less deeply", () => {
  const wide = { rows: Array.from({ length: 3 }, () => Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${i}`, "x".repeat(40)]))) };
  const text = describeShapeText(wide, 300);
  assert.ok(text.length <= 300, `${text.length} chars`);
});

test("an object of arrays flattens to one array that remembers its groups", () => {
  const window = {
    "ukire-2yo-2026": [{ horse: "A", zS: 2.1 }],
    "fr-3yo-2026": [{ horse: "B", zS: 0.2 }, { horse: "C", zS: 2.5 }],
  };
  const rows = flattenGroups(window);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { _group: "ukire-2yo-2026", horse: "A", zS: 2.1 });
  assert.equal(rows[2]._group, "fr-3yo-2026");
});

test("anything that is not an object of arrays is left alone", () => {
  const rows = [{ a: 1 }];
  assert.equal(flattenGroups(rows), rows);
  const mixed = { a: [1], b: { c: 1 } };
  assert.equal(flattenGroups(mixed), mixed);
  assert.equal(flattenGroups(null), null);
  assert.equal(flattenGroups("x"), "x");
});
