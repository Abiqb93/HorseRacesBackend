/**
 * France Galop import via the parse.bot scraper (france-galop.com API).
 *
 * Endpoints (GET, query-string params, X-API-Key auth):
 *   list_meeting_races?meeting_url=...  races (with race_ids) for one meeting page
 *   get_race_results?race_id=...        race meta + runners (results)
 *   get_race_entries?race_id=...        race meta + declared runners (cards/entries)
 *   search_horse?query=...              identity lookup: name, sex, country, birth_year
 *
 * Day enumeration: france-galop.com gates arbitrary-date browsing behind its
 * Azure AD B2C login, but /en/racing/today and /en/racing/tomorrow are public.
 * We scrape those two pages directly for meeting URLs, expand each through
 * list_meeting_races, and persist every race id in france_race_index — so
 * results for a past date are fetched by the ids captured while that date
 * was still "today"/"tomorrow" (race detail pages stay public by direct id).
 *
 * Results flow into APIData_Table2 and entries into RacesAndEntries — the
 * same tables the platform's pages and horse profiles already read, so
 * French racing appears everywhere with no frontend special-casing. A
 * French horse's first result row (with sire / dam / dam-sire, trainer,
 * owner, sex, age parsed out of France Galop's compound strings) IS its
 * new profile.
 *
 * Identity integrity: horses are resolved on normalised name verified
 * against sire + dam + year of birth (age at race date). A name match
 * whose pedigree disagrees is a different horse and is stored under a
 * " (FR)"-suffixed canonical name. Resolutions live in
 * france_horse_identity; each race's sectional_times_pdf_url is kept in
 * france_sectional_pdfs for the sectionals pipeline to consume.
 *
 * Environment:
 *   PARSEBOT_API_KEY    pmx_... (never committed)
 *   PARSEBOT_FG_SCRAPER scraper id (defaults to the France Galop scraper)
 *   FG_SYNC_TOKEN       shared secret guarding the sync route
 *   FG_AUTOSYNC=1       nightly self-sync (21:30 UTC: today's results,
 *                       tomorrow's entries, catch-up on yesterday's results)
 *   FG_SKIP_COURSES     extra comma-separated course names to skip (the FG
 *                       day pages also list partner meetings abroad)
 *
 * Routes:
 *   POST /api/francegalop/sync { date, kinds?: ["results","entries"], dryRun? }
 *        header x-admin-token — dryRun returns mapped rows, writes nothing
 *   GET  /api/francegalop/status
 */

const SCRAPER_ID = process.env.PARSEBOT_FG_SCRAPER || "717461ba-b59b-4471-b5d9-d3bfee8ced54";
const API_BASE = "https://api.parse.bot/scraper";

const FG_PUBLIC_BASE = "https://www.france-galop.com";

