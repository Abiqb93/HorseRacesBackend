import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { readSheet } from "./xlsx.mjs";
import { saleFromTitle, kindOf, outcomeOf, parseExport } from "./arqana.mjs";

/** A zip of the named files, deflated: enough of the format for the reader. */
function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, "utf8");
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
/** An export as Arqana writes it: shared strings, numbers as numbers, empty cells left out. */
function workbook(rows) {
  const strings = [];
  const at = (s) => {
    const i = strings.indexOf(s);
    return i >= 0 ? i : strings.push(s) - 1;
  };
  const xmlRows = rows.map((r, ri) => `<row r="${ri + 1}">${r
    .map((v, ci) => {
      if (v === null || v === undefined || v === "") return "";
      const ref = `${COLS[ci]}${ri + 1}`;
      return typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${at(v)}</v></c>`;
    })
    .join("")}</row>`);
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return zip({
    "xl/sharedStrings.xml": `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet><sheetData>${xmlRows.join("")}</sheetData></worksheet>`,
  });
}

const HEAD = ["Lot", "Sexe", "Date de naissance", "Produit", "Nom", "Père", "Mère", "Vendeur", "Cour / Box", "Suffixe", "Suffixe Père", "Suffixe Mère", "Père de Mère", "Issue", "Acheteur", "Enchères"];
const row = (lot, issue, bid, o = {}) => [lot, o.sex ?? "M.", o.born ?? "2024-02-13", o.kind ?? "Yearling", o.name ?? null, o.sire ?? "SIYOUNI", o.dam ?? `DAM ${lot}`, "Etreham", "C 285", "FR", "FR", "IRE", "NATHANIEL", issue, issue === "Vendu" || issue === "Amiable" ? "Fabrice CHAPPET" : null, bid];

test("an .xlsx read with zlib alone: shared strings, numbers, gaps", () => {
  const rows = readSheet(workbook([["a", null, 3], ["Père & Mère", 2.5]]));
  assert.deepEqual(rows, [["a", null, 3], ["Père & Mère", 2.5]]);
});

test("Arqana sales from their titles; Arabians and jumpers left out", () => {
  assert.equal(saleFromTitle("Vente de Yearlings d'Août 2025").key, "ARQ-AUG");
  assert.equal(saleFromTitle("La Vente d'Août 2026").key, "ARQ-AUG");
  assert.equal(saleFromTitle("Vente de Sélection 2020").key, "ARQ-AUG");
  assert.equal(saleFromTitle("Vente de Yearlings v.2 2025").key, "ARQ-AUG2");
  assert.equal(saleFromTitle("Vente de Yearling v.2 2023").key, "ARQ-AUG2");
  assert.deepEqual([saleFromTitle("Vente de Yearlings de Septembre 2022").key, saleFromTitle("Vente de Yearlings de Septembre 2022").month], ["ARQ-OCT", "2022-09"]);
  assert.equal(saleFromTitle("Vente de Yearlings de Novembre Plat 2025").key, "ARQ-NOV");
  assert.equal(saleFromTitle("Vente d'Automne 2020 Yearlings Plat").key, "ARQ-AUT");
  assert.equal(saleFromTitle("Breeze Up 2026").type, "2yo");
  assert.equal(saleFromTitle("Vente de l'Arc 2025").type, "hit");
  assert.equal(saleFromTitle("Vente d'Elevage 2025").key, "ARQ-DEC");
  assert.equal(saleFromTitle("Vente d'été 2014").key, "ARQ-SUM");
  assert.equal(saleFromTitle("Vente Mixte de Février 2026").key, "ARQ-FEB");
  assert.equal(saleFromTitle("Vente Pop-Up du 13 11 2025").month, "2025-11");
  for (const t of ["Vente de Pur-Sang Arabes 2019", "Show Lumet 2021", "Vente d'élevage obstacle 2020", "Vente d'Automne - Elevage Obstacle 2025", "Le National de l'Obstacle 2025", "Vente du Grand Steeple 2019", "Vente Online Wathba Stud 2025", "Vente Haras des Brimbelles"]) {
    assert.equal(saleFromTitle(t), null, t);
  }
});

test("what a lot is and what became of it", () => {
  assert.equal(kindOf("Foal"), "foal");
  assert.equal(kindOf("2 ans"), "2yo");
  assert.equal(kindOf("Cheval à l'entrainement"), "hit");
  assert.equal(kindOf("Jument"), "breeding");
  assert.equal(kindOf("Parts d'étalon"), null);
  assert.deepEqual(outcomeOf("Vendu"), { status: "sold", afterSale: false });
  assert.deepEqual(outcomeOf("Amiable"), { status: "sold", afterSale: true });
  assert.equal(outcomeOf("Racheté").status, "rna");
  assert.equal(outcomeOf("Absent").status, "withdrawn");
  assert.equal(outcomeOf("Retiré").status, "withdrawn");
  assert.equal(outcomeOf(null).status, "catalogued");
});

test("an Arqana export as lots: sold, sold after the ring, bought back, withdrawn, still to come", () => {
  const buf = workbook([
    ["Vente de Yearlings d'Août 2025"],
    HEAD,
    row("0001", "Amiable", 200000, { name: "MYSTIC RIVER", dam: "A TOUT JAMAIS" }),
    row("0002", "Vendu", 160000, { sex: "F." }),
    row("0003", "Racheté", 90000),
    row("0004", "Absent", null),
    row("0005", null, null),
    row("0006", "Vendu", 50000, { kind: "Parts d'étalon" }),
    ["Total", null, null],
  ]);
  const out = parseExport(buf, 386);
  assert.equal(out.sale.key, "ARQ-AUG");
  assert.equal(out.lots.length, 5, "the stallion share and the total row are not lots");
  const [a, b, c, d, e] = out.lots;
  assert.equal(a.sale_label, "ARQ386");
  assert.equal(a.lot, "1");
  assert.equal(a.horse, "MYSTIC RIVER");
  assert.equal(a.status, "sold");
  assert.equal(a.after_sale, true);
  assert.equal(a.price, 200000);
  assert.equal(a.currency, "EUR");
  assert.ok(a.price_gbp > 150000 && a.price_gbp < 190000, `€200,000 in August 2025 is about £173k, got ${a.price_gbp}`);
  assert.equal(a.foaling_year, 2024);
  assert.equal(a.sale_type, "yearling");
  assert.equal(b.sex, "filly");
  assert.equal(b.after_sale, undefined);
  assert.equal(c.status, "rna");
  assert.equal(c.bid, 90000);
  assert.equal(c.price, null);
  assert.equal(c.buyer, null);
  assert.equal(d.status, "withdrawn");
  assert.equal(e.status, "catalogued");
});
