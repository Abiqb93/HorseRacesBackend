// require("./emailNotifier");

// Import required modules
const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 8080;

const allowedOrigins = [
  'http://localhost:5173', // Local frontend
  'http://localhost:3000', // Local frontend
  'https://horses-website-deployed-production.up.railway.app', // Deployed frontend
  'https://abiqb93.github.io', // GitHub Pages
  'https://www.blandfordbloodstock.tech',
  'http://www.blandfordbloodstock.tech'  
];

const GMAIL_USER = "bloodstockblandford@gmail.com";
const GMAIL_PASS = "bhnf jsgm gpwd jhjo"; // 🔴 MUST be Gmail App Password (16 chars)

// Updated CORS middleware
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or Postman) or from allowed origins
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', "PATCH"], // Allow all HTTP methods you need
  allowedHeaders: ['Content-Type', 'Authorization'], // Specify allowed headers
  credentials: true, // Allow cookies or credentials
}));

// MySQL database connection configuration
const db = mysql.createPool({
  host: "horseprofileshub.czyece6mq0kn.eu-north-1.rds.amazonaws.com",
  user: "abiqb93",
  password: "Saps123$#",
  database: "horseprofileshub",
  port: 3306,
  connectionLimit: 10,
});

// Centralized list of valid tables
const validTables = [
  'sire_profile', 'sire_profile_three', 'sire_profile_one',
  'dam_profile', 'dam_profile_three', 'dam_profile_one',
  'owner_profile', 'owner_profile_three', 'owner_profile_one',
  'jockey_name_profile', 'jockey_name_profile_three', 'jockey_name_profile_one',
  'trainer_name_profile', 'trainer_name_profile_three', 'trainer_name_profile_one',
  'racenets', 'api_races', 'horse_names', 'selected_horses', 'APIData_Table2', 'race_selection_log', 'mareupdates', 'dampedigree_ratings', 'Companies', 
  'sire_age_reports', 'sire_country_reports', 'sire_sex_reports', 'sire_worldwide_reports', 'sire_crop_reports', 'sire_distance_reports', 
  'sire_going_unknown', 'sire_going_firm', 'sire_going_good_firm', 'sire_going_good', 'sire_going_heavy', 'sire_going_soft', 'sire_uplift', 'ClosingEntries',
  'RacesAndEntries', 'horseTracking', 'attheraces', 'FranceRaceRecords', 'IrelandRaceRecords', 'UserAccounts', 'reviewed_results', 'horse_tracking_shares', 'race_watchlist', 
  'sire_tracking', 'dam_tracking', 'owner_tracking', 'predicted_timeform', 'racingpost', 'notify_horses', 'pars_data', 'potential_stallion', 'StrideParsPercentilesPerTrack', 
  'StrideParsPerMeeting', 'RaceNet_Data', 'sire_uplift', 'foalSale_Dashboard', 'foalSale_Pedigree', 'foalSale_StallionStats', 'foalSale_Sales', 'foalSale_StudFeeAnalysis', 'jockey_tracking'
];


// Minimal iCalendar (ICS) meeting request
function buildICSInvite({
  title,
  description = "",
  location = "",
  startUtc,   // "20251224T150000Z"
  endUtc,     // "20251224T153000Z"
  organizerEmail,
  attendeeEmail,
  attendeeName = "Attendee",
}) {
  const uid = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  const dtstamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

  // Escape commas/semicolons/newlines for ICS
  const esc = (s) =>
    String(s || "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");

  return [
    "BEGIN:VCALENDAR",
    "PRODID:-//Blandford Bloodstock//Calendar Invite//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${startUtc}`,
    `DTEND:${endUtc}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc(description)}`,
    `LOCATION:${esc(location)}`,
    `ORGANIZER;CN=${esc("Blandford Bloodstock")}:MAILTO:${organizerEmail}`,
    `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${esc(attendeeName)}:MAILTO:${attendeeEmail}`,
    "TRANSP:OPAQUE",
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

// ---------- Calendar "Add to" link builders ----------
function buildGoogleCalendarLink({ title, description, location, startUtc, endUtc }) {
  // startUtc/endUtc example: "20251224T150000Z"
  const dates = `${startUtc}/${endUtc}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title || "",
    details: description || "",
    location: location || "",
    dates,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function buildOutlookCalendarLink({ title, description, location, startUtc, endUtc }) {
  // Convert "20251224T150000Z" -> "2025-12-24T15:00:00Z"
  const toIso = (s) =>
    `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;

  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: title || "",
    body: description || "",
    location: location || "",
    startdt: toIso(startUtc),
    enddt: toIso(endUtc),
  });

  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[m]));
}


// Convert "YYYY-MM-DDTHH:mm" + timezone offset if you prefer.
// Easiest: send UTC from frontend. If not, convert here carefully.
function toUtcIcsStamp(date) {
  // date: JS Date
  const pad = (n) => String(n).padStart(2, "0");
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, // SSL
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS,
  },
});

transporter.verify((err, success) => {
  if (err) {
    console.error("[mailer] ❌ SMTP verification failed:", err);
  } else {
    console.log("[mailer] ✅ SMTP server is ready to send emails");
  }
});




// GET: Fetch all predicted timeform ratings
app.get('/api/predicted_timeform', (req, res) => {
  const sql = `
    SELECT 
      horseName, 
      DATE_FORMAT(meetingDate, '%Y-%m-%d') AS meetingDate,
      Predicted_timefigure 
    FROM predicted_timeform 
    ORDER BY meetingDate DESC
  `;

  console.log('[API] GET /api/predicted_timeform → running SQL:', sql);

  db.query(sql, (err, results) => {
    if (err) {
      console.error('[ERROR] fetching predicted_timeform:', err);
      return res.status(500).json({ error: 'Database query failed' });
    }

    console.log(`[✅ SUCCESS] Rows fetched from predicted_timeform: ${results.length}`);
    console.table(results.slice(0, 5));
    res.json(results);
  });
});


// GET: Fetch all review horses
app.get('/api/review_horses', (req, res) => {
  const userId = (req.query.user || '').trim();

  // If no userId, fall back to all rows (or block — your choice)
  const sql = userId
    ? `
      SELECT *
      FROM review_horses
      WHERE JSON_SEARCH(reviewStatus, 'one', ?) IS NULL
      ORDER BY id DESC;
    `
    : `SELECT * FROM review_horses ORDER BY id DESC;`;

  const params = userId ? [userId] : [];

  db.query(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database query failed' });
    res.json(rows);
  });
});


app.get('/api/potential_stallion', (req, res) => {
  const sql = `
    SELECT 
      id,
      DATE_FORMAT(meetingDate, '%Y-%m-%d') AS meetingDate,
      horseName,
      performanceRating,
      performanceRatingNum,
      raceTitle,
      courseName,
      DATE_FORMAT(scheduledTimeOfRaceLocal, '%Y-%m-%d %H:%i:%s') AS scheduledTimeOfRaceLocal,
      horseAge,
      sireName,
      damName,
      ownerFullName,
      trainerFullName,
      horseGender,
      horseGenderFull,
      raceType,
      created_at
    FROM potential_stallion
  `;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error('[ERROR] DB query failed:', err);
      return res.status(500).json({ error: 'Database query failed' });
    }
    res.json(rows);
  });
});


function required(body, fields) {
  for (const f of fields) {
    if (body[f] === undefined || body[f] === null || body[f] === "") return f;
  }
  return null;
}


// DELETE /api/notify_horses/by-keys
// Body: { user_id, rec_date, rec_time, track, horse, race }
app.delete("/api/notify_horses/by-keys", (req, res) => {
  const need = required(req.body, ["user_id", "rec_date", "rec_time", "track", "horse", "race"]);
  if (need) return res.status(400).json({ message: `Missing field: ${need}` });

  const { user_id, rec_date, rec_time, track, horse, race } = req.body;
  const sql = `
    DELETE FROM notify_horses
    WHERE user_id = ? AND rec_date = ? AND rec_time = ? AND track = ? AND horse = ? AND race = ?
  `;
  db.query(sql, [user_id, rec_date, rec_time, track, horse, race], (err, r) => {
    if (err) {
      console.error("DELETE /api/notify_horses/by-keys error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
    return res.status(200).json({ ok: true, affectedRows: r.affectedRows });
  });
});


app.get('/api/sire_age_reports', (req, res) => {
  const { sire } = req.query;

  if (!sire) {
    return res.status(400).json({ error: "Missing required query parameter: sire" });
  }

  console.log("Filtering sire_age_reports for sire:", sire);
 
  const query = `
    SELECT * 
    FROM sire_age_reports
    WHERE LOWER(TRIM(Sire)) = LOWER(TRIM(?));
  `;

  db.query(query, [sire], (err, results) => {
    if (err) {
      console.error("Error fetching sire_age_reports:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: results });
  });
});


app.get('/api/ClosingEntries', (req, res) => {
  const query = `SELECT * FROM ClosingEntries`;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching ClosingEntries:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: results });
  });
});

// ✅ Route to fetch all rows from hit_sales1
app.get('/api/hit_sales1', (req, res) => {
  const query = `SELECT * FROM hit_sales1`;

  db.query(query, (err, results) => {
    if (err) {
      console.error("❌ Error fetching hit_sales1:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: results });
  });
});

app.get('/api/ahit_sales', (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 20, 100));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

  const dataSql  = `SELECT * FROM ahit_sales LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) AS total FROM ahit_sales`;

  db.query(dataSql, [limit, offset], (err, results) => {
    if (err) {
      console.error("❌ Error fetching ahit_sales:", err);
      return res.status(500).json({ error: "Database error" });
    }

    db.query(countSql, (err2, countRows) => {
      if (err2) {
        console.error("❌ Error counting ahit_sales:", err2);
        // Fall back to data only if count fails
        return res.status(200).json({ data: results });
      }

      const total = countRows?.[0]?.total ?? 0;
      const nextOffset = offset + results.length;
      const hasMore = nextOffset < total;

      res.status(200).json({
        data: results,
        page: { limit, offset, total, hasMore, nextOffset }
      });
    });
  });
});


// GET /api/tarrersalls_ahit
app.get('/api/tarrersalls_ahit', (req, res) => {
  const rawLimit  = req.query.limit;
  const rawOffset = req.query.offset;

  // If limit/offset are provided, use paged SQL; otherwise return all rows.
  const usePaging = rawLimit !== undefined || rawOffset !== undefined;

  if (usePaging) {
    const limit  = Math.max(1, Math.min(parseInt(rawLimit, 10) || 20, 100));
    const offset = Math.max(0, parseInt(rawOffset, 10) || 0);

    const dataSql  = "SELECT * FROM `tarrersalls_ahit` LIMIT ? OFFSET ?";
    const countSql = "SELECT COUNT(*) AS total FROM `tarrersalls_ahit`";

    db.query(dataSql, [limit, offset], (err, results) => {
      if (err) {
        console.error("❌ Error fetching tarrersalls_ahit:", err);
        return res.status(500).json({ error: "Database error" });
      }

      db.query(countSql, (err2, countRows) => {
        if (err2) {
          console.error("❌ Error counting tarrersalls_ahit:", err2);
          return res.status(200).json({ data: results });
        }

        const total = countRows?.[0]?.total ?? 0;
        const nextOffset = offset + results.length;
        const hasMore = nextOffset < total;

        res.status(200).json({
          data: results,
          page: { limit, offset, total, hasMore, nextOffset }
        });
      });
    });
    return;
  }

  // NO PAGING: return all rows
  const allSql = "SELECT * FROM `tarrersalls_ahit`";
  db.query(allSql, (err, results) => {
    if (err) {
      console.error("❌ Error fetching tarrersalls_ahit (all):", err);
      return res.status(500).json({ error: "Database error" });
    }
    // include a simple page metadata for consistency (everything visible client-side)
    res.status(200).json({
      data: results,
      page: { total: results.length, limit: results.length, offset: 0, hasMore: false, nextOffset: results.length }
    });
  });
});


