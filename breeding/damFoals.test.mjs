import test from "node:test";
import assert from "node:assert/strict";

import { damGroups, damOfLabel, foalKey, herGroup, judge } from "./damFoals.mjs";

const c = (name, cc, year, sire, dam) => ({ cells: [name, cc, String(year), sire, dam, "R"] });
const ALL_OF_ME = [
  c("Karavas", "AUS", 2021, "Alabama Express", "All of Me (AUS) 2014"),
  c("Staggerwing", "SAF", 2023, "Rafeef", "All of Me (SAF) 2015"),
  c("Sharing Wisdom", "GB", 2023, "Ardad", "All of Me (GB) 2014"),
  c("Aces High", "GB", 2021, "Showcasing", "All of Me (GB) 2014"),
  c("Alluring Angel", "GB", 2020, "Fastnet Rock", "All of Me (GB) 2014"),
  c("00All of Me(GB)240", "GB", 2024, "Pinatubo", "All of Me (GB) 2014"),
  c("Tommy Pies", "USA", 2018, "Effinex", "All of Me (USA) 1999"),
  c("Somebody", "GB", 2019, "Kodiac", "All of the Best (USA) 1990"),
];

test("a dam label is her name, country and year", () => {
  assert.deepEqual(damOfLabel("All of Me (GB) 2014"), { name: "All of Me", country: "GB", year: 2014 });
  assert.deepEqual(damOfLabel("Burma's Love (USA) 1980"), { name: "Burma's Love", country: "USA", year: 1980 });
  assert.equal(foalKey("Biv s Song"), foalKey("Biv's Song"));
});

test("All Of Me (IRE on her row, GB on Arion) 2014: her foals by her year and part of the world, not the Australian mare's of the same year", () => {
  const groups = damGroups(ALL_OF_ME, "ALL OF ME");
  assert.equal(groups.length, 4, "All of the Best is another name");
  const her = herGroup(groups, { year: 2014, country: "IRE" });
  assert.equal(her.country, "GB");
  assert.equal(judge({ name: "ALLURING ANGEL", foalingYear: 2020 }, groups, her), "hers");
  assert.equal(judge({ name: "ACES HIGH", foalingYear: 2021 }, groups, her), "hers");
  assert.equal(judge({ name: "KARAVAS", foalingYear: 2021 }, groups, her), "other");
  assert.equal(judge({ name: "TOMMY PIES", foalingYear: 2018 }, groups, her), "other");
  assert.equal(judge({ name: "NOT LISTED", foalingYear: 2022 }, groups, her), "unknown");
});

test("a mare Arion has no foals for: every foal of the name is another mare's", () => {
  const groups = damGroups([c("Uno", "USA", 2018, "Laoban", "One Look (USA) 2011")], "One Look");
  const her = herGroup(groups, { year: 2021, country: "IRE" });
  assert.equal(her, null);
  assert.equal(judge({ name: "UNO", foalingYear: 2018 }, groups, her), "other");
});

test("two mares of her year in the same part of the world: not a guess", () => {
  const groups = damGroups([c("A", "GB", 2020, "X", "Twin (GB) 2014"), c("B", "IRE", 2021, "Y", "Twin (IRE) 2014")], "Twin");
  assert.equal(herGroup(groups, { year: 2014, country: "FR" }), null);
  assert.equal(herGroup(groups, { year: 2014, country: "IRE" }).country, "IRE");
});
