import { test } from "node:test";
import assert from "node:assert/strict";
import { convert } from "./fx.mjs";
import { saleFromTitle, saleFromCode, parseListing, parseSalePage, kindOf, outcomeOf, parseHorses, discover, fetchSale, saleApiUrl, horsesUrl, SITE } from "./fasig.mjs";

/* Fixtures: trimmed from the house's own pages and API (www.fasigtipton.com), fields the reader does not use left out. */

/** /results/2023, two of its sales, as the page prints them. */
const LISTING = `
<div class="row catalogue-list-item"><div class="col-lg-10"><div class="row"><div class="col-sm-12">
  <h3 class="sale-name">
    <a href="/index.php/2023/Midlantic-December-Mixed#/results">Midlantic December Mixed and Horses of Racing Age</a>
  </h3>
  </div>
  <div class="col-sm-12 clearfix">
    <div class="sale-date">
      Dec 05, 2023
    </div>
    <div class="sale-location"><div class="field field--item">Timonium, Maryland</div></div>
  </div></div></div></div>
<div class="row catalogue-list-item"><div class="col-lg-10"><div class="row"><div class="col-sm-12">
  <h3 class="sale-name">
    <a href="/2025/The-Saratoga-Sale">The Saratoga Sale</a>
  </h3>
  </div>
  <div class="col-sm-12 clearfix">
    <div class="sale-date"> Aug 04 - 05, 2025 </div>
  </div></div></div></div>`;

/** /2025/The-Saratoga-Sale: its Drupal settings. */
const settings = (c) =>
  `<html><body><div id="root"></div><script type="application/json" data-drupal-selector="drupal-settings-json">${JSON.stringify({
    path: { baseUrl: "/", currentPath: "node/4596" },
    catalogues: { is_admin: false, ...c },
  })}</script></body></html>`;
const SARATOGA_PAGE = settings({ sale_identifier: "N25A", title: "The Saratoga Sale (2025)", sale_name: "The Saratoga Sale", sale_start_date: "08-04-2025", sale_end_date: "08-05-2025", previous_sale_id: "N24A" });

/** /django/api/sales/?sale_identifier=N25A */
const SARATOGA_SALE = [{ id: 279, sale_identifier: "N25A", sale_start_day: "2025-08-04", max_hip: 222, min_hip: 1 }];

const h = (o) => ({ private_sale: false, out: false, ...o });
/** /django/api/horses/?sale=279 (The Saratoga Sale, 2025). */
const SARATOGA = [
  h({ hip: 1, name: "2024-TAPIT'S WORLD", sex: "F", sire: "VEKOMA", dam: "TAPIT'S WORLD", consignor: "BLUEGRASS THOROUGHBRED SERVICES INC. AGENT FOR WILLOW OAKS STABLE LLC", purchaser: "TRACY FARMER", price: "150000.00", year_of_birth: "02/15/2024", sold_as_code: "Y" }),
  h({ hip: 4, name: "2024-THE GIRL FACTOR", sex: "F", sire: "MEDAGLIA D'ORO", dam: "THE GIRL FACTOR", consignor: "TAYLOR MADE SALES AGENCY AGENT LXXXI", purchaser: "NOT SOLD", price: "575000.00", year_of_birth: "02/07/2024", sold_as_code: "Y" }),
  h({ hip: 8, name: "2024-TOASTING", sex: "C", sire: "UNCLE MO", dam: "TOASTING", consignor: "DENALI STUD AGENT VI", purchaser: "OUT", price: "0.00", year_of_birth: "03/31/2024", sold_as_code: "Y", out: true }),
  h({ hip: 27, name: "2024-YESTERDAYONCEMORE (IRE)", sex: "F", sire: "LIFE IS GOOD", dam: "YESTERDAYONCEMORE (IRE)", consignor: "DARBY DAN FARM AGENT IV", purchaser: "AUGUST DAWN FARM", price: "200000.00", private_sale: true, year_of_birth: "02/13/2024", sold_as_code: "Y" }),
];
/** The November Sale, 2025 (K25D): a weanling, a broodmare bought back, a racing or broodmare prospect. */
const NOVEMBER = [
  h({ hip: 2, name: "2025-ELECTRIC BOOTS", sex: "C", sire: "ARCANGELO", dam: "ELECTRIC BOOTS", consignor: "TAYLOR MADE SALES AGENCY, AGENT XVII", purchaser: "TAMI BOBO", price: "80000.00", year_of_birth: "03/15/2025", sold_as_code: "W" }),
  h({ hip: 105, name: "IMPLICATED", sex: "M", sire: "CONNECT", dam: "WYSTERIA", consignor: "GAINESWAY, AGENT I", purchaser: "NOT SOLD", price: "675000.00", year_of_birth: "04/11/2020", sold_as_code: "B" }),
  h({ hip: 117, name: "MARGIE'S INTENTION", sex: "F", sire: "HONOR A. P.", dam: "PLAYFUL DANCER", consignor: "ELITE, AGENT", purchaser: "DELTA SQUAD RACING & MICHAEL DUBB & MADAKET", price: "1300000.00", year_of_birth: "03/08/2022", sold_as_code: "RB" }),
];
/** Midlantic May two-year-olds (M25A) and July horses of racing age (K25H), 2025. */
const BREEZE = [h({ hip: 68, name: "", sex: "G", sire: "WAR OF WILL", dam: "COSMIC QUEEN", consignor: "WES CARTER AGENT FOR CROSSED SABRES FARM", purchaser: "CHARLTON BLOODSTOCK AGENCY", price: "5000.00", year_of_birth: "05/04/2023", sold_as_code: "TT" })];
const HORA = [h({ hip: 301, name: "DATAMAN", sex: "G", sire: "TAPIT", dam: "SOLDATA", consignor: "ELITE, AGENT", purchaser: "CLARITY TB AGENT", price: "160000.00", year_of_birth: "05/01/2020", sold_as_code: "RA" })];
/** The November Sale, 2026 (K26D), a week before it: catalogued, out, and a breeding right. */
const NOVEMBER_2026 = [
  h({ hip: 1, name: "2026-LITTLEST WARRIOR", sex: "C", sire: "VEKOMA", dam: "LITTLEST WARRIOR", consignor: "MILL RIDGE SALES, AGENT I", purchaser: null, price: null, year_of_birth: "03/17/2026", sold_as_code: "W", out: true }),
  h({ hip: 2, name: "2026-LOVELY MARISSA", sex: "C", sire: "KINGSBARNS", dam: "LOVELY MARISSA", consignor: "JOHNSON CROSS, AGENT ", purchaser: null, price: null, year_of_birth: "02/26/2026", sold_as_code: "W" }),
  h({ hip: 108, name: "EARLY VOTING", sex: "H", sire: "GUN RUNNER", dam: "AMOUR D'ETE", consignor: "FASIG TIPTON", purchaser: null, price: null, year_of_birth: "03/07/2019", sold_as_code: "#3", out: true }),
];

