import test from "node:test";
import assert from "node:assert/strict";
import { salesHistory } from "./salesTool.mjs";
import { runTool, TOOLS, systemPrompt } from "./agent.mjs";
import { describeTables } from "./tableNotes.mjs";

/** The yearling row the sire table gives Dubawi, as sales/metrics.mjs builds it. */
const DUBAWI_YEARLINGS = {
  sireKey: "DUBAWI",
  sire: "Dubawi",
  offered: 14, sold: 11, clearance: 0.786, aggregate: 6_900_000, average: 627_273, median: 520_000, top: 2_730_000,
  fee: 350_000, multiple: 1.49, share2x: 0.27, premium: 0.12, vsMarket: 1.8, trend: -0.1,
  firstYear: 2007, cropsInData: 18, young: false, verdict: "strong",
  byYear: {
    2024: { offered: 6, sold: 5, median: 600_000, average: 700_000, clearance: 0.833, fee: 350_000, multiple: 1.71 },
    2025: { offered: 4, sold: 3, median: 540_000, average: 560_000, clearance: 0.75, fee: 350_000, multiple: 1.54 },
    2026: { offered: 4, sold: 3, median: 520_000, average: 600_000, clearance: 0.75, fee: 350_000, multiple: 1.49 },
  },
};

const lot = (over) => ({
  source: "tattersalls", sale_key: "TOC1", sale_name: "October Yearling Sale Book 1", region: "EU",
  sale_type: "yearling", sire_key: "DUBAWI", dam_key: "SWEET LADY", sex: "c", status: "sold",
  after_sale: 0, price: 1_000_000, currency: "GNS", price_gbp: 1_050_000, year: 2026, lot: "100",
  ...over,
});

function fakeSales({ building = false } = {}) {
  const asked = [];
  const ready = () => {
    if (building) {
      const err = new Error("the sales figures are being built after a restart; try again in a minute or two");
      err.code = "SALES_BUILDING";
      throw err;
    }
  };
  const service = {
    async sire(name) {
      ready();
      asked.push(["sire", name]);
      const key = String(name).toUpperCase().replace(/\s*\(.*\)$/, "");
      if (key !== "DUBAWI") return { sireKey: key, tables: {}, hit: null, lots: [], builtAt: "t" };
      return {
        sireKey: "DUBAWI",
        builtAt: "2026-10-28T08:00:00Z",
        tables: {
          "yearling|ALL": { ...DUBAWI_YEARLINGS, years: [2024, 2025, 2026] },
          "yearling|EU": { ...DUBAWI_YEARLINGS, years: [2024, 2025, 2026] },
          "foal|ALL": { ...DUBAWI_YEARLINGS, sold: 2, years: [2024, 2025, 2026] },
        },
        hit: null,
        lots: [
          lot({ lot: "1", price_gbp: 2_730_000 }),
          lot({ lot: "2", price_gbp: 400_000 }),
          lot({ lot: "3", price_gbp: 900_000, year: 2025 }),
          lot({ lot: "4", sale_type: "foal", price_gbp: 1_200_000 }),
          lot({ lot: "5", region: "US", price_gbp: 3_000_000 }),
        ],
      };
    },
    async dam(name) {
      ready();
      return {
        damKey: String(name).toUpperCase(),
        lots: [
          { year: 2025, sale: "December Foal Sale", type: "foal", lot: "7", sire: "Dubawi", status: "sold", priceGbp: 400_000, ratio: 1.3 },
          { year: 2026, sale: "October Book 1", type: "yearling", lot: "100", sire: "Dubawi", status: "sold", priceGbp: 1_050_000, ratio: 2 },
        ],
        sold: 2, index: 1.5, basis: 2,
      };
    },
    async sires({ type, region }) {
      ready();
      asked.push(["sires", type, region]);
      return {
        type, region, years: [2024, 2025, 2026],
        rows: [
          { ...DUBAWI_YEARLINGS },
          { ...DUBAWI_YEARLINGS, sireKey: "FRANKEL", sire: "Frankel", aggregate: 9_000_000, premium: -0.05, sold: 18 },
          { ...DUBAWI_YEARLINGS, sireKey: "TINY", sire: "Tiny", aggregate: 10, premium: 0.9, sold: 2 },
        ],
      };
    },
    async market({ type, region }) {
      ready();
      asked.push(["market", type, region]);
      return {
        builtAt: "t",
        cells: [
          { type: "yearling", region: "EU", year: 2025, offered: 4000, sold: 3200, median: 50_000, change: null },
          { type: "yearling", region: "EU", year: 2026, offered: 4100, sold: 3300, median: 55_000, change: { median: 0.1 } },
        ],
        sales: [
          { type: "yearling", saleKey: "TOC1", saleName: "October Book 1", region: "EU", tier: 1, year: 2026, offered: 400, sold: 350, median: 160_000 },
          { type: "yearling", saleKey: "TOC1", saleName: "October Book 1", region: "EU", tier: 1, year: 2025, offered: 390, sold: 330, median: 150_000 },
        ],
      };
    },
  };
  return { asked, getSales: async () => service };
}

