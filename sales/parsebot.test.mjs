import test from "node:test";
import assert from "node:assert/strict";
import { isGap, saleOf, outcomeOf, parseSale, discover, fetchSale } from "./parsebot.mjs";

// As parse.bot gave them on 27 October 2026.
const orby = (lots, extra = {}) => ({
  venue_id: "3", sale_date: "2025-09-29", sale_end_date: "2025-09-30",
  sale_name: "Goffs Orby Yearling Sale (Book 1) 2025", sale_company: "GOFFS", total_lots: lots.length, lots, ...extra,
});
const PRESENT_DREAM = {
  lot_no: 181, lot_letter: null, horse_name: "PRESENT DREAM", sex: "F", age: 1, year_of_birth: 2024, colour: "B",
  sire_name: "Minzaal", dam_name: "In The Present", vendor: "From Railstown Stud", buyer: "Meadowview Stables", price: 40000, currency: "EUR",
};

test("a company a house feed reads is left to it", () => {
  for (const c of ["TATTERSALLS", "Tattersalls Ireland", "ARQANA", "KEENELAND", "FASIG-TIPTON", "OCALA", "BADEN-BADEN"]) assert.equal(isGap(c), false, c);
  for (const c of ["GOFFS", "GOFFS UK", "GOFFSGO", "OSARUS", "TATTERSALLS CHELTENHAM", "GORESBRIDGE", "SGA"]) assert.equal(isGap(c), true, c);
  assert.equal(isGap(""), false);
});

test("Goffs sales take the keys the workbook gives them", () => {
  assert.equal(saleOf({ sale_company: "GOFFS", sale_name: "Goffs Orby Yearling Sale (Book 1) 2025", sale_date: "2025-09-29" }).key, "GOF-ORBY");
  assert.equal(saleOf({ sale_company: "GOFFS", sale_name: "Goffs Orby Yearling Sale (Book 2) 2025", sale_date: "2025-10-01" }).key, "GOF-ORBY2");
  const prem = saleOf({ sale_company: "GOFFS UK", sale_name: "Doncaster Premier Yearlings Sale", sale_date: "2015-08-25" });
  assert.deepEqual([prem.key, prem.company, prem.year, prem.month], ["GUK-PREM", "Goffs UK", 2015, "2015-08"]);
  assert.equal(saleOf({ sale_company: "GOFFS", sale_name: "Goffs November Foal Sale 2025", sale_date: "2025-11-17" }).key, "GOF-FOAL");
  assert.equal(saleOf({ sale_company: "GOFFSGO", sale_name: "GoffsGo July 2025", sale_date: "2025-07-01" }).key, "GOF-ONLINE");
});

test("any other company's sales take a key by company and kind", () => {
  const osa = saleOf({ sale_company: "OSARUS", sale_name: "Osarus September Yearling Sale 2025", sale_date: "2025-09-09" });
  assert.deepEqual([osa.key, osa.name, osa.type, osa.company, osa.region], ["OSA-YRL", "Osarus September Yearling Sale", "yearling", "Osarus", "EU"]);
  assert.equal(saleOf({ sale_company: "OSARUS", sale_name: "Osarus Breeze-Up la Teste 2025", sale_date: "2025-04-09" }).key, "OSA-BRZ");
  assert.equal(saleOf({ sale_company: "TEXAS THOROUGHBRED ASSOCIATION", sale_name: "Texas Thoroughbred Association 2YOs in Training Sa", sale_date: "2025-04-01" }).key, "TTA-BRZ");
  const odd = saleOf({ sale_company: "Some New House", sale_name: "Spring Sale 2026", sale_date: "2026-03-01" }, "USD");
  assert.deepEqual([odd.key, odd.region], ["SNH-MIX", "US"]);
});

test("a National Hunt house's sales are jumps sales unless the name says flat", () => {
  assert.equal(saleOf({ sale_company: "TATTERSALLS CHELTENHAM", sale_name: "Tattersalls Cheltenham January Sale 2025" }).type, "jumps");
  assert.equal(saleOf({ sale_company: "THOROUGHBID", sale_name: "ThoroughBid January Sale 2025" }).type, "jumps");
  assert.equal(saleOf({ sale_company: "THOROUGHBID", sale_name: "Thoroughbid Flat Sale 2025" }).type, "mixed");
  assert.equal(saleOf({ sale_company: "AUCTAV.COM", sale_name: "Auctav January 2025 NH" }).type, "jumps");
  assert.equal(saleOf({ sale_company: "GOFFS", sale_name: "Goffs Arkle Sale 2025" }).type, "jumps");
});

