import { test } from "node:test";
import assert from "node:assert/strict";
import { saleFromTitle, parseResultsPage, kindOf, outcomeOf, parseSale, saleUrl, discover, fetchSale } from "./obs.mjs";

/* Fixtures: trimmed from the house's own catalogue JSON (obssales.com/wp-json/obs-catalog-wp-plugin/v1/horse-sales/<id>), fields cut to those read. */

const ring = (o) => ({ is_hip_out: false, is_hip_not_through_ring_yet: false, is_hip_sold: false, is_rna: false, ...o });

// 2025 October Yearling Sale (sale 146): sold, sold after the ring, RNA with and without a last bid, out, a blank page.
const OCT_2025 = {
  sale_id: "146", sale_code: "O125", sale_name: "2025 October Yearling Sale", sale_category: "yearling", is_digital: "0", sale_starts: "2025-10-07 04:00:00",
  sale_hip: [
    { hip_number: "1", in_out_status: "I", horse_type: "Y", foaling_year: "2024", horse_name: "", sex: "F", sire_name: "Bucchero", dam_name: "Dagney's Revenge", consignor_name: "Kaizen Sales (Richard Kent), Agent I", buyer_name: "Thorostock, Nick Sallusto, Agent", hammer_price: "110000.00", rna_summary_indicator: "N", post_sale_indicator: "N", sale_price_rna: "0.00", breeding_sire_name_current_1st: "", display_props: ring({ is_hip_sold: true }) },
    { hip_number: "5", in_out_status: "I", horse_type: "Y", foaling_year: "2024", horse_name: "", sex: "F", sire_name: "Pinehurst", dam_name: "Daring Reality", consignor_name: "Vinery Sales, Agent XX", buyer_name: "Okab Company LLC", hammer_price: "7000.00", rna_summary_indicator: "N", post_sale_indicator: "Y", sale_price_rna: "0.00", breeding_sire_name_current_1st: "", display_props: ring({ is_hip_sold: true }) },
    { hip_number: "7", in_out_status: "I", horse_type: "Y", foaling_year: "2024", horse_name: "", sex: "C", sire_name: "Social Inclusion", dam_name: "Devious", consignor_name: "Beth Bayer, Agent IV", buyer_name: "RNA", hammer_price: -5000, rna_summary_indicator: "Y", post_sale_indicator: "N", sale_price_rna: "5000.00", breeding_sire_name_current_1st: "", display_props: ring({ is_rna: true }) },
    { hip_number: "168", in_out_status: "I", horse_type: "Y", foaling_year: "2024", horse_name: "", sex: "C", sire_name: "Solomini", dam_name: "New Year's Wish", consignor_name: "McMahon of Saratoga Thoroughbreds LLC, Agent", buyer_name: "RNA", hammer_price: 0, rna_summary_indicator: "Y", post_sale_indicator: "N", sale_price_rna: "0.00", breeding_sire_name_current_1st: "", display_props: ring({ is_rna: true }) },
    { hip_number: "21", in_out_status: "O", horse_type: "Y", foaling_year: "2024", horse_name: "", sex: "C", sire_name: "Girvin", dam_name: "Embur's Zip", consignor_name: "Beth Bayer, Agent XV", buyer_name: "OUT", hammer_price: null, rna_summary_indicator: "", post_sale_indicator: "", sale_price_rna: "0.00", breeding_sire_name_current_1st: "", display_props: ring({ is_hip_out: true }) },
    { hip_number: "399", in_out_status: "O", horse_type: "Y", foaling_year: "2024", horse_name: "zz Blank Page", sex: "U", sire_name: "zz Blank Page", dam_name: "zz Blank Page", consignor_name: "Blank Pages", buyer_name: "OUT", hammer_price: null, rna_summary_indicator: "", post_sale_indicator: "", sale_price_rna: "0.00", breeding_sire_name_current_1st: "", display_props: ring({ is_hip_out: true }) },
  ],
};

