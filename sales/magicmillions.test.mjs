import { test } from "node:test";
import assert from "node:assert/strict";
import { convert } from "./fx.mjs";
import { saleFromTitle, parseSalesList, parseCsv, kindOf, outcomeOf, parseResults, discover, fetchSale, titleForCode, csvUrl, SALES_LIST_URL } from "./magicmillions.mjs";

/* Rows trimmed from the house's exports (catalogue.magicmillions.com.au/csv/<code>.csv). */
const HEAD = `"lot number","book","vendor","lot name","colour","sex","in foal","dob","sire","dam","serving sire","bonus_scheme","sale date","buyer","location","price","type","breeze up date","breeze up time","breeze up location","stable","box","row","dam sire"`;

// 2026 Gold Coast Yearling Sale (26GPR): sold, passed in, withdrawn, sold; then lot 6 as a lot
// reads before it is offered (no sale time, buyer or price), as the next sale's catalogue will.
const GPR26 = [
  HEAD,
  `"1","1","Baramul Stud, Widden Valley, NSW","","B.","F","No","09/09/2024","Snitzel (AUS)","Yesterjoy (AUS)","","BOBS Eligible","13/01/2026 11:01","David Ellis CNZM/Te Akau Racing","NEW ZEALAND","500000","Yearling","","","","CHESTER","92","","More Than Ready (USA)"`,
  `"2","1","Attunga Stud, Scone, NSW (As Agent)","","B.","C","No","29/07/2024","Hitotsu (AUS)","Yours But Mine (AUS)","","BOBS Eligible","13/01/2026 11:03","Psd $100000 Res $120000","","","Yearling","","","","S","15","","Choisir (AUS)"`,
  `"4","1","Sullivan Bloodstock, Kialla East, Vic (As Agent)","","B. or Br.","C","No","30/08/2024","Russian Revolution (AUS)","Za Zi Ba (AUS)","","BOBS Eligible, VOBIS Silver","","","","withdrawn","Yearling","","","Withdrawn","QF","12","","All Too Hard (AUS)"`,
  `"6","1","Glenlogan Park, Innisplain, Qld","","B.","C","No","09/09/2024","Wild Ruler (AUS)","Zavance (AUS)","","BOBS Eligible","13/01/2026 11:07","Gai Waterhouse & Adrian Bott/Kestrel Thoroughbreds","NSW","200000","Yearling","","","","J","24","","Mossman (AUS)"`,
  `"7","1","Glenlogan Park, Innisplain, Qld","","B.","C","No","09/09/2024","Wild Ruler (AUS)","Zavance (AUS)","","BOBS Eligible","","","","","Yearling","","","","J","24","","Mossman (AUS)"`,
].join("\r\n");

// 2025 Gold Coast National Broodmare Sale (25GWM): a share in a stallion, a racing filly passed in, a broodmare sold.
const GWM25 = [
  HEAD,
  `"391","1","A Shareholder, Sydney, NSW","Bivouac (AUS)","B.","C","No","04/11/2016","Exceed and Excel (AUS)","Dazzler (AUS)","","","27/05/2025 12:01","Godolphin Australia Pty Ltd","NSW","60000","SH","","","","","","","More Than Ready (USA)"`,
  `"401","1","Sledmere Stud, Scone, NSW (As Agent)","Field of Daysees (AUS)","Ch.","F","No","18/10/2021","Deep Field (AUS)","Daysee Doom (AUS)","","","27/05/2025 12:05","Psd $70000 Res $80000","","","RF","","","","Y","19","","Domesday (AUS)"`,
  `"629","3","Kilmore Farm, Matamata, NZ","Hayley (AUS)","Br.","M","Yes","08/09/2018","Sooboog (AUS)","Duchess Kate (NZ)","Super Seth (AUS)","","27/05/2025 18:01","North Bloodstock","NSW","85000","Broodmare","","","","","","","Savabeel (AUS)"`,
].join("\n");

