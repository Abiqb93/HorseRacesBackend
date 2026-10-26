import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTotals } from "./tattersalls.mjs";
import {
  TIR_SALES, saleFromTitle, parseCode, monthOf, saleOf, parseSaleDates, parseSaleHeader, readBuyer, kindOf, parseResults, discover, fetchSale,
} from "./tattersallsireland.mjs";

/* Fixtures: rows trimmed from the house's own pages (secure.tattersalls.ie/4DCGI/Sale/<code>/Catalogue), whitespace squeezed. */

const HEAD_SINGLE = `<tr><th class="col2lot"><a class="thLinkChosen-asc">Lot</a></th><th class="col2name"><a class="th">Name</a><span class="small"> by&nbsp;</span><a class="th">Sire</a><span class="small"> ex&nbsp;</span><a class="th">Dam</a></th><th class="col2consignor"><a class="th">Consignor</a></th><th class="col2purchaser"><a class="th">Purchaser</a></th><th class='col2price'><a class="th">Price</a><BR><span class="normal small">(euro)</span></th></tr>`;

// September Yearling Sale Part 1, 2025 (SYL25)
const SYL25 = `<table class="listTable" width="100%" border="0" cellspacing="0" cellpadding="0" id="listTable">${HEAD_SINGLE}
<tr><td class='lot '><a href="#" onClick='goToLot("SYL25","1")' title="View Lot" class="ll">1</a> &ensp; </td><td class='tdh'><span class="keepTogether"><a href="#" onClick='goToLot("SYL25","1")' class="hn">Sealiway (FR)</a> /</span><span class="keepTogether"><a href="#" onClick='goToLot("SYL25","1")' class="hn">Kadifa (IRE)</a> B.F.<span class='sn'> (IRE)</span></span></td><td >Castletown Quarry Stud</td><td>Vendor (6,000) / Adam Wyrzyk / Tomasz Szumski (P.S.)</td><td class='price '> 8,000 </td></tr>
<tr><td class='lot '><a href="#" onClick='goToLot("SYL25","2")' title="View Lot" class="ll">2</a> &ensp; </td><td class='tdh'><span class="keepTogether"><a href="#" onClick='goToLot("SYL25","2")' class="hn">Blackbeard (IRE)</a> /</span><span class="keepTogether"><a href="#" onClick='goToLot("SYL25","2")' class="hn">Kalsara (GB)</a> B.F.<span class='sn'> (IRE)</span></span></td><td >Noralla Stud Farm</td><td>J S Bloodstock / G Scott Racing</td><td class='price '> 60,000 </td></tr>
<tr><td class='lot '><a href="#" onClick='goToLot("SYL25","14")' title="View Lot" class="ll hg">14</a> &ensp; </td><td class='tdh'><span class="keepTogether"><a href="#" onClick='goToLot("SYL25","14")' class="hg">Blackbeard (IRE)</a> /</span><span class="keepTogether"><a href="#" onClick='goToLot("SYL25","14")' class="hg">Lady Ederle (USA)</a> Ch.F.<span class='sn'> (IRE)</span></span></td><td class="hg">Ballintry Stud</td><td>Lot Withdrawn</td><td class='price hg '></td></tr>
<tr><td class='lot '><a href="#" onClick='goToLot("SYL25","16")' title="View Lot" class="ll">16</a> &ensp; </td><td class='tdh'><span class="keepTogether"><a href="#" onClick='goToLot("SYL25","16")' class="hn">Sioux Nation (USA)</a> /</span><span class="keepTogether"><a href="#" onClick='goToLot("SYL25","16")' class="hn">Lady Mona (IRE)</a> B.C.<span class='sn'> (IRE)</span></span></td><td >Forenaghts Stud</td><td>Lot Not Sold (14,000) / Shanaville Stables (P.S.)</td><td class='price '> 8,000 </td></tr>
<tr><td class='lot '><a href="#" onClick='goToLot("SYL25","20")' title="View Lot" class="ll">20</a> &ensp; </td><td class='tdh'><span class="keepTogether"><a href="#" onClick='goToLot("SYL25","20")' class="hn">Ardad (IRE)</a> /</span><span class="keepTogether"><a href="#" onClick='goToLot("SYL25","20")' class="hn">Lady Tabitha (IRE)</a> B.C.<span class='sn'> (GB)</span></span></td><td >Beechlane Stables</td><td>Vendor</td><td class='price '> 8,000 </td></tr>
</table>
<table class="listTable"><tr ><td class="col1label bold">Whole Sale</td><td class="col1lots">440</td><td class="col1value">18,759,500</td><td class="col1value">42,635</td><td class="col1value">37,000</td><td class="col1value">200,000</td></tr><tr class='otherPS'><td class="col1label otherPS">Subsequent Private Sales</td><td class="col1lots otherPS">4</td><td class="col1value otherPS">39,000</td><td class="col1value otherPS">&nbsp;</td><td class="col1value otherPS">&nbsp;</td><td class="col1value otherPS">&nbsp;</td></tr></table>`;

