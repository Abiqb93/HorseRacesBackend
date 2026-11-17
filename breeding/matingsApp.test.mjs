import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { descriptionOf, importFromApp, parseHorsePage, photoOf, sameMare, slugFor, titleDate } from "./matingsApp.mjs";

const PAGE = fs.readFileSync(new URL("./fixtures/matings-app-horse.html", import.meta.url), "utf8");

test("a horse's page: header, posts and images", () => {
  const p = parseHorsePage(PAGE);
  assert.equal(p.name, "Test Mare");
  assert.equal(p.country, "GB");
  assert.equal(p.year, 2014);
  assert.equal(p.sex, "M");
  assert.equal(p.location, "Some Stud");
  assert.equal(p.status, "In Foal");
  assert.equal(p.coveringSire, "Sire Three");
  assert.deepEqual(p.posts.map((x) => [x.title, x.date]), [
    ["TEST MARE PHOTO – 10.06.20", "2020-06-10"],
    ["TEST MARE DESCRIPTION – 04.12.18", "2018-12-04"],
    ["TEST MARE DESCRIPTION – 01.02.16", "2016-02-01"],
  ]);
  assert.equal(p.images.length, 1);
  assert.equal(parseHorsePage("<html>no horse</html>"), null);
});

test("her description is the newest one, her name taken off the front and its date at the end", () => {
  const d = descriptionOf(parseHorsePage(PAGE));
  assert.equal(d, "16 HH. First line of the description, inbred 3×3 to ONE SIRE’S line.\nA LATER NOTE (22.11.21)\n(Matings App, 4 December 2018)");
});

test("her picture is the newest photo post's, else the first image", () => {
  const p = parseHorsePage(PAGE);
  assert.match(photoOf(p), /Test-Mare-10\.06\.20\.jpg$/);
  assert.match(photoOf({ ...p, posts: [] }), /Test-Mare-older\.jpg$/);
  assert.equal(photoOf({ posts: [], images: [] }), null);
});

test("slugs, dates and the same-mare check", () => {
  assert.equal(slugFor("ALL OF ME"), "all-of-me");
  assert.equal(slugFor("Madonna Dell'Orto (GB)"), "madonna-dellorto");
  assert.equal(titleDate("X DESCRIPTION – 04.12.18"), "2018-12-04");
  assert.equal(titleDate("no date"), null);
  const p = parseHorsePage(PAGE);
  assert.ok(sameMare(p, { horse_name: "TEST MARE", foaling_year: 2014 }));
  assert.ok(!sameMare(p, { horse_name: "TEST MARE", foaling_year: 2016 }), "a namesake of another year");
  assert.ok(sameMare(p, { horse_name: "Test Mare", foaling_year: null }));
});

test("the import fills only what a mare lacks", async () => {
  const page = parseHorsePage(PAGE);
  const client = { horse: async (n) => (/test mare/i.test(n) ? page : null), image: async () => ({ type: "image/jpeg", body: Buffer.from("x") }) };
  const wrote = [];
  const report = await importFromApp({
    mares: [
      { id: 1, horse_name: "TEST MARE", foaling_year: 2014, physical: null },
      { id: 2, horse_name: "TEST MARE", foaling_year: 2014, physical: "Already written" },
      { id: 3, horse_name: "Nobody", foaling_year: 2014 },
    ],
    photoAt: new Map([[2, "2026-11-17T09:00:00Z"]]),
    client,
    savePhysical: async (m, t) => wrote.push(["physical", m.id, t.slice(0, 5)]),
    savePhoto: async (m, img) => wrote.push(["photo", m.id, img.type]),
    pause: async () => {},
  });
  assert.deepEqual(wrote, [["physical", 1, "16 HH"], ["photo", 1, "image/jpeg"]]);
  assert.deepEqual(report.map((r) => [r.id, r.found, r.description, r.photo]), [
    [1, true, "filled", "filled"],
    [2, true, "kept", "kept"],
    [3, false, "kept", "kept"],
  ]);
});