test("what became of a lot, from the buyer column", () => {
  assert.deepEqual(outcomeOf("Meadowview Stables", 40000), { status: "sold", price: 40000, bid: null, buyer: "Meadowview Stables", afterSale: false });
  assert.deepEqual(outcomeOf("Vendor (60000)", null), { status: "rna", price: null, bid: 60000, buyer: null, afterSale: false });
  assert.equal(outcomeOf("Not Sold (45000)", 0).bid, 45000);
  assert.deepEqual(outcomeOf("Vendor (48000) / Form Bloodstock (PS)", 50000), { status: "sold", price: 50000, bid: null, buyer: "Form Bloodstock", afterSale: true });
  assert.equal(outcomeOf("Vendor (80000) / Peter & Ross Doyle Bloodstock (PS", 85000).buyer, "Peter & Ross Doyle Bloodstock", "cut inside (PS)");
  assert.equal(outcomeOf("Withdrawn", null).status, "withdrawn");
  assert.equal(outcomeOf("", null, false).status, "catalogued", "a sale still to come");
  assert.equal(outcomeOf("", null, true).status, "unknown");
});

test("a sale's lots in the shared shape", () => {
  const { sale, lots } = parseSale(orby([
    PRESENT_DREAM,
    { ...PRESENT_DREAM, lot_no: 6, horse_name: null, buyer: "Vendor (24000) / Aaron & Michael Leonard (PS)", price: 30000, dam_name: "Another" },
    { ...PRESENT_DREAM, lot_no: 7, buyer: "Withdrawn", price: null, dam_name: "Third" },
    { ...PRESENT_DREAM, lot_no: 8, buyer: "Vendor (60000)", price: null, sex: "C", dam_name: "Fourth" },
    { ...PRESENT_DREAM, lot_no: 9, dam_name: "" },
  ]), { today: "2026-10-27" });
  assert.equal(sale.id, "3/2025-09-29");
  assert.equal(lots.length, 4, "a lot without a dam is left out");
  const pd = lots[0];
  assert.deepEqual(
    [pd.source, pd.company, pd.sale_key, pd.sale_name, pd.sale_label, pd.year, pd.sale_month, pd.sale_type, pd.lot, pd.horse],
    ["parsebot", "Goffs", "GOF-ORBY", "Goffs Orby", "3/2025-09-29", 2025, "2025-09", "yearling", "181", "PRESENT DREAM"],
  );
  assert.deepEqual([pd.sire_key, pd.dam_key, pd.sex, pd.foaling_year, pd.vendor], ["MINZAAL", "IN THE PRESENT", "filly", 2024, "Railstown Stud"]);
  assert.deepEqual([pd.status, pd.buyer, pd.price, pd.currency, pd.after_sale], ["sold", "Meadowview Stables", 40000, "EUR", 0]);
  assert.ok(pd.price_gbp > 30000 && pd.price_gbp < 40000, "euros in sterling at the month's rate");
  assert.deepEqual([lots[1].status, lots[1].buyer, lots[1].after_sale], ["sold", "Aaron & Michael Leonard", 1]);
  assert.equal(lots[2].status, "withdrawn");
  assert.deepEqual([lots[3].status, lots[3].bid, lots[3].sex], ["rna", 60000, "colt"]);
});

test("a sale still to come is catalogued; another house's sale gives nothing", () => {
  const foal = parseSale(orby([{ ...PRESENT_DREAM, year_of_birth: 2026, age: 0, buyer: null, price: null }], { sale_date: "2026-11-16", sale_end_date: "2026-11-19", sale_name: "Goffs November Foal Sale 2026" }), { today: "2026-10-27" });
  assert.deepEqual([foal.lots[0].sale_type, foal.lots[0].status], ["foal", "catalogued"]);
  assert.deepEqual(parseSale(orby([PRESENT_DREAM], { sale_company: "TATTERSALLS" })).lots, []);
});

const answer = (data) => ({ ok: true, status: 200, text: async () => JSON.stringify({ status: "success", data }) });

