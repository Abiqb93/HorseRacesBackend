import test from "node:test";
import assert from "node:assert/strict";

import { CHUNK_BYTES, MAX_VIDEO_BYTES, chunksFor, createVideos, readRange } from "./videos.mjs";

/** The two tables and the mares, in memory, as the module sees them. */
function fakeDb({ mares = [{ id: 104, user_id: "richardbrown1" }] } = {}) {
  const videos = new Map();
  const chunks = new Map();
  let next = 1;
  const runQuery = async (sql, args = []) => {
    if (/^CREATE TABLE/.test(sql)) return {};
    if (/^SELECT id FROM my_mares/.test(sql)) return mares.filter((m) => m.id === args[0] && m.user_id === args[1]);
    if (/^SELECT id FROM horse_videos WHERE ready = 0/.test(sql)) return [...videos.values()].filter((v) => !v.ready && v.created_at < args[0]);
    if (/^INSERT INTO horse_videos/.test(sql)) {
      const [kind, subject_id, subject_name, owner_id, title, type, bytes, n, uploaded_by, created_at] = args;
      const id = next++;
      videos.set(id, { id, kind, subject_id, subject_name, owner_id, title, type, bytes, chunks: n, ready: 0, uploaded_by, created_at });
      return { insertId: id };
    }
    if (/^SELECT \* FROM horse_videos WHERE id = \?/.test(sql)) return [videos.get(args[0])].filter(Boolean);
    if (/^REPLACE INTO horse_video_chunks/.test(sql)) {
      chunks.set(`${args[0]}:${args[1]}`, Buffer.from(args[2]));
      return {};
    }
    if (/^SELECT COUNT\(\*\) AS n FROM horse_video_chunks/.test(sql)) return [{ n: [...chunks.keys()].filter((k) => k.startsWith(`${args[0]}:`)).length }];
    if (/^UPDATE horse_videos SET ready = 1/.test(sql)) {
      videos.get(args[0]).ready = 1;
      return {};
    }
    if (/^SELECT id, kind, subject_id/.test(sql)) return [...videos.values()].filter((v) => v.kind === args[0] && v.subject_id === args[1] && v.ready);
    if (/^SELECT content FROM horse_video_chunks/.test(sql)) {
      const c = chunks.get(`${args[0]}:${args[1]}`);
      return c ? [{ content: c }] : [];
    }
    if (/^DELETE FROM horse_video_chunks/.test(sql)) {
      for (const k of [...chunks.keys()]) if (k.startsWith(`${args[0]}:`)) chunks.delete(k);
      return {};
    }
    if (/^DELETE FROM horse_videos/.test(sql)) {
      videos.delete(args[0]);
      return {};
    }
    throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
  };
  return { runQuery, videos, chunks };
}

/** A video of `size` bytes whose byte i is i mod 251, so any slice can be checked. */
const fileOf = (size) => Buffer.from(Array.from({ length: size }, (_, i) => i % 251));

async function upload(v, { kind = "stallion", subjectId = "428161", userId = "richardbrown1", size = CHUNK_BYTES * 2 + 1000 } = {}) {
  const file = fileOf(size);
  const s = await v.start({ kind, subjectId, name: "Notable Speech", title: "Walking, Nov 2026", type: "video/mp4", bytes: size, userId });
  assert.equal(s.status, 200, s.error);
  for (let n = 0; n < s.body.chunks; n += 1) {
    const r = await v.putChunk({ id: s.body.id, n, body: file.subarray(n * CHUNK_BYTES, (n + 1) * CHUNK_BYTES), userId });
    assert.equal(r.status, 200, r.error);
  }
  return { id: s.body.id, file, start: s };
}

const read = async (out) => {
  const bufs = [];
  for await (const b of out.parts()) bufs.push(b);
  return Buffer.concat(bufs);
};