test("Fasig-Tipton sales from their titles: key, kind, tier, month", () => {
  assert.deepEqual(saleFromTitle("The Saratoga Sale", { start: "2025-08-04" }), { key: "FT-SAR", name: "Fasig-Tipton Saratoga", type: "yearling", tier: 1, year: 2025, month: "2025-08" });
  const cases = [
    ["Saratoga Fall Mixed (2025)", "FT-SARFALL", "mixed", "2025-10"],
    ["The Saratoga Fall Sale (2022)", "FT-SARFALL", "mixed", "2022-10"],
    ["The July Sale (2025)", "FT-JULY", "yearling", "2025-07"],
    ["July Selected Horses of Racing Age (2025)", "FT-OTHER", "hit", "2025-07"],
    ["Kentucky October Yearlings (2025)", "FT-OCT", "yearling", "2025-10"],
    ["The November Sale (2025)", "FT-NOV", "mixed", "2025-11"],
    ["New York Bred Yearlings (2025)", "FT-NYB", "yearling", "2025-08"],
    ["Midlantic May Two-Year-Olds in Training (2025)", "FT-MID", "2yo", "2025-05"],
    ["Midlantic June Two-Year-Olds in Training (2024)", "FT-MID", "2yo", "2024-06"],
    ["Midlantic Fall Yearlings (2025)", "FT-MID", "yearling", "2025-10"],
    ["Eastern Fall Yearlings (2026)", "FT-MID", "yearling", "2026-10"],
    ["Midlantic December Mixed and Horses of Racing Age (2023)", "FT-MID", "mixed", "2023-12"],
    ["California Fall Yearlings and Horses of Racing Age (2023)", "FT-CAL", "yearling", "2023-09"],
    ["The Gulfstream Sale (2022)", "FT-GULF", "2yo", "2022-03"],
    ["Kentucky Winter Mixed (2025)", "FT-OTHER", "mixed", null],
    ["Santa Anita Two-Year-Olds in Training (2019)", "FT-OTHER", "2yo", null],
  ];
  for (const [title, key, type, month] of cases) {
    const s = saleFromTitle(title);
    assert.deepEqual([s.key, s.type, s.month], [key, type, month], title);
  }
  assert.equal(saleFromTitle("Kentucky Winter Mixed", { start: "02-03-2025" }).month, "2025-02");
  assert.equal(saleFromTitle("The Gulfstream Sale (2022)").tier, 1);
  assert.equal(saleFromTitle("Digital Sale (2025)"), null);
});

