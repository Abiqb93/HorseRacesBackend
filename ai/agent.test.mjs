import test from "node:test";
import assert from "node:assert/strict";
import { runTool, TOOLS, systemPrompt, AI_LIMITS } from "./agent.mjs";

const TABLES = ["APIData_Table2", "RacesAndEntries", "horseTracking", "UserAccounts"];

/** A stub standing in for the mysql pool: records the SQL, returns fixed rows. */
function stubDb(rowsFor = () => []) {
  const seen = [];
  return {
    seen,
    query(sql, params, cb) {
      const done = typeof params === "function" ? params : cb;
      seen.push(sql);
      done(null, rowsFor(sql));
    },
  };
}

const call = (name, input, db = stubDb()) =>
  runTool({ name, input }, { db, allowedTables: TABLES });

test("every tool has a schema the API will accept", () => {
  for (const t of TOOLS) {
    assert.ok(t.name && t.description, `${t.name} needs a description`);
    assert.equal(t.input_schema.type, "object");
    assert.ok(Array.isArray(t.input_schema.required));
    for (const req of t.input_schema.required) {
      assert.ok(t.input_schema.properties[req], `${t.name}.${req} is required but not defined`);
    }
  }
});

test("list_tables returns the allow-list and nothing else", async () => {
  const out = await call("list_tables", {});
  assert.deepEqual(JSON.parse(out.content).tables, [...TABLES].sort());
});

test("describe_table returns columns and examples for an allowed table", async () => {
  const db = stubDb((sql) =>
    sql.startsWith("SHOW COLUMNS")
      ? [{ Field: "horseName", Type: "varchar(255)", Null: "YES" }]
      : [{ horseName: "Avec Toi" }],
  );
  const out = await call("describe_table", { table: "APIData_Table2" }, db);
  const parsed = JSON.parse(out.content);
  assert.equal(parsed.table, "APIData_Table2");
  assert.deepEqual(parsed.columns, [{ name: "horseName", type: "varchar(255)", nullable: true }]);
  assert.deepEqual(parsed.example_rows, [{ horseName: "Avec Toi" }]);
});

test("describe_table refuses a table off the list, and never touches the database", async () => {
  const db = stubDb();
  const out = await call("describe_table", { table: "mysql.user" }, db);
  assert.equal(out.is_error, true);
  assert.equal(db.seen.length, 0);
});

test("query_database caps rows without discarding the model's own ordering", async () => {
  const db = stubDb(() => [{ n: 1 }]);
  await call("query_database", { sql: "SELECT n FROM APIData_Table2 ORDER BY n DESC LIMIT 5" }, db);
  const ran = db.seen[0];
  assert.ok(ran.includes("ORDER BY n DESC LIMIT 5"), "the model's query is preserved");
  assert.ok(ran.endsWith(`LIMIT ${AI_LIMITS.ROW_CAP}`), "and wrapped in the cap");
});

test("query_database reports the cap so the model knows the answer may be partial", async () => {
  const rows = Array.from({ length: AI_LIMITS.ROW_CAP }, (_, i) => ({ i }));
  const db = stubDb(() => rows);
  const out = await call("query_database", { sql: "SELECT i FROM APIData_Table2" }, db);
  const parsed = JSON.parse(out.content);
  assert.equal(parsed.row_count, AI_LIMITS.ROW_CAP);
  assert.match(parsed.capped, /cap/);
});

test("a write never reaches the database", async () => {
  const db = stubDb();
  for (const sql of [
    "DELETE FROM horseTracking",
    "UPDATE APIData_Table2 SET positionOfficial = 1",
    "SELECT 1 FROM APIData_Table2; DROP TABLE APIData_Table2",
    "SELECT * FROM UserAccounts",
  ]) {
    const out = await call("query_database", { sql }, db);
    assert.equal(out.is_error, true, sql);
  }
  assert.equal(db.seen.length, 0, "nothing was executed");
});

test("a failing query comes back as a readable tool error, not an exception", async () => {
  const db = {
    query(sql, params, cb) {
      (typeof params === "function" ? params : cb)(new Error("Unknown column 'nope'"));
    },
  };
  const out = await call("query_database", { sql: "SELECT nope FROM APIData_Table2" }, db);
  assert.equal(out.is_error, true);
  assert.match(out.content, /Unknown column/);
});

test("list_site_pages gives hash-routed links the model can hand the user", async () => {
  const parsed = JSON.parse((await call("list_site_pages", {})).content);
  assert.ok(parsed.pages.length > 10);
  assert.match(parsed.note, /hash routing/);
  for (const page of parsed.pages) assert.ok(page.path.startsWith("/dashboard/"), page.path);
});

test("get_dataset rejects a name that is not a published dataset", async () => {
  const out = await call("get_dataset", { name: "../../etc/passwd" });
  assert.equal(out.is_error, true);
  assert.match(out.content, /Unknown dataset/);
});

test("an unknown tool is an error, not a crash", async () => {
  const out = await call("delete_everything", {});
  assert.equal(out.is_error, true);
});

test("the system prompt tells the model what it is and cannot do", () => {
  const p = systemPrompt({ userId: "TomWilson", today: "2026-09-08" });
  assert.match(p, /TomWilson/);
  assert.match(p, /2026-09-08/);
  assert.match(p, /only read/i);
  assert.match(p, /describe_table/);
});
