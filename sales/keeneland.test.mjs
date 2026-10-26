import { test } from "node:test";
import assert from "node:assert/strict";
import { convert } from "./fx.mjs";
import {
  saleFromTitle, parseSales, parseCsv, hipOf, outcomeOf, kindOf, parseResults, parseTotals, reconcile, discover, fetchSale, summaryUrl, csvUrl, salesUrl, totalsUrl,
} from "./keeneland.mjs";

/* Fixtures: rows trimmed from the house's own responses (flex.keeneland.com), fields the reader does not use left out. */

/** misc/GenerateJson.do?actionName=SalesSummarySales */
const SALES = [
  { sale_id: "202702", end_date: "09/26/2026", unformatted_begin_date: "2026-09-14 00:00:00.0", begin_date: "09/14/2026", sale_type: "Y", sale_description: "2026 September Yearling Sale", number_of_sessions: "12" },
  { sale_id: "202605", end_date: "04/24/2026", unformatted_begin_date: "2026-04-24 00:00:00.0", begin_date: "04/24/2026", sale_type: "M", sale_description: "2026 April Selected Horses of Racing Age Sale", number_of_sessions: "1" },
  { sale_id: "202604", end_date: "01/14/2026", unformatted_begin_date: "2026-01-12 00:00:00.0", begin_date: "01/12/2026", sale_type: "M", sale_description: "2026 January Horses of All Ages Sale", number_of_sessions: "2" },
  { sale_id: "202602", end_date: "09/20/2025", unformatted_begin_date: "2025-09-08 00:00:00.0", begin_date: "09/08/2025", sale_type: "Y", sale_description: "2025 September Yearling Sale", number_of_sessions: "12" },
  { sale_id: "202504", end_date: "01/15/2025", unformatted_begin_date: "2025-01-13 00:00:00.0", begin_date: "01/13/2025", sale_type: "M", sale_description: "2025 January Horses of All Ages Sale", number_of_sessions: "3" },
  { sale_id: "201905", end_date: "04/09/2019", unformatted_begin_date: "2019-04-09 00:00:00.0", begin_date: "04/09/2019", sale_type: "Y", sale_description: "2019 April Two-Year-Olds in Training", number_of_sessions: "1" },
];

