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

/* ------------------------------------------------------- team_activity */

/** A stub that also records the parameters, which is where the subject goes. */
function paramDb(rows = []) {
  const calls = [];
  return {
    calls,
    query(sql, params, cb) {
      const done = typeof params === "function" ? params : cb;
      calls.push({ sql, params: Array.isArray(params) ? params : [] });
      done(null, rows);
    },
  };
}

const teamCall = (input, db, userId) =>
  runTool({ name: "team_activity", input }, { db, allowedTables: TABLES, userId });

test("team_activity names the colleague who asked, and separates the reader's own question", async () => {
  const db = paramDb([
    { user_id: "Stuart", question: "How has Paborus been running?", asked_at: new Date() },
    { user_id: "Richard", question: "Paborus for the Abbaye?", asked_at: new Date() },
  ]);
  const out = await teamCall({ subject: "Paborus (FR)" }, db, "Richard");
  const body = JSON.parse(out.content);

  assert.equal(body.colleagues.length, 1);
  assert.equal(body.colleagues[0].asked_by, "Stuart");
  assert.equal(body.your_own_earlier_questions.length, 1);
  assert.deepEqual(body.who, [{ asked_by: "Stuart", times: 1, most_recent: "today" }]);
});

test("the subject reaches SQL as a bound parameter, never inside the statement", async () => {
  const db = paramDb();
  await teamCall({ subject: "Kodiac'; DROP TABLE x; --" }, db, "Richard");
  const [{ sql, params }] = db.calls;
  assert.ok(!sql.includes("DROP"), "the subject was interpolated into the SQL");
  assert.ok(sql.includes("LIKE ?"));
  assert.ok(params[0].includes("Kodiac"));
});

test("a LIKE wildcard in a name cannot act as a wildcard", async () => {
  // normalisation drops % and _ before the query is built, so they never
  // reach LIKE as metacharacters; the escape behind it is belt and braces
  const db = paramDb();
  await teamCall({ subject: "100% Sure" }, db, "Richard");
  assert.equal(db.calls[0].params[0], "%100 Sure%");
  await teamCall({ subject: "a_b" }, db, "Richard");
  assert.equal(db.calls[1].params[0], "%a b%");
});

test("a subject too short to mean anything is refused rather than matching everything", async () => {
  const db = paramDb([{ user_id: "Stuart", question: "anything", asked_at: new Date() }]);
  const out = await teamCall({ subject: "a" }, db, "Richard");
  assert.equal(out.is_error, true);
  assert.equal(db.calls.length, 0, "it should not have queried at all");
});

test("no subject asks what the desk has been asking generally", async () => {
  const db = paramDb();
  await teamCall({}, db, "Richard");
  assert.ok(!db.calls[0].sql.includes("LIKE"));
});

test("the look-back window is clamped to something sane", async () => {
  const db = paramDb();
  await teamCall({ subject: "Kodiac", days: 99999 }, db, "Richard");
  assert.equal(db.calls[0].params[1], 365);
  await teamCall({ subject: "Kodiac", days: -5 }, db, "Richard");
  assert.equal(db.calls[1].params[1], 90);
});

test("nothing found tells the model to stay quiet rather than report the absence", async () => {
  const db = paramDb([]);
  const body = JSON.parse((await teamCall({ subject: "Kodiac" }, db, "Richard")).content);
  assert.match(body.note, /Say nothing about it/);
});

test("the advisor brief tells it to look for who else is on it", () => {
  const p = systemPrompt({ userId: "Richard", today: "2026-09-09" });
  assert.match(p, /team_activity/);
  assert.match(p, /Do not manufacture a connection/);
});
