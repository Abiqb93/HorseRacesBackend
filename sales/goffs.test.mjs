import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, regionOf, saleFromTitle, yearOf, kindOf, outcomeOf, labelOf, fromNotebookCsv } from "./goffs.mjs";

/*
 * Fixture: the CSV the results notebook writes (pandas to_csv), its columns in
 * its order: year and region in front, the cleaned columns, the page's own as
 * raw_*. Whole numbers in a column with gaps come out as "2024.0", gaps as "".
 */
const HEAD = "year,region,sale_title,lot,sire,dam,foaled,colour,sex,consignor,status,purchaser,price,rna_price,currency,sale_url,raw_Lot,raw_Sire x Dam,raw_Year/Sex";
const CSV = [
  HEAD,
  '2025,IRE,Orby Sale 2025,1.0,Dubawi (IRE),Alpha Lady (IRE),2024.0,B,Colt,Ballylinch Stud,Sold,"Godolphin, Dubai",1200000.0,,EUR,https://www.goffs.com/sale/IRE/orby-sale-2025,1,Dubawi (IRE) x Alpha Lady (IRE),2024 B.C',
  "2025,IRE,Orby Sale 2025,2.0,Frankel (GB),Bonnie Lass (GB),2024.0,Ch,Filly,Kildaragh Stud,RNA,,,180000.0,EUR,https://www.goffs.com/sale/IRE/orby-sale-2025,2,Frankel (GB) x Bonnie Lass (GB),2024 Ch.F",
  "2025,IRE,Orby Sale 2025,3.0,Sea The Stars (IRE),Cara's Muse (IRE),2024.0,B,Filly,Camas Park,Withdrawn,,,,,https://www.goffs.com/sale/IRE/orby-sale-2025,3,Sea The Stars (IRE) x Cara's Muse (IRE),2024 B.F",
  "2025,IRE,November Foal Sale 2025,401.0,Wootton Bassett (GB),Quiet Note (GB),2025.0,B,Colt,Croom House,Sold,BBA Ireland,85000.0,,EUR,https://www.goffs.com/sale/IRE/november-foal-sale-2025,401,Wootton Bassett (GB) x Quiet Note (GB),2025 B.C",
  "2025,IRE,November Foal Sale 2025,402.0,Night Of Thunder (IRE),Velvet (IRE),2015.0,B,Mare,Croom House,Sold,Ross Doyle,60000.0,,EUR,https://www.goffs.com/sale/IRE/november-foal-sale-2025,402,Night Of Thunder (IRE) x Velvet (IRE),2015 B.M",
  "2025,IRE,Land Rover Sale 2025,10.0,Walk In The Park (IRE),Some Dame (IRE),2022.0,B,Gelding,Monbeg,Sold,Gordon Elliott,90000.0,,EUR,https://www.goffs.com/sale/IRE/land-rover-sale-2025,10,Walk In The Park (IRE) x Some Dame (IRE),2022 B.G",
  "2025,UK,Premier Yearling Sale 2025,55.0,Kingman (GB),Lady Of Shalott (GB),2024.0,Gr,Colt,Whitsbury Manor,Sold,Blandford Bloodstock,150000.0,,GBP,https://www.goffs.com/sale/UK/premier-yearling-sale-2025,55,Kingman (GB) x Lady Of Shalott (GB),2024 Gr.C",
  ",,Sportsman's Sale 2024,7,Mehmas (IRE),Quiet Pride (IRE),,,Colt,Glenvale,Sold,Amanda Skiffington,30000.0,,EUR,,7,Mehmas (IRE) x Quiet Pride (IRE),B.C",
  ",,Orby Sale,8,Mehmas (IRE),Other Mare (IRE),,,Colt,Glenvale,Sold,Someone,30000.0,,EUR,,8,Mehmas (IRE) x Other Mare (IRE),B.C",
].join("\r\n");

test("the notebook's CSV is read as pandas writes it: quoted commas, doubled quotes, Windows line ends", () => {
  const rows = parseCsv('﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n2,,"two\nlines"\r\n');
  assert.deepEqual(rows, [
    { a: "1", b: "x, y", c: 'say "hi"' },
    { a: "2", b: "", c: "two\nlines" },
  ]);
  assert.deepEqual(parseCsv(""), []);
});