const JAN = "2025 January Horses of All Ages Sale";
const row = (o) => ({ ReportHeader: JAN, OutIndicator: "N", RnaIndicator: "N", ...o });
/** SalesSummary for 202504 (January 2025), all sessions. */
const JAN_ROWS = [
  row({ Hip: "0001", Name: "Tanti Auguri", Sex: "Filly", Sire: "Quality Road", Dam: "On My Way", Consignor: "Lane's End, Agent ", Buyer: "", OutIndicator: "Y", SalePrice: "-1.0", SalePriceFormatted: "Out" }),
  row({ Hip: "0003", Name: "Flamenca", Sex: "Filly", Sire: "Violence", Dam: "Tap Diva", Consignor: "Hill 'n' Dale at Xalapa, Agent ", Buyer: "Mainline Racing", SalePrice: "65000.0", SalePriceFormatted: "65,000" }),
  row({ Hip: "0008", Name: "The Nightingale", Sex: "Mare", Sire: "Tapit", Dam: "Storm Dixie", Consignor: "Bluewater Sales LLC, Agent I ", Buyer: "", OutIndicator: "Y", SalePrice: "-1.0", SalePriceFormatted: "Out" }),
  row({ Hip: "0009", Name: "", Sex: "Colt", Sire: "Mandaloun", Dam: "This Is War", Consignor: "Eaton Sales, Agent ", Buyer: "Heartland Equine", SalePrice: "145000.0", SalePriceFormatted: "145,000" }),
  row({ Hip: "0012", Name: "Tip Top Tap", Sex: "Mare", Sire: "Tapit", Dam: "Free the Magic", Consignor: "Mulholland Springs, Agent ", Buyer: "R.N.A. (45,000)", RnaIndicator: "Y", SalePrice: "-2.0", SalePriceFormatted: "---" }),
  row({ Hip: "0022", Name: "Sandid", Sex: "Colt", Sire: "Tacitus", Dam: "Try Your Luck", Consignor: "Paramount Sales, Agent II ", Buyer: "Bruno DeBerdt, Agent", RnaIndicator: "P", SalePrice: "12000.0", SalePriceFormatted: "12,000" }),
  // Hip 25 as it reads while its session is still to come: no buyer, no price, neither out nor bought back.
  row({ Hip: "0025", Name: "Mo Dynasty", Sex: "Colt", Sire: "Uncle Mo", Dam: "Untouched Talent", Consignor: "Highgate Sales, Agent XIII ", Buyer: "", RnaIndicator: "", SalePrice: "0.0", SalePriceFormatted: "" }),
];
/** The same sale's CSV export (CR line ends, as the house writes it). */
const JAN_CSV = [
  "Session,Hip,PropertyLine1,PropertyLine2,Description,DOB,Color,Sex,Horse Name,Sire,Dam,CoveringSire,LastService,Pregnancy,SoldAs,Purchaser,Price",
  '1,0001,"Lane\'s End, Agent ","","Tanti Auguri","02/06/2022","B",Filly,"Tanti Auguri","Quality Road","On My Way","","","","Racing or Broodmare Prospect","Out",0',
  '1,0003,"Hill \'n\' Dale at Xalapa, Agent ","","Flamenca","03/12/2024","GR/RO",Filly,"Flamenca","Violence","Tap Diva","","","","Yearling","Mainline Racing",65000',
  '1,0008,"Bluewater Sales LLC, Agent I ","","The Nightingale","03/19/2016","DB/BR",Mare,"The Nightingale","Tapit","Storm Dixie","Jackie\'s Warrior","04/16/2024","pregnant","Broodmare","Out",0',
  '1,0009,"Eaton Sales, Agent ","","Mandaloun --- This Is War","04/27/2024","B",Colt,"","Mandaloun","This Is War","","","","Yearling","Heartland Equine",145000',
  '1,0012,"Mulholland Springs, Agent ","","Tip Top Tap","04/26/2015","GR/RO",Mare,"Tip Top Tap","Tapit","Free the Magic","Taiba","05/11/2024","pregnant","Broodmare","R.N.A. (45,000)",---',
  '1,0022,"Paramount Sales, Agent II ","","Sandid","04/09/2024","DB/BR",Colt,"Sandid","Tacitus","Try Your Luck","","","","Yearling","Bruno DeBerdt, Agent",12000',
  '1,0025,"Highgate Sales, Agent XIII ","","Mo Dynasty","02/08/2024","B    ",Colt,"Mo Dynasty","Uncle Mo","Untouched Talent","","","","Yearling","",',
].join("\r");

/** SalesSummary for 202602 (September 2025): a yearling sale, read without the CSV. */
const SEPT_ROWS = [
  { Hip: "0002", Name: "Timeless Charm", Sex: "Filly", Sire: "Munnings", Dam: "Katie's Keepsake", Consignor: "Runnymede Farm LLC, Agent ", Buyer: "Case Clay Thoroughbred Management", RnaIndicator: "N", OutIndicator: "N", SalePrice: "250000.0", SalePriceFormatted: "250,000", ReportHeader: "2025 September Yearling Sale" },
  { Hip: "0004", Name: "Wild Ginger", Sex: "Filly", Sire: "American Pharoah", Dam: "Kitzys Rocket", Consignor: "Paramount Sales, Agent XXII ", Buyer: "R.N.A. (60,000)", RnaIndicator: "Y", OutIndicator: "N", SalePrice: "-2.0", SalePriceFormatted: "---", ReportHeader: "2025 September Yearling Sale" },
];

