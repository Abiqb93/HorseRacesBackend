import assert from "node:assert/strict";
import { test } from "node:test";

import { enrichMares, mapsFrom } from "./enrich.mjs";

const row = (o) => ({ before: { foals: 0, runners: 0, best: null, r95: 0 }, covered: false, readable: false, ran: null, ...o });

test("a mare list made whole from the runners file and his runners", () => {
  const out = {
    mares: [
      // a maiden of the runners file's crops who never ran
      row({ y: 2026, mare: "Ada Thorne", myob: 2022 }),
      // her class and dam from her own record
      row({ y: 2026, mare: "Group Mare", myob: 2018 }),
      // her foal of 2024 by him ran and has a figure; her older foal is black type
      row({ y: 2023, mare: "Old Mare", myob: 2010, covered: true, mf: "W", mdam: "Her Dam", before: { foals: 2, runners: 1, best: 80, r95: 0 } }),
      // covered in 2025: no return yet, the foal due in 2026 runs from 2028
      row({ y: 2025, mare: "Old Mare", myob: 2010, covered: true, mf: "W", mdam: "Her Dam" }),
    ],
  };
  const maps = mapsFrom({
    mares: [{ horse_name: "GROUP MARE", foaling_year: 2018, dam: "SOME DAM (IRE)", runs: 8, g_wins: 1, s_wins: 1, turf_wins: 3 }],
    foals: [
      { horse_name: "BIG SON", foaling_year: 2019, dam_key: "OLD MARE", runs: 7, s_top3: 1, turf_wins: 2 },
      { horse_name: "SMALL SON", foaling_year: 2022, dam_key: "OLD MARE", runs: 2 },
    ],
    sireFoals: [{ horse_name: "THE FOAL", foaling_year: 2024, sex: "C", dam_key: "OLD MARE", runs: 3, turf_wins: 1 }],
    ratings: [{ name: "THE FOAL", dam: "OLD MARE", foalingYear: 2024, best: 98, sex: "C" }],
  });
  enrichMares(out, { ...maps, year: 2026, lastReturnYear: 2023 });
  const [maiden, group, old23, old25] = out.mares;

  assert.deepEqual([maiden.mf, maiden.mfSrc, maiden.before.note, maiden.mbpNote], ["Unr", "never ran", "maiden", "maiden"]);
  assert.deepEqual([maiden.retNote, maiden.rtNote], ["due 2027", "runs from 2029"]);

  assert.deepEqual([group.mf, group.mfSrc, group.mdam, group.mdamSrc], ["GW", "runners", "Some Dam", "runners"]);

  assert.deepEqual([old23.mbp, old23.mbpSrc], ["SPl", "runners"], "her 2019 son, stakes placed, by 2023");
  assert.equal(old23.before.runners, 1, "the return's count stands where the file holds no more");
  assert.deepEqual([old23.ret, old23.retSrc, old23.fsex, old23.foal.name], ["foal", "ran", "C", "The Foal"]);
  assert.deepEqual([old23.rt, old23.rtSrc, old23.r95], [98, "results", true]);

  assert.equal(old25.before.runners, 2, "both her foals two or older by 2025");
  assert.deepEqual([old25.retNote, old25.rtNote], ["no return yet", "runs from 2028"]);
});

test("a dam from the parent map, only where her sire agrees; a young crop not yet run", () => {
  const out = {
    mares: [
      row({ y: 2024, mare: "Imagery", myob: 2009, msire: "Galileo" }),
      row({ y: 2024, mare: "Namesake", myob: 2009, msire: "Dubawi" }),
      row({ y: 2023, mare: "Young Crop", myob: 2012, msire: "Kingman", mdam: "X", ran: false }),
      row({ y: 2021, mare: "Read Crop", myob: 2012, msire: "Kingman", mdam: "X", readable: true, ran: false }),
      row({ y: 2022, mare: "Barren Mare", myob: 2012, msire: "Kingman", mdam: "X", ret: "barren" }),
    ],
  };
  const maps = mapsFrom({
    parents: [
      { horse_key: "IMAGERY", sire_key: "GALILEO", dam_key: "DESIGN" },
      { horse_key: "NAMESAKE", sire_key: "SADLER'S WELLS", dam_key: "OTHER" },
    ],
  });
  enrichMares(out, { ...maps, year: 2026, lastReturnYear: 2023 });
  const [img, other, young, read, barren] = out.mares;
  assert.deepEqual([img.mdam, img.mdamSrc], ["Design", "pedigrees"]);
  assert.equal(other.mdam, undefined, "a namesake by another sire is not her");
  assert.equal(young.rtNote, "not run yet", "the 2024 foals are two this year; the return's unraced is out of date");
  assert.equal(read.rtNote, "unraced");
  assert.equal(barren.rtNote, "no foal");
});
