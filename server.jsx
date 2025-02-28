const express = require('express');
const mysql = require('mysql');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 8080;

const allowedOrigins = [
  'http://localhost:3000', // Local frontend
  'https://horses-website-deployed-production.up.railway.app', // Deployed frontend
  'https://abiqb93.github.io', // GitHub Pages
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
};

app.use(cors(corsOptions));
app.use(express.json());

const db = mysql.createPool({
  host: "horseprofileshub.czyece6mq0kn.eu-north-1.rds.amazonaws.com",
  user: "abiqb93",
  password: "Saps123$#",
  database: "horseprofileshub",
  port: 3306,
  connectionLimit: 10,
});

// Search companies by any field dynamically
app.get('/api/companies', (req, res) => {
  const { query } = req.query;
  if (!query) {
    return res.status(400).json({ error: "Search query is required" });
  }

  const searchQuery = `%${query}%`;
  const sql = `
    SELECT * FROM Companies 
    WHERE first_name LIKE ? 
    OR last_name LIKE ? 
    OR company_name LIKE ? 
    OR category LIKE ? 
    OR country LIKE ? 
    OR city LIKE ? 
    OR email LIKE ? 
    OR phone LIKE ? 
    OR website LIKE ? 
    OR description LIKE ?`;

  const params = new Array(10).fill(searchQuery);

  db.query(sql, params, (err, results) => {
    if (err) {
      console.error("Error fetching companies:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.status(200).json(results);
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});