/** The Championship sale of 2025 (202607): stallion seasons beside horses. */
const CHAMP_ROWS = [
  { Hip: "0001", Name: "Life Is Good", Sex: "Horse", Sire: "Into Mischief", Dam: "Beach Walk", Consignor: "Christie DeBernardis, Agent ", Buyer: "Emerald Edge, Agent", RnaIndicator: "N", OutIndicator: "N", SalePrice: "1000000.0", SalePriceFormatted: "1,000,000", ReportHeader: "2025 The Keeneland Championship Sale" },
  { Hip: "0006", Name: "Thorpedo Anna", Sex: "Filly", Sire: "Fast Anna", Dam: "Sataves", Consignor: "McPeek Racing Stables, Agent for Richard M. Edwards ", Buyer: "Hill 'n' Dale at Xalapa", RnaIndicator: "N", OutIndicator: "N", SalePrice: "1000000.0", SalePriceFormatted: "1,000,000", ReportHeader: "2025 The Keeneland Championship Sale" },
];
const CHAMP_CSV = [
  "Session,Hip,PropertyLine1,PropertyLine2,Description,DOB,Color,Sex,Horse Name,Sire,Dam,CoveringSire,LastService,Pregnancy,SoldAs,Purchaser,Price",
  '1,0001,"Christie DeBernardis, Agent ","","Life Is Good","04/22/2018","B",Horse,"Life Is Good","Into Mischief","Beach Walk","","","","S","Emerald Edge, Agent",1000000',
  '1,0006,"McPeek Racing Stables, Agent for Richard M. Edwards ","","Thorpedo Anna","01/28/2021","DB/BR",Filly,"Thorpedo Anna","Fast Anna","Sataves","","","","Broodmare Prospect","Hill \'n\' Dale at Xalapa",1000000',
].join("\r");

/** SalesSummaryComparativeResultsNew for 202602: this year's and last year's totals. */
const SEPT_TOTALS = [
  { head: "2735", gross: "411749500.0000", median: "70000.0000", average: "150548.2632", year: "2024", session: "12", type: "5", title: "Cumulative Totals Through All Sessions" },
  { head: "2903", gross: "510517900.0000", median: "80000.0000", average: "175858.7323", year: "2025", session: "12", type: "5", title: "Cumulative Totals Through All Sessions" },
];

test("Keeneland sales from their titles: key, kind, tier, month", () => {
  const sept = saleFromTitle("2025 September Yearling Sale");
  assert.deepEqual(sept, { key: "KEE-SEPT", name: "Keeneland September", type: "yearling", tier: 1, year: 2025, month: "2025-09" });
  assert.deepEqual([saleFromTitle("2025 November Breeding Stock Sale").key, saleFromTitle("2025 November Breeding Stock Sale").tier], ["KEE-NOV", 2]);
  assert.deepEqual([saleFromTitle("2026 January Horses of All Ages Sale").key, saleFromTitle("2026 January Horses of All Ages Sale").month], ["KEE-JAN", "2026-01"]);
  assert.deepEqual([saleFromTitle("2019 April Two-Year-Olds in Training").key, saleFromTitle("2019 April Two-Year-Olds in Training").type], ["KEE-APR", "2yo"]);
  const april = saleFromTitle("2025 April Selected Horses of Racing Age Sale");
  assert.deepEqual([april.key, april.type, april.month], ["KEE-OTHER", "hit", "2025-04"], "the April sale is now one of horses of racing age");
  assert.equal(saleFromTitle("2025 November Horses of Racing Age Sale").key, "KEE-OTHER");
  assert.equal(saleFromTitle("2025 November Horses of Racing Age Sale").month, "2025-11");
  assert.equal(saleFromTitle("2025 The Keeneland Championship Sale").month, "2025-10");
  assert.equal(saleFromTitle("2025 The Keeneland Championship Sale", { begin: "10/29/2025" }).month, "2025-10");
  assert.equal(saleFromTitle(""), null);
});

test("the house's list of sales: ids, and the year and month the sale began", () => {
  const sales = parseSales(SALES);
  assert.equal(sales.length, 6);
  const jan = sales.find((s) => s.id === "202604");
  assert.deepEqual([jan.key, jan.year, jan.month, jan.begin, jan.sessions], ["KEE-JAN", 2026, "2026-01", "2026-01-12", 2], "202604 is January 2026: the code is the fiscal year");
  assert.deepEqual(sales.filter((s) => s.year === 2025).map((s) => s.id), ["202602", "202504"]);
  assert.equal(sales.find((s) => s.id === "201905").type, "2yo");
});