// 2025 Winter Mixed Live Sale (sale 140): a mare in foal (B), a mare not in foal (J), a horse of racing age (4).
const WINTER_2025 = {
  sale_id: "140", sale_code: "O525", sale_name: "2025 Winter Mixed Live Sale", sale_category: "mixed", is_digital: "0", sale_starts: "2025-01-28 05:00:00",
  sale_hip: [
    { hip_number: "6", in_out_status: "I", horse_type: "B", foaling_year: "2019", horse_name: "Solar Girl", sex: "M", sire_name: "Greenpointcrusader", dam_name: "Lady Carlotta", consignor_name: "Beth Bayer, Agent X", buyer_name: "Lois Taylor", hammer_price: "1000.00", rna_summary_indicator: "N", post_sale_indicator: "N", sale_price_rna: "0.00", breeding_sire_name_current_1st: "Social Inclusion", display_props: ring({ is_hip_sold: true }) },
    { hip_number: "56", in_out_status: "I", horse_type: "J", foaling_year: "2019", horse_name: "Last Leaf", sex: "M", sire_name: "Not This Time", dam_name: "My Miss Kallie", consignor_name: "G. Martinez Training, Agent", buyer_name: "Senor's Senorita's", hammer_price: "140000.00", rna_summary_indicator: "N", post_sale_indicator: "N", sale_price_rna: "0.00", breeding_sire_name_current_1st: "", display_props: ring({ is_hip_sold: true }) },
    { hip_number: "98", in_out_status: "I", horse_type: "4", foaling_year: "2021", horse_name: "Fillyrules", sex: "F", sire_name: "Temple City", dam_name: "R Smarty Pants", consignor_name: "Robert Vickers, Agent I", buyer_name: "Fermoy Racing", hammer_price: "2200.00", rna_summary_indicator: "N", post_sale_indicator: "N", sale_price_rna: "0.00", breeding_sire_name_current_1st: "", display_props: ring({ is_hip_sold: true }) },
  ],
};

// 2026 Spring 2YO in Training Sale (sale 150): a ridgling sold for $600,000.
const SPRING_2026 = {
  sale_id: "150", sale_code: "O726", sale_name: "2026 Spring 2YO in Training Sale", sale_category: "2yo", is_digital: "0", sale_starts: "2026-04-14 04:00:00",
  sale_hip: [
    { hip_number: "202", in_out_status: "I", horse_type: "2", foaling_year: "2024", horse_name: "", sex: "R", sire_name: "Maxfield", dam_name: "Spoken Not Broken", consignor_name: "Kinsman Farm, Agent III", buyer_name: "Pedro Lanz, Agt for FMQ Stable/Three Chimneys Farm", hammer_price: "600000.00", rna_summary_indicator: "N", post_sale_indicator: "N", sale_price_rna: "0.00", breeding_sire_name_current_1st: "", display_props: ring({ is_hip_sold: true }) },
  ],
};

// The house's results page (obssales.com/sales-results/), a few of its links.
const RESULTS_PAGE = `<h4><a href="https://obssales.com/catalog/#/134/results" aria-hidden="true" class="link"></a><a href="https://obssales.com/catalog/#/134/results" rel="bookmark">2024 January Winter Mixed &#038; HRA Sale</a></h4>
<h4><a href="https://obssales.com/catalog/#/145/results" rel="bookmark">2025 June Two-Year-Olds and Horses of Racing Age Sale</a></h4>
<h4><a href="https://obssales.com/catalog/#/146/results" rel="bookmark">2025 October Yearling Sale</a></h4>
<h4><a href="https://www.obscatalog.com/octresults/2023/" rel="bookmark">2023 October Yearling Sale</a></h4>`;

