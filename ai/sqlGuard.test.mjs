import test from "node:test";
import assert from "node:assert/strict";
import { validateSelect } from "./sqlGuard.mjs";

const TABLES = ["APIData_Table2", "RacesAndEntries", "FranceRaceRecords", "horseTracking", "UserAccounts"];
const check = (sql) => validateSelect(sql, TABLES);

test("passes an ordinary read", () => {
  const r = check("SELECT horseName, positionOfficial FROM APIData_Table2 WHERE meetingDate = '2026-09-06'");
  assert.equal(r.ok, true);
  assert.deepEqual(r.tables, ["apidata_table2"]);
});

test("passes joins, CTEs and aggregates - the queries that make the tool worth having", () => {
  assert.equal(check(`
    WITH recent AS (
      SELECT sireName, positionOfficial FROM APIData_Table2 WHERE meetingDate >= '2026-01-01'
    )
    SELECT sireName, COUNT(*) AS runs FROM recent GROUP BY sireName ORDER BY runs DESC
  `).ok, true);

  assert.equal(check(`
    SELECT a.horseName, t.user
    FROM APIData_Table2 a
    JOIN horseTracking t ON t.horseName = a.horseName
  `).ok, true);
});

test("refuses anything that is not a read", () => {
  for (const sql of [
    "UPDATE APIData_Table2 SET positionOfficial = 1",
    "DELETE FROM RacesAndEntries",
    "DROP TABLE APIData_Table2",
    "INSERT INTO horseTracking (horseName) VALUES ('x')",
  ]) {
    assert.equal(check(sql).ok, false, sql);
  }
});

test("refuses a second statement, however it is hidden", () => {
  assert.equal(check("SELECT 1 FROM APIData_Table2; DROP TABLE APIData_Table2").ok, false);
  // A comment must not be able to smuggle the semicolon past the check.
  assert.equal(check("SELECT 1 FROM APIData_Table2 /* ; */ ; DELETE FROM horseTracking").ok, false);
});

test("refuses a table that is not on the list, and information_schema with it", () => {
  assert.equal(check("SELECT * FROM secrets").ok, false);
  assert.equal(check("SELECT * FROM information_schema.tables").ok, false);
  assert.equal(check("SELECT * FROM mysql.user").ok, false);
  // Allow-listed for the REST API, which scopes by user; not for free-text SQL.
  assert.equal(check("SELECT * FROM UserAccounts").ok, false);
});

test("refuses the functions that are dangerous inside a SELECT", () => {
  assert.equal(check("SELECT * FROM APIData_Table2 INTO OUTFILE '/tmp/x'").ok, false);
  assert.equal(check("SELECT LOAD_FILE('/etc/passwd') FROM APIData_Table2").ok, false);
  assert.equal(check("SELECT SLEEP(30) FROM APIData_Table2").ok, false);
  assert.equal(check("SELECT BENCHMARK(9999999, MD5('x')) FROM APIData_Table2").ok, false);
});

test("a horse's name is data, never SQL", () => {
  // These all failed a naive keyword blocklist. They are real horse names and
  // real column names, and the tool is worthless if it rejects them.
  assert.equal(check("SELECT * FROM APIData_Table2 WHERE horseName = 'Call Me Ted'").ok, true);
  assert.equal(check("SELECT * FROM APIData_Table2 WHERE horseName = 'Set The Trend'").ok, true);
  assert.equal(check("SELECT * FROM APIData_Table2 WHERE horseName LIKE '%from Ascot%'").ok, true);
  assert.equal(check("SELECT Start FROM FranceRaceRecords").ok, true);
  assert.equal(check("SELECT * FROM APIData_Table2 ORDER BY meetingDate LIMIT 10 OFFSET 20").ok, true);
});

test("a table named inside a string is not a table reference", () => {
  const r = check("SELECT * FROM APIData_Table2 WHERE raceTitle = 'from mysql.user'");
  assert.equal(r.ok, true);
  assert.deepEqual(r.tables, ["apidata_table2"]);
});

test("tolerates one trailing semicolon and strips it", () => {
  const r = check("SELECT 1 FROM APIData_Table2;");
  assert.equal(r.ok, true);
  assert.equal(r.sql.endsWith(";"), false);
});

test("rejects empty and non-select input", () => {
  assert.equal(check("").ok, false);
  assert.equal(check("   ").ok, false);
  assert.equal(check("SHOW TABLES").ok, false);
  assert.equal(check("SELECT 1").ok, false); // no table, nothing to read
});
