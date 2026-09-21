#!/usr/bin/env node
/**
 * Put a bloodstock desk's own mating pack into a user's band.
 *
 * A mating pack is a client's whole broodmare band as the desk works it: an
 * index of who is in foal to what and when she was last served, a two-page
 * report per mare, and a list of which stallions were considered and ruled
 * out. This reads one of those, transcribed to JSON, and writes it through
 * the API — `my_mares` for identity, `mare_seasons` for what happened, and a
 * `mating_plans` row per mare for what is proposed.
 *
 *   node scripts/seed-band.mjs --fixture breeding/fixtures/wathnan-2027.json --dry-run
 *   node scripts/seed-band.mjs --fixture … --api http://localhost:8080 --user richardbrown1
 *
 * ## Through the API, not the database
 *
 * It needs no credentials, it exercises the same write paths the pages use,
 * and it can be run against a local server before it is ever pointed at the
 * live one. The cost is that it cannot fix anything the API cannot express,
 * which is the right constraint for a script that writes to a colleague's
 * list.
 *
 * ## Identity is where this goes wrong, so identity is what it refuses to guess
 *
 * A mare already on the list must be updated, never duplicated. The unique
 * key is (user, name, foaling year), which is enough until a mare is held
 * with no year — one is, ANTISANA, stored with 0 because the results feed
 * that found her did not know her age. An upsert carrying her real year would
 * write a second ANTISANA rather than mending the first, so an existing row
 * is found by name first and patched by id.
 *
 * Enrichment is the other half. Our results data can supply a rating and a
 * country for a mare who raced here, but three of the twenty-nine in this
 * pack share a name with a different horse — one of them by a different
 * stallion in a different country — so a search hit is taken only when the
 * year agrees and the sire either agrees or is unknown to us. Anything else
 * is reported as partial and the fixture's own facts stand.
 *
 * ## It does not fetch a single pedigree
 *
 * A pedigree miss costs minutes upstream and the queue is shared. The script
 * finishes by printing what the band still needs and the command that warms
 * it overnight.
 */

import fs from "node:fs";
import path from "node:path";

import {
  mareNameKey,
  parsePreferenceLines,
  parseStatus,
  parseSuggestion,
  pickSearchHit,
  studName,
} from "../breeding/mares.mjs";

