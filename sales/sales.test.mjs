import test from "node:test";
import assert from "node:assert/strict";
import { convert, ratesFor } from "./fx.mjs";
import { nameKey, horseName, saleOf, statusOf, bestReading, hammer, euReadings, fromEuRow, fromUsRow, fromAuRow, feeHintsFromEu } from "./normalise.mjs";
import { parseHorseCell, readBuyer, parseTotals, parseResults, reconcile, parseCode } from "./tattersalls.mjs";
import { figures, feeFinder, sireTable, marketLines, marketMedians, hitTable, damRecord, sireMedians, verdictOf } from "./metrics.mjs";
import { lotHash, rowValues } from "./store.mjs";

test("guineas are pounds and five pence; other currencies at the month's ECB rates", () => {
  assert.equal(convert(100000, "GNS", "GBP", "2024-10"), 105000);
  assert.equal(convert(100, "EUR", "EUR", "2020"), 100);
  const eurGbp = ratesFor("2024-10")[0];
  assert.equal(Math.round(convert(100000, "EUR", "GBP", "2024-10")), Math.round(100000 * eurGbp));
  assert.ok(convert(1, "USD", "GBP", "2025") > 0.6 && convert(1, "USD", "GBP", "2025") < 0.9);
  assert.equal(convert(null, "EUR", "GBP", "2024"), null);
});

test("names are keys without country, accents or punctuation", () => {
  assert.equal(nameKey("Raven's Pass (USA)"), "RAVENS PASS");
  assert.equal(nameKey("Ravens Pass"), "RAVENS PASS");
  assert.equal(nameKey("Élan Vital"), "ELAN VITAL");
  assert.equal(horseName("Hoodoo Blue (IRE)2014 Bay colt"), "Hoodoo Blue");
  assert.equal(horseName("2014 Bay colt"), null);
});

test("a sale is one identity across its names, with its currency, region and tier", () => {
  for (const name of ["October Yearling Sale (Book 1)", "OC1", "Tatts Book 1"]) assert.equal(saleOf("Tattersalls", name).key, "TAT-OC1");
  assert.equal(saleOf("Tattersalls", "OC1").currency, "GNS");
  assert.equal(saleOf("Tattersalls", "SYL").company, "Tattersalls Ireland");
  assert.equal(saleOf("Tattersalls", "SYL").currency, "EUR");
  assert.equal(saleOf("Goffs", "Premier Yearling Sale").key, "GUK-PREM");
  assert.equal(saleOf("Goffs", "Premier Yearling Sale").currency, "GBP");
  assert.equal(saleOf("Goffs", "Orby Book 2").key, "GOF-ORBY2");
  assert.equal(saleOf("Arqana", "August Yearling Sale v2").key, "ARQ-AUG2");
  assert.equal(saleOf("Fasig Tipton", "The Gulfstream Sale").key, "FT-GULF");
  assert.equal(saleOf(null, "Karaka Book 1").currency, "NZD");
  assert.equal(saleOf(null, "MM GC Yearling Sale").region, "AUS");
  assert.equal(saleOf(null, "Premier Yearling Sale").key, "ING-PREMIER");
});

test("what became of a lot, from how its buyer is written", () => {
  assert.equal(statusOf("Lot Withdrawn"), "withdrawn");
  assert.equal(statusOf("Out", { sold: 0 }), "withdrawn");
  assert.equal(statusOf("Vendor (10000)", { price: 9500 }), "rna");
  assert.equal(statusOf("R.N.A. (1,000)", { sold: 0 }), "rna");
  assert.equal(statusOf("Psd, Res $30,000", { sold: 0 }), "rna");
  assert.equal(statusOf("---", { sold: 0 }), "unsold");
  assert.equal(statusOf("BBA Ireland", { price: 50000 }), "sold");
  assert.equal(statusOf("", {}), "unknown");
});