test("a byte range is read the way players ask for it", () => {
  assert.equal(readRange(null, 100), null);
  assert.deepEqual(readRange("bytes=0-", 100), { start: 0, end: 99 });
  assert.deepEqual(readRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(readRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(readRange("bytes=90-500", 100), { start: 90, end: 99 });
  assert.ok(readRange("bytes=100-", 100).error);
  assert.ok(readRange("bytes=0-1,5-6", 100).error);
  assert.deepEqual(chunksFor(5, 25, 10), { first: 0, last: 2, offset: 5 });
});

test("a stallion's video goes up in pieces, is listed once complete, and plays from any point", async () => {
  const v = createVideos(fakeDb());
  const { id, file, start } = await upload(v);
  assert.equal(start.body.chunks, 3);
  assert.deepEqual((await v.list({ kind: "stallion", subjectId: "428161", userId: "TomWilson" })).body.videos, [], "not listed until finished");
  const done = await v.finish({ id, userId: "richardbrown1" });
  assert.equal(done.status, 200);
  const listed = (await v.list({ kind: "stallion", subjectId: "428161", userId: "TomWilson" })).body.videos;
  assert.equal(listed.length, 1, "shared: another user sees it");
  assert.equal(listed[0].title, "Walking, Nov 2026");
  assert.equal(listed[0].bytes, file.length);

  const whole = await v.stream({ id, userId: "TomWilson" });
  assert.equal(whole.status, 200);
  assert.ok((await read(whole)).equals(file));

  // a range across the join of the first two pieces
  const from = CHUNK_BYTES - 10;
  const part = await v.stream({ id, userId: null, range: `bytes=${from}-${from + 19}` });
  assert.equal(part.status, 206);
  assert.equal(part.headers["Content-Range"], `bytes ${from}-${from + 19}/${file.length}`);
  assert.ok((await read(part)).equals(file.subarray(from, from + 20)));
  assert.equal((await v.stream({ id, range: `bytes=${file.length}-` })).status, 416);
});

test("an upload is checked piece by piece and not listed until every piece is in", async () => {
  const v = createVideos(fakeDb());
  const s = await v.start({ kind: "stallion", subjectId: "428161", type: "video/quicktime", bytes: CHUNK_BYTES + 5, userId: "TomWilson" });
  assert.equal((await v.putChunk({ id: s.body.id, n: 0, body: Buffer.alloc(10), userId: "TomWilson" })).status, 400, "a piece of the wrong size");
  assert.equal((await v.putChunk({ id: s.body.id, n: 2, body: Buffer.alloc(5), userId: "TomWilson" })).status, 400, "no third piece");
  assert.equal((await v.putChunk({ id: s.body.id, n: 1, body: Buffer.alloc(5), userId: "someone" })).status, 404, "another user's upload");
  assert.equal((await v.putChunk({ id: s.body.id, n: 1, body: Buffer.alloc(5), userId: "TomWilson" })).status, 200);
  assert.equal((await v.finish({ id: s.body.id, userId: "TomWilson" })).status, 409, "one of two pieces");
  assert.equal((await v.start({ kind: "stallion", subjectId: "1", type: "image/gif", bytes: 10, userId: "u" })).status, 400);
  assert.equal((await v.start({ kind: "stallion", subjectId: "1", type: "video/mp4", bytes: MAX_VIDEO_BYTES + 1, userId: "u" })).status, 400);
  assert.equal((await v.start({ kind: "foal", subjectId: "1", type: "video/mp4", bytes: 10, userId: "u" })).status, 400);
});

test("a mare's video is uploaded and taken down by her owner, and seen by everyone", async () => {
  const db = fakeDb();
  const v = createVideos(db);
  assert.equal((await v.start({ kind: "mare", subjectId: "104", type: "video/mp4", bytes: 10, userId: "TomWilson" })).status, 404, "not his mare");
  const { id } = await upload(v, { kind: "mare", subjectId: "104", userId: "richardbrown1", size: 1000 });
  await v.finish({ id, userId: "richardbrown1" });
  assert.equal((await v.list({ kind: "mare", subjectId: "104", userId: "richardbrown1" })).body.videos.length, 1);
  assert.equal((await v.list({ kind: "mare", subjectId: "104", userId: "TomWilson" })).body.videos.length, 1, "visible to all");
  assert.equal((await v.stream({ id, userId: "TomWilson" })).status, 200);
  assert.equal((await v.remove({ id, userId: "TomWilson" })).status, 404);
  assert.equal((await v.remove({ id, userId: "richardbrown1" })).status, 200);
  assert.equal(db.chunks.size, 0, "its pieces go with it");
});

test("an upload left unfinished for a day is cleared away", async () => {
  const db = fakeDb();
  const v = createVideos(db);
  const s = await v.start({ kind: "stallion", subjectId: "428161", type: "video/mp4", bytes: 10, userId: "u" });
  await v.putChunk({ id: s.body.id, n: 0, body: Buffer.alloc(10), userId: "u" });
  assert.equal(await v.clearStale(new Date(Date.now() + 25 * 3600 * 1000)), 1);
  assert.equal(db.videos.size, 0);
  assert.equal(db.chunks.size, 0);
});