test("OBS sales from their names", () => {
  assert.deepEqual(saleFromTitle("2025 October Yearling Sale", "2025-10-07 04:00:00"), { key: "OBS-OCT", name: "OBS October Yearlings", type: "yearling", tier: 3, year: 2025, month: "2025-10" });
  assert.equal(saleFromTitle("2025 March 2YO in Training Sale").key, "OBS-MARCH");
  assert.equal(saleFromTitle("2024 March Two Year Olds in Training Sale").month, "2024-03");
  assert.equal(saleFromTitle("2024 April Spring Sale of Two-Year-Olds in Training").key, "OBS-SPRING");
  assert.equal(saleFromTitle("2026 Spring 2YO in Training Sale").key, "OBS-SPRING");
  assert.equal(saleFromTitle("2025 June 2YO in Training and Horses of Racing Age Sale").key, "OBS-JUNE");
  assert.equal(saleFromTitle("2024 January Winter Mixed &#038; HRA Sale").key, "OBS-JAN");
  assert.equal(saleFromTitle("2025 Winter Mixed Live Sale").month, "2025-01");
  assert.equal(saleFromTitle("2026 OBSOnline March Second Chance Sale").key, "OBS-ONLINE");
  assert.equal(saleFromTitle("2024 OBSOnline October Sale").key, "OBS-ONLINE");
  assert.equal(saleFromTitle("Stallion Season Auction"), null);
});

test("the sales the results page links", () => {
  assert.deepEqual(parseResultsPage(RESULTS_PAGE), [
    { id: 134, title: "2024 January Winter Mixed & HRA Sale" },
    { id: 145, title: "2025 June Two-Year-Olds and Horses of Racing Age Sale" },
    { id: 146, title: "2025 October Yearling Sale" },
  ]);
  assert.equal(saleUrl(146), "https://obssales.com/wp-json/obs-catalog-wp-plugin/v1/horse-sales/146");
});

test("what a hip is and what became of it", () => {
  assert.equal(kindOf("Y"), "yearling");
  assert.equal(kindOf("2"), "2yo");
  assert.equal(kindOf("3"), "hit");
  assert.equal(kindOf("B"), "breeding");
  assert.equal(kindOf("J"), "breeding");
  assert.equal(kindOf("W"), "foal");
  assert.equal(kindOf("", { foaled: 2023, year: 2025 }), "2yo");
  assert.equal(kindOf("", {}), null);
  const [sold, post, rna, rnaNoBid, out] = OCT_2025.sale_hip;
  assert.deepEqual(outcomeOf(sold), { status: "sold", price: 110000, bid: null, afterSale: false });
  assert.deepEqual(outcomeOf(post), { status: "sold", price: 7000, bid: null, afterSale: true });
  assert.deepEqual(outcomeOf(rna), { status: "rna", price: null, bid: 5000, afterSale: false });
  assert.deepEqual(outcomeOf(rnaNoBid), { status: "rna", price: null, bid: null, afterSale: false });
  assert.equal(outcomeOf(out).status, "withdrawn");
  // The house holds no sale before the ring today; this is hip 1 as it reads in the catalogue beforehand.
  const ahead = { ...sold, buyer_name: "", hammer_price: null, rna_summary_indicator: "", post_sale_indicator: "", display_props: ring({ is_hip_not_through_ring_yet: true }) };
  assert.equal(outcomeOf(ahead).status, "catalogued");
  assert.equal(outcomeOf({ ...ahead, display_props: {} }).status, "catalogued");
});

