// Import required modules
const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const bcrypt = require('bcrypt');

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
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Allow all HTTP methods you need
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
  'RacesAndEntries', 'horseTracking', 'attheraces', 'FranceRaceRecords', 'IrelandRaceRecords', 'UserAccounts'
];




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
    WHERE LOWER(horse) = LOWER(?)
    LIMIT 5
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

// ✅ POST: Add new tracking entry for a specific user
app.post('/api/horseTracking', (req, res) => {
  const {
    horseName,
    note,
    noteDateTime,
    trackingDate,
    trackingType,
    TrackingType,
    user,
    User
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
      User
    ) VALUES (?, ?, COALESCE(?, NOW()), ?, ?, ?)
  `;

  const values = [
    horseName,
    note || null,
    noteDateTime,
    trackingDate,
    finalTrackingType,
    finalUser
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


// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});