const HEAD_MIXED = `<tr><th class="col2lot"><a class="thLinkChosen-asc">Lot</a></th><th class="col2name"><a class="th">Name</a></th><th class="col2type"><a class="th">Type</a></th><th class="col2consignor"><a class="th">Consignor</a></th><th class="col2purchaser"><a class="th">Purchaser</a></th><th class='col2price'><a class="th">Price</a><BR><span class="normal small">(euro)</span></th></tr>`;

// May Point-to-Point & Horses in Training Sale 2025 (P2P25)
const P2P25 = `<table class="listTable" id="listTable">${HEAD_MIXED}
<tr><td class='lot '><a href="#" onClick='goToLot("P2P25","1")' title="View Lot" class="ll">1</a> &ensp; </td><td class='tdh'><span class="keepTogether"><a href="#" onClick='goToLot("P2P25","1")' class="hn">Seaniecon (IRE)</a><span class="ht">P2P</span> 2021 B.G. </span><span class="keepTogether"><span class="small">BY</span> Capri (IRE)</span><span class="keepTogether"><span class="small">EX</span> Abigail Lynch (IRE)</span></td><td class="col2type">P2P</td><td >Cametigue Horses</td><td>Stroud Coleman / O'Neill Racing</td><td class='price '> 62,000 </td></tr>
<tr><td class='lot '><a href="#" onClick='goToLot("P2P25","2")' title="View Lot" class="ll">2</a> &ensp; </td><td class='tdh'><span class="keepTogether"><a href="#" onClick='goToLot("P2P25","2")' class="hn">Next Stop Paris (IRE)</a><span class="ht">HIT</span> 2019 B.G. </span><span class="keepTogether"><span class="small">BY</span> Westerner (GB)</span><span class="keepTogether"><span class="small">EX</span> Accordingtoherself (IRE)</span></td><td class="col2type">HIT</td><td >Danestown Stables</td><td>Lot Not Sold</td><td class='price '></td></tr>
</table>`;

// Winter Flat and National Hunt Sale 2025 (FNH25)
const FNH25 = `<table class="listTable" id="listTable">${HEAD_MIXED}
<tr><td class='lot '><a href="#" onClick='goToLot("FNH25","7")' title="View Lot" class="ll">7</a> &ensp; </td><td class='tdh'><span class="keepTogether"><a href="#" onClick='goToLot("FNH25","7")' class="hn">Gleneagles (IRE)</a> /</span><span class="keepTogether"><a href="#" onClick='goToLot("FNH25","7")' class="hn">Annie B (IRE)</a><span class="ht">2YO</span> 2023 B.C.<span class='sn'> (IRE)</span></span></td><td class="col2type">2YO</td><td >Prospect Stables</td><td>Vendor</td><td class='price '> 1,000 </td></tr>
<tr><td class='lot '><a href="#" onClick='goToLot("FNH25","177")' title="View Lot" class="ll">177</a> &ensp; </td><td class='tdh'><span class="keepTogether"><a href="#" onClick='goToLot("FNH25","177")' class="hn">Spick And Span (IRE)</a><span class="ht">MAR</span> 2017 B.M. </span><span class="keepTogether"><span class="small">BY</span> Walk In The Park (IRE)</span><span class="keepTogether"><span class="small">EX</span> Florishwells d'Ete (FR)</span></td><td class="col2type">MAR</td><td >Martinstown Stud</td><td>Lot Not Sold</td><td class='price '> 2,800 </td></tr>
</table>`;

