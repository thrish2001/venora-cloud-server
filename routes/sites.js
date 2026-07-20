const express = require('express');
const router = express.Router();
const pool = require('../db');
require('dotenv').config();

function checkApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  next();
}

router.post('/', checkApiKey, async (req, res) => {
  const { name, location, contract_demand_kva } = req.body;
  const result = await pool.query(
    `INSERT INTO sites (name, location, contract_demand_kva)
     VALUES ($1, $2, $3) RETURNING *`,
    [name, location, contract_demand_kva]
  );
  res.json(result.rows[0]);
});
// Set unit limit for a site
router.post('/setup-limits', checkApiKey, async (req, res) => {
  const { site_id, max_units } = req.body;
  try {
    // Add max_units column if it doesn't exist
    await pool.query(`
      ALTER TABLE sites
      ADD COLUMN IF NOT EXISTS max_units INT DEFAULT 10
    `);
    // Update the site
    await pool.query(
      `UPDATE sites SET max_units = $1 WHERE id = $2`,
      [max_units, site_id]
    );
    res.json({ success: true, site_id, max_units });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;