// 2025 Gold Coast Horses In Training Sale (25GRT): two-year-olds and a three-year-old.
const GRT25 = [
  HEAD,
  `"1","1","Baramul Stud, Widden Valley, NSW","","Ch.","C","No","21/11/2023","Star Turn (AUS)","L'Amoureuse (AUS)","","BOBS Eligible, Nominated to Magic Millions Race Series","09/10/2025 12:05","Psd $10000 Res $11000","","","2YO","07/10/2025","15.55","Gold Coast (Synthetic)","A","5","","More Than Ready (USA)"`,
  `"3","1","GlenX Lodge, Biddaddaba, Qld","","B.","C","No","28/09/2023","Gold Standard (AUS)","La Isla Bonita (AUS)","","VOBIS Silver, VOBIS Sires","09/10/2025 12:07","Darby Racing","NSW","50000","2YO","23/09/2025","10.35","Gold Coast (Synthetic)","F","4","","I Am Invincible (AUS)"`,
  `"185","2","Border Bloodstock, Scone, NSW","Magic Merlin (AUS)","Br. or Gr.","G","No","25/09/2022","Lucky Vega (IRE)","Col 'n' Lil (AUS)","","VOBIS Sires","09/10/2025 16:36","Psd $45000 Res $50000","","","3YO","No Breeze Up","","Trialled 01.10.2025","G","9","","Bradbury's Luck (AUS)"`,
].join("\n");

/* Trimmed from www.magicmillions.com.au/sales-list/: a sale to come with no catalogue yet, one with, one never catalogued. */
const LIST = `<div class="sales-list-year"><h2 class="sales-list-year-title">2027</h2><h3>January</h3><ul class="sales-list-month"><li><a href="https://www.magicmillions.com.au/calendar/2027-gold-coast-yearling-sale/" title="View Sale Page"><span>12th - 17th</span> -- Gold Coast Yearling Sale</a></li></ul></div><div class="sales-list-year"><h2 class="sales-list-year-title">2026</h2><h3>May</h3><ul class="sales-list-month"><li><a href="https://www.magicmillions.com.au/calendar/2026-gold-coast-national-weanling-sale/" title="View Sale Page"><span>24th</span> -- Gold Coast National Weanling Sale</a> | <a href="https://catalogue.magicmillions.com.au/sale/26GWW" target="_blank" title="View Online Catalogue"><i class="fas fa-book"></i> Catalogue</a></li></ul><h3>January</h3><ul class="sales-list-month"><li><a href="https://www.magicmillions.com.au/calendar/2026-gold-coast-yearling-sale/" title="View Sale Page"><span>13th - 18th</span> -- Gold Coast Yearling Sale</a> | <a href="https://catalogue.magicmillions.com.au/sale/26GPR" target="_blank" title="View Online Catalogue"><i class="fas fa-book"></i> Catalogue</a></li></ul></div><div class="sales-list-year"><h2 class="sales-list-year-title">2025</h2><h3>April</h3><ul class="sales-list-month"><li><a href="https://www.magicmillions.com.au/calendar/2025-capricornia-yearling-sale/" title="View Sale Page"><span>13th</span> -- Capricornia Yearling Sale</a> | <a href="https://catalogue.magicmillions.com.au/sale/25RPR/0" target="_blank" title="View Online Catalogue"><i class="fas fa-book"></i> Catalogue</a></li><li><a href="https://www.magicmillions.com.au/calendar/2025-trnt-select-tried-horse-sale-alice-springs/" title="View Sale Page"><span>4th</span> -- TRNT Select Tried Horse Sale, Alice Springs</a></li></ul></div>`;

test("Magic Millions sales from their titles: the workbook's keys for the yearling sales, new keys for the rest", () => {
  const key = (t) => saleFromTitle(t)?.key ?? null;
  assert.deepEqual(saleFromTitle("2026 Gold Coast Yearling Sale"), { key: "MM-GC", name: "Magic Millions Gold Coast", type: "yearling", tier: 1, year: 2026, month: "2026-01" });
  assert.equal(key("2026 Gold Coast March Yearling Sale"), "MM-MARCH");
  assert.equal(key("2025 Gold Coast National Yearling Sale"), "MM-NAT");
  assert.equal(key("2025 Adelaide Yearling Sale"), "MM-ADL");
  assert.equal(key("2025 Perth Yearling Sale"), "MM-PER");
  assert.equal(key("2025 Perth Winter Yearling Sale"), "MM-PER-WINTER");
  assert.equal(key("2026 Tasmanian Yearling Sale"), "MM-TAS");
  assert.equal(key("2026 Capricornia Yearling Sale"), "MM-CAP");
  assert.equal(key("2026 Gold Coast National Weanling Sale"), "MM-WEAN");
  assert.equal(saleFromTitle("2026 Gold Coast National Weanling Sale").type, "foal");
  assert.equal(key("2025 Gold Coast National Broodmare Sale"), "MM-BROOD");
  assert.equal(key("2025 Gold Coast Horses In Training Sale"), "MM-2YO");
  assert.equal(key("2019 Gold Coast 2YOs In Training Sale"), "MM-2YO");
  assert.equal(key("2019 Gold Coast Summer Racehorse Sale"), "MM-RACE");
  assert.equal(key("2025 TRNT Select Tried Horse Sale, Darwin"), "MM-NT");
  assert.equal(key("2026 Perth Winter Weanling Sale"), "MM-PER-MIXED");
  assert.equal(key("2025 August Virtual Sale"), "MM-ONLINE");
  assert.equal(key("2023 Fundraiser for the Holland Family &#038; National Jockeys Trust"), null);
  assert.equal(saleFromTitle("Gold Coast Yearling Sale", { year: 2025, month: "2025-01" }).year, 2025);
  assert.equal(titleForCode("26GQR"), "2026 Gold Coast March Yearling Sale");
});

