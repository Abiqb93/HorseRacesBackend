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
  const names = JSON.parse(out.content).tables.map((t) => t.name);
  assert.deepEqual(names, [...TABLES].sort());
});

test("list_tables delivers the notes its own description promises", async () => {
  // the bug this replaced: the description advertised "a one-line note on what
  // each holds" and the tool returned bare names, so the assistant had no way
  // to choose a table except to describe them one at a time
  const promise = TOOLS.find((t) => t.name === "list_tables").description;
  assert.match(promise, /one-line note/);

  const tables = JSON.parse((await call("list_tables", {})).content).tables;
  const main = tables.find((t) => t.name === "APIData_Table2");
  assert.ok(main.note, "the main warehouse table must carry a note");
  assert.match(main.note, /sire/i);
  assert.equal(main.large, true, "it must be flagged as needing a bounded query");
});

test("a table nobody has described is listed without a note, not with a guess", async () => {
  const out = await runTool(
    { name: "list_tables", input: {} },
    { db: stubDb(), allowedTables: ["APIData_Table2", "some_table_nobody_documented"] },
  );
  const tables = JSON.parse(out.content).tables;
  const unknown = tables.find((t) => t.name === "some_table_nobody_documented");
  assert.ok(unknown, "it is still listed");
  assert.equal(unknown.note, undefined, "and carries no invented description");
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

/* ------------------------------------------------------ workspace scoping */

test("an unscoped key is given the workspace header, when one is configured", async () => {
  const { anthropicClient, resetAnthropicClient } = await import("./agent.mjs");
  const before = { key: process.env.ANTHROPIC_API_KEY, ws: process.env.ANTHROPIC_WORKSPACE_ID };
  try {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.ANTHROPIC_WORKSPACE_ID = "wrkspc_abc123";
    resetAnthropicClient();
    const c = anthropicClient();
    // header names are matched case-insensitively by the SDK; ours is lower-case
    const headers = c._options?.defaultHeaders || {};
    assert.equal(headers["anthropic-workspace-id"], "wrkspc_abc123");
  } finally {
    process.env.ANTHROPIC_API_KEY = before.key;
    if (before.ws === undefined) delete process.env.ANTHROPIC_WORKSPACE_ID;
    else process.env.ANTHROPIC_WORKSPACE_ID = before.ws;
    resetAnthropicClient();
  }
});

test("a key that needs no workspace is not given an empty header", async () => {
  const { anthropicClient, resetAnthropicClient } = await import("./agent.mjs");
  const before = { key: process.env.ANTHROPIC_API_KEY, ws: process.env.ANTHROPIC_WORKSPACE_ID };
  try {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.ANTHROPIC_WORKSPACE_ID = "   ";  // blank in the dashboard is not a value
    resetAnthropicClient();
    const c = anthropicClient();
    const headers = c._options?.defaultHeaders || {};
    assert.equal(headers["anthropic-workspace-id"], undefined);
  } finally {
    process.env.ANTHROPIC_API_KEY = before.key;
    if (before.ws === undefined) delete process.env.ANTHROPIC_WORKSPACE_ID;
    else process.env.ANTHROPIC_WORKSPACE_ID = before.ws;
    resetAnthropicClient();
  }
});

test("a missing key still fails with the sentence that says what to do", async () => {
  const { anthropicClient, resetAnthropicClient } = await import("./agent.mjs");
  const before = process.env.ANTHROPIC_API_KEY;
  try {
    delete process.env.ANTHROPIC_API_KEY;
    resetAnthropicClient();
    assert.throws(() => anthropicClient(), /ANTHROPIC_API_KEY is not set/);
  } finally {
    if (before === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = before;
    resetAnthropicClient();
  }
});

test("the workspace error is translated into something actionable", async () => {
  const { explainAgentError } = await import("./agent.mjs");
  const real = "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use.";
  const out = explainAgentError(new Error(real));
  assert.match(out, /ANTHROPIC_WORKSPACE_ID/);
  assert.doesNotMatch(out, /header/, "the reader has no way to set a header");
});

test("an error we have not seen is passed through, not dressed up", async () => {
  const { explainAgentError } = await import("./agent.mjs");
  assert.equal(explainAgentError(new Error("connection reset")), "connection reset");
  assert.match(explainAgentError({}), /failed to answer/);
});

/* ------------------------------------------------------- datasets & steps */

test("every dataset path is one that exists on the site", async () => {
  // "stallions" pointed at /data/stallions/stallions.json, which has never
  // existed - the roster is index.json - so every request for the roster 404d
  const { AI_DATASETS } = await import("./agent.mjs");
  assert.equal(AI_DATASETS.stallions[0], "/data/stallions/index.json");
  // The sales datasets are a directory per sale, so a path may carry one more
  // segment than the flat ones. Both of these were checked against the live
  // site rather than assumed: /data/hitsales/tatts-july-2026/index.json is
  // 1.76 MB and the Arc catalogue 74 kB, both HTTP 200.
  for (const [name, [path]] of Object.entries(AI_DATASETS)) {
    assert.match(path, /^\/data\/[a-z-]+(\/[a-z0-9-]+)?\/[a-z0-9-]+\.json$/, `${name} has an odd path`);
  }
  assert.equal(AI_DATASETS["hit-sale-tatts-july"][0], "/data/hitsales/tatts-july-2026/index.json");
  assert.equal(AI_DATASETS["hit-sale-arc"][0], "/data/hitsales/arc-sale-2026/index.json");
});

test("the assistant can reach the desk's own working lists", async () => {
  // The Review List, the Client List and the notification history are what the
  // product is for, and none of them were reachable: they route through
  // hand-written endpoints, so they were absent from the generic /api/:table
  // allow-list the assistant inherited.
  const { TABLE_NOTES } = await import("./tableNotes.mjs");
  for (const t of [
    "review_horses", "review_horse_actions", "review_conditions",
    "review_rule_preferences", "bloodstock_clients",
  ]) {
    assert.ok(TABLE_NOTES[t], `${t} has no note, so the assistant cannot tell what it holds`);
  }
  assert.match(TABLE_NOTES.bloodstock_clients, /user_id/, "it has to know to scope by user");
  assert.match(TABLE_NOTES.review_horses, /user_id/);
});

test("the brief tells it to bound large tables and not to retry a dead step", () => {
  const p = systemPrompt({ userId: "Richard", today: "2026-09-09" });
  assert.match(p, /Bound every query on a large table/);
  assert.match(p, /do not repeat it in another form/);
  assert.match(p, /rather than describing your way through the schema/);
});

test("no table is described twice", async () => {
  // A second entry for the same table silently wins, and the first is dead
  // text that reads as if it were in force. bloodstock_clients had two, and the
  // fuller one was the one being discarded. The object cannot show this once
  // it is built, so the source is what gets checked.
  const fs = await import("node:fs");
  const url = await import("node:url");
  const src = fs.readFileSync(
    url.fileURLToPath(new URL("./tableNotes.mjs", import.meta.url)),
    "utf8",
  );
  const keys = [...src.matchAll(/^ {2}"?([A-Za-z_][A-Za-z0-9_-]*)"?:/gm)].map((m) => m[1]);
  const seen = new Set();
  const twice = keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
  assert.deepEqual([...new Set(twice)], [], "these tables are described more than once");
});

/* --------------------------------------------------- reaching a big dataset */

/*
 * "Show me the top first-season sires by early indicators" could not be
 * answered from the dataset built to answer it. `early-indicators` holds 1,384
 * stallions at ~2.9 kB each - 4.4 MB against a 60 kB cap - in alphabetical
 * order, so asking for `stallions` returned the sires whose names begin with A.
 *
 * The only escapes offered were a numeric index or the whole file, and the
 * truncation note told the model to "fetch a narrower slice" using a syntax
 * that did not exist. It tried `stallions[?stage==first]`, then
 * `stallions[0:200]`, then gave up on the dataset and hand-rolled fifteen steps
 * of SQL against the warehouse, timing one query out.
 */

const SIRES = [
  { n: "A Different Style", stage: "second", eisAdj: 40.1, cc: "USA", bulk: "x".repeat(50) },
  { n: "Bayside Boy", stage: "first", eisAdj: 70.4, cc: "IRE", bulk: "x".repeat(50) },
  { n: "Blackbeard", stage: "first", eisAdj: 69.3, cc: "IRE", bulk: "x".repeat(50) },
  { n: "Corniche", stage: "first", eisAdj: 67.5, cc: "USA", bulk: "x".repeat(50) },
  { n: "Nomination Only", stage: "first", eisAdj: null, cc: "GB", bulk: "x".repeat(50) },
  { n: "Old Hand", stage: "established", eisAdj: 88.0, cc: "GB", bulk: "x".repeat(50) },
];

test("a path can take a slice, which is what the truncation note has always promised", async () => {
  const { pickPath } = await import("./agent.mjs");
  const doc = { stallions: SIRES };
  assert.deepEqual(pickPath(doc, "stallions[0:2]").map((s) => s.n), ["A Different Style", "Bayside Boy"]);
  assert.deepEqual(pickPath(doc, "stallions[4:]").map((s) => s.n), ["Nomination Only", "Old Hand"]);
  assert.deepEqual(pickPath(doc, "stallions[:1]").map((s) => s.n), ["A Different Style"]);
  assert.equal(pickPath(doc, "stallions[1]").n, "Bayside Boy", "a plain index still works");
  assert.equal(pickPath(doc, "stallions"), doc.stallions, "and no path at all");
});

test("a slice of something that is not an array is nothing, not a crash", async () => {
  const { pickPath } = await import("./agent.mjs");
  assert.equal(pickPath({ a: 1 }, "a[0:2]"), undefined);
  assert.equal(pickPath({ a: 1 }, "missing.deeper"), undefined);
});

test("the question that could not be answered, answered in one call", async () => {
  const { applySelect, pickPath } = await import("./agent.mjs");
  const out = applySelect(pickPath({ stallions: SIRES }, "stallions"), {
    where: { stage: "first" },
    sort: "eisAdj desc",
    limit: 3,
    fields: ["n", "eisAdj"],
  });
  assert.equal(out.matched, 4, "four first-season sires in the file");
  assert.equal(out.of, 6);
  assert.deepEqual(out.items, [
    { n: "Bayside Boy", eisAdj: 70.4 },
    { n: "Blackbeard", eisAdj: 69.3 },
    { n: "Corniche", eisAdj: 67.5 },
  ]);
});

test("a sire with no index is not the best one, and not the worst one either", async () => {
  const { applySelect } = await import("./agent.mjs");
  const asc = applySelect(SIRES.filter((s) => s.stage === "first"), { sort: "eisAdj" });
  const desc = applySelect(SIRES.filter((s) => s.stage === "first"), { sort: "eisAdj desc" });
  assert.equal(asc.items.at(-1).n, "Nomination Only", "sorted low to high, nothing is still last");
  assert.equal(desc.items.at(-1).n, "Nomination Only", "and sorted high to low, still last");
});

test("the operators cover what a sparse dataset actually needs", async () => {
  const { applySelect } = await import("./agent.mjs");
  const names = (sel) => applySelect(SIRES, sel).items.map((s) => s.n);
  assert.deepEqual(names({ where: { cc: { in: ["IRE"] } } }), ["Bayside Boy", "Blackbeard"]);
  assert.deepEqual(names({ where: { eisAdj: { gte: 69 } } }), ["Bayside Boy", "Blackbeard", "Old Hand"]);
  assert.deepEqual(names({ where: { eisAdj: { lte: 41 } } }), ["A Different Style"]);
  assert.deepEqual(names({ where: { stage: { ne: "established" }, eisAdj: { present: true } } }),
    ["A Different Style", "Bayside Boy", "Blackbeard", "Corniche"]);
});

test("selecting only the fields asked for is the difference between 4 MB and 4 kB", async () => {
  const { applySelect } = await import("./agent.mjs");
  const whole = JSON.stringify(SIRES).length;
  const thin = JSON.stringify(applySelect(SIRES, { fields: ["n", "eisAdj"] }).items).length;
  assert.ok(thin < whole / 2, `thinned to ${thin} from ${whole}`);
});

test("select leaves anything that is not an array alone", async () => {
  const { applySelect } = await import("./agent.mjs");
  const obj = { generated: "2026-09-10", year: 2026 };
  assert.equal(applySelect(obj, { sort: "year" }), obj);
  assert.deepEqual(applySelect(SIRES, undefined), SIRES, "and no select at all is the array itself");
});

test("get_dataset tells the model that select exists", async () => {
  const { TOOLS } = await import("./agent.mjs");
  const t = TOOLS.find((x) => x.name === "get_dataset");
  assert.ok(t.input_schema.properties.select, "there is no way to guess a tool argument that is undocumented");
  assert.match(t.input_schema.properties.path.description, /\[0:50\]/, "the slice syntax is shown");
  assert.match(t.input_schema.properties.select.description, /where.*sort.*limit.*fields/s);
});

test("a value we do not hold is not a small value", async () => {
  // Number(null) is 0, so before this a stallion with no index came back as
  // the cheapest, the slowest and the worst-rated of anything asked for.
  const { applySelect } = await import("./agent.mjs");
  const rows = [
    { n: "Rated", eisAdj: 70 },
    { n: "Unrated", eisAdj: null },
    { n: "Missing" },
    { n: "Blank", eisAdj: "   " },
  ];
  const names = (sel) => applySelect(rows, sel).items.map((r) => r.n);
  assert.deepEqual(names({ where: { eisAdj: { lte: 50 } } }), [], "none of them is below 50");
  assert.deepEqual(names({ where: { eisAdj: { gte: 0 } } }), ["Rated"]);
  assert.deepEqual(names({ where: { eisAdj: { present: true } } }), ["Rated", "Blank"],
    "present is about the key being there, which is a different question");
});
