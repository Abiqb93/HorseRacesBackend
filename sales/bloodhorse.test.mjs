import test from "node:test";
import assert from "node:assert/strict";
import { isGap, companyOf, regionOf, saleOf, kindOf, outcomeOf, parseLots, idOfLink, discover, fetchSale, pruneJumps, JUMPS_SQL } from "./bloodhorse.mjs";
import { lastResort, damRecord } from "./metrics.mjs";

// As BloodHorse gave them through parse.bot (30 October 2026).
const DRAGON_BALDR = {
  sale_code: "JRHJUL2025", hip: "1", lot_type: "Yearling", name: "Dragon Baldr (JPN)", sex: "C", year_of_birth: 2024,
  sire: "Contrail (JPN)", dam: "Mecha Corta (ARG)", dam_sire: "El Corredor", cover_sire: null,
  consignor: "Northern Farm", buyer: "Yoshiro Kubota", price_usd: 1942950, price_text: "$1,942,950", status: "Sold",
};
const JRHA = { ...saleOf({ name: "JRHA Select Yearling & Foal Sale 2025", code: "JRHJUL", year: 2025, month: "July" }), id: "2025/10303/jrha-select-yearling-foal-sale-2025", region: "JPN" };

test("only the sales no other feed reads are this feed's", () => {
  for (const n of ["JRHA Select Yearling & Foal Sale 2025", "New Zealand Bloodstock Karaka Yearling Sale 2025 (Books 1 & 2)", "Jockey Club of Saudi Arabia Yearling Sale 2025", "Minnesota Thoroughbred Association Yearling & Mixed Sale 2025"]) assert.equal(isGap(n), true, n);
  for (const n of ["Brightwells Bloodstock 2015 Cheltenham January Bloodstock Sale", "Goffs UK Doncaster Spring Store Sale 2016"]) assert.equal(isGap(n), false, `${n}: a jumps sale`);
  for (const n of ["Keeneland September Yearling Sale 2025", "Fasig-Tipton Saratoga Sale 2025", "Tattersalls October Yearling Sale Book 1 2025", "Goffs Ireland Orby Sale 2025 (Book 1)", "Arqana August Yearling Sale 2025", "Ocala Breeders' Sales Co. Winter Mixed Sale 2025", "Baden-Baden Sales and Racing Festival 2025", "Osarus September Yearling Sale 2025", "Canadian Thoroughbred Horse Society Yearling Sale 2025"]) assert.equal(isGap(n), false, n);
});

test("a sale's identity: a key of its own, its company, its market and month", () => {
  assert.deepEqual([JRHA.key, JRHA.name, JRHA.company, JRHA.tier, JRHA.year, JRHA.month], ["BH-JRHJUL", "JRHA Select Yearling & Foal Sale", "JRHA", 1, 2025, "2025-07"]);
  assert.equal(companyOf("New Zealand Bloodstock National Weanling Sale 2025"), "New Zealand Bloodstock");
  assert.equal(companyOf("ITOBA Dispersal for the Estate of Jim Edgar 2025"), "Indiana TOBA");
  assert.equal(regionOf("Japan, JPN"), "JPN");
  assert.equal(regionOf("New Zealand, NZ"), "NZ");
  assert.equal(regionOf("Indiana, USA"), "US");
  assert.equal(regionOf("Saudi Arabia, KSA"), "KSA");
});

test("what a lot is, from BloodHorse's lot type", () => {
  assert.equal(kindOf("Yearling", 1), "yearling");
  assert.equal(kindOf("Weanling", 1), "foal", "a southern weanling sold in June is a year old by the calendar");
  assert.equal(kindOf("Two-year-old", 2), "2yo");
  assert.equal(kindOf("Broodmare / Racing Prospect", 5), "breeding");
  assert.equal(kindOf("Racing prospect", 3), "hit");
  assert.equal(kindOf("Stallion", 8), null);
});

test("what became of a lot: sold at its price, bought back at its last bid", () => {
  assert.deepEqual(outcomeOf(DRAGON_BALDR), { status: "sold", price: 1942950, bid: null });
  assert.deepEqual(outcomeOf({ status: "RNA", price_text: "($70,226)" }), { status: "rna", price: null, bid: 70226 });
  assert.deepEqual(outcomeOf({ status: "RNA", price_text: "(-)" }), { status: "rna", price: null, bid: null });
});

test("a session's lots in the shared shape, in dollars and sterling", () => {
  const [l] = parseLots([DRAGON_BALDR, { ...DRAGON_BALDR, dam: "" }], JRHA);
  assert.deepEqual(
    [l.source, l.company, l.sale_key, l.sale_label, l.region, l.year, l.sale_month, l.sale_type, l.lot, l.horse],
    ["bloodhorse", "JRHA", "BH-JRHJUL", "2025/10303/jrha-select-yearling-foal-sale-2025", "JPN", 2025, "2025-07", "yearling", "1", "Dragon Baldr (JPN)"],
  );
  assert.deepEqual([l.sire_key, l.dam_key, l.sex, l.foaling_year, l.vendor, l.buyer], ["CONTRAIL", "MECHA CORTA", "colt", 2024, "Northern Farm", "Yoshiro Kubota"]);
  assert.deepEqual([l.status, l.price, l.currency], ["sold", 1942950, "USD"]);
  assert.ok(l.price_gbp > 1_000_000 && l.price_gbp < 1_942_950, "dollars in sterling at the month's rate");
  const [rna] = parseLots([{ ...DRAGON_BALDR, status: "RNA", price_usd: null, price_text: "($15,097)", buyer: "S. T. Kann", name: "UNNAMED" }], JRHA);
  assert.deepEqual([rna.status, rna.bid, rna.buyer, rna.horse], ["rna", 15097, null, null]);
});

