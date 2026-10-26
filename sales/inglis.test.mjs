import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { convert } from "./fx.mjs";
import {
  saleFromTitle, monthOf, parseResultsList, hasNextPage, parseCalendar, parseSalePage, outcomeOf, ageAt, kindOf, parseExport, discover, fetchSale,
  exportUrl, salePageUrl, resultsUrl, CALENDAR_URL, titleFromSlug,
} from "./inglis.mjs";

/** A zip of the named files, deflated: enough of the format for sales/xlsx.mjs. */
function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, body] of Object.entries(files)) {
    const raw = Buffer.from(body, "utf8");
    const data = zlib.deflateRawSync(raw);
    const n = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    locals.push(local, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const COLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** An export as Inglis writes it: the lot a number, everything else shared strings, empty cells left out. */
function workbook(rows) {
  const strings = [];
  const at = (s) => {
    const i = strings.indexOf(s);
    return i >= 0 ? i : strings.push(s) - 1;
  };
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const xmlRows = rows.map((r, ri) => `<row r="${ri + 1}">${r
    .map((v, ci) => {
      if (v === null || v === undefined || v === "") return "";
      const ref = `${COLS[ci]}${ri + 1}`;
      return typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${at(v)}</v></c>`;
    })
    .join("")}</row>`);
  return zip({
    "xl/sharedStrings.xml": `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet><sheetData>${xmlRows.join("")}</sheetData></worksheet>`,
  });
}

/* Rows trimmed from the house's exports (inglis.com.au/sales/<slug>/csv/index). */
const HEAD = ["Lot", "Colour", "Sex", "Name", "Vendor", "Sire", "Dam", "Purchaser Name", "Purchaser Location", "Status", "Price", "Stable 1", "Stable 2", "Stable 3", "Covering Stallion", "Dam Sire", "DOB", "Bonus Schemes"];

// 2026 Australian Easter Yearling Sale: sold, passed in, withdrawn; then lot 19 as a lot reads
// before it is offered (no status, buyer or price), as the next sale's export will.
const EASTER26 = workbook([
  HEAD,
  [1, "B.", "Filly", null, "Coolmore Stud, Jerrys Plains", "Home Affairs", "O'Marilyn", "Woppitt Bloodstock Pty Ltd", "NSW", "Sold", "$400,000", "Barn K", "Stables 17-23,26-39,42-53,61-64", null, null, "O'Reilly", "2024-10-18", "BOBS Eligible"],
  [2, "B.", "Filly", null, "Elsdon Park, Matamata, NZ", "Savabeel", "One Kiss (NZ)", null, null, "Passed In - Reserve: $350,000", null, "Barn K", "Stables 55-58", null, null, "Tivaci", "2024-09-02"],
  [7, "B.", "Colt", null, "Glenbeigh Farm, Scone", "Lope de Vega (IRE)", "Palme d'Or (IRE)", null, null, "Withdrawn", null, "Barn F", "Stables 42-45,56,57", null, null, "Siyouni", "2024-08-18"],
  [19, "B.", "Colt", null, "Coolmore Stud, Jerrys Plains", "Home Affairs", "Piping Hot", null, null, null, null, "Barn K", "Stables 17-23,26-39,42-53,61-64", null, null, "More Than Ready", "2024-08-28", "BOBS Eligible"],
]);

// The Chairman's Sale of 2026 (the last row is lot 1 of 2025's): mares and a filly as breeding stock; shares in stallions left out.
const CHAIRMANS26 = workbook([
  HEAD,
  [1, "B.", "Mare", "Sanitize", "Vinery Stud, Scone", "Exceed and Excel", "Cleanup", "RIFA Mustang Pty Ltd", "VIC", "Sold", "$300,000", "Barn I", "Stables 33-36", null, "Ole Kirk", "Dehere", "2021-10-14"],
  [10, "Ch.", "Filly", "Summer in Capri (NZ)", "Newgate Consignment, Aberdeen", "Proisir", "Temolie", "Kentucky Bloodstock", "QLD", "Sold", "$100,000", "Barn B", "Stables 49-55,57-64", null, null, "Star Witness", "2022-10-21"],
  [15, "B.", "Mare", "The Black Cloud", "Proven Thoroughbreds, Sydney", "Shamus Award", "Containment", null, null, "Passed In - Reserve: $250,000", null, "Big Barn", "Stables 19-21", null, null, "Krupt", "2020-10-20"],
  [104, "Ch.", "Colt", "Extreme Choice", "A Shareholder, Sydney", "Not a Single Doubt", "Extremely", null, null, "Passed In - Reserve: $950,000", null, null, null, null, null, "Hussonet", "2013-09-06"],
  [1, "B.", "Colt", "Bivouac - Breeding Right", "Segenhoe Stud, Scone", "Exceed and Excel", "Dazzler", null, null, "Withdrawn", null, null, null, null, null, "More Than Ready", "2016-11-04"],
]);

// 2026 Ready2Race Sale: two-year-olds (its export adds the breeze-up columns).
const R2R26 = workbook([
  [...HEAD, "Breeze Up Time", "Track", "Location"],
  [1, "B.", "Colt", null, "Blake Ryan Racing, Sydney", "Cool Aza Beel (NZ)", "Jacquetta", " Bridle Bloodstock", "HONG KONG", "Sold", "$150,000", "Barn K", "Stables 1-19,31,32", null, null, "Encosta de Lago", "2024-10-30", "BOBS Eligible", 10.56, "Grass, Good 4", "Warwick Farm"],
  [7, "B.", "Gelding", null, "Moffatt Breaking & Pre Training, Milawa, Vic", "Churchill (IRE)", "Joyous Bel", "Joseph & Jones Racing", "NSW", "Sold", "$30,000", "Barn C", "Stables 33-36,46-48", null, null, "Bel Esprit", "2024-09-28", "BOBS Eligible", 10.5, "Grass, Good 4", "Wangaratta"],
]);

/* Markup trimmed from inglis.com.au: a results card, the calendar's table row and catalogue panel, a sale's header. */
const RESULTS = `<div class="border-b border-blue-700 mb-8 pb-2">
  <div class="flex flex-col md:flex-row justify-between"><div class="text-lg font-bold">
    <a href="/sale/2026-australian-easter-yearling-sale">2026 Australian Easter Yearling Sale</a></div>
    <div class="text-sm text-gray-400">
      29, 30 March 2026
    </div></div>
  <div><a href="https://inglis.com.au/sales/2026-australian-easter-yearling-sale/csv/index">Export as CSV</a></div></div>
<div class="border-b border-blue-700 mb-8 pb-2">
  <div class="flex flex-col md:flex-row justify-between"><div class="text-lg font-bold">
    <a href="/sale/2026-chairmans-sale">2026 Chairman&#039;s Sale</a></div>
    <div class="text-sm text-gray-400">
      7 May 2026
    </div></div></div>
<button type="button" wire:click="nextPage('page')" dusk="nextPage">Next &raquo;</button>`;

const CALENDAR = `<table><tr>
<td>
<a href="https://inglis.com.au/sale/2027-premier-yearling-sale">
Premier Yearling Sale
</a>
</td>
<td>
28 February - 2 March
</td>
<td><a href="https://inglis.com.au/locations/oaklands">Oaklands</a></td>
<td>12 December</td>
</tr><tr>
<td>
May (Early) Online Sale
</td>
<td>
7 - 12 May
</td>
<td><a href="https://inglisdigital.com/">Inglis Digital AUS</a></td>
<td>5&nbsp;May</td>
</tr></table>
<a class="catalogue-panel-item"
   href="/sale/2026-chairmans-sale" >
<div class="px-3 py-2 grid grid-cols-5"><div class="col-span-4 px-3 flex flex-col justify-around">
<div
 class="font-bold tracking-tighter leading-5 text-gray-700">2026 Chairman's Sale</div>
<div class="text-gray-600 text-sm">Riverside Stables</div>
<p class="mb-0 text-gray-600 text-sm">7 May 2026</p>
</div></div></a>`;

const SALE_PAGE = `<html><head><title>    2026 Australian Easter Yearling Sale
 - Inglis</title></head><body><h2 class="font-bold text-3xl self-center">
2026 Australian Easter Yearling Sale
</h2><p class="p-0 m-0 font-semibold text-center sm:self-end self-baseline md:-mt-1 text-gray-600">29, 30 March 2026</p></body></html>`;

test("Inglis sales from their titles: the workbook's keys for the yearling sales, new keys for the rest", () => {
  const key = (t) => saleFromTitle(t)?.key ?? null;
  assert.deepEqual(saleFromTitle("2026 Australian Easter Yearling Sale", { month: "2026-03" }), { key: "ING-EASTER", name: "Inglis Easter", type: "yearling", tier: 1, year: 2026, month: "2026-03" });
  assert.equal(key("2025 Classic Yearling Sale"), "ING-CLASSIC");
  assert.equal(key("2026 Premier Yearling Sale"), "ING-PREMIER");
  assert.equal(key("2021 Melbourne Premier Yearling Sale"), "ING-PREMIER");
  assert.equal(key("2024 Gold Yearling Sale"), "ING-VOBIS");
  assert.equal(key("2026 HTBA Yearling Sale"), "HTBA");
  assert.equal(key("2022 HTBA May Yearling Sale"), "HTBA");
  assert.equal(key("2020 Scone Yearling Sale"), "ING-SCONE");
  assert.equal(key("2026 Ready2Race Sale"), "ING-R2R");
  assert.equal(key("2019 Ready 2 Race Sale"), "ING-R2R");
  assert.equal(saleFromTitle("2026 Ready2Race Sale").type, "2yo");
  assert.equal(key("2026 Australian Weanling Sale"), "ING-WEAN");
  assert.equal(key("2026 Chairman's Sale"), "ING-CHAIR");
  assert.equal(key("2025 Australian Broodmare Sale"), "ING-BROOD");
  assert.equal(key("2026 Great Southern Weanling Sale"), "ING-GSTH");
  assert.equal(key("2026 November (Early) Online Sale"), null, "Inglis Digital's sales are not read here");
  assert.equal(titleFromSlug("2026-htba-yearling-sale"), "2026 HTBA Yearling Sale");
});

test("dates, listings, calendar and a sale's page", () => {
  assert.equal(monthOf("29, 30 March 2026"), "2026-03");
  assert.equal(monthOf("27, 28 February &amp; 1 March 2022"), "2022-02");
  assert.equal(monthOf("4 - 5 May", 2027), "2027-05");
  assert.deepEqual(parseResultsList(RESULTS).map((s) => [s.id, s.title, s.month]), [
    ["2026-australian-easter-yearling-sale", "2026 Australian Easter Yearling Sale", "2026-03"],
    ["2026-chairmans-sale", "2026 Chairman's Sale", "2026-05"],
  ]);
  assert.equal(hasNextPage(RESULTS), true);
  assert.deepEqual(parseCalendar(CALENDAR).map((s) => [s.id, s.title, s.month]), [
    ["2027-premier-yearling-sale", "2027 Premier Yearling Sale", "2027-02"],
    ["2026-chairmans-sale", "2026 Chairman's Sale", "2026-05"],
  ]);
  assert.deepEqual(parseSalePage(SALE_PAGE), { title: "2026 Australian Easter Yearling Sale", month: "2026-03" });
});

test("what became of a lot, its age and what it is", () => {
  assert.deepEqual(outcomeOf("Sold", "$400,000"), { status: "sold", price: 400000, bid: null });
  assert.deepEqual(outcomeOf("Passed In - Reserve: $350,000", null), { status: "rna", price: null, bid: 350000 });
  assert.equal(outcomeOf("Withdrawn", null).status, "withdrawn");
  assert.equal(outcomeOf(null, null).status, "catalogued");
  assert.equal(outcomeOf("Sold", null).status, "sold_private");
  assert.equal(ageAt(2024, "2026-03"), 1, "foaled in the spring of 2024, a yearling in March 2026");
  assert.equal(ageAt(2025, "2026-05"), 0);
  assert.equal(ageAt(2024, "2026-10"), 2, "two on 1 August");
  assert.equal(kindOf({ sex: "Colt", age: 1 }, "yearling"), "yearling");
  assert.equal(kindOf({ sex: "Gelding", age: 2 }, "2yo"), "2yo");
  assert.equal(kindOf({ sex: "Mare", name: "Sanitize", age: 4 }, "breeding"), "breeding");
  assert.equal(kindOf({ sex: "Filly", name: "Summer in Capri", age: 3 }, "breeding"), "breeding");
  assert.equal(kindOf({ sex: "Colt", age: 0 }, "mixed"), "foal");
  assert.equal(kindOf({ sex: "Colt", name: "Extreme Choice", age: 12 }, "breeding"), null, "a stallion at a breeding sale is a share in one");
  assert.equal(kindOf({ sex: "Colt", name: "Bivouac - Breeding Right", age: 9 }, "breeding"), null);
});

test("a yearling sale's export as lots: sold, passed in with its reserve, withdrawn, still to come; AUD to sterling", () => {
  const out = parseExport(EASTER26, { id: "2026-australian-easter-yearling-sale", title: "2026 Australian Easter Yearling Sale", month: "2026-03" });
  assert.equal(out.sale.key, "ING-EASTER");
  assert.equal(out.lots.length, 4);
  const [sold, passed, withdrawn, toCome] = out.lots;
  assert.equal(sold.source, "inglis");
  assert.equal(sold.company, "Inglis");
  assert.equal(sold.sale_label, "2026-australian-easter-yearling-sale");
  assert.equal(sold.region, "AUS");
  assert.equal(sold.year, 2026);
  assert.equal(sold.sale_month, "2026-03");
  assert.equal(sold.sale_type, "yearling");
  assert.equal(sold.lot, "1");
  assert.equal(sold.horse, null);
  assert.equal(sold.sire, "Home Affairs");
  assert.equal(sold.dam, "O'Marilyn");
  assert.equal(sold.dam_key, "OMARILYN");
  assert.equal(sold.sex, "filly");
  assert.equal(sold.foaling_year, 2024);
  assert.equal(sold.vendor, "Coolmore Stud, Jerrys Plains");
  assert.equal(sold.buyer, "Woppitt Bloodstock Pty Ltd");
  assert.equal(sold.status, "sold");
  assert.equal(sold.price, 400000);
  assert.equal(sold.currency, "AUD");
  assert.equal(sold.price_gbp, Math.round(convert(400000, "AUD", "GBP", "2026-03")));
  assert.ok(sold.price_gbp > 180000 && sold.price_gbp < 220000, `A$400,000 in March 2026 is about £200k, got ${sold.price_gbp}`);
  assert.equal(passed.status, "rna");
  assert.equal(passed.bid, 350000, "the vendor's reserve, the only figure published");
  assert.equal(passed.dam, "One Kiss");
  assert.equal(passed.dam_key, "ONE KISS");
  assert.equal(passed.buyer, null);
  assert.equal(passed.price_gbp, null);
  assert.equal(withdrawn.status, "withdrawn");
  assert.equal(withdrawn.sire, "Lope de Vega");
  assert.equal(withdrawn.sex, "colt");
  assert.equal(toCome.status, "catalogued");
  // The house does not mark a lot sold after the ring, so no lot says it was.
  assert.ok(out.lots.every((l) => !("after_sale" in l)));
});

test("the Chairman's Sale: mares and fillies as breeding stock, stallion shares left out", () => {
  const out = parseExport(CHAIRMANS26, { id: "2026-chairmans-sale", title: "2026 Chairman's Sale", month: "2026-05" });
  assert.equal(out.sale.key, "ING-CHAIR");
  assert.deepEqual(out.lots.map((l) => [l.lot, l.horse, l.sale_type, l.sex, l.status, l.price ?? l.bid]), [
    ["1", "Sanitize", "breeding", "filly", "sold", 300000],
    ["10", "Summer in Capri", "breeding", "filly", "sold", 100000],
    ["15", "The Black Cloud", "breeding", "filly", "rna", 250000],
  ]);
});

test("the Ready2Race Sale: two-year-olds, buyer trimmed", () => {
  const out = parseExport(R2R26, { id: "2026-sydney-ready2race-sale", title: "2026 Ready2Race Sale", month: "2026-10" });
  assert.equal(out.sale.key, "ING-R2R");
  assert.deepEqual(out.lots.map((l) => [l.lot, l.sale_type, l.sex, l.price, l.buyer]), [
    ["1", "2yo", "colt", 150000, "Bridle Bloodstock"],
    ["7", "2yo", "gelding", 30000, "Joseph & Jones Racing"],
  ]);
});

/** A fetch that answers from fixtures and records what was asked. */
function fakeFetch(pages) {
  const asked = [];
  const impl = async (url) => {
    asked.push(url);
    const body = pages[url];
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(body, { status: 200 });
  };
  return { impl, asked };
}

test("discover and fetchSale, without the network", async () => {
  const { impl, asked } = fakeFetch({
    [resultsUrl(2026)]: RESULTS.replace(/<button[\s\S]*$/, ""),
    [CALENDAR_URL]: CALENDAR,
    [salePageUrl("2026-australian-easter-yearling-sale")]: SALE_PAGE,
    [exportUrl("2026-australian-easter-yearling-sale")]: EASTER26,
    [exportUrl("2027-classic-yearling-sale")]: workbook([HEAD]),
  });
  const sales = await discover({ year: 2026, fetchImpl: impl, pauseMs: 0 });
  assert.deepEqual(sales.map((s) => [s.id, s.key, s.type, s.tier, s.month, s.year]), [
    ["2026-australian-easter-yearling-sale", "ING-EASTER", "yearling", 1, "2026-03", 2026],
    ["2026-chairmans-sale", "ING-CHAIR", "breeding", 1, "2026-05", 2026],
  ]);
  const one = await fetchSale("2026-australian-easter-yearling-sale", { fetchImpl: impl, pauseMs: 0 });
  assert.equal(one.title, "2026 Australian Easter Yearling Sale");
  assert.deepEqual(one.sale, { key: "ING-EASTER", name: "Inglis Easter", type: "yearling", tier: 1, year: 2026, month: "2026-03" });
  assert.equal(one.lots.length, 4);
  assert.deepEqual(asked.slice(-2), [salePageUrl("2026-australian-easter-yearling-sale"), exportUrl("2026-australian-easter-yearling-sale")]);
  const before = asked.length;
  const viaInfo = await fetchSale(sales[0].id, { fetchImpl: impl, info: sales[0], pauseMs: 0 });
  assert.deepEqual(asked.slice(before), [exportUrl("2026-australian-easter-yearling-sale")], "discover's entry saves reading the sale's page");
  assert.deepEqual(viaInfo.sale, one.sale);
  const ahead = await fetchSale("2027-classic-yearling-sale", { fetchImpl: impl, title: "2027 Classic Yearling Sale", month: "2027-02", pauseMs: 0 });
  assert.equal(ahead.sale.key, "ING-CLASSIC");
  assert.equal(ahead.lots.length, 0, "before the catalogue is out the export is its header alone");
});
