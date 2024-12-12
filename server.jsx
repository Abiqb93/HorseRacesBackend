// Import required modules
const express = require('express');
const mysql = require('mysql');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 8080;
app.use(cors({
  origin: ['http://localhost:3000', 'https://your-frontend-production-url'], // Add allowed origins
  methods: ['GET', 'POST'], // Add methods if needed
  credentials: true // Allow cookies if needed
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
  'racenets',
];

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
};

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
    sire, // Search query for specific sire
    country, // Filter for country
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
    params.push(runnersMin);
  }
  if (runnersMax) {
    conditions.push("Runners <= ?");
    params.push(runnersMax);
  }
  if (runsMin) {
    conditions.push("Runs >= ?");
    params.push(runsMin);
  }
  if (runsMax) {
    conditions.push("Runs <= ?");
    params.push(runsMax);
  }
  if (winners) {
    conditions.push("Winners <= ?");
    params.push(winners);
  }
  if (win) {
    conditions.push("Wins <= ?");
    params.push(win);
  }
  if (stakesWins) {
    conditions.push("Stakes_Wins = ?");
    params.push(stakesWins);
  }
  if (groupWins) {
    conditions.push("Group_Wins = ?");
    params.push(groupWins);
  }
  if (group1Wins) {
    conditions.push("Group_1_Wins = ?");
    params.push(group1Wins);
  }
  if (wtr) {
    conditions.push("CAST(REPLACE(WTR, '%', '') AS REAL) <= ?");
    params.push(parseFloat(wtr));
  }
  if (swtr) {
    conditions.push("CAST(REPLACE(SWTR, '%', '') AS REAL) <= ?");
    params.push(parseFloat(swtr));
  }
  if (gwtr) {
    conditions.push("CAST(REPLACE(GWTR, '%', '') AS REAL) <= ?");
    params.push(parseFloat(gwtr));
  }
  if (g1wtr) {
    conditions.push("CAST(REPLACE(G1WTR, '%', '') AS REAL) <= ?");
    params.push(parseFloat(g1wtr));
  }
  if (wiv) {
    conditions.push("WIV <= ?");
    params.push(wiv);
  }
  if (woe) {
    conditions.push("WOE <= ?");
    params.push(woe);
  }
  if (wax) {
    conditions.push("WAX <= ?");
    params.push(wax);
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
      const countQuery = `SELECT COUNT(*) AS count FROM ??` + (conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : '');
      db.query(countQuery, params.slice(0, -2), (countErr, countResult) => {
        if (countErr) {
          console.error("Error retrieving row count:", countErr);
          res.status(500).json({ error: "Database error" });
        } else {
          res.json({
            data: rows,
            totalPages: Math.ceil(countResult[0].count / limit),
          });
        }
      });
    }
  });
});

// Generalized Endpoint for Suggestions and Search
app.get('/api/:tableName/search', (req, res) => {
  const { tableName } = req.params;
  const { page = 1, limit = 10, search } = req.query;
  const offset = (page - 1) * limit;

  // Validate table name
  if (!validTables.includes(tableName)) {
    return res.status(400).json({ error: "Invalid table name." });
  }

  // Get the appropriate field to search based on table name
  const keyField = tableFieldMap[tableName];
  if (!keyField) {
    return res.status(400).json({ error: "No key field mapped for this table." });
  }

  // Build the query
  let query = `SELECT * FROM ??`;
  let params = [tableName];

  // If there's a search query, add it to the WHERE clause
  if (search) {
    query += ` WHERE ${keyField} LIKE ?`;
    params.push(`%${search}%`);
  }

  // Add pagination
  query += ` LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));

  db.query(query, params, (err, rows) => {
    if (err) {
      console.error("Error retrieving data:", err);
      res.status(500).json({ error: "Database error" });
    } else {
      // Count total rows for pagination
      let countQuery = `SELECT COUNT(*) AS count FROM ??`;
      let countParams = [tableName];

      if (search) {
        countQuery += ` WHERE ${keyField} LIKE ?`;
        countParams.push(`%${search}%`);
      }

      db.query(countQuery, countParams, (countErr, countResult) => {
        if (countErr) {
          console.error("Error retrieving row count:", countErr);
          res.status(500).json({ error: "Database error" });
        } else {
          res.json({
            data: rows,
            totalPages: Math.ceil(countResult[0].count / limit),
          });
        }
      });
    }
  });
});

// Endpoint to retrieve data from the racenets table
app.get('/api/racenets', (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;

  const query = `SELECT * FROM racenets LIMIT ? OFFSET ?`;
  const countQuery = `SELECT COUNT(*) AS count FROM racenets`;

  db.query(query, [Number(limit), Number(offset)], (err, rows) => {
    if (err) {
      console.error("Error retrieving data from racenets:", err);
      res.status(500).json({ error: "Database error" });
    } else {
      db.query(countQuery, [], (countErr, countResult) => {
        if (countErr) {
          console.error("Error retrieving racenets count:", countErr);
          res.status(500).json({ error: "Database error" });
        } else {
          res.json({
            data: rows,
            totalPages: Math.ceil(countResult[0].count / limit),
          });
        }
      });
    }
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