test("the CSV export: CR line ends, quotes, the last cell empty", () => {
  const recs = parseCsv(JAN_CSV);
  assert.equal(recs.length, 7);
  assert.equal(recs[0].PropertyLine1, "Lane's End, Agent ");
  assert.equal(recs[0].SoldAs, "Racing or Broodmare Prospect");
  assert.equal(recs[3].Description, "Mandaloun --- This Is War");
  assert.equal(recs[6].Price, "");
  assert.equal(hipOf("0012"), "12");
  assert.equal(hipOf("0012A"), "12A");
});

test("what became of a hip, and what it is", () => {
  assert.equal(outcomeOf(JAN_ROWS[0]).status, "withdrawn");
  assert.deepEqual(outcomeOf(JAN_ROWS[4]), { status: "rna", buyer: null, price: null, bid: 45000, afterSale: false });
  assert.deepEqual(outcomeOf(JAN_ROWS[5]), { status: "sold", buyer: "Bruno DeBerdt, Agent", price: 12000, bid: null, afterSale: true });
  assert.equal(outcomeOf(JAN_ROWS[6]).status, "catalogued");
  assert.equal(kindOf("Weanling"), "foal");
  assert.equal(kindOf("Yearling"), "yearling");
  assert.equal(kindOf("Broodmare"), "breeding");
  assert.equal(kindOf("Broodmare Prospect"), "breeding");
  assert.equal(kindOf("Stallion Prospect"), "breeding");
  assert.equal(kindOf("Racing Prospect"), "hit");
  assert.equal(kindOf("Racing or Stallion Prospect"), "hit");
  assert.equal(kindOf("Racing or Broodmare Prospect", { saleType: "mixed" }), "breeding");
  assert.equal(kindOf("Racing or Broodmare Prospect", { saleType: "hit" }), "hit");
  assert.equal(kindOf("S"), null, "a stallion season is not a horse");
  assert.equal(kindOf("", { saleType: "yearling" }), "yearling");
  assert.equal(kindOf("", { saleType: "mixed", age: 0 }), "foal");
  assert.equal(kindOf("", { saleType: "mixed", sex: "Mare", age: 9 }), "breeding");
  assert.equal(kindOf("", { saleType: "mixed", sex: "Colt", named: false, month: 11 }), "foal", "an unnamed colt at a November sale is a weanling");
});

test("a mixed sale as lots: sold, sold after the ring, bought back, out, still to come", () => {
  const sale = parseSales(SALES).find((s) => s.id === "202504");
  const out = parseResults(JAN_ROWS, { id: "202504", title: sale.title, sale, csv: JAN_CSV });
  assert.equal(out.lots.length, 7);
  const by = Object.fromEntries(out.lots.map((l) => [l.lot, l]));
  const sold = by["3"];
  assert.equal(sold.source, "keeneland");
  assert.equal(sold.company, "Keeneland");
  assert.equal(sold.sale_key, "KEE-JAN");
  assert.equal(sold.sale_name, "Keeneland January");
  assert.equal(sold.sale_tier, 3);
  assert.equal(sold.sale_label, "KEE-202504");
  assert.equal(sold.region, "US");
  assert.equal(sold.year, 2025);
  assert.equal(sold.sale_month, "2025-01");
  assert.equal(sold.sale_type, "yearling");
  assert.equal(sold.horse, "Flamenca");
  assert.equal(sold.sire_key, "VIOLENCE");
  assert.equal(sold.dam_key, "TAP DIVA");
  assert.equal(sold.sex, "filly");
  assert.equal(sold.foaling_year, 2024);
  assert.equal(sold.vendor, "Hill 'n' Dale at Xalapa, Agent");
  assert.equal(sold.buyer, "Mainline Racing");
  assert.equal(sold.status, "sold");
  assert.equal(sold.price, 65000);
  assert.equal(sold.bid, null);
  assert.equal(sold.currency, "USD");
  assert.equal(sold.price_gbp, Math.round(convert(65000, "USD", "GBP", "2025-01")));
  assert.ok(sold.price_gbp > 48000 && sold.price_gbp < 57000, `$65,000 in January 2025 is about £52.7k, got ${sold.price_gbp}`);
  assert.equal("after_sale" in sold, false);

  assert.equal(by["9"].horse, null, "an unnamed yearling");
  assert.equal(by["9"].sex, "colt");

  const rna = by["12"];
  assert.deepEqual([rna.status, rna.bid, rna.price, rna.buyer, rna.price_gbp], ["rna", 45000, null, null, null]);
  assert.deepEqual([rna.sale_type, rna.sex, rna.foaling_year], ["breeding", "filly", 2015], "a broodmare");

  const ps = by["22"];
  assert.deepEqual([ps.status, ps.after_sale, ps.price, ps.buyer], ["sold", true, 12000, "Bruno DeBerdt, Agent"]);

  assert.deepEqual([by["1"].status, by["1"].sale_type, by["1"].price, by["1"].buyer], ["withdrawn", "breeding", null, null]);
  assert.equal(by["8"].status, "withdrawn");
  assert.deepEqual([by["25"].status, by["25"].price, by["25"].bid], ["catalogued", null, null]);
});

