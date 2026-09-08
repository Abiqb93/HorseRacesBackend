/**
 * The gate every model-written query passes through before it reaches MySQL.
 *
 * BlandfordAI is allowed to read the whole warehouse and to write none of it.
 * That is enforced here rather than trusted to the prompt: a model can be
 * talked into ignoring an instruction, and the pool the API already uses is a
 * read-write one.
 *
 * Three structural checks, each of which alone would stop a write:
 *
 *   1. One statement only. A trailing `; DROP TABLE ...` is rejected before
 *      anything runs, and `multipleStatements` is off on the pool besides.
 *   2. The statement must begin SELECT or WITH. Nothing else is a read, and
 *      MySQL has no way to reach INSERT/UPDATE/DDL from inside one.
 *   3. Every table named must be on the allow-list, so the model cannot read
 *      account credentials or reach into information_schema.
 *
 * Plus a short list of the few functions that are dangerous *inside* a SELECT.
 * It is deliberately short. A long blocklist reads well and works badly here:
 * this warehouse has a column called `Start`, and horses called "Call Me Ted"
 * and "Set The Trend", so scanning raw text for words like START, CALL or SET
 * rejects ordinary questions while adding no safety that checks 1-3 do not
 * already give. String literals are stripped before anything is matched, so a
 * horse's name can never be read as SQL.
 *
 * A row cap and a statement timeout are applied by the caller; those bound cost
 * rather than authority, so they live with the execution rather than here.
 */

/**
 * Functions that are a genuine hazard within a single SELECT: writing a file,
 * reading one off the server's disk, or holding the connection open.
 * `INTO` covers `SELECT ... INTO OUTFILE` and `INTO DUMPFILE`.
 */
const FORBIDDEN = [
  "into", "outfile", "dumpfile", "load_file",
  "sleep", "benchmark", "get_lock", "release_lock",
];

/**
 * Tables holding credentials or another user's private material. These are on
 * the REST API's list because a signed-in page reads its own rows through a
 * scoped route; a free-text query tool has no such scoping, so they come off.
 */
const NEVER_READABLE = new Set(["useraccounts"]);

/** Comments can hide anything, so they go before any other check. */
const stripComments = (sql) =>
  String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* block */
    .replace(/--[^\n]*/g, " ")          // -- line
    .replace(/#[^\n]*/g, " ");          // # line

/**
 * Replace the contents of quoted strings with a placeholder, so that neither
 * the keyword scan nor the table scan can be fooled -- or tripped -- by a horse
 * named "Call Me Ted" or a filter reading `WHERE comment LIKE '%from Ascot%'`.
 * Escaped quotes (both `\'` and `''`) stay inside their string.
 */
const stripStrings = (sql) =>
  String(sql).replace(/'(?:\\.|''|[^'])*'|"(?:\\.|""|[^"])*"/g, "''");

/**
 * Table names as they appear after FROM or JOIN. Backticks are optional and a
 * `db.table` qualifier is allowed through the pattern so a cross-database
 * reference is *seen* here and then rejected by the allow-list, rather than
 * slipping past unmatched.
 */
const TABLE_REF = /\b(?:from|join)\s+((?:`[^`]+`|[A-Za-z0-9_$.-]+))/gi;

const unquote = (name) => String(name).replace(/`/g, "").trim();

export function validateSelect(sql, allowedTables) {
  const raw = String(sql || "").trim();
  if (!raw) return { ok: false, error: "Empty query." };

  // The statement that will actually run: comments gone, one trailing
  // semicolon tolerated and removed.
  const statement = stripComments(raw).trim().replace(/;+\s*$/, "");
  // The statement as it is *inspected*: string contents blanked as well.
  const scannable = stripStrings(statement);

  if (scannable.includes(";")) {
    return { ok: false, error: "One statement per query; remove the semicolon." };
  }
  if (!/^\s*(select|with)\b/i.test(scannable)) {
    return { ok: false, error: "Only SELECT (or WITH ... SELECT) queries are allowed." };
  }

  const lowered = scannable.toLowerCase();
  for (const word of FORBIDDEN) {
    if (new RegExp(`\\b${word}\\b`).test(lowered)) {
      return { ok: false, error: `"${word}" is not allowed in a read query.` };
    }
  }

  const allowed = new Set([...allowedTables].map((t) => String(t).toLowerCase()));

  // A WITH clause names things that are not tables; collect them so
  // `WITH recent AS (...) SELECT * FROM recent` is not rejected.
  const cteNames = new Set(
    [...scannable.matchAll(/\b([A-Za-z0-9_$]+)\s+as\s*\(/gi)].map((m) => m[1].toLowerCase()),
  );

  const referenced = new Set();
  for (const match of scannable.matchAll(TABLE_REF)) {
    const name = unquote(match[1]).toLowerCase();
    if (!name || cteNames.has(name)) continue;
    referenced.add(name);
  }

  if (!referenced.size) {
    return { ok: false, error: "No readable table found in the query." };
  }

  for (const name of referenced) {
    if (NEVER_READABLE.has(name)) {
      return { ok: false, error: `"${name}" holds account credentials and is not readable.` };
    }
    if (!allowed.has(name)) {
      return {
        ok: false,
        error:
          `"${name}" is not a readable table. Call list_tables to see what is. ` +
          `Cross-database and information_schema references are never allowed.`,
      };
    }
  }

  return { ok: true, sql: statement, tables: [...referenced] };
}

export const FORBIDDEN_KEYWORDS = FORBIDDEN;
export const NEVER_READABLE_TABLES = NEVER_READABLE;
