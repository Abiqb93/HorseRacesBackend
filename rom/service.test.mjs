import assert from "node:assert/strict";
import { test } from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { createRomService } from "./service.mjs";

// The table as MySQL keeps it, in memory: REPLACE INTO by name, SELECT all.
function fakeDb() {
  const table = new Map();
  const runQuery = async (sql, args = []) => {
    if (/^\s*CREATE TABLE/i.test(sql)) return [];
    if (/^\s*REPLACE INTO/i.test(sql)) {
      const [name, sha256, rows_n, body] = args;
      table.set(name, { name, sha256, rows_n, body, loaded_at: "2026-10-30 09:00:00" });
      return { affectedRows: 1 };
    }
    if (/^\s*SELECT name, sha256, body/i.test(sql)) return [...table.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (/^\s*SELECT name, sha256, rows_n, loaded_at/i.test(sql)) return [...table.values()];
    throw new Error(`unexpected query: ${sql}`);
  };
  return { table, runQuery };
}

const part = (rows) => zlib.gzipSync(Buffer.from(rows.map((r) => JSON.stringify(r)).join("\n") + "\n"));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

function setup() {
  const p2017 = part([
    { y: 2017, st: "Blue Point (IRE)", mare: "Rosa (GB)", myob: 2010, msire: "Dansili (GB)", fee: 30000, ran: 1, r95: 1, r105: 0, r115: 0, rt: 99 },
    { y: 2017, st: "Blue Point (IRE)", mare: "Viola (GB)", myob: 2011, msire: "Galileo (IRE)", fee: 30000, ran: 0, r95: 0, r105: 0, r115: 0 },
  ]);
  const p2018 = part([{ y: 2018, st: "Blue Point (IRE)", mare: "Rosa (GB)", myob: 2010, msire: "Dansili (GB)", fee: 35000, mf: "W" }]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rom-"));
  const manifestPath = path.join(dir, "seed-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({ parts: [
    { name: "rom-2017", kind: "coverings", year: 2017, rows: 2, sha256: sha(p2017) },
    { name: "rom-2018", kind: "coverings", year: 2018, rows: 1, sha256: sha(p2018) },
  ] }));
  const db = fakeDb();
  const svc = createRomService({ runQuery: db.runQuery, log: {}, manifestPath, rebuildDelayMs: 60_000 });
  return { svc, db, p2017, p2018 };
}

test("a part not in the manifest is refused, and nothing is read without one", async () => {
  const { svc, db } = setup();
  const out = await svc.acceptSeed(part([{ y: 2017, st: "Someone", mare: "X" }]));
  assert.equal(out.accepted, false);
  assert.equal(db.table.size, 0);
  await assert.rejects(svc.books(), (e) => e.code === "ROM_EMPTY");
});

test("listed parts are kept whole and read into books, a stallion and a mare", async () => {
  const { svc, db, p2017, p2018 } = setup();
  assert.deepEqual(await svc.acceptSeed(p2017), { accepted: true, part: "rom-2017", rows: 2 });
  assert.equal((await svc.acceptSeed(p2018)).accepted, true);
  assert.equal(db.table.size, 2);
  await svc.build();

  const books = await svc.books();
  assert.deepEqual(books.years, [2017, 2018]);
  assert.equal(books.stallions[0].name, "Blue Point");
  assert.deepEqual(books.stallions[0].books, [2, 1]);

  const s = await svc.stallion("blue point");
  assert.equal(s.latest, 1);
  assert.equal(s.years.length, 2);
  assert.equal(await svc.stallion("Nobody"), null);

  const several = await svc.stallions(["Blue Point (IRE)", "Nobody"], { msire: "Dansili" });
  assert.equal(several.stallions[0].cross.covers, 1);
  assert.equal(several.stallions[1].missing, true);

  const m = await svc.mare("Rosa");
  assert.equal(m.found, true);
  assert.deepEqual(m.coverings.map((c) => [c.y, c.stallion, c.rt]), [[2017, "Blue Point", 99], [2018, "Blue Point", null]]);

  const st = await svc.status();
  assert.equal(st.held, 2);
  assert.equal(st.wanted, 2);
  assert.equal(st.built.coverings, 3);
});

test("a held part the manifest no longer lists is left out of the books", async () => {
  const { svc, db, p2017 } = setup();
  await svc.acceptSeed(p2017);
  db.table.set("rom-old", { name: "rom-old", sha256: "0".repeat(64), rows_n: 1, body: part([{ y: 2010, st: "Old Horse", mare: "Y" }]) });
  await svc.build();
  assert.deepEqual((await svc.books()).years, [2017]);
});