// November National Hunt Sale 2026 (NNH26), before the sale: no buyer column, the box in the price column.
const NNH26 = `<table class="listTable" id="listTable"><tr><th class="col2lot"><a class="thLinkChosen-asc">Lot</a></th><th class="col2name"><a class="th">Name</a></th><th class="col2type"><a class="th">Type</a></th><th class="col2consignor"><a class="th">Consignor</a></th><th class='col2price'><a class="th">Stabling</a></th></tr>
<tr><td class='lot '><a href="#" onClick='goToLot("NNH26","18")' title="View Lot" class="ll hg">18</a> &ensp; </td><td class='tdh'><span class="keepTogether"><a href="#" onClick='goToLot("NNH26","18")' class="hg">Capri (IRE)</a> /</span><span class="keepTogether"><a href="#" onClick='goToLot("NNH26","18")' class="hg">Bella's Vision (FR)</a><span class="ht">YRL</span> 2025 Ch.C.<span class='sn'> (GB)</span></span> &emsp;Lot&nbsp;Withdrawn </td><td class="col2type">YRL</td><td class="hg">Peel Hall Stables</td><td class='price hg '> D&nbsp;164 </td></tr>
<tr><td class='lot '><a href="#" onClick='goToLot("NNH26","22")' title="View Lot" class="ll">22</a> &ensp; </td><td class='tdh'><span class="keepTogether"><a href="#" onClick='goToLot("NNH26","22")' class="hn">Hurricane Lane (IRE)</a> /</span><span class="keepTogether"><a href="#" onClick='goToLot("NNH26","22")' class="hn">Fame And Joy (IRE)</a><span class="ht">FOA</span> 2026 B.C.<span class='sn'> (IRE)</span></span></td><td class="col2type">FOA</td><td >Ballincurrig House Stud</td><td class='price '> D&nbsp;151 </td></tr>
</table>`;

// The 2025 results list (SaleDates?site=FH&display=results&year=2025), two cards.
const SALE_DATES = `<div class="sale-card sale-card column"><article class="sale-card__inner"><div></div><div class="sale-card__details"><div class="sale-card__heading heading-5 heading-4--1200"><a href=" https://www.tattersalls.ie/sales/winter-flat-and-national-hunt-sale/4DCGI/Sale/FNH25/Main" target="_top">Winter Flat and National Hunt Sale</a></div><div class="sale-card__meta"><div class="sale-card__meta-item"><div class="sale-card__meta-item-text"> 28 Jan 2025 </div></div></div></div><div class="sale-card__actions"><a class="button button--dark iframe-parent-link" href=" https://www.tattersalls.ie/sales/winter-flat-and-national-hunt-sale/4DCGI/Sale/FNH25/Main" target="_top"> View Results </a></div></article></div>
<div class="sale-card sale-card column"><article class="sale-card__inner"><div></div><div class="sale-card__details"><div class="sale-card__heading heading-5 heading-4--1200"><a href="https://www.tattersalls.ie/sales/tattersalls-ireland-breeze-up-sale/4DCGI/Sale/IBU25/Main" target="_top">Tattersalls Ireland Breeze Up Sale</a></div><div class="sale-card__meta"><div class="sale-card__meta-item"><div class="sale-card__meta-item-text"> 22&ndash;23 May 2025 </div></div></div></div><div class="sale-card__actions"><a class="button button--dark iframe-parent-link" href="https://www.tattersalls.ie/sales/tattersalls-ireland-breeze-up-sale/4DCGI/Sale/IBU25/Main" target="_top"> View Results </a></div></article></div>`;

// A sale's front page (BFS25/Main), the part with its dates and name.
const MAIN_BFS25 = `<form class="sale-header__filter-form"><div class="caps caps--small">16 Dec 2025</div><select name="year"><option selected value="BFS25">2025</option></select></form><div class="sale-header__heading"><h1 class="heading-5 heading-2--1024">
 Sapphire Sale 2025
</h1></div>`;

