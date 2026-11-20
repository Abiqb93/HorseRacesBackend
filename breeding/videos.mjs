/**
 * Videos of a stallion or a mare, kept against their profile (20 November
 * 2026: "add a feature so that a video of a stallion or video of mare can be
 * uploaded to the site against their profile").
 *
 * A stallion's videos are shared, as his description is: everyone sees them,
 * and whoever uploaded one can take it down. A mare's videos belong to the
 * user whose mare she is, as her picture does.
 *
 * The site holds no file store, so a video is kept in the database in pieces
 * of CHUNK_BYTES, each its own row: the page sends it a piece at a time (no
 * one request carries the whole file), and the player is answered a byte
 * range at a time (it can seek without the whole file being read). A video
 * is listed only once every piece has arrived; an upload left unfinished for
 * a day is cleared away.
 *
 * Everything that talks to the database is handed in, so this can be tested
 * without it.
 */

export const VIDEOS = `CREATE TABLE IF NOT EXISTS horse_videos (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kind VARCHAR(16) NOT NULL,
  subject_id VARCHAR(64) NOT NULL,
  subject_name VARCHAR(191) NULL,
  owner_id VARCHAR(64) NULL,
  title VARCHAR(191) NULL,
  type VARCHAR(40) NOT NULL,
  bytes BIGINT NOT NULL,
  chunks INT NOT NULL,
  ready TINYINT NOT NULL DEFAULT 0,
  uploaded_by VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  KEY subject (kind, subject_id)
)`;

export const VIDEO_CHUNKS = `CREATE TABLE IF NOT EXISTS horse_video_chunks (
  video_id INT NOT NULL,
  n INT NOT NULL,
  content MEDIUMBLOB NOT NULL,
  PRIMARY KEY (video_id, n)
)`;

/** Each piece is 4 MB: well inside a MEDIUMBLOB and a request the server takes in one go. */
export const CHUNK_BYTES = 4 * 1024 * 1024;
/** A phone's minute of 1080p is 100 to 150 MB; 300 MB leaves room for two. */
export const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
/** An upload not finished in this long is cleared away. */
export const STALE_MS = 24 * 60 * 60 * 1000;
export const KINDS = new Set(["stallion", "mare"]);
export const TYPES = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"]);

const subjectOk = (id) => /^[A-Za-z0-9-]{1,64}$/.test(String(id ?? ""));

/** The pieces a byte range [start, end] falls in, and where in the first one it starts. */
export function chunksFor(start, end, chunkBytes = CHUNK_BYTES) {
  const first = Math.floor(start / chunkBytes);
  const last = Math.floor(end / chunkBytes);
  return { first, last, offset: start - first * chunkBytes };
}

/**
 * A Range header against a file of `size` bytes: `{ start, end }`, null for
 * the whole file, or `{ error }` when it cannot be met. Only a single range
 * is answered, as every browser's player asks for one.
 */
export function readRange(header, size) {
  if (!header) return null;
  const m = String(header).match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === "" && m[2] === "")) return { error: true };
  let start;
  let end;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return { error: true };
  return { start, end };
}

const shape = (r) => ({
  id: Number(r.id),
  kind: r.kind,
  subjectId: r.subject_id,
  name: r.subject_name ?? null,
  title: r.title ?? null,
  type: r.type,
  bytes: Number(r.bytes),
  uploadedBy: r.uploaded_by,
  uploadedAt: r.created_at ? new Date(r.created_at).toISOString() : null,
});

