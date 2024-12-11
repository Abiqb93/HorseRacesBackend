// Import required modules
const express = require('express');
const mysql = require('mysql');
const cors = require('cors');

const app = express();
// const port = 5000;
const port = process.env.PORT || 5000;
app.use(cors());

// MySQL database connection configuration
const db = mysql.createConnection({
  host: "horseprofileshub.czyece6mq0kn.eu-north-1.rds.amazonaws.com",
  user: "abiqb93",
  password: "Saps123$#",
  database: "horseprofileshub_sire",
  port: 3306
});

// Connect to the MySQL database
db.connect((err) => {
  if (err) {
    console.error("Error connecting to MySQL database:", err);
  } else {
    console.log("Connected to AWS RDS MySQL database.");
  }
});

// Centralized list of valid tables
const validTables = [
  'sire_profile', 'sire_profile_three', 'sire_profile_one'
];

// Dynamic field mapping based on table name
const tableFieldMap = {
  sire_profile: 'Sire',
  sire_profile_three: 'Sire',
  sire_profile_one: 'Sire'
};

// Generic endpoint for paginated and filtered data
app.get('/api/:tableName', (req, res) => {
  const { tableName } = req.params;
  const {
    page = 1,
    limit = 10,
    sire,
    country
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

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }

  query += ` LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));

  // Execute the query
  db.query(query, params, (err, rows) => {
    if (err) {
      console.error("Error retrieving data:", err);
      res.status(500).json({ error: "Database error" });
    } else {
      // Count total rows for pagination
      let countQuery = `SELECT COUNT(*) AS count FROM ??`;
      let countParams = [tableName];

      if (conditions.length > 0) {
        countQuery += ` WHERE ${conditions.join(" AND ")}`;
        countParams = [...params.slice(0, -2)];
      }

      db.query(countQuery, countParams, (countErr, countResult) => {
        if (countErr) {
          console.error("Error retrieving row count:", countErr);
          res.status(500).json({ error: "Database error" });
        } else {
          res.json({
            data: rows,
            totalPages: Math.ceil(countResult[0].count / limit)
          });
        }
      });
    }
  });
});

// Start the server
// app.listen(port, () => {
//  console.log(`Server running on http://localhost:${port}`);
// });

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});