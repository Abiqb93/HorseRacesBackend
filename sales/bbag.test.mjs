import { test } from "node:test";
import assert from "node:assert/strict";
import { saleFromTitle, parseId, euros, outcomeOf, kindOf, parseLots, discover, fetchSale } from "./bbag.mjs";

/* Fixtures: lots trimmed from the house's own archive search (bbag-sales.de/archiv~de_DE, get/advanced/search/result), fields cut to those read. */

// Jährlings-Auktion 2025 (auction 82): sold, bought back, not sold, withdrawn.
const YEARLINGS_2025 = [
  { horseAuctionDataID: 18047, auctionID: 82, lotNumber: 1, inFoalTo: null, lastServed: "", horseName: "Neue Welt", horseGender: "Stute", horseBirthdate: "2024", motherName: "Namika", fatherName: "Waldpfad", foalToName: null, auctionName: "Jährlings-Auktion 2025", auctionDateStart: 1757052000, resultType: "verkauft", result: "4.000", agentName: "Schnitzel Bloodstock", sellerName: "Gestüt am Schlossgarten" },
  { horseAuctionDataID: 18375, auctionID: 82, lotNumber: 2, inFoalTo: null, lastServed: "", horseName: "Nouveaute", horseGender: "Stute", horseBirthdate: "2024", motherName: "Nania", fatherName: "Counterattack (AUS)", foalToName: null, auctionName: "Jährlings-Auktion 2025", auctionDateStart: 1757052000, resultType: "zurückgekauft", result: "12.000", agentName: null, sellerName: "Gestüt Karlshof" },
  { horseAuctionDataID: 18007, auctionID: 82, lotNumber: 13, inFoalTo: null, lastServed: "", horseName: "N.N. (IRE)", horseGender: "Stute", horseBirthdate: "2024", motherName: "Amerique", fatherName: "Holy Roman Emperor (IRE)", foalToName: null, auctionName: "Jährlings-Auktion 2025", auctionDateStart: 1757052000, resultType: "nicht verkauft", result: "24.000", agentName: null, sellerName: "Gestüt Westerberg Consignment" },
  { horseAuctionDataID: 18182, auctionID: 82, lotNumber: 19, inFoalTo: null, lastServed: "", horseName: "Der da auch", horseGender: "Hengst", horseBirthdate: "2024", motherName: "Diska", fatherName: "Japan (GB)", foalToName: null, auctionName: "Jährlings-Auktion 2025", auctionDateStart: 1757052000, resultType: "zurückgezogen", result: "0", agentName: null, sellerName: "Gestüt Etzean (Agent)" },
];