test("Dubawi's yearlings: the sire table's figures by year, and his dearest lots", async () => {
  const { getSales } = fakeSales();
  const out = await salesHistory({ sire: "Dubawi (IRE)", kind: "yearling" }, getSales);
  const body = JSON.parse(out.content);
  assert.equal(body.view, "sire");
  assert.deepEqual(Object.keys(body.byKind), ["yearling"], "only the kind asked for, and the all-regions table");
  const y = body.byKind.yearling;
  assert.equal(y.median, 520_000);
  assert.equal(y.multiple, 1.49);
  assert.deepEqual(y.window, [2024, 2025, 2026]);
  assert.equal(y.byYear[2024].median, 600_000);
  assert.deepEqual(body.topLots.map((l) => l.lot), ["5", "1", "3", "2"], "dearest first; the foal is left out");
  assert.equal(body.topLots[1].priceGbp, 2_730_000);
  assert.match(body.page, /SalesMarket/);
  assert.equal(body.note, undefined);
});

test("a region narrows both the table and the lots", async () => {
  const { getSales } = fakeSales();
  const body = JSON.parse((await salesHistory({ sire: "Dubawi", kind: "yearling", region: "eu" }, getSales)).content);
  assert.ok(body.byKind.yearling);
  assert.ok(body.topLots.every((l) => l.region === "EU"));
  assert.ok(!body.topLots.some((l) => l.lot === "5"));
});

test("a year narrows the lots listed, not the figures", async () => {
  const { getSales } = fakeSales();
  const body = JSON.parse((await salesHistory({ sire: "Dubawi", kind: "yearling", year: 2025 }, getSales)).content);
  assert.deepEqual(body.topLots.map((l) => l.lot), ["3"]);
  assert.equal(body.byKind.yearling.byYear[2026].median, 520_000);
});

test("a sire with nothing held says so and says how names are keyed", async () => {
  const { getSales } = fakeSales();
  const body = JSON.parse((await salesHistory({ sire: "Dubowi" }, getSales)).content);
  assert.deepEqual(body.byKind, {});
  assert.match(body.note, /No lots held by "DUBOWI"/);
});

test("a dam's produce in the ring, each against her sire's median", async () => {
  const { getSales } = fakeSales();
  const body = JSON.parse((await salesHistory({ dam: "Sweet Lady", kind: "yearling" }, getSales)).content);
  assert.equal(body.view, "dam");
  assert.equal(body.lots.length, 1);
  assert.equal(body.index, 1.5);
});

test("the sire table ranked, with the thin sires left out", async () => {
  const { getSales, asked } = fakeSales();
  const body = JSON.parse((await salesHistory({ view: "sires", kind: "yearling", region: "EU", sort: "premium" }, getSales)).content);
  assert.deepEqual(asked.at(-1), ["sires", "yearling", "EU"]);
  assert.deepEqual(body.rows.map((r) => r.sire), ["Dubawi", "Frankel"], "Tiny has two sold, under the default of five");
  assert.equal(body.rows[0].byYear, undefined, "a ranked table does not carry every sire's every year");
  const worst = JSON.parse((await salesHistory({ view: "sires", sort: "premium", order: "asc" }, getSales)).content);
  assert.equal(worst.rows[0].sire, "Frankel");
});

test("the market by year, and the sales of the latest year unless one is asked for", async () => {
  const { getSales } = fakeSales();
  const body = JSON.parse((await salesHistory({ view: "market", kind: "yearling", region: "EU" }, getSales)).content);
  assert.equal(body.byYear.length, 2);
  assert.equal(body.salesOf, 2026);
  assert.deepEqual(body.sales.map((s) => s.year), [2026]);
  const y2025 = JSON.parse((await salesHistory({ view: "market", kind: "yearling", year: 2025 }, getSales)).content);
  assert.deepEqual(y2025.sales.map((s) => s.year), [2025]);
});

test("figures still being built after a restart are a readable step, not a crash", async () => {
  const { getSales } = fakeSales({ building: true });
  const out = await salesHistory({ sire: "Dubawi" }, getSales);
  assert.equal(out.is_error, true);
  assert.match(out.content, /being rebuilt/);
  assert.match(out.content, /sale_lots/);
});

test("without the service the tool fails with a sentence, through runTool", async () => {
  const out = await runTool({ name: "sales_history", input: { sire: "Dubawi" } }, { db: null, allowedTables: [] });
  assert.equal(out.is_error, true);
  assert.match(out.content, /not reachable/);
});

test("runTool hands the service to the tool", async () => {
  const { getSales } = fakeSales();
  const out = await runTool({ name: "sales_history", input: { sire: "Dubawi", kind: "yearling" } }, { db: null, allowedTables: [], sales: getSales });
  assert.equal(JSON.parse(out.content).byKind.yearling.median, 520_000);
  assert.ok(out.meta.rowCount > 0);
});

test("the tool is offered, and the brief sends sale questions to it before the web", () => {
  const t = TOOLS.find((x) => x.name === "sales_history");
  assert.ok(t);
  assert.match(t.description, /yearling/);
  const brief = systemPrompt({ userId: "x", today: "2026-10-28" });
  assert.match(brief, /Sale prices come from sales_history/);
  assert.match(brief, /before going to the web/);
  assert.match(brief, /foalSale_\* tables are a single older foal catalogue/);
});

test("sale_lots is described, and marked large", () => {
  const [row] = describeTables(["sale_lots"]);
  assert.match(row.note, /sire_key/);
  assert.equal(row.large, true);
  const [old] = describeTables(["foalSale_Sales"]);
  assert.match(old.note, /Not the sales record/);
});