const arg = (k, d = null) => {
  const i = process.argv.indexOf(k);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const flag = (k) => process.argv.includes(k);

const API = (arg("--api", process.env.SEED_API || "https://horseracesbackend-production.up.railway.app")).replace(/\/$/, "");
const FIXTURE = arg("--fixture", "breeding/fixtures/wathnan-2027.json");
const DRY = flag("--dry-run");
const ONLY = arg("--only");

const log = (...a) => console.log(...a);

async function api(method, route, body) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* an HTML error page from a proxy is not JSON and says so below */
  }
  if (!res.ok) {
    const err = new Error(json?.error ?? `HTTP ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

/**
 * One fixture row, whichever way it was written.
 *
 * A pack transcribed from the index and one transcribed from the reports
 * name the same facts differently — `plan2026` and `coveringSire`,
 * `suggestion2027` and `suggestion`, a flat row and a `plans2027` array with
 * one entry per source document. Both are legitimate readings of the same
 * pack, so the script accepts either rather than making a transcriber conform
 * to a shape they cannot see the reason for.
 *
 * Where a pack carries more than one plan for the season, the desk's own
 * report wins: it is the document the client was sent.
 */
export function normaliseMare(raw = {}) {
  const plans = Array.isArray(raw.plans2027) ? raw.plans2027 : Array.isArray(raw.plans) ? raw.plans : [];
  const master = plans.find((p) => p.source === "master") ?? plans[0] ?? {};
  const season = raw.seasons?.["2026"] ?? raw.seasons?.[2026] ?? {};
  return {
    name: raw.name ?? raw.mare,
    yob: raw.yob,
    sire: raw.sire,
    dam: raw.dam,
    damsire: raw.damsire,
    foaledIn: raw.foaledIn ?? raw.country,
    location: raw.location,
    role: raw.role,
    physical: raw.physical ?? raw.notes ?? null,

    statusLine: raw.statusLine ?? master.statusLine ?? raw.status ?? null,
    seasonStatus: raw.seasonStatus ?? season.status ?? null,
    coveringSire: raw.coveringSire ?? season.coveringSire ?? raw.plan2026 ?? raw.plan ?? null,
    lastServiceDate: raw.lastServiceDate ?? season.lastServiceDate ?? raw.lsd ?? "",
    foaledDate: raw.foaledDate ?? season.foaledDate ?? raw.foaled2026 ?? raw.foaled ?? "",
    foalBy: raw.foalBy ?? season.foalBy ?? "",
    foalSex: raw.foalSex ?? season.foalSex ?? "",

    preferences: master.preferences ?? raw.preferences ?? null,
    preferenceLines: raw.preferenceLines ?? master.preferenceLines ?? [],
    suggestion: raw.suggestion ?? raw.suggestion2027 ?? "",

    raceRecord: raw.raceRecord ?? master.raceRecord ?? null,
    pedigree: raw.pedigree ?? master.pedigree ?? null,
    produceRecord: raw.produceRecord ?? master.produceRecord ?? null,
    analysis: raw.analysis ?? master.analysis ?? null,
    ruledOut: raw.ruledOut ?? master.ruledOut ?? [],
  };
}

/** The preferences for a season, from the report's own lines or the index's. */
export function preferencesFor(mare) {
  if (Array.isArray(mare.preferences) && mare.preferences.length) return mare.preferences;
  const fromReport = parsePreferenceLines(mare.preferenceLines ?? []);
  if (fromReport.length) return fromReport;
  return parseSuggestion(mare.suggestion ?? "");
}

/**
 * The season row the pack describes, from its status line and its columns.
 *
 * `??` alone is not enough here: the normaliser writes "" for a field the
 * pack left blank, and "" is not null, so a status line carrying the service
 * date would be passed over in favour of an empty column. Blank means unset
 * at every step, which is the same rule the API's own bodies follow.
 */
const first = (...vs) => vs.find((v) => v !== undefined && v !== null && v !== "") ?? null;

export function seasonFor(mare) {
  const parsed = parseStatus(mare.statusLine ?? mare.status ?? "") ?? {};
  return {
    status: first(mare.seasonStatus, parsed.status),
    coveringSire: first(mare.coveringSire, parsed.coveringSire, mare.plan),
    lastServiceDate: first(mare.lastServiceDate, parsed.lastServiceDate, mare.lsd) ?? "",
    foaledDate: first(mare.foaledDate, mare.foaled) ?? "",
    foalBy: first(mare.foalBy) ?? "",
    foalSex: first(mare.foalSex) ?? "",
  };
}

async function main() {
  const file = path.resolve(FIXTURE);
  if (!fs.existsSync(file)) {
    console.error(`no fixture at ${file}`);
    console.error("Write one first — see breeding/fixtures/README.md for the shape.");
    process.exit(2);
  }
  const pack = JSON.parse(fs.readFileSync(file, "utf8"));
  const userId = arg("--user", pack.userId);
  const client = arg("--client", pack.client);
  const season = Number(arg("--season", pack.season ?? 2027));
  if (!userId || !client) {
    console.error("the fixture needs a userId and a client, or pass --user and --client");
    process.exit(2);
  }

  const mares = (pack.mares ?? [])
    .map(normaliseMare)
    .filter((m) => !ONLY || mareNameKey(m.name) === mareNameKey(ONLY));
  const fillies = (pack.filliesInTraining ?? []).map(normaliseMare);
  log(`${DRY ? "[dry run] " : ""}${client} → ${userId} at ${API}`);
  log(`${mares.length} mares, ${fillies.length} fillies in training, planning ${season}\n`);

  let held = [];
  try {
    held = (await api("GET", `/api/mares/${encodeURIComponent(userId)}`))?.mares ?? [];
  } catch (err) {
    console.error(`could not read the existing list: ${err.message}`);
    process.exit(1);
  }
  const byKey = new Map();
  for (const row of held) {
    const key = row.name_key ?? mareNameKey(row.horse_name);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  log(`${held.length} mares already on the list\n`);

  const report = [];
  let skipped = 0;

  for (const entry of [...mares, ...fillies.map((f) => ({ ...f, role: "filly_in_training" }))]) {
    const name = studName(entry.name);
    const key = mareNameKey(name);
    const yob = Number(entry.yob) || null;
    const row = {
      userId,
      horseName: name,
      foalingYear: yob,
      countryCode: entry.foaledIn ?? null,
      sireName: studName(entry.sire) || null,
      damName: studName(entry.dam) || null,
      damsireName: studName(entry.damsire) || null,
      clientName: client,
      location: entry.location ?? null,
      role: entry.role ?? "broodmare",
      physical: entry.physical ?? entry.notes ?? null,
    };

    // What our own data can add: a rating, a country, and nothing it
    // contradicts the pack about.
    let matched = "unmatched";
    try {
      const found = await api("GET", `/api/mares/search?q=${encodeURIComponent(name.slice(0, 14))}&limit=10`);
      const hits = (found?.mares ?? []).filter((h) => mareNameKey(h.horse_name) === key);
      const hit = pickSearchHit(hits, { year: yob, sire: row.sireName });
      if (hit) {
        matched = "matched";
        row.bestRating = hit.best_rating ?? null;
        row.countryCode = row.countryCode ?? hit.country_code ?? null;
      } else if (hits.length) {
        matched = "partial";
      }
    } catch (err) {
      matched = `search failed: ${err.message.slice(0, 60)}`;
    }

    const existing = byKey.get(key) ?? [];
    const mine =
      existing.find((r) => Number(r.foaling_year) === Number(yob)) ??
      existing.find((r) => !r.foaling_year) ??
      null;
    if (existing.length > 1 && !mine) {
      log(`  ! ${name}: ${existing.length} rows of that name and none with her year — skipped, resolve by hand`);
      report.push({ name, matched, action: "skipped" });
      skipped += 1;
      continue;
    }

    let id = mine?.id ?? null;
    let action = mine ? "updated" : "created";
    if (!DRY) {
      try {
        const out = await api("POST", "/api/mares", row);
        id = out?.id ?? id;
      } catch (err) {
        log(`  ! ${name}: ${err.message}`);
        report.push({ name, matched, action: "failed" });
        skipped += 1;
        continue;
      }
    }

    // What happened last season, and what is proposed for next.
    const season26 = seasonFor(entry);
    const prefs = preferencesFor(entry);
    let plan = "none";
    if (!DRY && id) {
      if (entry.role !== "filly_in_training" && (season26.status || season26.coveringSire)) {
        await api("PUT", `/api/mares/${encodeURIComponent(userId)}/${id}/seasons/${season - 1}`, season26).catch((err) =>
          log(`  ! ${name}: season ${season - 1}: ${err.message}`),
        );
      }
      if (prefs.length || entry.analysis) {
        // A plan already written is not overwritten: the desk may have edited
        // it, and this script cannot tell its own last run from their work.
        const already = await api("GET", `/api/mares/${encodeURIComponent(userId)}/${id}/plans/${season}`).catch(() => null);
        if (already?.plan) {
          plan = `kept v${already.plan.version}`;
        } else {
          const out = await api("POST", `/api/mares/${encodeURIComponent(userId)}/${id}/plans/${season}`, {
            status: "draft",
            author: userId,
            preferences: prefs,
            ruledOut: entry.ruledOut ?? [],
            sections: {
              race_record: entry.raceRecord ?? null,
              pedigree: entry.pedigree ?? null,
              produce_record: entry.produceRecord ?? null,
              analysis: entry.analysis ?? null,
            },
          }).catch((err) => {
            log(`  ! ${name}: plan: ${err.message}`);
            return null;
          });
          plan = out ? `v${out.version}` : "failed";
        }
      }
    } else if (DRY) {
      action = mine ? "would update" : "would create";
      plan = prefs.length ? `would write ${prefs.length} preference(s)` : "none";
    }

    report.push({
      name,
      matched,
      action,
      plan,
      status: season26.status ?? "—",
      covered: season26.coveringSire ?? "—",
      prefs: prefs.map((p) => p.stallion).join(" / ") || "—",
    });
  }

  log("");
  const w = (s, n) => String(s ?? "").padEnd(n).slice(0, n);
  log(`${w("MARE", 20)} ${w("OUR DATA", 10)} ${w("ACTION", 14)} ${w("2026", 22)} ${w("2027", 34)} PLAN`);
  for (const r of report) {
    log(
      `${w(r.name, 20)} ${w(r.matched, 10)} ${w(r.action, 14)} ${w(`${r.status} ${r.covered}`, 22)} ${w(r.prefs, 34)} ${r.plan ?? ""}`,
    );
  }

  const counts = report.reduce((a, r) => ({ ...a, [r.matched]: (a[r.matched] ?? 0) + 1 }), {});
  log(`\n${report.length} rows: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}`);

  if (!DRY) {
    const targets = await api("GET", `/api/breeding/warm-targets?userId=${encodeURIComponent(userId)}`).catch(() => null);
    if (targets) {
      log(`\n${targets.count} pedigrees still to fetch (${targets.held} held).`);
      log("Warm them overnight, mares first, from the frontend repo:");
      log(`  node scripts/breeding/warm-pedigrees.mjs --bands ${userId} --max-minutes 300`);
    }
  }

  if (skipped) {
    console.error(`\n${skipped} mare(s) were not written. Nothing is half-done, but the band is incomplete.`);
    process.exit(1);
  }
}

// Only when run, so the helpers above can be imported by a test.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
