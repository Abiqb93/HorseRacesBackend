// Import required modules
const express = require('express');
const mysql = require('mysql');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 8080;

// CORS configuration
const allowedOrigins = [
  'http://localhost:5173', // Local frontend
  'https://your-frontend-production-url', // Deployed frontend
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'],
  credentials: true,
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

// Generalized Endpoint for Suggestions and Search
app.get('/api/:tableName', (req, res) => {
  const { tableName } = req.params;
  const { page = 1, limit = 10, search } = req.query;
  const offset = (page - 1) * limit;

  if (!validTables.includes(tableName)) {
    return res.status(400).json({ error: "Invalid table name." });
  }

  const keyField = tableFieldMap[tableName];
  if (!keyField) {
    return res.status(400).json({ error: "No key field mapped for this table." });
  }

  let query = `SELECT * FROM ??`;
  let params = [tableName];

  if (search) {
    query += ` WHERE ${keyField} LIKE ?`;
    params.push(`%${search}%`);
  }

  query += ` LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));

  db.query(query, params, (err, rows) => {
    if (err) {
      console.error("Error retrieving data:", err);
      res.status(500).json({ error: "Database error" });
    } else {
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

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});