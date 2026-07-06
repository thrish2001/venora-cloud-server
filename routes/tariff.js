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
  const {
    site_id, fixed_charge_lkr, demand_charge_per_kva,
    unit_rate_peak, unit_rate_offpeak, peak_start, peak_end
  } = req.body;

  try {
    // Delete existing tariff for this site first
    await pool.query('DELETE FROM tariff_config WHERE site_id = $1', [site_id]);

    // Insert new tariff
    const result = await pool.query(
      `INSERT INTO tariff_config
       (site_id, fixed_charge_lkr, demand_charge_per_kva,
        unit_rate_peak, unit_rate_offpeak, peak_start, peak_end)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [site_id, fixed_charge_lkr, demand_charge_per_kva,
       unit_rate_peak, unit_rate_offpeak, peak_start, peak_end]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;