test("the European workbook's prices are read back to the hammer, sale-year by sale-year", () => {
  // Arqana 2019: sterling = euros x 0.87, euros = sterling x 1.15
  const arq = [[121800, 140070], [34800, 40020], [69600, 80040]];
  assert.equal(bestReading(arq).name, "gbp/0.87");
  // Tattersalls 2023: sterling = guineas x 1.05
  assert.equal(bestReading([[52500, 43050], [17850, 14637], [2205000, 1808100]]).name, "gbp/1.05");
  assert.equal(hammer(139999.6), 140000);
  const rows = [
    { Year: "2019", SalesCompany: "Arqana", Sale: "Deauville August Yearling Sale", Lot: "148", Sire: "Dubawi", Sire_clean: "DUBAWI", Dam: "Prudenzia", Dam_clean: "PRUDENZIA", SalePriceGBP: "1413750", SalePriceEUR: "1625812.5", Buyer: "Godolphin", Sex: "Colt", BirthYear: 2018, Horse: "", VendorNameDetails: "Haras" },
    { Year: "2019", SalesCompany: "Arqana", Sale: "Deauville August Yearling Sale", Lot: "1", Sire: "Kingman", Sire_clean: "KINGMAN", Dam: "X", Dam_clean: "X", SalePriceGBP: "121800", SalePriceEUR: "140070", Buyer: "Vendor", Sex: "Filly", BirthYear: 2018 },
    { Year: "2025", SalesCompany: "Keeneland", Sale: "Keeneland Book 1", Lot: "1", Sire: "Gun Runner", Dam: "Y", SalePriceGBP: "", SalePriceEUR: "", Buyer: "", BirthYear: 2024 },
    { Year: "2025", SalesCompany: "Tattersalls", Sale: "Tatts Book 1", Lot: "2", Sire: "Frankel", Dam: "Z", SalePriceGBP: "", SalePriceEUR: "", Buyer: "", BirthYear: 2024 },
  ];
  const readings = euReadings(rows);
  const [a, b, c, d] = rows.map((r) => fromEuRow(r, readings));
  assert.equal(a.price, 1625000);
  assert.equal(a.currency, "EUR");
  assert.equal(a.status, "sold");
  assert.equal(a.sale_key, "ARQ-AUG");
  assert.ok(a.price_gbp > 1300000 && a.price_gbp < 1500000);
  assert.equal(b.status, "rna");
  assert.equal(b.bid, 140000);
  assert.equal(b.price, null);
  assert.equal(c, null, "the American rows of 2025 are the American workbook's");
  assert.equal(d.status, "catalogued");
});

test("the American workbook: offered and sold flags, a bid where not sold, Gulfstream is two-year-olds", () => {
  const sold = fromUsRow({ SaleCompany: "Keeneland", Sale: "September Yearling Sale", Year: 2024, LOT: "3012", Sire: "Violence", Dam: "Pure Harmony", Buyer: "Nestor Martinez", Price: "20000", YOB: 2023, Offered: 1, Sold: 1, MatchStatus: "no racing record" });
  assert.equal(sold.status, "sold");
  assert.equal(sold.price, 20000);
  assert.equal(sold.currency, "USD");
  const rna = fromUsRow({ SaleCompany: "Keeneland", Sale: "September Yearling Sale", Year: 2024, LOT: "1", Sire: "A", Dam: "B", Buyer: "R.N.A. (2,500)", Price: "", YOB: 2023, Offered: 1, Sold: 0 });
  assert.equal(rna.status, "rna");
  assert.equal(rna.bid, 2500);
  const out = fromUsRow({ SaleCompany: "Fasig Tipton", Sale: "The Gulfstream Sale", Year: 2021, LOT: "9", Sire: "C", Dam: "D", Buyer: "Out", Price: "", YOB: 2020, Offered: 1, Sold: 0 });
  assert.equal(out.sale_type, "2yo");
  assert.equal(out.foaling_year, 2019);
  assert.equal(out.status, "withdrawn");
});

test("the Australian and New Zealand workbook: passed in with its reserve, Karaka in New Zealand dollars", () => {
  const psd = fromAuRow({ SaleName: "MM GC Yearling Sale", Year: 2024, LOT: 5, Sire: "I Am Invincible", Dam: "E", Buyer: "Psd, Res $300,000", Price: null, Sold: 0, BirthYear: 2022 });
  assert.equal(psd.status, "rna");
  assert.equal(psd.bid, 300000);
  assert.equal(psd.currency, "AUD");
  const nz = fromAuRow({ SaleName: "Karaka Book 1", Year: 2024, LOT: 7, Sire: "Savabeel", Dam: "F", Buyer: "Te Akau", Price: 500000, Sold: 1, BirthYear: 2022, Runner: 1, Winner: 1 });
  assert.equal(nz.currency, "NZD");
  assert.equal(nz.region, "NZ");
  assert.equal(nz.record.winner, 1);
});