test("Fasig-Tipton sales from their identifiers", () => {
  assert.deepEqual(saleFromCode("N25A", { start: "2025-08-04" }), { title: "The Saratoga Sale (2025)", key: "FT-SAR", name: "Fasig-Tipton Saratoga", type: "yearling", tier: 1, year: 2025, month: "2025-08" });
  assert.deepEqual([saleFromCode("K26D").key, saleFromCode("K26D").month], ["FT-NOV", "2026-11"]);
  assert.deepEqual([saleFromCode("K25H").key, saleFromCode("K25H").type], ["FT-OTHER", "hit"]);
  assert.deepEqual([saleFromCode("M24J").key, saleFromCode("M24J").type], ["FT-MID", "2yo"]);
  assert.equal(saleFromCode("F22A").key, "FT-GULF");
  assert.equal(saleFromCode("K25A").key, "FT-OTHER");
  assert.equal(saleFromCode("X25Z").key, "FT-OTHER");
  assert.deepEqual([saleFromCode("N16A", { start: "2017-08-07" }).year, saleFromCode("N16A", { start: "2017-08-07" }).month], [2016, "2016-08"], "the identifier's year wins over a stray date");
  assert.equal(saleFromCode("nonsense"), null);
});

test("the results page and a sale's page", () => {
  assert.deepEqual(parseListing(LISTING), [
    { path: "/2023/Midlantic-December-Mixed", title: "Midlantic December Mixed and Horses of Racing Age", dates: "Dec 05, 2023" },
    { path: "/2025/The-Saratoga-Sale", title: "The Saratoga Sale", dates: "Aug 04 - 05, 2025" },
  ]);
  assert.deepEqual(parseSalePage(SARATOGA_PAGE), { identifier: "N25A", title: "The Saratoga Sale", start: "2025-08-04", end: "2025-08-05" });
  assert.equal(parseSalePage("<html></html>"), null);
});

test("what a hip is and what became of it", () => {
  assert.equal(kindOf("W"), "foal");
  assert.equal(kindOf("Y"), "yearling");
  assert.equal(kindOf("TT"), "2yo");
  assert.equal(kindOf("RA"), "hit");
  assert.equal(kindOf("RS"), "hit");
  assert.equal(kindOf("B"), "breeding");
  assert.equal(kindOf("BP"), "breeding");
  assert.equal(kindOf("RB", { saleType: "mixed" }), "breeding");
  assert.equal(kindOf("RB", { saleType: "hit" }), "hit");
  assert.equal(kindOf("#3"), null, "a breeding right is not a horse");
  assert.equal(kindOf(null, { saleType: "yearling" }), "yearling");
  assert.equal(kindOf(null, { saleType: "mixed", sex: "M", age: 6 }), "breeding");
  assert.deepEqual(outcomeOf(SARATOGA[0]), { status: "sold", buyer: "TRACY FARMER", price: 150000, bid: null, afterSale: false });
  assert.deepEqual(outcomeOf(SARATOGA[1]), { status: "rna", buyer: null, price: null, bid: 575000, afterSale: false });
  assert.equal(outcomeOf(SARATOGA[2]).status, "withdrawn");
  assert.equal(outcomeOf(SARATOGA[3]).afterSale, true);
  assert.equal(outcomeOf(NOVEMBER_2026[1]).status, "catalogued");
});

test("a Fasig-Tipton sale as lots: sold, private sale, not sold, out", () => {
  const sale = saleFromTitle("The Saratoga Sale", { start: "2025-08-04" });
  const out = parseHorses(SARATOGA, { id: "N25A", title: "The Saratoga Sale", sale });
  assert.equal(out.lots.length, 4);
  const [a, b, c, d] = out.lots;
  assert.equal(a.source, "fasig");
  assert.equal(a.company, "Fasig-Tipton");
  assert.equal(a.sale_key, "FT-SAR");
  assert.equal(a.sale_name, "Fasig-Tipton Saratoga");
  assert.equal(a.sale_tier, 1);
  assert.equal(a.sale_label, "FT-N25A");
  assert.equal(a.region, "US");
  assert.equal(a.year, 2025);
  assert.equal(a.sale_month, "2025-08");
  assert.equal(a.sale_type, "yearling");
  assert.equal(a.lot, "1");
  assert.equal(a.horse, null, "named by year and dam: unnamed");
  assert.equal(a.sire, "VEKOMA");
  assert.equal(a.sire_key, "VEKOMA");
  assert.equal(a.dam_key, "TAPITS WORLD");
  assert.equal(a.sex, "filly");
  assert.equal(a.foaling_year, 2024);
  assert.equal(a.vendor, "BLUEGRASS THOROUGHBRED SERVICES INC. AGENT FOR WILLOW OAKS STABLE LLC");
  assert.equal(a.buyer, "TRACY FARMER");
  assert.equal(a.status, "sold");
  assert.equal(a.price, 150000);
  assert.equal(a.currency, "USD");
  assert.equal(a.price_gbp, Math.round(convert(150000, "USD", "GBP", "2025-08")));
  assert.ok(a.price_gbp > 105000 && a.price_gbp < 118000, `$150,000 in August 2025 is about £111.6k, got ${a.price_gbp}`);
  assert.equal("after_sale" in a, false);

  assert.deepEqual([b.status, b.bid, b.price, b.buyer, b.price_gbp], ["rna", 575000, null, null, null]);
  assert.deepEqual([c.status, c.price, c.bid, c.buyer, c.sex], ["withdrawn", null, null, null, "colt"]);
  assert.deepEqual([d.status, d.after_sale, d.price, d.buyer, d.dam_key], ["sold", true, 200000, "AUGUST DAWN FARM", "YESTERDAYONCEMORE"]);
});

