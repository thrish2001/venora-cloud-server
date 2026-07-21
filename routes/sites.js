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

// Register a new site
router.post('/', checkApiKey, async (req, res) => {
  const { name, location, contract_demand_kva } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO sites (name, location, contract_demand_kva)
       VALUES ($1, $2, $3) RETURNING *`,
      [name, location, contract_demand_kva]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set unit limit for a site
router.post('/setup-limits', checkApiKey, async (req, res) => {
  const { site_id, max_units } = req.body;
  try {
    await pool.query(`
      ALTER TABLE sites ADD COLUMN IF NOT EXISTS max_units INT DEFAULT 10
    `);
    await pool.query(
      `UPDATE sites SET max_units = $1 WHERE id = $2`,
      [max_units, site_id]
    );
    res.json({ success: true, site_id, max_units });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear all energy data for a site
router.post('/clear-data', checkApiKey, async (req, res) => {
  const { site_id } = req.body;
  try {
    await pool.query('DELETE FROM energy_readings WHERE site_id = $1', [site_id]);
    await pool.query('DELETE FROM daily_cost_summary WHERE site_id = $1', [site_id]);
    res.json({ success: true, message: `All data cleared for site ${site_id}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
