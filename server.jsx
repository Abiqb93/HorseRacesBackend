// Import required modules
const express = require('express');
const mysql = require('mysql');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 8080;

const allowedOrigins = [
  'http://localhost:5173', // Local frontend
  'https://horses-website-deployed-production.up.railway.app', // Deployed frontend
  'https://abiqb93.github.io', // GitHub Pages
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
  'racenets', 'api_races', 'horse_names', 'selected_horses', 'APIData_Table2', 'race_selection_log', 'mareupdates', 'dampedigree_ratings',
];

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


app.get('/api/selected_horses', (req, res) => {
  console.log("GET request received at /api/selected_horses");

  // Extract user identifiers and sorting parameters
  const { user_id, user, sortBy, order = 'asc' } = req.query;

  if (!user_id && !user) {
    return res.status(400).json({ error: "User ID or username is required" });
  }

  // Define valid columns for sorting
  const validSortColumns = [
    "HorseName", "Sire", "Dam", "Trainer", "Jockey", "Owner",
    "Country", "Age", "Runs", "Wins", "Stakes_Wins", "Group_Wins", 
    "Group_1_Wins", "Earnings"
  ]; 

  // Validate sorting column
  const safeSortBy = sortBy && validSortColumns.includes(sortBy) ? sortBy : null;
  const safeOrder = order.toLowerCase() === "desc" ? "DESC" : "ASC";

  // Construct SQL query and parameters
  let query = `SELECT * FROM selected_horses WHERE `;
  let params = [];

  if (user_id) {
    query += ` user_id = ? `;
    params.push(user_id);
  } else if (user) {
    query += ` user = ? `;
    params.push(user);
  }

  if (safeSortBy) {
    query += ` ORDER BY \`${safeSortBy}\` ${safeOrder}`;
  }

  console.log("Final Query:", query, "Params:", params);

  db.query(query, params, (err, results) => {
    if (err) {
      console.error("Error fetching horses from the database:", err);
      return res.status(500).json({ error: "Database error" });
    }

    console.log(`Horses fetched successfully for user ${user_id || user}: ${results.length} rows`);
    res.status(200).json(results);
  });
});


