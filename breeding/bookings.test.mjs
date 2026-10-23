import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDate, yearOf, parseSeasonDate, parseMareStatus, parseMoney, parseCurrency, parseTerms, parseContract,
  parseConfirmed, parseCommission, parseRightLine, parseRightsSheet, parseBook, stageOf, stageFromRow, readTyped,
  bookingColumns, rightColumns, rowOut, summarise,
} from "./bookings.mjs";

const E = Array(15).fill("");
const row = (...cells) => [...cells, ...E].slice(0, 15);

test("a day and month take the year the column records", () => {
  assert.equal(parseDate("07/02/26"), "2026-02-07");
  assert.equal(parseDate("29.05", { year: 2025 }), "2025-05-29");
  assert.equal(parseDate("2026-03-01"), "2026-03-01");
  assert.equal(parseDate("May?"), null);
  assert.equal(yearOf(2, 2026, "foaling"), 2026);
  assert.equal(yearOf(5, 2026, "cover"), 2025);
  assert.equal(yearOf(11, 2026, "booking"), 2025);
  assert.equal(yearOf(1, 2026, "booking"), 2026);
  assert.equal(parseSeasonDate("20/01", { season: 2026 }), "2026-01-20");
  assert.equal(parseSeasonDate("27/11/25", { season: 2026 }), "2025-11-27");
});

test("the mare's status is read with its date, and the words are kept", () => {
  assert.deepEqual(parseMareStatus("MAIDEN"), { status: "maiden", date: null, raw: "MAIDEN" });
  assert.deepEqual(parseMareStatus("due 07/02", { season: 2026 }), { status: "in_foal", date: "2026-02-07", raw: "due 07/02" });
  assert.deepEqual(parseMareStatus("TIF 29.05", { season: 2026 }), { status: "tested_in_foal", date: "2025-05-29", raw: "TIF 29.05" });
  assert.deepEqual(parseMareStatus("21/05", { season: 2026 }), { status: "in_foal", date: "2025-05-21", raw: "21/05" });
  assert.equal(parseMareStatus("aborted").status, "aborted");
  assert.equal(parseMareStatus("slipped 12/03", { season: 2026 }).status, "slipped");
  assert.equal(parseMareStatus("RESTED").status, "rested");
  assert.equal(parseMareStatus("late March").status, "in_foal");
  assert.equal(parseMareStatus("TF").status, "unknown");
  assert.equal(parseMareStatus("").status, null);
});

test("money, currency and terms", () => {
  assert.equal(parseMoney("150,000"), 150000);
  assert.equal(parseMoney("€7.5k"), 7500);
  assert.equal(parseMoney("£1,000 to Ed Sackville"), 1000);
  assert.equal(parseMoney("BR"), null);
  assert.equal(parseMoney("see deal"), null);
  assert.equal(parseCurrency("€"), "EUR");
  assert.equal(parseCurrency("£400 OSL"), "GBP");
  assert.equal(parseCurrency("5%", "GBP"), "GBP");
  assert.equal(parseTerms("1st Oct SLF").terms, "oct1_slf");
  assert.equal(parseTerms("1st Oct refundable").terms, "oct1_refundable");
  assert.equal(parseTerms("LIVE FOAL 48 hrs").terms, "live_foal_48h");
  assert.equal(parseTerms("LIVE FOAL").terms, "live_foal");
  assert.equal(parseTerms("1st Oct Free Return").terms, "oct1_free_return");
  assert.equal(parseTerms("1st Jan SLF").terms, "jan1_slf");
  assert.equal(parseTerms("Foal Share").terms, "foal_share");
  assert.equal(parseTerms("").terms, null);
});

test("a contract's reference and how far it has got", () => {
  assert.deepEqual(parseContract("RB95 fully S&R"), { ref: "RB95", state: "fully_signed", raw: "RB95 fully S&R" });
  assert.equal(parseContract("RB52 contracted - chased up 05/02/26").state, "contracted");
  assert.equal(parseContract("RB3 signed online").state, "signed_online");
  assert.equal(parseContract("RB91 S&R").state, "signed");
  assert.equal(parseContract("RB120").state, "contracted");
  assert.deepEqual(parseContract("3 mares going on 2 breeding rights").ref, null);
});

