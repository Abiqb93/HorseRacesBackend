/**
 * BlandfordAI's view of the sale results: every lot of every sale held,
 * read through the same in-memory index the Sales Market page draws.
 *
 * (28 October 2026: a question for Dubawi's yearling sales history came back
 * "the platform doesn't hold yearling sale results by sire". It does: the
 * sale_lots table and the sales service behind /api/sales/*. Neither was in
 * the assistant's reach, so it read the old foalSale_* tables, found four
 * lots by Dubawi Legend, and went to the web.)
 *
 * Going through the service rather than leaving the model to write SQL on
 * sale_lots means the medians, clearance rates and price-over-fee figures it
 * quotes are the ones the page shows, worked out the same way: offered lots
 * counted through the ring, buy-backs as offered and not sold, prices in
 * sterling, fees taken from the covering year. The table is readable too, for
 * the questions the service does not answer (buyers, vendors, one sale's
 * lots), but this is the first place to look.
 */

export const SALE_KINDS = ["foal", "yearling", "2yo", "hit"];
export const SALE_REGIONS = ["EU", "US", "AUS", "NZ"];

const MAX_LOTS = 100;
const DEFAULT_LOTS = 25;
const MAX_SIRES = 100;
const DEFAULT_SIRES = 25;
const MAX_SALES = 60;

const kindOf = (v) => (SALE_KINDS.includes(String(v ?? "").toLowerCase()) ? String(v).toLowerCase() : null);
const regionOf = (v) => (SALE_REGIONS.includes(String(v ?? "").toUpperCase()) ? String(v).toUpperCase() : null);
const yearOf = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 1900 && n < 2100 ? n : null;
};
const clamp = (v, dflt, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : dflt;
};

/** One sire's row in a kind's table, without what only the page needs. */
function sireRow(row, years) {
  if (!row) return null;
  const {
    sire, offered, sold, clearance, aggregate, average, median, top, fee, feeApprox,
    multiple, share2x, premium, vsMarket, trend, firstYear, cropsInData, verdict, byYear,
  } = row;
  return {
    sire, offered, sold, clearance, aggregate, average, median, top, fee, feeApprox,
    multiple, share2x, premium, vsMarket, trend, firstYear, cropsInData, verdict,
    window: years,
    byYear,
  };
}

/** A lot as the model needs it: where, when, what it made. */
function lotRow(l) {
  return {
    year: l.year,
    kind: l.sale_type,
    region: l.region,
    sale: l.sale_name ?? l.sale_key,
    lot: l.lot,
    dam: l.dam_key ?? null,
    sex: l.sex ?? null,
    status: l.status,
    afterSale: l.after_sale ? true : undefined,
    price: l.price,
    currency: l.currency,
    priceGbp: l.price_gbp,
  };
}

const READING = {
  figures:
    "Prices are in sterling (priceGbp, median, average, aggregate, top). offered counts lots through the ring; " +
    "a buy-back is offered and not sold. clearance is sold / offered. fee is his covering fee for that crop, in sterling; " +
    "multiple is the median of price / fee. premium is how far his lots sold above (+) or below (-) lots by sires at his fee " +
    "in the same kind, region and year; vsMarket is the same against the market's median. trend is the change in median " +
    "across the window. The headline figures cover `window` (the latest years); byYear has every year held.",
  page: "The Sales Market page shows the same figures: /#/dashboard/SalesMarket.",
};

/**
 * Run the sales_history tool. `getSales` returns the sales service (the one
 * server.jsx builds for /api/sales/*); it is passed in rather than imported
 * so the agent never starts the service itself, and so tests can stand in a
 * fake.
 */