test("a yearling sale read without the CSV, and a mixed one without it", () => {
  const sale = saleFromTitle("2025 September Yearling Sale");
  const { lots } = parseResults(SEPT_ROWS, { id: "202602", sale });
  assert.deepEqual(lots.map((l) => [l.lot, l.sale_type, l.foaling_year, l.status, l.price, l.bid]), [
    ["2", "yearling", 2024, "sold", 250000, null],
    ["4", "yearling", 2024, "rna", null, 60000],
  ]);
  const jan = parseResults(JAN_ROWS, { id: "202504", sale: saleFromTitle(JAN) });
  assert.equal(jan.lots.find((l) => l.lot === "9").sale_type, "yearling", "unnamed in January: a yearling");
  assert.equal(jan.lots.find((l) => l.lot === "12").sale_type, "breeding", "a mare: breeding stock");
});

test("stallion seasons at the Championship sale are left out", () => {
  const { lots } = parseResults(CHAMP_ROWS, { id: "202607", sale: saleFromTitle("2025 The Keeneland Championship Sale"), csv: CHAMP_CSV });
  assert.deepEqual(lots.map((l) => [l.lot, l.horse, l.sale_type, l.price]), [["6", "Thorpedo Anna", "breeding", 1000000]]);
});

test("the house's totals, and the parsed lots checked against them", () => {
  const totals = parseTotals(SEPT_TOTALS, 2025);
  assert.deepEqual(totals, { sold: 2903, gross: 510517900, median: 80000, average: 175858.7323 });
  const lots = [
    { status: "sold", price: 250000 }, { status: "sold", price: 100000, after_sale: true }, { status: "rna", price: null },
  ];
  const rec = reconcile({ lots, totals: { sold: 1, gross: 250000 } });
  assert.deepEqual([rec.verdict, rec.sold.ours, rec.sold.private], ["exact", 1, 1], "the house's head count leaves out the private sales");
});

test("discover and fetchSale: the calls they make, one at a time", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const body = url === salesUrl() ? SALES : url === summaryUrl("202504") ? JAN_ROWS : url === csvUrl("202504") ? JAN_CSV : url === totalsUrl("202504") ? [] : null;
    if (body === null) return new Response("not found", { status: 404 });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
  };
  const sales = await discover({ year: 2025, fetchImpl });
  assert.deepEqual(sales.map((s) => [s.id, s.key, s.month]), [["202504", "KEE-JAN", "2025-01"], ["202602", "KEE-SEPT", "2025-09"]]);
  calls.length = 0;
  const out = await fetchSale("202504", { fetchImpl, pauseMs: 0 });
  assert.deepEqual(calls, [salesUrl(), summaryUrl("202504"), csvUrl("202504"), totalsUrl("202504")]);
  assert.equal(out.sale.key, "KEE-JAN");
  assert.equal(out.title, JAN);
  assert.equal(out.lots.length, 7);
  assert.equal(out.lots.find((l) => l.lot === "1").sale_type, "breeding", "the CSV was read");
  calls.length = 0;
  const info = sales.find((s) => s.id === "202602");
  const sept = await fetchSale("202602", { fetchImpl: async (url) => (calls.push(url), new Response(url === summaryUrl("202602") ? JSON.stringify(SEPT_ROWS) : "[]")), info, pauseMs: 0 });
  assert.deepEqual(calls, [summaryUrl("202602"), totalsUrl("202602")], "a yearling sale needs no CSV, and a known sale no lookup");
  assert.equal(sept.lots.length, 2);
});
