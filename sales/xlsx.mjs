/**
 * The first sheet of an .xlsx file as rows of cell values — just enough of
 * the format to read the sale houses' results exports, with Node's own
 * zlib and no spreadsheet library: an .xlsx is a zip of XML files, and the
 * exports are one sheet of plain strings and numbers.
 */
import zlib from "node:zlib";

/** The files in a zip archive, by name, inflated. */
export function unzip(buf) {
  const files = new Map();
  // The end of central directory record: its offset and count of entries.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = buf.slice(start, start + size);
    files.set(name, method === 8 ? zlib.inflateRawSync(data) : data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (s) => String(s).replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : XML_ENTITIES[e] ?? m));
const colIndex = (ref) => {
  let n = 0;
  for (const ch of String(ref).replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** The first worksheet's rows, each an array of strings and numbers (null where empty). */
export function readSheet(buf) {
  const files = unzip(buf);
  const shared = [];
  const ss = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
    shared.push(unescape((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
  }
  const sheetName = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetName) throw new Error("no worksheet");
  const xml = files.get(sheetName).toString("utf8");
  const rows = [];
  for (const row of xml.match(/<row[^>]*>[\s\S]*?<\/row>|<row[^>]*\/>/g) ?? []) {
    const out = [];
    for (const c of row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
      const ref = (c.match(/ r="([A-Z]+\d+)"/) ?? [])[1];
      const type = (c.match(/ t="(\w+)"/) ?? [])[1];
      const v = (c.match(/<v>([\s\S]*?)<\/v>/) ?? [])[1];
      const inline = (c.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/) ?? [])[1];
      let value = null;
      if (type === "s" && v !== undefined) value = shared[Number(v)] ?? null;
      else if (type === "inlineStr") value = inline !== undefined ? unescape(inline) : null;
      else if (type === "str") value = v !== undefined ? unescape(v) : null;
      else if (v !== undefined) value = Number.isFinite(Number(v)) ? Number(v) : unescape(v);
      out[ref ? colIndex(ref) : out.length] = value;
    }
    for (let i = 0; i < out.length; i += 1) if (out[i] === undefined) out[i] = null;
    rows.push(out);
  }
  return rows;
}

export default { unzip, readSheet };
