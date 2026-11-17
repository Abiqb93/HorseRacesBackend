import test from "node:test";
import assert from "node:assert/strict";

import { TATTS_REPORT, createMareTatts, horseKey, inSeason, isDue } from "./mareTatts.mjs";

const DAY = 24 * 60 * 60 * 1000;

test("the season is November, December and January", () => {
  assert.ok(inSeason(new Date("2026-11-17T10:00:00Z")));
  assert.ok(inSeason(new Date("2027-01-31T10:00:00Z")));
  assert.ok(!inSeason(new Date("2027-02-01T10:00:00Z")));
  assert.ok(!inSeason(new Date("2026-10-31T10:00:00Z")));
});

test("one key per horse, whatever list she is on", () => {
  assert.deepEqual(horseKey("ALL OF ME", 2014), { key: "all of me", year: 2014 });
  assert.deepEqual(horseKey("=All Of Me (GB)", "2014"), { key: "all of me", year: 2014 });
  assert.deepEqual(horseKey("Shomaria", null), { key: "shomaria", year: 0 });
});

test("a page is due when there is none, or it is a week old; a failure waits a day", () => {
  const now = Date.parse("2026-11-17T10:00:00Z");
  assert.ok(isDue(null, now));
  assert.ok(!isDue({ made_at: new Date(now - 2 * DAY) }, now));
  assert.ok(isDue({ made_at: new Date(now - 8 * DAY) }, now));
  assert.ok(!isDue({ error: "x", tried_at: new Date(now - 3600e3) }, now));
  assert.ok(isDue({ error: "x", tried_at: new Date(now - 2 * DAY) }, now));
});

/** The table and Arion in memory. */
function harness({ mares = [], candidates = null } = {}) {
  const rows = new Map();
  const asked = [];
  const runQuery = async (sql, args = []) => {
    if (/^CREATE TABLE/.test(sql)) return {};
    if (/^SELECT \* FROM mare_tatts WHERE/.test(sql)) return [rows.get(`${args[0]}|${args[1]}`)].filter(Boolean);
    if (/^SELECT \* FROM mare_tatts$/.test(sql.trim())) return [...rows.values()];
    if (/^SELECT horse_name, foaling_year/.test(sql)) return mares;
    if (/^INSERT INTO mare_tatts \(name_key, foaling_year, horse_name, country, report_label/.test(sql.trim())) {
      const [name_key, foaling_year, horse_name, country, report_label, pdf_file_id, html_file_id, made_at, tried_at] = args;
      rows.set(`${name_key}|${foaling_year}`, { name_key, foaling_year, horse_name, country, report_label, pdf_file_id, html_file_id, made_at, tried_at, error: null });
      return {};
    }
    if (/^INSERT INTO mare_tatts \(name_key, foaling_year, horse_name, country, tried_at, error\)/.test(sql.trim())) {
      const [name_key, foaling_year, horse_name, country, tried_at, error] = args;
      const old = rows.get(`${name_key}|${foaling_year}`) ?? { name_key, foaling_year, horse_name, country };
      rows.set(`${name_key}|${foaling_year}`, { ...old, tried_at, error });
      return {};
    }
    throw new Error(`unexpected: ${sql.slice(0, 60)}`);
  };
  const client = {
    configured: () => true,
    search: async (q) => (asked.push(["search", q.name]), { found: true, candidates: candidates ?? [{ token: "t1", label: `${q.name} (GB) 2014`, cells: [] }] }),
    report: async ({ token, reportId }) => (asked.push(["report", token, reportId]), { files: [{ id: "pdf1", kind: "pdf" }, { id: "html1", kind: "html" }] }),
  };
  const chooseCandidate = (c) => (c.length === 1 ? { one: c[0], among: c } : { one: null, among: c });
  return { rows, asked, runQuery, loadArion: async () => ({ client }), chooseCandidate };
}

test("her page is made in Tatts style and kept by its file ids", async () => {
  const h = harness();
  const t = createMareTatts({ ...h, log: {}, now: () => Date.parse("2026-11-17T10:00:00Z") });
  const page = await t.make({ horse_name: "ALL OF ME", foaling_year: 2014, country_code: "IRE", user_id: "richardbrown1" });
  assert.deepEqual(h.asked, [["search", "ALL OF ME"], ["report", "t1", TATTS_REPORT]]);
  assert.equal(page.pdfId, "pdf1");
  assert.equal(page.htmlId, "html1");
  assert.equal(page.error, null);
  assert.equal((await t.latest("All Of Me", 2014)).pdfId, "pdf1");
});

test("a horse Arion cannot settle is kept as a failure with its reason", async () => {
  const h = harness({ candidates: [{ token: "a", label: "X 2014" }, { token: "b", label: "X 2014" }] });
  const t = createMareTatts({ ...h, log: {}, now: () => Date.parse("2026-11-17T10:00:00Z") });
  const page = await t.make({ horse_name: "X", foaling_year: 2014 });
  assert.match(page.error, /2 horses called X/);
  assert.equal(page.pdfId, null);
});

test("in season the due pages are made, each horse once across users' lists; out of season nothing", async () => {
  const mares = [
    { horse_name: "ALL OF ME", foaling_year: 2014, user_id: "TomWilson" },
    { horse_name: "ALL OF ME", foaling_year: 2014, user_id: "richardbrown1" },
    { horse_name: "ANTISANA", foaling_year: 2015, user_id: "TomWilson" },
  ];
  const h = harness({ mares });
  const t = createMareTatts({ ...h, log: {}, now: () => Date.parse("2026-11-17T10:00:00Z") });
  assert.deepEqual(await t.refresh(), { made: 2, due: 2 });
  assert.deepEqual(await t.refresh(), { made: 0, due: 0 }, "made this week: not due again");
  const off = createMareTatts({ ...harness({ mares }), log: {}, now: () => Date.parse("2027-03-01T10:00:00Z") });
  assert.deepEqual(await off.refresh(), { made: 0, skipped: "out of season" });
});

test("a row's wrong country does not lose her: the search is country-blind and the year and sire choose", async () => {
  const h = harness({ candidates: [{ token: "gb", label: "All Of Me (GB) 2014", cells: ["All Of Me", "GB", "2014", "Teofilo"] }] });
  const seen = [];
  const choose = (c, want) => (seen.push(want.country ?? null), want.country === "IRE" ? { one: null, among: [] } : { one: c[0], among: c });
  const t = createMareTatts({ ...h, chooseCandidate: choose, log: {}, now: () => Date.parse("2026-11-17T10:00:00Z") });
  const page = await t.make({ horse_name: "ALL OF ME", foaling_year: 2014, country_code: "IRE", sire_name: "TEOFILO" });
  assert.equal(page.pdfId, "pdf1");
  assert.deepEqual(seen, ["IRE", null], "her country first, then without it");
});