// Sales & Racing Festival 2025 (auction 84): a mare in foal, a broodmare the house lists as one, a filly in training, a foal, a yearling, a two-year-old.
const AUTUMN_2025 = [
  { horseAuctionDataID: 18681, auctionID: 84, lotNumber: 204, inFoalTo: "Japan (GB)", lastServed: "30.04.2025", horseName: "Sword Spirit (IRE)", horseGender: "Stute", horseBirthdate: "2017", motherName: "Swordhalf (GB)", fatherName: "Charm Spirit (IRE)", foalToName: "Japan (GB)", auctionName: "Sales & Racing Festival 2025", auctionDateStart: 1760684400, resultType: "verkauft", result: "6.500", agentName: "Tobias Theis", sellerName: "Gestüt Etzean (Agent)" },
  { horseAuctionDataID: 18497, auctionID: 84, lotNumber: 207, inFoalTo: null, lastServed: "", horseName: "Wilddrossel", horseGender: "Stute", horseBirthdate: "2009", motherName: "Wild Side", fatherName: "Dalakhani (IRE)", foalToName: null, auctionName: "Sales & Racing Festival 2025", auctionDateStart: 1760684400, resultType: "verkauft", result: "5.500", agentName: "Steffen Zenthöfer", sellerName: "Gestüt Etzean (Agent)" },
  { horseAuctionDataID: 18475, auctionID: 84, lotNumber: 2, inFoalTo: null, lastServed: "", horseName: "Tough Lioness (FR)", horseGender: "Stute", horseBirthdate: "2022", motherName: "Troiecat (FR)", fatherName: "Persian King (IRE)", foalToName: null, auctionName: "Sales & Racing Festival 2025", auctionDateStart: 1760684400, resultType: "verkauft", result: "3.000", agentName: "i.A. Albrecht", sellerName: "GTM GmbH (Agent)" },
  { horseAuctionDataID: 18515, auctionID: 84, lotNumber: 201, inFoalTo: null, lastServed: "", horseName: "Irish Fox", horseGender: "Hengst", horseBirthdate: "2025", motherName: "Irish Valley", fatherName: "Guiliani (IRE)", foalToName: null, auctionName: "Sales & Racing Festival 2025", auctionDateStart: 1760684400, resultType: "zurückgezogen", result: "0", agentName: null, sellerName: "Gestüt Hofgut Heymann" },
  { horseAuctionDataID: 18723, auctionID: 84, lotNumber: 52, inFoalTo: null, lastServed: "", horseName: "Tex Rubber", horseGender: "Hengst", horseBirthdate: "2024", motherName: "Tech Exceed", fatherName: "Rubaiyat (FR)", foalToName: null, auctionName: "Sales & Racing Festival 2025", auctionDateStart: 1760684400, resultType: "verkauft", result: "19.000", agentName: "HFTB Racing Agency pres. Cometica AG", sellerName: "Gestüt Wittekindshof" },
  { horseAuctionDataID: 18605, auctionID: 84, lotNumber: 3, inFoalTo: null, lastServed: "", horseName: "N.N. (IRE)", horseGender: "Stute", horseBirthdate: "2023", motherName: "Viking Rose (IRE)", fatherName: "Soldier's Call (GB)", foalToName: null, auctionName: "Sales & Racing Festival 2025", auctionDateStart: 1760684400, resultType: "verkauft", result: "7.000", agentName: "i.A. Jurankova für PP Zamrsk", sellerName: "jurankova.com" },
];
// The house's own broodmares for that sale (horseType=motherMares), by id.
const AUTUMN_2025_MARES = new Set([18681, 18497]);

// Frühjahrs-Auktion 2025 (auction 81): a breeze-up two-year-old and an older horse.
const SPRING_2025 = [
  { horseAuctionDataID: 18057, auctionID: 81, lotNumber: 5, inFoalTo: null, lastServed: "", horseName: "N.N. (IRE)", horseGender: "Stute", horseBirthdate: "2023", motherName: "Golden Dawn (IRE)", fatherName: "Elzaam (AUS)", foalToName: null, auctionName: "Frühjahrs-Auktion 2025", auctionDateStart: 1748588400, resultType: "verkauft", result: "2.500", agentName: "EBM für Bellemere Racing", sellerName: "Molett Bloodstock" },
  { horseAuctionDataID: 18123, auctionID: 81, lotNumber: 9, inFoalTo: null, lastServed: "", horseName: "Independence", horseGender: "Stute", horseBirthdate: "2022", motherName: "Illiana", fatherName: "Protectionist", foalToName: null, auctionName: "Frühjahrs-Auktion 2025", auctionDateStart: 1748588400, resultType: "zurückgekauft", result: "9.500", agentName: null, sellerName: "Gestüt Sommerberg" },
];

test("BBAG sales from the house's names for them", () => {
  assert.deepEqual(saleFromTitle("Jährlings-Auktion 2025", 1757052000), { key: "BBAG-PREM", name: "BBAG Premier Yearlings", type: "yearling", tier: 2, year: 2025, month: "2025-09" });
  assert.equal(saleFromTitle("Jährlings-Auktion 2024", 1725004800).month, "2024-08", "the 2024 sale opened on 30 August");
  assert.equal(saleFromTitle("Frühjahrs-Auktion 2025").key, "BBAG-SPRING");
  assert.equal(saleFromTitle("Frühjahrs-Auktion 2025").month, "2025-05");
  assert.equal(saleFromTitle("Sales & Racing Festival 2025", 1760684400).key, "BBAG-AUT");
  assert.equal(saleFromTitle("Herbst-Auktion 2014").key, "BBAG-AUT");
  assert.equal(saleFromTitle("August Online Auktion 2025").key, "BBAG-OTHER");
  assert.equal(saleFromTitle("Christmas Online-Sale 2025", 1763899200).month, "2025-11");
  assert.equal(saleFromTitle(""), null);
  assert.deepEqual(parseId("2025/Jährlings-Auktion"), { year: 2025, type: "Jährlings-Auktion" });
  assert.deepEqual(parseId("2026/Sales & Racing Festival"), { year: 2026, type: "Sales & Racing Festival" });
  assert.equal(parseId("82"), null);
});