app.post("/api/race_selection_log", (req, res) => {
  const { user } = req.body;

  if (!user) {
    return res.status(400).json({ error: "User is required" });
  }

  const query = `
    SELECT meetingDate, courseId, raceNumber 
    FROM race_selection_log 
    WHERE user = ?;
  `;

  db.query(query, [user], (err, results) => {
    if (err) {
      console.error("Error fetching user races:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.status(200).json(results);
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


app.use(express.json()); 



app.post('/api/selected_horses', (req, res) => {
  console.log("POST request received at /api/selected_horses");

  // Log the headers and raw body
  console.log("Request headers:", req.headers);
  console.log("Raw request body:", req.body);

  const horse = req.body;

  // Validation: Ensure required fields are present
  if (!horse || !horse.Sire || !horse.Country || !horse.user_id) {
    console.error("Validation failed: Missing required fields");
    console.error("Received data (validation failed):", horse);
    return res.status(400).json({ error: "Invalid horse data or missing user_id" });
  }

  // Prepare the query and parameters
  const query = `
    INSERT INTO selected_horses (
      Sire, Country, Runners, Runs, Winners, Wins, WinPercent_, Stakes_Winners,
      Stakes_Wins, Group_Winners, Group_Wins, Group_1_Winners, Group_1_Wins,
      WTR, SWTR, GWTR, G1WTR, WIV, WOE, WAX, Percent_RB2, user_id, notes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    String(horse.Sire),
    String(horse.Country),
    horse.Runners !== null && horse.Runners !== undefined ? String(horse.Runners) : null,
    horse.Runs !== null && horse.Runs !== undefined ? String(horse.Runs) : null,
    horse.Winners !== null && horse.Winners !== undefined ? String(horse.Winners) : null,
    horse.Wins !== null && horse.Wins !== undefined ? String(horse.Wins) : null,
    horse.WinPercent_ !== null && horse.WinPercent_ !== undefined ? String(horse.WinPercent_) : null,
    horse.Stakes_Winners !== null && horse.Stakes_Winners !== undefined ? String(horse.Stakes_Winners) : null,
    horse.Stakes_Wins !== null && horse.Stakes_Wins !== undefined ? String(horse.Stakes_Wins) : null,
    horse.Group_Winners !== null && horse.Group_Winners !== undefined ? String(horse.Group_Winners) : null,
    horse.Group_Wins !== null && horse.Group_Wins !== undefined ? String(horse.Group_Wins) : null,
    horse.Group_1_Winners !== null && horse.Group_1_Winners !== undefined ? String(horse.Group_1_Winners) : null,
    horse.Group_1_Wins !== null && horse.Group_1_Wins !== undefined ? String(horse.Group_1_Wins) : null,
    horse.WTR !== null && horse.WTR !== undefined ? String(horse.WTR) : null,
    horse.SWTR !== null && horse.SWTR !== undefined ? String(horse.SWTR) : null,
    horse.GWTR !== null && horse.GWTR !== undefined ? String(horse.GWTR) : null,
    horse.G1WTR !== null && horse.G1WTR !== undefined ? String(horse.G1WTR) : null,
    horse.WIV !== null && horse.WIV !== undefined ? String(horse.WIV) : null,
    horse.WOE !== null && horse.WOE !== undefined ? String(horse.WOE) : null,
    horse.WAX !== null && horse.WAX !== undefined ? String(horse.WAX) : null,
    horse.Percent_RB2 !== null && horse.Percent_RB2 !== undefined ? String(horse.Percent_RB2) : null,
    horse.user_id || null,
    horse.notes ? String(horse.notes) : null,
  ];

  // Log the query and parameters
  console.log("SQL Query:", query);
  console.log("Query Parameters:", params);

  // Execute the query
  db.query(query, params, (err, result) => {
    if (err) {
      console.error("Database query error:", err);
      return res.status(500).json({ error: "Database error", details: err.message });
    }

    console.log("Horse saved successfully with ID:", result.insertId);
    res.status(200).json({ message: "Horse saved successfully", horse_id: result.insertId });
  });
});



// Delete a specific horse from the database
app.delete('/api/selected_horses/:id', (req, res) => {
  console.log("DELETE request received at /api/selected_horses");

  const horseId = req.params.id; // Extract the horse ID from the route parameter

  // Validate the ID
  if (!horseId) {
    return res.status(400).json({ error: "Horse ID is required" });
  }

  // Prepare the SQL query
  const query = `DELETE FROM selected_horses WHERE id = ?`;

  // Execute the query
  db.query(query, [horseId], (err, result) => {
    if (err) {
      console.error("Error deleting horse from the database:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Horse not found" });
    }

    console.log(`Horse with ID ${horseId} deleted successfully`);
    res.status(200).json({ message: `Horse with ID ${horseId} deleted successfully` });
  });
});

// Update the notes for a specific horse
app.put('/api/selected_horses/:id', (req, res) => {
  console.log("PUT request received at /api/selected_horses/:id");

  const horseId = req.params.id; // Extract horse ID from the URL
  const { notes } = req.body; // Extract notes from the request body

  if (!horseId || notes === undefined) {
    return res.status(400).json({ error: "Horse ID and notes are required" });
  }

  const query = `UPDATE selected_horses SET notes = ? WHERE id = ?`;
  const params = [notes, horseId];

  db.query(query, params, (err, result) => {
    if (err) {
      console.error("Error updating notes in the database:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Horse not found" });
    }

    console.log(`Notes updated for horse ID ${horseId}`);
    res.status(200).json({ message: `Notes updated successfully for horse ID ${horseId}` });
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





// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});