test("a BloodHorse lot stands only where no other source holds the horse", () => {
  const lot = (o) => ({ company: "New Zealand Bloodstock", year: 2025, dam_key: "ILLADORE", sire_key: "SWORD OF STATE", ...o });
  const { lots, dropped } = lastResort([
    lot({ source: "aus-nz-master", company: "NZB", currency: "NZD" }),
    lot({ source: "bloodhorse", currency: "USD" }),
    lot({ source: "bloodhorse", dam_key: "ANOTHER MARE" }),
  ], new Set(["bloodhorse"]));
  assert.equal(dropped, 1);
  assert.deepEqual(lots.map((l) => [l.source, l.dam_key]), [["aus-nz-master", "ILLADORE"], ["bloodhorse", "ANOTHER MARE"]]);
});

test("a dam's record gives each lot's year of birth", () => {
  const rec = damRecord([{ dam_key: "MECHA CORTA", sale_type: "yearling", year: 2025, sale_name: "JRHA Select Yearling & Foal Sale", foaling_year: 2024, status: "sold", price_gbp: 1438780, region: "JPN" }], "MECHA CORTA");
  assert.equal(rec.lots[0].foaled, 2024);
});

test("rows of jumps sales read earlier are removed, and only this feed's", async () => {
  let sql = null, params = null;
  const gone = await pruneJumps(async (s, p) => ((sql = s), (params = p), { affectedRows: 354 }));
  assert.equal(gone, 354);
  assert.match(sql, /DELETE FROM sale_lots WHERE source = 'bloodhorse' AND LOWER\(sale_name\) REGEXP \?/);
  assert.deepEqual(params, [JUMPS_SQL]);
  for (const n of ["brightwells bloodstock cheltenham january bloodstock sale", "goffs uk doncaster spring store sale"]) assert.match(n, new RegExp(JUMPS_SQL));
  assert.doesNotMatch("jrha select yearling & foal sale", new RegExp(JUMPS_SQL));
});

const answer = (data) => ({ ok: true, status: 200, text: async () => JSON.stringify({ status: "success", data }) });

test("discover lists the year's sales no other feed reads, by their BloodHorse id", async () => {
  process.env.PARSE_API_KEY = "test-key";
  const link = (id, slug) => `https://www.bloodhorse.com/horse-racing/thoroughbred-sales/results/2025/${id}/${slug}/1`;
  const fetchImpl = async () => answer({ year: "2025", sales: [
    { sale_id: "10303", name: "JRHA Select Yearling & Foal Sale 2025", link: link(10303, "jrha-select-yearling-foal-sale-2025"), code: "JRHJUL", month: "July", sale_type: "mixed" },
    { sale_id: "10310", name: "Goffs Ireland Orby Sale 2025 (Book 1)", link: link(10310, "goffs-ireland-orby-sale-2025-book-1"), code: "GOFORB", month: "September", sale_type: "yearling" },
  ] });
  const sales = await discover({ year: 2025, fetchImpl });
  assert.deepEqual(sales.map((s) => [s.id, s.key, s.month]), [["2025/10303/jrha-select-yearling-foal-sale-2025", "BH-JRHJUL", "2025-07"]]);
  assert.equal(idOfLink(link(10303, "x")), "2025/10303/x");
});

test("fetchSale reads every session of a sale", async () => {
  process.env.PARSE_API_KEY = "test-key";
  const asked = [];
  const fetchImpl = async (url) => {
    const u = new URL(String(url));
    asked.push(u.searchParams.get("url"));
    const session = Number(u.searchParams.get("url").split("/").pop());
    return answer({ sale_name: "JRHA Select Yearling & Foal Sale 2025", sale_dates: "Monday, July 14 - Tuesday, July 15, 2025", location: "Japan, JPN", sessions: [1, 2],
      lots: [{ ...DRAGON_BALDR, hip: String(session), lot_type: session === 2 ? "Weanling" : "Yearling", year_of_birth: session === 2 ? 2025 : 2024 }] });
  };
  const out = await fetchSale("2025/10303/jrha-select-yearling-foal-sale-2025", { fetchImpl });
  assert.equal(asked.length, 2);
  assert.match(asked[1], /\/2025\/10303\/jrha-select-yearling-foal-sale-2025\/2$/);
  assert.deepEqual([out.sale.key, out.sale.month, out.sale.region], ["BH-JRHJUL", "2025-07", "JPN"]);
  assert.deepEqual(out.lots.map((l) => [l.lot, l.sale_type]), [["1", "yearling"], ["2", "foal"]]);
  await assert.rejects(fetchSale("jrha-2025"), /year\/id\/slug/);
});
