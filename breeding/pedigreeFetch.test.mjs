import test from "node:test";
import assert from "node:assert/strict";

import { createMareFetcher, describeFailure, pickHers } from "./pedigreeFetch.mjs";
import * as store from "../pedigree/store.mjs";

/* The source's own words for a name it could not settle, as the Pedigrees page showed them. */
const ANTISANA = [
  { name: "=Antisana (GB)", foaling_year: 2015, sex: "Mare", sire: "Dubawi (IRE)", dam: "=Lava Flow (IRE)", reference_number: 9924938 },
  { name: "Antisana", foaling_year: 1933, sex: "Mare", sire: "*Snob II", dam: "*Musidora", reference_number: 15240 },
];

test("of the horses the source names, hers is the one her year agrees with", () => {
  assert.equal(pickHers(ANTISANA, { horse_name: "Antisana", foaling_year: 2015 })?.reference_number, 9924938);
  assert.equal(pickHers(ANTISANA, { horse_name: "Antisana", foaling_year: 1933 })?.reference_number, 15240);
});

test("with nothing to tell them apart, none is picked: a wrong chart on the right mare is invisible", () => {
  assert.equal(pickHers(ANTISANA, { horse_name: "Antisana" }), null);
  assert.equal(pickHers(ANTISANA, { horse_name: "Antisana", foaling_year: 2001 }), null);
  assert.equal(pickHers([], { horse_name: "Antisana", foaling_year: 2015 }), null);
});

test("the country and the sire tell namesakes of a year apart, and a colt is never a mare", () => {
  const two = [
    { name: "=Lady Vivian (IRE)", foaling_year: 2022, sex: "Mare", sire: "Camelot (GB)", reference_number: 1 },
    { name: "=Lady Vivian (FR)", foaling_year: 2022, sex: "Mare", sire: "Born to Sea (IRE)", reference_number: 2 },
    { name: "Lady Vivian", foaling_year: 2022, sex: "Colt", sire: "Camelot (GB)", reference_number: 3 },
  ];
  assert.equal(pickHers(two, { horse_name: "Lady Vivian", foaling_year: 2022, country_code: "IRE" })?.reference_number, 1);
  assert.equal(pickHers(two, { horse_name: "Lady Vivian", foaling_year: 2022, sire_name: "Born To Sea" })?.reference_number, 2);
  assert.equal(pickHers(two, { horse_name: "Lady Vivian", foaling_year: 2022 }), null);
  // an entry with no reference could not be fetched, so it is never the pick
  assert.equal(pickHers([{ name: "X", foaling_year: 2022, sex: "Mare" }], { horse_name: "X", foaling_year: 2022 }), null);
});

test("a failure is described in the desk's words, and the rejected key by name", () => {
  assert.match(describeFailure({ rejectedKey: true, unconfigured: true, message: "x" }), /PARSE_API_KEY/);
  assert.equal(describeFailure(new Error("get_pedigree: No horse matched")), "No horse matched");
  assert.match(describeFailure({ blocked: true, message: "upstream returned HTTP 429" }), /throttling/);
  assert.equal(describeFailure(null), "the lookup failed");
});

/* ------------------------------------------------------------- the fetcher */

/** The database and the source as the fetcher sees them, with every call recorded. */
function harness({ held = [], answers = {} } = {}) {
  const calls = [];
  const cache = new Map(held.map((h) => [String(h.reference), h]));
  const fake = {
    runQuery: async (sql, args) => {
      calls.push({ sql: sql.slice(0, 40), args });
      if (/^INSERT INTO pedigree_cache/.test(sql)) cache.set(String(args[0]), { reference: args[0], name_key: args[1], foaling_year: args[3] });
      return { affectedRows: 1 };
    },
    queryOne: async (sql, args) => {
      calls.push({ sql: sql.slice(0, 40), args });
      if (/WHERE reference = \?/.test(sql)) return cache.get(String(args[0])) ?? null;
      if (/name_key = \? AND foaling_year = \?/.test(sql)) return [...cache.values()].find((h) => h.name_key === args[0] && h.foaling_year === args[1]) ?? null;
      return null;
    },
    loadStore: async () => store,
    loadClient: async () => ({
      getPedigree: async (ask) => {
        calls.push({ getPedigree: ask });
        // the real source takes seconds; a tick keeps the order of events honest
        await new Promise((r) => setTimeout(r, 2));
        const key = ask.ref ? `ref:${ask.ref}` : `name:${ask.name}`;
        const a = answers[key];
        if (a instanceof Error) throw a;
        if (!a) throw new Error("get_pedigree: No horse matched");
        return a;
      },
    }),
    log: { log: () => {}, error: () => {} },
  };
  return { fake, calls, cache };
}

const payload = (reference, name, foaled, sex = "Mare") => ({ horse: { reference_number: reference, name, foaled, sex } });
const settle = () => new Promise((r) => setTimeout(r, 15));