test("Goffs's sales from their titles: the yearling sales keep the workbook's keys", () => {
  assert.equal(saleFromTitle("Orby Sale 2025").key, "GOF-ORBY");
  assert.equal(saleFromTitle("Orby Book 2 2025").key, "GOF-ORBY2");
  assert.equal(saleFromTitle("Sportsman's Sale 2025").key, "GOF-SPORT");
  assert.equal(saleFromTitle("November Foal Sale 2025").type, "foal");
  assert.equal(saleFromTitle("February Sale 2026").type, "mixed");
  assert.equal(saleFromTitle("London Sale 2025").type, "hit");
  assert.equal(saleFromTitle("Land Rover Sale 2025").type, "jumps");
  assert.equal(saleFromTitle("December NH Sale 2025").key, "GOF-NH");
  assert.equal(saleFromTitle("Something New 2025").key, "GOF-OTHER");
  assert.equal(saleFromTitle("open-yearling-sale-2025").key, "GOF-OPEN", "a page saved under its address");
  assert.equal(regionOf(null, null, "premier_yearling_sale_2025"), "UK");
  const uk = saleFromTitle("Premier Yearling Sale 2025", "UK");
  assert.equal(uk.key, "GUK-PREM");
  assert.equal(uk.company, "Goffs UK");
  assert.equal(saleFromTitle("Breeze Up Sale 2025", "UK").type, "2yo");
  assert.equal(saleFromTitle("Autumn HIT Sale 2025", "UK").key, "GUK-HIT");
  assert.equal(saleFromTitle("Spring Sale 2025", "UK").type, "jumps");
  assert.equal(saleFromTitle("Online Sale", "GoffsGo").key, "GOF-ONLINE");
  // Filed under Goffs before Doncaster had its own name, the Premier sale is still Goffs UK's.
  assert.equal(saleFromTitle("Premier Yearling Sale 2014", "IRE").company, "Goffs UK");
});

test("where a sale was held and when, from what the file gives", () => {
  assert.equal(regionOf("UK"), "UK");
  assert.equal(regionOf("", "https://www.goffs.com/sale/GoffsGo/online-sale?display=table"), "GoffsGo");
  assert.equal(regionOf(null, null, "Goffs UK Silver Sale"), "UK");
  assert.equal(regionOf(null, null, "Orby Sale"), "IRE");
  assert.equal(yearOf({ year: "2025" }), 2025);
  assert.equal(yearOf({ year: "", sale_title: "Sportsman's Sale 2024" }), 2024);
  assert.equal(yearOf({ sale_url: "https://www.goffs.com/sale/IRE/orby-sale-2023" }), 2023);
  assert.equal(yearOf({ sale_title: "saved page" }, 2026), 2026);
  assert.equal(yearOf({ sale_title: "saved page" }), null);
  assert.equal(labelOf({ sale_url: "https://www.goffs.com/sale/IRE/orby-sale-2025?display=table" }), "IRE/orby-sale-2025");
  assert.equal(labelOf({ sale_title: "Orby Sale 2025" }), "Orby Sale 2025");
});

test("what a lot is: the sale's kind, else its age and sex; jumps stores and unknown older horses left out", () => {
  const sale = (type) => ({ type });
  assert.equal(kindOf(sale("yearling"), 1), "yearling");
  assert.equal(kindOf(sale("yearling"), null), "yearling", "a yearling sale's lot with no age read is a yearling");
  assert.equal(kindOf(sale("foal"), 10, true), "breeding", "a mare at the foal sale is breeding stock");
  assert.equal(kindOf(sale("mixed"), 0), "foal");
  assert.equal(kindOf(sale("mixed"), 1), "yearling");
  assert.equal(kindOf(sale("mixed"), 10, true), "breeding");
  assert.equal(kindOf(sale("mixed"), 3), "hit");
  assert.equal(kindOf(sale("hit"), 4, true), "hit", "a mare at a horses-in-training sale is in training");
  assert.equal(kindOf(sale("jumps"), 0), "foal");
  assert.equal(kindOf(sale("jumps"), 3), null);
  assert.equal(kindOf(sale("other"), 3), null);
  assert.equal(kindOf(sale("other"), null), null);
});

