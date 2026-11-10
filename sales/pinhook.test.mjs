import test from "node:test";
import assert from "node:assert/strict";
import { pinhookCohort, pinhookTable, returnsOf, bandOf, stageComplete, OUTCOMES } from "./pinhook.mjs";

const TODAY = new Date("2026-11-10T00:00:00Z");
const lot = (o) => ({
  source: "tattersalls", company: "Tattersalls", sale_key: "TAT-DEF", sale_name: "Tattersalls December Foals", sale_tier: 1,
  region: "EU", year: 2023, sale_type: "foal", lot: "1", sire: "Kingman", sire_key: "KINGMAN", dam_key: "MARE A",
  sex: "colt", foaling_year: 2023, vendor: "Stud", buyer: "Pinhooker", status: "sold", price: 50000, currency: "GBP", price_gbp: 50000, ...o,
});
const yearling = (o) => lot({ sale_key: "TAT-OC1", sale_name: "Tattersalls October Book 1", sale_type: "yearling", year: 2024, vendor: "Pinhooker", buyer: "Trainer", price_gbp: 150000, ...o });
const breeze = (o) => lot({ sale_key: "TAT-CBU", sale_name: "Tattersalls Craven Breeze-Up", sale_type: "2yo", year: 2025, vendor: "Breezer", buyer: "Trainer", price_gbp: 200000, ...o });
const cohortOf = (lots, o = {}) => pinhookCohort(lots, { today: TODAY, ...o });

test("a foal bought and resold as a yearling is paired, with its gross multiple", () => {
  const c = cohortOf([lot({}), yearling({})]);
  assert.equal(c.rows.length, 1);
  const r = c.rows[0];
  assert.equal(r.bought, true);
  assert.equal(r.yearling.outcome, "resold");
  assert.equal(r.yearling.multiple, 3);
  assert.equal(r.yearling.grossGbp, 100000);
  assert.equal(r.band, "40000-80000");
});

test("a resale by another sire is another horse", () => {
  const r = cohortOf([lot({}), yearling({ sire_key: "FRANKEL" })]).rows[0];
  assert.equal(r.yearling.outcome, "not_entered");
});

test("a lot without a foaling year takes the one its sale implies", () => {
  const r = cohortOf([lot({ foaling_year: null }), yearling({ foaling_year: null })]).rows[0];
  assert.equal(r.foaled, 2023);
  assert.equal(r.yearling.outcome, "resold");
});

test("a foal bought back is not a purchase and never counts toward returns", () => {
  const c = cohortOf([lot({ status: "rna", price_gbp: null }), yearling({})]);
  assert.equal(c.rows[0].bought, false);
  assert.equal(returnsOf(c.rows).bought, 0);
});

test("two foal lots of one dam, year and sire in one sale are ambiguous and left out", () => {
  const c = cohortOf([lot({ lot: "1" }), lot({ lot: "2" }), yearling({})]);
  assert.ok(c.rows[0].flags.includes("ambiguous"));
  assert.equal(returnsOf(c.rows).bought, 0);
});

test("a colt resold as a filly is not the same horse; a gelding is", () => {
  assert.ok(cohortOf([lot({}), yearling({ sex: "filly" })]).rows[0].flags.includes("sex_yearling"));
  assert.deepEqual(cohortOf([lot({}), yearling({ sex: "gelding" })]).rows[0].flags, []);
});

test("sold twice as a yearling: the higher book is the exit", () => {
  const r = cohortOf([lot({}), yearling({ sale_key: "TAT-DEY", sale_tier: 3, price_gbp: 20000 }), yearling({})]).rows[0];
  assert.equal(r.yearling.saleKey, "TAT-OC1");
  assert.equal(r.yearling.lots, 2);
});

test("foal to two-year-old leaves out a horse resold as a yearling", () => {
  const held = cohortOf([lot({}), yearling({ status: "rna", price_gbp: null }), breeze({})]).rows[0];
  assert.equal(held.twoyo.viaYearling, false);
  assert.equal(held.twoyo.multiple, 4);
  assert.equal(returnsOf([held], "2yo").resold, 1);
  const sold = cohortOf([lot({}), yearling({}), breeze({})]).rows[0];
  assert.equal(sold.twoyo.viaYearling, true);
  assert.equal(returnsOf([sold], "2yo").bought, 0);
});

test("a stage still selling is incomplete and left out", () => {
  assert.equal(stageComplete(2025, "yearling", TODAY), false);
  assert.equal(stageComplete(2024, "2yo", TODAY), true);
  assert.equal(stageComplete(2024, "yearling", TODAY), true);
  const c = cohortOf([lot({ year: 2025, foaling_year: 2025 })]);
  assert.equal(c.rows[0].yearling.complete, false);
  assert.equal(returnsOf(c.rows).bought, 0);
});

test("every foal bought ends in exactly one outcome", () => {
  const lots = [
    lot({ dam_key: "A" }), yearling({ dam_key: "A" }),
    lot({ dam_key: "B" }), yearling({ dam_key: "B", status: "rna", price_gbp: null }),
    lot({ dam_key: "C" }), yearling({ dam_key: "C", status: "withdrawn", price_gbp: null }),
    lot({ dam_key: "D" }),
    lot({ dam_key: "E" }), yearling({ dam_key: "E", status: "sold_private", price_gbp: null }),
  ];
  const r = returnsOf(cohortOf(lots).rows);
  assert.equal(r.bought, 5);
  assert.equal(OUTCOMES.reduce((a, o) => a + r[o], 0), r.bought);
  assert.deepEqual([r.resold, r.offered_not_sold, r.entered_not_offered, r.not_entered, r.sold_private], [1, 1, 1, 1, 1]);
  assert.equal(r.resaleRate, 0.2);
});

test("the table's figures are the hand calculation", () => {
  const lots = [
    lot({ dam_key: "A", price_gbp: 10000 }), yearling({ dam_key: "A", price_gbp: 30000 }),
    lot({ dam_key: "B", price_gbp: 20000 }), yearling({ dam_key: "B", price_gbp: 10000 }),
    lot({ dam_key: "C", price_gbp: 40000 }), yearling({ dam_key: "C", price_gbp: 100000 }),
  ];
  const t = pinhookTable(cohortOf(lots), { by: "year" });
  const row = t.rows[0];
  assert.equal(row.key, 2023);
  assert.equal(row.bought, 3);
  assert.equal(row.medianMultiple, 2.5);
  assert.equal(row.meanMultiple, round((3 + 0.5 + 2.5) / 3));
  assert.equal(row.shareProfitGross, 0.667);
  assert.equal(row.share2x, 0.667);
  assert.equal(row.medianGrossGbp, 20000);
  assert.match(t.basis, /Gross/);
});
const round = (v) => Number(v.toFixed(2));

test("the dam's prior record reads only her produce sold before this foal", () => {
  const medians = new Map([["KINGMAN|yearling|EU|2022", 50000], ["KINGMAN|yearling|EU|2025", 50000]]);
  const lots = [
    yearling({ year: 2022, foaling_year: 2021, price_gbp: 100000 }),
    lot({}),
    yearling({ year: 2025, foaling_year: 2024, price_gbp: 500000 }),
  ];
  const r = cohortOf(lots, { sireMedians: medians }).rows[0];
  assert.equal(r.damPrior.basis, 1);
  assert.equal(r.damPrior.lots, 1);
});

test("price bands", () => {
  assert.equal(bandOf(4999), "0-5000");
  assert.equal(bandOf(400000), "320000+");
  assert.equal(bandOf(null), null);
});