test("a confirmation says when, by what means and by whom", () => {
  assert.deepEqual(parseConfirmed("TG email 27/11/25", { season: 2026 }), { date: "2025-11-27", via: "email", by: "TG", raw: "TG email 27/11/25" });
  assert.deepEqual(parseConfirmed("Zoom 05/01/26", { season: 2026 }), { date: "2026-01-05", via: "zoom", by: null, raw: "Zoom 05/01/26" });
  assert.equal(parseConfirmed("RB Zoom 20/01", { season: 2026 }).date, "2026-01-20");
  assert.equal(parseConfirmed("RB WhatsApp 13/11/24", { season: 2025 }).via, "whatsapp");
  assert.deepEqual(parseConfirmed("check fee with OSL", { season: 2026 }), { date: null, via: null, by: "OSL", raw: "check fee with OSL" });
});

test("commission is a percentage or an amount, to someone", () => {
  assert.deepEqual(parseCommission("5%", { currency: "GBP" }), { pct: 5, amount: null, currency: null, to: null, raw: "5%" });
  assert.equal(parseCommission("NO").none, true);
  assert.deepEqual(parseCommission("€7.5k"), { pct: null, amount: 7500, currency: "EUR", to: null, raw: "€7.5k" });
  const ed = parseCommission("£1,000 to Ed Sackville");
  assert.equal(ed.amount, 1000);
  assert.equal(ed.currency, "GBP");
  assert.equal(ed.to, "Ed Sackville");
  assert.equal(parseCommission("5% TG").to, "TG");
  assert.equal(parseCommission("OSL").to, "OSL");
});

test("a nomination line: the stallion, his number, the partners and the balance", () => {
  const z = parseRightLine("Zarak (20% Thurso 20% Whatton 60% H Bozo)");
  assert.equal(z.stallion, "Zarak");
  assert.deepEqual(z.partners, [{ name: "Thurso", pct: 20 }, { name: "Whatton", pct: 20 }, { name: "H Bozo", pct: 60 }]);
  assert.equal(z.ownShare, 0);
  const zh = parseRightLine("Zarak (20% Thurso 20% Whatton 60% H Bozo)", { holder: "Thurso" });
  assert.equal(zh.ownShare, 20);
  assert.deepEqual(zh.partners.map((p) => p.name), ["Whatton", "H Bozo"]);
  const h = parseRightLine("Havana Grey 2 (33% Eclipse, 33% Oliver St Lawrence)");
  assert.equal(h.stallion, "Havana Grey");
  assert.equal(h.number, 2);
  assert.equal(h.ownShare, 34);
  assert.equal(parseRightLine("Havana Grey 5 (33% Whatton, 33% OIiver St Lawrence").stallion, "Havana Grey");
  const pp = parseRightLine("Palace Pier 8 (33% with Eclipse and SAB) 50% return");
  assert.equal(pp.stallion, "Palace Pier");
  assert.equal(pp.number, 8);
  assert.equal(pp.returnPct, 50);
  assert.deepEqual(pp.partners, [{ name: "Eclipse and SAB", pct: 33 }]);
  const pp9 = parseRightLine("Palace Pier 9 - 50% RETURN (re Borja dead foal)");
  assert.equal(pp9.stallion, "Palace Pier");
  assert.equal(pp9.number, 9);
  const mg = parseRightLine("Modern Games (50% Thurso, 50% Whatton) BONUS");
  assert.equal(mg.bonus, true);
  assert.equal(parseRightLine("Modern Games (Free return)").freeReturn, true);
  assert.equal(parseRightLine("Siyouni (50% Whatton)").ownShare, 50);
  assert.equal(parseRightLine("Wathnan Racing").stallion, "Wathnan Racing");
});

test("the rights sheet names the holder and every nomination", () => {
  const { rights, holder } = parseRightsSheet([
    ["THURSO NOMS", "Partner (%)", "Partner (%)"],
    ["Ardad", "", ""],
    ["Hello Youmzain", "(50% Whatton)", "(50% Blandford France)"],
    ["Havana Grey (2)", "(33% Whatton)", "(33% Oliver St Lawrence)"],
  ], { season: 2026 });
  assert.equal(holder, "THURSO");
  assert.deepEqual(rights.map((r) => [r.stallion, r.number, r.ownShare]), [["Ardad", null, 100], ["Hello Youmzain", null, 0], ["Havana Grey", 2, 34]]);
});