export async function salesHistory(input = {}, getSales) {
  if (typeof getSales !== "function") {
    throw new Error("The sale results are not reachable from this service.");
  }
  const kind = kindOf(input.kind);
  const region = regionOf(input.region);
  const year = yearOf(input.year);
  const view = String(input.view || (input.sire ? "sire" : input.dam ? "dam" : "market")).toLowerCase();

  let service;
  try {
    service = await getSales();
  } catch (err) {
    return building(err);
  }

  try {
    if (view === "sire") {
      const name = String(input.sire ?? "").trim();
      if (!name) throw new Error('view "sire" needs a sire name.');
      const out = await service.sire(name);
      const tables = {};
      for (const [key, row] of Object.entries(out.tables || {})) {
        const [k, r] = key.split("|");
        if (kind && k !== kind) continue;
        // Without a region the all-regions table is the one wanted; with one,
        // that region's alone.
        if (region ? r !== region : r !== "ALL") continue;
        tables[k] = sireRow(row, row.years);
      }
      const lots = (out.lots || [])
        .filter((l) => (!kind || l.sale_type === kind) && (!region || l.region === region) && (!year || l.year === year))
        .sort((a, b) => (b.price_gbp ?? -1) - (a.price_gbp ?? -1))
        .slice(0, clamp(input.limit, DEFAULT_LOTS, MAX_LOTS))
        .map(lotRow);
      const found = Object.keys(tables).length > 0 || lots.length > 0;
      return {
        content: JSON.stringify({
          view: "sire",
          sireKey: out.sireKey,
          kind: kind ?? "every kind",
          region: region ?? "all regions",
          builtAt: out.builtAt,
          byKind: tables,
          hit: !kind || kind === "hit" ? out.hit ?? undefined : undefined,
          topLots: lots,
          topLotsNote: lots.length
            ? `His ${lots.length} highest-priced lots${year ? ` of ${year}` : ""} among the most recent held, dearest first.`
            : undefined,
          reading: READING.figures,
          page: READING.page,
          note: found
            ? undefined
            : `No lots held by "${out.sireKey}". Names are keyed in capitals with the country suffix and punctuation removed; check the spelling, or that he has stock of this kind and region.`,
        }),
        meta: { rowCount: Object.keys(tables).length + lots.length },
      };
    }

    if (view === "dam") {
      const name = String(input.dam ?? "").trim();
      if (!name) throw new Error('view "dam" needs a dam name.');
      const out = await service.dam(name);
      const lots = (out.lots || []).filter((l) => (!kind || l.type === kind) && (!year || l.year === year));
      return {
        content: JSON.stringify({
          view: "dam",
          ...out,
          lots,
          reading:
            "Every lot out of her held, oldest first. ratio is the lot's price over its sire's median for that kind, region and year; " +
            "index is the geometric mean of those ratios, drawn towards 1 (so 1.4 means her stock made 40% more than the sires' usual).",
          note: lots.length ? undefined : `No lots held out of "${out.damKey}".`,
        }),
        meta: { rowCount: lots.length },
      };
    }

    if (view === "sires") {
      const k = kind ?? "yearling";
      const sort = ["premium", "median", "aggregate", "multiple", "vsMarket", "sold", "trend"].includes(input.sort) ? input.sort : "aggregate";
      const minSold = clamp(input.min_sold, 5, 1000);
      const out = await service.sires({ type: k, region, limit: 5000 });
      const rows = (out.rows || [])
        .filter((r) => (r.sold ?? 0) >= minSold && r[sort] !== null && r[sort] !== undefined)
        .sort((a, b) => (input.order === "asc" ? a[sort] - b[sort] : b[sort] - a[sort]))
        .slice(0, clamp(input.limit, DEFAULT_SIRES, MAX_SIRES))
        .map((r) => {
          const { byYear, ...rest } = sireRow(r, out.years);
          return rest;
        });
      return {
        content: JSON.stringify({
          view: "sires",
          kind: k,
          region: region ?? "all regions",
          window: out.years,
          sortedBy: `${sort} ${input.order === "asc" ? "asc" : "desc"}`,
          minSold,
          of: (out.rows || []).length,
          rows,
          reading: READING.figures,
          page: READING.page,
        }),
        meta: { rowCount: rows.length },
      };
    }

    if (view === "market") {
      const out = await service.market({ type: kind, region });
      const cells = out.cells || [];
      const latest = year ?? (cells.reduce((m, c) => Math.max(m, c.year), 0) || null);
      const sales = (out.sales || [])
        .filter((s) => !latest || s.year === latest)
        .slice(0, MAX_SALES)
        .map(({ type, saleName, saleKey, region: r, tier, year: y, offered, sold, clearance, aggregate, average, median, top, withdrawnShare, afterRingShare }) => ({
          type, sale: saleName ?? saleKey, region: r, tier, year: y, offered, sold, clearance, aggregate, average, median, top, withdrawnShare, afterRingShare,
        }));
      return {
        content: JSON.stringify({
          view: "market",
          kind: kind ?? "every kind",
          region: region ?? "every region",
          builtAt: out.builtAt,
          byYear: cells.map(({ type, region: r, year: y, offered, sold, clearance, aggregate, average, median, top, change }) => ({
            type, region: r, year: y, offered, sold, clearance, aggregate, average, median, top, change,
          })),
          salesOf: latest,
          sales,
          reading: "byYear is the market for each kind, region and year; change is against the year before. sales lists each sale of `salesOf`, sterling throughout.",
          page: READING.page,
        }),
        meta: { rowCount: cells.length + sales.length },
      };
    }

    throw new Error(`Unknown view "${view}". Use sire, dam, sires or market.`);
  } catch (err) {
    if (err?.code === "SALES_BUILDING") return building(err);
    throw err;
  }
}

/**
 * The index is rebuilt after every restart and takes a minute or two. That
 * is not a failure to dress up: the model is told what is happening and that
 * the table itself is readable meanwhile.
 */
function building(err) {
  if (err?.code !== "SALES_BUILDING") throw err;
  return {
    content:
      "The sale figures are being rebuilt after a restart and will be ready in a minute or two. " +
      "Meanwhile the lots themselves can be read from the sale_lots table with query_database " +
      "(bound it by sire_key and sale_type, which are indexed). Say that the summary figures were not ready if you use the table instead.",
    is_error: true,
  };
}