test("how a lot ended: sold, bought back at its last bid, not sold, withdrawn", () => {
  assert.deepEqual(outcomeOf({ status: "Sold", price: "50000.0", purchaser: "BBA Ireland" }), { status: "sold", price: 50000, bid: null, buyer: "BBA Ireland" });
  assert.equal(outcomeOf({ status: "RNA", rna_price: "18000.0" }).bid, 18000);
  assert.equal(outcomeOf({ status: "RNA", price: "18000" }).bid, 18000, "the last bid in the price column");
  assert.equal(outcomeOf({ status: "Not Sold" }).status, "unsold");
  assert.equal(outcomeOf({ status: "Not Sold", rna_price: "5000" }).status, "rna");
  assert.equal(outcomeOf({ status: "Withdrawn", price: "1" }).status, "withdrawn");
  assert.equal(outcomeOf({ status: "Sold", price: "" }).status, "sold_private");
  assert.equal(outcomeOf({ status: "Unknown", price: "12000", purchaser: "Someone" }).status, "sold");
  assert.equal(outcomeOf({ status: "Unknown", price: "12000", purchaser: "Vendor" }).status, "unknown");
  assert.equal(outcomeOf({ status: "nan" }).status, "unknown");
});

test("the notebook's file as lots in the shared shape, sale by sale", () => {
  const read = fromNotebookCsv(CSV);
  assert.equal(read.rows, 9);
  const byDam = Object.fromEntries(read.lots.map((l) => [l.dam_key, l]));

  const orby = byDam["ALPHA LADY"];
  assert.equal(orby.source, "goffs");
  assert.equal(orby.company, "Goffs");
  assert.equal(orby.sale_key, "GOF-ORBY");
  assert.equal(orby.sale_label, "IRE/orby-sale-2025");
  assert.equal(orby.year, 2025);
  assert.equal(orby.sale_month, "2025-09");
  assert.equal(orby.sale_type, "yearling");
  assert.equal(orby.lot, "1");
  assert.equal(orby.sire_key, "DUBAWI");
  assert.equal(orby.sex, "colt");
  assert.equal(orby.foaling_year, 2024);
  assert.equal(orby.buyer, "Godolphin, Dubai");
  assert.equal(orby.price, 1200000);
  assert.equal(orby.currency, "EUR");
  assert.ok(orby.price_gbp > 900000 && orby.price_gbp < 1150000, `${orby.price_gbp}`);

  assert.equal(byDam["BONNIE LASS"].status, "rna");
  assert.equal(byDam["BONNIE LASS"].bid, 180000);
  assert.equal(byDam["BONNIE LASS"].price, null);
  assert.equal(byDam["CARAS MUSE"].status, "withdrawn");

  assert.equal(byDam["QUIET NOTE"].sale_type, "foal");
  assert.equal(byDam["VELVET"].sale_key, "GOF-FOAL");
  assert.equal(byDam["VELVET"].sale_type, "breeding");
  assert.equal(byDam["VELVET"].sex, "filly");

  const prem = byDam["LADY OF SHALOTT"];
  assert.equal(prem.company, "Goffs UK");
  assert.equal(prem.sale_key, "GUK-PREM");
  assert.equal(prem.currency, "GBP");
  assert.equal(prem.price_gbp, 150000);

  // Saved from the browser: no year column, the year from the title.
  const sport = byDam["QUIET PRIDE"];
  assert.equal(sport.sale_key, "GOF-SPORT");
  assert.equal(sport.year, 2024);
  assert.equal(sport.foaling_year, 2023);
  assert.equal(sport.sale_label, "Sportsman's Sale 2024");

  // The jumps store is left out; the page with no year is named, not guessed.
  assert.equal(byDam["SOME DAME"], undefined);
  assert.equal(byDam["OTHER MARE"], undefined);
  assert.deepEqual(read.problems, [{ sale: "Orby Sale", problem: "no year: give it as ?year=" }]);
  const sales = Object.fromEntries(read.sales.map((s) => [s.key, s]));
  assert.deepEqual([sales["GOF-ORBY"].lots, sales["GOF-ORBY"].sold], [3, 1]);
  assert.equal(sales["GOF-NH"].leftOut, 1);

  // Given a year, the page with none is read too.
  assert.equal(fromNotebookCsv(CSV, { year: 2025 }).lots.find((l) => l.dam_key === "OTHER MARE").year, 2025);
});

