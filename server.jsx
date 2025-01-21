// Import required modules
const express = require('express');
const mysql = require('mysql');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 8080;

// CORS configuration
const allowedOrigins = [
  'http://localhost:5173', // Local frontend
  'https://horses-website-deployed-production.up.railway.app', // Deployed frontend
  'https://Abiqb93.github.io/horses-website-deployed'
];

// app.use(cors({
//   origin: (origin, callback) => {
//     if (!origin || allowedOrigins.includes(origin)) {
//       callback(null, true);
//     } else {
//       callback(new Error('Not allowed by CORS'));
//     }
//   },
//   methods: ['GET', 'POST'],
//   credentials: true,
// }));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Add DELETE and OPTIONS methods
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
  'racenets', 'api_races', 'horse_names', 'selected_horses',
];



// Fetch all data from the "selected_horses" table
app.get('/api/selected_horses', (req, res) => {
  console.log("GET request received at /api/selected_horses");

  // Define the SQL query to fetch all rows
  const query = `SELECT * FROM selected_horses`;

  // Execute the query
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching horses from the database:", err);
      return res.status(500).json({ error: "Database error" });
    }

    console.log("Horses fetched successfully:", results.length, "rows");
    res.status(200).json(results); // Send the results back to the frontend
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



app.get('/api/api_races', (req, res) => {
  const { meetingDate } = req.query;

  let dataQuery = `
    SELECT * FROM api_races
  `;
  const params = [];

  if (meetingDate) {
    const startOfDay = `${meetingDate} 00:00:00`;
    const endOfDay = `${meetingDate} 23:59:59`;
    dataQuery += ` WHERE meetingDate BETWEEN ? AND ?`;
    params.push(startOfDay, endOfDay);
  }

  db.query(dataQuery, params, (err, rows) => {
    if (err) {
      console.error("Database Error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    console.log(`Total records fetched for ${meetingDate}:`, rows.length);
    res.json({ data: rows });
  });
});




// Generic endpoint for paginated and filtered data
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
  } = req.query;
  const offset = (page - 1) * limit;

  // Validate tableName
  if (!validTables.includes(tableName)) {
    return res.status(400).json({ error: "Invalid table name." });
  }

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

  if (runnersMin) {
    conditions.push("Runners >= ?");
    params.push(Number(runnersMin));
  }
  if (runnersMax) {
    conditions.push("Runners <= ?");
    params.push(Number(runnersMax));
  }
  if (runsMin) {
    conditions.push("Runs >= ?");
    params.push(Number(runsMin));
  }
  if (runsMax) {
    conditions.push("Runs <= ?");
    params.push(Number(runsMax));
  }
  if (winners) {
    conditions.push("Winners <= ?");
    params.push(Number(winners));
  }
  if (win) {
    conditions.push("Wins <= ?");
    params.push(Number(win));
  }
  if (stakesWins) {
    conditions.push("Stakes_Wins = ?");
    params.push(Number(stakesWins));
  }
  if (groupWins) {
    conditions.push("Group_Wins = ?");
    params.push(Number(groupWins));
  }
  if (group1Wins) {
    conditions.push("Group_1_Wins = ?");
    params.push(Number(group1Wins));
  }
  if (wtr) {
    conditions.push("CAST(REPLACE(WTR, '%', '') AS DECIMAL(10, 2)) <= ?");
    params.push(parseFloat(wtr));
  }
  if (swtr) {
    conditions.push("CAST(REPLACE(SWTR, '%', '') AS DECIMAL(10, 2)) <= ?");
    params.push(parseFloat(swtr));
  }
  if (gwtr) {
    conditions.push("CAST(REPLACE(GWTR, '%', '') AS DECIMAL(10, 2)) <= ?");
    params.push(parseFloat(gwtr));
  }
  if (g1wtr) {
    conditions.push("CAST(REPLACE(G1WTR, '%', '') AS DECIMAL(10, 2)) <= ?");
    params.push(parseFloat(g1wtr));
  }
  if (wiv) {
    conditions.push("WIV <= ?");
    params.push(Number(wiv));
  }
  if (woe) {
    conditions.push("WOE <= ?");
    params.push(Number(woe));
  }
  if (wax) {
    conditions.push("WAX <= ?");
    params.push(Number(wax));
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }

  query += ` LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));

  db.query(query, params, (err, rows) => {
    if (err) {
      console.error("Error retrieving data:", err);
      res.status(500).json({ error: "Database error" });
    } else {
      db.query(
        `SELECT COUNT(*) AS count FROM ??${conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : ''}`,
        params.slice(0, -2),
        (countErr, countResult) => {
          if (countErr) {
            console.error("Error retrieving row count:", countErr);
            res.status(500).json({ error: "Database error" });
          } else {
            res.json({
              data: rows,
              totalPages: Math.ceil(countResult[0].count / limit),
            });
          }
        }
      );
    }
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





// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});