export function createVideos({ runQuery }) {
  let ready = null;
  const ensure = () => {
    ready =
      ready ??
      Promise.all([runQuery(VIDEOS), runQuery(VIDEO_CHUNKS)]).catch((err) => {
        ready = null;
        throw err;
      });
    return ready;
  };

  /** The mare, if she is this user's. */
  const ownsMare = async (userId, mareId) => {
    const rows = await runQuery("SELECT id FROM my_mares WHERE id = ? AND user_id = ? LIMIT 1", [Number(mareId), String(userId)]);
    return Boolean(rows?.[0]);
  };

  /** May this user see the video? A stallion's, anyone; a mare's, her owner. */
  const canSee = (v, userId) => v.kind === "stallion" || (userId && String(v.owner_id) === String(userId));
  /** May this user take it down? Whoever uploaded it, or the mare's owner. */
  const canDelete = (v, userId) => userId && (String(v.uploaded_by) === String(userId) || (v.kind === "mare" && String(v.owner_id) === String(userId)));

  const byId = async (id) => {
    const rows = await runQuery("SELECT * FROM horse_videos WHERE id = ? LIMIT 1", [Number(id)]);
    return rows?.[0] ?? null;
  };

  /** Uploads left unfinished for a day, and their pieces, go. */
  async function clearStale(now = new Date()) {
    const cutoff = new Date(now.getTime() - STALE_MS);
    const stale = await runQuery("SELECT id FROM horse_videos WHERE ready = 0 AND created_at < ?", [cutoff]);
    for (const r of stale ?? []) {
      await runQuery("DELETE FROM horse_video_chunks WHERE video_id = ?", [Number(r.id)]);
      await runQuery("DELETE FROM horse_videos WHERE id = ?", [Number(r.id)]);
    }
    return (stale ?? []).length;
  }

  /** Start an upload: its row, and how big each piece is to be. */
  async function start({ kind, subjectId, name = null, title = null, type, bytes, userId }) {
    if (!KINDS.has(kind)) return { status: 400, error: "a video is of a stallion or a mare" };
    if (!subjectOk(subjectId)) return { status: 400, error: "that is not a stallion or mare id" };
    if (!userId) return { status: 400, error: "userId is required" };
    const t = String(type ?? "").toLowerCase();
    if (!TYPES.has(t)) return { status: 400, error: "an MP4, MOV or WebM video, please" };
    const size = Number(bytes);
    if (!Number.isInteger(size) || size <= 0) return { status: 400, error: "the video's size is required" };
    if (size > MAX_VIDEO_BYTES) {
      return { status: 400, error: `the video is ${(size / 1048576).toFixed(0)} MB; at most ${MAX_VIDEO_BYTES / 1048576} MB` };
    }
    await ensure();
    if (kind === "mare" && !(await ownsMare(userId, subjectId))) return { status: 404, error: "no such mare on your list" };
    await clearStale().catch(() => 0);
    const chunks = Math.ceil(size / CHUNK_BYTES);
    const res = await runQuery(
      `INSERT INTO horse_videos (kind, subject_id, subject_name, owner_id, title, type, bytes, chunks, ready, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        kind,
        String(subjectId),
        name ? String(name).slice(0, 191) : null,
        kind === "mare" ? String(userId) : null,
        title ? String(title).trim().slice(0, 191) || null : null,
        t,
        size,
        chunks,
        String(userId).slice(0, 64),
        new Date(),
      ],
    );
    return { status: 200, body: { id: Number(res.insertId), chunkBytes: CHUNK_BYTES, chunks } };
  }

  /** One piece of an upload, numbered from 0. Every piece but the last is CHUNK_BYTES long. */
  async function putChunk({ id, n, body, userId }) {
    await ensure();
    const v = await byId(id);
    if (!v || String(v.uploaded_by) !== String(userId)) return { status: 404, error: "no such upload of yours" };
    if (Number(v.ready)) return { status: 409, error: "that video is already complete" };
    const i = Number(n);
    if (!Number.isInteger(i) || i < 0 || i >= Number(v.chunks)) return { status: 400, error: "no such piece" };
    const last = i === Number(v.chunks) - 1;
    const want = last ? Number(v.bytes) - CHUNK_BYTES * i : CHUNK_BYTES;
    if (!body?.length || body.length !== want) return { status: 400, error: `piece ${i} should be ${want} bytes, not ${body?.length ?? 0}` };
    await runQuery("REPLACE INTO horse_video_chunks (video_id, n, content) VALUES (?, ?, ?)", [Number(id), i, body]);
    return { status: 200, body: { id: Number(id), n: i } };
  }

  /** Every piece in: the video is listed. */
  async function finish({ id, userId }) {
    await ensure();
    const v = await byId(id);
    if (!v || String(v.uploaded_by) !== String(userId)) return { status: 404, error: "no such upload of yours" };
    const have = await runQuery("SELECT COUNT(*) AS n FROM horse_video_chunks WHERE video_id = ?", [Number(id)]);
    const got = Number(have?.[0]?.n ?? 0);
    if (got !== Number(v.chunks)) return { status: 409, error: `${got} of ${v.chunks} pieces have arrived` };
    await runQuery("UPDATE horse_videos SET ready = 1 WHERE id = ?", [Number(id)]);
    return { status: 200, body: shape({ ...v, ready: 1 }) };
  }

  /** A stallion's or a mare's videos, newest first. */
  async function list({ kind, subjectId, userId }) {
    if (!KINDS.has(kind) || !subjectOk(subjectId)) return { status: 400, error: "a stallion or mare id, please" };
    await ensure();
    const rows = await runQuery(
      "SELECT id, kind, subject_id, subject_name, owner_id, title, type, bytes, uploaded_by, created_at FROM horse_videos WHERE kind = ? AND subject_id = ? AND ready = 1 ORDER BY created_at DESC, id DESC",
      [kind, String(subjectId)],
    );
    return { status: 200, body: { videos: (rows ?? []).filter((r) => canSee(r, userId)).map(shape) } };
  }

  /**
   * The bytes of a video, or of one range of it: `{ status, headers, parts }`
   * where `parts` is an async generator of Buffers, read a piece at a time.
   */
  async function stream({ id, userId, range = null }) {
    await ensure();
    const v = await byId(id);
    if (!v || !Number(v.ready) || !canSee(v, userId)) return { status: 404, error: "no such video" };
    const size = Number(v.bytes);
    const r = readRange(range, size);
    if (r?.error) return { status: 416, headers: { "Content-Range": `bytes */${size}` }, error: "that range is not in the video" };
    const start = r ? r.start : 0;
    const end = r ? r.end : size - 1;
    const { first, last, offset } = chunksFor(start, end);
    const length = end - start + 1;
    async function* parts() {
      let left = length;
      for (let n = first; n <= last && left > 0; n += 1) {
        const rows = await runQuery("SELECT content FROM horse_video_chunks WHERE video_id = ? AND n = ? LIMIT 1", [Number(id), n]);
        const buf = rows?.[0]?.content;
        if (!buf) return;
        const from = n === first ? offset : 0;
        const piece = buf.subarray(from, Math.min(buf.length, from + left));
        left -= piece.length;
        yield piece;
      }
    }
    const headers = {
      "Content-Type": v.type,
      "Content-Length": String(length),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    };
    if (r) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    return { status: r ? 206 : 200, headers, parts };
  }

  async function remove({ id, userId }) {
    await ensure();
    const v = await byId(id);
    if (!v || !canDelete(v, userId)) return { status: 404, error: "no such video of yours" };
    await runQuery("DELETE FROM horse_video_chunks WHERE video_id = ?", [Number(id)]);
    await runQuery("DELETE FROM horse_videos WHERE id = ?", [Number(id)]);
    return { status: 200, body: { id: Number(id), deleted: true } };
  }

  return { start, putChunk, finish, list, stream, remove, clearStale };
}
