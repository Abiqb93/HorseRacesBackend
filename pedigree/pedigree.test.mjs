import test from "node:test";
import assert from "node:assert/strict";

import { findQuery, foalingYearOf, normaliseName, rowFor, upsertArgs } from "./store.mjs";
import { AmbiguousError, BlockedError, getPedigree, throttle } from "./client.mjs";

/* --------------------------------------------------------------- the cache */

test("a name is normalised the way the frontend normalises it", () => {
  // These two must agree or a pedigree cached under one spelling is refetched
  // under the other, at 25 seconds a time.
  assert.equal(normaliseName("=Frankel (GB)"), "frankel");
  assert.equal(normaliseName("*Nasrullah"), "nasrullah");
  assert.equal(normaliseName("Sadler's Wells"), "sadlers wells");
  assert.equal(normaliseName("SADLERS WELLS (USA)"), "sadlers wells");
  assert.equal(normaliseName(null), "");
});

test("a reference number decides the lookup on its own", () => {
  const q = findQuery({ name: "anything at all", year: 1999, ref: "9175831" });
  assert.match(q.sql, /WHERE reference = \?/);
  assert.deepEqual(q.args, ["9175831"]);
});

test("without a reference the year is part of the key", () => {
  // Night of Thunder (IRE) and (ARG) are different horses. A lookup on name
  // alone would serve one under the other's name.
  const q = findQuery({ name: "Night of Thunder", year: 2011 });
  assert.match(q.sql, /name_key = \? AND foaling_year = \?/);
  assert.deepEqual(q.args, ["night of thunder", 2011]);
});

test("no year falls back to the most recent horse of that name", () => {
  const q = findQuery({ name: "Night of Thunder" });
  assert.match(q.sql, /ORDER BY foaling_year DESC/);
  assert.deepEqual(q.args, ["night of thunder"]);
});

test("a nameless, referenceless request has no query to make", () => {
  assert.equal(findQuery({ name: "", year: 2011 }), null);
  assert.equal(findQuery({}), null);
});

test("a row carries the columns the identity rule reads", () => {
  const row = rowFor({
    horse: { name: "=Frankel (GB)", reference_number: 8333732, foaled: "February 11,2008", sex: "Horse" },
  });
  assert.equal(row.reference, "8333732");
  assert.equal(row.name_key, "frankel");
  assert.equal(row.display, "=Frankel (GB)"); // stored as written; the frontend strips for display
  assert.equal(row.foaling_year, 2008);
  assert.equal(row.sex, "Horse");
  assert.equal(upsertArgs(row).length, 6);
  assert.deepEqual(JSON.parse(row.payload).horse.reference_number, 8333732);
});

test("a payload with no reference is not cached", () => {
  // The reference is the primary key. Without it there is nothing to write,
  // and writing a guessed key would collide two horses.
  assert.equal(rowFor({ horse: { name: "Somebody" } }), null);
  assert.equal(rowFor({ horse: { reference_number: 1 } }), null);
  assert.equal(rowFor({}), null);
  assert.equal(rowFor(null), null);
});

test("a foaling year is read out of the source's date string", () => {
  assert.equal(foalingYearOf("February 11,2008"), 2008);
  assert.equal(foalingYearOf("March 30,1970"), 1970);
  assert.equal(foalingYearOf(undefined), null);
});

/* ------------------------------------------------------------ the throttle */

/**
 * The real gap between upstream calls is 45 seconds, which is the point of
 * this module; a suite that honoured it would take minutes and get skipped.
 * Each case winds it down and clears any backoff left by the one before.
 */
const fast = () => {
  process.env.PEDIGREE_MIN_INTERVAL_MS = "1";
  process.env.PEDIGREE_JITTER_MS = "1";
  process.env.PEDIGREE_BLOCK_BACKOFF_MS = String(5 * 60_000);
  process.env.PARSE_API_KEY = "test-key-not-a-real-one";
  throttle.reset();
};

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

test("a block is recognised and raised as a block, not a generic failure", async () => {
  fast();
  const fetchImpl = async () =>
    jsonResponse({ error: { message: "Site protection is currently blocking all proxies; retry later." } });
  await assert.rejects(
    () => getPedigree({ name: "Frankel", year: 2008 }, { fetchImpl }),
    (err) => {
      assert.ok(err instanceof BlockedError, "should be a BlockedError");
      assert.equal(err.blocked, true);
      return true;
    },
  );
  // A block puts the whole queue to sleep, not just this request: the next
  // caller must not walk straight back into it.
  assert.ok(throttle.isBlocked, "the queue should now be backed off");
  assert.ok(throttle.waitEstimateMs() > 60_000, "backoff should be minutes, not seconds");
});

test("an ambiguous name is its own error, so the caller can ask for a reference", async () => {
  fast();
  const fetchImpl = async () =>
    jsonResponse({
      error: { message: "2 horses matched; disambiguate with reference_number, foaling_year or dam_name" },
    });
  await assert.rejects(
    () => getPedigree({ name: "Night of Thunder", year: 2011 }, { fetchImpl }),
    (err) => {
      assert.ok(err instanceof AmbiguousError);
      assert.equal(err.ambiguous, true);
      assert.match(err.message, /reference_number/);
      return true;
    },
  );
});

test("the key travels in a header, never in the URL", async () => {
  fast();
  let seenUrl = null;
  let seenHeaders = null;
  const fetchImpl = async (url, init) => {
    seenUrl = String(url);
    seenHeaders = init.headers;
    return jsonResponse({ status: "success", data: { horse: { name: "Frankel (GB)" } } });
  };
  const data = await getPedigree({ name: "Frankel", year: 2008 }, { fetchImpl });
  assert.equal(data.horse.name, "Frankel (GB)");
  // Anything that logs a URL would otherwise leak the credential.
  assert.ok(!seenUrl.includes("test-key-not-a-real-one"), "key must not be in the URL");
  assert.match(seenUrl, /horse_name=Frankel/);
  assert.match(seenUrl, /foaling_year=2008/);
  assert.equal(seenHeaders["X-API-Key"], "test-key-not-a-real-one");
});

test("an unset key fails as a configuration problem, not a horse problem", async () => {
  fast();
  const saved = process.env.PARSE_API_KEY;
  delete process.env.PARSE_API_KEY;
  try {
    await assert.rejects(
      () => getPedigree({ name: "Frankel" }, { fetchImpl: async () => jsonResponse({}) }),
      (err) => {
        assert.equal(err.unconfigured, true);
        assert.match(err.message, /PARSE_API_KEY/);
        return true;
      },
    );
  } finally {
    if (saved) process.env.PARSE_API_KEY = saved;
  }
});

test("one failure does not wedge the queue behind it", async () => {
  fast();
  const failing = getPedigree({ name: "Nobody" }, {
    fetchImpl: async () => jsonResponse({ status: "error", error: { message: "No horse matched" } }),
  }).catch((e) => e.message);
  assert.match(await failing, /No horse matched/);

  // The next caller must still be served. Before the queue's tail swallowed
  // rejections, an error here left every later request pending forever.
  const after = await getPedigree({ name: "Frankel" }, {
    fetchImpl: async () => jsonResponse({ status: "success", data: { horse: { name: "Frankel (GB)" } } }),
  });
  assert.equal(after.horse.name, "Frankel (GB)");
});