test("a mixed sale, two-year-olds, horses of racing age: what each lot is", () => {
  const nov = parseHorses(NOVEMBER, { id: "K25D", sale: saleFromCode("K25D", { start: "2025-11-03" }) }).lots;
  assert.deepEqual(nov.map((l) => [l.lot, l.sale_type, l.horse, l.sex, l.foaling_year, l.status, l.price, l.bid]), [
    ["2", "foal", null, "colt", 2025, "sold", 80000, null],
    ["105", "breeding", "IMPLICATED", "filly", 2020, "rna", null, 675000],
    ["117", "breeding", "MARGIE'S INTENTION", "filly", 2022, "sold", 1300000, null],
  ]);
  assert.equal(nov[0].sale_key, "FT-NOV");
  const breeze = parseHorses(BREEZE, { id: "M25A", sale: saleFromCode("M25A", { start: "2025-05-20" }) }).lots[0];
  assert.deepEqual([breeze.sale_key, breeze.sale_type, breeze.sex, breeze.horse, breeze.foaling_year], ["FT-MID", "2yo", "gelding", null, 2023]);
  const hora = parseHorses(HORA, { id: "K25H", sale: saleFromCode("K25H", { start: "2025-07-08" }) }).lots[0];
  assert.deepEqual([hora.sale_key, hora.sale_type, hora.horse, hora.price], ["FT-OTHER", "hit", "DATAMAN", 160000]);
});

test("before the sale: catalogued, out, and no breeding rights", () => {
  const { lots } = parseHorses(NOVEMBER_2026, { id: "K26D", sale: saleFromCode("K26D", { start: "2026-11-02" }) });
  assert.deepEqual(lots.map((l) => [l.lot, l.status, l.price, l.bid, l.buyer, l.price_gbp]), [
    ["1", "withdrawn", null, null, null, null],
    ["2", "catalogued", null, null, null, null],
  ]);
});

test("discover and fetchSale: the pages and calls they make", async () => {
  const calls = [];
  const routes = {
    [`${SITE}/results/2025`]: LISTING,
    [`${SITE}/catalogues/2025`]: LISTING,
    [`${SITE}/2023/Midlantic-December-Mixed`]: settings({ sale_identifier: "M23C", title: "Midlantic December Mixed and Horses of Racing Age (2023)", sale_start_date: "12-05-2023" }),
    [`${SITE}/2025/The-Saratoga-Sale`]: SARATOGA_PAGE,
    [saleApiUrl("N25A")]: JSON.stringify(SARATOGA_SALE),
    [horsesUrl(279)]: JSON.stringify(SARATOGA),
  };
  const fetchImpl = async (url) => {
    calls.push(url);
    return url in routes ? new Response(routes[url], { status: 200 }) : new Response("[]", { status: 404 });
  };
  const sales = await discover({ year: 2025, fetchImpl, pauseMs: 0 });
  assert.deepEqual(sales.map((s) => [s.id, s.key, s.month, s.title]), [["N25A", "FT-SAR", "2025-08", "The Saratoga Sale"]], "a sale of another year is left out");
  assert.equal(calls.length, 4, "the results and catalogues pages, then each sale's page once");
  calls.length = 0;
  const out = await fetchSale("n25a", { fetchImpl, pauseMs: 0 });
  assert.deepEqual(calls, [saleApiUrl("N25A"), horsesUrl(279)]);
  assert.deepEqual([out.id, out.title, out.sale.key, out.lots.length], ["N25A", "The Saratoga Sale (2025)", "FT-SAR", 4]);
  const withInfo = await fetchSale("N25A", { fetchImpl, info: sales[0], pauseMs: 0 });
  assert.equal(withInfo.title, "The Saratoga Sale");
  const none = await fetchSale("N99A", { fetchImpl: async () => new Response("[]"), pauseMs: 0 });
  assert.deepEqual(none.lots, []);
});
