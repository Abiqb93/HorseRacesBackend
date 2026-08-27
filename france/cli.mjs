#!/usr/bin/env node
/**
 * France ingestion from the command line, without running the server.
 *
 *   node france/cli.mjs schema                        add the columns and tables
 *   node france/cli.mjs ingest today                  yesterday | today | tomorrow
 *   node france/cli.mjs ingest 2026-08-26             one date, PMU only
 *   node france/cli.mjs ingest today --dry-run        fetch and match, write nothing
 *   node france/cli.mjs backfill 2024-01-01 2024-12-31
 *   node france/cli.mjs reconcile 7
 *   node france/cli.mjs stats
 *
 * Needs DB_HOST, DB_USER, DB_PASSWORD and DB_NAME in the environment, the same
 * ones the server uses.
 */

import { FranceStore } from "./store.mjs";
import { ingestDay, ingestDate, backfill, reconcile, DAYS } from "./ingest.mjs";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const args = argv.filter((a) => !a.startsWith("--"));
const [command, ...rest] = args;

const dryRun = flags.has("--dry-run");
const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const log = (m) => console.log(m);

function report(label, s) {
  const m = s.merge ?? {};
  console.log(`\n${label}${s.dryRun ? "  (dry run — nothing written)" : ""}`);
  console.log(
    `  sources   : France Galop ${s.fg ?? 0} · PMU ${s.pmu ?? 0}` +
      (s.fgError ? `   (FG: ${s.fgError})` : ""),
  );
  console.log(
    `  merged    : ${m.races ?? 0} races, ${s.merged ?? 0} runners ` +
      `(both ${m.racesBoth ?? 0} · FG only ${m.racesFgOnly ?? 0} · PMU only ${m.racesPmuOnly ?? 0})`,
  );
  for (const alias of m.courseAliases ?? []) {
    console.log(
      `  same track: "${alias.pmu}" (PMU) = "${alias.fg}" (FG) — ${alias.sharedRunners} shared runners`,
    );
  }
  if (s.identity) {
    console.log(
      `  identity  : ${s.identity.link} linked · ${s.identity.create} new · ${s.identity.review} for review`,
    );
  }
  if (s.promoted) {
    console.log(
      `  written   : ${s.promoted.inserted} rows into APIData_Table2 ` +
        `(${s.promoted.deleted} replaced), ${s.franceRaceRecords ?? 0} into FranceRaceRecords`,
    );
    if (s.promoted.skippedFields?.length) {
      console.log(`  no column : ${s.promoted.skippedFields.join(", ")}`);
    }
  }
  if (m.conflicts?.length) console.log(`  conflicts : ${m.conflicts.length}`);
}

const store = new FranceStore();

try {
  switch (command) {
    case "schema": {
      const r = await store.ensureSchema();
      console.log(`\nTables ready: ${r.tables.join(", ")}`);
      console.log(
        r.apiColumnsAdded.length
          ? `Added to APIData_Table2: ${r.apiColumnsAdded.join(", ")}`
          : "APIData_Table2 already had everything it needs.",
      );
      break;
    }

    case "ingest": {
      const target = rest[0] ?? "today";
      if (DAYS.includes(target)) {
        report(`Ingested ${target}`, await ingestDay(store, target, { dryRun, log }));
      } else if (isIso(target)) {
        report(`Ingested ${target}`, await ingestDate(store, target, { dryRun, log }));
      } else {
        throw new Error(`ingest expects ${DAYS.join(" | ")} or YYYY-MM-DD`);
      }
      break;
    }

    case "backfill": {
      const [from, to] = rest;
      if (!isIso(from) || !isIso(to)) throw new Error("backfill expects <from> <to> as YYYY-MM-DD");
      const days = await backfill(store, from, to, { dryRun, log });
      const runners = days.reduce((n, d) => n + (d.promoted?.inserted ?? 0), 0);
      const failed = days.filter((d) => d.error);
      console.log(`\nBackfilled ${from} → ${to}: ${days.length} days, ${runners} runners`);
      if (failed.length) {
        console.log(`  ${failed.length} day(s) failed: ${failed.map((f) => f.iso).join(", ")}`);
      }
      break;
    }

    case "reconcile": {
      const out = await reconcile(store, Number(rest[0] ?? 7), { log });
      console.log(`\nReconciled ${out.length} day(s)`);
      break;
    }

    case "stats": {
      const s = await store.stats();
      console.log("\nFrance");
      for (const [k, v] of Object.entries(s)) console.log(`  ${k.padEnd(20)} ${v}`);
      const runs = await store.recentRuns(3);
      for (const r of runs) {
        console.log(`  last run: ${r.target} — ${r.ok ? "ok" : "FAILED"} at ${r.finished_at}`);
      }
      break;
    }

    default:
      console.error(
        "Usage: node france/cli.mjs <schema|ingest|backfill|reconcile|stats> [args] [--dry-run]",
      );
      process.exitCode = 1;
  }
} catch (err) {
  console.error(`\n${err.message}`);
  process.exitCode = 1;
} finally {
  if (store._pool) await store._pool.end();
}