test("discover lists the year's gap sales, leaving out other houses' and National Hunt sales", async () => {
  process.env.PARSE_API_KEY = "test-key";
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push([String(url), init.headers["X-API-Key"]]);
    return answer({ year: 2025, sales: [
      { venue_id: "3", sale_date: "2025-09-29", sale_name: "Goffs Orby Yearling Sale (Book 1) 2025", sale_company: "GOFFS", total_lots: 469 },
      { venue_id: "5", sale_date: "2025-10-07", sale_name: "Tattersalls October Yearling Sale (Book 1) 2025", sale_company: "TATTERSALLS", total_lots: 500 },
      { venue_id: "3", sale_date: "2025-06-10", sale_name: "Goffs Arkle Sale 2025", sale_company: "GOFFS", total_lots: 715 },
      { venue_id: "47", sale_date: "2025-04-09", sale_name: "Osarus Breeze-Up la Teste 2025", sale_company: "OSARUS", total_lots: 35 },
      { venue_id: "3", sale_date: "2025-12-01", sale_name: "Goffs Empty 2025", sale_company: "GOFFS", total_lots: 0 },
    ] });
  };
  const sales = await discover({ year: 2025, fetchImpl });
  assert.deepEqual(sales.map((s) => [s.id, s.key]), [["47/2025-04-09", "OSA-BRZ"], ["3/2025-09-29", "GOF-ORBY"]]);
  assert.match(seen[0][0], /list_sales_catalogues\?year=2025$/);
  assert.equal(seen[0][1], "test-key", "the key in a header");
  assert.ok(!seen[0][0].includes("test-key"), "never in the URL");
});

test("fetchSale reads one sale by venue and date", async () => {
  process.env.PARSE_API_KEY = "test-key";
  let asked = null;
  const out = await fetchSale("3/2025-09-29", { today: "2026-10-27", fetchImpl: async (url) => ((asked = String(url)), answer(orby([PRESENT_DREAM]))) });
  assert.match(asked, /get_sales_results\?venue_id=3&sale_date=2025-09-29$/);
  assert.deepEqual([out.id, out.sale.key, out.lots.length, out.lots[0].price], ["3/2025-09-29", "GOF-ORBY", 1, 40000]);
  await assert.rejects(fetchSale("orby-2025"), /venue\/date/);
});

test("a key parse.bot refuses is said plainly, and not tried three times", async () => {
  process.env.PARSE_API_KEY = "wrong";
  let calls = 0;
  const fetchImpl = async () => ((calls += 1), { ok: false, status: 401, text: async () => "{}" });
  await assert.rejects(discover({ year: 2025, fetchImpl }), /HTTP 401 .*PARSE_API_KEY/);
  assert.equal(calls, 1);
});

test("the Autumn Sale's first day: yearlings under the Autumn Yearlings, horses in training where they were", () => {
  const day1 = {
    venue_id: "3", sale_date: "2025-11-03", sale_end_date: "2025-11-03",
    sale_name: "Goffs Autumn HIT & Yearling Sale 2025", sale_company: "GOFFS",
    lots: [
      { lot_no: 12, horse_name: "Old Boy", sex: "G", year_of_birth: 2021, sire_name: "Kodiac", dam_name: "Mum", buyer: "A Buyer", price: 20000, currency: "EUR" },
      { lot_no: 210, sex: "C", year_of_birth: 2024, sire_name: "Mehmas", dam_name: "Yearling Dam", buyer: "B Buyer", price: 30000, currency: "EUR" },
      { lot_no: 211, sex: "F", sire_name: "Kodiac", dam_name: "No Age", buyer: "C Buyer", price: 9000, currency: "EUR" },
    ],
  };
  const { lots } = parseSale(day1, { today: "2026-01-01" });
  const byLot = Object.fromEntries(lots.map((l) => [l.lot, l]));
  assert.equal(byLot["12"].sale_type, "hit");
  assert.equal(byLot["12"].sale_key, "GOF-HIT");
  assert.equal(byLot["12"].sale_name, "Goffs Horses in Training");
  assert.equal(byLot["210"].sale_type, "yearling");
  assert.equal(byLot["210"].sale_key, "GOF-AUT");
  assert.equal(byLot["210"].sale_name, "Goffs Autumn Yearlings");
  // No age given: counted as before, with the horses in training.
  assert.equal(byLot["211"].sale_key, "GOF-HIT");
  assert.ok(lots.every((l) => l.sale_label === "3/2025-11-03"));
});
