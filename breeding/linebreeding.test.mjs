import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { parseGrid } from "../arion/pedigreeGrid.mjs";
import {
  closestDuplication,
  compactGrid,
  createLinebreedingStudy,
  crossesOf,
  damKey,
  foalPedigree,
  inWindow,
  invert,
  mostRepeated,
  readStudy,
  sireKey,
  withinGroups,
} from "./linebreeding.mjs";

const frankel = parseGrid(fs.readFileSync(new URL("../arion/fixtures/frankel-7x7.html", import.meta.url), "utf8"), { generations: 7 });

test("Frankel's seven generations: Northern Dancer 3x4, as Arion's own line has it", () => {
  const pedigree = compactGrid(frankel.ancestors).map(([path, key]) => ({ path, gen: path.length, key }));
  const nd = crossesOf(pedigree, "Northern Dancer (CAN)");
  assert.equal(nd.n, 2);
  assert.equal(nd.text, "3 x 4");
  assert.equal(nd.share, 0.5 ** 3 + 0.5 ** 4);
  assert.match(frankel.inbreedingText, /Northern Dancer \(CAN\) 1961: 3m x 4m/);
  const close = closestDuplication(pedigree);
  assert.equal(close.sum, 7, "3x4 to Northern Dancer is his closest");
  // Nearco 5m x 6m 7m on Arion's line: three crosses
  assert.equal(crossesOf(pedigree, "Nearco").n, 3);
});

test("a foal's seven generations from his sire's grid and his dam's", () => {
  const sireGrid = [["S", "galileo", 1998], ["D", "kind", 2001], ["SS", "sadlers wells", 1981]];
  const damGrid = [["S", "danehill", 1986], ["D", "x mare", 2000], ["SS", "danzig", 1977]];
  const p = foalPedigree({ sire: "Frankel (GB)", dam: "Dam (IRE)", sireGrid, damGrid });
  assert.deepEqual(p.slice(0, 2).map((a) => [a.path, a.gen, a.key]), [["S", 1, "frankel"], ["D", 1, "dam"]]);
  assert.deepEqual(p.find((a) => a.key === "sadlers wells"), { path: "SSS", gen: 3, key: "sadlers wells" });
  assert.deepEqual(p.find((a) => a.key === "danzig"), { path: "DSS", gen: 3, key: "danzig" });
});

test("the ancestors that repeat most across a set of pedigrees", () => {
  const p1 = [{ path: "SS", gen: 2, key: "a" }, { path: "DS", gen: 2, key: "a" }, { path: "SD", gen: 2, key: "b" }];
  const p2 = [{ path: "SS", gen: 2, key: "a" }, { path: "DSS", gen: 3, key: "a" }, { path: "DD", gen: 2, key: "a" }];
  assert.deepEqual(mostRepeated([p1, p2]), [{ key: "a", mean: 2.5 }]);
});

test("least squares within groups recovers a known slope, the group means taken out", () => {
  assert.deepEqual(invert([[2, 0], [0, 4]]), [[0.5, 0], [0, 0.25]]);
  // y = 3x + a group's own level + noise; groups at very different levels
  const rows = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let g = 0; g < 20; g += 1) {
    for (let i = 0; i < 30; i += 1) {
      const x = i % 7;
      rows.push({ group: `g${g}`, y: 50 + g * 10 + 3 * x + rand(), x: [x] });
    }
  }
  const fit = withinGroups(rows, ["x"]);
  assert.equal(fit.n, 600);
  assert.equal(fit.groups, 20);
  assert.ok(Math.abs(fit.coefficients[0].estimate - 3) < 0.05);
  assert.ok(fit.coefficients[0].se < 0.05);
  assert.equal(withinGroups(rows.slice(0, 5), ["x"]), null, "too few to read");
});

test("the study's reading: crosses within sire and crop, the baseline split and the table by crosses", () => {
  const foals = [];
  for (let i = 0; i < 120; i += 1) {
    const crosses = i % 4;
    const pedigree = [{ path: "S", gen: 1, key: "sire" }];
    for (let c = 0; c < crosses; c += 1) pedigree.push({ path: `D${"S".repeat(5)}${c}`, gen: 6, key: "northern dancer" });
    foals.push({ sire: i % 2 ? "A" : "B", crop: 2017, sex: "c", best: 70 + crosses * 2 + (i % 3), blackType: crosses === 3 && i % 5 === 0, damProduce: 70 + (i % 5), pedigree });
  }
  const r = readStudy(foals, "Northern Dancer");
  assert.equal(r.foals, 120);
  assert.ok(Math.abs(r.crossesOnly.coefficients[0].estimate - 2) < 0.3, "two pounds a cross, as made");
  assert.equal(r.withControls.coefficients.length, 3);
  assert.equal(r.withControls.coefficients[2].estimate, null, "no foal here is closely inbred: that control is left out, and says so");
  assert.ok(r.baseline.above.n > 0 && r.baseline.below.n > 0);
  assert.deepEqual(r.byCrosses.map((t) => t.crosses), [0, 1, 2, 3]);
  assert.ok(r.byCrosses[3].blackTypeRate > 0);
});