// PATCH /api/tarrersalls_ahit/:id/star
app.patch('/api/tarrersalls_ahit/:id/star', (req, res) => {
  const rawParam = req.params.id;
  if (!rawParam) {
    return res.status(400).json({ error: "Missing horse name" });
  }

  const horseName = decodeURIComponent(rawParam);
  console.log("🔁 Toggling Star for horse:", JSON.stringify(horseName));

  // Toggle Star: if 1 -> 0, else -> 1
  const toggleSql = `
    UPDATE \`tarrersalls_ahit\`
    SET \`Star\` = CASE WHEN \`Star\` = 1 THEN 0 ELSE 1 END
    WHERE TRIM(\`Horse\`) = TRIM(?);
  `;

  db.query(toggleSql, [horseName], (err, result) => {
    if (err) {
      console.error("❌ Error toggling Star:", err);
      return res.status(500).json({ error: "Database error" });
    }

    console.log("   ➜ affectedRows:", result.affectedRows);

    if (result.affectedRows === 0) {
      // Debug: see what similar horses exist
      const debugSql = "SELECT `Horse` FROM `tarrersalls_ahit` WHERE `Horse` LIKE CONCAT('%', ?, '%') LIMIT 5";
      db.query(debugSql, [horseName.replace(/\s*\(.*\)\s*$/, "")], (dbgErr, dbgRows) => {
        if (dbgErr) {
          console.error("❌ Debug query error:", dbgErr);
        } else {
          console.log("   ⚠️ No exact match. Nearby Horse values:", dbgRows);
        }
        return res.status(404).json({ error: "Horse not found for this name" });
      });
      return;
    }

    // Fetch the updated row
    const fetchSql = "SELECT * FROM `tarrersalls_ahit` WHERE TRIM(`Horse`) = TRIM(?) LIMIT 1";
    db.query(fetchSql, [horseName], (err2, rows) => {
      if (err2) {
        console.error("❌ Error fetching updated row:", err2);
        return res.status(500).json({ error: "Database error" });
      }

      const row = rows[0];
      console.log("   ✅ Star toggled. New Star value:", row?.Star);

      return res.status(200).json({
        message: "Star toggled successfully",
        data: row,
      });
    });
  });
});



// ============================
// Foal Sale API (all tables)
// ============================

// Map sheet names → actual MySQL table names
// Adjust if your sheet/table names differ
const FOALSALE_TABLES = {
  Dashboard:       'foalSale_Dashboard',
  Pedigree:        'foalSale_Pedigree',
  StallionStats:   'foalSale_StallionStats',
  Sales:           'foalSale_Sales',
  StudFeeAnalysis: 'foalSale_StudFeeAnalysis',
};

// Case-insensitive resolver for :sheet param
function resolveFoalSaleTable(sheetParam) {
  if (!sheetParam) return null;

  const key = Object.keys(FOALSALE_TABLES).find(
    (k) => k.toLowerCase() === String(sheetParam).toLowerCase()
  );

  return key ? FOALSALE_TABLES[key] : null;
}

// --------------------------------------------------------
// GET /api/foalSale/:sheet
// Example:
//   /api/foalSale/Dashboard
//   /api/foalSale/Sales?limit=50&offset=100
// --------------------------------------------------------
app.get('/api/foalSale/:sheet', (req, res) => {
  const sheetParam = req.params.sheet;
  const tableName  = resolveFoalSaleTable(sheetParam);

  if (!tableName) {
    return res.status(400).json({ error: `Unknown foalSale sheet: ${sheetParam}` });
  }

  const rawLimit  = req.query.limit;
  const rawOffset = req.query.offset;

  const usePaging = rawLimit !== undefined || rawOffset !== undefined;

  if (usePaging) {
    const limit  = Math.max(1, Math.min(parseInt(rawLimit, 10) || 20, 100));
    const offset = Math.max(0, parseInt(rawOffset, 10) || 0);

    const dataSql  = `SELECT * FROM \`${tableName}\` LIMIT ? OFFSET ?`;
    const countSql = `SELECT COUNT(*) AS total FROM \`${tableName}\``;

    db.query(dataSql, [limit, offset], (err, results) => {
      if (err) {
        console.error(`❌ Error fetching ${tableName}:`, err);
        return res.status(500).json({ error: "Database error" });
      }

      db.query(countSql, (err2, countRows) => {
        if (err2) {
          console.error(`❌ Error counting ${tableName}:`, err2);
          // Return data even if count fails
          return res.status(200).json({ data: results });
        }

        const total      = countRows?.[0]?.total ?? 0;
        const nextOffset = offset + results.length;
        const hasMore    = nextOffset < total;

        res.status(200).json({
          data: results,
          page: { limit, offset, total, hasMore, nextOffset }
        });
      });
    });

    return;
  }

  // NO PAGING: return all rows
  const allSql = `SELECT * FROM \`${tableName}\``;
  db.query(allSql, (err, results) => {
    if (err) {
      console.error(`❌ Error fetching ${tableName} (all):`, err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({
      data: results,
      page: {
        total: results.length,
        limit: results.length,
        offset: 0,
        hasMore: false,
        nextOffset: results.length
      }
    });
  });
});

// --------------------------------------------------------
// PATCH /api/foalSale/:sheet/:horseName/star
//
// Behavior:
//  1) Fetch current Star from the triggering sheet's table
//  2) Toggle it (0 -> 1, 1 -> 0; NULL treated as 0)
//  3) Apply the SAME new Star value to ALL foalSale tables
//     where TRIM(Horse) matches
//  4) Return the updated row from the triggering table
//
// Example:
//   PATCH /api/foalSale/Sales/MY%20FOAL%20NAME/star
// --------------------------------------------------------
// PATCH /api/foalSale/:sheet/:sireName/star
//
// Behavior:
//  1) Fetch current Star from the triggering sheet's table, matching on Sire
//  2) Toggle it (0 -> 1, 1 -> 0; NULL treated as 0)
//  3) Apply the SAME new Star value to ALL foalSale tables
//     where TRIM(Sire) matches
//  4) Return the updated row from the triggering table
// --------------------------------------------------------
app.patch('/api/foalSale/:sheet/:sireName/star', (req, res) => {
  const sheetParam = req.params.sheet;
  const tableName  = resolveFoalSaleTable(sheetParam);

  if (!tableName) {
    return res.status(400).json({ error: `Unknown foalSale sheet: ${sheetParam}` });
  }

  const rawParam = req.params.sireName;
  if (!rawParam) {
    return res.status(400).json({ error: "Missing sire name" });
  }

  const sireName = decodeURIComponent(rawParam);
  console.log(`🔁 Global Star toggle for SIRE in ${tableName}:`, JSON.stringify(sireName));

  // 1) Fetch current Star from the triggering table (NOTE: Sire column)
  const fetchCurrentSql = `
    SELECT \`Star\`
    FROM \`${tableName}\`
    WHERE TRIM(\`Sire\`) = TRIM(?)
    LIMIT 1;
  `;

  db.query(fetchCurrentSql, [sireName], (err, rows) => {
    if (err) {
      console.error(`❌ Error fetching current Star from ${tableName}:`, err);
      return res.status(500).json({ error: "Database error" });
    }

    if (!rows || rows.length === 0) {
      console.log(`⚠️ Sire not found in ${tableName}:`, sireName);
      return res.status(404).json({ error: "Sire not found for this name in this sheet" });
    }

    const currentStar = rows[0].Star === 1 ? 1 : 0; // treat NULL as 0
    const newStar     = currentStar === 1 ? 0 : 1;

    console.log(`   Current Star: ${currentStar} → New Star: ${newStar}`);

    const tables       = Object.values(FOALSALE_TABLES);
    let pending        = tables.length;
    let totalAffected  = 0;
    let alreadySentErr = false;

    // 2) Apply newStar across ALL foalSale tables (matching on Sire)
    tables.forEach((tName) => {
      const updateSql = `
        UPDATE \`${tName}\`
        SET \`Star\` = ?
        WHERE TRIM(\`Sire\`) = TRIM(?);
      `;

      db.query(updateSql, [newStar, sireName], (uErr, result) => {
        if (alreadySentErr) return;

        if (uErr) {
          alreadySentErr = true;
          console.error(`❌ Error updating Star in ${tName}:`, uErr);
          return res.status(500).json({
            error: "Database error while updating Star across tables"
          });
        }

        totalAffected += result.affectedRows;
        pending -= 1;

        // When all updates are done…
        if (!alreadySentErr && pending === 0) {
          console.log(`   ✅ Global Star update done. Total affected rows across tables: ${totalAffected}`);

          if (totalAffected === 0) {
            return res.status(404).json({ error: "Sire not found in any foalSale table" });
          }

          // 3) Fetch updated row from the original table
          const fetchUpdatedSql = `
            SELECT *
            FROM \`${tableName}\`
            WHERE TRIM(\`Sire\`) = TRIM(?)
            LIMIT 1;
          `;
          db.query(fetchUpdatedSql, [sireName], (fErr, updatedRows) => {
            if (fErr) {
              console.error(`❌ Error fetching updated row from ${tableName}:`, fErr);
              return res.status(500).json({ error: "Database error" });
            }

            const row = updatedRows && updatedRows[0] ? updatedRows[0] : null;
            console.log("   ✅ Star toggled globally. New Star value in base sheet:", row?.Star);

            return res.status(200).json({
              message: "Star toggled globally across foalSale tables",
              data: row,
            });
          });
        }
      });
    });
  });
});





app.get('/api/FranceRaceRecords', (req, res) => {
  const query = `SELECT * FROM FranceRaceRecords`;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching FranceRaceRecords:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: results });
  });
});


app.get("/api/attheraces/:horseName", (req, res) => {
  const horseName = req.params.horseName;

  const query = `
    SELECT * FROM attheraces
    WHERE horse = ?
  `;

  db.query(query, [horseName], (err, results) => {
    if (err) {
      console.error("Error fetching sectional data:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (results.length === 0) {
      return res.status(200).json({ data: [], message: "No Sectional Data Found" });
    }

    res.status(200).json({ data: results });
  });
});


app.get("/api/RaceNet_Data/:horseName", (req, res) => {
  const horseName = req.params.horseName;

  const query = `
    SELECT * FROM RaceNet_Data
    WHERE horseName = ?
  `;

  db.query(query, [horseName], (err, results) => {
    if (err) {
      console.error("Error fetching RaceNet_Data data:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (results.length === 0) {
      return res.status(200).json({ data: [], message: "No Data Found" });
    }

    res.status(200).json({ data: results });
  });
});


app.get("/api/sire_uplift/sire/:sireName", (req, res) => {
  const sireName = req.params.sireName;

  if (!sireName) {
    return res.status(400).json({ error: "sireName parameter is required" });
  }

  const query = `
    SELECT *
    FROM sire_uplift
    WHERE sireName LIKE ?
  `;

  // Add wildcards for partial matching
  db.query(query, [`%${sireName}%`], (err, results) => {
    if (err) {
      console.error("Error fetching sire_uplift data by sire:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (!results || results.length === 0) {
      return res.status(200).json({ data: [], message: "No Data Found" });
    }

    return res.status(200).json({ data: results });
  });
});



// ===============================
// Blacktype Fillies Reports Routes
// ===============================
// Assumes you already have: const db = mysql.createConnection(...) OR mysql pool
// and app = express()

// Utility: wraps a table and formats date columns, then orders.
const buildReportQuery = (tableName) => `
  SELECT
    r.*,
    DATE_FORMAT(r.Last_Stakes_Win_Date, '%d-%m-%Y') AS Last_Stakes_Win_Date,
    DATE_FORMAT(r.Last_Run_Date, '%d-%m-%Y')        AS Last_Run_Date
  FROM ${tableName} r
  ORDER BY Stakes_Wins DESC, Highest_Stakes_Position ASC, WinPercent DESC, Runs DESC
`;

// 1) GET full Blacktype Fillies report
app.get("/api/reports/blacktype_fillies", (req, res) => {
  const query = buildReportQuery("report_blacktype_fillies");

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching report_blacktype_fillies:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (!results || results.length === 0) {
      return res.status(200).json({ data: [], message: "No Data Found" });
    }

    // Ensure we only return the formatted date columns (avoid duplicates)
    const cleaned = results.map((row) => {
      // If duplicates exist, keep the formatted string (it will be the latter key in most drivers)
      // Nothing else needed unless your driver returns both; if it does, we normalize here:
      return {
        ...row,
        Last_Stakes_Win_Date: row.Last_Stakes_Win_Date ?? null,
        Last_Run_Date: row.Last_Run_Date ?? null,
      };
    });

    return res.status(200).json({ data: cleaned });
  });
});

// 2) GET full Out-of-Form Blacktype Fillies report
app.get("/api/reports/blacktype_fillies_out_of_form", (req, res) => {
  const query = buildReportQuery("report_blacktype_fillies_out_of_form");

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching report_blacktype_fillies_out_of_form:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (!results || results.length === 0) {
      return res.status(200).json({ data: [], message: "No Data Found" });
    }

    const cleaned = results.map((row) => ({
      ...row,
      Last_Stakes_Win_Date: row.Last_Stakes_Win_Date ?? null,
      Last_Run_Date: row.Last_Run_Date ?? null,
    }));

    return res.status(200).json({ data: cleaned });
  });
});