const SHEET = [
  ["", "MARE", "Added to Description database", "COVERING SIRE 2025", "STATUS/LSD", "2026 MATING", "NOTES", "STALLION STUD", "BOOKING E MAIL SENT", "DATE NOM CONFIRMED", "VALUE", "£€$", "TERMS", "COMM", "SIGNED & RETURNED"],
  row("THURSO NOMS"),
  ["Siyouni (50% Whatton)", "WITH YOU", "", "", "", "SIYOUNI", "", "Bonneval (FR)", "", "TG email 27/11/25", "150,000", "€", "LIVE FOAL 48 hrs", "€7.5k", "RB1 - €7,500 to Blandford (TG)"],
  ["Siyouni (50% Whatton)", "LOVE CHILD", "", "ZARAK", "due 07/02", "SIYOUNI", "Daylesford Mare", "Bonneval (FR)", "", "Zoom 05/01/26", "125,000", "€", "LIVE FOAL 48 hrs", "OSL", "RB95 - €5,000 commission to OSL"],
  ["Zarak (20% Thurso 20% Whatton 60% H Bozo)", "", "", "", "", "ZARAK", "H Bozo using", "Bonneval (FR)", "", "", "", "", "", "", ""],
  row("Isaac Shelby (100% Thurso)"),
  E,
  row("Wathnan Racing"),
  ["", "ALMA MATER", "", "FRANKEL", "TIF 29.05", "LEAD ARTIST", "", "Juddmonte (UK)", "RB email 17/12/25", "02/01/26", "17,000", "£", "1st Oct SLF", "5%", "RB52 contracted - chased up 05/02/26"],
  ["", "BELLA", "", "KINGMAN", "BARREN", "", "", "", "", "", "", "", "", "NO", ""],
  ["Ruskerne (50% Blandford France)", "French Rose", "", "ZARAK", "BARREN", "ZARAK", "", "Bonneval (FR)", "11/12/25", "12/11/25", "80,000", "€", "1st Oct SLF", "5%", "RB55 fully S&R"],
  row("ON APPEAL - Ghaiyyath & Chaldean (both signed)"),
];

test("the book: nominations become rights, client lines become owners, the rest is kept", () => {
  const book = parseBook(SHEET, { season: 2026 });
  assert.equal(book.holder, "THURSO");
  assert.deepEqual(book.rights.map((r) => [r.stallion, r.qty, r.ownShare, r.partners.map((p) => p.name)]), [
    ["Siyouni", 2, 50, ["Whatton"]],
    ["Zarak", 1, 20, ["Whatton", "H Bozo"]],
    ["Isaac Shelby", 1, 100, []],
  ]);
  assert.deepEqual(book.bookings.map((b) => b.mare_name), ["WITH YOU", "LOVE CHILD", "ALMA MATER", "BELLA", "French Rose"]);
  const [withYou, loveChild, alma, bella, rose] = book.bookings;
  assert.equal(withYou.right_label, "Siyouni (50% Whatton)");
  assert.equal(withYou.owner, null);
  assert.equal(withYou.stage, "contracted");
  assert.equal(withYou.terms, "live_foal_48h");
  assert.equal(withYou.fee, 150000);
  assert.equal(withYou.currency, "EUR");
  assert.equal(withYou.commission_amount, 7500);
  assert.equal(withYou.confirmed_on, "2025-11-27");
  assert.equal(withYou.confirmed_by, "TG");
  assert.equal(loveChild.status_date, "2026-02-07");
  assert.equal(loveChild.last_cover, "ZARAK");
  assert.equal(alma.owner, "Wathnan Racing");
  assert.equal(alma.section, "Wathnan Racing");
  assert.equal(alma.right_label, null);
  assert.equal(alma.mare_status, "tested_in_foal");
  assert.equal(alma.status_date, "2025-05-29");
  assert.equal(alma.requested_on, "2025-12-17");
  assert.equal(alma.confirmed_on, "2026-01-02");
  assert.equal(alma.commission_pct, 5);
  assert.equal(alma.contract_ref, "RB52");
  assert.equal(alma.stallion_key, "LEAD ARTIST");
  assert.equal(bella.stallion, null);
  assert.equal(bella.stage, "planned");
  assert.equal(bella.mare_status, "barren");
  assert.equal(rose.owner, "Ruskerne");
  assert.deepEqual(rose.ownership, { own: 50, partners: [{ name: "Blandford France", pct: 50 }] });
  assert.equal(rose.contract_state, "fully_signed");
  assert.equal(rose.stage, "signed");
  assert.deepEqual(book.notes.map((n) => n.text), ["ON APPEAL - Ghaiyyath & Chaldean (both signed)"]);
  assert.equal(book.skipped.length, 0);
});