test("sent in, the lots are written as a feed's: a named sale's workbook rows give way, an -OTHER key's do not", async () => {
  const { createSalesService } = await import("./service.mjs");
  const sql = [];
  const runQuery = async (q, params) => {
    sql.push([q.trim(), params]);
    if (/^DELETE/.test(q.trim())) return { affectedRows: 12 };
    return [];
  };
  const svc = createSalesService({ runQuery, fetchImpl: async () => ({ ok: false, status: 404 }), log: {} });
  const read = fromNotebookCsv(
    [
      HEAD,
      "2025,IRE,Orby Sale 2025,1.0,Dubawi (IRE),Alpha Lady (IRE),2024.0,B,Colt,Ballylinch Stud,Sold,Godolphin,1200000.0,,EUR,https://www.goffs.com/sale/IRE/orby-sale-2025,1,x,y",
      "2025,IRE,Kildare Paddocks Special 2025,9.0,Kodiac (GB),Third Mare (IRE),2025.0,B,Colt,Someone,Sold,Someone Else,20000.0,,EUR,,9,x,y",
    ].join("\n"),
  );
  const out = await svc.importLots("goffs", read.lots, read.sales);
  assert.equal(out.lots, 2);
  assert.equal(out.sold, 2);
  assert.equal(out.replaced, 12);
  const deletes = sql.filter(([q]) => /^DELETE/.test(q)).map(([, p]) => p);
  assert.deepEqual(deletes, [["GOF-ORBY", 2025, "goffs"]]);
  assert.equal(sql.filter(([q]) => /^INSERT INTO sale_imports/.test(q)).length, 2, "one import logged per sale");
});

/* ------------------------------------------- the Autumn Sale's two kinds */

test("the Autumn Sale's first day files its yearlings with the Autumn Yearlings", async () => {
  const { saleForKind } = await import("./goffs.mjs");
  // Racing Post's title for the first day; the yearling days after it keep their own rule.
  const day1 = saleFromTitle("Goffs Autumn HIT & Yearling Sale 2026", "IRE");
  assert.equal(day1.key, "GOF-HIT", "the horses in training stay where they were");
  assert.equal(day1.type, "hit");
  assert.deepEqual(saleForKind(day1, "yearling"), { key: "GOF-AUT", name: "Goffs Autumn Yearlings" });
  assert.deepEqual(saleForKind(day1, "hit"), { key: "GOF-HIT", name: "Goffs Horses in Training" });
  assert.equal(saleFromTitle("Goffs Autumn Horses in Training & Yearling Sale", "IRE").byKind.yearling.key, "GOF-AUT");
  assert.equal(saleFromTitle("Goffs Autumn Yearling Sale 2026", "IRE").key, "GOF-AUT");
});

test("an autumn National Hunt sale, a plain HIT sale and Goffs UK's autumn sale are left as they were", async () => {
  const { saleForKind } = await import("./goffs.mjs");
  assert.equal(saleFromTitle("Goffs Autumn National Hunt Sale", "IRE").key, "GOF-NH");
  assert.equal(saleFromTitle("Goffs Autumn Store Sale", "IRE").key, "GOF-NH");
  const hit = saleFromTitle("Goffs Horses in Training Sale 2026", "IRE");
  assert.equal(hit.byKind, undefined);
  assert.deepEqual(saleForKind(hit, "yearling"), { key: "GOF-HIT", name: "Goffs Horses in Training" });
  assert.equal(saleFromTitle("Goffs UK Autumn HIT Sale", "UK").key, "GUK-HIT");
});