test("Tattersalls Ireland sales from their codes and titles", () => {
  assert.deepEqual(parseCode("SY225"), { prefix: "SY2", year: 2025 });
  assert.deepEqual(parseCode("P2P26"), { prefix: "P2P", year: 2026 });
  assert.equal(parseCode("nonsense"), null);
  assert.deepEqual(saleOf("SYL25", { title: "September Yearling Sale Part 1 2025", dates: "23 - 24 Sep 2025" }), { key: "TIR-SEPT", name: "Tattersalls Ireland September Yearlings", type: "yearling", tier: 3, year: 2025, month: "2025-09" });
  assert.equal(saleOf("SY225").key, "TIR-SEPT", "Part II is the same sale's second book");
  assert.equal(saleOf("IBU26").key, "TIR-BRZ");
  assert.equal(saleOf("P2P25").type, "hit");
  assert.equal(saleOf("BFS25", { dates: "16 Dec 2025" }).month, "2025-12", "the house's own dates win over the usual month");
  assert.equal(saleOf("BFS25").month, "2025-11");
  assert.equal(saleOf("DBY25").type, "store");
  assert.equal(saleOf("BDS24", { title: "Andy and Gemma Brown Dispersal", dates: "5 Feb 2024" }).key, "TIR-OTHER");
  assert.equal(saleFromTitle("September Yearling Sale Part II").key, "TIR-SEPT");
  assert.equal(saleFromTitle("Tattersalls Ireland Breeze Up Sale").key, "TIR-BRZ");
  assert.equal(saleFromTitle("May Point-to-Point & Horses in Training Sale").key, "TIR-HIT");
  assert.equal(saleFromTitle("Sapphire Sale").key, "TIR-FOAL");
  assert.equal(saleFromTitle("November Flat Sale").key, "TIR-FOAL");
  assert.equal(saleFromTitle("Flat Foal & Breeding Stock Sale").key, "TIR-FOAL");
  assert.equal(saleFromTitle("November NH Sale").key, "TIR-NH");
  assert.equal(saleFromTitle("Derby Sale Part II").type, "store");
  assert.equal(saleFromTitle("Ascot Yearling Sale").key, "TIR-ASCOT");
  assert.equal(monthOf("28 Oct - 1 Nov 2024", 2024), "2024-10");
  assert.equal(monthOf("1st - 2nd May 2024", 2024), "2024-05");
  for (const s of Object.values(TIR_SALES)) assert.match(s.key, /^TIR-/);
});

test("the year's sale list and a sale's front page", () => {
  assert.deepEqual(parseSaleDates(SALE_DATES), [
    { id: "FNH25", title: "Winter Flat and National Hunt Sale", dates: "28 Jan 2025" },
    { id: "IBU25", title: "Tattersalls Ireland Breeze Up Sale", dates: "22-23 May 2025" },
  ]);
  assert.deepEqual(parseSaleHeader(MAIN_BFS25), { title: "Sapphire Sale 2025", dates: "16 Dec 2025" });
});

test("what became of a lot, as the buyer column writes it", () => {
  assert.deepEqual(readBuyer("J S Bloodstock / G Scott Racing", 60000), { status: "sold", buyer: "J S Bloodstock / G Scott Racing", bid: null, afterSale: false });
  assert.deepEqual(readBuyer("Vendor", 8000), { status: "rna", buyer: null, bid: 8000, afterSale: false });
  assert.deepEqual(readBuyer("Lot Not Sold (14,000)", null), { status: "rna", buyer: null, bid: 14000, afterSale: false });
  assert.deepEqual(readBuyer("Lot Not Sold", null), { status: "rna", buyer: null, bid: null, afterSale: false });
  assert.deepEqual(readBuyer("Vendor (6,000) / Adam Wyrzyk / Tomasz Szumski (P.S.)", 8000), { status: "sold", buyer: "Adam Wyrzyk / Tomasz Szumski", bid: null, afterSale: true });
  assert.deepEqual(readBuyer("Lot Not Sold / Hyde Park Stud (P.S.)", 5000), { status: "sold", buyer: "Hyde Park Stud", bid: null, afterSale: true });
  assert.deepEqual(readBuyer("Graeme Carlisle (P.S.)", 3000), { status: "sold", buyer: "Graeme Carlisle", bid: null, afterSale: true });
  assert.equal(readBuyer("Lot Withdrawn", null).status, "withdrawn");
  assert.equal(readBuyer("", null).status, "catalogued", "a lot not yet through the ring during the sale");
});

