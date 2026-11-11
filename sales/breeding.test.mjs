import test from "node:test";
import assert from "node:assert/strict";
import { breedingLots } from "./breeding.mjs";

const lot = (o) => ({ sale_type: "breeding", sex: "filly", status: "sold", region: "EU", year: 2025, foaling_year: 2021, price_gbp: 100000, sale_key: "TAT-DEM", ...o });

test("breeding stock and in-training fillies are kept; colts, yearlings and withdrawn lots are not", () => {
  const out = breedingLots([
    lot({ horse: "A" }),
    lot({ horse: "B", sale_type: "hit" }),
    lot({ horse: "C", sale_type: "hit", sex: "colt" }),
    lot({ horse: "D", sale_type: "yearling" }),
    lot({ horse: "E", status: "withdrawn" }),
  ]);
  assert.deepEqual(out.map((l) => l.horse).sort(), ["A", "B"]);
});

test("a lot not sold keeps its bid and has no price", () => {
  const [l] = breedingLots([lot({ status: "rna", price_gbp: null, bid: 50000 })]);
  assert.equal(l.priceGbp, null);
  assert.equal(l.bid, 50000);
});

test("filters: region, years, age at sale, minimum price; dearest first", () => {
  const lots = [lot({ horse: "old", foaling_year: 2012 }), lot({ horse: "us", region: "US" }), lot({ horse: "cheap", price_gbp: 5000 }), lot({ horse: "dear", price_gbp: 900000 }), lot({ horse: "early", year: 2014 })];
  const out = breedingLots(lots, { region: "EU", from: 2015, maxAge: 6, minPrice: 10000 });
  assert.deepEqual(out.map((l) => l.horse), ["dear"]);
  assert.equal(breedingLots(lots, { region: "EU" })[0].horse, "dear");
});

test("the service reads the lots table, so a lot keeps its horse, dam and record", async () => {
  const { createSalesService } = await import("./service.mjs");
  const seen = [];
  const runQuery = async (sql, params) => {
    seen.push({ sql, params });
    if (!/sale_type IN \('breeding', 'hit'\)/.test(sql)) return [];
    if (params[0] > 0) return [];
    return [
      { id: 7, source: "tattersalls", sale_key: "TAT-DEM", sale_label: "DEM25", region: "EU", year: 2025, sale_type: "breeding", lot: "1753",
        horse: "Example Filly", sire: "Calyx", dam: "Example Dam", dam_key: "EXAMPLE DAM", sex: "filly", foaling_year: 2022,
        status: "sold", price: 100000, currency: "GNS", price_gbp: 105000, record: '{"gw":1}' },
    ];
  };
  const svc = createSalesService({ runQuery, log: {}, buildPage: 50 });
  const out = await svc.breeding({ region: "EU", from: 2020 });
  assert.equal(out.count, 1);
  assert.equal(out.lots[0].horse, "Example Filly");
  assert.equal(out.lots[0].dam, "Example Dam");
  assert.deepEqual(out.lots[0].record, { gw: 1 });
  const q = seen.find((s) => /sale_type IN/.test(s.sql));
  assert.deepEqual(q.params, [0, "EU", 2020], "id, then region, then the first year, in the order the placeholders appear");
});