app.get("/api/reports/female_under80_damvalue", (req, res) => {
  const query = `
    SELECT
      *,
      DATE_FORMAT(CurrentRatingDate, '%Y-%m-%d') AS CurrentRatingDate
    FROM report_female_under80_damvalue
    ORDER BY
      CurrentRating ASC,
      BestProgenyRating DESC,
      DamMaxRating_ifHorse DESC,
      Runs DESC
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching report_female_under80_damvalue:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (!results || results.length === 0) {
      return res.status(200).json({ data: [], message: "No Data Found" });
    }

    return res.status(200).json({ data: results });
  });
});


app.get("/api/attheraces/:time/:racename/:date", (req, res) => {
  const raceTime = req.params.time;       // e.g., "14:40"
  const raceName = req.params.racename;   // e.g., "Southwell"
  const raceDate = req.params.date;       // e.g., "09-06-2025"

  const query = `
    SELECT * FROM attheraces
    WHERE Time = ? AND Racename = ? AND Date = ?
  `;

  db.query(query, [raceTime, raceName, raceDate], (err, results) => {
    if (err) {
      console.error("Error fetching race data:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (results.length === 0) {
      return res.status(200).json({ data: [], message: "No Race Found" });
    }

    res.status(200).json({ data: results });
  });
});

// GET /api/pars/:racename
app.get("/api/pars/:racename", (req, res) => {
  const raceName = (req.params.racename || "").trim(); // don't wrap column in functions => keep index usable
  if (!raceName) {
    return res.status(400).json({ error: "racename is required" });
  }

  const sql = `
    SELECT *
    FROM pars_data
    WHERE Racename = ?
    ORDER BY Dist_f ASC
  `;

  db.query(sql, [raceName], (err, results) => {
    if (err) {
      console.error("Error fetching pars data:", err);
      return res.status(500).json({ error: "Database error" });
    }
    if (!results || results.length === 0) {
      return res.status(200).json({ data: [], message: "No Pars Found" });
    }
    res.status(200).json({ data: results });
  });
});

// GET /api/pars-ga/:racename/:date/:time
// Example: /api/pars-ga/Ascot/26-07-2025/17:15
app.get("/api/pars-ga/:racename/:date/:time", (req, res) => {
  const raceName = decodeURIComponent((req.params.racename || "").trim());
  const dateUK   = (req.params.date || "").trim();   // dd-mm-YYYY expected
  const timeIn   = (req.params.time || "").trim();   // HH:MM or HH:MM:SS (24h) or h:mm AM/PM

  if (!raceName || !dateUK || !timeIn) {
    return res.status(400).json({ error: "racename, date and time are required" });
  }

  // --- helpers ---
  const toISODate = (uk) => {
    // dd-mm-YYYY or dd/mm/YYYY
    const m = uk.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (!m) return null;
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`; // MySQL DATE
  };

  const toHHMMSS = (t) => {
    // 24h: H:MM or HH:MM[:SS]
    let m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
      let hh = m[1].padStart(2, "0");
      const mm = m[2];
      const ss = (m[3] || "00").padStart(2, "0");
      return `${hh}:${mm}:${ss}`;
    }
    // 12h: H:MM AM/PM
    m = t.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
    if (m) {
      let hh = parseInt(m[1], 10);
      const mm = m[2];
      const ap = m[3].toUpperCase();
      if (ap === "PM" && hh < 12) hh += 12;
      if (ap === "AM" && hh === 12) hh = 0;
      return `${String(hh).padStart(2, "0")}:${mm}:00`;
    }
    return null;
  };


  const dateISO = toISODate(dateUK);
  const timeSQL = toHHMMSS(timeIn);

  if (!dateISO || !timeSQL) {
    return res.status(400).json({ error: "Invalid date or time format" });
  }

  const sql = `
    SELECT *
    FROM pars_data_ga
    WHERE Racename = ? AND Date = ? AND Time = ?
    ORDER BY Dist_f ASC
  `;

  db.query(sql, [raceName, dateISO, timeSQL], (err, results) => {
    if (err) {
      console.error("Error fetching pars_data_ga:", err);
      return res.status(500).json({ error: "Database error" });
    }
    if (!results || results.length === 0) {
      return res.status(200).json({ data: [], message: "No rows found" });
    }
    res.status(200).json({ data: results });
  });
});


// GET /api/stride/percentiles/:course
app.get("/api/stride/percentiles/:course", (req, res) => {
  const course = decodeURIComponent((req.params.course || "").trim()); // e.g., "ascot"
  if (!course) {
    return res.status(400).json({ error: "course is required" });
  }

  const sql = `
    SELECT *
    FROM StrideParsPercentilesPerTrack
    WHERE CourseSlug = ?
  `;

  db.query(sql, [course], (err, results) => {
    if (err) {
      console.error("Error fetching stride percentiles:", err);
      return res.status(500).json({ error: "Database error" });
    }
    if (!results || results.length === 0) {
      return res.status(200).json({ data: [], message: "No Percentiles Found" });
    }
    // return as an array (in case you ever store multiple rows per course)
    res.status(200).json({ data: results });
  });
});

// GET /api/stride/meeting/:course/:dateUK
// Example: /api/stride/meeting/aintree/13-04-2023
app.get("/api/stride/meeting/:course/:dateUK", (req, res) => {
  const course = decodeURIComponent((req.params.course || "").trim());
  const dateUK = (req.params.dateUK || "").trim(); // dd-mm-YYYY or dd/mm/YYYY

  if (!course || !dateUK) {
    return res.status(400).json({ error: "course and date are required" });
  }

  // dd-mm-YYYY or dd/mm/YYYY -> YYYY-mm-dd
  const toISODate = (uk) => {
    const m = uk.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (!m) return null;
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  };

  const dateISO = toISODate(dateUK);
  if (!dateISO) {
    return res.status(400).json({ error: "Invalid date format (use dd-mm-YYYY)" });
  }

  const sql = `
    SELECT *
    FROM StrideParsPerMeeting
    WHERE CourseSlug = ?
      AND RaceDate = ?
  `;

  db.query(sql, [course, dateISO], (err, results) => {
    if (err) {
      console.error("Error fetching stride meeting pars:", err);
      return res.status(500).json({ error: "Database error" });
    }
    if (!results || results.length === 0) {
      return res.status(200).json({ data: [], message: "No Meeting Pars Found" });
    }
    res.status(200).json({ data: results });
  });
});


app.get("/api/racingtv/:horseName", (req, res) => {
  const horseName = req.params.horseName;

  const query = `
    SELECT * FROM racingtv
    WHERE horseName = ?
  `;

  db.query(query, [horseName], (err, results) => {
    if (err) {
      console.error("❌ Error fetching RacingTV data:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (results.length === 0) {
      return res.status(200).json({ data: [], message: "No RacingTV Data Found" });
    }

    res.status(200).json({ data: results });
  });
});

app.get("/api/racingtv/url/:raceUrl", (req, res) => {
  const raceUrl = req.params.raceUrl;

  const query = `
    SELECT * FROM racingtv
    WHERE RaceURL = ?
  `;

  db.query(query, [raceUrl], (err, results) => {
    if (err) {
      console.error("❌ Error fetching RacingTV (by RaceURL):", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (results.length === 0) {
      return res.status(200).json({ data: [], message: "No RacingTV Data Found" });
    }

    res.status(200).json({ data: results });
  });
});

app.get('/api/RacesAndEntries', (req, res) => {
  const query = `SELECT * FROM RacesAndEntries`;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching ClosingEntries:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: results });
  });
});


app.get('/api/racingpost', (req, res) => {
  const query = `SELECT * FROM racingpost`;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching ClosingEntries:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: results });
  });
});

app.get('/api/EntriesTracking', (req, res) => {
  const query = `SELECT * FROM EntriesTracking`;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching EntriesTracking:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: results });
  });
});


app.get('/api/DeclarationsTracking', (req, res) => {
  const query = `SELECT * FROM DeclarationsTracking`;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching DeclarationsTracking:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: results });
  });
});


app.get('/api/ConfirmationsTracking', (req, res) => {
  const query = `SELECT * FROM ConfirmationsTracking`;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching ConfirmationsTracking:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: results });
  });
});


app.use(express.json()); 


app.post("/api/calendar/invite", (req, res) => {
  // ✅ DEBUG LOGS: show exactly what the backend receives
  console.log("====== /api/calendar/invite ======");
  console.log("method:", req.method);
  console.log("url:", req.originalUrl);
  console.log("content-type:", req.headers["content-type"]);
  console.log("body (parsed):", req.body);
  console.log("body keys:", req.body ? Object.keys(req.body) : null);
  console.log("==================================");

  const {
    user_id,         // optional if toEmail provided
    toEmail,         // optional if user_id provided
    title,
    description,
    location,
    startUtc,        // "20251224T150000Z"
    endUtc,          // "20251224T153000Z"
    attendeeName,    // optional
  } = req.body || {};

  // ✅ Extra logs for missing fields
  if (!title || !startUtc || !endUtc) {
    console.log("[calendar invite] ❌ Missing required fields:", {
      title,
      startUtc,
      endUtc,
    });
    return res.status(400).json({ error: "title, startUtc, endUtc are required" });
  }

  if (!user_id && !toEmail) {
    console.log("[calendar invite] ❌ Missing recipient:", { user_id, toEmail });
    return res.status(400).json({ error: "Provide user_id or toEmail" });
  }

  const sendInvite = (email) => {
  const organizerEmail = GMAIL_USER; // or process.env.GMAIL_USER

  const ics = buildICSInvite({
    title,
    description,
    location,
    startUtc,
    endUtc,
    organizerEmail,
    attendeeEmail: email,
    attendeeName: attendeeName || email,
  });

  const googleUrl = buildGoogleCalendarLink({ title, description, location, startUtc, endUtc });
const outlookUrl = buildOutlookCalendarLink({ title, description, location, startUtc, endUtc });

const mailOptions = {
  from: `"Blandford Bloodstock" <${organizerEmail}>`,
  to: email,
  subject: `Calendar Invite: ${title}`,

  // ✅ Good practice for meeting requests
  headers: {
    "Content-Class": "urn:content-classes:calendarmessage",
  },

  // Plain-text fallback
  text:
`You have been invited: ${title}

${description || ""}

Location: ${location || ""}

Add to Google Calendar: ${googleUrl}
Add to Outlook Calendar: ${outlookUrl}
`,

  // ✅ Your header card HTML
  html: `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 640px; margin: 0 auto;">
      <div style="border: 1px solid #e6e6e6; border-radius: 14px; overflow: hidden; box-shadow: 0 6px 18px rgba(0,0,0,0.06);">
        <div style="background: #0b5fff; padding: 18px 20px; color: #ffffff;">
          <div style="font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.9;">
            Calendar Invitation
          </div>
          <div style="font-size: 18px; font-weight: 700; line-height: 1.25; margin-top: 6px;">
            You have been invited
          </div>
          <div style="font-size: 14px; line-height: 1.35; margin-top: 8px; opacity: 0.95;">
            ${escapeHtml(title)}
          </div>
        </div>

        <div style="background: #ffffff; padding: 18px 20px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; width: 90px; color: #6b7280; font-size: 13px;">Location</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">
                ${escapeHtml(location || "—")}
              </td>
            </tr>
          </table>

          ${description ? `
            <div style="margin-top: 14px; padding: 12px 14px; background: #f9fafb; border: 1px solid #eef2f7; border-radius: 12px; color: #111827; font-size: 13px; line-height: 1.45;">
              ${escapeHtml(description)}
            </div>
          ` : ""}

          <div style="margin-top: 16px; display: flex; gap: 10px; flex-wrap: wrap;">
            <a href="${googleUrl}" style="display: inline-block; padding: 10px 14px; background: #0b5fff; color: #ffffff; text-decoration: none; border-radius: 10px; font-size: 14px; font-weight: 700;">
              Add to Google Calendar
            </a>
            <a href="${outlookUrl}" style="display: inline-block; padding: 10px 14px; background: #111827; color: #ffffff; text-decoration: none; border-radius: 10px; font-size: 14px; font-weight: 700;">
              Add to Outlook Calendar
            </a>
          </div>

          <div style="margin-top: 14px; color: #6b7280; font-size: 12px; line-height: 1.4;">
            If your email client supports meeting requests, you can also <b>Accept</b> directly from the email.
          </div>
        </div>
      </div>
    </div>
  `,

  // ✅ Most reliable way: include as an attachment, but force INLINE + no “download needed” UX
  // Many clients will still show “Accept” even if an .ics exists, as long as it’s REQUEST + inline.
  attachments: [
    {
      filename: "invite.ics",
      content: ics,
      contentType: "text/calendar; charset=UTF-8; method=REQUEST",
      contentDisposition: "inline",
    },
  ],
};


  transporter.sendMail(mailOptions, (err, info) => {
    if (err) {
      console.error("[calendar invite] sendMail error:", err);
      return res.status(500).json({ error: "Failed to send invite" });
    }
    return res.status(200).json({ message: "Invite sent", to: email });
  });
};


  // If toEmail passed directly, skip DB
  if (toEmail) {
    console.log("[calendar invite] using toEmail directly:", toEmail);
    return sendInvite(String(toEmail).trim());
  }

  // Otherwise fetch from UserAccounts by user_id
  console.log("[calendar invite] lookup by user_id:", user_id);
  db.query(
    "SELECT email, name FROM UserAccounts WHERE user_id = ? LIMIT 1",
    [user_id],
    (err, rows) => {
      if (err) {
        console.error("[calendar invite] ❌ DB error:", err);
        return res.status(500).json({ error: "Database error" });
      }
      if (!rows || rows.length === 0 || !rows[0].email) {
        console.log("[calendar invite] ❌ User email not found for user_id:", user_id);
        return res.status(404).json({ error: "User email not found" });
      }

      const dbName = rows[0].name;
      const finalEmail = String(rows[0].email).trim();
      const finalName = attendeeName || dbName || finalEmail;

      console.log("[calendar invite] DB result:", { finalEmail, finalName });

      // Optional: if you want attendeeName from DB
      req.body.attendeeName = finalName;

      return sendInvite(finalEmail);
    }
  );
});