// Partner meetings abroad appear on the FG day pages; skip the recurring ones.
const FOREIGN_COURSES = new Set(
  [
    "SARATOGA", "DEL MAR", "BELMONT", "BELMONT PARK", "AQUEDUCT", "KEENELAND",
    "CHURCHILL DOWNS", "SANTA ANITA", "GULFSTREAM", "GULFSTREAM PARK", "WOODBINE",
    "MEYDAN", "JEBEL ALI", "ABU DHABI", "SHARJAH", "KING ABDULAZIZ",
    ...String(process.env.FG_SKIP_COURSES || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
  ]
);

/** YYYY-MM-DD in Europe/Paris, offset by `plusDays`. */
function parisDate(plusDays = 0) {
  const d = new Date(Date.now() + plusDays * 24 * 3600 * 1000);
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
}

async function callScraper(endpoint, params) {
  const key = process.env.PARSEBOT_API_KEY;
  if (!key) throw new Error("PARSEBOT_API_KEY is not configured");
  const qs = new URLSearchParams(params || {}).toString();
  const res = await fetch(`${API_BASE}/${SCRAPER_ID}/${endpoint}${qs ? `?${qs}` : ""}`, {
    headers: { "X-API-Key": key },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.status === "error" || body?.error) {
    throw new Error(`parse.bot ${endpoint} HTTP ${res.status}: ${JSON.stringify(body).slice(0, 250)}`);
  }
  return body?.data ?? body;
}

/* ----------------------------------------------------------------
 * France Galop string parsing
 * ---------------------------------------------------------------- */

const COUNTRIES = "GB|IRE|FR|GER|USA|ITY|SPA|BEL|SWI|JPN|AUS|NZ|SAF|UAE|ARG|BRZ|CHI|CZE|DEN|NOR|SWE|POL|HUN|TUR|GR|HOL|MOR|CAN|IND";

/** "JULIAN SCHNABEL IRE M.PS. 2 a." -> name/country/sex/age. */
function parseCompoundHorse(raw) {
  const s = String(raw || "").replace(/ /g, " ").trim();
  const m = s.match(
    new RegExp(`^(.+?)(?:\\s+(${COUNTRIES}))?\\s+([MFH])\\.?\\s*(?:PS|AQPS|AR)?\\.?\\s+(\\d{1,2})\\s*a\\.?$`, "i")
  );
  if (!m) return { name: s.replace(/\s+/g, " "), country: null, sex: null, age: null };
  return {
    name: m[1].replace(/\s+/g, " ").trim(),
    country: m[2] ? m[2].toUpperCase() : null,
    sex: m[3] ? m[3].toUpperCase() : null,
    age: Number(m[4]),
  };
}

/** "Par: FRANKEL et TOINETTE (SCAT DADDY)" -> sire/dam/damSire. */
function parsePedigree(raw) {
  const m = String(raw || "").match(/Par\s*:\s*(.+?)\s+et\s+(.+?)(?:\s*\(([^)]+)\))?\s*$/i);
  if (!m) return { sire: null, dam: null, damSire: null };
  return { sire: m[1].trim(), dam: m[2].trim(), damSire: m[3] ? m[3].trim() : null };
}

/** "24/08/2026" -> "2026-08-24". */
const isoDate = (fr) => {
  const m = String(fr || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(fr || "").slice(0, 10) || null;
};

/** "1.57.70" -> seconds. */
const winnerTimeSeconds = (t) => {
  const m = String(t || "").match(/(\d+)\.(\d{2})\.(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 100 : null;
};

const normalizeName = (name) =>
  String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(new RegExp(`\\((?:${COUNTRIES})\\)\\s*$`), "")
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const titleCase = (s) =>
  String(s || "").toLowerCase().replace(/(^|[\s-'])[a-z]/g, (c) => c.toUpperCase());

/* ----------------------------------------------------------------
 * DB helpers
 * ---------------------------------------------------------------- */

function query(db, sql, params) {
  return new Promise((resolve, reject) =>
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
  );
}

async function ensureAuxTables(db) {
  await query(
    db,
    `CREATE TABLE IF NOT EXISTS france_horse_identity (
       id INT AUTO_INCREMENT PRIMARY KEY,
       canonicalName VARCHAR(120) NOT NULL,
       normalizedName VARCHAR(120) NOT NULL,
       sireName VARCHAR(120), damName VARCHAR(120), yearOfBirth INT,
       fgHorseId VARCHAR(80), resolution VARCHAR(20) NOT NULL,
       createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       UNIQUE KEY uq_identity (normalizedName, sireName, damName, yearOfBirth)
     )`
  );
  await query(
    db,
    `CREATE TABLE IF NOT EXISTS france_sectional_pdfs (
       id INT AUTO_INCREMENT PRIMARY KEY,
       raceDate VARCHAR(10), courseName VARCHAR(80), raceId VARCHAR(120),
       pdfUrl VARCHAR(400) NOT NULL,
       createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       UNIQUE KEY uq_pdf (pdfUrl)
     )`
  );
  await query(
    db,
    `CREATE TABLE IF NOT EXISTS france_race_index (
       id INT AUTO_INCREMENT PRIMARY KEY,
       raceDate VARCHAR(10) NOT NULL, courseName VARCHAR(80),
       raceId VARCHAR(120) NOT NULL, raceTitle VARCHAR(200), raceTime VARCHAR(20),
       meetingUrl VARCHAR(300),
       createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       UNIQUE KEY uq_race (raceId),
       KEY idx_date (raceDate)
     )`
  );
  await query(
    db,
    `CREATE TABLE IF NOT EXISTS france_sync_log (
       id INT AUTO_INCREMENT PRIMARY KEY,
       runAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       syncDate VARCHAR(10), kind VARCHAR(20),
       races INT, fetched INT, inserted INT, updated INT, conflicts INT, dryRun TINYINT,
       error TEXT
     )`
  );
}

/**
 * Resolve a French horse against everything the platform has seen: match on
 * normalised name, verify on sire + dam + year of birth. A pedigree
 * disagreement under the same name is a different horse -> " (FR)" suffix.
 */
async function resolveHorseIdentity(db, horse) {
  const norm = normalizeName(horse.name);
  const sire = normalizeName(horse.sire);
  const dam = normalizeName(horse.dam);

  const known = await query(
    db,
    `SELECT canonicalName FROM france_horse_identity
      WHERE normalizedName = ? AND IFNULL(sireName,'') = ? AND IFNULL(damName,'') = ?
        AND (yearOfBirth IS NULL OR ? IS NULL OR yearOfBirth = ?) LIMIT 1`,
    [norm, sire, dam, horse.yob, horse.yob]
  );
  if (known.length) return { canonicalName: known[0].canonicalName, resolution: "known" };

  const existing = await query(
    db,
    `SELECT DISTINCT horseName, sireName, damName, horseAge, meetingDate
       FROM APIData_Table2
      WHERE UPPER(REGEXP_REPLACE(horseName, '[[:space:]]*\\\\([A-Za-z]{2,4}\\\\)$', '')) = ?
      LIMIT 20`,
    [norm]
  );

  let resolution = existing.length ? "conflict" : "new";
  let canonicalName = titleCase(horse.name);
  for (const row of existing) {
    const sireOk = !sire || !row.sireName || normalizeName(row.sireName) === sire;
    const damOk = !dam || !row.damName || normalizeName(row.damName) === dam;
    let yobOk = true;
    if (horse.yob && row.horseAge && row.meetingDate) {
      const seasonYear = new Date(row.meetingDate).getFullYear();
      yobOk = Math.abs(seasonYear - Number(row.horseAge) - horse.yob) <= 1;
    }
    if (sireOk && damOk && yobOk) {
      canonicalName = row.horseName;
      resolution = "matched";
      break;
    }
  }
  if (resolution === "conflict") canonicalName = `${titleCase(horse.name)} (FR)`;

  await query(
    db,
    `INSERT IGNORE INTO france_horse_identity
       (canonicalName, normalizedName, sireName, damName, yearOfBirth, fgHorseId, resolution)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [canonicalName, norm, sire || null, dam || null, horse.yob, horse.fgHorseId || null, resolution]
  );
  return { canonicalName, resolution };
}

/* ----------------------------------------------------------------
 * Mapping + upserts
 * ---------------------------------------------------------------- */

function mapRace(race, raceMeta) {
  return {
    meetingDate: isoDate(race.date),
    courseName: titleCase(race.course),
    raceTitle: titleCase(race.race_name),
    going: race.going || null,
    distance: race.distance || null,
    numberOfRunners: (() => {
      const m = String(race.starters_info || "").match(/(\d+)/);
      return m ? Number(m[1]) : (race.runners || []).length;
    })(),
    winnerTimeSeconds: winnerTimeSeconds(race.winner_time),
    scheduledTimeOfRaceLocal: String(raceMeta?.scheduled_time || raceMeta?.time || "").replace(/(\d{1,2})h(\d{2})/, "$1:$2") || null,
    sectionalPdf: race.sectional_times_pdf_url || null,
    raceId: raceMeta?.race_id || null,
  };
}

function mapRunner(r, raceYear) {
  const compound = parseCompoundHorse(r.horse_name);
  const ped = parsePedigree(r.pedigree);
  return {
    name: compound.name,
    country: compound.country || "FR",
    sex: compound.sex,
    age: compound.age,
    yob: compound.age && raceYear ? raceYear - compound.age : null,
    sire: ped.sire,
    dam: ped.dam,
    damSire: ped.damSire,
    position: Number(String(r.position || "").replace(/\D/g, "")) || null,
    cloth: Number(String(r.number || "").replace(/\D/g, "")) || null,
    jockey: titleCase(r.jockey),
    trainer: titleCase(r.trainer),
    owner: titleCase(r.owner),
    weight: r.weight || null,
    margin: r.margin || null,
    fgHorseId: r.horse_id || null,
  };
}

async function upsertResultRow(db, race, runner, canonicalName) {
  const exists = await query(
    db,
    `SELECT id FROM APIData_Table2
      WHERE meetingDate = ? AND courseName = ? AND horseName = ? LIMIT 1`,
    [race.meetingDate, race.courseName, canonicalName]
  );
  if (exists.length) {
    await query(
      db,
      `UPDATE APIData_Table2 SET positionOfficial = ?, numberOfRunners = ? WHERE id = ?`,
      [runner.position, race.numberOfRunners, exists[0].id]
    );
    return "updated";
  }
  await query(
    db,
    `INSERT INTO APIData_Table2
       (meetingDate, courseName, raceTitle, scheduledTimeOfRaceLocal, raceType, countryCode,
        horseName, positionOfficial, numberOfRunners, sireName, damName, damSireName,
        trainerFullName, ownerFullName, jockeyFullName, horseGender, horseAge)
     VALUES (?, ?, ?, ?, 'Flat', 'FR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      race.meetingDate, race.courseName, race.raceTitle, race.scheduledTimeOfRaceLocal,
      canonicalName, runner.position, race.numberOfRunners,
      titleCase(runner.sire), titleCase(runner.dam), titleCase(runner.damSire),
      runner.trainer, runner.owner, runner.jockey, runner.sex, runner.age,
    ]
  );
  return "inserted";
}

async function upsertEntryRow(db, race, runner, canonicalName) {
  const exists = await query(
    db,
    `SELECT 1 FROM RacesAndEntries
      WHERE FixtureDate = ? AND FixtureTrack = ? AND RaceTitle = ? AND HorseName = ? LIMIT 1`,
    [race.meetingDate, race.courseName, race.raceTitle, canonicalName]
  );
  if (exists.length) return "skipped";
  await query(
    db,
    `INSERT INTO RacesAndEntries (FixtureDate, FixtureTrack, RaceTitle, RaceTime, RaceID, HorseName, Trainer, Owner, Jockey)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [race.meetingDate, race.courseName, race.raceTitle, race.scheduledTimeOfRaceLocal, race.raceId, canonicalName, runner.trainer, runner.owner, runner.jockey]
  );
  return "inserted";
}

/* ----------------------------------------------------------------
 * Sync driver
 * ---------------------------------------------------------------- */

/** Meeting URLs on a public FG day page ("today" | "tomorrow"). */
async function fetchDayMeetingUrls(page) {
  const res = await fetch(`${FG_PUBLIC_BASE}/en/racing/${page}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; BlandfordBloodstock/1.0)" },
  });
  if (!res.ok) throw new Error(`france-galop.com /en/racing/${page} HTTP ${res.status}`);
  const html = await res.text();
  const urls = new Set();
  for (const m of html.matchAll(/href="(\/en\/racing\/meeting\/\d{8}\/[^"]+)"/g)) {
    urls.add(`${FG_PUBLIC_BASE}${m[1]}`);
  }
  return [...urls];
}

/**
 * Races for a date. FG only serves today/tomorrow anonymously, so those are
 * enumerated live (and indexed); any other date must come from the index
 * captured while it was current.
 */
async function listRaces(db, date) {
  const stored = await query(
    db,
    `SELECT raceId, courseName, raceTitle, raceTime FROM france_race_index WHERE raceDate = ?`,
    [date]
  ).catch(() => []);
  if (stored.length) {
    return stored.map((r) => ({
      race_id: r.raceId, course: r.courseName, race_name: r.raceTitle, scheduled_time: r.raceTime,
    }));
  }

  const page = date === parisDate(0) ? "today" : date === parisDate(1) ? "tomorrow" : null;
  if (!page) {
    throw new Error(
      `no indexed races for ${date} and france-galop.com only lists today/tomorrow publicly ` +
      `(older days need ids captured while current — run the nightly sync)`
    );
  }

  const races = [];
  for (const meetingUrl of await fetchDayMeetingUrls(page)) {
    if (!meetingUrl.includes(`/meeting/${date.replace(/-/g, "")}/`)) continue;
    let data;
    try {
      data = await callScraper("list_meeting_races", { meeting_url: meetingUrl });
    } catch (err) {
      console.error(`[francegalop] list_meeting_races ${meetingUrl}: ${err.message}`);
      continue;
    }
    const course = String(data?.course || "").toUpperCase().trim();
    if (FOREIGN_COURSES.has(course)) continue;
    for (const r of data?.races || []) {
      if (!r?.race_id) continue;
      races.push({ ...r, course });
      await query(
        db,
        `INSERT IGNORE INTO france_race_index (raceDate, courseName, raceId, raceTitle, raceTime, meetingUrl)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [date, course, String(r.race_id), r.race_name || null, r.scheduled_time || null, meetingUrl]
      ).catch(() => {});
    }
  }
  return races;
}

async function syncDate(db, date, kind, dryRun) {
  const races = await listRaces(db, date);
  const stats = { races: races.length, fetched: 0, inserted: 0, updated: 0, conflicts: 0, skippedRaces: [] };
  const samples = [];
  const raceYear = Number(String(date).slice(0, 4));

  for (const meta of races) {
    const raceId = meta.race_id || meta.raceId || meta.id;
    if (!raceId) continue;
    let payload;
    try {
      payload = await callScraper(kind === "results" ? "get_race_results" : "get_race_entries", { race_id: raceId });
    } catch (err) {
      stats.skippedRaces.push({ raceId, error: String(err.message || err).slice(0, 160) });
      continue;
    }
    const race = mapRace(payload, meta);
    if (race.sectionalPdf && !dryRun) {
      await query(
        db,
        `INSERT IGNORE INTO france_sectional_pdfs (raceDate, courseName, raceId, pdfUrl) VALUES (?, ?, ?, ?)`,
        [race.meetingDate, race.courseName, String(raceId), race.sectionalPdf]
      ).catch(() => {});
    }
    for (const raw of payload.runners || []) {
      const runner = mapRunner(raw, raceYear);
      if (!runner.name) continue;
      stats.fetched += 1;
      if (dryRun) {
        if (samples.length < 8) samples.push({ race: race.raceTitle, ...runner });
        continue;
      }
      const identity = await resolveHorseIdentity(db, runner);
      if (identity.resolution === "conflict") stats.conflicts += 1;
      const outcome =
        kind === "results"
          ? await upsertResultRow(db, race, runner, identity.canonicalName)
          : await upsertEntryRow(db, race, runner, identity.canonicalName);
      if (outcome === "inserted") stats.inserted += 1;
      else if (outcome === "updated") stats.updated += 1;
    }
  }
  return dryRun ? { ...stats, samples } : stats;
}

function registerFranceGalop(app, db) {
  ensureAuxTables(db).catch((err) => console.error("[francegalop] aux tables:", err.message));

  app.post("/api/francegalop/sync", async (req, res) => {
    if (!process.env.FG_SYNC_TOKEN || req.headers["x-admin-token"] !== process.env.FG_SYNC_TOKEN) {
      return res.status(403).json({ error: "forbidden" });
    }
    const { date, kinds, dryRun } = req.body || {};
    if (!date) return res.status(400).json({ error: "date (YYYY-MM-DD) is required" });
    const wanted = Array.isArray(kinds) && kinds.length ? kinds : ["results"];
    const out = {};
    for (const kind of wanted) {
      try {
        out[kind] = await syncDate(db, date, kind, !!dryRun);
        await query(
          db,
          `INSERT INTO france_sync_log (syncDate, kind, races, fetched, inserted, updated, conflicts, dryRun)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [date, kind, out[kind].races, out[kind].fetched, out[kind].inserted, out[kind].updated, out[kind].conflicts, dryRun ? 1 : 0]
        ).catch(() => {});
      } catch (err) {
        out[kind] = { error: String(err.message || err) };
        await query(db, `INSERT INTO france_sync_log (syncDate, kind, error) VALUES (?, ?, ?)`, [date, kind, String(err)]).catch(() => {});
      }
    }
    res.json(out);
  });

  app.get("/api/francegalop/status", (req, res) => {
    db.query(`SELECT * FROM france_sync_log ORDER BY id DESC LIMIT 30`, (err, rows) =>
      err ? res.status(500).json({ error: err.message }) : res.json({ data: rows })
    );
  });

  if (process.env.FG_AUTOSYNC === "1") {
    // nightly ~21:30 UTC (23:30 Paris — racing done): today's results,
    // tomorrow's entries, and a catch-up pass on yesterday via the index.
    let lastRunDay = null;
    setInterval(() => {
      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      if (now.getUTCHours() === 21 && now.getUTCMinutes() >= 30 && lastRunDay !== day) {
        lastRunDay = day;
        syncDate(db, parisDate(0), "results", false).catch((e) => console.error("[francegalop] results:", e.message));
        syncDate(db, parisDate(1), "entries", false).catch((e) => console.error("[francegalop] entries:", e.message));
        syncDate(db, parisDate(-1), "results", false).catch((e) => console.error("[francegalop] catch-up:", e.message));
      }
    }, 10 * 60 * 1000);
  }
}

module.exports = { registerFranceGalop, normalizeName, parseCompoundHorse, parsePedigree, resolveHorseIdentity };