test("the study reads only at night", () => {
  assert.equal(inWindow(new Date("2026-11-25T02:00:00Z")), true);
  assert.equal(inWindow(new Date("2026-11-25T09:00:00Z")), false);
});

/** The study's tables and the results table, in memory. */
function fakeDb({ runs }) {
  const t = { state: null, runners: new Map(), produce: new Map(), grids: new Map() };
  const runQuery = async (sql, a = []) => {
    if (/^CREATE TABLE/.test(sql.trim())) return {};
    if (/INSERT INTO study_lb_state/.test(sql)) {
      const cols = sql.match(/\(id, ([^)]*)\)/)[1].split(", ");
      t.state = { ...(t.state ?? { id: 1 }) };
      cols.forEach((c, i) => (t.state[c] = a[i]));
      return {};
    }
    if (/SELECT \* FROM study_lb_state/.test(sql)) return t.state ? [t.state] : [];
    if (/FROM APIData_Table2[\s\S]*GROUP BY sireName/.test(sql)) return [{ sire: "GALILEO", n: 3 }];
    if (/FROM APIData_Table2[\s\S]*WHERE sireName IN/.test(sql)) return runs.filter((r) => a.includes(r.sireName));
    if (/FROM APIData_Table2[\s\S]*WHERE damName IN/.test(sql)) return runs.filter((r) => a.includes(r.damName));
    if (/REPLACE INTO study_lb_runners/.test(sql)) {
      t.runners.set(a[0], { horse_key: a[0], name: a[1], crop: a[2], sex: a[3], sire: a[4], dam: a[5], damsire: a[6], best: a[7], runs: a[8], stakes_wins: a[9], group_wins: a[10], group1_wins: a[11] });
      return {};
    }
    if (/REPLACE INTO study_lb_produce/.test(sql)) {
      t.produce.set(`${a[0]}#${a[1]}`, { dam_key: a[0], horse_key: a[1], best: a[2] });
      return {};
    }
    if (/INSERT IGNORE INTO study_lb_grids/.test(sql)) {
      if (!t.grids.has(a[0])) t.grids.set(a[0], { grid_key: a[0], kind: /'sire'/.test(sql) ? "sire" : "dam", name: a[1], sire_hint: a[2] ?? null, status: "todo", tries: 0 });
      return {};
    }
    if (/SELECT kind, status, COUNT/.test(sql)) {
      const m = new Map();
      for (const g of t.grids.values()) m.set(`${g.kind}|${g.status}`, (m.get(`${g.kind}|${g.status}`) ?? 0) + 1);
      return [...m].map(([k, n]) => ({ kind: k.split("|")[0], status: k.split("|")[1], n }));
    }
    if (/SELECT COUNT\(\*\) AS n FROM study_lb_runners/.test(sql)) return [{ n: t.runners.size }];
    if (/SELECT COUNT\(\*\) AS n FROM study_lb_grids WHERE fetched_at/.test(sql)) return [{ n: [...t.grids.values()].filter((g) => g.fetched_at && g.status === "done").length }];
    if (/SELECT \* FROM study_lb_grids WHERE status = 'todo'/.test(sql)) {
      const todo = [...t.grids.values()].filter((g) => g.status === "todo").sort((x, y) => (x.kind === "sire" ? -1 : 1) - (y.kind === "sire" ? -1 : 1));
      return todo.slice(0, 1);
    }
    if (/UPDATE study_lb_grids SET status = 'done'/.test(sql)) {
      Object.assign(t.grids.get(a[3]), { status: "done", ancestors: a[0], inbreeding: a[1], fetched_at: a[2] });
      return {};
    }
    if (/UPDATE study_lb_grids SET status = \?/.test(sql)) {
      Object.assign(t.grids.get(a[4]), { status: a[0], tries: a[1], error: a[2], fetched_at: a[3] });
      return {};
    }
    if (/SELECT \* FROM study_lb_runners/.test(sql)) return [...t.runners.values()];
    if (/SELECT grid_key, ancestors FROM study_lb_grids/.test(sql)) return [...t.grids.values()].filter((g) => g.status === "done");
    if (/SELECT dam_key, horse_key, best FROM study_lb_produce/.test(sql)) return [...t.produce.values()];
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  };
  return { runQuery, t };
}