test("what a lot is, from the house's type code", () => {
  assert.equal(kindOf("FOA", TIR_SALES.NNH), "foal");
  assert.equal(kindOf("YRLF", TIR_SALES.FNH), "yearling");
  assert.equal(kindOf("2YO", TIR_SALES.FNH), "2yo");
  assert.equal(kindOf("2YO", TIR_SALES.DBY), null, "a two-year-old at a store sale is a store");
  assert.equal(kindOf("P2P", TIR_SALES.P2P), "hit");
  assert.equal(kindOf("MAR", TIR_SALES.BFS), "breeding");
  assert.equal(kindOf("STO", TIR_SALES.DBY), null);
  assert.equal(kindOf("STW", TIR_SALES.JUL), null);
  assert.equal(kindOf(null, TIR_SALES.SYL), "yearling");
  assert.equal(kindOf(null, TIR_SALES.DB2), null);
});

test("a yearling sale's results as lots: sold, sold after the ring, bought back, withdrawn", () => {
  const sale = saleOf("SYL25", { dates: "23 - 24 Sep 2025" });
  const lots = parseResults(SYL25, "SYL25", sale);
  assert.equal(lots.length, 5);
  const [ps, sold, wd, psNotSold, rna] = lots;
  assert.equal(sold.source, "tattersallsireland");
  assert.equal(sold.company, "Tattersalls Ireland");
  assert.equal(sold.sale_key, "TIR-SEPT");
  assert.equal(sold.sale_label, "SYL25");
  assert.equal(sold.region, "EU");
  assert.equal(sold.sale_month, "2025-09");
  assert.equal(sold.sale_type, "yearling");
  assert.equal(sold.lot, "2");
  assert.equal(sold.horse, null);
  assert.equal(sold.sire, "Blackbeard");
  assert.equal(sold.sire_key, "BLACKBEARD");
  assert.equal(sold.dam, "Kalsara");
  assert.equal(sold.sex, "filly");
  assert.equal(sold.foaling_year, 2024);
  assert.equal(sold.vendor, "Noralla Stud Farm");
  assert.equal(sold.buyer, "J S Bloodstock / G Scott Racing");
  assert.equal(sold.status, "sold");
  assert.equal(sold.price, 60000);
  assert.equal(sold.currency, "EUR");
  assert.ok(sold.price_gbp > 49000 && sold.price_gbp < 55000, `€60,000 in September 2025 is about £52k, got ${sold.price_gbp}`);
  assert.equal(sold.after_sale, undefined);
  assert.equal(ps.status, "sold");
  assert.equal(ps.after_sale, true);
  assert.equal(ps.price, 8000);
  assert.equal(ps.bid, null);
  assert.equal(ps.buyer, "Adam Wyrzyk / Tomasz Szumski");
  assert.equal(psNotSold.after_sale, true);
  assert.equal(psNotSold.buyer, "Shanaville Stables");
  assert.equal(psNotSold.sex, "colt");
  assert.equal(wd.status, "withdrawn");
  assert.equal(wd.price, null);
  assert.equal(rna.status, "rna");
  assert.equal(rna.bid, 8000, "the last bid is shown as the price");
  assert.equal(rna.price, null);
  assert.equal(rna.buyer, null);
  assert.equal(rna.price_gbp, null);
  const totals = parseTotals(SYL25);
  assert.equal(totals.sold, 440);
  assert.deepEqual(totals.privateSales, { lots: 4, aggregate: 39000 });
});