test("prices and outcomes as the house writes them", () => {
  assert.equal(euros("4.000"), 4000);
  assert.equal(euros("1.250.000"), 1250000);
  assert.equal(euros("12.000,00"), 12000);
  assert.equal(euros("0"), null);
  assert.equal(euros(null), null);
  assert.equal(outcomeOf("verkauft"), "sold");
  assert.equal(outcomeOf("zurückgekauft"), "rna");
  assert.equal(outcomeOf("nicht verkauft"), "rna");
  assert.equal(outcomeOf("zurückgezogen"), "withdrawn");
  assert.equal(outcomeOf(""), "catalogued");
  assert.equal(outcomeOf(null), "catalogued");
});

test("what a lot is, from its age and the house's broodmares", () => {
  const autumn = saleFromTitle("Sales & Racing Festival 2025", 1760684400);
  const spring = saleFromTitle("Frühjahrs-Auktion 2025", 1748588400);
  const [inFoal, mare, filly, foal, yearling, twoYearOld] = AUTUMN_2025;
  assert.equal(kindOf(inFoal, autumn), "breeding", "sold in foal");
  assert.equal(kindOf(mare, autumn, AUTUMN_2025_MARES), "breeding", "one of the house's broodmares");
  assert.equal(kindOf(mare, autumn), "hit", "without the house's list an older mare reads as in training");
  assert.equal(kindOf(filly, autumn, AUTUMN_2025_MARES), "hit");
  assert.equal(kindOf(foal, autumn), "foal");
  assert.equal(kindOf(yearling, autumn), "yearling");
  assert.equal(kindOf(twoYearOld, autumn), "hit", "a two-year-old in October is in training");
  assert.equal(kindOf(SPRING_2025[0], spring), "2yo", "a two-year-old at the spring breeze-up");
  assert.equal(kindOf(SPRING_2025[1], spring), "hit");
});

test("a yearling sale's lots: sold, bought back, not sold, withdrawn", () => {
  const out = parseLots(YEARLINGS_2025);
  assert.equal(out.title, "Jährlings-Auktion 2025");
  assert.equal(out.auctionId, 82);
  assert.equal(out.sale.key, "BBAG-PREM");
  assert.equal(out.lots.length, 4);
  const [sold, bought, unsold, wd] = out.lots;
  assert.equal(sold.source, "bbag");
  assert.equal(sold.company, "BBAG");
  assert.equal(sold.sale_label, "BBAG82");
  assert.equal(sold.sale_tier, 2);
  assert.equal(sold.region, "EU");
  assert.equal(sold.year, 2025);
  assert.equal(sold.sale_month, "2025-09");
  assert.equal(sold.sale_type, "yearling");
  assert.equal(sold.lot, "1");
  assert.equal(sold.horse, "Neue Welt");
  assert.equal(sold.sire, "Waldpfad");
  assert.equal(sold.sire_key, "WALDPFAD");
  assert.equal(sold.dam, "Namika");
  assert.equal(sold.sex, "filly");
  assert.equal(sold.foaling_year, 2024);
  assert.equal(sold.vendor, "Gestüt am Schlossgarten");
  assert.equal(sold.buyer, "Schnitzel Bloodstock");
  assert.equal(sold.status, "sold");
  assert.equal(sold.price, 4000);
  assert.equal(sold.bid, null);
  assert.equal(sold.currency, "EUR");
  assert.ok(sold.price_gbp > 3300 && sold.price_gbp < 3700, `€4,000 in September 2025 is about £3,475, got ${sold.price_gbp}`);
  assert.equal(sold.after_sale, undefined, "the house marks no lot as sold after the ring");
  assert.equal(bought.status, "rna");
  assert.equal(bought.bid, 12000);
  assert.equal(bought.price, null);
  assert.equal(bought.price_gbp, null);
  assert.equal(bought.buyer, null);
  assert.equal(bought.sire, "Counterattack", "the country is left off the name");
  assert.equal(bought.sire_key, "COUNTERATTACK");
  assert.equal(unsold.status, "rna");
  assert.equal(unsold.bid, 24000);
  assert.equal(unsold.horse, null, "N.N. is an unnamed horse");
  assert.equal(wd.status, "withdrawn");
  assert.equal(wd.sex, "colt");
  assert.equal(wd.bid, null);
});