test("a yearling sale's hips as lots", () => {
  const out = parseSale(OCT_2025);
  assert.equal(out.id, 146);
  assert.equal(out.code, "O125");
  assert.equal(out.title, "2025 October Yearling Sale");
  assert.equal(out.sale.key, "OBS-OCT");
  assert.equal(out.lots.length, 5, "the blank page is not a lot");
  const [sold, post, rna, rnaNoBid, out_] = out.lots;
  assert.equal(sold.source, "obs");
  assert.equal(sold.company, "OBS");
  assert.equal(sold.sale_label, "OBS146");
  assert.equal(sold.region, "US");
  assert.equal(sold.year, 2025);
  assert.equal(sold.sale_month, "2025-10");
  assert.equal(sold.sale_type, "yearling");
  assert.equal(sold.lot, "1");
  assert.equal(sold.horse, null);
  assert.equal(sold.sire, "Bucchero");
  assert.equal(sold.sire_key, "BUCCHERO");
  assert.equal(sold.dam, "Dagney's Revenge");
  assert.equal(sold.dam_key, "DAGNEYS REVENGE");
  assert.equal(sold.sex, "filly");
  assert.equal(sold.foaling_year, 2024);
  assert.equal(sold.vendor, "Kaizen Sales (Richard Kent), Agent", "the consignment numeral is dropped");
  assert.equal(sold.buyer, "Thorostock, Nick Sallusto, Agent");
  assert.equal(sold.status, "sold");
  assert.equal(sold.price, 110000);
  assert.equal(sold.currency, "USD");
  assert.ok(sold.price_gbp > 78000 && sold.price_gbp < 88000, `$110,000 in October 2025 is about £82k, got ${sold.price_gbp}`);
  assert.equal(sold.after_sale, undefined);
  assert.equal(post.after_sale, true);
  assert.equal(post.price, 7000);
  assert.equal(post.buyer, "Okab Company LLC");
  assert.equal(rna.status, "rna");
  assert.equal(rna.bid, 5000);
  assert.equal(rna.price, null);
  assert.equal(rna.buyer, null);
  assert.equal(rna.sex, "colt");
  assert.equal(rnaNoBid.bid, null);
  assert.equal(out_.status, "withdrawn");
  assert.equal(out_.vendor, "Beth Bayer, Agent");
});

test("a mixed sale and a two-year-old sale", () => {
  const winter = parseSale(WINTER_2025).lots;
  assert.deepEqual(winter.map((l) => l.sale_type), ["breeding", "breeding", "hit"]);
  assert.equal(winter[0].sex, "filly");
  assert.equal(winter[0].horse, "Solar Girl");
  assert.equal(winter[1].price, 140000);
  assert.equal(winter[2].foaling_year, 2021);
  assert.equal(winter[2].sale_key, "OBS-JAN");
  assert.equal(winter[2].sale_month, "2025-01");
  const [colt] = parseSale(SPRING_2026).lots;
  assert.equal(colt.sale_type, "2yo");
  assert.equal(colt.sex, "colt", "a ridgling is a colt");
  assert.equal(colt.sale_key, "OBS-SPRING");
  assert.equal(colt.sale_tier, 2);
  assert.equal(colt.price, 600000);
  assert.equal(colt.sale_label, "OBS150");
});

test("an OBSOnline sale reads under its own key", () => {
  const online = { ...SPRING_2026, sale_id: "153", sale_name: "2026 OBSOnline April Second Chance Sale", is_digital: "1", sale_starts: "2026-04-24 04:00:00" };
  const out = parseSale(online);
  assert.equal(out.sale.key, "OBS-ONLINE");
  assert.equal(out.lots[0].sale_label, "OBS153");
});

/** A stand-in for fetch. */
function fakeFetch(pages) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const page = pages.find(([re]) => re.test(url));
    if (!page) return new Response("not found", { status: 404 });
    return new Response(typeof page[1] === "string" ? page[1] : JSON.stringify(page[1]), { status: 200 });
  };
  return { impl, calls };
}

test("discovering a year's sales and fetching one", async () => {
  const { impl, calls } = fakeFetch([
    [/\/sales-results\/$/, RESULTS_PAGE],
    [/\/horse-sales\/146$/, OCT_2025],
  ]);
  const sales = await discover({ year: 2025, fetchImpl: impl });
  assert.deepEqual(sales.map((s) => [s.id, s.key, s.month, s.tier]), [[145, "OBS-JUNE", "2025-06", 3], [146, "OBS-OCT", "2025-10", 3]]);
  const out = await fetchSale(146, { fetchImpl: impl });
  assert.equal(out.title, "2025 October Yearling Sale");
  assert.equal(out.sale.key, "OBS-OCT");
  assert.equal(out.lots.length, 5);
  assert.equal(calls.length, 2);
  await assert.rejects(fetchSale(999, { fetchImpl: impl }), /HTTP 404/);
});
