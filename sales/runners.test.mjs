import test from "node:test";
import assert from "node:assert/strict";
import { foaledOf, runnerSales } from "./runners.mjs";

const lot = (o) => ({ dam_key: "IN THE PRESENT", sire_key: "MINZAAL", sale_type: "yearling", region: "EU", year: 2025, status: "sold", price: 40000, currency: "EUR", sale_name: "Goffs Orby", company: "Goffs", lot: "181", foaling_year: 2024, ...o });

test("a lot without a foaling year takes the one its sale implies", () => {
  assert.equal(foaledOf(lot({ foaling_year: null, sale_type: "foal", year: 2024 })), 2024);
  assert.equal(foaledOf(lot({ foaling_year: null, sale_type: "yearling", year: 2025 })), 2024);
  assert.equal(foaledOf(lot({ foaling_year: null, sale_type: "2yo", year: 2026 })), 2024);
  assert.equal(foaledOf(lot({ foaling_year: null, sale_type: "hit", year: 2026 })), null);
  assert.equal(foaledOf(lot({ foaling_year: null, region: "AUS" })), null);
  assert.equal(foaledOf(lot({ foaling_year: 2023, sale_type: "hit" })), 2023);
});

test("a runner's lots are its dam's, by its sire, in its foaling year, oldest first", () => {
  const lots = [
    lot({ sale_type: "2yo", year: 2026, foaling_year: null, sale_name: "Arqana Breeze-Up", status: "rna", price: 30000 }),
    lot({}),
    // The same mare's foal of the year before, by another sire.
    lot({ sire_key: "ULYSSES", year: 2024, foaling_year: 2023, lot: "792" }),
    // The same mare and sire, another year.
    lot({ year: 2027, foaling_year: 2026 }),
    // A mare of the same name elsewhere, by another sire.
    lot({ sire_key: "CITY ZIP", currency: "USD" }),
    lot({ status: "withdrawn", sale_name: "Tattersalls October Book 2" }),
  ];
  const got = runnerSales(lots, { dam: "IN THE PRESENT (IRE)", sire: "Minzaal", foaled: "2024-04-07T00:00:00Z" });
  assert.deepEqual(got.map((g) => [g.year, g.sale, g.status, g.price]), [
    [2025, "Goffs Orby", "sold", 40000],
    [2026, "Arqana Breeze-Up", "rna", null],
  ]);
});

test("a lot that names no sire is matched on dam and year", () => {
  const got = runnerSales([lot({ sire_key: null })], { dam: "In The Present", sire: "Minzaal", foaled: 2024 });
  assert.equal(got.length, 1);
});

test("no dam or no foaling year, no lots", () => {
  assert.deepEqual(runnerSales([lot({})], { dam: "", sire: "Minzaal", foaled: 2024 }), []);
  assert.deepEqual(runnerSales([lot({})], { dam: "In The Present", sire: "Minzaal", foaled: null }), []);
});