const run = (horseName, foalYear, sireName, damName, damsireName, best, stakesWins = 0) => ({
  horseName, foalYear, sireName, damName, damsireName, sex: "c", bestMaster: best, bestPerformance: null, runs: 3, wins: 1, stakesWins, groupWins: 0, group1Wins: 0,
});

test("the job: plans the runners and grids, reads one grid a tick at night, and reads the study back", async () => {
  const runs = [
    run("ONE", 2016, "GALILEO", "MARE A", "DANEHILL", 95, 1),
    run("TWO", 2017, "GALILEO", "MARE B", "DANZIG", 80),
    run("THREE", 2017, "GALILEO", "MARE A", "DANEHILL", 85),
    run("SISTER", 2012, "DUBAWI", "MARE A", "DANEHILL", 100),
  ];
  const { runQuery, t } = fakeDb({ runs });
  const fetched = [];
  const fetchGrid = async ({ name, sire, generations, keep }) => {
    fetched.push({ name, sire, generations, keep });
    if (name === "MARE B") {
      const err = new Error("two of the name");
      err.ambiguous = true;
      throw err;
    }
    return { ancestors: [{ path: "S", name: name === "GALILEO" ? "Sadler's Wells" : "Danehill", foaling_year: 1981 }, { path: "SS", name: "Northern Dancer", foaling_year: 1961 }], inbreeding_text: null };
  };
  let clock = new Date("2026-11-25T01:00:00Z");
  const study = createLinebreedingStudy({ runQuery, fetchGrid, arionStatus: () => ({ usedToday: 10, dailyLimit: 200 }), now: () => clock, log: { log() {}, warn() {} } });
  const planned = await study.plan({ sires: ["Galileo (IRE)"] });
  assert.deepEqual(planned, { sires: ["GALILEO"], runners: 3, dams: 2 });
  await study.start({ userId: "TomWilson", sires: ["Galileo"] });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await study.status()).stage, "reading pedigrees");
  assert.equal((await study.tick()).read, "GALILEO", "the sire first");
  assert.deepEqual(fetched[0], { name: "GALILEO", sire: null, generations: 6, keep: false });
  assert.equal((await study.tick()).read, "MARE A");
  assert.equal((await study.tick()).failed, "MARE B");
  assert.equal(t.grids.get(damKey("MARE B", "DANZIG")).status, "failed", "an ambiguous name is not asked again");
  clock = new Date("2026-11-25T10:00:00Z");
  assert.equal((await study.tick()).skipped, "outside the window");

  const r = await study.results({ target: "Northern Dancer" });
  assert.equal(r.foals, 2, "the two foals of MARE A, whose grids are read");
  const st = await study.status();
  assert.equal(st.grids["sire:done"], 1);
  assert.equal(st.grids["dam:failed"], 1);
  assert.ok(t.grids.has(sireKey("GALILEO")));
});

test("a restart part way through planning: the next tick plans again with the sires it was given", async () => {
  const runs = [run("ONE", 2016, "GALILEO", "MARE A", "DANEHILL", 95, 1), run("TWO", 2017, "GALILEO", "MARE B", "DANZIG", 80)];
  const { runQuery, t } = fakeDb({ runs });
  const study = createLinebreedingStudy({ runQuery, fetchGrid: async () => ({ ancestors: [] }), now: () => new Date("2026-11-24T14:00:00Z"), log: { log() {}, warn() {} } });
  await study.status();
  // what the table held after the deploy: planning stopped at the dams, no plan running
  await runQuery(
    "INSERT INTO study_lb_state (id, enabled, stage, plan) VALUES (1, ?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), stage = VALUES(stage), plan = VALUES(plan)",
    [1, "reading the dams' produce", JSON.stringify({ sires: ["GALILEO"], crops: [2015, 2019] })],
  );
  assert.deepEqual(await study.tick(), { resumed: "reading the dams' produce" });
  await new Promise((r) => setTimeout(r, 20));
  const st = await study.status();
  assert.equal(st.stage, "reading pedigrees");
  assert.equal(st.note, null);
  assert.ok(t.grids.has(sireKey("GALILEO")));
  assert.equal((await study.tick()).skipped, "outside the window", "once planned, it reads as before");
});