// ✅ GET: All tracking entries for a specific user
app.get('/api/horseTracking', (req, res) => {
  const { user } = req.query;
  if (!user) {
    return res.status(400).json({ error: "Missing user parameter" });
  }

  const query = `SELECT * FROM horse_tracking WHERE User = ? ORDER BY trackingDate DESC`;
  db.query(query, [user], (err, results) => {
    if (err) {
      console.error("Error fetching tracking:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.status(200).json({ data: results });
  });
});

// ✅ GET: All tracking entries for a specific horse and user
app.get('/api/horseTracking/:horseName', (req, res) => {
  const horseName = req.params.horseName;
  const { user } = req.query;

  if (!user) {
    return res.status(400).json({ error: "Missing user parameter" });
  }

  const query = `SELECT * FROM horse_tracking WHERE horseName = ? AND User = ? ORDER BY noteDateTime DESC`;
  db.query(query, [horseName, user], (err, results) => {
    if (err) {
      console.error("Error fetching horseTracking:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: results });
  });
});

app.post('/api/horseTracking', (req, res) => {
  const {
    horseName,
    note,
    noteDateTime,
    trackingDate,
    trackingType,
    TrackingType,
    user,
    User,
    sireName,
    damName,
    ownerFullName,
    trainerFullName,
    horseAge,
    horseGender,
    horseColour
  } = req.body;

  const finalTrackingType = trackingType || TrackingType || null;
  const finalUser = user || User;

  if (!horseName || !trackingDate || !finalUser) {
    return res.status(400).json({ error: "horseName, trackingDate, and user are required." });
  }

  const query = `
    INSERT INTO horse_tracking (
      horseName,
      note,
      noteDateTime,
      trackingDate,
      TrackingType,
      User,
      sireName,
      damName,
      ownerFullName,
      trainerFullName,
      horseAge,
      horseGender,
      horseColour
    ) VALUES (?, ?, COALESCE(?, NOW()), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    horseName,
    note || null,
    noteDateTime,
    trackingDate,
    finalTrackingType,
    finalUser,
    sireName || null,
    damName || null,
    ownerFullName || null,
    trainerFullName || null,
    horseAge || null,
    horseGender || null,
    horseColour || null
  ];

  db.query(query, values, (err, result) => {
    if (err) {
      console.error("Error inserting horseTracking:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(201).json({ message: "Horse tracking entry added.", id: result.insertId });
  });
});



// ✅ DELETE: Remove tracking entry for a horse and specific user
app.delete('/api/horseTracking/:horseName', (req, res) => {
  const horseName = req.params.horseName;
  const { user } = req.query;

  if (!user) {
    return res.status(400).json({ error: "Missing user parameter" });
  }

  const query = `DELETE FROM horse_tracking WHERE horseName = ? AND User = ?`;
  db.query(query, [horseName, user], (err, result) => {
    if (err) {
      console.error("Error deleting horseTracking:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "No tracking entries found for that horse and user." });
    }

    res.status(200).json({ message: `Deleted ${result.affectedRows} tracking entries.` });
  });
});




// 1. sire_birthyear_reports
app.get('/api/sire_crop_reports', (req, res) => {
  const { sire } = req.query;

  if (!sire) {
    return res.status(400).json({ error: "Missing required query parameter: sire" });
  }

  console.log("Filtering sire_crop_reports for sire:", sire);

  const query = `
    SELECT * 
    FROM sire_crop_reports
    WHERE LOWER(TRIM(Sire)) = LOWER(TRIM(?));
  `;

  db.query(query, [sire], (err, results) => {
    if (err) {
      console.error("Error fetching sire_crop_reports:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: results });
  });
});


// 1. sire_birthyear_reports
app.get('/api/sire_distance_reports', (req, res) => {
  const { sire } = req.query;

  if (!sire) {
    return res.status(400).json({ error: "Missing required query parameter: sire" });
  }

  console.log("Filtering sire_distance_reports for sire:", sire);

  const query = `
    SELECT * 
    FROM sire_distance_reports
    WHERE LOWER(TRIM(Sire)) = LOWER(TRIM(?));
  `;

  db.query(query, [sire], (err, results) => {
    if (err) {
      console.error("Error fetching sire_distance_reports:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: results });
  });
});

// 2. sire_country_reports
app.get('/api/sire_country_reports', (req, res) => {
  const { sire } = req.query;

  if (!sire) {
    return res.status(400).json({ error: "Missing required query parameter: sire" });
  }

  console.log("Filtering sire_country_reports for sire:", sire);

  const query = `
    SELECT * 
    FROM sire_country_reports
    WHERE LOWER(TRIM(Sire)) = LOWER(TRIM(?));
  `;

  db.query(query, [sire], (err, results) => {
    if (err) {
      console.error("Error fetching sire_country_reports:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: results });
  });
});


// 2. sire_country_reports
app.get('/api/sire_country_reports', (req, res) => {
  const { sire } = req.query;

  if (!sire) {
    return res.status(400).json({ error: "Missing required query parameter: sire" });
  }

  console.log("Filtering sire_country_reports for sire:", sire);

  const query = `
    SELECT * 
    FROM sire_country_reports
    WHERE LOWER(TRIM(Sire)) = LOWER(TRIM(?));
  `;

  db.query(query, [sire], (err, results) => {
    if (err) {
      console.error("Error fetching sire_country_reports:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: results });
  });
});


// 3. sire_sex_reports
app.get('/api/sire_sex_reports', (req, res) => {
  const { sire } = req.query;

  if (!sire) {
    return res.status(400).json({ error: "Missing required query parameter: sire" });
  }

  console.log("Filtering sire_sex_reports for sire:", sire);

  const query = `
    SELECT * 
    FROM sire_sex_reports
    WHERE LOWER(TRIM(Sire)) = LOWER(TRIM(?));
  `;

  db.query(query, [sire], (err, results) => {
    if (err) {
      console.error("Error fetching sire_sex_reports:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: results });
  });
});


// 4. sire_worldwide_reports
app.get('/api/sire_worldwide_reports', (req, res) => {
  const { sire } = req.query;

  if (!sire) {
    return res.status(400).json({ error: "Missing required query parameter: sire" });
  }

  console.log("Filtering sire_worldwide_reports for sire:", sire);

  const query = `
    SELECT * 
    FROM sire_worldwide_reports
    WHERE LOWER(TRIM(Sire)) = LOWER(TRIM(?));
  `;

  db.query(query, [sire], (err, results) => {
    if (err) {
      console.error("Error fetching sire_worldwide_reports:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: results });
  });
});


app.get('/api/sire_uplift', (req, res) => {
  const { sire } = req.query;

  if (!sire) {
    return res.status(400).json({ error: "Missing required query parameter: sire" });
  }

  console.log("Filtering sire_uplift for sire:", sire);

  const query = `
    SELECT * 
    FROM sire_uplift
    WHERE LOWER(TRIM(sireName)) = LOWER(TRIM(?));
  `;

  db.query(query, [sire], (err, results) => {
    if (err) {
      console.error("Error fetching sire_uplift:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: results });
  });
});



// Autocomplete suggestions endpoint
app.get('/api/companies/suggestions', (req, res) => {
  const { query } = req.query;

  if (!query || query.trim().length < 2) {
    return res.status(400).json({ error: "Query too short" });
  }

  const searchTerm = `%${query}%`;

  const sql = `
    SELECT DISTINCT company_name, first_name, last_name 
    FROM Companies 
    WHERE 
      first_name LIKE ? OR 
      last_name LIKE ? OR 
      company_name LIKE ?
    LIMIT 10
  `;

  db.query(sql, [searchTerm, searchTerm, searchTerm], (err, results) => {
    if (err) {
      console.error("Error fetching suggestions:", err);
      return res.status(500).json({ error: "Database error" });
    }

    const suggestions = results
      .map((row) => row.company_name || row.first_name || row.last_name)
      .filter(Boolean);

    res.status(200).json([...new Set(suggestions)]);
  });
});


app.get('/api/companies', (req, res) => {
  const {
    query,
    firstName,
    lastName,
    company,
    category,
    country,
    listingCategory,
    region,
    servicesOffered
  } = req.query;

  // ✅ Include `city` in selected columns
  let sql = `
    SELECT 
      company_name,
      first_name,
      last_name,
      category,
      country,
      region,
      city,
      services_offered,
      listing_category,
      email,
      phone,
      website
    FROM Companies
    WHERE 1=1
  `;

  const params = [];

  if (query) {
    const searchTerm = `%${query}%`;
    sql += ` AND (
      first_name LIKE ? OR 
      last_name LIKE ? OR 
      company_name LIKE ? OR 
      category LIKE ? OR 
      country LIKE ? OR 
      city LIKE ? OR 
      email LIKE ? OR 
      phone LIKE ? OR 
      website LIKE ? OR 
      description LIKE ? OR 
      listing_category LIKE ? OR 
      region LIKE ? OR 
      services_offered LIKE ?
    )`;
    for (let i = 0; i < 13; i++) {
      params.push(searchTerm);
    }
  }

  // Optional filters (excluding operatingHours)
  if (firstName) {
    sql += ` AND first_name LIKE ?`;
    params.push(`%${firstName}%`);
  }

  if (lastName) {
    sql += ` AND last_name LIKE ?`;
    params.push(`%${lastName}%`);
  }

  if (company) {
    sql += ` AND company_name LIKE ?`;
    params.push(`%${company}%`);
  }

  if (category) {
    sql += ` AND category LIKE ?`;
    params.push(`%${category}%`);
  }

  if (country) {
    sql += ` AND country LIKE ?`;
    params.push(`%${country}%`);
  }

  if (listingCategory) {
    sql += ` AND listing_category LIKE ?`;
    params.push(`%${listingCategory}%`);
  }

  if (region) {
    sql += ` AND region LIKE ?`;
    params.push(`%${region}%`);
  }

  if (servicesOffered) {
    sql += ` AND services_offered LIKE ?`;
    params.push(`%${servicesOffered}%`);
  }

  db.query(sql, params, (err, results) => {
    if (err) {
      console.error("Error fetching companies:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.status(200).json(results);
  });
});


// app.get('/api/APIData_Table2/horse', (req, res) => {
//   const { horseName } = req.query;

//   if (!horseName) {
//     return res.status(400).json({ error: "Missing required query parameter: horseName" });
//   }

//   const query = `
//     SELECT * 
//     FROM APIData_Table2
//     WHERE LOWER(CONVERT(horseName USING utf8mb4)) = LOWER(CONVERT(? USING utf8mb4));
//   `;

//   db.query(query, [horseName], (err, rows) => {
//     if (err) {
//       console.error("Error fetching records:", err);
//       return res.status(500).json({ error: "Database error" });
//     }

//     res.status(200).json({ data: rows });
//   });
// });

app.get('/api/APIData_Table2/horse', (req, res) => {
  const { horseName } = req.query;

  if (!horseName) {
    return res.status(400).json({ error: "Missing required query parameter: horseName" });
  }

  const startTime = Date.now();

  // Case-insensitive WHERE clause using collation — this **may** still use index
  const query = `
    SELECT * 
    FROM APIData_Table2
    WHERE horseName = ?;
  `;

  db.query(query, [horseName], (err, rows) => {
    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`Query for horse "${horseName}" took ${elapsed.toFixed(2)} seconds`);

    if (err) {
      console.error("Error fetching records:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: rows });
  });
});


app.get('/api/APIData_Table2/sire', (req, res) => {
  const { sireName } = req.query;

  if (!sireName) {
    return res.status(400).json({ error: "Missing required query parameter: sireName" });
  }

  const startTime = Date.now();

  const query = `
    SELECT horseName 
    FROM APIData_Table2
    WHERE sireName = ?;
  `;

  db.query(query, [sireName], (err, rows) => {
    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`Query for sire "${sireName}" took ${elapsed.toFixed(2)} seconds`);

    if (err) {
      console.error("Error fetching records:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: rows });
  });
});



app.get('/api/APIData_Table2/dam', (req, res) => {
  const { damName } = req.query;

  if (!damName) {
    return res.status(400).json({ error: "Missing required query parameter: damName" });
  }

  const startTime = Date.now();

  const query = `
    SELECT horseName 
    FROM APIData_Table2
    WHERE damName = ?;
  `;

  db.query(query, [damName], (err, rows) => {
    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`Query for sire "${damName}" took ${elapsed.toFixed(2)} seconds`);

    if (err) {
      console.error("Error fetching records:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: rows });
  });
});


app.get('/api/APIData_Table2/owner', (req, res) => {
  const { ownerFullName } = req.query;

  if (!ownerFullName) {
    return res.status(400).json({ error: "Missing required query parameter: ownerFullName" });
  }

  const startTime = Date.now();

  const query = `
    SELECT horseName 
    FROM APIData_Table2
    WHERE ownerFullName = ?;
  `;

  db.query(query, [ownerFullName], (err, rows) => {
    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`Query for sire "${ownerFullName}" took ${elapsed.toFixed(2)} seconds`);

    if (err) {
      console.error("Error fetching records:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: rows });
  });
});


app.get('/api/APIData_Table2/jockey', (req, res) => {
  const { jockeyFullName } = req.query;

  if (!jockeyFullName) {
    return res.status(400).json({
      error: "Missing required query parameter: jockeyFullName"
    });
  }

  const startTime = Date.now();

  const query = `
    SELECT horseName
    FROM APIData_Table2
    WHERE jockeyFullName = ?;
  `;

  db.query(query, [jockeyFullName], (err, rows) => {
    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`Query for jockey "${jockeyFullName}" took ${elapsed.toFixed(2)} seconds`);

    if (err) {
      console.error("Error fetching jockey records:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: rows });
  });
});


app.get('/api/APIData_Table2', (req, res) => {
  let { meetingDate } = req.query;

  if (!meetingDate) {
    return res.status(400).json({ error: "meetingDate is required" });
  }

  // Append "00:00:00" to meetingDate to ensure it includes time
  meetingDate = `${meetingDate} 00:00:00`;

  const dataQuery = `
    SELECT * 
    FROM APIData_Table2
    WHERE meetingDate = ?;
  `;

  db.query(dataQuery, [meetingDate], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Database error" });
    }

    res.json({ data: rows });
  });
});


app.get('/api/APIData_Table2/previousPerformance', (req, res) => {
  const { horseName, meetingDate } = req.query;

  if (!horseName || !meetingDate) {
    return res.status(400).json({ error: "horseName and meetingDate are required" });
  }

  const query = `
    SELECT performanceRating
    FROM APIData_Table2
    WHERE horseName = ?
      AND meetingDate < ?
      AND performanceRating IS NOT NULL
    ORDER BY meetingDate DESC
    LIMIT 1;
  `;

  db.query(query, [horseName, meetingDate], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "No previous performance rating found" });
    }

    res.json({ performanceRating: results[0].performanceRating });
  });
});


// app.get('/api/selected_horses', (req, res) => {
//   console.log("GET request received at /api/selected_horses");

//   // Extract user identifiers and sorting parameters
//   const { user_id, user, sortBy, order = 'asc' } = req.query;

//   if (!user_id && !user) {
//     return res.status(400).json({ error: "User ID or username is required" });
//   }

//   // Define valid columns for sorting
//   const validSortColumns = [
//     "HorseName", "Sire", "Dam", "Trainer", "Jockey", "Owner",
//     "Country", "Age", "Runs", "Wins", "Stakes_Wins", "Group_Wins", 
//     "Group_1_Wins", "Earnings"
//   ]; 

//   // Validate sorting column
//   const safeSortBy = sortBy && validSortColumns.includes(sortBy) ? sortBy : null;
//   const safeOrder = order.toLowerCase() === "desc" ? "DESC" : "ASC";

//   // Construct SQL query and parameters
//   let query = `SELECT * FROM selected_horses WHERE `;
//   let params = [];

//   if (user_id) {
//     query += ` user_id = ? `;
//     params.push(user_id);
//   } else if (user) {
//     query += ` user = ? `;
//     params.push(user);
//   }

//   if (safeSortBy) {
//     query += ` ORDER BY \`${safeSortBy}\` ${safeOrder}`;
//   }

//   console.log("Final Query:", query, "Params:", params);

//   db.query(query, params, (err, results) => {
//     if (err) {
//       console.error("Error fetching horses from the database:", err);
//       return res.status(500).json({ error: "Database error" });
//     }

//     console.log(`Horses fetched successfully for user ${user_id || user}: ${results.length} rows`);
//     res.status(200).json(results);
//   });
// });


// GET: Fetch all race logs for a specific user
app.get("/api/race_selection_log", (req, res) => {
  const { user } = req.query;

  if (!user) {
    return res.status(400).json({ error: "User is required" });
  }

  const query = `SELECT * FROM race_selection_log WHERE user = ? ORDER BY meetingDate DESC`;

  db.query(query, [user], (err, results) => {
    if (err) {
      console.error("Error fetching race logs:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.status(200).json({ data: results });
  });
});


app.post("/api/sire_tracking", (req, res) => {
  const { sireName, correspondingHorses, user_id } = req.body;

  if (!sireName || !correspondingHorses || !user_id) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const query = `
    INSERT INTO sire_tracking (sireName, correspondingHorses, user_id)
    VALUES (?, ?, ?);
  `;

  db.query(query, [sireName, JSON.stringify(correspondingHorses), user_id], (err, results) => {
    if (err) {
      console.error("Error saving sire tracking:", err);
      return res.status(500).json({ error: "Database error." });
    }
    res.status(200).json({ message: "Sire tracking saved successfully!" });
  });
});


app.get("/api/sire_tracking", (req, res) => {
  const { user } = req.query;

  if (!user) {
    return res.status(400).json({ error: "User is required" });
  }

  const query = `SELECT * FROM sire_tracking WHERE user_id = ? ORDER BY created_at DESC`;

  db.query(query, [user], (err, results) => {
    if (err) {
      console.error("Error fetching sire tracking:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.status(200).json({ data: results });
  });
});


app.delete("/api/sire_tracking/:id", (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "ID is required" });

  const query = `DELETE FROM sire_tracking WHERE id = ?`;

  db.query(query, [id], (err, result) => {
    if (err) {
      console.error("Error deleting sire tracking:", err);
      return res.status(500).json({ error: "Database error" });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Record not found" });
    }
    res.status(200).json({ message: "Sire tracking deleted successfully." });
  });
});





app.post("/api/dam_tracking", (req, res) => {
  const { damName, correspondingHorses, user_id } = req.body;

  if (!damName || !correspondingHorses || !user_id) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const query = `
    INSERT INTO dam_tracking (damName, correspondingHorses, user_id)
    VALUES (?, ?, ?);
  `;

  db.query(query, [damName, JSON.stringify(correspondingHorses), user_id], (err, results) => {
    if (err) {
      console.error("Error saving dam tracking:", err);
      return res.status(500).json({ error: "Database error." });
    }
    res.status(200).json({ message: "Dam tracking saved successfully!" });
  });
});


app.get("/api/dam_tracking", (req, res) => {
  const { user } = req.query;

  if (!user) {
    return res.status(400).json({ error: "User is required" });
  }

  const query = `SELECT * FROM dam_tracking WHERE user_id = ? ORDER BY created_at DESC`;

  db.query(query, [user], (err, results) => {
    if (err) {
      console.error("Error fetching dam tracking:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.status(200).json({ data: results });
  });
});


app.delete("/api/dam_tracking/:id", (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "ID is required" });

  const query = `DELETE FROM dam_tracking WHERE id = ?`;

  db.query(query, [id], (err, result) => {
    if (err) {
      console.error("Error deleting dam tracking:", err);
      return res.status(500).json({ error: "Database error" });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Record not found" });
    }
    res.status(200).json({ message: "Dam tracking deleted successfully." });
  });
});




app.post("/api/owner_tracking", (req, res) => {
  const { ownerFullName, correspondingHorses, user_id } = req.body;

  if (!ownerFullName || !correspondingHorses || !user_id) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const query = `
    INSERT INTO owner_tracking (ownerFullName, correspondingHorses, user_id)
    VALUES (?, ?, ?);
  `;

  db.query(query, [ownerFullName, JSON.stringify(correspondingHorses), user_id], (err, results) => {
    if (err) {
      console.error("Error saving Owner tracking:", err);
      return res.status(500).json({ error: "Database error." });
    }
    res.status(200).json({ message: "Owner tracking saved successfully!" });
  });
});


app.get("/api/owner_tracking", (req, res) => {
  const { user } = req.query;

  if (!user) {
    return res.status(400).json({ error: "User is required" });
  }

  const query = `SELECT * FROM owner_tracking WHERE user_id = ? ORDER BY created_at DESC`;

  db.query(query, [user], (err, results) => {
    if (err) {
      console.error("Error fetching owner tracking:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.status(200).json({ data: results });
  });
});


app.delete("/api/owner_tracking/:id", (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "ID is required" });

  const query = `DELETE FROM owner_tracking WHERE id = ?`;

  db.query(query, [id], (err, result) => {
    if (err) {
      console.error("Error deleting owner tracking:", err);
      return res.status(500).json({ error: "Database error" });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Record not found" });
    }
    res.status(200).json({ message: "Owner tracking deleted successfully." });
  });
});


// ==============================
// JOCKEY TRACKING ROUTES
// ==============================

// ✅ SAVE jockey tracking
app.post("/api/jockey_tracking", (req, res) => {
  const { jockeyFullName, correspondingHorses, user_id } = req.body;

  if (!jockeyFullName || !correspondingHorses || !user_id) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const query = `
    INSERT INTO jockey_tracking (jockeyFullName, correspondingHorses, user_id)
    VALUES (?, ?, ?);
  `;

  db.query(
    query,
    [jockeyFullName, JSON.stringify(correspondingHorses), user_id],
    (err, results) => {
      if (err) {
        console.error("Error saving Jockey tracking:", err);
        return res.status(500).json({ error: "Database error." });
      }
      res.status(200).json({ message: "Jockey tracking saved successfully!" });
    }
  );
});


// ✅ FETCH jockey tracking for a user
app.get("/api/jockey_tracking", (req, res) => {
  const { user } = req.query;

  if (!user) {
    return res.status(400).json({ error: "User is required" });
  }

  const query = `
    SELECT * FROM jockey_tracking
    WHERE user_id = ?
    ORDER BY created_at DESC
  `;

  db.query(query, [user], (err, results) => {
    if (err) {
      console.error("Error fetching jockey tracking:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.status(200).json({ data: results });
  });
});


// ✅ DELETE a jockey tracking record by id
app.delete("/api/jockey_tracking/:id", (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "ID is required" });

  const query = `DELETE FROM jockey_tracking WHERE id = ?`;

  db.query(query, [id], (err, result) => {
    if (err) {
      console.error("Error deleting jockey tracking:", err);
      return res.status(500).json({ error: "Database error" });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Record not found" });
    }
    res.status(200).json({ message: "Jockey tracking deleted successfully." });
  });
});



// Dynamic field mapping based on table name
const tableFieldMap = {
  sire_profile: 'Sire',
  sire_profile_three: 'Sire',
  sire_profile_one: 'Sire',
  dam_profile: 'Sire',
  dam_profile_three: 'Sire',
  dam_profile_one: 'Sire',
  owner_profile: 'Sire',
  owner_profile_three: 'Sire',
  owner_profile_one: 'Sire',
  jockey_name_profile: 'Sire',
  jockey_name_profile_three: 'Sire',
  jockey_name_profile_one: 'Sire',
  trainer_name_profile: 'Sire',
  trainer_name_profile_three: 'Sire',
  trainer_name_profile_one: 'Sire',
  horse_names: 'Sire',
};



// app.get('/api/api_races', (req, res) => {
//   const { meetingDate } = req.query;

//   let dataQuery = `
//     SELECT * FROM api_races
//   `;
//   const params = [];

//   if (meetingDate) {
//     const startOfDay = `${meetingDate} 00:00:00`;
//     const endOfDay = `${meetingDate} 23:59:59`;
//     dataQuery += ` WHERE meetingDate BETWEEN ? AND ?`;
//     params.push(startOfDay, endOfDay);
//   }

//   db.query(dataQuery, params, (err, rows) => {
//     if (err) {
//       console.error("Database Error:", err);
//       return res.status(500).json({ error: "Database error" });
//     }

//     console.log(`Total records fetched for ${meetingDate}:`, rows.length);
//     res.json({ data: rows });
//   });
// });


app.get('/api/mareupdates', (req, res) => {
  console.log("GET request received at /api/mareupdates");

  const { sireName, page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;

  let query = `SELECT * FROM mareupdates`;
  let params = [];

  if (sireName) {
    query += " WHERE sireName LIKE ?";
    params.push(`%${sireName}%`);
  }

  query += ` LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));

  db.query(query, params, (err, results) => {
    if (err) {
      console.error("Error fetching mare updates from the database:", err);
      return res.status(500).json({ error: "Database error" });
    }

    db.query(`SELECT COUNT(*) AS total FROM mareupdates${sireName ? " WHERE sireName LIKE ?" : ""}`, sireName ? [`%${sireName}%`] : [], (countErr, countResults) => {
      if (countErr) {
        console.error("Error counting mare updates:", countErr);
        return res.status(500).json({ error: "Database error" });
      }

      const totalPages = Math.ceil(countResults[0].total / limit);
      console.log(`Mare updates fetched successfully: ${results.length} rows`);

      res.status(200).json({ data: results, totalPages });
    });
  });
});


app.get('/api/userSearch', (req, res) => {
  const searchQuery = req.query.q;

  if (!searchQuery || searchQuery.trim().length === 0) {
    return res.status(400).json({ message: 'Missing search query.' });
  }

  const sql = `
    SELECT name, user_id, email 
    FROM UserAccounts 
    WHERE name LIKE ? OR user_id LIKE ?
    LIMIT 10
  `;

  const queryParam = `%${searchQuery.trim()}%`;

  db.query(sql, [queryParam, queryParam], (err, results) => {
    if (err) {
      console.error("User search error:", err);
      return res.status(500).json({ message: "Server error." });
    }

    return res.status(200).json({ results });
  });
});


app.post('/api/horse_tracking_shares', (req, res) => {
  const { owner_user_id, shared_with_user_id } = req.body;

  if (!owner_user_id || !shared_with_user_id) {
    return res.status(400).json({ message: 'Both owner_user_id and shared_with_user_id are required.' });
  }

  const checkQuery = `
    SELECT * FROM horse_tracking_shares 
    WHERE owner_user_id = ? AND shared_with_user_id = ?
  `;

  db.query(checkQuery, [owner_user_id, shared_with_user_id], (err, results) => {
    if (err) {
      console.error('Error checking existing share:', err);
      return res.status(500).json({ message: 'Database error.' });
    }

    if (results.length > 0) {
      return res.status(409).json({ message: 'Tracking already shared with this user.' });
    }

    const insertQuery = `
      INSERT INTO horse_tracking_shares (owner_user_id, shared_with_user_id)
      VALUES (?, ?)
    `;

    db.query(insertQuery, [owner_user_id, shared_with_user_id], (insertErr) => {
      if (insertErr) {
        console.error('Insert error:', insertErr);
        return res.status(500).json({ message: 'Failed to share tracking.' });
      }

      return res.status(201).json({ message: 'Tracking shared successfully.' });
    });
  });
});


app.get('/api/horse_tracking_shares', (req, res) => {
  console.log("GET /api/horse_tracking_shares hit");

  const sql = `
    SELECT 
      s.owner_user_id, 
      s.shared_with_user_id, 
      u1.name AS owner_name, 
      u2.name AS shared_with_name 
    FROM horse_tracking_shares s
    LEFT JOIN UserAccounts u1 ON s.owner_user_id = u1.user_id
    LEFT JOIN UserAccounts u2 ON s.shared_with_user_id = u2.user_id
    ORDER BY s.id DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching shared tracking records:", err);
      return res.status(500).json({ message: "Failed to fetch data." });
    }

    return res.status(200).json({ data: results });
  });
});



app.get('/api/dampedigree_ratings', (req, res) => {
  console.log("GET request received at /api/dampedigree_ratings");

  const { horseName, page = 1, limit = 10, sortBy, order = 'asc' } = req.query;
  const offset = (page - 1) * limit;

  // Define valid columns for sorting
  const validSortColumns = [
    "horseName", "sireName", "damName", "ownerFullName",
    "max_performanceRating_Target_Variable", "avg_performanceRating_Target_Variable"
  ];

  // Validate sorting column and order
  const safeSortBy = sortBy && validSortColumns.includes(sortBy) ? sortBy : null;
  const safeOrder = order.toLowerCase() === "desc" ? "DESC" : "ASC";

  let query = `SELECT * FROM dampedigree_ratings`;
  let params = [];

  // Apply filtering by horseName if provided
  if (horseName) {
    query += " WHERE horseName LIKE ?";
    params.push(`%${horseName}%`);
  }

  // Apply sorting if a valid column is provided
  if (safeSortBy) {
    query += ` ORDER BY \`${safeSortBy}\` ${safeOrder}`;
  }

  // Apply pagination
  query += ` LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));

  console.log("Final Query:", query, "Params:", params);

  db.query(query, params, (err, results) => {
    if (err) {
      console.error("Error fetching dampedigree_ratings from the database:", err);
      return res.status(500).json({ error: "Database error" });
    }

    // Count total records for pagination
    const countQuery = `SELECT COUNT(*) AS total FROM dampedigree_ratings${horseName ? " WHERE horseName LIKE ?" : ""}`;
    const countParams = horseName ? [`%${horseName}%`] : [];

    db.query(countQuery, countParams, (countErr, countResults) => {
      if (countErr) {
        console.error("Error counting dampedigree_ratings:", countErr);
        return res.status(500).json({ error: "Database error" });
      }

      const totalPages = Math.ceil(countResults[0].total / limit);
      console.log(`Data fetched successfully: ${results.length} rows`);

      res.status(200).json({ data: results, totalPages });
    });
  });
});


app.get('/api/:tableName', (req, res) => {
  const { tableName } = req.params;
  const {
    page = 1,
    limit = 10,
    runnersMin,
    runnersMax,
    runsMin,
    runsMax,
    winners,
    win,
    stakesWins,
    groupWins,
    group1Wins,
    wtr,
    swtr,
    gwtr,
    g1wtr,
    wiv,
    woe,
    wax,
    sire,
    country,
    RaceTypeDetail,
    sortBy,
    order = 'asc'
  } = req.query;

  const offset = (page - 1) * limit;

  // Validate tableName
  if (!validTables.includes(tableName)) {
    return res.status(400).json({ error: "Invalid table name." });
  }

  // Define valid columns for sorting
  const validSortColumns = [
    "Sire", "Country", "Runners", "Runs", "Winners", "Wins", "WinPercent_", 
    "Stakes_Winners", "Stakes_Wins", "Group_Winners", "Group_Wins", 
    "Group_1_Winners", "Group_1_Wins", "WTR", "SWTR", "GWTR", "G1WTR", 
    "WIV", "WOE", "WAX", "Percent_RB2"
  ];

  // Validate sorting column
  const safeSortBy = sortBy && validSortColumns.includes(sortBy) ? sortBy : null;
  const safeOrder = order.toLowerCase() === "desc" ? "DESC" : "ASC";

  // Construct query dynamically
  let query = `SELECT * FROM ??`;
  let params = [tableName];
  const conditions = [];

  if (sire) {
    const keyField = tableFieldMap[tableName];
    conditions.push(`${keyField} LIKE ?`);
    params.push(`%${sire}%`);
  }

  if (country) {
    conditions.push("Country = ?");
    params.push(country);
  }

  if (RaceTypeDetail) { 
    conditions.push("RaceTypeDetail = ?");
    params.push(RaceTypeDetail);
  }

  const numericFilters = {
    "Runners": { min: runnersMin, max: runnersMax },
    "Runs": { min: runsMin, max: runsMax },
    "Winners": { max: winners },
    "Wins": { max: win },
    "Stakes_Wins": { exact: stakesWins },
    "Group_Wins": { exact: groupWins },
    "Group_1_Wins": { exact: group1Wins },
    "WTR": { max: wtr },
    "SWTR": { max: swtr },
    "GWTR": { max: gwtr },
    "G1WTR": { max: g1wtr },
    "WIV": { max: wiv },
    "WOE": { max: woe },
    "WAX": { max: wax }
  };

  Object.entries(numericFilters).forEach(([key, filter]) => {
    if (filter.min) {
      conditions.push(`${key} >= ?`);
      params.push(Number(filter.min));
    }
    if (filter.max) {
      conditions.push(`${key} <= ?`);
      params.push(Number(filter.max));
    }
    if (filter.exact) {
      conditions.push(`${key} = ?`);
      params.push(Number(filter.exact));
    }
  });

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }

  // **Adding sorting**
  if (safeSortBy) {
    query += ` ORDER BY \`${safeSortBy}\` ${safeOrder}`;
  }

  // **Adding pagination**
  query += ` LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));

  console.log("Final Query:", query);
  console.log("Query Params:", params);

  db.query(query, params, (err, rows) => {
    if (err) {
      console.error("Error retrieving data:", err);
      return res.status(500).json({ error: "Database error" });
    }

    // Count query for pagination
    let countQuery = `SELECT COUNT(*) AS count FROM ??`;
    let countParams = [tableName];

    if (conditions.length > 0) {
      countQuery += ` WHERE ${conditions.join(" AND ")}`;
      countParams.push(...params.slice(1, -2)); // Remove LIMIT and OFFSET
    }

    db.query(countQuery, countParams, (countErr, countResult) => {
      if (countErr) {
        console.error("Error retrieving row count:", countErr);
        return res.status(500).json({ error: "Database error" });
      }

      res.json({
        data: rows,
        totalPages: Math.ceil(countResult[0].count / limit)
      });
    });
  });
});






// app.post('/api/selected_horses', (req, res) => {
//   console.log("POST request received at /api/selected_horses");

//   // Log the headers and raw body
//   console.log("Request headers:", req.headers);
//   console.log("Raw request body:", req.body);

//   const horse = req.body;

//   // Validation: Ensure required fields are present
//   if (!horse || !horse.Sire || !horse.Country || !horse.user_id) {
//     console.error("Validation failed: Missing required fields");
//     console.error("Received data (validation failed):", horse);
//     return res.status(400).json({ error: "Invalid horse data or missing user_id" });
//   }

//   // Prepare the query and parameters
//   const query = `
//     INSERT INTO selected_horses (
//       Sire, Country, Runners, Runs, Winners, Wins, WinPercent_, Stakes_Winners,
//       Stakes_Wins, Group_Winners, Group_Wins, Group_1_Winners, Group_1_Wins,
//       WTR, SWTR, GWTR, G1WTR, WIV, WOE, WAX, Percent_RB2, user_id, notes
//     )
//     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
//   `;
//   const params = [
//     String(horse.Sire),
//     String(horse.Country),
//     horse.Runners !== null && horse.Runners !== undefined ? String(horse.Runners) : null,
//     horse.Runs !== null && horse.Runs !== undefined ? String(horse.Runs) : null,
//     horse.Winners !== null && horse.Winners !== undefined ? String(horse.Winners) : null,
//     horse.Wins !== null && horse.Wins !== undefined ? String(horse.Wins) : null,
//     horse.WinPercent_ !== null && horse.WinPercent_ !== undefined ? String(horse.WinPercent_) : null,
//     horse.Stakes_Winners !== null && horse.Stakes_Winners !== undefined ? String(horse.Stakes_Winners) : null,
//     horse.Stakes_Wins !== null && horse.Stakes_Wins !== undefined ? String(horse.Stakes_Wins) : null,
//     horse.Group_Winners !== null && horse.Group_Winners !== undefined ? String(horse.Group_Winners) : null,
//     horse.Group_Wins !== null && horse.Group_Wins !== undefined ? String(horse.Group_Wins) : null,
//     horse.Group_1_Winners !== null && horse.Group_1_Winners !== undefined ? String(horse.Group_1_Winners) : null,
//     horse.Group_1_Wins !== null && horse.Group_1_Wins !== undefined ? String(horse.Group_1_Wins) : null,
//     horse.WTR !== null && horse.WTR !== undefined ? String(horse.WTR) : null,
//     horse.SWTR !== null && horse.SWTR !== undefined ? String(horse.SWTR) : null,
//     horse.GWTR !== null && horse.GWTR !== undefined ? String(horse.GWTR) : null,
//     horse.G1WTR !== null && horse.G1WTR !== undefined ? String(horse.G1WTR) : null,
//     horse.WIV !== null && horse.WIV !== undefined ? String(horse.WIV) : null,
//     horse.WOE !== null && horse.WOE !== undefined ? String(horse.WOE) : null,
//     horse.WAX !== null && horse.WAX !== undefined ? String(horse.WAX) : null,
//     horse.Percent_RB2 !== null && horse.Percent_RB2 !== undefined ? String(horse.Percent_RB2) : null,
//     horse.user_id || null,
//     horse.notes ? String(horse.notes) : null,
//   ];

//   // Log the query and parameters
//   console.log("SQL Query:", query);
//   console.log("Query Parameters:", params);

//   // Execute the query
//   db.query(query, params, (err, result) => {
//     if (err) {
//       console.error("Database query error:", err);
//       return res.status(500).json({ error: "Database error", details: err.message });
//     }

//     console.log("Horse saved successfully with ID:", result.insertId);
//     res.status(200).json({ message: "Horse saved successfully", horse_id: result.insertId });
//   });
// });



// // Delete a specific horse from the database
// app.delete('/api/selected_horses/:id', (req, res) => {
//   console.log("DELETE request received at /api/selected_horses");

//   const horseId = req.params.id; // Extract the horse ID from the route parameter

//   // Validate the ID
//   if (!horseId) {
//     return res.status(400).json({ error: "Horse ID is required" });
//   }

//   // Prepare the SQL query
//   const query = `DELETE FROM selected_horses WHERE id = ?`;

//   // Execute the query
//   db.query(query, [horseId], (err, result) => {
//     if (err) {
//       console.error("Error deleting horse from the database:", err);
//       return res.status(500).json({ error: "Database error" });
//     }

//     if (result.affectedRows === 0) {
//       return res.status(404).json({ error: "Horse not found" });
//     }

//     console.log(`Horse with ID ${horseId} deleted successfully`);
//     res.status(200).json({ message: `Horse with ID ${horseId} deleted successfully` });
//   });
// });

// // Update the notes for a specific horse
// app.put('/api/selected_horses/:id', (req, res) => {
//   console.log("PUT request received at /api/selected_horses/:id");

//   const horseId = req.params.id; // Extract horse ID from the URL
//   const { notes } = req.body; // Extract notes from the request body

//   if (!horseId || notes === undefined) {
//     return res.status(400).json({ error: "Horse ID and notes are required" });
//   }

//   const query = `UPDATE selected_horses SET notes = ? WHERE id = ?`;
//   const params = [notes, horseId];

//   db.query(query, params, (err, result) => {
//     if (err) {
//       console.error("Error updating notes in the database:", err);
//       return res.status(500).json({ error: "Database error" });
//     }

//     if (result.affectedRows === 0) {
//       return res.status(404).json({ error: "Horse not found" });
//     }

//     console.log(`Notes updated for horse ID ${horseId}`);
//     res.status(200).json({ message: `Notes updated successfully for horse ID ${horseId}` });
//   });
// });


// --- POST: Track a new horse ---
app.post("/api/selected_horses", (req, res) => {
  const { horse_name, user_id, notes } = req.body;

  if (!horse_name || !user_id) {
    return res.status(400).json({ error: "Missing horse_name or user_id" });
  }

  const unique_key = `${horse_name}_${user_id}`;

  const query = `
    INSERT INTO selected_horses (horse_name, user_id, unique_key, notes)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE notes = VALUES(notes), note_date = CURRENT_TIMESTAMP
  `;

  db.query(query, [horse_name, user_id, unique_key, notes || null], (err, result) => {
    if (err) {
      console.error("Insert error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    return res.status(200).json({ message: "Horse tracked successfully" });
  });
});

// --- PUT: Update notes for a tracked horse by unique_key ---
app.put("/api/selected_horses/:unique_key", (req, res) => {
  const { unique_key } = req.params;
  const { notes } = req.body;

  if (!notes || !unique_key) {
    return res.status(400).json({ error: "Missing notes or unique_key" });
  }

  const query = `UPDATE selected_horses SET notes = ?, note_date = CURRENT_TIMESTAMP WHERE unique_key = ?`;
  db.query(query, [notes, unique_key], (err, result) => {
    if (err) {
      console.error("Update error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    return res.status(200).json({ message: "Notes updated successfully" });
  });
});

// --- GET: Fetch all tracked horses by user_id ---
app.get("/api/selected_horses", (req, res) => {
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: "Missing user_id" });
  }

  const query = `SELECT * FROM selected_horses WHERE user_id = ? ORDER BY tracked_on DESC`;
  db.query(query, [user_id], (err, results) => {
    if (err) {
      console.error("Fetch error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    return res.status(200).json(results);
  });
});

// --- DELETE: Remove a tracked horse ---
app.delete("/api/selected_horses/:unique_key", (req, res) => {
  const { unique_key } = req.params;
  if (!unique_key) return res.status(400).json({ error: "Missing unique_key" });

  const query = `DELETE FROM selected_horses WHERE unique_key = ?`;
  db.query(query, [unique_key], (err, result) => {
    if (err) {
      console.error("Delete error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    return res.status(200).json({ message: "Horse untracked successfully" });
  });
});



// API Endpoint to Save Race
app.post("/api/save-race", (req, res) => {
  const {
    meetingDate,
    raceTitle,
    countryCode,
    courseName,
    courseId,
    raceNumber,
    raceSurfaceName,
    numberOfRunners,
    prizeFund,
    allHorses,
    user
  } = req.body;

  // Validate required fields
  if (
    !meetingDate ||
    !raceTitle ||
    !countryCode ||
    !courseName ||
    !courseId ||
    !raceNumber ||
    !raceSurfaceName ||
    !numberOfRunners ||
    !prizeFund ||
    !allHorses
  ) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  // SQL query to insert the data
  const query = `
    INSERT INTO race_selection_log (
      meetingDate,
      raceTitle,
      countryCode,
      courseName,
      courseId,
      raceNumber,
      raceSurfaceName,
      numberOfRunners,
      prizeFund,
      allHorses,
      user
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `;

  // Execute the query
  db.query(
    query,
    [
      meetingDate,
      raceTitle,
      countryCode,
      courseName,
      courseId,
      raceNumber,
      raceSurfaceName,
      numberOfRunners,
      prizeFund,
      JSON.stringify(allHorses), // Convert allHorses to JSON string
      user || "Tom" // Default to "Tom" if user is not provided
    ],
    (err, results) => {
      if (err) {
        console.error("Error saving race selection:", err);
        return res.status(500).json({ error: "Database error." });
      }
      res.status(200).json({ message: "Race selection saved successfully!" });
    }
  );
});



// Delete a specific race from the database
app.delete('/api/race_selection_log/:id', (req, res) => {
  console.log("DELETE request received at /api/race_selection_log");

  const raceId = req.params.id; // Extract the race ID from the route parameter

  // Validate the ID
  if (!raceId) {
    return res.status(400).json({ error: "Race ID is required" });
  }

  // Prepare the SQL query
  const query = `DELETE FROM race_selection_log WHERE id = ?`;

  // Execute the query
  db.query(query, [raceId], (err, result) => {
    if (err) {
      console.error("Error deleting race from the database:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Race not found" });
    }

    console.log(`Race with ID ${raceId} deleted successfully`);
    res.status(200).json({ message: `Race with ID ${raceId} deleted successfully` });
  });
});


app.get("/api/going/:table", (req, res) => {
  const { table } = req.params;
  const { page = 1, limit = 10, sire = "" } = req.query;

  if (!validTables.includes(table)) {
    return res.status(400).json({ error: "Invalid table requested." });
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const searchTerm = `%${sire}%`;

  const countQuery = `
    SELECT COUNT(*) AS total FROM \`${table}\`
    WHERE Sire LIKE ?
  `;

  const dataQuery = `
    SELECT * FROM \`${table}\`
    WHERE Sire LIKE ?
    LIMIT ? OFFSET ?
  `;

  db.query(countQuery, [searchTerm], (countErr, countResults) => {
    if (countErr) {
      console.error("Count Query Error:", countErr);
      return res.status(500).json({ error: "Database count error" });
    }

    const total = countResults[0].total;
    const totalPages = Math.ceil(total / limit);

    db.query(dataQuery, [searchTerm, parseInt(limit), offset], (dataErr, results) => {
      if (dataErr) {
        console.error("Data Query Error:", dataErr);
        return res.status(500).json({ error: "Database data error" });
      }

      return res.status(200).json({
        data: results,
        totalPages,
      });
    });
  });
});


app.post('/api/register', (req, res) => {
  const { name, userID, email, mobile, password } = req.body;

  if (!name || !userID || !email || !password) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  const checkQuery = 'SELECT * FROM UserAccounts WHERE email = ? OR user_id = ?';

  db.query(checkQuery, [email, userID], (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ message: 'Internal server error.' });
    }

    if (results.length > 0) {
      return res.status(409).json({ message: 'Email or User ID already registered.' });
    }

    bcrypt.hash(password, 10, (hashErr, hashedPassword) => {
      if (hashErr) {
        console.error('Hashing error:', hashErr);
        return res.status(500).json({ message: 'Error encrypting password.' });
      }

      const insertQuery = `
        INSERT INTO UserAccounts (name, user_id, email, password_hash, mobile_number)
        VALUES (?, ?, ?, ?, ?)
      `;

      db.query(
        insertQuery,
        [name, userID, email, hashedPassword, mobile || null],
        (insertErr) => {
          if (insertErr) {
            console.error('Insert error:', insertErr);
            return res.status(500).json({ message: 'Internal server error.' });
          }

          return res.status(201).json({ message: 'User registered successfully.' });
        }
      );
    });
  });
});


app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Missing email or password.' });
  }

  const query = 'SELECT * FROM UserAccounts WHERE email = ? LIMIT 1';

  db.query(query, [email], async (err, results) => {
    if (err) {
      console.error('Login error:', err);
      return res.status(500).json({ message: 'Database error.' });
    }

    if (results.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const user = results[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    return res.status(200).json({ message: 'Login successful', userId: user.user_id });
  });
});


app.post('/api/change-password', async (req, res) => {
  const { email, oldPassword, newPassword } = req.body;

  if (!email || !oldPassword || !newPassword) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  try {
    const selectQuery = 'SELECT password_hash FROM UserAccounts WHERE email = ? LIMIT 1';
    db.query(selectQuery, [email], async (err, results) => {
      if (err) {
        console.error('Error fetching user:', err);
        return res.status(500).json({ message: 'Internal server error.' });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: 'User not found.' });
      }

      const existingHash = results[0].password_hash;
      const isMatch = await bcrypt.compare(oldPassword, existingHash);

      if (!isMatch) {
        return res.status(401).json({ message: 'Old password is incorrect.' });
      }

      try {
        const newHashedPassword = await bcrypt.hash(newPassword, 10);
        const updateQuery = 'UPDATE UserAccounts SET password_hash = ? WHERE email = ?';

        db.query(updateQuery, [newHashedPassword, email], (updateErr) => {
          if (updateErr) {
            console.error('Error updating password:', updateErr);
            return res.status(500).json({ message: 'Failed to update password.' });
          }

          return res.status(200).json({ message: 'Password changed successfully.' });
        });
      } catch (hashErr) {
        console.error('Error hashing new password:', hashErr);
        return res.status(500).json({ message: 'Error processing password.' });
      }
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
});

app.post('/api/update-mobile', (req, res) => {
  const { email, user_id, mobile_number } = req.body;

  if (!mobile_number || (!email && !user_id)) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  // Normalize and validate
  const normalized = normalizeToE164(mobile_number);
  const E164_REGEX = /^\+[1-9]\d{7,14}$/;
  if (!E164_REGEX.test(normalized)) {
    return res.status(400).json({
      message: 'Invalid mobile number format. Use +447900123456 format.',
    });
  }

  const whereClause = email ? 'email = ?' : 'user_id = ?';
  const whereValue = email || user_id;

  // Check if user exists
  const selectQuery = `SELECT * FROM UserAccounts WHERE ${whereClause} LIMIT 1`;
  db.query(selectQuery, [whereValue], (err, results) => {
    if (err) {
      console.error('Error fetching user:', err);
      return res.status(500).json({ message: 'Internal server error.' });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Update mobile number
    const updateQuery = `UPDATE UserAccounts SET mobile_number = ? WHERE ${whereClause}`;
    db.query(updateQuery, [normalized, whereValue], (updateErr) => {
      if (updateErr) {
        console.error('Error updating mobile number:', updateErr);
        return res.status(500).json({ message: 'Failed to update mobile number.' });
      }

      return res.status(200).json({
        message: 'Mobile number updated successfully.',
        mobile_number: normalized
      });
    });
  });
});

// Helper function
function normalizeToE164(input) {
  let cleaned = String(input).trim().replace(/[()\s.-]/g, '');
  if (cleaned.startsWith('+')) {
    cleaned = '+' + cleaned.slice(1).replace(/\D/g, '');
  } else if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2).replace(/\D/g, '');
  } else {
    cleaned = '+' + cleaned.replace(/\D/g, '');
  }
  return cleaned;
}



app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ message: 'Email is required.' });

  // Step 1: Check if user exists
  const selectQuery = 'SELECT * FROM UserAccounts WHERE email = ? LIMIT 1';
  db.query(selectQuery, [email], async (err, results) => {
    if (err) {
      console.error('DB error:', err);
      return res.status(500).json({ message: 'Server error.' });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'No account found with this email.' });
    }

    // Step 2: Generate random 8-character password
    const tempPassword = crypto.randomBytes(4).toString('hex'); // e.g., 'f4a1b2c3'

    // Step 3: Hash it
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    // Step 4: Update password in DB
    const updateQuery = 'UPDATE UserAccounts SET password_hash = ? WHERE email = ?';
    db.query(updateQuery, [hashedPassword, email], async (updateErr) => {
      if (updateErr) {
        console.error('Update error:', updateErr);
        return res.status(500).json({ message: 'Failed to update password.' });
      }

      // Step 5: Send email using nodemailer
      try {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: 'bloodstockblandford@gmail.com', // ✅ your Gmail
            pass: 'bhnf jsgm gpwd jhjo',    // ✅ your 16-character app password
          },
        });

        await transporter.sendMail({
          from: '"Blandford Bloodstock" <your_email@gmail.com>',
          to: email,
          subject: 'Your Temporary Password',
          text: `Your temporary password is: ${tempPassword}\n\nPlease log in and change it immediately.`,
        });

        return res.status(200).json({ message: 'Temporary password sent to your email.' });
      } catch (mailErr) {
        console.error('Email error:', mailErr);
        return res.status(500).json({ message: 'Password updated, but failed to send email.' });
      }
    });
  });
});