test("a mare whose chart is already held is linked to it, and nothing is fetched", async () => {
  const { fake, calls } = harness({ held: [{ reference: "777", name_key: "prudenzia", foaling_year: 2005 }] });
  const f = createMareFetcher(fake);
  assert.equal(await f.queue({ id: 45, horse_name: "Prudenzia", foaling_year: 2005, pedigree_reference: null }), "held");
  assert.ok(calls.some((c) => /^UPDATE my_mares SET pedigree_reference/.test(c.sql) && c.args[0] === "777"));
  assert.ok(!calls.some((c) => c.getPedigree));
  assert.equal(f.statusOf(45).state, "held");
});

test("a mare not held is fetched behind the add, filed, and linked to her chart", async () => {
  const { fake, calls, cache } = harness({ answers: { "name:Prudenzia": payload(10555, "Prudenzia (GB)", "April 3,2005") } });
  const f = createMareFetcher(fake);
  assert.equal(await f.queue({ id: 45, horse_name: "Prudenzia", foaling_year: 2005 }), "pending");
  assert.equal(f.statusOf(45).state, "pending");
  await settle();
  assert.equal(f.statusOf(45).state, "held");
  assert.equal(f.statusOf(45).reference, "10555");
  assert.ok(cache.has("10555"), "the chart is in the cache");
  const asked = calls.find((c) => c.getPedigree).getPedigree;
  assert.deepEqual(asked, { name: "Prudenzia", year: 2005, ref: null });
  assert.ok(calls.some((c) => /^UPDATE my_mares SET pedigree_reference/.test(c.sql) && c.args[0] === "10555" && c.args[1] === "45"));
});

test("a name the source cannot settle is settled by her year, and fetched by that horse's reference", async () => {
  const amb = Object.assign(new Error("2 horses matched; disambiguate with reference_number"), { ambiguous: true, count: 2, matches: ANTISANA });
  const { fake, calls } = harness({ answers: { "name:Antisana": amb, "ref:9924938": payload(9924938, "Antisana (GB)", "February 11,2015") } });
  const f = createMareFetcher(fake);
  await f.queue({ id: 7, horse_name: "Antisana", foaling_year: 2015 });
  await settle();
  assert.equal(f.statusOf(7).state, "held");
  const asks = calls.filter((c) => c.getPedigree).map((c) => c.getPedigree);
  assert.equal(asks.length, 2);
  // the reference goes with the name: a bare reference is not a query the source accepts
  assert.deepEqual(asks[1], { name: "Antisana", year: 2015, ref: "9924938" });
});

test("a name the source cannot settle and her year cannot either is left for the desk, with the choices", async () => {
  const amb = Object.assign(new Error("2 horses matched; disambiguate with reference_number"), { ambiguous: true, count: 2, matches: ANTISANA });
  const { fake, calls } = harness({ answers: { "name:Antisana": amb } });
  const f = createMareFetcher(fake);
  await f.queue({ id: 7, horse_name: "Antisana", foaling_year: null });
  await settle();
  const s = f.statusOf(7);
  assert.equal(s.state, "ambiguous");
  assert.equal(s.matches.length, 2);
  assert.equal(calls.filter((c) => c.getPedigree).length, 1, "nothing is guessed at");
  // the desk picks one, and the fetch runs with it
  Object.assign(fake, { loadClient: async () => ({ getPedigree: async (ask) => (calls.push({ getPedigree: ask }), payload(15240, "Antisana", "May 1,1933")) }) });
  const g = createMareFetcher(fake);
  assert.equal(await g.queue({ id: 7, horse_name: "Antisana", foaling_year: null }, { ref: "15240" }), "pending");
  await settle();
  assert.equal(g.statusOf(7).state, "held");
  assert.equal(g.statusOf(7).reference, "15240");
});

test("a failure is kept, in the desk's words, and the add is never failed by it", async () => {
  const { fake } = harness({ answers: {} }); // the source matches nothing
  const f = createMareFetcher(fake);
  assert.equal(await f.queue({ id: 9, horse_name: "Nobody", foaling_year: 2010 }), "pending");
  await settle();
  assert.deepEqual([f.statusOf(9).state, f.statusOf(9).message], ["failed", "No horse matched"]);
});

test("a rejected key is said as such on the mare's row", async () => {
  const bad = Object.assign(new Error("the pedigree source rejected this server's API key (PARSE_API_KEY)"), { unconfigured: true, rejectedKey: true });
  const { fake } = harness({ answers: { "name:Prudenzia": bad } });
  const f = createMareFetcher(fake);
  await f.queue({ id: 45, horse_name: "Prudenzia", foaling_year: 2005 });
  await settle();
  assert.equal(f.statusOf(45).state, "failed");
  assert.match(f.statusOf(45).message, /PARSE_API_KEY/);
});

test("a fetch already running is not started twice, and an old outcome is forgotten in time", async () => {
  let t = 1_000_000;
  const { fake, calls } = harness({ answers: { "name:Slow": payload(1, "Slow", "May 1,2010") } });
  const f = createMareFetcher({ ...fake, now: () => t, keep: 1000 });
  await f.queue({ id: 1, horse_name: "Slow", foaling_year: 2010 });
  await f.queue({ id: 1, horse_name: "Slow", foaling_year: 2010 });
  await settle();
  assert.equal(calls.filter((c) => c.getPedigree).length, 1);
  t += 2000;
  await f.queue({ id: 2, horse_name: "Other", foaling_year: 2011 }); // any call tidies
  assert.equal(f.statusOf(1), null);
});