test("the summary adds fees by currency, never across them, and finds the room on the rights", () => {
  const book = parseBook(SHEET, { season: 2026 });
  const s = summarise(book.bookings, book.rights);
  assert.equal(s.bookings, 5);
  assert.equal(s.unbooked, 1);
  assert.equal(s.contractsOut, 3);
  assert.deepEqual(s.fees.EUR, { count: 3, total: 355000, commission: 11500 });
  assert.deepEqual(s.fees.GBP, { count: 1, total: 17000, commission: 850 });
  assert.deepEqual(s.rights.map((r) => [r.stallion, r.mares, r.unused]), [["Siyouni", 2, 0], ["Zarak", 0, 1], ["Isaac Shelby", 0, 1]]);
  assert.equal(s.rightsUnused, 2);
});

test("a stage follows the paperwork", () => {
  assert.equal(stageOf({ stallion: "Frankel" }), "planned");
  assert.equal(stageOf({ requested: { raw: "sent" }, stallion: "Frankel" }), "requested");
  assert.equal(stageOf({ confirmed: { via: "email" } }), "confirmed");
  assert.equal(stageOf({ contract: { ref: "RB1", state: "contracted" } }), "contracted");
  assert.equal(stageOf({ contract: { ref: "RB1", state: "fully_signed" } }), "signed");
  assert.equal(stageFromRow({ contract_ref: "RB9", contract_state: "signed_online" }), "signed");
});

test("words typed on the page are read the way the sheet's are", () => {
  const t = readTyped({ status_text: "due 12/03", contract_text: "RB7 fully S&R", fee_text: "£25,000", commission_text: "5%" }, { season: 2026 });
  assert.equal(t.mare_status, "in_foal");
  assert.equal(t.status_date, "2026-03-12");
  assert.equal(t.contract_state, "fully_signed");
  assert.equal(t.fee, 25000);
  assert.equal(t.currency, "GBP");
  assert.equal(t.commission_pct, 5);
});

test("columns are coerced and unknown fields dropped; a row reads back as the page needs it", () => {
  const c = bookingColumns({ season: "2026", mare_name: " Enable (GB) ", stallion: "Frankel", fee: "80000", status_date: "07/02/26", terms: "nonsense", ownership: { own: 50 }, added_to_description: true, bogus: 1 });
  assert.equal(c.season, 2026);
  assert.equal(c.mare_key, "ENABLE");
  assert.equal(c.stallion_key, "FRANKEL");
  assert.equal(c.fee, 80000);
  assert.equal(c.status_date, "2026-02-07");
  assert.equal(c.terms, "other");
  assert.equal(c.ownership, '{"own":50}');
  assert.equal(c.added_to_description, 1);
  assert.ok(!("bogus" in c));
  const r = rightColumns({ stallion: "Zarak", partners: [{ name: "Whatton", pct: 20 }], qty: 0, bonus: true, free_return: false, return_pct: "50" });
  assert.equal(r.stallion_key, "ZARAK");
  assert.equal(r.qty, 1);
  assert.equal(r.bonus, 1);
  assert.equal(r.return_pct, 50);
  const out = rowOut({ id: 1, fee: "80000.00", ownership: '{"own":50}', bonus: 1, status_date: new Date("2026-02-07T00:00:00Z") });
  assert.equal(out.fee, 80000);
  assert.deepEqual(out.ownership, { own: 50 });
  assert.equal(out.bonus, true);
  assert.equal(out.status_date, "2026-02-07");
});