test("a mixed sale's lots: horses in training, a mare, a two-year-old", () => {
  const p2p = parseResults(P2P25, "P2P25", saleOf("P2P25", { dates: "29 May 2025" }));
  assert.equal(p2p[0].horse, "Seaniecon");
  assert.equal(p2p[0].sire, "Capri");
  assert.equal(p2p[0].dam, "Abigail Lynch");
  assert.equal(p2p[0].sex, "gelding");
  assert.equal(p2p[0].foaling_year, 2021);
  assert.equal(p2p[0].sale_type, "hit");
  assert.equal(p2p[0].sale_key, "TIR-HIT");
  assert.equal(p2p[0].price, 62000);
  assert.equal(p2p[1].status, "rna");
  assert.equal(p2p[1].bid, null, "no last bid published");
  const fnh = parseResults(FNH25, "FNH25", saleOf("FNH25", { dates: "28 Jan 2025" }));
  assert.equal(fnh[0].sale_type, "2yo");
  assert.equal(fnh[0].foaling_year, 2023);
  assert.equal(fnh[0].status, "rna");
  assert.equal(fnh[0].bid, 1000);
  assert.equal(fnh[1].sale_type, "breeding");
  assert.equal(fnh[1].sex, "filly");
  assert.equal(fnh[1].dam_key, "FLORISHWELLS DETE");
  assert.equal(fnh[1].bid, 2800);
  assert.equal(fnh[1].sale_month, "2025-01");
});

test("a sale not yet held: catalogued, and withdrawn where marked", () => {
  const lots = parseResults(NNH26, "NNH26", saleOf("NNH26", { dates: "9 - 11 Nov 2026" }));
  assert.equal(lots.length, 2);
  assert.equal(lots[0].status, "withdrawn");
  assert.equal(lots[0].sale_type, "yearling");
  assert.equal(lots[1].status, "catalogued");
  assert.equal(lots[1].sale_type, "foal");
  assert.equal(lots[1].foaling_year, 2026);
  assert.equal(lots[1].price, null);
  assert.equal(lots[1].vendor, "Ballincurrig House Stud");
  assert.equal(lots[1].sale_key, "TIR-NH");
});

/** A stand-in for fetch: answers by URL, and checks the session cookie comes back. */
function fakeFetch(pages) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, cookie: init.headers?.cookie ?? null });
    const page = pages.find(([re]) => re.test(url));
    if (!page) return new Response("not found", { status: 404 });
    const headers = new Headers({ "content-type": "text/html" });
    headers.append("set-cookie", "SESSION=123; PATH=/; Secure");
    const body = typeof page[1] === "function" ? page[1](init) : page[1];
    return new Response(body, { status: 200, headers });
  };
  return { impl, calls };
}

test("fetching a sale: front page for the session, then the results with its cookie", async () => {
  const { impl, calls } = fakeFetch([
    [/\/Sale\/SYL25\/Main$/, `<div class="caps caps--small">23 - 24 Sep 2025</div><h1 class="heading-5">September Yearling Sale Part 1 2025</h1>`],
    [/\/Sale\/SYL25\/Catalogue$/, (init) => (init.headers?.cookie ? SYL25 : "<html><title>No Cookie</title></html>")],
  ]);
  const out = await fetchSale("SYL25", { fetchImpl: impl, pauseMs: 0 });
  assert.equal(out.title, "September Yearling Sale Part 1 2025");
  assert.equal(out.sale.key, "TIR-SEPT");
  assert.equal(out.lots.length, 5);
  assert.equal(out.totals.sold, 440);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].cookie, "SESSION=123");
});

test("discovering a year's sales from the house's list", async () => {
  const { impl } = fakeFetch([[/SaleDates\?site=FH&display=results&year=2025$/, SALE_DATES]]);
  const sales = await discover({ year: 2025, fetchImpl: impl, pauseMs: 0 });
  assert.deepEqual(sales.map((s) => [s.id, s.key, s.month]), [["FNH25", "TIR-NH", "2025-01"], ["IBU25", "TIR-BRZ", "2025-05"]]);
  assert.equal(sales[1].title, "Tattersalls Ireland Breeze Up Sale");
  assert.equal(sales[1].year, 2025);
});
