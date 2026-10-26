/**
 * Arqana, Deauville: every sale's results, from the house's own export.
 *
 * Each sale has a number (venid) and its results are a spreadsheet at
 * www.arqana.com/web/vente/vente_actions.php?mode=get_csv&sortie=excel&venid=N
 * (named results_N.xlsx): a title row ("Vente de Yearlings d'Août 2025"),
 * a header row, then one row a lot — sex, date of birth, what it is
 * (Yearling, Foal, 2 ans, Cheval à l'entrainement, Jument...), name, sire,
 * dam, vendor, outcome (Vendu, Amiable, Racheté, Absent, Retiré), buyer,
 * the last bid in euros. The numbers run in order, about twenty-five a
 * year; 186 is the August yearlings of 2014.
 *
 * Arabians, show-jumpers and the jumping sales are left out: the market
 * read here is the flat thoroughbred one.
 */
import { readSheet } from "./xlsx.mjs";
import { nameKey } from "./normalise.mjs";
import { convert } from "./fx.mjs";

/** A sale from its title: the shared key, kind, tier and month. Null for a sale left out. */
export function saleFromTitle(title) {
  const t = String(title ?? "").trim();
  if (!t) return null;
  if (/pur-sang arabe|show lumet|obstacle|steeple|wathba/i.test(t)) return null;
  const year = Number((t.match(/\b(20\d{2})\b/) ?? [])[1]) || null;
  const dated = t.match(/\b(\d{2})\s+(\d{2})\s+(20\d{2})\b/);
  const rule = [
    [/yearlings? v\.?\s?2/i, "ARQ-AUG2", "Arqana August V.2", "yearling", 2, 8],
    [/yearlings? d'ao[uû]t|vente d'ao[uû]t|s[ée]lection 2020/i, "ARQ-AUG", "Arqana August", "yearling", 1, 8],
    [/yearlings? de septembre/i, "ARQ-OCT", "Arqana October", "yearling", 2, 9],
    [/yearlings? d'octobre/i, "ARQ-OCT", "Arqana October", "yearling", 2, 10],
    [/yearlings? de novembre/i, "ARQ-NOV", "Arqana November Yearlings", "yearling", 3, 11],
    [/breeze/i, "ARQ-BRZ", "Arqana Breeze-Up", "2yo", 1, 5],
    [/[ée]levage|d[ée]cembre mixte/i, "ARQ-DEC", "Arqana December Breeding Stock", "mixed", 1, 12],
    [/\barc\b/i, "ARQ-ARC", "Arqana Arc Sale", "hit", 1, 10],
    [/automne/i, "ARQ-AUT", "Arqana Autumn", "mixed", 2, 11],
    [/f[ée]vrier/i, "ARQ-FEB", "Arqana February", "mixed", 3, 2],
    [/d.[ée]t[ée]|juillet/i, "ARQ-SUM", "Arqana Summer", "mixed", 2, 7],
    [/online|pop-up/i, "ARQ-ONLINE", "Arqana Online", "mixed", 3, null],
  ].find(([re]) => re.test(t));
  if (!rule || !year) return null;
  const [, key, name, type, tier, month] = rule;
  const m = dated ? Number(dated[2]) : month;
  return { key, name, type, tier, year: dated ? Number(dated[3]) : year, month: m ? `${dated ? dated[3] : year}-${String(m).padStart(2, "0")}` : String(year) };
}

/** What a lot is, from the export's "Produit". */
export function kindOf(produit, saleType) {
  const p = String(produit ?? "").toLowerCase();
  if (p === "foal") return "foal";
  if (p === "yearling") return "yearling";
  if (/^2 ans$/.test(p)) return "2yo";
  if (/entra[iî]nement/.test(p)) return "hit";
  if (/jument|poulini[eè]re|pouliche/.test(p)) return "breeding";
  if (/store|[ée]talon|breeding right|parts/.test(p)) return null;
  return saleType === "mixed" ? null : saleType;
}

/** What became of it, from the export's "Issue". Amiable is a private sale agreed after the ring. */
export function outcomeOf(issue) {
  const s = String(issue ?? "").toLowerCase();
  if (s === "vendu") return { status: "sold", afterSale: false };
  if (s === "amiable") return { status: "sold", afterSale: true };
  if (/rachet/.test(s)) return { status: "rna", afterSale: false };
  if (/absent|retir/.test(s)) return { status: "withdrawn", afterSale: false };
  return { status: "catalogued", afterSale: false };
}

const SEX = { "M.": "colt", "F.": "filly", "H.": "gelding", "G.": "gelding" };
const clean = (s) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t || null;
};