test("a mixed sale's lots, with the house's broodmares", () => {
  const out = parseLots(AUTUMN_2025, { mares: AUTUMN_2025_MARES });
  assert.equal(out.sale.key, "BBAG-AUT");
  assert.equal(out.sale.month, "2025-10");
  assert.deepEqual(out.lots.map((l) => l.sale_type), ["breeding", "breeding", "hit", "foal", "yearling", "hit"]);
  assert.equal(out.lots[0].horse, "Sword Spirit");
  assert.equal(out.lots[0].price, 6500);
  assert.equal(out.lots[3].status, "withdrawn");
  assert.equal(out.lots[3].foaling_year, 2025);
  assert.equal(out.lots[4].buyer, "HFTB Racing Agency pres. Cometica AG");
});

test("a sale not yet held reads as catalogued", () => {
  // The house's archive has no sale before it is held; this is a 2025 lot with its outcome cleared, as a lot reads before the ring.
  const ahead = { ...YEARLINGS_2025[0], resultType: "", result: "0", agentName: null };
  const [lot] = parseLots([ahead]).lots;
  assert.equal(lot.status, "catalogued");
  assert.equal(lot.price, null);
  assert.equal(lot.buyer, null);
});

/** A stand-in for fetch: the archive page, its JSON interface, pages of a sale. */
function fakeFetch({ types, sales }) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const u = new URL(url);
    const req = u.searchParams.get("request");
    const form = init.body instanceof FormData ? Object.fromEntries([...init.body.entries()]) : {};
    calls.push({ req, form, offset: Number(u.searchParams.get("offset") ?? 0) });
    if (!req) return new Response(`<body data-csrf-token="abc123">`, { status: 200 });
    if (req.endsWith("get/auctions/data")) return Response.json({ auctionYears: ["2026", "2025"], auctionTypes: types });
    const list = (sales[`${form["auctionYear[]"]}/${form["auctionType[]"]}${form.horseType ? `/${form.horseType}` : ""}`] ?? []).slice(Number(u.searchParams.get("offset") ?? 0));
    return Response.json({ list: list.slice(0, 400) });
  };
  return { impl, calls };
}

test("fetching a sale: every page, then the house's broodmares", async () => {
  // 450 lots, so the sale comes in two pages of the house's 400 (copies of a real lot, numbered on).
  const many = Array.from({ length: 450 }, (_, i) => ({ ...AUTUMN_2025[4], horseAuctionDataID: 90000 + i, lotNumber: i + 1 }));
  many[0] = { ...AUTUMN_2025[1], lotNumber: 1 };
  const { impl, calls } = fakeFetch({
    types: ["Sales & Racing Festival"],
    sales: { "2025/Sales & Racing Festival": many, "2025/Sales & Racing Festival/motherMares": [AUTUMN_2025[1]] },
  });
  const out = await fetchSale("2025/Sales & Racing Festival", { fetchImpl: impl, pauseMs: 0 });
  assert.equal(out.lots.length, 450);
  assert.equal(out.sale.key, "BBAG-AUT");
  assert.equal(out.lots[0].sale_type, "breeding");
  assert.equal(out.lots[0].sale_label, "BBAG84");
  const searches = calls.filter((c) => c.req?.includes("advanced/search"));
  assert.deepEqual(searches.map((c) => [c.offset, c.form.horseType ?? null]), [[0, null], [400, null], [0, "motherMares"]]);
  assert.equal(searches[0].form.csrfToken, "abc123");
});

test("discovering a year's sales: each of the house's sale types, where it holds lots", async () => {
  const { impl } = fakeFetch({
    types: ["Frühjahrs-Auktion", "Jährlings-Auktion", "Christmas Online-Sale"],
    sales: { "2025/Frühjahrs-Auktion": SPRING_2025, "2025/Jährlings-Auktion": YEARLINGS_2025 },
  });
  const sales = await discover({ year: 2025, fetchImpl: impl, pauseMs: 0 });
  assert.deepEqual(sales.map((s) => [s.id, s.key, s.month, s.auctionId]), [["2025/Frühjahrs-Auktion", "BBAG-SPRING", "2025-05", 81], ["2025/Jährlings-Auktion", "BBAG-PREM", "2025-09", 82]]);
  assert.equal(sales[1].title, "Jährlings-Auktion 2025");
  assert.deepEqual(await discover({ year: 2019, fetchImpl: impl, pauseMs: 0 }), [], "a year the archive does not hold");
});