test("the workbook's covering fee is read back from its 0.82", () => {
  const hints = feeHintsFromEu([{ Sire_clean: "DUBAWI", BirthYear: 2021, "Stud Fee": "205000" }, { Sire_clean: "DUBAWI", BirthYear: 2021, "Stud Fee": "205000" }, { Sire_clean: "X", BirthYear: 2021, "Stud Fee": "" }]);
  assert.equal(hints.get("DUBAWI|2020"), 250000);
  assert.equal(hints.size, 1);
});

const UNNAMED = `<td class='tdh'> <span class="keepTogether"><a href="#" class="hn">Sea The Stars (IRE)</a> /</span> <span class="keepTogether"><a href="#" class="hn">Zvarkhova (FR)</a> Ch.F.<span class='sn'> (IRE)</span></span></td>`;
const NAMED = `<td class='tdh'> <span class="keepTogether"><a href="#" class="hn">Justmyluck (GB)</a> <span class="ht">HIT</span> 2023 B.G. </span> <span class="keepTogether"><span class="small">BY</span> Harry Angel (IRE)</span> <span class="keepTogether"><span class="small">EX</span> Balayage (IRE)</span></td>`;

test("a Tattersalls horse cell, unnamed or named", () => {
  assert.deepEqual(parseHorseCell(UNNAMED), { horse: null, sire: "Sea The Stars", dam: "Zvarkhova", sex: "filly", foaled: null, type: null });
  assert.deepEqual(parseHorseCell(NAMED), { horse: "Justmyluck", sire: "Harry Angel", dam: "Balayage", sex: "gelding", foaled: 2023, type: "HIT" });
  const inFoal = parseHorseCell(`<a class="hn">Mylington Light (GB)</a> 2010 B.M. <span class="small">BY</span> Mount Nelson (GB) <span class="small">EX</span> Atlantic Light (GB) COVERED BY Caturra (GB)`);
  assert.equal(inFoal.dam, "Atlantic Light");
  assert.equal(parseCode("OC125").year, 2025);
  assert.equal(parseCode("XYZ25"), null);
});

test("a Tattersalls buyer cell: bought back, sold after the ring, withdrawn", () => {
  assert.deepEqual(readBuyer("<td>Vendor</td>", 1000), { status: "rna", buyer: null, bid: 1000, afterSale: false });
  assert.deepEqual(readBuyer("<td>Vendor (18,000)</td>", null), { status: "rna", buyer: null, bid: 18000, afterSale: false });
  assert.deepEqual(readBuyer("<td>Vendor (18,000) / Highflyer Bloodstock (P.S.)</td>", 12000), { status: "sold", buyer: "Highflyer Bloodstock", bid: 18000, afterSale: true });
  assert.equal(readBuyer("<td>Lot Withdrawn</td>", null).status, "withdrawn");
  assert.equal(readBuyer("<td>Lot Not Sold</td>", 50000).status, "rna");
  assert.deepEqual(readBuyer("<td>BBA Ireland</td>", 62000), { status: "sold", buyer: "BBA Ireland", bid: null, afterSale: false });
});

test("a Tattersalls results page becomes lots that agree with the house's own totals", () => {
  const row = (lot, horse, buyer, price) => `<tr> <td class='lot '> <a href="#" class="ll">${lot}</a></td> ${horse} <td >Some Stud</td> <td>${buyer}</td> <td class='price '> ${price} </td> </tr>`;
  const html = `<table><tr > <td class="col1label bold">Whole Sale</td> <td class="col1lots">1</td> <td class="col1value">62,000</td> <td class="col1value">62,000</td> <td class="col1value">62,000</td> <td class="col1value">62,000</td> </tr>
    ${row("537", UNNAMED, "BBA Ireland", "62,000")}${row("538", UNNAMED, "Vendor", "40,000")}${row("539", UNNAMED, "Lot Withdrawn", "")}</table>`;
  const out = parseResults(html, "OC125");
  assert.equal(out.lots.length, 3);
  assert.deepEqual(out.lots.map((l) => l.status), ["sold", "rna", "withdrawn"]);
  assert.equal(out.lots[0].sale_key, "TAT-OC1");
  assert.equal(out.lots[0].sale_type, "yearling");
  assert.equal(out.lots[0].foaling_year, 2024);
  assert.equal(out.lots[0].price_gbp, 65100);
  assert.equal(out.lots[1].bid, 40000);
  assert.deepEqual(parseTotals(html), { sold: 1, aggregate: 62000, average: 62000, median: 62000, top: 62000, privateSales: null });
  assert.equal(reconcile(out).verdict, "exact");
});