app.get('/api/reviewed_results', (req, res) => {
  const user_id = req.query.user_id;

  if (!user_id) {
    return res.status(400).json({ error: "Missing user_id parameter" });
  }

  const query = `
    SELECT horse_name, race_title, race_date
    FROM reviewed_results
    WHERE user_id = ?
  `;

  db.query(query, [user_id], (err, results) => {
    if (err) {
      console.error("Error fetching reviewed results:", err);
      return res.status(500).json({ error: "Database error" });
    }

    // ✅ Format race_date as plain YYYY-MM-DD string (no timezones)
    const formattedResults = results.map(r => ({
      ...r,
      race_date: new Date(r.race_date).toISOString().split("T")[0],
    }));

    res.status(200).json({ data: formattedResults });
  });
});

app.post('/api/reviewed_results', (req, res) => {
  const { user_id, horse_name, race_title, race_date } = req.body;

  if (!user_id || !horse_name || !race_title || !race_date) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // ✅ Trust frontend to send YYYY-MM-DD
  const cleanDate = race_date;

  const query = `
    INSERT IGNORE INTO reviewed_results (user_id, horse_name, race_title, race_date)
    VALUES (?, ?, ?, ?)
  `;

  db.query(query, [user_id, horse_name, race_title, cleanDate], (err, result) => {
    if (err) {
      console.error("Error inserting reviewed result:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(201).json({ message: "Result marked as reviewed." });
  });
});


app.post('/api/race_watchlist', (req, res) => {
  const {
    user_id,
    race_title,
    race_date,
    race_time,
    source_table,
    track = null,        // NEW
    notify = false,
    bookmark = false,
    notes = ''
  } = req.body;

  // (optional) basic required fields check
  if (!user_id || !race_title || !race_date || !race_time || !source_table) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const sql = `
    INSERT INTO race_watchlist
      (user_id, race_title, race_date, race_time, track, source_table, notify, bookmark, notes)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [user_id, race_title, race_date, race_time, track, source_table, notify, bookmark, notes],
    (err, result) => {
      if (err) {
        console.error('Error inserting race_watchlist entry:', err);
        return res.status(500).json({ error: 'Database insert failed' });
      }
      res.status(201).json({ message: 'Watchlist entry added', id: result.insertId });
    }
  );
});

// GET: Fetch all races for a user
app.get('/api/race_watchlist/:userId', (req, res) => {
  const userId = req.params.userId;

  const sql = `
    SELECT * FROM race_watchlist WHERE user_id = ? ORDER BY race_date ASC
  `;

  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error('Error fetching race_watchlist:', err);
      return res.status(500).json({ error: 'Database query failed' });
    }
    res.json(results);
  });
});

// PATCH: Mark a race as done
app.patch('/api/race_watchlist/:id/done', (req, res) => {
  const watchlistId = req.params.id;

  const sql = `
    UPDATE race_watchlist SET done = TRUE WHERE id = ?
  `;

  db.query(sql, [watchlistId], (err, result) => {
    if (err) {
      console.error('Error updating watchlist item:', err);
      return res.status(500).json({ error: 'Database update failed' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Watchlist item not found' });
    }

    res.json({ message: 'Watchlist item marked as done' });
  });
});

// PATCH: Toggle email notification
app.patch('/api/race_watchlist/:id/notify', (req, res) => {
  const watchlistId = req.params.id;
  const { notify } = req.body;

  const sql = `
    UPDATE race_watchlist SET notify = ? WHERE id = ?
  `;

  db.query(sql, [notify, watchlistId], (err, result) => {
    if (err) {
      console.error('Error updating notify field:', err);
      return res.status(500).json({ error: 'Database update failed' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Watchlist item not found' });
    }

    res.json({ message: `Notification ${notify ? 'enabled' : 'disabled'}` });
  });
});


// PATCH: Toggle bookmark flag
app.patch('/api/race_watchlist/:id/bookmark', (req, res) => {
  const watchlistId = req.params.id;
  const { bookmark } = req.body;

  const sql = `
    UPDATE race_watchlist SET bookmark = ? WHERE id = ?
  `;

  db.query(sql, [bookmark, watchlistId], (err, result) => {
    if (err) {
      console.error('Error updating bookmark field:', err);
      return res.status(500).json({ error: 'Database update failed' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Watchlist item not found' });
    }

    res.json({ message: `Bookmark ${bookmark ? 'added' : 'removed'}` });
  });
});


// PATCH: Update notes field
app.patch('/api/race_watchlist/:id/notes', (req, res) => {
  const watchlistId = req.params.id;
  const { notes } = req.body;

  const sql = `
    UPDATE race_watchlist SET notes = ? WHERE id = ?
  `;

  db.query(sql, [notes, watchlistId], (err, result) => {
    if (err) {
      console.error('Error updating notes field:', err);
      return res.status(500).json({ error: 'Database update failed' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Watchlist item not found' });
    }

    res.json({ message: 'Notes updated successfully' });
  });
});


// PATCH: Update notes for a review horse
app.patch('/api/review_horses/:id/notes', (req, res) => {
  const horseId = parseInt(req.params.id); // ✅ Ensure numeric ID
  const { notes } = req.body;

  console.log("🔄 PATCH request received:", { horseId, notes });

  // Validation
  if (!Number.isInteger(horseId)) {
    return res.status(400).json({ error: 'Invalid horse ID' });
  }

  const sql = `UPDATE review_horses SET notes = ? WHERE id = ?`;

  db.query(sql, [notes, horseId], (err, result) => {
    if (err) {
      console.error('❌ Error updating notes:', err);
      return res.status(500).json({ error: 'Database update failed' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Review horse not found' });
    }

    res.json({ message: '✅ Notes updated successfully' });
  });
});


// PATCH: per-user review status using JSON array (reviewStatus holds userIds)
app.patch('/api/review_horses/:id/reviewStatus', (req, res) => {
  const horseId = Number(req.params.id);
  const { userId, reviewed, reviewStatus } = req.body || {};

  if (!Number.isInteger(horseId)) {
    return res.status(400).json({ error: 'Invalid horse ID' });
  }
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    return res.status(400).json({ error: 'userId is required' });
  }

  // Determine desired state: reviewed (true) or unreviewed (false)
  // Support both `reviewed: true/false` and legacy `reviewStatus: 1/0`
  const wantReviewed =
    typeof reviewed === 'boolean'
      ? reviewed
      : (reviewStatus === 1 || reviewStatus === '1');

  if (wantReviewed) {
    // ADD userId to JSON array if not already present
    const sql = `
      UPDATE review_horses
      SET reviewStatus = IF(
        JSON_CONTAINS(reviewStatus, JSON_QUOTE(?), '$'),
        reviewStatus,                                  -- already present, keep as-is
        JSON_ARRAY_APPEND(reviewStatus, '$', ?)        -- append userId
      )
      WHERE id = ?;
    `;
    db.query(sql, [userId, userId, horseId], (err, result) => {
      if (err) {
        console.error('❌ Error updating reviewStatus (add):', err);
        return res.status(500).json({ error: 'Database update failed' });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Review horse not found' });
      }
      return res.json({ message: '✅ Marked reviewed', id: horseId, userId, reviewed: true });
    });
  } else {
    // REMOVE userId from JSON array if present
    const sql = `
      UPDATE review_horses
      SET reviewStatus = CASE
        WHEN JSON_SEARCH(reviewStatus, 'one', ?) IS NULL THEN reviewStatus
        ELSE JSON_REMOVE(reviewStatus, JSON_UNQUOTE(JSON_SEARCH(reviewStatus, 'one', ?)))
      END
      WHERE id = ?;
    `;
    db.query(sql, [userId, userId, horseId], (err, result) => {
      if (err) {
        console.error('❌ Error updating reviewStatus (remove):', err);
        return res.status(500).json({ error: 'Database update failed' });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Review horse not found' });
      }
      return res.json({ message: '✅ Marked unreviewed', id: horseId, userId, reviewed: false });
    });
  }
});


app.patch('/api/horseTracking/:horseName/flags', (req, res) => {
  try {
    const { horseName } = req.params;
    const user = req.query.user || req.body.user || req.body.User;
    let { bookmark, notify, done } = req.body || {};

    if (!horseName || !user) {
      return res.status(400).json({ error: "horseName and user are required." });
    }

    const sets = [];
    const values = [];

    if (bookmark !== undefined) {
      bookmark = (bookmark === true || bookmark === 1 || bookmark === "1") ? 1 : 0;
      sets.push('bookmark = ?');
      values.push(bookmark);
    }
    if (notify !== undefined) {
      notify = (notify === true || notify === 1 || notify === "1") ? 1 : 0;
      sets.push('notify = ?');
      values.push(notify);
    }
    if (done !== undefined) {
      done = (done === true || done === 1 || done === "1") ? 1 : 0;
      sets.push('done = ?');
      values.push(done);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: "Provide at least one of bookmark, notify, done." });
    }

    // Case-insensitive match on horseName; backtick `User`
    const sql = `
      UPDATE horse_tracking
      SET ${sets.join(', ')}
      WHERE LOWER(horseName) = LOWER(?) AND \`User\` = ?
    `;
    values.push(horseName, user);

    db.query(sql, values, (err, result) => {
      if (err) {
        console.error("[horseTracking flags] SQL ERROR:", err.code, err.sqlMessage);
        return res.status(500).json({ error: "Database error", code: err.code, message: err.sqlMessage });
      }
      return res.json({ message: "Flags updated", affectedRows: result.affectedRows });
    });
  } catch (e) {
    console.error("[horseTracking flags] Handler error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /api/notify_horses  -> insert (or touch updated_at if duplicate)
app.post("/api/notify_horses", (req, res) => {
  const need = required(req.body, ["user_id", "rec_date", "rec_time", "track", "horse", "type", "race"]);
  if (need) return res.status(400).json({ message: `Missing field: ${need}` });

  const { user_id, rec_date, rec_time, track, horse, type, race, source = null } = req.body;

  const sql = `
    INSERT INTO notify_horses (user_id, rec_date, rec_time, track, horse, type, race, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP
  `;
  db.query(sql, [user_id, rec_date, rec_time, track, horse, type, race, source], (err, result) => {
    if (err) {
      console.error("POST /api/notify_horses error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
    return res.status(200).json({ ok: true, id: result.insertId || null });
  });
});

// GET /api/notify_horses?user=<user_id>&date=YYYY-MM-DD
app.get("/api/notify_horses", (req, res) => {
  const { user: user_id, date } = req.query;
  let sql = "SELECT * FROM notify_horses WHERE 1=1";
  const params = [];
  if (user_id) { sql += " AND user_id = ?"; params.push(user_id); }
  if (date)    { sql += " AND rec_date = ?"; params.push(date);   }
  sql += " ORDER BY rec_date ASC, rec_time ASC";

  db.query(sql, params, (err, rows) => {
    if (err) {
      console.error("GET /api/notify_horses error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
    return res.status(200).json({ ok: true, data: rows });
  });
});

// DELETE /api/notify_horses/:id
app.delete("/api/notify_horses/:id", (req, res) => {
  const { id } = req.params;
  db.query("DELETE FROM notify_horses WHERE id = ?", [id], (err, r) => {
    if (err) {
      console.error("DELETE /api/notify_horses/:id error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
    return res.status(200).json({ ok: true, affectedRows: r.affectedRows });
  });
});


// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});