require("./emailNotifier");

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
  'sire_tracking', 'dam_tracking', 'owner_tracking', 'predicted_timeform'
];



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
  const sql = `SELECT * FROM review_horses ORDER BY horseName ASC`;

  db.query(sql, (err, results) => {
    if (err) {
      console.error('❌ Error fetching review_horses:', err);
      return res.status(500).json({ error: 'Database query failed' });
    }
    res.json(results);
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


app.get('/api/IrelandRaceRecords', (req, res) => {
  const query = `SELECT * FROM IrelandRaceRecords`;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching IrelandRaceRecords:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json({ data: results });
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


// POST: Add race to watchlist (with optional notify, bookmark, notes)
app.post('/api/race_watchlist', (req, res) => {
  const {
    user_id,
    race_title,
    race_date,
    race_time,
    source_table,
    notify = false,
    bookmark = false,
    notes = ''
  } = req.body;

  const sql = `
    INSERT INTO race_watchlist (user_id, race_title, race_date, race_time, source_table, notify, bookmark, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(sql, [user_id, race_title, race_date, race_time, source_table, notify, bookmark, notes], (err, result) => {
    if (err) {
      console.error('Error inserting race_watchlist entry:', err);
      return res.status(500).json({ error: 'Database insert failed' });
    }
    res.status(201).json({ message: 'Watchlist entry added', id: result.insertId });
  });
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

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});