test("the sales list as sales with a catalogue, by year and month", () => {
  const sales = parseSalesList(LIST);
  assert.deepEqual(sales.map((s) => [s.id, s.title, s.month]), [
    ["26GWW", "2026 Gold Coast National Weanling Sale", "2026-05"],
    ["26GPR", "2026 Gold Coast Yearling Sale", "2026-01"],
    ["25RPR", "2025 Capricornia Yearling Sale", "2025-04"],
  ]);
});

test("a CSV read: quotes, doubled quotes, commas and line breaks inside them", () => {
  assert.deepEqual(parseCsv('\uFEFF"a","b, c","say ""hi"""\r\n"1","two\nlines",""\n'), [["a", "b, c", 'say "hi"'], ["1", "two\nlines", ""]]);
});

test("what a lot is and what became of it", () => {
  assert.equal(kindOf("Yearling", "yearling"), "yearling");
  assert.equal(kindOf("Weanling", "foal"), "foal");
  assert.equal(kindOf("2YO", "2yo"), "2yo");
  assert.equal(kindOf("3YO", "2yo"), "hit");
  assert.equal(kindOf("RF", "breeding"), "hit");
  assert.equal(kindOf("RH", "mixed"), "hit");
  assert.equal(kindOf("Broodmare", "breeding"), "breeding");
  assert.equal(kindOf("SH", "breeding"), null, "a share in a stallion is not a lot");
  assert.equal(kindOf("", "mixed"), null);
  assert.deepEqual(outcomeOf("David Ellis CNZM/Te Akau Racing", "500000"), { status: "sold", price: 500000, bid: null });
  assert.deepEqual(outcomeOf("Psd $100000 Res $120000", ""), { status: "rna", price: null, bid: 100000 });
  assert.deepEqual(outcomeOf("Psd Res $120000", ""), { status: "rna", price: null, bid: 120000 }, "no bid published: the reserve");
  assert.equal(outcomeOf("", "withdrawn").status, "withdrawn");
  assert.equal(outcomeOf("", "").status, "catalogued");
});

test("a yearling sale's export as lots: sold, passed in, withdrawn, still to come; AUD to sterling", () => {
  const out = parseResults(GPR26, { id: "26GPR", title: "2026 Gold Coast Yearling Sale", month: "2026-01" });
  assert.equal(out.sale.key, "MM-GC");
  assert.equal(out.lots.length, 5);
  const [sold, passed, withdrawn, sold2, toCome] = out.lots;
  assert.equal(sold.source, "magicmillions");
  assert.equal(sold.company, "Magic Millions");
  assert.equal(sold.sale_label, "26GPR");
  assert.equal(sold.region, "AUS");
  assert.equal(sold.year, 2026);
  assert.equal(sold.sale_month, "2026-01");
  assert.equal(sold.sale_type, "yearling");
  assert.equal(sold.lot, "1");
  assert.equal(sold.horse, null);
  assert.equal(sold.sire, "Snitzel");
  assert.equal(sold.sire_key, "SNITZEL");
  assert.equal(sold.dam_key, "YESTERJOY");
  assert.equal(sold.sex, "filly");
  assert.equal(sold.foaling_year, 2024);
  assert.equal(sold.vendor, "Baramul Stud, Widden Valley, NSW");
  assert.equal(sold.buyer, "David Ellis CNZM/Te Akau Racing");
  assert.equal(sold.status, "sold");
  assert.equal(sold.price, 500000);
  assert.equal(sold.currency, "AUD");
  assert.equal(sold.price_gbp, Math.round(convert(500000, "AUD", "GBP", "2026-01")));
  assert.ok(sold.price_gbp > 230000 && sold.price_gbp < 270000, `A$500,000 in January 2026 is about £250k, got ${sold.price_gbp}`);
  assert.equal(passed.status, "rna");
  assert.equal(passed.bid, 100000);
  assert.equal(passed.price, null);
  assert.equal(passed.buyer, null);
  assert.equal(passed.price_gbp, null);
  assert.equal(passed.sex, "colt");
  assert.equal(withdrawn.status, "withdrawn");
  assert.equal(withdrawn.bid, null);
  assert.equal(sold2.buyer, "Gai Waterhouse & Adrian Bott/Kestrel Thoroughbreds");
  assert.equal(toCome.status, "catalogued");
  assert.equal(toCome.price, null);
  // The house does not mark a lot sold after the ring, so no lot says it was.
  assert.ok(out.lots.every((l) => !("after_sale" in l)));
});