/** A results export as lots in the shared shape. */
export function parseExport(buf, venid) {
  const rows = readSheet(buf);
  const title = clean(rows[0]?.[0]);
  const sale = saleFromTitle(title);
  if (!sale) return { venid, title, sale: null, lots: [] };
  const head = (rows[1] ?? []).map((h) => clean(h));
  const col = (name) => head.findIndex((h) => h && h.toLowerCase() === name.toLowerCase());
  const at = {
    lot: col("Lot"), sex: col("Sexe"), born: col("Date de naissance"), kind: col("Produit"), name: col("Nom"), sire: col("Père"), dam: col("Mère"),
    vendor: col("Vendeur"), issue: col("Issue"), buyer: col("Acheteur"), bid: col("Enchères"),
  };
  const lots = [];
  for (const r of rows.slice(2)) {
    const lot = clean(r[at.lot]);
    if (!lot || !/^\d+[A-Z]?$/i.test(lot)) continue;
    const type = kindOf(r[at.kind], sale.type);
    if (!type) continue;
    const { status, afterSale } = outcomeOf(r[at.issue]);
    const bid = Number(String(r[at.bid] ?? "").replace(/[^0-9.]/g, "")) || null;
    const born = clean(r[at.born]);
    const name = clean(r[at.name]);
    const sold = status === "sold" && bid;
    const gbp = sold ? convert(bid, "EUR", "GBP", sale.month) : null;
    lots.push({
      source: "arqana",
      company: "Arqana",
      sale_key: sale.key,
      sale_name: sale.name,
      sale_tier: sale.tier,
      sale_label: `ARQ${venid}`,
      region: "EU",
      year: sale.year,
      sale_month: /^\d{4}-\d{2}$/.test(sale.month) ? sale.month : null,
      sale_type: type,
      lot: String(Number(lot) || lot),
      horse: name && !/^N+\(/.test(name) ? name : null,
      sire: clean(r[at.sire]),
      sire_key: nameKey(r[at.sire]),
      dam: clean(r[at.dam]),
      dam_key: nameKey(r[at.dam]),
      sex: SEX[clean(r[at.sex])] ?? null,
      foaling_year: born ? Number(born.slice(0, 4)) || null : null,
      vendor: clean(r[at.vendor]),
      buyer: status === "sold" ? clean(r[at.buyer]) : null,
      status: status === "sold" && !bid ? "sold_private" : status,
      price: sold ? bid : null,
      bid: status === "rna" ? bid : null,
      currency: "EUR",
      price_gbp: gbp === null ? null : Math.round(gbp),
      after_sale: afterSale || undefined,
    });
  }
  return { venid, title, sale, lots };
}

const UA = "BlandfordBloodstock/1.0 (sales results; +https://www.blandfordbloodstock.tech)";
export const exportUrl = (venid) => `https://www.arqana.com/web/vente/vente_actions.php?mode=get_csv&sortie=excel&venid=${venid}`;

/** One sale's export, read. A number with no sale behind it comes back with no lots. */
export async function fetchExport(venid, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(exportUrl(venid), { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Arqana ${venid}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 200 || buf[0] !== 0x50 || buf[1] !== 0x4b) return { venid, title: null, sale: null, lots: [] };
  return parseExport(buf, venid);
}

export default { saleFromTitle, kindOf, outcomeOf, parseExport, exportUrl, fetchExport };