const lot = (o) => ({ status: "sold", sale_type: "yearling", region: "EU", year: 2025, sale_tier: 2, foaling_year: 2024, ...o });

test("a group of lots as a sale reports it", () => {
  const f = figures([lot({ price_gbp: 100 }), lot({ price_gbp: 300 }), lot({ status: "rna", price_gbp: null }), lot({ status: "withdrawn", price_gbp: null })]);
  assert.deepEqual(
    { offered: f.offered, sold: f.sold, clearance: f.clearance, aggregate: f.aggregate, average: f.average, median: f.median, top: f.top, tier1Share: f.tier1Share, withdrawn: f.withdrawn, withdrawnShare: f.withdrawnShare },
    { offered: 3, sold: 2, clearance: 0.667, aggregate: 400, average: 200, median: 200, top: 300, tier1Share: 0, withdrawn: 1, withdrawnShare: 0.25 },
  );
});

test("the covering fee: the roster's season first, the workbook's next, the nearest season marked approximate", () => {
  const feeFor = feeFinder({
    history: { 1: { ccy: "EUR", points: [{ y: 2023, fee: 100000 }, { y: 2026, fee: 150000 }] } },
    idOf: (k) => (k === "A" ? 1 : null),
    hints: new Map([["A|2022", 70000], ["B|2020", 5000]]),
    toGbp: (fee, ccy) => (ccy === "EUR" ? fee * 0.85 : fee),
  });
  assert.deepEqual(feeFor("A", 2023), { gbp: 85000, approx: false, from: "roster" });
  assert.deepEqual(feeFor("A", 2022), { gbp: 70000, approx: false, from: "workbook" });
  assert.deepEqual(feeFor("A", 2024), { gbp: 85000, approx: true, from: "roster 2023" });
  assert.deepEqual(feeFor("B", 2020), { gbp: 5000, approx: false, from: "workbook" });
  assert.equal(feeFor("C", 2020), null);
});

test("a sire whose stock beats his fee's line is selling well; one below it, poorly", () => {
  const lots = [];
  // the market: price = 3 x fee, at fees from 10k to 100k
  for (let i = 0; i < 60; i += 1) lots.push(lot({ sire_key: `M${i}`, sire: `M${i}`, price_gbp: 3 * (10000 + i * 1500) }));
  for (let i = 0; i < 10; i += 1) lots.push(lot({ sire_key: "HOT", sire: "Hot", price_gbp: 90000 + i * 1000 }));
  for (let i = 0; i < 10; i += 1) lots.push(lot({ sire_key: "COLD", sire: "Cold", price_gbp: 12000 + i * 100 }));
  const fees = { HOT: 15000, COLD: 15000 };
  const feeFor = (k) => ({ gbp: fees[k] ?? 10000 + Number(String(k).slice(1)) * 1500, approx: false });
  const lines = marketLines(lots, feeFor);
  const t = sireTable(lots, { type: "yearling", region: "EU", feeFor, lines, medians: marketMedians(lots) });
  const hot = t.rows.find((r) => r.sireKey === "HOT");
  const cold = t.rows.find((r) => r.sireKey === "COLD");
  assert.ok(hot.premium > 0.5, `hot premium ${hot.premium}`);
  assert.equal(hot.verdict, "well");
  assert.ok(cold.premium < -0.3, `cold premium ${cold.premium}`);
  assert.equal(cold.verdict, "poorly");
  assert.ok(hot.multiple > 6 && hot.multiple < 6.5);
  assert.equal(verdictOf({ sold: 3, premium: 1 }), null, "too few lots to call");
});

test("horses in training: the share sold early, at two or three", () => {
  const h = (o) => ({ sale_type: "hit", region: "EU", year: 2026, status: "sold", price_gbp: 20000, sire_key: "S", sire: "S", ...o });
  const t = hitTable([h({ foaling_year: 2024 }), h({ foaling_year: 2023, status: "rna", price_gbp: null }), h({ foaling_year: 2021 }), h({ foaling_year: 2020, status: "withdrawn" })]);
  const s = t.rows[0];
  assert.equal(s.offered, 3);
  assert.equal(s.early, 2);
  assert.equal(s.earlyShare, 0.667);
  assert.equal(s.earlySold, 1);
});

