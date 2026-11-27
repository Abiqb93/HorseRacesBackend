import test from "node:test";
import assert from "node:assert/strict";
import { readingsFor, reread } from "./reread-aus-seed.mjs";

const lot = (sale_key, year, price, extra = {}) => ({ sale_key, year, status: "sold", price, currency: sale_key.startsWith("NZB") ? "NZD" : "AUD", price_gbp: 1, ...extra });

test("Karaka prices filed at 0.90 of the hammer are put back; Australian prices are left alone", () => {
  const lots = [lot("NZB-B1", 2019, 81000), lot("NZB-B1", 2019, 234000), lot("NZB-B1", 2019, 67500), lot("MM-GC", 2019, 150000), lot("MM-GC", 2019, 85000), { ...lot("NZB-B1", 2019, null), status: "rna", bid: 90000 }];
  const readings = readingsFor(lots);
  assert.equal(readings.get("NZB-B1|2019").name, "price/0.90");
  assert.equal(readings.get("MM-GC|2019").name, "price");
  const out = reread(lots, readings);
  assert.deepEqual(out.map((l) => l.price), [90000, 260000, 75000, 150000, 85000, null]);
  assert.equal(out[5].bid, 90000);
  assert.ok(out[0].price_gbp > 40000 && out[0].price_gbp < 50000);
  assert.equal(out[3], lots[3]);
});

test("the 2024 and 2025 Karaka prices were filed at 0.87", () => {
  const lots = [lot("NZB-B1", 2024, 78300), lot("NZB-B1", 2024, 208800), lot("NZB-B1", 2024, 73950)];
  const readings = readingsFor(lots);
  assert.equal(readings.get("NZB-B1|2024").name, "price/0.87");
  assert.deepEqual(reread(lots, readings).map((l) => l.price), [90000, 240000, 85000]);
});

test("Karaka's Select sale of 2016, filed with no house, moves to Book 2 in New Zealand dollars", () => {
  const lots = [
    { sale_key: "ING-SELECT", sale_label: "Select Yearling Sale", year: 2016, status: "sold", price: 27000, currency: "AUD", region: "AUS" },
    { sale_key: "ING-SELECT", sale_label: "Select Yearling Sale", year: 2016, status: "sold", price: 33300, currency: "AUD", region: "AUS" },
    { sale_key: "ING-SELECT", sale_label: "Select Yearling Sale", year: 2016, status: "rna", price: null, bid: 20000, currency: "AUD", region: "AUS" },
  ];
  const out = reread(lots, readingsFor(lots));
  assert.deepEqual(out.map((l) => [l.sale_key, l.currency, l.region, l.price]), [["NZB-B2", "NZD", "NZ", 30000], ["NZB-B2", "NZD", "NZ", 37000], ["NZB-B2", "NZD", "NZ", null]]);
});