test("a breeding stock sale: broodmares are breeding stock, racing fillies horses in training, stallion shares left out", () => {
  const out = parseResults(GWM25, { id: "25GWM" });
  assert.equal(out.title, "2025 Gold Coast National Broodmare Sale", "the code's usual title when none is given");
  assert.equal(out.sale.key, "MM-BROOD");
  assert.equal(out.sale.month, "2025-05", "the month from the export's sale times");
  assert.deepEqual(out.lots.map((l) => [l.lot, l.sale_type, l.status]), [["401", "hit", "rna"], ["629", "breeding", "sold"]]);
  const [filly, mare] = out.lots;
  assert.equal(filly.horse, "Field of Daysees");
  assert.equal(filly.bid, 70000);
  assert.equal(mare.sex, "filly");
  assert.equal(mare.dam, "Duchess Kate");
  assert.equal(mare.foaling_year, 2018);
  assert.equal(mare.price, 85000);
});

test("the horses in training sale: two-year-olds, and older horses as horses in training", () => {
  const out = parseResults(GRT25, { id: "25GRT", title: "2025 Gold Coast Horses In Training Sale", month: "2025-10" });
  assert.equal(out.sale.key, "MM-2YO");
  assert.deepEqual(out.lots.map((l) => [l.lot, l.sale_type, l.status, l.price ?? l.bid, l.sex]), [
    ["1", "2yo", "rna", 10000, "colt"],
    ["3", "2yo", "sold", 50000, "colt"],
    ["185", "hit", "rna", 45000, "gelding"],
  ]);
  assert.equal(out.lots[2].horse, "Magic Merlin");
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
  const { impl, asked } = fakeFetch({ [SALES_LIST_URL]: LIST, [csvUrl("26GPR")]: GPR26, [csvUrl("26XXX")]: "<html>no such sale</html>" });
  const sales = await discover({ year: 2026, fetchImpl: impl });
  assert.deepEqual(sales.map((s) => [s.id, s.key, s.type, s.tier, s.month, s.year]), [
    ["26GWW", "MM-WEAN", "foal", 1, "2026-05", 2026],
    ["26GPR", "MM-GC", "yearling", 1, "2026-01", 2026],
  ]);
  const one = await fetchSale("26GPR", { fetchImpl: impl, pauseMs: 0 });
  assert.equal(one.title, "2026 Gold Coast Yearling Sale");
  assert.deepEqual(one.sale, { key: "MM-GC", name: "Magic Millions Gold Coast", type: "yearling", tier: 1, year: 2026, month: "2026-01" });
  assert.equal(one.lots.length, 5);
  assert.deepEqual(asked.slice(-2), [SALES_LIST_URL, csvUrl("26GPR")]);
  const before = asked.length;
  const viaInfo = await fetchSale("26GPR", { fetchImpl: impl, info: sales[1], pauseMs: 0 });
  assert.deepEqual(asked.slice(before), [csvUrl("26GPR")], "discover's entry saves reading the list again");
  assert.deepEqual(viaInfo.sale, one.sale);
  const none = await fetchSale("26XXX", { fetchImpl: impl, title: "2026 Gold Coast Yearling Sale", month: "2026-01" });
  assert.equal(none.lots.length, 0);
});