test("a mare's produce against its sires' medians: her commercial index", () => {
  const lots = [];
  for (let i = 0; i < 5; i += 1) lots.push(lot({ sire_key: "DUBAWI", dam_key: `D${i}`, price_gbp: 400000 }));
  lots.push(lot({ sire_key: "DUBAWI", dam_key: "PRUDENZIA", price_gbp: 1200000, sale_name: "Arqana August", sire: "Dubawi" }));
  lots.push(lot({ sire_key: "DUBAWI", dam_key: "PRUDENZIA", year: 2024, status: "rna", price_gbp: null }));
  const rec = damRecord(lots, "PRUDENZIA", { sireMedians: sireMedians(lots) });
  assert.equal(rec.lots.length, 2);
  assert.equal(rec.sold, 1);
  assert.equal(rec.lots[1].ratio, 3, "1.2m against the 400k median of Dubawi's yearlings that year");
  assert.ok(rec.index > 1.5);
});

test("a lot's row: the same lot hashes the same; every column has a value", () => {
  const l = lot({ sale_key: "TAT-OC1", sale_label: "OC125", lot: "1", dam_key: "A MA CHERE", source: "tattersalls", price: 240000, currency: "GNS" });
  assert.equal(lotHash(l), lotHash({ ...l, price: 1 }));
  assert.notEqual(lotHash(l), lotHash({ ...l, lot: "2" }));
  assert.equal(rowValues(l).length, 28);
});

test("how lots left a sale: withdrawn before the ring, sold after it, offered at two or three", () => {
  const h = (o) => ({ sale_type: "hit", region: "EU", year: 2026, status: "sold", price_gbp: 20000, foaling_year: 2022, ...o });
  const f = figures([h({ foaling_year: 2024 }), h({ after_sale: 1 }), h({ status: "rna", price_gbp: null, foaling_year: 2023 }), h({ status: "withdrawn" }), h({ status: "catalogued" })]);
  assert.equal(f.offered, 3);
  assert.equal(f.withdrawn, 1);
  assert.equal(f.withdrawnShare, 0.25, "one of the four whose outcome is known");
  assert.equal(f.afterRingShare, 0.5);
  assert.equal(f.earlyShare, 0.667, "two of the three offered were two or three");
});

test("what is held, counted from memory: by source, and by kind, region and year", async () => {
  const { coverageOf } = await import("./service.mjs");
  const c = coverageOf([
    { source: "arqana", sale_type: "yearling", region: "EU", year: 2025, status: "sold" },
    { source: "arqana", sale_type: "yearling", region: "EU", year: 2024, status: "rna" },
    { source: "us-master", sale_type: "yearling", region: "US", year: 2024, status: "sold" },
  ]);
  assert.deepEqual(c.bySource.find((s) => s.source === "arqana"), { source: "arqana", lots: 2, sold: 1, fromYear: 2024, toYear: 2025 });
  assert.deepEqual(c.byKind.map((k) => `${k.region}${k.year}:${k.lots}`), ["EU2024:1", "EU2025:1", "US2024:1"]);
});

test("a rerun leaves out the sales of past years already read in full", async () => {
  const { createSalesService } = await import("./service.mjs");
  const asked = [];
  const runQuery = async (sql) => (/FROM sale_imports WHERE source/.test(sql) ? [{ sale_label: "OC115" }] : []);
  const fetchImpl = async (url) => {
    asked.push(String(url));
    return { ok: true, status: 200, headers: { get: () => null, getSetCookie: () => [] }, text: async () => "<html></html>", json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const svc = createSalesService({ runQuery, fetchImpl, log: {} });
  svc.runTattersalls({ from: 2015, to: 2015, prefixes: ["OC1", "OC2"], pauseMs: 0, skipHeld: true });
  for (let i = 0; i < 100 && !(await svc.status({ quick: true })).lastJob; i += 1) await new Promise((r) => setTimeout(r, 10));
  const last = (await svc.status({ quick: true })).lastJob;
  assert.equal(last.skipped, 1);
  assert.equal(last.done, 2);
  assert.ok(asked.some((u) => /OC215/.test(u)), "the sale not yet held is read");
  assert.ok(!asked.some((u) => /OC115/.test(u)), "the one held is not");
});
