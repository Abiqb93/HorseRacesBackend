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

test("a failure is described in the user's words, and the rejected key by name", () => {
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

test("a name the source cannot settle and her year cannot either is left for the user, with the choices", async () => {
  const amb = Object.assign(new Error("2 horses matched; disambiguate with reference_number"), { ambiguous: true, count: 2, matches: ANTISANA });
  const { fake, calls } = harness({ answers: { "name:Antisana": amb } });
  const f = createMareFetcher(fake);
  await f.queue({ id: 7, horse_name: "Antisana", foaling_year: null });
  await settle();
  const s = f.statusOf(7);
  assert.equal(s.state, "ambiguous");
  assert.equal(s.matches.length, 2);
  assert.equal(calls.filter((c) => c.getPedigree).length, 1, "nothing is guessed at");
  // the user picks one, and the fetch runs with it
  Object.assign(fake, { loadClient: async () => ({ getPedigree: async (ask) => (calls.push({ getPedigree: ask }), payload(15240, "Antisana", "May 1,1933")) }) });
  const g = createMareFetcher(fake);
  assert.equal(await g.queue({ id: 7, horse_name: "Antisana", foaling_year: null }, { ref: "15240" }), "pending");
  await settle();
  assert.equal(g.statusOf(7).state, "held");
  assert.equal(g.statusOf(7).reference, "15240");
});

test("a failure is kept, in the user's words, and the add is never failed by it", async () => {
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

/* ------------------------------------------------------- the second source */

/** Arion's grid as the fetcher sees it: a payload per name, or an error. */
const gridOf = (answers = {}, calls = []) => async () => ({
  fetchGrid: async (ask) => {
    calls.push({ fetchGrid: ask });
    await new Promise((r) => setTimeout(r, 2));
    const a = answers[ask.name];
    if (a instanceof Error) throw a;
    if (!a) throw Object.assign(new Error(`Arion holds no horse called ${ask.name}`), { notFound: true });
    return a;
  },
});
const arionPayload = (name, year) => ({ source: "arion", horse: { reference_number: `arion:${name.toLowerCase()}${year}`, name, foaled: String(year), sex: "Mare" }, ancestors: [] });
const REJECTED = () => Object.assign(new Error("the pedigree source rejected this server's API key (PARSE_API_KEY)"), { unconfigured: true, rejectedKey: true });

test("when the scraper rejects the key, her chart comes from Arion instead, and the row says so", async () => {
  const { fake, calls, cache } = harness({ answers: { "name:Prudenzia": REJECTED() } });
  const f = createMareFetcher({ ...fake, loadGrid: gridOf({ Prudenzia: arionPayload("Prudenzia (IRE)", 2005) }, calls) });
  assert.equal(await f.queue({ id: 45, user_id: "desk", horse_name: "Prudenzia", foaling_year: 2005, country_code: "IRE", sire_name: "Dansili" }), "pending");
  await settle();
  const s = f.statusOf(45);
  assert.equal(s.state, "held");
  assert.equal(s.source, "arion");
  assert.equal(s.reference, "arion:prudenzia (ire)2005");
  assert.ok(cache.has("arion:prudenzia (ire)2005"), "the chart is in the cache");
  const asked = calls.find((c) => c.fetchGrid).fetchGrid;
  assert.deepEqual(asked, { name: "Prudenzia", year: 2005, country: "IRE", sire: "Dansili", userId: "desk" });
  assert.ok(calls.some((c) => /^UPDATE my_mares SET pedigree_reference/.test(c.sql) && c.args[0] === "arion:prudenzia (ire)2005"));
});

test("a rejected key is remembered: the next mare goes straight to Arion without a turn in the scraper's queue", async () => {
  let t = 1_000_000;
  const { fake, calls } = harness({ answers: { "name:First": REJECTED(), "name:Second": REJECTED() } });
  const f = createMareFetcher({ ...fake, now: () => t, loadGrid: gridOf({ First: arionPayload("First", 2010), Second: arionPayload("Second", 2011) }, calls) });
  await f.queue({ id: 1, horse_name: "First", foaling_year: 2010 });
  await settle();
  await f.queue({ id: 2, horse_name: "Second", foaling_year: 2011 });
  await settle();
  assert.equal(calls.filter((c) => c.getPedigree).length, 1, "the scraper was asked once");
  assert.equal(calls.filter((c) => c.fetchGrid).length, 2);
  assert.equal(f.statusOf(2).state, "held");
  // a quarter of an hour on, the scraper is tried again
  t += 16 * 60 * 1000;
  await f.queue({ id: 3, horse_name: "Third", foaling_year: 2012 });
  await settle();
  assert.equal(calls.filter((c) => c.getPedigree).length, 2);
});

test("Arion stands in for a horse the scraper does not find, and Equineline is still first when it answers", async () => {
  const { fake, calls } = harness({ answers: { "name:Known": payload(10555, "Known (GB)", "April 3,2005") } });
  const f = createMareFetcher({ ...fake, loadGrid: gridOf({ Known: arionPayload("Known", 2005), Unknown: arionPayload("Unknown", 2006) }, calls) });
  await f.queue({ id: 1, horse_name: "Known", foaling_year: 2005 });
  await f.queue({ id: 2, horse_name: "Unknown", foaling_year: 2006 });
  await settle();
  assert.deepEqual([f.statusOf(1).state, f.statusOf(1).source, f.statusOf(1).reference], ["held", "equineline", "10555"]);
  assert.deepEqual([f.statusOf(2).state, f.statusOf(2).source], ["held", "arion"]);
  assert.equal(calls.filter((c) => c.fetchGrid).length, 1, "Arion is asked only for the one the scraper lacked");
});

test("when both sources fail, the row names both reasons", async () => {
  const { fake } = harness({ answers: {} });
  const f = createMareFetcher({ ...fake, loadGrid: gridOf({}) });
  await f.queue({ id: 9, horse_name: "Nobody", foaling_year: 2010 });
  await settle();
  assert.equal(f.statusOf(9).state, "failed");
  assert.match(f.statusOf(9).message, /Equineline: No horse matched; Arion: Arion holds no horse called Nobody/);
});

test("a source can be named: 'arion' never asks the scraper, 'equineline' never asks Arion", async () => {
  const { fake, calls } = harness({ answers: { "name:Mare": payload(1, "Mare", "May 1,2010") } });
  const f = createMareFetcher({ ...fake, loadGrid: gridOf({ Mare: arionPayload("Mare", 2010) }, calls) });
  await f.queue({ id: 1, horse_name: "Mare", foaling_year: 2010 }, { source: "arion" });
  await settle();
  assert.deepEqual([f.statusOf(1).state, f.statusOf(1).source], ["held", "arion"]);
  assert.equal(calls.filter((c) => c.getPedigree).length, 0);
  const g = createMareFetcher({ ...fake, loadGrid: gridOf({}, calls) });
  await g.queue({ id: 2, horse_name: "Other", foaling_year: 2010 }, { source: "equineline" });
  await settle();
  assert.equal(g.statusOf(2).state, "failed");
  assert.equal(calls.filter((c) => c.fetchGrid).length, 1, "Arion was not asked for the second");
});

test("without Arion wired, a server behaves as before: the scraper's failure is the row's", async () => {
  const { fake } = harness({ answers: { "name:Prudenzia": REJECTED() } });
  const f = createMareFetcher(fake);
  await f.queue({ id: 45, horse_name: "Prudenzia", foaling_year: 2005 });
  await settle();
  assert.equal(f.statusOf(45).state, "failed");
  assert.match(f.statusOf(45).message, /PARSE_API_KEY/);
  assert.equal(f.statusOf(45).rejectedKey, true);
});

test("a name neither source can settle is left for the user with Equineline's choices, which carry references", async () => {
  const amb = Object.assign(new Error("2 horses matched; disambiguate with reference_number"), { ambiguous: true, count: 2, matches: ANTISANA });
  const arionAmb = Object.assign(new Error("Arion lists 2 horses called Antisana"), { ambiguous: true, count: 2, matches: [{ name: "Antisana (GB)", reference_number: null }] });
  const { fake } = harness({ answers: { "name:Antisana": amb } });
  const f = createMareFetcher({ ...fake, loadGrid: gridOf({ Antisana: arionAmb }) });
  await f.queue({ id: 7, horse_name: "Antisana", foaling_year: null });
  await settle();
  const s = f.statusOf(7);
  assert.equal(s.state, "ambiguous");
  assert.equal(s.matches.length, 2);
  assert.equal(s.matches[0].reference_number, 9924938);
});
